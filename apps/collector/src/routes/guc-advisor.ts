import type { FastifyInstance } from "fastify";
import { db, monitoredDatabases } from "@pgvitals/db";
import { eq, and } from "drizzle-orm";
import { decrypt } from "../lib/encryption.js";
import { safeQuery } from "../lib/safe-query.js";
import { config } from "../config.js";
import { authMiddleware } from "../middleware/auth.js";
import {
  generateGucReport,
  type HardwareProfile,
  type LiveSetting,
  type DiskType,
  type WorkloadType,
} from "../collector/guc-advisor.js";

interface GucAdviceQuery {
  totalRamGb?: string;
  cpuCores?: string;
  diskType?: string;
  workloadType?: string;
  maxConnections?: string;
}

export default async function gucRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/databases/:id/guc-advice
   * Inspects live pg_settings on monitored database and calculates PGTune recommendations.
   */
  app.get<{ Params: { id: string }; Querystring: GucAdviceQuery }>(
    "/api/databases/:id/guc-advice",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { id } = request.params;
      const orgId = request.auth.orgId;

      // 1. Verify database ownership
      const [monitoredDb] = await db
        .select()
        .from(monitoredDatabases)
        .where(
          and(
            eq(monitoredDatabases.id, id),
            eq(monitoredDatabases.orgId, orgId)
          )
        )
        .limit(1);

      if (!monitoredDb) {
        return reply.status(404).send({ error: "Database not found" });
      }

      // 2. Decrypt connection string
      const connStr = decrypt(
        monitoredDb.connectionStringEncrypted,
        config.encryptionKey
      );

      // 3. Query relevant pg_settings from target database
      const settingsQuery = `
        SELECT
          name,
          setting,
          unit,
          category,
          context,
          boot_val AS "bootVal",
          reset_val AS "resetVal",
          short_desc AS "shortDesc"
        FROM pg_settings
        WHERE name IN (
          'shared_buffers',
          'effective_cache_size',
          'maintenance_work_mem',
          'work_mem',
          'wal_buffers',
          'min_wal_size',
          'max_wal_size',
          'checkpoint_completion_target',
          'checkpoint_timeout',
          'default_statistics_target',
          'random_page_cost',
          'effective_io_concurrency',
          'max_worker_processes',
          'max_parallel_workers',
          'max_parallel_workers_per_gather',
          'max_connections',
          'track_io_timing',
          'idle_in_transaction_session_timeout',
          'autovacuum_vacuum_cost_limit',
          'autovacuum_max_workers'
        );
      `;

      let liveSettings: LiveSetting[] = [];
      let detectedMaxConns = 100;

      try {
        const rows = await safeQuery<(LiveSetting & Record<string, unknown>)[]>(connStr, settingsQuery, {
          timeoutMs: 5000,
        });
        liveSettings = rows;

        const maxConnSetting = rows.find((r) => r.name === "max_connections");
        if (maxConnSetting && parseInt(maxConnSetting.setting, 10)) {
          detectedMaxConns = parseInt(maxConnSetting.setting, 10);
        }
      } catch (err: any) {
        request.log.warn(
          { dbId: id, err: err.message },
          "Failed to query live pg_settings, proceeding with defaults"
        );
      }

      // 4. Build HardwareProfile from query params or safe defaults
      const query = request.query || {};
      const totalRamGb = query.totalRamGb ? Math.max(1, parseFloat(query.totalRamGb)) : 8;
      const cpuCores = query.cpuCores ? Math.max(1, parseInt(query.cpuCores, 10)) : 4;
      const diskType = (["ssd", "hdd", "san"].includes(query.diskType || "")
        ? query.diskType
        : "ssd") as DiskType;
      const workloadType = (["web", "oltp", "dw", "mixed", "desktop"].includes(
        query.workloadType || ""
      )
        ? query.workloadType
        : "web") as WorkloadType;
      const maxConnections = query.maxConnections
        ? parseInt(query.maxConnections, 10)
        : detectedMaxConns;

      const profile: HardwareProfile = {
        totalRamGb,
        cpuCores,
        diskType,
        workloadType,
        maxConnections,
      };

      // 5. Generate PGTune advice report
      const report = generateGucReport(profile, liveSettings);

      return reply.send({
        databaseId: id,
        databaseName: monitoredDb.name,
        report,
      });
    }
  );
}
