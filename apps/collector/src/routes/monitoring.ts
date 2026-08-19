import type { FastifyInstance } from "fastify";
import {
  db,
  snapshots,
  sessionsSnapshot,
  rootCauseHints,
  monitoredDatabases,
  dbHealthSnapshots,
} from "@pgvitals/db";
import { eq, desc, and, gte, lte } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth.js";

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

export default async function monitoringRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/databases/:id/overview — Latest snapshot with computed utilization %.
   */
  app.get<{ Params: { id: string } }>(
    "/api/databases/:id/overview",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      try {
        const { id } = request.params;

        // Verify database exists and belongs to this org
        if (!await verifyDbOwnership(id, request.auth.orgId)) {
          return reply.status(404).send({ error: "Database not found" });
        }

        const [mdb] = await db
          .select({ id: monitoredDatabases.id, name: monitoredDatabases.name })
          .from(monitoredDatabases)
          .where(eq(monitoredDatabases.id, id))
          .limit(1);

        // Get the latest snapshot
        const [latestSnapshot] = await db
          .select()
          .from(snapshots)
          .where(eq(snapshots.monitoredDbId, id))
          .orderBy(desc(snapshots.timestamp))
          .limit(1);

        if (!latestSnapshot) {
          return reply.send({
            database: mdb,
            snapshot: null,
            utilization: null,
          });
        }

        const utilizationPercent =
          latestSnapshot.maxConnections > 0
            ? Math.round(
                (latestSnapshot.connectionCount / latestSnapshot.maxConnections) * 100
              )
            : 0;

        // Get the latest health snapshot
        const [latestHealth] = await db
          .select()
          .from(dbHealthSnapshots)
          .where(eq(dbHealthSnapshots.monitoredDbId, id))
          .orderBy(desc(dbHealthSnapshots.capturedAt))
          .limit(1);

        return reply.send({
          database: mdb,
          snapshot: {
            id: latestSnapshot.id,
            timestamp: latestSnapshot.timestamp,
            connectionCount: latestSnapshot.connectionCount,
            activeCount: latestSnapshot.activeCount,
            idleCount: latestSnapshot.idleCount,
            idleInTxnCount: latestSnapshot.idleInTxnCount,
            idleInTxnAbortedCount: latestSnapshot.idleInTxnAbortedCount,
            maxConnections: latestSnapshot.maxConnections,
          },
          utilization: {
            percent: utilizationPercent,
            connectionCount: latestSnapshot.connectionCount,
            maxConnections: latestSnapshot.maxConnections,
          },
          health: latestHealth
            ? {
                cacheHitRatio: latestHealth.cacheHitRatio,
                dbSizeBytes: latestHealth.dbSizeBytes,
                tempFileBytes: latestHealth.tempFileBytes,
                numBackends: latestHealth.numBackends,
                xactCommit: latestHealth.xactCommit,
                xactRollback: latestHealth.xactRollback,
                deadlocksCount: latestHealth.deadlocksCount,
                capturedAt: latestHealth.capturedAt,
              }
            : null,
        });
      } catch (err) {
        request.log.error({ err }, "Failed to get overview");
        return reply.status(500).send({ error: "Failed to get overview" });
      }
    }
  );

  /**
   * GET /api/databases/:id/sessions — Latest or historical sessions with blocking info.
   * Query params: timestamp (ISO) or snapshotId for historical replay.
   */
  app.get<{
    Params: { id: string };
    Querystring: { timestamp?: string; snapshotId?: string };
  }>(
    "/api/databases/:id/sessions",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const { timestamp: requestedTimestamp, snapshotId: requestedSnapshotId } = request.query;

        // Verify database belongs to this org
        if (!await verifyDbOwnership(id, request.auth.orgId)) {
          return reply.status(404).send({ error: "Database not found" });
        }

        let targetSnapshot: { id: string; timestamp: Date } | undefined;

        if (requestedSnapshotId) {
          const [found] = await db
            .select({ id: snapshots.id, timestamp: snapshots.timestamp })
            .from(snapshots)
            .where(and(eq(snapshots.monitoredDbId, id), eq(snapshots.id, requestedSnapshotId)))
            .limit(1);
          targetSnapshot = found;
        } else if (requestedTimestamp) {
          const targetDate = new Date(requestedTimestamp);
          const [found] = await db
            .select({ id: snapshots.id, timestamp: snapshots.timestamp })
            .from(snapshots)
            .where(and(eq(snapshots.monitoredDbId, id), lte(snapshots.timestamp, targetDate)))
            .orderBy(desc(snapshots.timestamp))
            .limit(1);
          targetSnapshot = found;
        } else {
          // Get the latest snapshot for this database
          const [latestSnapshot] = await db
            .select({ id: snapshots.id, timestamp: snapshots.timestamp })
            .from(snapshots)
            .where(eq(snapshots.monitoredDbId, id))
            .orderBy(desc(snapshots.timestamp))
            .limit(1);
          targetSnapshot = latestSnapshot;
        }

        if (!targetSnapshot) {
          return reply.send({ snapshotId: null, snapshotTimestamp: null, sessions: [] });
        }

        // Fetch sessions for this snapshot
        const sessions = await db
          .select()
          .from(sessionsSnapshot)
          .where(eq(sessionsSnapshot.snapshotId, targetSnapshot.id))
          .orderBy(desc(sessionsSnapshot.stateDurationSeconds));

        return reply.send({
          snapshotId: targetSnapshot.id,
          snapshotTimestamp: targetSnapshot.timestamp,
          sessions: sessions.map((s) => ({
            pid: s.pid,
            usename: s.usename,
            applicationName: s.applicationName,
            clientAddr: s.clientAddr,
            state: s.state,
            stateDurationSeconds: s.stateDurationSeconds,
            queryText: s.queryText,
            queryStart: s.queryStart,
            waitEventType: s.waitEventType,
            waitEvent: s.waitEvent,
            blockingPid: s.blockingPid,
          })),
        });
      } catch (err) {
        request.log.error({ err }, "Failed to get sessions");
        return reply.status(500).send({ error: "Failed to get sessions" });
      }
    }
  );

  /**
   * GET /api/databases/:id/snapshots — Time-series snapshots.
   * Query params: from (ISO), to (ISO), limit (default 100).
   */
  app.get<{
    Params: { id: string };
    Querystring: { from?: string; to?: string; limit?: string };
  }>(
    "/api/databases/:id/snapshots",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const { from, to, limit: limitStr } = request.query;
        const limit = Math.min(parseInt(limitStr ?? "100", 10), 1000);

        // Verify database belongs to this org
        if (!await verifyDbOwnership(id, request.auth.orgId)) {
          return reply.status(404).send({ error: "Database not found" });
        }

        const conditions = [eq(snapshots.monitoredDbId, id)];

        if (from) {
          conditions.push(gte(snapshots.timestamp, new Date(from)));
        }
        if (to) {
          conditions.push(lte(snapshots.timestamp, new Date(to)));
        }

        const result = await db
          .select({
            id: snapshots.id,
            timestamp: snapshots.timestamp,
            connectionCount: snapshots.connectionCount,
            activeCount: snapshots.activeCount,
            idleCount: snapshots.idleCount,
            idleInTxnCount: snapshots.idleInTxnCount,
            idleInTxnAbortedCount: snapshots.idleInTxnAbortedCount,
            maxConnections: snapshots.maxConnections,
          })
          .from(snapshots)
          .where(and(...conditions))
          .orderBy(desc(snapshots.timestamp))
          .limit(limit);

        return reply.send({ snapshots: result });
      } catch (err) {
        request.log.error({ err }, "Failed to get snapshots");
        return reply.status(500).send({ error: "Failed to get snapshots" });
      }
    }
  );

  /**
   * GET /api/databases/:id/hints — Active root-cause hints (last 24h).
   */
  app.get<{ Params: { id: string } }>(
    "/api/databases/:id/hints",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      try {
        const { id } = request.params;

        // Verify database belongs to this org
        if (!await verifyDbOwnership(id, request.auth.orgId)) {
          return reply.status(404).send({ error: "Database not found" });
        }

        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const hints = await db
          .select()
          .from(rootCauseHints)
          .where(
            and(
              eq(rootCauseHints.monitoredDbId, id),
              gte(rootCauseHints.detectedAt, twentyFourHoursAgo)
            )
          )
          .orderBy(desc(rootCauseHints.detectedAt));

        return reply.send({
          hints: hints.map((h) => ({
            id: h.id,
            ruleType: h.ruleType,
            severity: h.severity,
            title: h.title,
            description: h.description,
            metadata: h.metadata,
            detectedAt: h.detectedAt,
          })),
        });
      } catch (err) {
        request.log.error({ err }, "Failed to get hints");
        return reply.status(500).send({ error: "Failed to get hints" });
      }
    }
  );
}
