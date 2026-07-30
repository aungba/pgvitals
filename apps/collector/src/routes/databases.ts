import type { FastifyInstance } from "fastify";
import { db, monitoredDatabases, organizations } from "@pgvitals/db";
import { eq } from "drizzle-orm";
import { encrypt } from "../lib/encryption.js";
import { config } from "../config.js";
import { scheduleDatabase, unscheduleDatabase } from "../collector/scheduler.js";

/**
 * Returns the orgId to use for Phase 1 (hardcoded to the first org).
 */
async function getDefaultOrgId(): Promise<string> {
  const [org] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .limit(1);

  if (!org) {
    throw new Error("No organization found. Please seed the database first.");
  }

  return org.id;
}

interface RegisterDatabaseBody {
  name: string;
  connectionString: string;
  environment?: "production" | "staging" | "development";
}

export default async function databaseRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/databases — List all monitored databases.
   */
  app.get("/api/databases", async (request, reply) => {
    try {
      const orgId = await getDefaultOrgId();

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
  app.post<{ Body: RegisterDatabaseBody }>("/api/databases", async (request, reply) => {
    try {
      const { name, connectionString, environment } = request.body;

      if (!name || !connectionString) {
        return reply.status(400).send({
          error: "name and connectionString are required",
        });
      }

      const orgId = await getDefaultOrgId();

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
  });

  /**
   * GET /api/databases/:id — Get a single database's details.
   */
  app.get<{ Params: { id: string } }>("/api/databases/:id", async (request, reply) => {
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
        .where(eq(monitoredDatabases.id, id))
        .limit(1);

      if (!database) {
        return reply.status(404).send({ error: "Database not found" });
      }

      return reply.send({ database });
    } catch (err) {
      request.log.error({ err }, "Failed to get database");
      return reply.status(500).send({ error: "Failed to get database" });
    }
  });

  /**
   * DELETE /api/databases/:id — Remove a monitored database and all its data.
   */
  app.delete<{ Params: { id: string } }>("/api/databases/:id", async (request, reply) => {
    try {
      const { id } = request.params;

      // Verify it exists
      const [existing] = await db
        .select({ id: monitoredDatabases.id, name: monitoredDatabases.name })
        .from(monitoredDatabases)
        .where(eq(monitoredDatabases.id, id))
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
  });
}
