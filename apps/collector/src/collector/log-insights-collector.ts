import type { FastifyBaseLogger } from "fastify";
import { db, logInsights, dbErrorStats, monitoredDatabases } from "@pgvitals/db";
import { eq, desc, and } from "drizzle-orm";
import { decrypt } from "../lib/encryption.js";
import { safeQuery } from "../lib/safe-query.js";
import { config } from "../config.js";

/* ===================================================================
   Log Insights Collector — Phase 8

   Collects error/warning signals from PostgreSQL system views:
   1. pg_stat_database — aggregate counters (deadlocks, conflicts, rollbacks)
   2. pg_stat_activity — currently errored sessions (if any)
   3. pg_stat_database_conflicts — replication conflict breakdown
   4. pg_catalog.pg_stat_bgwriter — checkpoint pressure
   =================================================================== */

/** Aggregated stats from pg_stat_database */
interface DbStatsRow {
  deadlocks: string;
  conflicts: string;
  xact_rollback: string;
  temp_files: string;
  temp_bytes: string;
}

/** Per-error breakdown from pg_stat_activity (error state sessions) */
interface ErrorSessionRow {
  usename: string | null;
  datname: string | null;
  state: string;
  query: string | null;
  wait_event_type: string | null;
  wait_event: string | null;
}

/** Checkpoint stats from pg_stat_bgwriter */
interface BgWriterRow {
  checkpoints_req: string;
  buffers_backend: string;
}

const DB_STATS_QUERY = `
SELECT
  COALESCE(deadlocks, 0)::text AS deadlocks,
  COALESCE(conflicts, 0)::text AS conflicts,
  COALESCE(xact_rollback, 0)::text AS xact_rollback,
  COALESCE(temp_files, 0)::text AS temp_files,
  COALESCE(temp_bytes, 0)::text AS temp_bytes
FROM pg_stat_database
WHERE datname = current_database()
`;

const ERROR_SESSIONS_QUERY = `
SELECT
  usename,
  datname,
  state,
  LEFT(query, 500) AS query,
  wait_event_type,
  wait_event
FROM pg_stat_activity
WHERE state = 'idle in transaction (aborted)'
   OR (wait_event_type = 'Lock' AND state = 'active')
ORDER BY backend_start
LIMIT 50
`;

const BGWRITER_QUERY = `
SELECT
  checkpoints_req::text,
  buffers_backend::text
FROM pg_stat_bgwriter
`;

/**
 * Collects log insight data for a monitored database.
 */
