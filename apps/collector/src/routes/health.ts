import type { FastifyInstance } from "fastify";
import { db, tableBloatStats, dbHealthSnapshots } from "@pgvitals/db";
import { eq, desc, and, gte } from "drizzle-orm";

/* ===================================================================
   VACUUM & Health Routes — Phase 6
   =================================================================== */

export default async function healthRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/databases/:id/vacuum-stats
   * Latest table bloat stats for a database.
   */
  app.get<{ Params: { id: string } }>(
    "/api/databases/:id/vacuum-stats",
    async (request, reply) => {
      try {
        const { id } = request.params;

        // Get latest captured_at
        const [latest] = await db
          .select({ capturedAt: tableBloatStats.capturedAt })
          .from(tableBloatStats)
          .where(eq(tableBloatStats.monitoredDbId, id))
          .orderBy(desc(tableBloatStats.capturedAt))
          .limit(1);

        if (!latest) {
          return reply.send({ tables: [], capturedAt: null });
        }

        const tables = await db
          .select()
          .from(tableBloatStats)
          .where(
            and(
              eq(tableBloatStats.monitoredDbId, id),
              eq(tableBloatStats.capturedAt, latest.capturedAt)
            )
          )
          .orderBy(desc(tableBloatStats.deadTupRatio));

        return reply.send({
          tables: tables.map(serializeBloatRow),
          capturedAt: latest.capturedAt.toISOString(),
        });
      } catch (err) {
        request.log.error({ err }, "Failed to get vacuum stats");
        return reply.status(500).send({ error: "Failed to get vacuum stats" });
      }
    }
  );

  /**
   * GET /api/databases/:id/health
   * Latest database health snapshot + 24h history.
   */
  app.get<{ Params: { id: string } }>(
    "/api/databases/:id/health",
    async (request, reply) => {
      try {
        const { id } = request.params;

        // Latest snapshot
        const [latest] = await db
          .select()
          .from(dbHealthSnapshots)
          .where(eq(dbHealthSnapshots.monitoredDbId, id))
          .orderBy(desc(dbHealthSnapshots.capturedAt))
          .limit(1);

        // 24h history
        const since = new Date();
        since.setHours(since.getHours() - 24);

        const history = await db
          .select()
          .from(dbHealthSnapshots)
          .where(
            and(
              eq(dbHealthSnapshots.monitoredDbId, id),
              gte(dbHealthSnapshots.capturedAt, since)
            )
          )
          .orderBy(dbHealthSnapshots.capturedAt);

        return reply.send({
          current: latest ? serializeHealthRow(latest) : null,
          history: history.map(serializeHealthRow),
        });
      } catch (err) {
        request.log.error({ err }, "Failed to get health stats");
        return reply.status(500).send({ error: "Failed to get health stats" });
      }
    }
  );
}

function serializeBloatRow(row: typeof tableBloatStats.$inferSelect) {
  return {
    id: row.id,
    tableName: row.tableName,
    schemaName: row.schemaName,
    nLiveTup: row.nLiveTup,
    nDeadTup: row.nDeadTup,
    deadTupRatio: row.deadTupRatio,
    tableSizeBytes: row.tableSizeBytes,
    totalSizeBytes: row.totalSizeBytes,
    lastVacuum: row.lastVacuum?.toISOString() ?? null,
    lastAutovacuum: row.lastAutovacuum?.toISOString() ?? null,
    lastAnalyze: row.lastAnalyze?.toISOString() ?? null,
    lastAutoanalyze: row.lastAutoanalyze?.toISOString() ?? null,
    vacuumCount: row.vacuumCount,
    autovacuumCount: row.autovacuumCount,
    seqScan: row.seqScan,
    idxScan: row.idxScan,
    capturedAt: row.capturedAt.toISOString(),
  };
}

function serializeHealthRow(row: typeof dbHealthSnapshots.$inferSelect) {
  return {
    id: row.id,
    capturedAt: row.capturedAt.toISOString(),
    cacheHitRatio: row.cacheHitRatio,
    checkpointsRequested: row.checkpointsRequested,
    checkpointsTimed: row.checkpointsTimed,
    buffersCheckpoint: row.buffersCheckpoint,
    buffersBackend: row.buffersBackend,
    dbSizeBytes: row.dbSizeBytes,
    numBackends: row.numBackends,
    xactCommit: row.xactCommit,
    xactRollback: row.xactRollback,
    conflictsCount: row.conflictsCount,
    deadlocksCount: row.deadlocksCount,
    tempFileBytes: row.tempFileBytes,
  };
}
