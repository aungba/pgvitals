import type { FastifyBaseLogger } from "fastify";
import { db, tableBloatStats, dbHealthSnapshots, monitoredDatabases } from "@pgvitals/db";
import { eq } from "drizzle-orm";
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
      const bloatRows = tableRows.map((r) => {
        const nLive = parseInt(r.n_live_tup, 10) || 0;
        const nDead = parseInt(r.n_dead_tup, 10) || 0;
        const deadRatio = nLive + nDead > 0
          ? Math.round((nDead / (nLive + nDead)) * 10000) / 100
          : 0;

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
        };
      });

      await db.insert(tableBloatStats).values(bloatRows);
      log.info({ monitoredDbId, tableCount: bloatRows.length }, "Table bloat stats collected");
    }
  } catch (err) {
    log.warn({ err, monitoredDbId }, "Failed to collect table bloat stats");
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
    });

    log.info({ monitoredDbId, cacheHitRatio }, "DB health snapshot collected");
  } catch (err) {
    log.warn({ err, monitoredDbId }, "Failed to collect db health stats");
  }
}