export async function collectLogInsights(
  monitoredDbId: string,
  log: FastifyBaseLogger
): Promise<void> {
  const [monitoredDb] = await db
    .select()
    .from(monitoredDatabases)
    .where(eq(monitoredDatabases.id, monitoredDbId))
    .limit(1);

  if (!monitoredDb) {
    log.warn({ monitoredDbId }, "DB not found for log insights collection");
    return;
  }

  const connectionString = decrypt(
    monitoredDb.connectionStringEncrypted,
    config.encryptionKey
  );

  const now = new Date();

  try {
    // 1. Fetch aggregate error stats
    const [stats] = await safeQuery<DbStatsRow[]>(
      connectionString,
      DB_STATS_QUERY,
      { timeoutMs: 10000 }
    );

    if (stats) {
      // Get previous snapshot to compute deltas
      const [prev] = await db
        .select()
        .from(dbErrorStats)
        .where(eq(dbErrorStats.monitoredDbId, monitoredDbId))
        .orderBy(desc(dbErrorStats.capturedAt))
        .limit(1);

      const currentDeadlocks = parseInt(stats.deadlocks, 10) || 0;
      const currentConflicts = parseInt(stats.conflicts, 10) || 0;
      const currentRollbacks = parseInt(stats.xact_rollback, 10) || 0;
      const currentTempFiles = parseInt(stats.temp_files, 10) || 0;
      const currentTempBytes = parseFloat(stats.temp_bytes) || 0;

      // Compute deltas (handle counter resets from server restart, establish baseline on first run)
      const deltaDeadlocks = prev
        ? (currentDeadlocks >= prev.deadlocksCount ? currentDeadlocks - prev.deadlocksCount : currentDeadlocks)
        : 0;
      const deltaConflicts = prev
        ? (currentConflicts >= prev.conflictsCount ? currentConflicts - prev.conflictsCount : currentConflicts)
        : 0;
      const deltaRollbacks = prev
        ? (currentRollbacks >= prev.rollbacksCount ? currentRollbacks - prev.rollbacksCount : currentRollbacks)
        : 0;

      await db.insert(dbErrorStats).values({
        monitoredDbId,
        capturedAt: now,
        deadlocksCount: currentDeadlocks,
        conflictsCount: currentConflicts,
        rollbacksCount: currentRollbacks,
        tempFilesCount: currentTempFiles,
        tempFilesBytes: currentTempBytes,
        checkpointWarnings: 0,
      });

      // Generate log insight entries for significant deltas
      const insights: Array<{
        monitoredDbId: string;
        capturedAt: Date;
        severity: "error" | "warning" | "info";
        errorType: string;
        errorMessage: string;
        errorCount: number;
        sampleQuery: string | null;
        databaseName: string | null;
        userName: string | null;
      }> = [];

      if (deltaDeadlocks > 0) {
        insights.push({
          monitoredDbId,
          capturedAt: now,
          severity: "error",
          errorType: "deadlock",
          errorMessage: `${deltaDeadlocks} deadlock(s) detected since last check`,
          errorCount: deltaDeadlocks,
          sampleQuery: null,
          databaseName: null,
          userName: null,
        });
      }

      if (deltaConflicts > 0) {
        insights.push({
          monitoredDbId,
          capturedAt: now,
          severity: "warning",
          errorType: "replication_conflict",
          errorMessage: `${deltaConflicts} replication conflict(s) since last check`,
          errorCount: deltaConflicts,
          sampleQuery: null,
          databaseName: null,
          userName: null,
        });
      }

      if (deltaRollbacks > 10) {
        insights.push({
          monitoredDbId,
          capturedAt: now,
          severity: deltaRollbacks > 100 ? "error" : "warning",
          errorType: "high_rollback_rate",
          errorMessage: `${deltaRollbacks} transaction rollback(s) since last check`,
          errorCount: deltaRollbacks,
          sampleQuery: null,
          databaseName: null,
          userName: null,
        });
      }

      // 2. Check for checkpoint pressure
      try {
        const [bgw] = await safeQuery<BgWriterRow[]>(
          connectionString,
          BGWRITER_QUERY,
          { timeoutMs: 5000 }
        );
        if (bgw) {
          const reqCheckpoints = parseInt(bgw.checkpoints_req, 10) || 0;
          const backendBuffers = parseInt(bgw.buffers_backend, 10) || 0;

          if (prev && reqCheckpoints > (prev.checkpointWarnings || 0) + 5) {
            insights.push({
              monitoredDbId,
              capturedAt: now,
              severity: "warning",
              errorType: "checkpoint_pressure",
              errorMessage: `High checkpoint request rate detected (${reqCheckpoints} requested checkpoints). Consider increasing checkpoint_completion_target or shared_buffers.`,
              errorCount: reqCheckpoints,
              sampleQuery: null,
              databaseName: null,
              userName: null,
            });
          }

          // Update checkpoint count
          if (stats) {
            await db
              .insert(dbErrorStats)
              .values({
                monitoredDbId,
                capturedAt: new Date(now.getTime() + 1), // avoid PK conflict
                deadlocksCount: currentDeadlocks,
                conflictsCount: currentConflicts,
                rollbacksCount: currentRollbacks,
                tempFilesCount: currentTempFiles,
                tempFilesBytes: currentTempBytes,
                checkpointWarnings: reqCheckpoints,
              })
              .onConflictDoNothing();
          }
        }
      } catch {
        // bgwriter stats optional
      }

      // 3. Check for error-state sessions
      try {
        const errorSessions = await safeQuery<ErrorSessionRow[]>(
          connectionString,
          ERROR_SESSIONS_QUERY,
          { timeoutMs: 5000 }
        );

        // Group by state
        const abortedSessions = errorSessions.filter(
          (s) => s.state === "idle in transaction (aborted)"
        );
        const blockedSessions = errorSessions.filter(
          (s) => s.wait_event_type === "Lock"
        );

        if (abortedSessions.length > 0) {
          insights.push({
            monitoredDbId,
            capturedAt: now,
            severity: abortedSessions.length > 5 ? "error" : "warning",
            errorType: "aborted_transaction",
            errorMessage: `${abortedSessions.length} session(s) in 'idle in transaction (aborted)' state — these hold locks and consume connections`,
            errorCount: abortedSessions.length,
            sampleQuery: abortedSessions[0]?.query ?? null,
            databaseName: abortedSessions[0]?.datname ?? null,
            userName: abortedSessions[0]?.usename ?? null,
          });
        }

        if (blockedSessions.length > 3) {
          insights.push({
            monitoredDbId,
            capturedAt: now,
            severity: blockedSessions.length > 10 ? "error" : "warning",
            errorType: "lock_contention",
            errorMessage: `${blockedSessions.length} session(s) waiting on locks — indicates lock contention`,
            errorCount: blockedSessions.length,
            sampleQuery: blockedSessions[0]?.query ?? null,
            databaseName: blockedSessions[0]?.datname ?? null,
            userName: blockedSessions[0]?.usename ?? null,
          });
        }
      } catch {
        // session query optional
      }

      // Insert all insights
      if (insights.length > 0) {
        await db.insert(logInsights).values(insights);
        log.info(
          { monitoredDbId, insightCount: insights.length },
          "Log insights collected"
        );
      } else {
        log.debug({ monitoredDbId }, "No log insights to report");
      }
    }
  } catch (err) {
    log.debug(
      { err, monitoredDbId },
      "Failed to collect log insights"
    );
  }
}
