import type { FastifyInstance } from "fastify";
import { db, indexRecommendations, monitoredDatabases } from "@pgvitals/db";
import { eq, and, desc } from "drizzle-orm";
import { analyzeIndexes } from "../collector/index-advisor.js";
import { simulateIndex, isHypoPGAvailable } from "../collector/hypopg-simulator.js";
import { decrypt } from "../lib/encryption.js";
import { config } from "../config.js";
import { authMiddleware } from "../middleware/auth.js";
import { requireFeature } from "../middleware/plan-limits.js";

/* ===================================================================
   Index Advisor Routes — Phase 5
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

export default async function indexRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/databases/:id/index-recommendations
   * List all index recommendations for a database.
   * Query params: ?type=unused|missing&dismissed=true|false
   */
  app.get<{
    Params: { id: string };
    Querystring: { type?: string; dismissed?: string };
  }>(
    "/api/databases/:id/index-recommendations",
    { preHandler: [authMiddleware, requireFeature('indexAdvisorEnabled')] },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const { type, dismissed } = request.query;

        // Verify database belongs to this org
        if (!await verifyDbOwnership(id, request.auth.orgId)) {
          return reply.status(404).send({ error: "Database not found" });
        }

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
    }
  );

  /**
   * POST /api/databases/:id/index-recommendations/:recId/dismiss
   * Dismiss a recommendation.
   */
  app.post<{ Params: { id: string; recId: string } }>(
    "/api/databases/:id/index-recommendations/:recId/dismiss",
    { preHandler: [authMiddleware, requireFeature('indexAdvisorEnabled')] },
    async (request, reply) => {
      try {
        const { id, recId } = request.params;

        // Verify database belongs to this org
        if (!await verifyDbOwnership(id, request.auth.orgId)) {
          return reply.status(404).send({ error: "Database not found" });
        }

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
    { preHandler: [authMiddleware, requireFeature('indexAdvisorEnabled')] },
    async (request, reply) => {
      try {
        const { id, recId } = request.params;

        // Verify database belongs to this org
        if (!await verifyDbOwnership(id, request.auth.orgId)) {
          return reply.status(404).send({ error: "Database not found" });
        }

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
    { preHandler: [authMiddleware, requireFeature('indexAdvisorEnabled')] },
    async (request, reply) => {
      try {
        const { id } = request.params;

        // Verify database belongs to this org
        if (!await verifyDbOwnership(id, request.auth.orgId)) {
          return reply.status(404).send({ error: "Database not found" });
        }

        const result = await analyzeIndexes(id, request.log);
        return reply.send(result);
      } catch (err) {
        request.log.error({ err }, "Failed to run index analysis");
        return reply.status(500).send({ error: "Failed to run index analysis" });
      }
    }
  );

  /**
   * POST /api/databases/:id/indexes/simulate
   * Run an ad-hoc HypoPG simulation for a given index DDL and test query.
   */
  app.post<{ Params: { id: string }; Body: { indexDdl: string; testQuery: string } }>(
    "/api/databases/:id/indexes/simulate",
    { preHandler: [authMiddleware, requireFeature("indexAdvisorEnabled")] },
    async (request, reply) => {
      const { id } = request.params;
      const { indexDdl, testQuery } = request.body as { indexDdl: string; testQuery: string };

      if (!indexDdl || !testQuery) {
        return reply.status(400).send({ error: "indexDdl and testQuery are required" });
      }

      try {
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

        // Check HypoPG availability
        const available = await isHypoPGAvailable(connectionString);
        if (!available) {
          return reply.status(400).send({
            error: "HypoPG extension is not installed on this database. Run: CREATE EXTENSION hypopg;",
          });
        }

        const result = await simulateIndex(connectionString, indexDdl, testQuery, request.log);
        if (!result) {
          return reply.status(400).send({ error: "Simulation failed — check that the DDL and query are valid" });
        }

        return reply.send(result);
      } catch (err) {
        request.log.error({ err }, "Failed to run index simulation");
        return reply.status(500).send({ error: "Failed to run index simulation" });
      }
    }
  );
}
