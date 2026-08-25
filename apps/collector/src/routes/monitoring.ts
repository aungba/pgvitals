import type { FastifyInstance } from "fastify";
import {
  db,
  snapshots,
  sessionsSnapshot,
  rootCauseHints,
  monitoredDatabases,
  dbHealthSnapshots,
  metricRollups,
} from "@pgvitals/db";
import { eq, desc, and, gte, lte } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth.js";
import { sessionBroadcaster } from "../lib/session-broadcaster.js";

/**
 * Verifies that the given database belongs to the given organization and returns basic DB info.
 */
async function verifyDbOwnership(
  dbId: string,
  orgId: string
): Promise<{ id: string; name: string } | null> {
  const [mdb] = await db
    .select({ id: monitoredDatabases.id, name: monitoredDatabases.name })
    .from(monitoredDatabases)
    .where(and(eq(monitoredDatabases.id, dbId), eq(monitoredDatabases.orgId, orgId)))
    .limit(1);
  return mdb ?? null;
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
        const mdb = await verifyDbOwnership(id, request.auth.orgId);
        if (!mdb) {
          return reply.status(404).send({ error: "Database not found" });
        }

        // Get the latest snapshot
        const [latestSnapshot] = await db
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
          .where(eq(snapshots.monitoredDbId, id))
          .orderBy(desc(snapshots.timestamp))
          .limit(1);

        // Get the latest health snapshot
        let latestHealth: {
          cacheHitRatio: number | null;
          dbSizeBytes: number | null;
          tempFileBytes: number | null;
          numBackends: number | null;
          xactCommit: number | null;
          xactRollback: number | null;
          deadlocksCount: number | null;
          capturedAt: Date;
        } | null = null;

        try {
          const [foundHealth] = await db
            .select({
              cacheHitRatio: dbHealthSnapshots.cacheHitRatio,
              dbSizeBytes: dbHealthSnapshots.dbSizeBytes,
              tempFileBytes: dbHealthSnapshots.tempFileBytes,
              numBackends: dbHealthSnapshots.numBackends,
              xactCommit: dbHealthSnapshots.xactCommit,
              xactRollback: dbHealthSnapshots.xactRollback,
              deadlocksCount: dbHealthSnapshots.deadlocksCount,
              capturedAt: dbHealthSnapshots.capturedAt,
            })
            .from(dbHealthSnapshots)
            .where(eq(dbHealthSnapshots.monitoredDbId, id))
            .orderBy(desc(dbHealthSnapshots.capturedAt))
            .limit(1);

          if (foundHealth) {
            latestHealth = foundHealth;
          }
        } catch (healthErr) {
          request.log.warn({ err: healthErr }, "Failed to fetch db health snapshot for overview");
        }

        const healthData = latestHealth
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
          : null;

        if (!latestSnapshot) {
          return reply.send({
            database: mdb,
            snapshot: null,
            utilization: null,
            health: healthData,
          });
        }

        const utilizationPercent =
          latestSnapshot.maxConnections > 0
            ? Math.round(
                (latestSnapshot.connectionCount / latestSnapshot.maxConnections) * 100
              )
            : 0;

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
          health: healthData,
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
   * GET /api/databases/:id/hints — Active or historical root-cause hints.
   */
  app.get<{
    Params: { id: string };
    Querystring: {
      hours?: string;
      severity?: string;
      ruleType?: string;
      limit?: string;
      offset?: string;
    };
  }>(
    "/api/databases/:id/hints",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const { hours, severity, ruleType, limit, offset } = request.query;

        // Verify database belongs to this org
        if (!await verifyDbOwnership(id, request.auth.orgId)) {
          return reply.status(404).send({ error: "Database not found" });
        }

        const conditions = [eq(rootCauseHints.monitoredDbId, id)];

        const parsedHours = hours !== undefined ? parseFloat(hours) : 24;
        if (parsedHours > 0) {
          const fromTime = new Date(Date.now() - parsedHours * 60 * 60 * 1000);
          conditions.push(gte(rootCauseHints.detectedAt, fromTime));
        }

        if (severity && severity !== "all") {
          conditions.push(eq(rootCauseHints.severity, severity));
        }

        if (ruleType && ruleType !== "all") {
          conditions.push(eq(rootCauseHints.ruleType, ruleType));
        }

        const parsedLimit = limit ? Math.min(Math.max(1, parseInt(limit, 10)), 500) : 200;
        const parsedOffset = offset ? Math.max(0, parseInt(offset, 10)) : 0;

        const hints = await db
          .select()
          .from(rootCauseHints)
          .where(and(...conditions))
          .orderBy(desc(rootCauseHints.detectedAt))
          .limit(parsedLimit)
          .offset(parsedOffset);

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

  /**
   * GET /api/databases/:id/live-sessions — Server-Sent Events stream for real-time sessions.
   */
  app.get<{ Params: { id: string } }>(
    "/api/databases/:id/live-sessions",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { id } = request.params;

      const mdb = await verifyDbOwnership(id, request.auth.orgId);
      if (!mdb) {
        return reply.status(404).send({ error: "Database not found" });
      }

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });

      // 1. Send immediate state from in-memory cache or single cold query
      const cached = sessionBroadcaster.getLatest(id);
      if (cached) {
        reply.raw.write(`data: ${JSON.stringify(cached)}\n\n`);
      } else {
        try {
          const [latestSnapshot] = await db
            .select({ id: snapshots.id, timestamp: snapshots.timestamp })
            .from(snapshots)
            .where(eq(snapshots.monitoredDbId, id))
            .orderBy(desc(snapshots.timestamp))
            .limit(1);

          if (latestSnapshot) {
            const sessions = await db
              .select()
              .from(sessionsSnapshot)
              .where(
                and(
                  eq(sessionsSnapshot.monitoredDbId, id),
                  eq(sessionsSnapshot.snapshotId, latestSnapshot.id)
                )
              );

            const initialData = {
              snapshotId: latestSnapshot.id,
              timestamp: latestSnapshot.timestamp,
              sessions,
            };
            sessionBroadcaster.publish(id, initialData);
            reply.raw.write(`data: ${JSON.stringify(initialData)}\n\n`);
          } else {
            reply.raw.write(`data: ${JSON.stringify({ sessions: [] })}\n\n`);
          }
        } catch (err) {
          request.log.error({ err }, "Error fetching initial SSE session snapshot");
        }
      }

      // 2. Subscribe to push events (0 database queries per interval across all N clients)
      const unsubscribe = sessionBroadcaster.subscribe(id, (payload) => {
        try {
          reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
        } catch {
          // ignore write errors if client disconnected abruptly
        }
      });

      request.raw.on("close", () => {
        unsubscribe();
      });
    }
  );

  /**
   * GET /api/databases/:id/rollups — Get continuous pre-aggregated metrics.
   */
  app.get<{
    Params: { id: string };
    Querystring: { resolution?: string; hours?: string };
  }>(
    "/api/databases/:id/rollups",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const { resolution = "5m", hours = "24" } = request.query;

        if (!await verifyDbOwnership(id, request.auth.orgId)) {
          return reply.status(404).send({ error: "Database not found" });
        }

        const parsedHours = Math.max(1, parseFloat(hours));
        const fromTime = new Date(Date.now() - parsedHours * 60 * 60 * 1000);

        const rollups = await db
          .select()
          .from(metricRollups)
          .where(
            and(
              eq(metricRollups.monitoredDbId, id),
              eq(metricRollups.resolution, resolution),
              gte(metricRollups.bucket, fromTime)
            )
          )
          .orderBy(desc(metricRollups.bucket))
          .limit(500);

        return reply.send({ rollups });
      } catch (err) {
        request.log.error({ err }, "Failed to get metric rollups");
        return reply.status(500).send({ error: "Failed to get rollups" });
      }
    }
  );
}
