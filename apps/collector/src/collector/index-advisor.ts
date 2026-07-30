import type { FastifyBaseLogger } from "fastify";
import { db, indexRecommendations, monitoredDatabases } from "@pgvitals/db";
import { eq, and } from "drizzle-orm";
import { decrypt } from "../lib/encryption.js";
import { safeQuery } from "../lib/safe-query.js";
import { config } from "../config.js";

/* ===================================================================
   Index Advisor — detects unused indexes + suggests missing indexes
   =================================================================== */

/** Row from pg_stat_user_indexes for unused index detection */
interface UnusedIndexRow {
  schemaname: string;
  relname: string;
  indexrelname: string;
  idx_scan: string;
  idx_tup_read: string;
  index_size: string;
  indexdef: string;
}

/** Row from pg_stat_user_tables for missing index detection */
interface MissingIndexCandidate {
  schemaname: string;
  relname: string;
  seq_scan: string;
  seq_tup_read: string;
  idx_scan: string;
  n_live_tup: string;
  table_size: string;
}

/* ---- SQL Queries ---- */

/**
 * Find indexes with zero scans that are NOT primary keys or unique constraints.
 * Filters to public schema, ignores system catalogs and TimescaleDB internals.
 */
const UNUSED_INDEXES_QUERY = `
SELECT
  s.schemaname,
  s.relname,
  s.indexrelname,
  s.idx_scan::text,
  s.idx_tup_read::text,
  pg_relation_size(s.indexrelid)::text AS index_size,
  pg_get_indexdef(s.indexrelid) AS indexdef
FROM pg_stat_user_indexes s
JOIN pg_index i ON s.indexrelid = i.indexrelid
WHERE s.idx_scan = 0
  AND NOT i.indisprimary
  AND NOT i.indisunique
  AND s.schemaname = 'public'
  AND s.relname NOT LIKE '_hyper_%'
  AND s.relname NOT LIKE '_timescaledb_%'
ORDER BY pg_relation_size(s.indexrelid) DESC
LIMIT 50
`;

/**
 * Find tables with high sequential scan counts and large row counts
 * that might benefit from indexes.
 */
const MISSING_INDEX_CANDIDATES_QUERY = `
SELECT
  schemaname,
  relname,
  seq_scan::text,
  seq_tup_read::text,
  idx_scan::text,
  n_live_tup::text,
  pg_total_relation_size(relid)::text AS table_size
FROM pg_stat_user_tables
WHERE schemaname = 'public'
  AND n_live_tup > 1000
  AND seq_scan > COALESCE(idx_scan, 0)
  AND relname NOT LIKE '_hyper_%'
  AND relname NOT LIKE '_timescaledb_%'
ORDER BY seq_scan DESC
LIMIT 30
`;

/**
 * Get column usage stats from pg_stats + pg_stat_user_indexes
 * to help determine which columns to suggest indexes on.
 */
const TABLE_COLUMNS_QUERY = `
SELECT
  a.attname AS column_name,
  t.typname AS data_type,
  s.n_distinct,
  s.null_frac,
  s.correlation
FROM pg_attribute a
JOIN pg_type t ON a.atttypid = t.oid
LEFT JOIN pg_stats s ON s.tablename = $1 AND s.attname = a.attname AND s.schemaname = 'public'
WHERE a.attrelid = ($2 || '.' || $1)::regclass
  AND a.attnum > 0
  AND NOT a.attisdropped
ORDER BY a.attnum
`;

/* ---- Utility Functions ---- */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function computeImpact(indexSize: number, seqScans?: number): string {
  if (indexSize > 50 * 1024 * 1024) return "high"; // > 50MB unused index
  if (indexSize > 10 * 1024 * 1024) return "medium";
  if (seqScans && seqScans > 100000) return "high";
  if (seqScans && seqScans > 10000) return "medium";
  return "low";
}

/**
 * Runs the full index advisor analysis on a monitored database.
 * Detects unused indexes and suggests missing index candidates.
 */
export async function analyzeIndexes(
  monitoredDbId: string,
  log: FastifyBaseLogger
): Promise<{ unusedCount: number; missingCount: number }> {
  // 1. Fetch the monitored database record
  const [monitoredDb] = await db
    .select()
    .from(monitoredDatabases)
    .where(eq(monitoredDatabases.id, monitoredDbId))
    .limit(1);

  if (!monitoredDb) {
    log.warn({ monitoredDbId }, "Monitored database not found for index advisor");
    return { unusedCount: 0, missingCount: 0 };
  }

  const connectionString = decrypt(
    monitoredDb.connectionStringEncrypted,
    config.encryptionKey
  );

  log.info({ monitoredDbId }, "Running index advisor analysis");

  // 2. Detect unused indexes
  const unusedIndexes = await detectUnusedIndexes(monitoredDbId, connectionString, log);

  // 3. Detect missing index candidates
  const missingIndexes = await detectMissingIndexes(monitoredDbId, connectionString, log);

  log.info(
    { monitoredDbId, unusedCount: unusedIndexes, missingCount: missingIndexes },
    "Index advisor analysis complete"
  );

  return { unusedCount: unusedIndexes, missingCount: missingIndexes };
}

