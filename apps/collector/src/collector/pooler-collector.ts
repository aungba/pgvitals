import type { FastifyBaseLogger } from "fastify";
import { db, poolerSnapshots, monitoredDatabases } from "@pgvitals/db";
import { eq } from "drizzle-orm";
import { decrypt } from "../lib/encryption.js";
import { config } from "../config.js";
import type { GeneratedHint } from "./rules-engine.js";
import postgres from "postgres";

/* ===================================================================
   PgBouncer Collector — spec §2.12, Phase 9
   
   Connects to PgBouncer admin console and collects pool metrics.
   Only active when pgbouncerConnectionStringEncrypted is configured.
   =================================================================== */

interface PoolRow {
  database: string;
  cl_active: string;
  cl_waiting: string;
  sv_active: string;
  sv_idle: string;
  avg_wait_time: string;
  total_wait_time: string;
}

/**
 * Collects PgBouncer pool metrics for a monitored database.
 * Silently skips if no PgBouncer connection is configured.
 */
export async function collectPoolerStats(
  monitoredDbId: string,
  log: FastifyBaseLogger
): Promise<GeneratedHint[]> {
  const hints: GeneratedHint[] = [];

  const [monitoredDb] = await db
    .select()
    .from(monitoredDatabases)
    .where(eq(monitoredDatabases.id, monitoredDbId))
    .limit(1);

  if (!monitoredDb) {
    log.warn({ monitoredDbId }, "DB not found for pooler collection");
    return hints;
  }

  // Skip if no PgBouncer connection configured
  if (!monitoredDb.pgbouncerConnectionStringEncrypted) {
    return hints;
  }

  const pgbouncerConnStr = decrypt(
    monitoredDb.pgbouncerConnectionStringEncrypted,
    config.encryptionKey
  );

  try {
    // Connect to PgBouncer admin interface
    // PgBouncer admin commands run on the 'pgbouncer' virtual database
    const client = postgres(pgbouncerConnStr, {
      max: 1,
      idle_timeout: 5,
      connect_timeout: 10,
      // PgBouncer doesn't support prepared statements in admin mode
      prepare: false,
    });

    try {
      // SHOW POOLS returns pool-level stats
      const pools = await client.unsafe("SHOW POOLS") as unknown as PoolRow[];

      const now = new Date();

      if (pools.length > 0) {
        const snapshotRows = pools.map((p) => ({
          monitoredDbId,
          capturedAt: now,
          poolName: p.database || "unknown",
          clActive: parseInt(p.cl_active, 10) || 0,
          clWaiting: parseInt(p.cl_waiting, 10) || 0,
          svActive: parseInt(p.sv_active, 10) || 0,
          svIdle: parseInt(p.sv_idle, 10) || 0,
          avgWaitTimeMs: p.avg_wait_time ? parseFloat(p.avg_wait_time) / 1000 : null, // PgBouncer reports in µs
          totalWaitTimeMs: p.total_wait_time ? parseFloat(p.total_wait_time) / 1000 : null,
        }));

        await db.insert(poolerSnapshots).values(snapshotRows);

        log.info(
          { monitoredDbId, poolCount: snapshotRows.length },
          "PgBouncer pool stats collected"
        );

        // Check for pool exhaustion: cl_waiting > 0 on any pool
        for (const p of pools) {
          const clWaiting = parseInt(p.cl_waiting, 10) || 0;
          if (clWaiting > 0) {
            hints.push({
              ruleType: "pool_exhaustion",
              severity: clWaiting > 5 ? "critical" : "warning",
              title: `PgBouncer pool exhaustion: ${p.database}`,
              description: `Pool "${p.database}" has ${clWaiting} client(s) waiting for a server connection. This indicates the pool is at capacity — clients are queuing. Consider increasing pool_size, reducing client connections, or investigating long-running transactions that hold server connections.`,
              metadata: {
                pool_name: p.database,
                cl_active: parseInt(p.cl_active, 10) || 0,
                cl_waiting: clWaiting,
                sv_active: parseInt(p.sv_active, 10) || 0,
                sv_idle: parseInt(p.sv_idle, 10) || 0,
              },
            });
          }
        }
      }
    } finally {
      await client.end({ timeout: 5 });
    }
  } catch (err) {
    log.debug(
      { err, monitoredDbId },
      "Failed to collect PgBouncer stats (may not be configured or accessible)"
    );
  }

  return hints;
}
