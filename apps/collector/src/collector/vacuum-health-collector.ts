import type { FastifyBaseLogger } from "fastify";
import { db, tableBloatStats, dbHealthSnapshots, tableSizeHistory, monitoredDatabases } from "@pgvitals/db";
import { eq, and, gte, desc } from "drizzle-orm";
import { decrypt } from "../lib/encryption.js";
import { safeQuery } from "../lib/safe-query.js";
import { config } from "../config.js";

/* ===================================================================
   VACUUM & Health Collector — Phase 6
   =================================================================== */

/** Row from pg_stat_user_tables */
interface TableStatsRow {
  schemaname: string;
  relname: string;
  n_live_tup: string;
  n_dead_tup: string;
  table_size: string;
  total_size: string;
  last_vacuum: string | null;
  last_autovacuum: string | null;
  last_analyze: string | null;
  last_autoanalyze: string | null;
  vacuum_count: string;
  autovacuum_count: string;
  seq_scan: string;
  idx_scan: string;
}

/** Row from pg_stat_database */
interface DbStatsRow {
  numbackends: string;
  xact_commit: string;
  xact_rollback: string;
  conflicts: string;
  deadlocks: string;
  temp_bytes: string;
  db_size: string;
}

/** Row from pg_stat_bgwriter */
interface BgWriterRow {
  checkpoints_req: string;
  checkpoints_timed: string;
  buffers_checkpoint: string;
  buffers_backend: string;
}

/* ---- SQL Queries ---- */

const TABLE_STATS_QUERY = `
SELECT
  schemaname,
  relname,
  n_live_tup::text,
  n_dead_tup::text,
  pg_relation_size(relid)::text AS table_size,
  pg_total_relation_size(relid)::text AS total_size,
  last_vacuum::text,
  last_autovacuum::text,
  last_analyze::text,
  last_autoanalyze::text,
  vacuum_count::text,
  autovacuum_count::text,
  seq_scan::text,
  COALESCE(idx_scan, 0)::text AS idx_scan
FROM pg_stat_user_tables
WHERE schemaname = 'public'
  AND relname NOT LIKE '_hyper_%'
  AND relname NOT LIKE '_timescaledb_%'
ORDER BY n_dead_tup DESC
LIMIT 100
`;

const TABLE_CACHE_HIT_QUERY = `
SELECT
  schemaname,
  relname,
  CASE WHEN (heap_blks_hit + heap_blks_read) > 0
    THEN round(heap_blks_hit::numeric / (heap_blks_hit + heap_blks_read)::numeric * 100, 2)
    ELSE NULL
  END AS cache_hit_ratio,
  CASE WHEN (COALESCE(idx_blks_hit, 0) + COALESCE(idx_blks_read, 0)) > 0
    THEN round(COALESCE(idx_blks_hit, 0)::numeric / (COALESCE(idx_blks_hit, 0) + COALESCE(idx_blks_read, 0))::numeric * 100, 2)
    ELSE NULL
  END AS idx_cache_hit_ratio
FROM pg_statio_user_tables
WHERE schemaname = 'public'
`;

const TABLE_SIZE_QUERY = `
SELECT
  schemaname,
  relname,
  pg_relation_size(relid)::text AS table_size,
  pg_indexes_size(relid)::text AS index_size,
  pg_total_relation_size(relid)::text AS total_size
FROM pg_stat_user_tables
WHERE schemaname = 'public'
  AND relname NOT LIKE '_hyper_%'
  AND relname NOT LIKE '_timescaledb_%'
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 100
`;

const CACHE_HIT_RATIO_QUERY = `
SELECT
  CASE WHEN (blks_hit + blks_read) > 0
    THEN round(blks_hit::numeric / (blks_hit + blks_read)::numeric * 100, 2)
    ELSE 100
  END AS cache_hit_ratio
FROM pg_stat_database
WHERE datname = current_database()
`;

const DB_STATS_QUERY = `
SELECT
  numbackends::text,
  xact_commit::text,
  xact_rollback::text,
  conflicts::text,
  deadlocks::text,
  temp_bytes::text,
  pg_database_size(current_database())::text AS db_size
FROM pg_stat_database
WHERE datname = current_database()
`;

const BGWRITER_QUERY = `
SELECT
  checkpoints_req::text,
  checkpoints_timed::text,
  buffers_checkpoint::text,
  buffers_backend::text
FROM pg_stat_bgwriter
`;

const XID_AGE_QUERY = `
SELECT
  age(datfrozenxid)::text AS xid_age
FROM pg_database
WHERE datname = current_database()
`;

const FREEZE_MAX_AGE_QUERY = `
SHOW autovacuum_freeze_max_age
`;

/** Per-table cache hit ratio row */
interface TableCacheRow {
  schemaname: string;
  relname: string;
  cache_hit_ratio: string | null;
  idx_cache_hit_ratio: string | null;
}

/** Table size row */
interface TableSizeRow {
  schemaname: string;
  relname: string;
  table_size: string;
  index_size: string;
  total_size: string;
}

/**
 * Collects table-level vacuum/bloat stats and database health metrics.
 */