/**
 * Detects indexes with zero scans (not PKs/unique).
 * Creates "unused" recommendations.
 */
async function detectUnusedIndexes(
  monitoredDbId: string,
  connectionString: string,
  log: FastifyBaseLogger
): Promise<number> {
  let rows: UnusedIndexRow[];
  try {
    rows = await safeQuery<UnusedIndexRow[]>(
      connectionString,
      UNUSED_INDEXES_QUERY,
      { timeoutMs: 15000 }
    );
  } catch (err) {
    log.warn({ err }, "Failed to query unused indexes");
    return 0;
  }

  if (rows.length === 0) return 0;

  // Clear previous un-dismissed unused recommendations for this DB
  // (we regenerate fresh each run)
  await db
    .delete(indexRecommendations)
    .where(
      and(
        eq(indexRecommendations.monitoredDbId, monitoredDbId),
        eq(indexRecommendations.recommendationType, "unused"),
        eq(indexRecommendations.dismissed, false)
      )
    );

  const recommendations = rows.map((row) => {
    const indexSize = parseInt(row.index_size, 10) || 0;
    return {
      monitoredDbId,
      tableName: row.relname,
      indexName: row.indexrelname,
      recommendationType: "unused" as const,
      suggestedDdl: `DROP INDEX IF EXISTS "${row.indexrelname}";`,
      reason: `Index "${row.indexrelname}" on "${row.relname}" has 0 scans since last stats reset. It occupies ${formatBytes(indexSize)} and adds overhead to writes.`,
      impact: computeImpact(indexSize),
      metadata: {
        schemaname: row.schemaname,
        idx_scan: parseInt(row.idx_scan, 10),
        idx_tup_read: parseInt(row.idx_tup_read, 10),
        index_size_bytes: indexSize,
        indexdef: row.indexdef,
      },
    };
  });

  await db.insert(indexRecommendations).values(recommendations);
  return recommendations.length;
}

/**
 * Detects tables with high sequential scan counts and large row counts.
 * Creates "missing" recommendations with suggested CREATE INDEX statements.
 */
async function detectMissingIndexes(
  monitoredDbId: string,
  connectionString: string,
  log: FastifyBaseLogger
): Promise<number> {
  let candidates: MissingIndexCandidate[];
  try {
    candidates = await safeQuery<MissingIndexCandidate[]>(
      connectionString,
      MISSING_INDEX_CANDIDATES_QUERY,
      { timeoutMs: 15000 }
    );
  } catch (err) {
    log.warn({ err }, "Failed to query missing index candidates");
    return 0;
  }

  if (candidates.length === 0) return 0;

  // Clear previous un-dismissed missing recommendations for this DB
  await db
    .delete(indexRecommendations)
    .where(
      and(
        eq(indexRecommendations.monitoredDbId, monitoredDbId),
        eq(indexRecommendations.recommendationType, "missing"),
        eq(indexRecommendations.dismissed, false)
      )
    );

  const recommendations = candidates.map((c) => {
    const seqScan = parseInt(c.seq_scan, 10) || 0;
    const idxScan = parseInt(c.idx_scan, 10) || 0;
    const nLiveTup = parseInt(c.n_live_tup, 10) || 0;
    const tableSize = parseInt(c.table_size, 10) || 0;
    const seqRatio = seqScan + idxScan > 0
      ? Math.round((seqScan / (seqScan + idxScan)) * 100)
      : 100;

    return {
      monitoredDbId,
      tableName: c.relname,
      indexName: null,
      recommendationType: "missing" as const,
      suggestedDdl: `-- Consider adding an index on frequently filtered columns:\n-- CREATE INDEX CONCURRENTLY idx_${c.relname}_<column> ON "${c.relname}" (<column>);`,
      reason: `Table "${c.relname}" has ${seqScan.toLocaleString()} sequential scans (${seqRatio}% of total scans) with ${nLiveTup.toLocaleString()} live rows (${formatBytes(tableSize)}). Adding indexes on commonly filtered columns could improve performance significantly.`,
      impact: computeImpact(0, seqScan),
      metadata: {
        schemaname: c.schemaname,
        seq_scan: seqScan,
        seq_tup_read: parseInt(c.seq_tup_read, 10) || 0,
        idx_scan: idxScan,
        n_live_tup: nLiveTup,
        table_size_bytes: tableSize,
        seq_ratio_pct: seqRatio,
      },
    };
  });

  await db.insert(indexRecommendations).values(recommendations);
  return recommendations.length;
}
