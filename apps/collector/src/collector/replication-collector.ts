import type { FastifyBaseLogger } from "fastify";
import { db, replicationSnapshots, monitoredDatabases } from "@pgvitals/db";
import { eq } from "drizzle-orm";
import { decrypt } from "../lib/encryption.js";
import { safeQuery } from "../lib/safe-query.js";
import { config } from "../config.js";
import type { GeneratedHint } from "./rules-engine.js";

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

// Thresholds for replication lag alerting
const REPLICATION_LAG_WARNING_SECONDS = 30;
const REPLICATION_LAG_CRITICAL_SECONDS = 120;

/**
 * Collects replication lag stats for a monitored database.
 * Silently skips if the database has no replicas.
 * Returns hints for replication lag alerting.
 */
export async function collectReplicationLag(
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
    log.warn({ monitoredDbId }, "DB not found for replication lag collection");
    return hints;
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
      return hints;
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

    // --- Generate replication lag hints with root-cause differentiation ---
    for (const r of rows) {
      const replicaName = r.application_name || "unknown";
      const byteLag = parseInt(r.byte_lag, 10) || 0;
      const replayLagMs = r.replay_lag_ms ? parseFloat(r.replay_lag_ms) : null;
      const timeLagSeconds = replayLagMs != null ? replayLagMs / 1000 : null;
      const state = r.state || "unknown";

      // Rule: Replica not in streaming state
      if (state !== "streaming") {
        const rootCause = state === "catchup"
          ? `Replica "${replicaName}" is in catchup mode — likely recovering after a restart or network disruption. It should return to streaming once caught up.`
          : `Replica "${replicaName}" is in "${state}" state instead of streaming. This may indicate a connection issue, misconfigured replica, or the replica being down.`;

        hints.push({
          ruleType: "replication_not_streaming",
          severity: "critical",
          title: `Replica not streaming: ${replicaName}`,
          description: rootCause,
          metadata: {
            replica_name: replicaName,
            replication_state: state,
            byte_lag: byteLag,
            client_addr: r.client_addr,
          },
        });
        continue; // don't also fire a lag alert for the same replica
      }

      // Rule: Replication time lag exceeds thresholds
      if (timeLagSeconds != null && timeLagSeconds > REPLICATION_LAG_WARNING_SECONDS) {
        const isCritical = timeLagSeconds > REPLICATION_LAG_CRITICAL_SECONDS;

        // Root-cause differentiation
        let rootCause: string;
        if (byteLag > 100_000_000 && timeLagSeconds < 60) {
          // High byte lag but moderate time lag → heavy write load on primary
          rootCause = `Replica "${replicaName}" has ${(byteLag / 1_000_000).toFixed(0)}MB byte lag but only ${timeLagSeconds.toFixed(0)}s time lag. This typically indicates heavy write load on the primary — the replica is keeping up in time but has a large backlog of WAL to replay.`;
        } else if (byteLag < 1_000_000 && timeLagSeconds > 60) {
          // Low byte lag but high time lag → replica is slow to replay
          rootCause = `Replica "${replicaName}" has low byte lag (${(byteLag / 1_000).toFixed(0)}KB) but ${timeLagSeconds.toFixed(0)}s time lag. The replica may be under heavy read load, running long queries that block WAL replay, or has insufficient resources (CPU/IO).`;
        } else {
          // Default: generic lag warning
          rootCause = `Replica "${replicaName}" is ${timeLagSeconds.toFixed(0)}s behind with ${(byteLag / 1_000_000).toFixed(1)}MB byte lag. Possible causes: network latency, high primary write load, replica resource constraints, or WAL replay blocked by long-running queries on the replica.`;
        }

        hints.push({
          ruleType: "replication_lag",
          severity: isCritical ? "critical" : "warning",
          title: `Replication lag: ${replicaName} (${timeLagSeconds.toFixed(0)}s)`,
          description: rootCause,
          metadata: {
            replica_name: replicaName,
            time_lag_seconds: timeLagSeconds,
            byte_lag: byteLag,
            replication_state: state,
            client_addr: r.client_addr,
          },
        });
      }
    }
  } catch (err) {
    // pg_stat_replication may not be accessible without superuser/replication role
    log.debug(
      { err, monitoredDbId },
      "Failed to collect replication lag (may require pg_read_all_stats or superuser)"
    );
  }

  return hints;
}
