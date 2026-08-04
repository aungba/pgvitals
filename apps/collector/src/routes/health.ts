import type { FastifyInstance } from "fastify";
import { db, tableBloatStats, dbHealthSnapshots, tableSizeHistory, monitoredDatabases } from "@pgvitals/db";
import { eq, desc, and, gte } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth.js";
import { requireFeature } from "../middleware/plan-limits.js";

/* ===================================================================
   VACUUM & Health Routes — Phase 6
   =================================================================== */

/**
 * Verifies that the given database belongs to the given organization.
 */
async function verifyDbOwnership(dbId: string, orgId: string): Promise<boolean> {
  const [mdb] = await db
    .select({ id: monitoredDatabases.id })
    .from(monitoredDatabases)
    .where(and(eq(monitoredDatabases.id, dbId), eq(monitoredDatabases.orgId, orgId)))
    .limit(1);
  return !!mdb;
}

export default async function healthRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/databases/:id/vacuum-stats
   * Latest table bloat stats for a database.
   */
  app.get<{ Params: { id: string } }>(
    "/api/databases/:id/vacuum-stats",
    { preHandler: [authMiddleware, requireFeature('vacuumAdvisorEnabled')] },
    async (request, reply) => {
      try {
        const { id } = request.params;

        // Verify database belongs to this org
        if (!await verifyDbOwnership(id, request.auth.orgId)) {
          return reply.status(404).send({ error: "Database not found" });
        }

        // Get latest captured_at
        const [latest] = await db
          .select({ capturedAt: tableBloatStats.capturedAt })
          .from(tableBloatStats)
          .where(eq(tableBloatStats.monitoredDbId, id))
          .orderBy(desc(tableBloatStats.capturedAt))
          .limit(1);

        if (!latest) {
          return reply.send({ tables: [], capturedAt: null });
        }

        const tables = await db
          .select()
          .from(tableBloatStats)
          .where(
            and(
              eq(tableBloatStats.monitoredDbId, id),
              eq(tableBloatStats.capturedAt, latest.capturedAt)
            )
          )
          .orderBy(desc(tableBloatStats.deadTupRatio));

        return reply.send({
          tables: tables.map(serializeBloatRow),
          capturedAt: latest.capturedAt.toISOString(),
        });
      } catch (err) {
        request.log.error({ err }, "Failed to get vacuum stats");
        return reply.status(500).send({ error: "Failed to get vacuum stats" });
      }
    }
  );

  /**
   * GET /api/databases/:id/health
   * Latest database health snapshot + 24h history.
   */
  app.get<{ Params: { id: string } }>(
    "/api/databases/:id/health",
    { preHandler: [authMiddleware, requireFeature('vacuumAdvisorEnabled')] },
    async (request, reply) => {
      try {
        const { id } = request.params;

        // Verify database belongs to this org
        if (!await verifyDbOwnership(id, request.auth.orgId)) {
          return reply.status(404).send({ error: "Database not found" });
        }

        // Latest snapshot
        const [latest] = await db
          .select()
          .from(dbHealthSnapshots)
          .where(eq(dbHealthSnapshots.monitoredDbId, id))
          .orderBy(desc(dbHealthSnapshots.capturedAt))
          .limit(1);

        // 24h history
        const since = new Date();
        since.setHours(since.getHours() - 24);

        const history = await db
          .select()
          .from(dbHealthSnapshots)
          .where(
            and(
              eq(dbHealthSnapshots.monitoredDbId, id),
              gte(dbHealthSnapshots.capturedAt, since)
            )
          )
          .orderBy(dbHealthSnapshots.capturedAt);

        return reply.send({
          current: latest ? serializeHealthRow(latest) : null,
          history: history.map(serializeHealthRow),
        });
      } catch (err) {
        request.log.error({ err }, "Failed to get health stats");
        return reply.status(500).send({ error: "Failed to get health stats" });
      }
    }
  );

  /**
   * GET /api/databases/:id/cache-hit
   * Per-table cache hit ratios from latest bloat stats snapshot.
   */
  app.get<{ Params: { id: string } }>(
    "/api/databases/:id/cache-hit",
    { preHandler: [authMiddleware, requireFeature('vacuumAdvisorEnabled')] },
    async (request, reply) => {
      try {
        const { id } = request.params;

        if (!await verifyDbOwnership(id, request.auth.orgId)) {
          return reply.status(404).send({ error: "Database not found" });
        }

        const [latest] = await db
          .select({ capturedAt: tableBloatStats.capturedAt })
          .from(tableBloatStats)
          .where(eq(tableBloatStats.monitoredDbId, id))
          .orderBy(desc(tableBloatStats.capturedAt))
          .limit(1);

        if (!latest) {
          return reply.send({ tables: [], capturedAt: null });
        }

        const tables = await db
          .select({
            tableName: tableBloatStats.tableName,
            cacheHitRatio: tableBloatStats.cacheHitRatio,
            idxCacheHitRatio: tableBloatStats.idxCacheHitRatio,
            totalSizeBytes: tableBloatStats.totalSizeBytes,
          })
          .from(tableBloatStats)
          .where(
            and(
              eq(tableBloatStats.monitoredDbId, id),
              eq(tableBloatStats.capturedAt, latest.capturedAt)
            )
          )
          .orderBy(tableBloatStats.totalSizeBytes);

        return reply.send({
          tables: tables.map((t) => ({
            tableName: t.tableName,
            cacheHitRatio: t.cacheHitRatio,
            idxCacheHitRatio: t.idxCacheHitRatio,
            totalSizeBytes: t.totalSizeBytes,
          })),
          capturedAt: latest.capturedAt.toISOString(),
        });
      } catch (err) {
        request.log.error({ err }, "Failed to get cache hit stats");
        return reply.status(500).send({ error: "Failed to get cache hit stats" });
      }
    }
  );

  /**
   * GET /api/databases/:id/disk-growth
   * Table size history and growth projections.
   */
  app.get<{ Params: { id: string } }>(
    "/api/databases/:id/disk-growth",
    { preHandler: [authMiddleware, requireFeature('vacuumAdvisorEnabled')] },
    async (request, reply) => {
      try {
        const { id } = request.params;

        if (!await verifyDbOwnership(id, request.auth.orgId)) {
          return reply.status(404).send({ error: "Database not found" });
        }

        // Get latest entry per table
        const [latest] = await db
          .select({ capturedAt: tableSizeHistory.capturedAt })
          .from(tableSizeHistory)
          .where(eq(tableSizeHistory.monitoredDbId, id))
          .orderBy(desc(tableSizeHistory.capturedAt))
          .limit(1);

        if (!latest) {
          return reply.send({ tables: [], history: [], capturedAt: null });
        }

        const tables = await db
          .select()
          .from(tableSizeHistory)
          .where(
            and(
              eq(tableSizeHistory.monitoredDbId, id),
              eq(tableSizeHistory.capturedAt, latest.capturedAt)
            )
          )
          .orderBy(desc(tableSizeHistory.totalSizeBytes));

        // 30-day history for trend charts
        const since = new Date();
        since.setDate(since.getDate() - 30);

        const history = await db
          .select()
          .from(tableSizeHistory)
          .where(
            and(
              eq(tableSizeHistory.monitoredDbId, id),
              gte(tableSizeHistory.capturedAt, since)
            )
          )
          .orderBy(tableSizeHistory.capturedAt);

        return reply.send({
          tables: tables.map((t) => ({
            tableName: t.tableName,
            schemaName: t.schemaName,
            tableSizeBytes: t.tableSizeBytes,
            indexSizeBytes: t.indexSizeBytes,
            totalSizeBytes: t.totalSizeBytes,
            growthRateBytesPerDay: t.growthRateBytesPerDay,
            projectedDaysToDiskLimit: t.projectedDaysToDiskLimit,
            capturedAt: t.capturedAt.toISOString(),
          })),
          history: history.map((t) => ({
            tableName: t.tableName,
            totalSizeBytes: t.totalSizeBytes,
            capturedAt: t.capturedAt.toISOString(),
          })),
          capturedAt: latest.capturedAt.toISOString(),
        });
      } catch (err) {
        request.log.error({ err }, "Failed to get disk growth data");
        return reply.status(500).send({ error: "Failed to get disk growth data" });
      }
    }
  );
}

