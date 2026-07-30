import type { FastifyInstance } from "fastify";
import { db, queryStats, explainCaptures, monitoredDatabases } from "@pgvitals/db";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import { decrypt } from "../lib/encryption.js";
import { config } from "../config.js";
import { checkPgStatStatements } from "../collector/query-stats-collector.js";
import { captureExplain } from "../collector/explain-capture.js";

/* ===================================================================
   Query Performance Routes — Phase 4
   =================================================================== */

export default async function queryRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/databases/:id/query-stats/status
   * Check if pg_stat_statements is available on the monitored database.
   */
  app.get<{ Params: { id: string } }>(
    "/api/databases/:id/query-stats/status",
    async (request, reply) => {
      try {
        const { id } = request.params;

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
  }>("/api/databases/:id/queries", async (request, reply) => {
    try {
      const { id } = request.params;
      const sortBy = request.query.sort ?? "total_time";
      const limit = Math.min(parseInt(request.query.limit ?? "50", 10), 200);
      const offset = parseInt(request.query.offset ?? "0", 10);

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

      return reply.send({
        queries: queries.map(serializeQueryStat),
        latestCapturedAt: latestCapture.capturedAt.toISOString(),
      });
    } catch (err) {
      request.log.error({ err }, "Failed to list queries");
      return reply.status(500).send({ error: "Failed to list queries" });
    }
  });

  /**
   * GET /api/databases/:id/queries/:queryid
   * Get single query detail with time series data.
   */
  app.get<{ Params: { id: string; queryid: string } }>(
    "/api/databases/:id/queries/:queryid",
    async (request, reply) => {
      try {
        const { id, queryid } = request.params;
        const qid = parseInt(queryid, 10);

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
  }>("/api/databases/:id/queries/:queryid/explain", async (request, reply) => {
    try {
      const { id, queryid } = request.params;
      const { queryText } = request.body;

      if (!queryText) {
        return reply.status(400).send({ error: "queryText is required" });
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
  });

  /**
   * GET /api/databases/:id/queries/:queryid/explains
   * List past EXPLAIN captures for a query.
   */
  app.get<{ Params: { id: string; queryid: string } }>(
    "/api/databases/:id/queries/:queryid/explains",
    async (request, reply) => {
      try {
        const { id, queryid } = request.params;
        const qid = parseInt(queryid, 10);

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
    pctOfTotalTime: row.pctOfTotalTime,
  };
}
