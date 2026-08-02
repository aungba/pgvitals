import type { FastifyBaseLogger } from "fastify";
import { db, replicationSnapshots, monitoredDatabases } from "@pgvitals/db";
import { eq } from "drizzle-orm";
import { decrypt } from "../lib/encryption.js";
import { safeQuery } from "../lib/safe-query.js";
import { config } from "../config.js";

/* ===================================================================
   Replication Lag Collector — Phase 7
   
   Monitors streaming replication lag by querying pg_stat_replication
   on the primary. Only collects data when replicas are present.
   =================================================================== */

/** Row from pg_stat_replication */
interface ReplicationRow {
  application_name: string;
  client_addr: string | null;
  state: string;
  sent_lsn: string | null;
  write_lsn: string | null;
  flush_lsn: string | null;
  replay_lsn: string | null;
  byte_lag: string;
  write_lag_ms: string | null;
  flush_lag_ms: string | null;
  replay_lag_ms: string | null;
}

/**
 * Query pg_stat_replication on the primary for per-replica lag metrics.
 *
 * Notes:
 * - `pg_stat_replication` is only populated on primary servers with active replicas.
 * - Returns empty rows if the server has no replicas (gracefully skipped).
 * - `pg_wal_lsn_diff()` computes byte difference between two LSN positions.
 * - `write_lag`, `flush_lag`, `replay_lag` are interval types (PG10+).
 */
const REPLICATION_QUERY = `
SELECT
  application_name,
  client_addr::text,
  state,
  sent_lsn::text,
  write_lsn::text,
  flush_lsn::text,
  replay_lsn::text,
  COALESCE(pg_wal_lsn_diff(sent_lsn, replay_lsn), 0)::text AS byte_lag,
  CASE WHEN write_lag IS NOT NULL
    THEN (EXTRACT(EPOCH FROM write_lag) * 1000)::text
    ELSE NULL
  END AS write_lag_ms,
  CASE WHEN flush_lag IS NOT NULL
    THEN (EXTRACT(EPOCH FROM flush_lag) * 1000)::text
    ELSE NULL
  END AS flush_lag_ms,
  CASE WHEN replay_lag IS NOT NULL
    THEN (EXTRACT(EPOCH FROM replay_lag) * 1000)::text
    ELSE NULL
  END AS replay_lag_ms
FROM pg_stat_replication
ORDER BY byte_lag DESC
`;

/**
 * Collects replication lag stats for a monitored database.
 * Silently skips if the database has no replicas.
 */
export async function collectReplicationLag(
  monitoredDbId: string,
  log: FastifyBaseLogger
): Promise<void> {
  const [monitoredDb] = await db
    .select()
    .from(monitoredDatabases)
    .where(eq(monitoredDatabases.id, monitoredDbId))
    .limit(1);

  if (!monitoredDb) {
    log.warn({ monitoredDbId }, "DB not found for replication lag collection");
    return;
  }

  const connectionString = decrypt(
    monitoredDb.connectionStringEncrypted,
    config.encryptionKey
  );

  try {
    const rows = await safeQuery<ReplicationRow[]>(
      connectionString,
      REPLICATION_QUERY,
      { timeoutMs: 10000 }
    );

    // No replicas — silently skip
    if (rows.length === 0) {
      log.debug({ monitoredDbId }, "No replicas detected, skipping replication lag collection");
      return;
    }

    const now = new Date();

    const snapshotRows = rows.map((r) => {
      const byteLag = parseInt(r.byte_lag, 10) || 0;
      const replayLagMs = r.replay_lag_ms ? parseFloat(r.replay_lag_ms) : null;
      const timeLagSeconds = replayLagMs != null ? replayLagMs / 1000 : null;

      return {
        monitoredDbId,
        capturedAt: now,
        replicaName: r.application_name || "unknown",
        clientAddr: r.client_addr,
        replicationState: r.state || "unknown",
        sentLsn: r.sent_lsn,
        writeLsn: r.write_lsn,
        flushLsn: r.flush_lsn,
        replayLsn: r.replay_lsn,
        byteLag,
        timeLagSeconds,
        writeLagMs: r.write_lag_ms ? parseFloat(r.write_lag_ms) : null,
        flushLagMs: r.flush_lag_ms ? parseFloat(r.flush_lag_ms) : null,
        replayLagMs: replayLagMs,
      };
    });

    await db.insert(replicationSnapshots).values(snapshotRows);

    log.info(
      { monitoredDbId, replicaCount: snapshotRows.length },
      "Replication lag stats collected"
    );
  } catch (err) {
    // pg_stat_replication may not be accessible without superuser/replication role
    log.debug(
      { err, monitoredDbId },
      "Failed to collect replication lag (may require pg_read_all_stats or superuser)"
    );
  }
}
