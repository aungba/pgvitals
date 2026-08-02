import type { FastifyInstance } from "fastify";
import { db, replicationSnapshots, monitoredDatabases } from "@pgvitals/db";
import { eq, desc, and, gte } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth.js";

/* ===================================================================
   Replication Lag Routes — Phase 7
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

export default async function replicationRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/databases/:id/replication
   * Latest replication lag stats per replica.
   */
  app.get<{ Params: { id: string } }>(
    "/api/databases/:id/replication",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      try {
        const { id } = request.params;

        // Verify database belongs to this org
        if (!await verifyDbOwnership(id, request.auth.orgId)) {
          return reply.status(404).send({ error: "Database not found" });
        }

        // Get latest captured_at
        const [latest] = await db
          .select({ capturedAt: replicationSnapshots.capturedAt })
          .from(replicationSnapshots)
          .where(eq(replicationSnapshots.monitoredDbId, id))
          .orderBy(desc(replicationSnapshots.capturedAt))
          .limit(1);

        if (!latest) {
          return reply.send({ replicas: [], capturedAt: null });
        }

        // Get all replicas from the latest snapshot
        const replicas = await db
          .select()
          .from(replicationSnapshots)
          .where(
            and(
              eq(replicationSnapshots.monitoredDbId, id),
              eq(replicationSnapshots.capturedAt, latest.capturedAt)
            )
          )
          .orderBy(desc(replicationSnapshots.byteLag));

        return reply.send({
          replicas: replicas.map(serializeReplicationSnapshot),
          capturedAt: latest.capturedAt.toISOString(),
        });
      } catch (err) {
        request.log.error({ err }, "Failed to get replication stats");
        return reply.status(500).send({ error: "Failed to get replication stats" });
      }
    }
  );

  /**
   * GET /api/databases/:id/replication/history
   * Replication lag history for charting (last 24h by default).
   */
  app.get<{
    Params: { id: string };
    Querystring: { hours?: string; replica?: string };
  }>(
    "/api/databases/:id/replication/history",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const hours = Math.min(parseInt(request.query.hours ?? "24", 10), 168); // max 7 days
        const replicaFilter = request.query.replica;

        if (!await verifyDbOwnership(id, request.auth.orgId)) {
          return reply.status(404).send({ error: "Database not found" });
        }

        const since = new Date(Date.now() - hours * 60 * 60 * 1000);

        let query = db
          .select({
            capturedAt: replicationSnapshots.capturedAt,
            replicaName: replicationSnapshots.replicaName,
            byteLag: replicationSnapshots.byteLag,
            timeLagSeconds: replicationSnapshots.timeLagSeconds,
            replicationState: replicationSnapshots.replicationState,
          })
          .from(replicationSnapshots)
          .where(
            and(
              eq(replicationSnapshots.monitoredDbId, id),
              gte(replicationSnapshots.capturedAt, since),
              ...(replicaFilter
                ? [eq(replicationSnapshots.replicaName, replicaFilter)]
                : [])
            )
          )
          .orderBy(replicationSnapshots.capturedAt)
          .limit(2000);

        const history = await query;

        return reply.send({
          history: history.map((h) => ({
            capturedAt: h.capturedAt.toISOString(),
            replicaName: h.replicaName,
            byteLag: h.byteLag,
            timeLagSeconds: h.timeLagSeconds,
            replicationState: h.replicationState,
          })),
        });
      } catch (err) {
        request.log.error({ err }, "Failed to get replication history");
        return reply.status(500).send({ error: "Failed to get replication history" });
      }
    }
  );
}

/** Serializes a replication snapshot row for API response. */
function serializeReplicationSnapshot(row: typeof replicationSnapshots.$inferSelect) {
  return {
    id: row.id,
    capturedAt: row.capturedAt.toISOString(),
    replicaName: row.replicaName,
    clientAddr: row.clientAddr,
    replicationState: row.replicationState,
    sentLsn: row.sentLsn,
    writeLsn: row.writeLsn,
    flushLsn: row.flushLsn,
    replayLsn: row.replayLsn,
    byteLag: row.byteLag,
    timeLagSeconds: row.timeLagSeconds,
    writeLagMs: row.writeLagMs,
    flushLagMs: row.flushLagMs,
    replayLagMs: row.replayLagMs,
  };
}
