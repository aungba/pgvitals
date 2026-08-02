import type { FastifyBaseLogger } from "fastify";
import { db, snapshots, sessionsSnapshot, rootCauseHints, alerts, queryStats, explainCaptures, indexRecommendations, tableBloatStats, dbHealthSnapshots, querySuggestions, tableSizeHistory, replicationSnapshots, logInsights, dbErrorStats } from "@pgvitals/db";
import { lt, and, isNotNull, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

/* ===================================================================
   Data Retention — purges old data beyond the retention window
   =================================================================== */

const DEFAULT_RETENTION_DAYS = 30;

/**
 * Purges data older than the retention period.
 * Runs as a scheduled job (daily).
 *
 * Deletes in order:
 * 1. sessions_snapshot (hypertable)
 * 2. snapshots (hypertable)
 * 3. root_cause_hints (regular table)
 * 4. resolved alerts (regular table, keeps active alerts)
 * 5. query_stats (hypertable)
 * 6. explain_captures (regular table)
 */
export async function purgeOldData(
  log: FastifyBaseLogger,
  retentionDays: number = DEFAULT_RETENTION_DAYS
): Promise<{ deletedSnapshots: number; deletedSessions: number; deletedHints: number; deletedAlerts: number; deletedQueryStats: number; deletedExplains: number; deletedIndexRecs: number; deletedBloatStats: number; deletedHealthSnapshots: number; deletedSuggestions: number; deletedSizeHistory: number; deletedReplicationSnapshots: number; deletedLogInsights: number; deletedErrorStats: number }> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);

  log.info(
    { retentionDays, cutoff: cutoff.toISOString() },
    "Starting data retention purge"
  );

  // 1. Delete old sessions_snapshot rows
  const sessionsResult = await db
    .delete(sessionsSnapshot)
    .where(lt(sessionsSnapshot.timestamp, cutoff))
    .returning({ id: sessionsSnapshot.id });
  const deletedSessions = sessionsResult.length;

  // 2. Delete old snapshots
  const snapshotsResult = await db
    .delete(snapshots)
    .where(lt(snapshots.timestamp, cutoff))
    .returning({ id: snapshots.id });
  const deletedSnapshots = snapshotsResult.length;

  // 3. Delete old root_cause_hints
  const hintsResult = await db
    .delete(rootCauseHints)
    .where(lt(rootCauseHints.detectedAt, cutoff))
    .returning({ id: rootCauseHints.id });
  const deletedHints = hintsResult.length;

  // 4. Delete old RESOLVED alerts (keep active alerts regardless of age)
  const alertsResult = await db
    .delete(alerts)
    .where(
      and(
        lt(alerts.firedAt, cutoff),
        isNotNull(alerts.resolvedAt)
      )
    )
    .returning({ id: alerts.id });
  const deletedAlerts = alertsResult.length;

  // 5. Delete old query_stats
  const queryStatsResult = await db
    .delete(queryStats)
    .where(lt(queryStats.capturedAt, cutoff))
    .returning({ id: queryStats.id });
  const deletedQueryStats = queryStatsResult.length;

  // 6. Delete old explain_captures
  const explainsResult = await db
    .delete(explainCaptures)
    .where(lt(explainCaptures.capturedAt, cutoff))
    .returning({ id: explainCaptures.id });
  const deletedExplains = explainsResult.length;

  // 7. Delete old dismissed index_recommendations
  const indexRecsResult = await db
    .delete(indexRecommendations)
    .where(
      and(
        lt(indexRecommendations.detectedAt, cutoff),
        eq(indexRecommendations.dismissed, true)
      )
    )
    .returning({ id: indexRecommendations.id });
  const deletedIndexRecs = indexRecsResult.length;

  // 8. Delete old table_bloat_stats
  const bloatResult = await db
    .delete(tableBloatStats)
    .where(lt(tableBloatStats.capturedAt, cutoff))
    .returning({ id: tableBloatStats.id });
  const deletedBloatStats = bloatResult.length;

  // 9. Delete old db_health_snapshots
  const healthResult = await db
    .delete(dbHealthSnapshots)
    .where(lt(dbHealthSnapshots.capturedAt, cutoff))
    .returning({ id: dbHealthSnapshots.id });
  const deletedHealthSnapshots = healthResult.length;

  // 10. Delete old dismissed query_suggestions
  const suggestionsResult = await db
    .delete(querySuggestions)
    .where(
      and(
        lt(querySuggestions.detectedAt, cutoff),
        eq(querySuggestions.dismissed, true)
      )
    )
    .returning({ id: querySuggestions.id });
  const deletedSuggestions = suggestionsResult.length;

  // 11. Delete old table_size_history
  const sizeHistoryResult = await db
    .delete(tableSizeHistory)
    .where(lt(tableSizeHistory.capturedAt, cutoff))
    .returning({ id: tableSizeHistory.id });
  const deletedSizeHistory = sizeHistoryResult.length;

  // 12. Delete old replication_snapshots
  const replicationResult = await db
    .delete(replicationSnapshots)
    .where(lt(replicationSnapshots.capturedAt, cutoff))
    .returning({ id: replicationSnapshots.id });
  const deletedReplicationSnapshots = replicationResult.length;

  // 13. Delete old log_insights
  const logInsightsResult = await db
    .delete(logInsights)
    .where(lt(logInsights.capturedAt, cutoff))
    .returning({ id: logInsights.id });
  const deletedLogInsights = logInsightsResult.length;

  // 14. Delete old db_error_stats
  const errorStatsResult = await db
    .delete(dbErrorStats)
    .where(lt(dbErrorStats.capturedAt, cutoff))
    .returning({ id: dbErrorStats.id });
  const deletedErrorStats = errorStatsResult.length;

  log.info(
    { deletedSnapshots, deletedSessions, deletedHints, deletedAlerts, deletedQueryStats, deletedExplains, deletedIndexRecs, deletedBloatStats, deletedHealthSnapshots, deletedSuggestions, deletedSizeHistory, deletedReplicationSnapshots, deletedLogInsights, deletedErrorStats },
    "Data retention purge complete"
  );

  return { deletedSnapshots, deletedSessions, deletedHints, deletedAlerts, deletedQueryStats, deletedExplains, deletedIndexRecs, deletedBloatStats, deletedHealthSnapshots, deletedSuggestions, deletedSizeHistory, deletedReplicationSnapshots, deletedLogInsights, deletedErrorStats };
}