export async function collectVacuumHealth(
  monitoredDbId: string,
  log: FastifyBaseLogger
): Promise<void> {
  const [monitoredDb] = await db
    .select()
    .from(monitoredDatabases)
    .where(eq(monitoredDatabases.id, monitoredDbId))
    .limit(1);

  if (!monitoredDb) {
    log.warn({ monitoredDbId }, "DB not found for vacuum health collection");
    return;
  }

  const connectionString = decrypt(
    monitoredDb.connectionStringEncrypted,
    config.encryptionKey
  );

  log.info({ monitoredDbId }, "Collecting vacuum & health stats");

  const now = new Date();

  // 1. Collect table bloat stats
  try {
    const tableRows = await safeQuery<TableStatsRow[]>(
      connectionString,
      TABLE_STATS_QUERY,
      { timeoutMs: 15000 }
    );

      if (tableRows.length > 0) {
        // Fetch per-table cache hit ratios
        let cacheHitMap: Map<string, { cacheHitRatio: number | null; idxCacheHitRatio: number | null }> = new Map();
        try {
          const cacheRows = await safeQuery<TableCacheRow[]>(
            connectionString,
            TABLE_CACHE_HIT_QUERY,
            { timeoutMs: 10000 }
          );
          for (const cr of cacheRows) {
            cacheHitMap.set(cr.relname, {
              cacheHitRatio: cr.cache_hit_ratio ? parseFloat(cr.cache_hit_ratio) : null,
              idxCacheHitRatio: cr.idx_cache_hit_ratio ? parseFloat(cr.idx_cache_hit_ratio) : null,
            });
          }
        } catch (err) {
          log.debug({ err, monitoredDbId }, "Failed to collect per-table cache hit ratios");
        }

        const bloatRows = tableRows.map((r) => {
          const nLive = parseInt(r.n_live_tup, 10) || 0;
          const nDead = parseInt(r.n_dead_tup, 10) || 0;
          const deadRatio = nLive + nDead > 0
            ? Math.round((nDead / (nLive + nDead)) * 10000) / 100
            : 0;
          const cacheData = cacheHitMap.get(r.relname);

          return {
            monitoredDbId,
            capturedAt: now,
            tableName: r.relname,
            schemaName: r.schemaname,
            nLiveTup: nLive,
            nDeadTup: nDead,
            deadTupRatio: deadRatio,
            tableSizeBytes: parseInt(r.table_size, 10) || 0,
            totalSizeBytes: parseInt(r.total_size, 10) || 0,
            lastVacuum: r.last_vacuum ? new Date(r.last_vacuum) : null,
            lastAutovacuum: r.last_autovacuum ? new Date(r.last_autovacuum) : null,
            lastAnalyze: r.last_analyze ? new Date(r.last_analyze) : null,
            lastAutoanalyze: r.last_autoanalyze ? new Date(r.last_autoanalyze) : null,
            vacuumCount: parseInt(r.vacuum_count, 10) || 0,
            autovacuumCount: parseInt(r.autovacuum_count, 10) || 0,
            seqScan: parseInt(r.seq_scan, 10) || 0,
            idxScan: parseInt(r.idx_scan, 10) || 0,
            cacheHitRatio: cacheData?.cacheHitRatio ?? null,
            idxCacheHitRatio: cacheData?.idxCacheHitRatio ?? null,
          };
        });

      await db.insert(tableBloatStats).values(bloatRows);
      log.info({ monitoredDbId, tableCount: bloatRows.length }, "Table bloat stats collected");
    }
  } catch (err) {
    log.warn({ err, monitoredDbId }, "Failed to collect table bloat stats");
  }

  // 1b. Collect table size history for growth forecasting
  try {
    const sizeRows = await safeQuery<TableSizeRow[]>(
      connectionString,
      TABLE_SIZE_QUERY,
      { timeoutMs: 15000 }
    );

    if (sizeRows.length > 0) {
      const DISK_LIMIT_BYTES = parseInt(process.env.DISK_LIMIT_BYTES ?? "107374182400", 10); // default 100GB
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const sizeHistoryRows = [];
      for (const r of sizeRows) {
        const currentTotalSize = parseInt(r.total_size, 10) || 0;

        // Compute 7-day growth rate
        let growthRateBytesPerDay: number | null = null;
        let projectedDaysToDiskLimit: number | null = null;

        try {
          const [oldestEntry] = await db
            .select()
            .from(tableSizeHistory)
            .where(
              and(
                eq(tableSizeHistory.monitoredDbId, monitoredDbId),
                eq(tableSizeHistory.tableName, r.relname),
                gte(tableSizeHistory.capturedAt, sevenDaysAgo)
              )
            )
            .orderBy(tableSizeHistory.capturedAt)
            .limit(1);

          if (oldestEntry) {
            const daysDiff = (now.getTime() - oldestEntry.capturedAt.getTime()) / (1000 * 60 * 60 * 24);
            if (daysDiff > 0.5) {
              growthRateBytesPerDay = (currentTotalSize - oldestEntry.totalSizeBytes) / daysDiff;
              if (growthRateBytesPerDay > 0) {
                const remainingBytes = DISK_LIMIT_BYTES - currentTotalSize;
                projectedDaysToDiskLimit = Math.max(0, Math.floor(remainingBytes / growthRateBytesPerDay));
              }
            }
          }
        } catch {
          // Skip growth computation if comparison fails
        }

        sizeHistoryRows.push({
          monitoredDbId,
          capturedAt: now,
          tableName: r.relname,
          schemaName: r.schemaname,
          tableSizeBytes: parseInt(r.table_size, 10) || 0,
          indexSizeBytes: parseInt(r.index_size, 10) || 0,
          totalSizeBytes: currentTotalSize,
          growthRateBytesPerDay,
          projectedDaysToDiskLimit,
        });
      }

      await db.insert(tableSizeHistory).values(sizeHistoryRows);
      log.info({ monitoredDbId, tableCount: sizeHistoryRows.length }, "Table size history collected");
    }
  } catch (err) {
    log.warn({ err, monitoredDbId }, "Failed to collect table size history");
  }

  // 2. Collect database-level health metrics
  try {
    const [cacheRow] = await safeQuery<Array<{ cache_hit_ratio: string }>>(
      connectionString,
      CACHE_HIT_RATIO_QUERY,
      { timeoutMs: 5000 }
    );
    const cacheHitRatio = parseFloat(cacheRow?.cache_hit_ratio ?? "0");

    const [dbStats] = await safeQuery<DbStatsRow[]>(
      connectionString,
      DB_STATS_QUERY,
      { timeoutMs: 5000 }
    );

    let bgWriter: BgWriterRow | undefined;
    try {
      const [row] = await safeQuery<BgWriterRow[]>(
        connectionString,
        BGWRITER_QUERY,
        { timeoutMs: 5000 }
      );
      bgWriter = row;
    } catch {
      // pg_stat_bgwriter might not be accessible
    }

    await db.insert(dbHealthSnapshots).values({
      monitoredDbId,
      capturedAt: now,
      cacheHitRatio,
      checkpointsRequested: bgWriter ? parseInt(bgWriter.checkpoints_req, 10) || 0 : null,
      checkpointsTimed: bgWriter ? parseInt(bgWriter.checkpoints_timed, 10) || 0 : null,
      buffersCheckpoint: bgWriter ? parseInt(bgWriter.buffers_checkpoint, 10) || 0 : null,
      buffersBackend: bgWriter ? parseInt(bgWriter.buffers_backend, 10) || 0 : null,
      dbSizeBytes: dbStats ? parseInt(dbStats.db_size, 10) || 0 : null,
      numBackends: dbStats ? parseInt(dbStats.numbackends, 10) || 0 : null,
      xactCommit: dbStats ? parseInt(dbStats.xact_commit, 10) || 0 : null,
      xactRollback: dbStats ? parseInt(dbStats.xact_rollback, 10) || 0 : null,
      conflictsCount: dbStats ? parseInt(dbStats.conflicts, 10) || 0 : null,
      deadlocksCount: dbStats ? parseInt(dbStats.deadlocks, 10) || 0 : null,
      tempFileBytes: dbStats ? parseInt(dbStats.temp_bytes, 10) || 0 : null,
      xidAge: null,
      autovacuumFreezeMaxAge: null,
      xidPercentUsed: null,
    });

    // 2b. Collect XID wraparound data
    try {
      const [xidRow] = await safeQuery<Array<{ xid_age: string }>>(
        connectionString,
        XID_AGE_QUERY,
        { timeoutMs: 5000 }
      );
      const [freezeRow] = await safeQuery<Array<{ autovacuum_freeze_max_age: string }>>(
        connectionString,
        FREEZE_MAX_AGE_QUERY,
        { timeoutMs: 5000 }
      );

      if (xidRow && freezeRow) {
        const xidAge = parseInt(xidRow.xid_age, 10) || 0;
        const freezeMaxAge = parseInt(freezeRow.autovacuum_freeze_max_age, 10) || 200000000;
        const xidPercentUsed = freezeMaxAge > 0
          ? Math.round((xidAge / freezeMaxAge) * 10000) / 100
          : 0;

        // Update the row we just inserted with XID data
        // Use raw SQL update on the latest row
        await db
          .update(dbHealthSnapshots)
          .set({
            xidAge,
            autovacuumFreezeMaxAge: freezeMaxAge,
            xidPercentUsed,
          })
          .where(
            and(
              eq(dbHealthSnapshots.monitoredDbId, monitoredDbId),
              eq(dbHealthSnapshots.capturedAt, now)
            )
          );

        log.info({ monitoredDbId, xidAge, freezeMaxAge, xidPercentUsed }, "XID wraparound data collected");
      }
    } catch (err) {
      log.debug({ err, monitoredDbId }, "Failed to collect XID wraparound data (may require superuser)");
    }

    log.info({ monitoredDbId, cacheHitRatio }, "DB health snapshot collected");
  } catch (err) {
    log.warn({ err, monitoredDbId }, "Failed to collect db health stats");
  }
}