function serializeBloatRow(row: typeof tableBloatStats.$inferSelect) {
  return {
    id: row.id,
    tableName: row.tableName,
    schemaName: row.schemaName,
    nLiveTup: row.nLiveTup,
    nDeadTup: row.nDeadTup,
    deadTupRatio: row.deadTupRatio,
    tableSizeBytes: row.tableSizeBytes,
    totalSizeBytes: row.totalSizeBytes,
    lastVacuum: row.lastVacuum?.toISOString() ?? null,
    lastAutovacuum: row.lastAutovacuum?.toISOString() ?? null,
    lastAnalyze: row.lastAnalyze?.toISOString() ?? null,
    lastAutoanalyze: row.lastAutoanalyze?.toISOString() ?? null,
    vacuumCount: row.vacuumCount,
    autovacuumCount: row.autovacuumCount,
    seqScan: row.seqScan,
    idxScan: row.idxScan,
    cacheHitRatio: row.cacheHitRatio,
    idxCacheHitRatio: row.idxCacheHitRatio,
    estimatedBloatBytes: row.estimatedBloatBytes ?? null,
    estimatedBloatPct: row.estimatedBloatPct ?? null,
    capturedAt: row.capturedAt.toISOString(),
    // Per-table VACUUM guidance (computed, not stored)
    vacuumGuidance: generateVacuumGuidance(row),
  };
}

