import type { FastifyInstance } from "fastify";
import { db, queryStats, explainCaptures, querySuggestions, monitoredDatabases } from "@pgvitals/db";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import { decrypt } from "../lib/encryption.js";
import { config } from "../config.js";
import { checkPgStatStatements } from "../collector/query-stats-collector.js";
import { captureExplain } from "../collector/explain-capture.js";
import { authMiddleware } from "../middleware/auth.js";
import { requireFeature } from "../middleware/plan-limits.js";

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
   * List top queries, sorted by total_time, calls, or mean_time.
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

        return reply.send({
          queries: queries.map((q) => {
            const serialized = serializeQueryStat(q);
            const oldMean = trendMap.get(q.queryid);
            let meanTimeTrend: number | null = null;
            if (oldMean != null && oldMean > 0) {
              meanTimeTrend = Math.round(((q.meanTimeMs - oldMean) / oldMean) * 1000) / 10; // e.g. 32.5 means +32.5%
            }
            return { ...serialized, meanTimeTrend };
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
    Body: { queryText: string };
  }>(
    "/api/databases/:id/queries/:queryid/explain",
    { preHandler: [authMiddleware, requireFeature('queryPerformanceEnabled')] },
    async (request, reply) => {
      try {
        const { id, queryid } = request.params;
        const { queryText } = request.body;

        if (!queryText) {
          return reply.status(400).send({ error: "queryText is required" });
        }

        // Verify database belongs to this org
        if (!await verifyDbOwnership(id, request.auth.orgId)) {
          return reply.status(404).send({ error: "Database not found" });
        }

        const result = await captureExplain(
          id,
          parseInt(queryid, 10),
          queryText,
          request.log
        );

        return reply.send({ explain: result });
      } catch (err) {
        request.log.error({ err }, "Failed to capture EXPLAIN plan");
        return reply.status(500).send({ error: "Failed to capture EXPLAIN plan" });
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
    { preHandler: [authMiddleware, requireFeature('queryPerformanceEnabled')] },
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
    sharedBlksHit: row.sharedBlksHit,
    sharedBlksRead: row.sharedBlksRead,
    tempBlksWritten: row.tempBlksWritten,
    pctOfTotalTime: row.pctOfTotalTime,
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
