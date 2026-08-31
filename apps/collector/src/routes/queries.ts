import type { FastifyInstance } from "fastify";
import { db, queryStats, explainCaptures, querySuggestions, monitoredDatabases, queryPlanSnapshots } from "@pgvitals/db";
import { eq, and, desc, gte, sql, inArray } from "drizzle-orm";
import { decrypt } from "../lib/encryption.js";
import { safeQuery } from "../lib/safe-query.js";
import { config } from "../config.js";
import { checkPgStatStatements } from "../collector/query-stats-collector.js";
import { captureExplain } from "../collector/explain-capture.js";
import { estimatePercentiles } from "../collector/percentile-calculator.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { requireFeature } from "../middleware/plan-limits.js";
import { analyzePlanRegression } from "../collector/plan-regression-collector.js";

/* ===================================================================
   Query Performance Routes — Phase 4
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

export default async function queryRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/databases/:id/query-stats/status
   * Check if pg_stat_statements is available on the monitored database.
   */
  app.get<{ Params: { id: string } }>(
    "/api/databases/:id/query-stats/status",
    { preHandler: [authMiddleware, requireFeature('queryPerformanceEnabled')] },
    async (request, reply) => {
      try {
        const { id } = request.params;

        // Verify database belongs to this org
        if (!await verifyDbOwnership(id, request.auth.orgId)) {
          return reply.status(404).send({ error: "Database not found" });
        }

        const [monitoredDb] = await db
          .select()
          .from(monitoredDatabases)
          .where(eq(monitoredDatabases.id, id))
          .limit(1);

        if (!monitoredDb) {
          return reply.status(404).send({ error: "Database not found" });
        }

        const connectionString = decrypt(
          monitoredDb.connectionStringEncrypted,
          config.encryptionKey
        );

        const available = await checkPgStatStatements(connectionString);
        return reply.send({ available });
      } catch (err) {
        request.log.error({ err }, "Failed to check pg_stat_statements status");
        return reply.status(500).send({ error: "Failed to check extension status" });
      }
    }
  );

  /**
   * GET /api/databases/:id/queries
   * List top queries, sorted by total_time, calls, mean_time, rows, or temp_blks.
   */
  app.get<{
    Params: { id: string };
    Querystring: { sort?: string; limit?: string; offset?: string };
  }>(
    "/api/databases/:id/queries",
    { preHandler: [authMiddleware, requireFeature('queryPerformanceEnabled')] },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const sortBy = request.query.sort ?? "total_time";
        const limit = Math.min(parseInt(request.query.limit ?? "50", 10), 200);
        const offset = parseInt(request.query.offset ?? "0", 10);

        // Verify database belongs to this org
        if (!await verifyDbOwnership(id, request.auth.orgId)) {
          return reply.status(404).send({ error: "Database not found" });
        }

        // Get the latest captured_at timestamp for this database
        const [latestCapture] = await db
          .select({ capturedAt: queryStats.capturedAt })
          .from(queryStats)
          .where(eq(queryStats.monitoredDbId, id))
          .orderBy(desc(queryStats.capturedAt))
          .limit(1);

        if (!latestCapture) {
          return reply.send({ queries: [], latestCapturedAt: null });
        }

        // Get the latest stats for each query
        let orderByCol;
        switch (sortBy) {
          case "calls":
            orderByCol = desc(queryStats.calls);
            break;
          case "mean_time":
            orderByCol = desc(queryStats.meanTimeMs);
            break;
          case "rows":
            orderByCol = desc(queryStats.rowsReturned);
            break;
          case "temp_blks":
            orderByCol = desc(queryStats.tempBlksWritten);
            break;
          default: // total_time
            orderByCol = desc(queryStats.totalTimeMs);
        }

        const queries = await db
          .select()
          .from(queryStats)
          .where(
            and(
              eq(queryStats.monitoredDbId, id),
              eq(queryStats.capturedAt, latestCapture.capturedAt)
            )
          )
          .orderBy(orderByCol)
          .limit(limit)
          .offset(offset);

        // Compute 7-day trend: find closest snapshot from ~7 days ago
        const sevenDaysAgo = new Date(latestCapture.capturedAt.getTime() - 7 * 24 * 60 * 60 * 1000);
        let trendMap: Map<number, number> = new Map(); // queryid → old meanTimeMs

        try {
          // Find the closest captured_at to 7 days ago
          const [oldCapture] = await db
            .select({ capturedAt: queryStats.capturedAt })
            .from(queryStats)
            .where(
              and(
                eq(queryStats.monitoredDbId, id),
                gte(queryStats.capturedAt, sevenDaysAgo)
              )
            )
            .orderBy(queryStats.capturedAt)
            .limit(1);

          if (oldCapture && oldCapture.capturedAt.getTime() !== latestCapture.capturedAt.getTime()) {
            const oldStats = await db
              .select({
                queryid: queryStats.queryid,
                meanTimeMs: queryStats.meanTimeMs,
              })
              .from(queryStats)
              .where(
                and(
                  eq(queryStats.monitoredDbId, id),
                  eq(queryStats.capturedAt, oldCapture.capturedAt)
                )
              );

            for (const s of oldStats) {
              trendMap.set(s.queryid, s.meanTimeMs);
            }
          }
        } catch {
          // Non-critical — trends are optional
        }

        // Compute first_seen / last_seen per queryid from existing query_stats data
        const queryIds = queries.map((q) => q.queryid);
        const firstLastMap = new Map<number, { firstSeen: string; lastSeen: string }>();
        if (queryIds.length > 0) {
          try {
            const firstLastRows = await db
              .select({
                queryid: queryStats.queryid,
                firstSeen: sql<string>`MIN(${queryStats.capturedAt})::text`,
                lastSeen: sql<string>`MAX(${queryStats.capturedAt})::text`,
              })
              .from(queryStats)
              .where(
                and(
                  eq(queryStats.monitoredDbId, id),
                  inArray(queryStats.queryid, queryIds)
                )
              )
              .groupBy(queryStats.queryid);

            for (const row of firstLastRows) {
              firstLastMap.set(row.queryid, {
                firstSeen: row.firstSeen,
                lastSeen: row.lastSeen,
              });
            }
          } catch {
            // Non-critical — first/last seen are optional
          }
        }

        return reply.send({
          queries: queries.map((q) => {
            const serialized = serializeQueryStat(q);
            const oldMean = trendMap.get(q.queryid);
            let meanTimeTrend: number | null = null;
            if (oldMean != null && oldMean > 0) {
              meanTimeTrend = Math.round(((q.meanTimeMs - oldMean) / oldMean) * 1000) / 10; // e.g. 32.5 means +32.5%
            }
            const firstLast = firstLastMap.get(q.queryid);
            return {
              ...serialized,
              meanTimeTrend,
              firstSeen: firstLast?.firstSeen ?? null,
              lastSeen: firstLast?.lastSeen ?? null,
            };
          }),
          latestCapturedAt: latestCapture.capturedAt.toISOString(),
        });
      } catch (err) {
        request.log.error({ err }, "Failed to list queries");
        return reply.status(500).send({ error: "Failed to list queries" });
      }
    }
  );

  /**
   * GET /api/databases/:id/queries/:queryid
   * Get single query detail with time series data.
   */
  app.get<{ Params: { id: string; queryid: string } }>(
    "/api/databases/:id/queries/:queryid",
    { preHandler: [authMiddleware, requireFeature('queryPerformanceEnabled')] },
    async (request, reply) => {
      try {
        const { id, queryid } = request.params;
        const qid = parseInt(queryid, 10);

        // Verify database belongs to this org
        if (!await verifyDbOwnership(id, request.auth.orgId)) {
          return reply.status(404).send({ error: "Database not found" });
        }

        // Get the latest stats for this query
        const [latest] = await db
          .select()
          .from(queryStats)
          .where(
            and(
              eq(queryStats.monitoredDbId, id),
              eq(queryStats.queryid, qid)
            )
          )
          .orderBy(desc(queryStats.capturedAt))
          .limit(1);

        if (!latest) {
          return reply.status(404).send({ error: "Query not found" });
        }

        // Get time series for the last 24h
        const since = new Date();
        since.setHours(since.getHours() - 24);

        const timeSeries = await db
          .select()
          .from(queryStats)
          .where(
            and(
              eq(queryStats.monitoredDbId, id),
              eq(queryStats.queryid, qid),
              gte(queryStats.capturedAt, since)
            )
          )
          .orderBy(queryStats.capturedAt);

        return reply.send({
          query: serializeQueryStat(latest),
          timeSeries: timeSeries.map(serializeQueryStat),
        });
      } catch (err) {
        request.log.error({ err }, "Failed to get query detail");
        return reply.status(500).send({ error: "Failed to get query detail" });
      }
    }
  );

  /**
   * POST /api/databases/:id/queries/:queryid/explain
   * Trigger an on-demand EXPLAIN capture.
   */
  app.post<{
    Params: { id: string; queryid: string };
    Body: {
      queryText: string;
      parameters?: Record<string, string>;
      overrideQueryText?: string;
    };
  }>(
    "/api/databases/:id/queries/:queryid/explain",
    { preHandler: [authMiddleware, requireFeature('queryPerformanceEnabled')] },
    async (request, reply) => {
      try {
        const { id, queryid } = request.params;
        const { queryText, parameters, overrideQueryText } = request.body || {};

        if (!queryText && !overrideQueryText) {
          return reply.status(400).send({ error: "queryText or overrideQueryText is required" });
        }

        // Verify database belongs to this org
        if (!await verifyDbOwnership(id, request.auth.orgId)) {
          return reply.status(404).send({ error: "Database not found" });
        }

        const result = await captureExplain(
          id,
          parseInt(queryid, 10),
          queryText,
          request.log,
          {
            customParameters: parameters,
            overrideQueryText,
          }
        );

        return reply.send({ explain: result });
      } catch (err) {
        request.log.error({ err }, "Failed to capture EXPLAIN plan");
        const message = err instanceof Error ? err.message : "Failed to capture EXPLAIN plan";
        return reply.status(500).send({ error: message });
      }
    }
  );

  /**
   * GET /api/databases/:id/queries/:queryid/explains
   * List past EXPLAIN captures for a query.
   */
  app.get<{ Params: { id: string; queryid: string } }>(
    "/api/databases/:id/queries/:queryid/explains",
    { preHandler: [authMiddleware, requireFeature('queryPerformanceEnabled')] },
    async (request, reply) => {
      try {
        const { id, queryid } = request.params;
        const qid = parseInt(queryid, 10);

        // Verify database belongs to this org
        if (!await verifyDbOwnership(id, request.auth.orgId)) {
          return reply.status(404).send({ error: "Database not found" });
        }

        const explains = await db
          .select()
          .from(explainCaptures)
          .where(
            and(
              eq(explainCaptures.monitoredDbId, id),
              eq(explainCaptures.queryid, qid)
            )
          )
          .orderBy(desc(explainCaptures.capturedAt))
          .limit(20);

        return reply.send({
          explains: explains.map((e) => ({
            id: e.id,
            queryid: e.queryid,
            queryText: e.queryText,
            planJson: e.planJson,
            planText: e.planText,
            warnings: e.warnings,
            capturedAt: e.capturedAt.toISOString(),
          })),
        });
      } catch (err) {
        request.log.error({ err }, "Failed to list EXPLAIN captures");
        return reply.status(500).send({ error: "Failed to list EXPLAIN captures" });
      }
    }
  );

  /**
   * GET /api/databases/:id/query-suggestions
   * List query suggestions for a database.
   */
  app.get<{
    Params: { id: string };
    Querystring: { dismissed?: string };
  }>(
    "/api/databases/:id/query-suggestions",
    { preHandler: [authMiddleware, requireFeature('queryPerformanceEnabled')] },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const showDismissed = request.query.dismissed === "true";

        if (!await verifyDbOwnership(id, request.auth.orgId)) {
          return reply.status(404).send({ error: "Database not found" });
        }

        const suggestions = await db
          .select()
          .from(querySuggestions)
          .where(
            and(
              eq(querySuggestions.monitoredDbId, id),
              eq(querySuggestions.dismissed, showDismissed)
            )
          )
          .orderBy(desc(querySuggestions.detectedAt))
          .limit(50);

        return reply.send({
          suggestions: suggestions.map(serializeSuggestion),
        });
      } catch (err) {
        request.log.error({ err }, "Failed to list query suggestions");
        return reply.status(500).send({ error: "Failed to list query suggestions" });
      }
    }
  );

  /**
   * POST /api/databases/:id/query-suggestions/:sugId/dismiss
   * Dismiss a query suggestion.
   */
  app.post<{ Params: { id: string; sugId: string } }>(
    "/api/databases/:id/query-suggestions/:sugId/dismiss",
    { preHandler: [authMiddleware, requireRole('owner', 'admin'), requireFeature('queryPerformanceEnabled')] },
    async (request, reply) => {
      try {
        const { id, sugId } = request.params;

        if (!await verifyDbOwnership(id, request.auth.orgId)) {
          return reply.status(404).send({ error: "Database not found" });
        }

        await db
          .update(querySuggestions)
          .set({ dismissed: true })
          .where(
            and(
              eq(querySuggestions.id, sugId),
              eq(querySuggestions.monitoredDbId, id)
            )
          );

        return reply.send({ success: true });
      } catch (err) {
        request.log.error({ err }, "Failed to dismiss query suggestion");
        return reply.status(500).send({ error: "Failed to dismiss suggestion" });
      }
    }
  );

  /**
   * GET /api/databases/:id/queries/plan-tracked
   * Returns the list of queryids that have at least one plan snapshot.
   */
  app.get<{ Params: { id: string } }>(
    "/api/databases/:id/queries/plan-tracked",
    { preHandler: [authMiddleware, requireFeature("queryPerformanceEnabled")] },
    async (request, reply) => {
      const { id } = request.params;
      try {
        const tracked = await db
          .selectDistinct({ queryid: queryPlanSnapshots.queryid })
          .from(queryPlanSnapshots)
          .where(eq(queryPlanSnapshots.monitoredDbId, id));

        return reply.send({ queryids: tracked.map((t) => t.queryid) });
      } catch (err) {
        request.log.error({ err }, "Failed to get tracked plan queryids");
        return reply.status(500).send({ error: "Failed to get tracked plan queryids" });
      }
    }
  );

  /**
   * GET /api/databases/:id/queries/:queryid/plans
   * List plan snapshots for a query (plan regression tracking).
   * Spec §2.10
   */
  app.get<{ Params: { id: string; queryid: string } }>(
    "/api/databases/:id/queries/:queryid/plans",
    { preHandler: [authMiddleware, requireFeature("queryPerformanceEnabled")] },
    async (request, reply) => {
      const { id, queryid } = request.params;
      const queryidNum = parseInt(queryid, 10);

      try {
        const plans = await db
          .select()
          .from(queryPlanSnapshots)
          .where(
            and(
              eq(queryPlanSnapshots.monitoredDbId, id),
              eq(queryPlanSnapshots.queryid, queryidNum)
            )
          )
          .orderBy(desc(queryPlanSnapshots.capturedAt))
          .limit(50);

        // Detect regressions between consecutive snapshots using multi-factor analyzer
        const plansWithRegression = plans.map((plan, i) => {
          const next = plans[i + 1]; // next is older
          let regression: string | null = null;
          let regressionAnalysis: ReturnType<typeof analyzePlanRegression> = null;

          if (next) {
            regressionAnalysis = analyzePlanRegression(
              {
                topNodeType: next.topNodeType,
                planShapeHash: next.planShapeHash,
                estimatedCost: next.estimatedCost,
                planFlags: next.planFlags as Record<string, unknown> | null,
              },
              {
                topNodeType: plan.topNodeType,
                planShapeHash: plan.planShapeHash,
                estimatedCost: plan.estimatedCost,
                planFlags: plan.planFlags as Record<string, unknown> | null,
              }
            );
            if (regressionAnalysis?.isRegression) {
              regression = `${regressionAnalysis.summary}: ${regressionAnalysis.reason}`;
            }
          }

          return {
            id: plan.id,
            queryid: plan.queryid,
            capturedAt: plan.capturedAt.toISOString(),
            planShapeHash: plan.planShapeHash,
            estimatedCost: plan.estimatedCost,
            topNodeType: plan.topNodeType,
            planFlags: plan.planFlags as Record<string, unknown> | null,
            planJson: plan.planJson,
            regression,
            regressionAnalysis: regressionAnalysis?.isRegression ? regressionAnalysis : null,
          };
        });

        return reply.send({ plans: plansWithRegression });
      } catch (err) {
        request.log.error({ err }, "Failed to get plan history");
        return reply.status(500).send({ error: "Failed to get plan history" });
      }
    }
  );

  /**
   * GET /api/databases/:id/queries/percentiles
   * Returns estimated P50, P95, P99, and variance metrics for top queries.
   * Spec §3 & §7
   */
  app.get<{
    Params: { id: string };
    Querystring: { limit?: string; offset?: string };
  }>(
    "/api/databases/:id/queries/percentiles",
    { preHandler: [authMiddleware, requireFeature("queryPerformanceEnabled")] },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const limit = Math.min(parseInt(request.query.limit ?? "50", 10), 200);
        const offset = parseInt(request.query.offset ?? "0", 10);

        if (!(await verifyDbOwnership(id, request.auth.orgId))) {
          return reply.status(404).send({ error: "Database not found" });
        }

        const [latestCapture] = await db
          .select({ capturedAt: queryStats.capturedAt })
          .from(queryStats)
          .where(eq(queryStats.monitoredDbId, id))
          .orderBy(desc(queryStats.capturedAt))
          .limit(1);

        if (!latestCapture) {
          return reply.send({ queries: [], latestCapturedAt: null });
        }

        const queries = await db
          .select()
          .from(queryStats)
          .where(
            and(
              eq(queryStats.monitoredDbId, id),
              eq(queryStats.capturedAt, latestCapture.capturedAt)
            )
          )
          .orderBy(desc(queryStats.totalTimeMs))
          .limit(limit)
          .offset(offset);

        return reply.send({
          queries: queries.map((q) => {
            const calculated = estimatePercentiles(
              q.meanTimeMs,
              q.stddevExecTime ?? 0,
              q.minTimeMs,
              q.maxTimeMs
            );
            const p95 = q.p95ExecTime ?? calculated.p95;
            const p99 = q.p99ExecTime ?? calculated.p99;
            const p50 = calculated.p50;
            const varianceRatio =
              q.varianceRatio ?? calculated.varianceRatio;
            const isHighVariance =
              varianceRatio > 10.0 && q.maxTimeMs > 500;

            return {
              id: q.id,
              queryid: q.queryid,
              queryText: q.queryText,
              calls: q.calls,
              totalTimeMs: q.totalTimeMs,
              meanTimeMs: q.meanTimeMs,
              minTimeMs: q.minTimeMs,
              maxTimeMs: q.maxTimeMs,
              stddevExecTime: q.stddevExecTime ?? 0,
              p50ExecTime: p50,
              p95ExecTime: p95,
              p99ExecTime: p99,
              varianceRatio,
              isHighVariance,
              capturedAt: q.capturedAt.toISOString(),
            };
          }),
          latestCapturedAt: latestCapture.capturedAt.toISOString(),
        });
      } catch (err) {
        request.log.error({ err }, "Failed to get query percentiles");
        return reply.status(500).send({ error: "Failed to get query percentiles" });
      }
    }
  );

  /**
   * GET /api/databases/:id/io-diagnostics
   * Returns block read/write metrics, I/O wait percentages, and track_io_timing status.
   * Spec §4 & §7
   */
  app.get<{ Params: { id: string } }>(
    "/api/databases/:id/io-diagnostics",
    { preHandler: [authMiddleware, requireFeature("queryPerformanceEnabled")] },
    async (request, reply) => {
      try {
        const { id } = request.params;

        if (!(await verifyDbOwnership(id, request.auth.orgId))) {
          return reply.status(404).send({ error: "Database not found" });
        }

        const [monitoredDb] = await db
          .select()
          .from(monitoredDatabases)
          .where(eq(monitoredDatabases.id, id))
          .limit(1);

        if (!monitoredDb) {
          return reply.status(404).send({ error: "Database not found" });
        }

        const connectionString = decrypt(
          monitoredDb.connectionStringEncrypted,
          config.encryptionKey
        );

        // Check track_io_timing setting on database
        let trackIoTimingSetting = "off";
        try {
          const settingRows = await safeQuery<Array<{ setting: string }>>(
            connectionString,
            `SELECT setting FROM pg_settings WHERE name = 'track_io_timing'`,
            { timeoutMs: 5000 }
          );
          if (settingRows.length > 0) {
            trackIoTimingSetting = settingRows[0].setting;
          }
        } catch (err) {
          request.log.debug({ err, id }, "Failed to query track_io_timing setting");
        }

        // Get latest query stats for this database
        const [latestCapture] = await db
          .select({ capturedAt: queryStats.capturedAt })
          .from(queryStats)
          .where(eq(queryStats.monitoredDbId, id))
          .orderBy(desc(queryStats.capturedAt))
          .limit(1);

        if (!latestCapture) {
          return reply.send({
            trackIoTimingEnabled: trackIoTimingSetting === "on",
            trackIoTimingSetting,
            topIoQueries: [],
            summary: {
              totalReadTimeMs: 0,
              totalWriteTimeMs: 0,
              totalIoTimeMs: 0,
              queriesWithStalls: 0,
            },
            latestCapturedAt: null,
          });
        }

        const queries = await db
          .select()
          .from(queryStats)
          .where(
            and(
              eq(queryStats.monitoredDbId, id),
              eq(queryStats.capturedAt, latestCapture.capturedAt)
            )
          )
          .orderBy(
            desc(
              sql`COALESCE(${queryStats.blkReadTime}, 0) + COALESCE(${queryStats.blkWriteTime}, 0)`
            )
          )
          .limit(50);

        let totalReadTimeMs = 0;
        let totalWriteTimeMs = 0;
        let queriesWithStalls = 0;

        const topIoQueries = queries.map((q) => {
          const readTime = q.blkReadTime ?? 0;
          const writeTime = q.blkWriteTime ?? 0;
          const ioPercent =
            q.ioTimePercentage ??
            (q.totalTimeMs > 0
              ? ((readTime + writeTime) / q.totalTimeMs) * 100
              : 0);
          const isStall = ioPercent >= 45.0 && q.totalTimeMs > 1500;

          totalReadTimeMs += readTime;
          totalWriteTimeMs += writeTime;
          if (isStall) queriesWithStalls++;

          return {
            queryid: q.queryid,
            queryText: q.queryText,
            calls: q.calls,
            totalTimeMs: q.totalTimeMs,
            meanTimeMs: q.meanTimeMs,
            sharedBlksHit: q.sharedBlksHit,
            sharedBlksRead: q.sharedBlksRead,
            blkReadTime: readTime,
            blkWriteTime: writeTime,
            ioTimePercentage: Math.round(ioPercent * 10) / 10,
            isStall,
          };
        });

        return reply.send({
          trackIoTimingEnabled: trackIoTimingSetting === "on",
          trackIoTimingSetting,
          topIoQueries,
          summary: {
            totalReadTimeMs: Math.round(totalReadTimeMs * 100) / 100,
            totalWriteTimeMs: Math.round(totalWriteTimeMs * 100) / 100,
            totalIoTimeMs:
              Math.round((totalReadTimeMs + totalWriteTimeMs) * 100) / 100,
            queriesWithStalls,
          },
          latestCapturedAt: latestCapture.capturedAt.toISOString(),
        });
      } catch (err) {
        request.log.error({ err }, "Failed to get I/O diagnostics");
        return reply.status(500).send({ error: "Failed to get I/O diagnostics" });
      }
    }
  );
}

