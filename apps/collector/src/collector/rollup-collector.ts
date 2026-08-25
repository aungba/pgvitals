import type { FastifyBaseLogger } from "fastify";
import { db, snapshots, queryStats, metricRollups } from "@pgvitals/db";
import { eq, and, gte, lte, sql } from "drizzle-orm";

export interface RollupComputationResult {
  monitoredDbId: string;
  resolution: "5m" | "1h" | "1d";
  bucket: Date;
  activeConnectionsAvg: number | null;
  activeConnectionsMax: number | null;
  connectionCountAvg: number | null;
  connectionCountMax: number | null;
  idleInTxnMax: number | null;
  avgQueryTimeMs: number | null;
  maxQueryTimeMs: number | null;
  totalCalls: number | null;
}

/**
 * Computes rollups for a database over a given window and inserts into metricRollups table.
 */
export async function computeRollupForDb(
  monitoredDbId: string,
  resolution: "5m" | "1h" | "1d",
  bucketStart: Date,
  bucketEnd: Date,
  log?: FastifyBaseLogger
): Promise<RollupComputationResult | null> {
  try {
    // 1. Aggregate connection snapshots
    const [snapshotAgg] = await db
      .select({
        activeAvg: sql<number | null>`AVG(${snapshots.activeCount})`,
        activeMax: sql<number | null>`MAX(${snapshots.activeCount})`,
        connAvg: sql<number | null>`AVG(${snapshots.connectionCount})`,
        connMax: sql<number | null>`MAX(${snapshots.connectionCount})`,
        idleInTxnMax: sql<number | null>`MAX(${snapshots.idleInTxnCount})`,
      })
      .from(snapshots)
      .where(
        and(
          eq(snapshots.monitoredDbId, monitoredDbId),
          gte(snapshots.timestamp, bucketStart),
          lte(snapshots.timestamp, bucketEnd)
        )
      );

    // 2. Aggregate query stats
    const [queryAgg] = await db
      .select({
        avgTime: sql<number | null>`AVG(${queryStats.meanTimeMs})`,
        maxTime: sql<number | null>`MAX(${queryStats.maxTimeMs})`,
        sumCalls: sql<number | null>`SUM(${queryStats.calls})`,
      })
      .from(queryStats)
      .where(
        and(
          eq(queryStats.monitoredDbId, monitoredDbId),
          gte(queryStats.capturedAt, bucketStart),
          lte(queryStats.capturedAt, bucketEnd)
        )
      );

    // If no snapshots were found in this window, skip
    if (!snapshotAgg || snapshotAgg.connMax === null) {
      return null;
    }

    const result: RollupComputationResult = {
      monitoredDbId,
      resolution,
      bucket: bucketStart,
      activeConnectionsAvg: snapshotAgg.activeAvg
        ? Number(Number(snapshotAgg.activeAvg).toFixed(2))
        : null,
      activeConnectionsMax: snapshotAgg.activeMax
        ? Number(snapshotAgg.activeMax)
        : null,
      connectionCountAvg: snapshotAgg.connAvg
        ? Number(Number(snapshotAgg.connAvg).toFixed(2))
        : null,
      connectionCountMax: snapshotAgg.connMax
        ? Number(snapshotAgg.connMax)
        : null,
      idleInTxnMax: snapshotAgg.idleInTxnMax
        ? Number(snapshotAgg.idleInTxnMax)
        : null,
      avgQueryTimeMs: queryAgg?.avgTime
        ? Number(Number(queryAgg.avgTime).toFixed(2))
        : null,
      maxQueryTimeMs: queryAgg?.maxTime ? Number(queryAgg.maxTime) : null,
      totalCalls: queryAgg?.sumCalls ? Number(queryAgg.sumCalls) : 0,
    };

    await db.insert(metricRollups).values({
      monitoredDbId: result.monitoredDbId,
      resolution: result.resolution,
      bucket: result.bucket,
      activeConnectionsAvg: result.activeConnectionsAvg,
      activeConnectionsMax: result.activeConnectionsMax,
      connectionCountAvg: result.connectionCountAvg,
      connectionCountMax: result.connectionCountMax,
      idleInTxnMax: result.idleInTxnMax,
      avgQueryTimeMs: result.avgQueryTimeMs,
      maxQueryTimeMs: result.maxQueryTimeMs,
      totalCalls: result.totalCalls,
    });

    log?.info(
      { monitoredDbId, resolution, bucket: bucketStart.toISOString() },
      "Computed and saved metric rollup"
    );

    return result;
  } catch (err) {
    log?.error(
      { err, monitoredDbId, resolution },
      "Failed to compute metric rollup"
    );
    return null;
  }
}
