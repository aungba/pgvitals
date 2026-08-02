import type { FastifyInstance } from "fastify";
import { db, logInsights, dbErrorStats, monitoredDatabases } from "@pgvitals/db";
import { eq, desc, and, gte } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth.js";

/* ===================================================================
   Log Insights Routes — Phase 8
   =================================================================== */

async function verifyDbOwnership(dbId: string, orgId: string): Promise<boolean> {
  const [mdb] = await db
    .select({ id: monitoredDatabases.id })
    .from(monitoredDatabases)
    .where(and(eq(monitoredDatabases.id, dbId), eq(monitoredDatabases.orgId, orgId)))
    .limit(1);
  return !!mdb;
}

export default async function logInsightRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/databases/:id/log-insights
   * Recent log insights (errors, warnings) for a database.
   */
  app.get<{
    Params: { id: string };
    Querystring: { hours?: string; severity?: string };
  }>(
    "/api/databases/:id/log-insights",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const hours = Math.min(parseInt(request.query.hours ?? "24", 10), 168);
        const severityFilter = request.query.severity;

        if (!await verifyDbOwnership(id, request.auth.orgId)) {
          return reply.status(404).send({ error: "Database not found" });
        }

        const since = new Date(Date.now() - hours * 60 * 60 * 1000);

        const insights = await db
          .select()
          .from(logInsights)
          .where(
            and(
              eq(logInsights.monitoredDbId, id),
              gte(logInsights.capturedAt, since),
              ...(severityFilter
                ? [eq(logInsights.severity, severityFilter as "error" | "warning" | "info")]
                : [])
            )
          )
          .orderBy(desc(logInsights.capturedAt))
          .limit(500);

        return reply.send({
          insights: insights.map((i) => ({
            id: i.id,
            capturedAt: i.capturedAt.toISOString(),
            severity: i.severity,
            errorType: i.errorType,
            errorMessage: i.errorMessage,
            errorCount: i.errorCount,
            sampleQuery: i.sampleQuery,
            databaseName: i.databaseName,
            userName: i.userName,
          })),
        });
      } catch (err) {
        request.log.error({ err }, "Failed to get log insights");
        return reply.status(500).send({ error: "Failed to get log insights" });
      }
    }
  );

  /**
   * GET /api/databases/:id/error-stats
   * Error stats history for charting.
   */
  app.get<{
    Params: { id: string };
    Querystring: { hours?: string };
  }>(
    "/api/databases/:id/error-stats",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const hours = Math.min(parseInt(request.query.hours ?? "24", 10), 168);

        if (!await verifyDbOwnership(id, request.auth.orgId)) {
          return reply.status(404).send({ error: "Database not found" });
        }

        const since = new Date(Date.now() - hours * 60 * 60 * 1000);

        const stats = await db
          .select({
            capturedAt: dbErrorStats.capturedAt,
            deadlocksCount: dbErrorStats.deadlocksCount,
            conflictsCount: dbErrorStats.conflictsCount,
            rollbacksCount: dbErrorStats.rollbacksCount,
            tempFilesCount: dbErrorStats.tempFilesCount,
            tempFilesBytes: dbErrorStats.tempFilesBytes,
          })
          .from(dbErrorStats)
          .where(
            and(
              eq(dbErrorStats.monitoredDbId, id),
              gte(dbErrorStats.capturedAt, since)
            )
          )
          .orderBy(dbErrorStats.capturedAt)
          .limit(2000);

        return reply.send({
          stats: stats.map((s) => ({
            capturedAt: s.capturedAt.toISOString(),
            deadlocksCount: s.deadlocksCount,
            conflictsCount: s.conflictsCount,
            rollbacksCount: s.rollbacksCount,
            tempFilesCount: s.tempFilesCount,
            tempFilesBytes: s.tempFilesBytes,
          })),
        });
      } catch (err) {
        request.log.error({ err }, "Failed to get error stats");
        return reply.status(500).send({ error: "Failed to get error stats" });
      }
    }
  );
}