/**
 * Generates per-table VACUUM guidance based on current stats.
 * Returns null if the table looks healthy.
 */
function generateVacuumGuidance(row: typeof tableBloatStats.$inferSelect): {
  severity: "info" | "warning" | "critical";
  action: string;
  reason: string;
} | null {
  const deadRatio = row.deadTupRatio;
  const bloatPct = row.estimatedBloatPct ?? 0;
  const lastVacuumAt = row.lastVacuum ?? row.lastAutovacuum;
  const hoursSinceVacuum = lastVacuumAt
    ? (Date.now() - lastVacuumAt.getTime()) / (1000 * 60 * 60)
    : null;

  // Critical: very high dead tuple ratio or massive bloat
  if (deadRatio > 30 || bloatPct > 50) {
    const tableFull = `${row.schemaName}.${row.tableName}`;
    return {
      severity: "critical",
      action: `VACUUM (VERBOSE) ${tableFull};`,
      reason: deadRatio > 30
        ? `${deadRatio.toFixed(1)}% dead tuples — autovacuum may be blocked or too slow. Manual VACUUM recommended.`
        : `~${bloatPct.toFixed(0)}% estimated bloat. Run VACUUM FULL (requires downtime) or pg_repack to reclaim space.`,
    };
  }

  // Warning: elevated dead tuples or no vacuum in a long time
  if (deadRatio > 10 || (hoursSinceVacuum != null && hoursSinceVacuum > 168)) {
    const tableFull = `${row.schemaName}.${row.tableName}`;
    if (hoursSinceVacuum != null && hoursSinceVacuum > 168) {
      return {
        severity: "warning",
        action: `VACUUM ANALYZE ${tableFull};`,
        reason: `No vacuum in ${Math.round(hoursSinceVacuum / 24)} days. Run VACUUM ANALYZE to update statistics and reclaim space.`,
      };
    }
    return {
      severity: "warning",
      action: `VACUUM ANALYZE ${tableFull};`,
      reason: `${deadRatio.toFixed(1)}% dead tuples. Consider running VACUUM ANALYZE to keep query planner statistics fresh.`,
    };
  }

  // Info: moderate bloat worth noting
  if (bloatPct > 20) {
    const tableFull = `${row.schemaName}.${row.tableName}`;
    return {
      severity: "info",
      action: `VACUUM ${tableFull};`,
      reason: `~${bloatPct.toFixed(0)}% estimated bloat. Standard VACUUM may help; VACUUM FULL or pg_repack would be more effective but requires downtime.`,
    };
  }

  return null;
}

function serializeHealthRow(row: typeof dbHealthSnapshots.$inferSelect) {
  return {
    id: row.id,
    capturedAt: row.capturedAt.toISOString(),
    cacheHitRatio: row.cacheHitRatio,
    checkpointsRequested: row.checkpointsRequested,
    checkpointsTimed: row.checkpointsTimed,
    buffersCheckpoint: row.buffersCheckpoint,
    buffersBackend: row.buffersBackend,
    dbSizeBytes: row.dbSizeBytes,
    numBackends: row.numBackends,
    xactCommit: row.xactCommit,
    xactRollback: row.xactRollback,
    conflictsCount: row.conflictsCount,
    deadlocksCount: row.deadlocksCount,
    tempFileBytes: row.tempFileBytes,
    xidAge: row.xidAge,
    autovacuumFreezeMaxAge: row.autovacuumFreezeMaxAge,
    xidPercentUsed: row.xidPercentUsed,
  };
}