/** Serializes a queryStats row for API response (converts Date and bigint). */
function serializeQueryStat(row: typeof queryStats.$inferSelect) {
  return {
    id: row.id,
    monitoredDbId: row.monitoredDbId,
    capturedAt: row.capturedAt.toISOString(),
    queryid: row.queryid,
    queryText: row.queryText,
    calls: row.calls,
    totalTimeMs: row.totalTimeMs,
    meanTimeMs: row.meanTimeMs,
    maxTimeMs: row.maxTimeMs,
    minTimeMs: row.minTimeMs,
    rowsReturned: row.rowsReturned,
    rowsPerCall:
      row.calls > 0
        ? Math.round((row.rowsReturned / row.calls) * 100) / 100
        : 0,
    sharedBlksHit: row.sharedBlksHit,
    sharedBlksRead: row.sharedBlksRead,
    tempBlksWritten: row.tempBlksWritten,
    pctOfTotalTime: row.pctOfTotalTime,
    stddevExecTime: row.stddevExecTime ?? null,
    p95ExecTime: row.p95ExecTime ?? null,
    p99ExecTime: row.p99ExecTime ?? null,
    varianceRatio: row.varianceRatio ?? null,
    blkReadTime: row.blkReadTime ?? null,
    blkWriteTime: row.blkWriteTime ?? null,
    ioTimePercentage: row.ioTimePercentage ?? null,
  };
}

/** Serializes a querySuggestions row for API response. */
function serializeSuggestion(row: typeof querySuggestions.$inferSelect) {
  return {
    id: row.id,
    monitoredDbId: row.monitoredDbId,
    queryid: row.queryid,
    suggestionType: row.suggestionType,
    title: row.title,
    description: row.description,
    severity: row.severity,
    metadata: row.metadata,
    detectedAt: row.detectedAt.toISOString(),
    dismissed: row.dismissed,
  };
}

