import type { FastifyInstance } from "fastify";
import {
  db,
  tableBloatStats,
  dbHealthSnapshots,
  tableSizeHistory,
  autovacuumStarvationEvents,
  monitoredDatabases,
} from "@pgvitals/db";
import { eq, desc, and, gte } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth.js";
import { requireFeature } from "../middleware/plan-limits.js";
import { decrypt } from "../lib/encryption.js";
import { safeQuery } from "../lib/safe-query.js";
import { config } from "../config.js";

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

  /**
   * GET /api/databases/:id/xid-per-table
   * Live query: per-table XID ages from pg_class.relfrozenxid.
   * Returns tables sorted by oldest XID age first.
   */
  app.get<{ Params: { id: string } }>(
    "/api/databases/:id/xid-per-table",
    { preHandler: [authMiddleware, requireFeature('vacuumAdvisorEnabled')] },
    async (request, reply) => {
      try {
        const { id } = request.params;

        if (!await verifyDbOwnership(id, request.auth.orgId)) {
          return reply.status(404).send({ error: "Database not found" });
        }

        const [mdb] = await db
          .select()
          .from(monitoredDatabases)
          .where(eq(monitoredDatabases.id, id))
          .limit(1);

        if (!mdb) {
          return reply.status(404).send({ error: "Database not found" });
        }

        const connectionString = decrypt(mdb.connectionStringEncrypted, config.encryptionKey);

        interface TableXidRow {
          schemaname: string;
          relname: string;
          xid_age: string;
          table_size: string;
          last_vacuum: string | null;
          last_autovacuum: string | null;
        }

        const rows = await safeQuery<TableXidRow[]>(
          connectionString,
          `SELECT
            n.nspname AS schemaname,
            c.relname,
            age(c.relfrozenxid)::text AS xid_age,
            pg_total_relation_size(c.oid)::text AS table_size,
            s.last_vacuum::text,
            s.last_autovacuum::text
          FROM pg_class c
          JOIN pg_namespace n ON c.relnamespace = n.oid
          LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
          WHERE c.relkind = 'r'
            AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
            AND c.relname NOT LIKE '_hyper_%'
            AND c.relname NOT LIKE '_timescaledb_%'
          ORDER BY age(c.relfrozenxid) DESC
          LIMIT 50`,
          { timeoutMs: 10000 }
        );

        // Also get the freeze threshold
        const [freezeRow] = await safeQuery<Array<{ autovacuum_freeze_max_age: string }>>(
          connectionString,
          `SHOW autovacuum_freeze_max_age`,
          { timeoutMs: 3000 }
        );
        const freezeMaxAge = freezeRow ? parseInt(freezeRow.autovacuum_freeze_max_age, 10) : 200000000;

        return reply.send({
          freezeMaxAge,
          tables: rows.map((r) => {
            const xidAge = parseInt(r.xid_age, 10) || 0;
            const tableSize = parseInt(r.table_size, 10) || 0;
            return {
              schemaName: r.schemaname,
              tableName: r.relname,
              xidAge,
              xidPercent: freezeMaxAge > 0 ? Math.round((xidAge / freezeMaxAge) * 10000) / 100 : 0,
              tableSize,
              lastVacuum: r.last_vacuum,
              lastAutovacuum: r.last_autovacuum,
            };
          }),
        });
      } catch (err) {
        request.log.error({ err }, "Failed to get per-table XID ages");
        return reply.status(500).send({ error: "Failed to get per-table XID ages" });
      }
    }
  );

  /**
   * GET /api/databases/:id/autovacuum/starvation
   * Returns worker pool saturation status, active/max workers, and starved candidate tables.
   * Spec §5 & §7
   */
  app.get<{ Params: { id: string } }>(
    "/api/databases/:id/autovacuum/starvation",
    { preHandler: [authMiddleware, requireFeature("vacuumAdvisorEnabled")] },
    async (request, reply) => {
      try {
        const { id } = request.params;

        if (!(await verifyDbOwnership(id, request.auth.orgId))) {
          return reply.status(404).send({ error: "Database not found" });
        }

        const [mdb] = await db
          .select()
          .from(monitoredDatabases)
          .where(eq(monitoredDatabases.id, id))
          .limit(1);

        if (!mdb) {
          return reply.status(404).send({ error: "Database not found" });
        }

        const connectionString = decrypt(
          mdb.connectionStringEncrypted,
          config.encryptionKey
        );

        const STARVATION_QUERY = `
        WITH worker_stats AS (
          SELECT 
            count(*)::int AS active_workers,
            current_setting('autovacuum_max_workers')::int AS max_workers
          FROM pg_stat_activity 
          WHERE query ~* '^autovacuum:'
        ),
        starved_candidates AS (
          SELECT 
            schemaname,
            relname,
            n_live_tup,
            n_dead_tup,
            ROUND((n_dead_tup::numeric / NULLIF(n_live_tup + n_dead_tup, 0)) * 100, 2) AS dead_tuple_pct,
            last_vacuum,
            last_autovacuum,
            vacuum_count,
            autovacuum_count
          FROM pg_stat_user_tables
          WHERE schemaname = 'public'
            AND relname NOT LIKE '_hyper_%'
            AND relname NOT LIKE '_timescaledb_%'
            AND n_dead_tup > 10000 
            AND (n_dead_tup::numeric / NULLIF(n_live_tup + n_dead_tup, 0)) > 0.20
        )
        SELECT 
          sc.schemaname,
          sc.relname,
          sc.n_live_tup::text AS n_live_tup,
          sc.n_dead_tup::text AS n_dead_tup,
          sc.dead_tuple_pct::text AS dead_tuple_pct,
          sc.last_vacuum::text,
          sc.last_autovacuum::text,
          sc.vacuum_count::text,
          sc.autovacuum_count::text,
          ws.active_workers,
          ws.max_workers,
          (ws.active_workers >= ws.max_workers) AS is_worker_saturated
        FROM starved_candidates sc, worker_stats ws
        ORDER BY sc.n_dead_tup DESC;
        `;

        interface StarvationRow {
          schemaname: string;
          relname: string;
          n_live_tup: string;
          n_dead_tup: string;
          dead_tuple_pct: string;
          last_vacuum: string | null;
          last_autovacuum: string | null;
          vacuum_count: string;
          autovacuum_count: string;
          active_workers: number;
          max_workers: number;
          is_worker_saturated: boolean;
        }

        let starvedRows: StarvationRow[] = [];
        let activeWorkers = 0;
        let maxWorkers = 3;
        let isWorkerSaturated = false;

        try {
          starvedRows = await safeQuery<StarvationRow[]>(
            connectionString,
            STARVATION_QUERY,
            { timeoutMs: 10000 }
          );
          if (starvedRows.length > 0) {
            activeWorkers = starvedRows[0].active_workers;
            maxWorkers = starvedRows[0].max_workers;
            isWorkerSaturated = starvedRows[0].is_worker_saturated;
          } else {
            // Check worker count even if no starved tables
            const [workerStats] = await safeQuery<
              Array<{ active_workers: number; max_workers: number }>
            >(
              connectionString,
              `SELECT 
                count(*)::int AS active_workers,
                current_setting('autovacuum_max_workers')::int AS max_workers
              FROM pg_stat_activity 
              WHERE query ~* '^autovacuum:'`,
              { timeoutMs: 5000 }
            );
            if (workerStats) {
              activeWorkers = workerStats.active_workers;
              maxWorkers = workerStats.max_workers;
              isWorkerSaturated = activeWorkers >= maxWorkers;
            }
          }
        } catch (err) {
          request.log.debug({ err, id }, "Failed to execute starvation query live");
        }

        // Fetch recent recorded events from autovacuum_starvation_events table
        const recentEvents = await db
          .select()
          .from(autovacuumStarvationEvents)
          .where(eq(autovacuumStarvationEvents.monitoredDbId, id))
          .orderBy(desc(autovacuumStarvationEvents.capturedAt))
          .limit(20);

        return reply.send({
          activeWorkers,
          maxWorkers,
          isWorkerSaturated,
          starvedTables: starvedRows.map((r) => {
            const deadTuples = parseInt(r.n_dead_tup, 10) || 0;
            const liveTuples = parseInt(r.n_live_tup, 10) || 0;
            const deadRatio = parseFloat(r.dead_tuple_pct || "0");
            return {
              schemaName: r.schemaname,
              tableName: r.relname,
              deadTuples,
              liveTuples,
              deadTupleRatio: deadRatio,
              lastVacuum: r.last_vacuum,
              lastAutovacuum: r.last_autovacuum,
              vacuumCount: parseInt(r.vacuum_count, 10) || 0,
              autovacuumCount: parseInt(r.autovacuum_count, 10) || 0,
              suggestedAction: isWorkerSaturated
                ? `All ${maxWorkers} autovacuum workers are busy. Consider increasing autovacuum_max_workers or raising autovacuum_vacuum_cost_limit.`
                : `Table "${r.schemaname}.${r.relname}" has ${deadTuples.toLocaleString()} dead tuples (${deadRatio}%). Run manual VACUUM ANALYZE "${r.schemaname}"."${r.relname}".`,
            };
          }),
          recentEvents: recentEvents.map((e) => ({
            id: e.id,
            tableName: e.tableName,
            deadTuples: e.deadTuples,
            deadTupleRatio: e.deadTupleRatio,
            activeWorkers: e.activeWorkers,
            maxWorkers: e.maxWorkers,
            isWorkerSaturated: e.isWorkerSaturated,
            suggestedAction: e.suggestedAction,
            capturedAt: e.capturedAt.toISOString(),
          })),
        });
      } catch (err) {
        request.log.error({ err }, "Failed to get autovacuum starvation diagnostics");
        return reply.status(500).send({ error: "Failed to get autovacuum starvation diagnostics" });
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
