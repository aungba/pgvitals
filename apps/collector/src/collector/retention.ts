import type { FastifyBaseLogger } from "fastify";
import { db, snapshots, sessionsSnapshot, rootCauseHints, alerts, queryStats, explainCaptures, indexRecommendations, tableBloatStats, dbHealthSnapshots, querySuggestions, tableSizeHistory, replicationSnapshots, logInsights, dbErrorStats, monitoredDatabases, organizations, queryPlanSnapshots, poolerSnapshots, schemaEvents, schemaSnapshots } from "@pgvitals/db";
import { lt, and, isNotNull, eq, inArray } from "drizzle-orm";

/* ===================================================================
   Data Retention — purges old data beyond the retention window.
   Respects per-org plan tiers: Free=24h, Pro=30d, Team=90d.
   =================================================================== */

/** Retention days per plan tier (spec: Free=24h, Pro=30d, Team=90d) */
const RETENTION_BY_TIER: Record<string, number> = {
  free: 1,
  pro: 30,
  team: 90,
};
const DEFAULT_RETENTION_DAYS = 30;

/**
 * Builds a map of monitoredDbId → retentionDays based on the org's plan tier.
 */
async function buildRetentionMap(
  log: FastifyBaseLogger
): Promise<Map<string, number>> {
  const retentionMap = new Map<string, number>();

  try {
    const rows = await db
      .select({
        dbId: monitoredDatabases.id,
        planTier: organizations.planTier,
      })
      .from(monitoredDatabases)
      .innerJoin(organizations, eq(monitoredDatabases.orgId, organizations.id));

    for (const row of rows) {
      retentionMap.set(row.dbId, RETENTION_BY_TIER[row.planTier] ?? DEFAULT_RETENTION_DAYS);
    }
  } catch (err) {
    log.warn({ err }, "Failed to build retention map, falling back to default retention");
  }

  return retentionMap;
}

/** Groups cutoff entries by their cutoff date to batch deletes */
function groupCutoffs(cutoffByDb: Map<string, Date>): Map<number, { cutoff: Date; dbIds: string[] }> {
  const groups = new Map<number, { cutoff: Date; dbIds: string[] }>();
  for (const [dbId, cutoff] of cutoffByDb) {
    const key = cutoff.getTime();
    if (!groups.has(key)) {
      groups.set(key, { cutoff, dbIds: [] });
    }
    groups.get(key)!.dbIds.push(dbId);
  }
  return groups;
}

/**
 * Purges data older than the retention period, respecting plan tier.
 * Runs as a scheduled job (daily).
 *
 * Deletes in order:
 * 1. sessions_snapshot (hypertable)
 * 2. snapshots (hypertable)
 * 3. root_cause_hints (regular table)
 * 4. resolved alerts (regular table, keeps active alerts)
 * 5. query_stats (hypertable)
 * 6. explain_captures (regular table)
 * 7–14. index_recommendations, table_bloat_stats, db_health_snapshots,
 *        query_suggestions, table_size_history, replication_snapshots,
 *        log_insights, db_error_stats
 */
