import type { FastifyInstance } from "fastify";
import { db, indexRecommendations, monitoredDatabases } from "@pgvitals/db";
import { eq, and, desc } from "drizzle-orm";
import { analyzeIndexes } from "../collector/index-advisor.js";

/* ===================================================================
   Index Advisor Routes — Phase 5
   =================================================================== */

export default async function indexRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/databases/:id/index-recommendations
   * List all index recommendations for a database.
   * Query params: ?type=unused|missing&dismissed=true|false
   */
  app.get<{
    Params: { id: string };
    Querystring: { type?: string; dismissed?: string };
  }>("/api/databases/:id/index-recommendations", async (request, reply) => {
    try {
      const { id } = request.params;
      const { type, dismissed } = request.query;

      let query = db
        .select()
        .from(indexRecommendations)
        .where(eq(indexRecommendations.monitoredDbId, id))
        .orderBy(desc(indexRecommendations.detectedAt))
        .$dynamic();

      // Additional filters
      const conditions = [eq(indexRecommendations.monitoredDbId, id)];
      if (type === "unused" || type === "missing") {
        conditions.push(eq(indexRecommendations.recommendationType, type));
      }
      if (dismissed === "true") {
        conditions.push(eq(indexRecommendations.dismissed, true));
      } else if (dismissed === "false" || dismissed === undefined) {
        conditions.push(eq(indexRecommendations.dismissed, false));
      }

      const recommendations = await db
        .select()
        .from(indexRecommendations)
        .where(and(...conditions))
        .orderBy(desc(indexRecommendations.detectedAt))
        .limit(100);

      return reply.send({
        recommendations: recommendations.map((r) => ({
          id: r.id,
          monitoredDbId: r.monitoredDbId,
          tableName: r.tableName,
          indexName: r.indexName,
          recommendationType: r.recommendationType,
          suggestedDdl: r.suggestedDdl,
          reason: r.reason,
          impact: r.impact,
          metadata: r.metadata,
          detectedAt: r.detectedAt.toISOString(),
          dismissed: r.dismissed,
          dismissedAt: r.dismissedAt?.toISOString() ?? null,
        })),
      });
    } catch (err) {
      request.log.error({ err }, "Failed to list index recommendations");
      return reply.status(500).send({ error: "Failed to list recommendations" });
    }
  });

  /**
   * POST /api/databases/:id/index-recommendations/:recId/dismiss
   * Dismiss a recommendation.
   */
  app.post<{ Params: { id: string; recId: string } }>(
    "/api/databases/:id/index-recommendations/:recId/dismiss",
    async (request, reply) => {
      try {
        const { recId } = request.params;

        const [updated] = await db
          .update(indexRecommendations)
          .set({ dismissed: true, dismissedAt: new Date() })
          .where(eq(indexRecommendations.id, recId))
          .returning();

        if (!updated) {
          return reply.status(404).send({ error: "Recommendation not found" });
        }

        return reply.send({ success: true });
      } catch (err) {
        request.log.error({ err }, "Failed to dismiss recommendation");
        return reply.status(500).send({ error: "Failed to dismiss recommendation" });
      }
    }
  );

  /**
   * POST /api/databases/:id/index-recommendations/:recId/restore
   * Un-dismiss (restore) a recommendation.
   */
  app.post<{ Params: { id: string; recId: string } }>(
    "/api/databases/:id/index-recommendations/:recId/restore",
    async (request, reply) => {
      try {
        const { recId } = request.params;

        const [updated] = await db
          .update(indexRecommendations)
          .set({ dismissed: false, dismissedAt: null })
          .where(eq(indexRecommendations.id, recId))
          .returning();

        if (!updated) {
          return reply.status(404).send({ error: "Recommendation not found" });
        }

        return reply.send({ success: true });
      } catch (err) {
        request.log.error({ err }, "Failed to restore recommendation");
        return reply.status(500).send({ error: "Failed to restore recommendation" });
      }
    }
  );

  /**
   * POST /api/databases/:id/index-recommendations/analyze
   * Trigger a fresh index analysis (on-demand).
   */
  app.post<{ Params: { id: string } }>(
    "/api/databases/:id/index-recommendations/analyze",
    async (request, reply) => {
      try {
        const { id } = request.params;
        const result = await analyzeIndexes(id, request.log);
        return reply.send(result);
      } catch (err) {
        request.log.error({ err }, "Failed to run index analysis");
        return reply.status(500).send({ error: "Failed to run index analysis" });
      }
    }
  );
}
