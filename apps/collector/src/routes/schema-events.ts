import type { FastifyInstance } from "fastify";
import { db, schemaEvents } from "@pgvitals/db";
import { eq, desc } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth.js";

/* ===================================================================
   Schema Events Routes — spec §2.13
   =================================================================== */

export default async function schemaEventRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/databases/:id/schema-events
   * List schema change events for a database (last 90 days).
   */
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    "/api/databases/:id/schema-events",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { id } = request.params;
      const limit = Math.min(parseInt(request.query.limit ?? "100", 10), 500);

      try {
        const events = await db
          .select()
          .from(schemaEvents)
          .where(eq(schemaEvents.monitoredDbId, id))
          .orderBy(desc(schemaEvents.detectedAt))
          .limit(limit);

        return reply.send({
          events: events.map((e) => ({
            id: e.id,
            eventType: e.eventType,
            objectName: e.objectName,
            detectedAt: e.detectedAt.toISOString(),
            details: e.details,
          })),
        });
      } catch (err) {
        request.log.error({ err }, "Failed to list schema events");
        return reply.status(500).send({ error: "Failed to list schema events" });
      }
    }
  );
}
