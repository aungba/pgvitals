import type { FastifyInstance } from "fastify";
import { db, poolerSnapshots } from "@pgvitals/db";
import { eq, desc, gte, and } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth.js";

/* ===================================================================
   Pooler Routes — PgBouncer pool metrics API, spec §2.12
   =================================================================== */

export default async function poolerRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/databases/:id/pooler
   * Get latest PgBouncer pool snapshot.
   */
  app.get<{ Params: { id: string } }>(
    "/api/databases/:id/pooler",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { id } = request.params;

      try {
        const latest = await db
          .select()
          .from(poolerSnapshots)
          .where(eq(poolerSnapshots.monitoredDbId, id))
          .orderBy(desc(poolerSnapshots.capturedAt))
          .limit(20); // May have multiple pools

        if (latest.length === 0) {
          return reply.send({ pools: [], message: "No PgBouncer data available. Configure a PgBouncer connection to enable pool monitoring." });
        }

        // Group by latest capturedAt
        const latestTs = latest[0].capturedAt.getTime();
        const latestPools = latest.filter((r) => r.capturedAt.getTime() === latestTs);

        return reply.send({
          pools: latestPools.map((p) => ({
            poolName: p.poolName,
            clActive: p.clActive,
            clWaiting: p.clWaiting,
            svActive: p.svActive,
            svIdle: p.svIdle,
            avgWaitTimeMs: p.avgWaitTimeMs,
            totalWaitTimeMs: p.totalWaitTimeMs,
            capturedAt: p.capturedAt.toISOString(),
          })),
        });
      } catch (err) {
        request.log.error({ err }, "Failed to get pooler stats");
        return reply.status(500).send({ error: "Failed to get pooler stats" });
      }
    }
  );

  /**
   * GET /api/databases/:id/pooler/history
   * Get pool stats time series (last 24h).
   */
  app.get<{ Params: { id: string } }>(
    "/api/databases/:id/pooler/history",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { id } = request.params;
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

      try {
        const rows = await db
          .select()
          .from(poolerSnapshots)
          .where(
            and(
              eq(poolerSnapshots.monitoredDbId, id),
              gte(poolerSnapshots.capturedAt, since)
            )
          )
          .orderBy(poolerSnapshots.capturedAt)
          .limit(2000);

        return reply.send({
          history: rows.map((p) => ({
            poolName: p.poolName,
            clActive: p.clActive,
            clWaiting: p.clWaiting,
            svActive: p.svActive,
            svIdle: p.svIdle,
            avgWaitTimeMs: p.avgWaitTimeMs,
            capturedAt: p.capturedAt.toISOString(),
          })),
        });
      } catch (err) {
        request.log.error({ err }, "Failed to get pooler history");
        return reply.status(500).send({ error: "Failed to get pooler history" });
      }
    }
  );
}