export async function purgeOldData(
  log: FastifyBaseLogger,
  retentionDaysOverride?: number
): Promise<{ deletedSnapshots: number; deletedSessions: number; deletedHints: number; deletedAlerts: number; deletedQueryStats: number; deletedExplains: number; deletedIndexRecs: number; deletedBloatStats: number; deletedHealthSnapshots: number; deletedSuggestions: number; deletedSizeHistory: number; deletedReplicationSnapshots: number; deletedLogInsights: number; deletedErrorStats: number; deletedPlanSnapshots: number; deletedPoolerSnapshots: number; deletedSchemaEvents: number; deletedSchemaSnaps: number }> {
  // Build per-database retention map from plan tiers
  const retentionMap = retentionDaysOverride != null
    ? new Map<string, number>() // unused when override is set
    : await buildRetentionMap(log);

  const defaultDays = retentionDaysOverride ?? DEFAULT_RETENTION_DAYS;
  const defaultCutoff = new Date();
  defaultCutoff.setDate(defaultCutoff.getDate() - defaultDays);

  log.info(
    { defaultRetentionDays: defaultDays, dbSpecificRetentions: retentionMap.size },
    "Starting data retention purge"
  );

  // Group databases by their retention cutoff to batch deletes
  const cutoffByDb = new Map<string, Date>();
  for (const [dbId, days] of retentionMap) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    cutoffByDb.set(dbId, cutoff);
  }

  /**
   * Helper: delete old rows from a table with monitoredDbId, respecting per-DB retention.
   */
  async function purgeMonitoredTable(
    table: never,
    timestampCol: never,
    idCol: never,
    monitoredDbIdCol: never
  ): Promise<number> {
    if (retentionDaysOverride != null || retentionMap.size === 0) {
      const result = await db
        .delete(table)
        .where(lt(timestampCol, defaultCutoff))
        .returning({ id: idCol });
      return result.length;
    }

    let totalDeleted = 0;
    for (const { cutoff, dbIds } of groupCutoffs(cutoffByDb).values()) {
      const result = await db
        .delete(table)
        .where(
          and(
            lt(timestampCol, cutoff),
            inArray(monitoredDbIdCol, dbIds)
          )
        )
        .returning({ id: idCol });
      totalDeleted += result.length;
    }
    return totalDeleted;
  }

  // 1. Delete old sessions_snapshot rows
  const deletedSessions = await purgeMonitoredTable(
    sessionsSnapshot as never, sessionsSnapshot.timestamp as never,
    sessionsSnapshot.id as never, sessionsSnapshot.monitoredDbId as never
  );

  // 2. Delete old snapshots
  const deletedSnapshots = await purgeMonitoredTable(
    snapshots as never, snapshots.timestamp as never,
    snapshots.id as never, snapshots.monitoredDbId as never
  );

  // 3. Delete old root_cause_hints
  const deletedHints = await purgeMonitoredTable(
    rootCauseHints as never, rootCauseHints.detectedAt as never,
    rootCauseHints.id as never, rootCauseHints.monitoredDbId as never
  );

  // 4. Delete old RESOLVED alerts (keep active alerts regardless of age)
  let deletedAlerts = 0;
  if (retentionDaysOverride != null || retentionMap.size === 0) {
    const alertsResult = await db
      .delete(alerts)
      .where(and(lt(alerts.firedAt, defaultCutoff), isNotNull(alerts.resolvedAt)))
      .returning({ id: alerts.id });
    deletedAlerts = alertsResult.length;
  } else {
    for (const { cutoff, dbIds } of groupCutoffs(cutoffByDb).values()) {
      const result = await db
        .delete(alerts)
        .where(and(lt(alerts.firedAt, cutoff), isNotNull(alerts.resolvedAt), inArray(alerts.monitoredDbId, dbIds)))
        .returning({ id: alerts.id });
      deletedAlerts += result.length;
    }
  }

  // 5. Delete old query_stats
  const deletedQueryStats = await purgeMonitoredTable(
    queryStats as never, queryStats.capturedAt as never,
    queryStats.id as never, queryStats.monitoredDbId as never
  );

  // 6. Delete old explain_captures
  const deletedExplains = await purgeMonitoredTable(
    explainCaptures as never, explainCaptures.capturedAt as never,
    explainCaptures.id as never, explainCaptures.monitoredDbId as never
  );

  // 7. Delete old dismissed index_recommendations
  let deletedIndexRecs = 0;
  if (retentionDaysOverride != null || retentionMap.size === 0) {
    const r = await db.delete(indexRecommendations)
      .where(and(lt(indexRecommendations.detectedAt, defaultCutoff), eq(indexRecommendations.dismissed, true)))
      .returning({ id: indexRecommendations.id });
    deletedIndexRecs = r.length;
  } else {
    for (const { cutoff, dbIds } of groupCutoffs(cutoffByDb).values()) {
      const r = await db.delete(indexRecommendations)
        .where(and(lt(indexRecommendations.detectedAt, cutoff), eq(indexRecommendations.dismissed, true), inArray(indexRecommendations.monitoredDbId, dbIds)))
        .returning({ id: indexRecommendations.id });
      deletedIndexRecs += r.length;
    }
  }

  // 8. Delete old table_bloat_stats
  const deletedBloatStats = await purgeMonitoredTable(
    tableBloatStats as never, tableBloatStats.capturedAt as never,
    tableBloatStats.id as never, tableBloatStats.monitoredDbId as never
  );

  // 9. Delete old db_health_snapshots
  const deletedHealthSnapshots = await purgeMonitoredTable(
    dbHealthSnapshots as never, dbHealthSnapshots.capturedAt as never,
    dbHealthSnapshots.id as never, dbHealthSnapshots.monitoredDbId as never
  );

  // 10. Delete old dismissed query_suggestions
  let deletedSuggestions = 0;
  if (retentionDaysOverride != null || retentionMap.size === 0) {
    const r = await db.delete(querySuggestions)
      .where(and(lt(querySuggestions.detectedAt, defaultCutoff), eq(querySuggestions.dismissed, true)))
      .returning({ id: querySuggestions.id });
    deletedSuggestions = r.length;
  } else {
    for (const { cutoff, dbIds } of groupCutoffs(cutoffByDb).values()) {
      const r = await db.delete(querySuggestions)
        .where(and(lt(querySuggestions.detectedAt, cutoff), eq(querySuggestions.dismissed, true), inArray(querySuggestions.monitoredDbId, dbIds)))
        .returning({ id: querySuggestions.id });
      deletedSuggestions += r.length;
    }
  }

  // 11. Delete old table_size_history
  const deletedSizeHistory = await purgeMonitoredTable(
    tableSizeHistory as never, tableSizeHistory.capturedAt as never,
    tableSizeHistory.id as never, tableSizeHistory.monitoredDbId as never
  );

  // 12. Delete old replication_snapshots
  const deletedReplicationSnapshots = await purgeMonitoredTable(
    replicationSnapshots as never, replicationSnapshots.capturedAt as never,
    replicationSnapshots.id as never, replicationSnapshots.monitoredDbId as never
  );

  // 13. Delete old log_insights
  const deletedLogInsights = await purgeMonitoredTable(
    logInsights as never, logInsights.capturedAt as never,
    logInsights.id as never, logInsights.monitoredDbId as never
  );

  // 14. Delete old db_error_stats
  const deletedErrorStats = await purgeMonitoredTable(
    dbErrorStats as never, dbErrorStats.capturedAt as never,
    dbErrorStats.id as never, dbErrorStats.monitoredDbId as never
  );

  // 15. Delete old query_plan_snapshots
  const deletedPlanSnapshots = await purgeMonitoredTable(
    queryPlanSnapshots as never, queryPlanSnapshots.capturedAt as never,
    queryPlanSnapshots.id as never, queryPlanSnapshots.monitoredDbId as never
  );

  // 16. Delete old pooler_snapshots
  const deletedPoolerSnapshots = await purgeMonitoredTable(
    poolerSnapshots as never, poolerSnapshots.capturedAt as never,
    poolerSnapshots.id as never, poolerSnapshots.monitoredDbId as never
  );

  // 17. Delete old schema_events
  const deletedSchemaEvents = await purgeMonitoredTable(
    schemaEvents as never, schemaEvents.detectedAt as never,
    schemaEvents.id as never, schemaEvents.monitoredDbId as never
  );

  // 18. Delete old schema_snapshots
  const deletedSchemaSnaps = await purgeMonitoredTable(
    schemaSnapshots as never, schemaSnapshots.capturedAt as never,
    schemaSnapshots.id as never, schemaSnapshots.monitoredDbId as never
  );

  log.info(
    { deletedSnapshots, deletedSessions, deletedHints, deletedAlerts, deletedQueryStats, deletedExplains, deletedIndexRecs, deletedBloatStats, deletedHealthSnapshots, deletedSuggestions, deletedSizeHistory, deletedReplicationSnapshots, deletedLogInsights, deletedErrorStats, deletedPlanSnapshots, deletedPoolerSnapshots, deletedSchemaEvents, deletedSchemaSnaps },
    "Data retention purge complete"
  );

  return { deletedSnapshots, deletedSessions, deletedHints, deletedAlerts, deletedQueryStats, deletedExplains, deletedIndexRecs, deletedBloatStats, deletedHealthSnapshots, deletedSuggestions, deletedSizeHistory, deletedReplicationSnapshots, deletedLogInsights, deletedErrorStats, deletedPlanSnapshots, deletedPoolerSnapshots, deletedSchemaEvents, deletedSchemaSnaps };
}
