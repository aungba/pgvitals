import type { FastifyInstance } from "fastify";
import { db, monitoredDatabases, organizations } from "@pgvitals/db";
import { eq, and } from "drizzle-orm";
import { encrypt } from "../lib/encryption.js";
import { config } from "../config.js";
import { scheduleDatabase, unscheduleDatabase } from "../collector/scheduler.js";
import { authMiddleware } from "../middleware/auth.js";
import { checkDatabaseLimit } from "../middleware/plan-limits.js";

interface RegisterDatabaseBody {
  name: string;
  connectionString: string;
  environment?: "production" | "staging" | "development";
}

export default async function databaseRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/databases — List all monitored databases.
   */
  app.get("/api/databases", { preHandler: [authMiddleware] }, async (request, reply) => {
    try {
      const orgId = request.auth.orgId;

      const databases = await db
        .select({
          id: monitoredDatabases.id,
          name: monitoredDatabases.name,
          environment: monitoredDatabases.environment,
          isActive: monitoredDatabases.isActive,
          createdAt: monitoredDatabases.createdAt,
        })
        .from(monitoredDatabases)
        .where(eq(monitoredDatabases.orgId, orgId));

      return reply.send({ databases });
    } catch (err) {
      request.log.error({ err }, "Failed to list databases");
      return reply.status(500).send({ error: "Failed to list databases" });
    }
  });

  /**
   * POST /api/databases — Register a new monitored database.
   */
  app.post<{ Body: RegisterDatabaseBody }>(
    "/api/databases",
    { preHandler: [authMiddleware, checkDatabaseLimit] },
    async (request, reply) => {
      try {
        const { name, connectionString, environment } = request.body;

        if (!name || !connectionString) {
          return reply.status(400).send({
            error: "name and connectionString are required",
          });
        }

        const orgId = request.auth.orgId;

        // Encrypt the connection string
        const encryptedConnectionString = encrypt(connectionString, config.encryptionKey);

        const [newDb] = await db
          .insert(monitoredDatabases)
          .values({
            orgId,
            name,
            connectionStringEncrypted: encryptedConnectionString,
            environment: environment ?? "production",
          })
          .returning({
            id: monitoredDatabases.id,
            name: monitoredDatabases.name,
            environment: monitoredDatabases.environment,
            isActive: monitoredDatabases.isActive,
            createdAt: monitoredDatabases.createdAt,
          });

        // Add to the collection schedule
        await scheduleDatabase(newDb.id, newDb.name, request.log);

        return reply.status(201).send({ database: newDb });
      } catch (err) {
        request.log.error({ err }, "Failed to register database");
        return reply.status(500).send({ error: "Failed to register database" });
      }
    }
  );

  /**
   * GET /api/databases/:id — Get a single database's details.
   */
  app.get<{ Params: { id: string } }>(
    "/api/databases/:id",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      try {
        const { id } = request.params;

        const [database] = await db
          .select({
            id: monitoredDatabases.id,
            name: monitoredDatabases.name,
            environment: monitoredDatabases.environment,
            isActive: monitoredDatabases.isActive,
            createdAt: monitoredDatabases.createdAt,
          })
          .from(monitoredDatabases)
          .where(and(eq(monitoredDatabases.id, id), eq(monitoredDatabases.orgId, request.auth.orgId)))
          .limit(1);

        if (!database) {
          return reply.status(404).send({ error: "Database not found" });
        }

        return reply.send({ database });
      } catch (err) {
        request.log.error({ err }, "Failed to get database");
        return reply.status(500).send({ error: "Failed to get database" });
      }
    }
  );

  /**
   * DELETE /api/databases/:id — Remove a monitored database and all its data.
   */
  app.delete<{ Params: { id: string } }>(
    "/api/databases/:id",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      try {
        const { id } = request.params;

        // Verify it exists and belongs to this org
        const [existing] = await db
          .select({ id: monitoredDatabases.id, name: monitoredDatabases.name })
          .from(monitoredDatabases)
          .where(and(eq(monitoredDatabases.id, id), eq(monitoredDatabases.orgId, request.auth.orgId)))
          .limit(1);

        if (!existing) {
          return reply.status(404).send({ error: "Database not found" });
        }

        // Remove from BullMQ schedule
        await unscheduleDatabase(id, request.log);

        // Delete from DB (cascades to snapshots, sessions_snapshot, root_cause_hints)
        await db
          .delete(monitoredDatabases)
          .where(eq(monitoredDatabases.id, id));

        request.log.info({ id, name: existing.name }, "Database deleted");

        return reply.send({ success: true, deleted: existing });
      } catch (err) {
        request.log.error({ err }, "Failed to delete database");
        return reply.status(500).send({ error: "Failed to delete database" });
      }
    }
  );

  /**
   * POST /api/databases/validate — Test a connection string during onboarding.
   * Returns database version, name, and max_connections.
   */
  app.post<{ Body: { connectionString: string } }>(
    "/api/databases/validate",
    async (request, reply) => {
      const { connectionString } = request.body as { connectionString: string };
      if (!connectionString) {
        return reply.status(400).send({ success: false, error: "connectionString is required" });
      }

      // Dynamic import to avoid circular deps
      const postgres = (await import("postgres")).default;
      const client = postgres(connectionString, {
        max: 1,
        idle_timeout: 5,
        connect_timeout: 10,
      });

      try {
        const [versionRow] = await client`SELECT version() AS version`;
        const [maxConnRow] = await client`SHOW max_connections`;
        const [dbRow] = await client`SELECT current_database() AS db_name`;

        await client.end({ timeout: 5 });

        return reply.send({
          success: true,
          details: {
            version: (versionRow.version as string).split(" ").slice(0, 2).join(" "),
            maxConnections: parseInt(maxConnRow.max_connections as string, 10),
            databaseName: dbRow.db_name,
          },
        });
      } catch (err) {
        try { await client.end({ timeout: 3 }); } catch { /* ignore */ }
        const message = err instanceof Error ? err.message : "Unknown error";
        return reply.status(400).send({ success: false, error: message });
      }
    }
  );

  /**
   * POST /api/databases/capabilities — Detect optional extensions.
   */
  app.post<{ Body: { connectionString: string } }>(
    "/api/databases/capabilities",
    async (request, reply) => {
      const { connectionString } = request.body as { connectionString: string };
      if (!connectionString) {
        return reply.status(400).send({ error: "connectionString is required" });
      }

      const postgres = (await import("postgres")).default;
      const client = postgres(connectionString, {
        max: 1,
        idle_timeout: 5,
        connect_timeout: 10,
      });

      try {
        const extensions = await client`
          SELECT extname FROM pg_extension 
          WHERE extname IN ('pg_stat_statements', 'hypopg')
        `;
        const extNames = extensions.map((r) => r.extname as string);

        // Check PgBouncer — attempt to connect to admin port
        let pgbouncer = false;
        try {
          // Look for a setting that suggests PgBouncer is involved
          const [poolerCheck] = await client`
            SELECT current_setting('server_version', true) AS sv
          `;
          // PgBouncer's admin console returns different version format
          // This is a heuristic — not definitive
          pgbouncer = false; // Default: can't detect from app DB alone
        } catch {
          pgbouncer = false;
        }

        await client.end({ timeout: 5 });

        return reply.send({
          pgStatStatements: extNames.includes("pg_stat_statements"),
          hypopg: extNames.includes("hypopg"),
          pgbouncer,
        });
      } catch (err) {
        try { await client.end({ timeout: 3 }); } catch { /* ignore */ }
        const message = err instanceof Error ? err.message : "Unknown error";
        return reply.status(400).send({ error: message });
      }
    }
  );
}
