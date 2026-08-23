import type { FastifyBaseLogger } from "fastify";
import { db, indexRecommendations, monitoredDatabases } from "@pgvitals/db";
import { eq, and } from "drizzle-orm";
import { decrypt } from "../lib/encryption.js";
import { safeQuery } from "../lib/safe-query.js";
import { config } from "../config.js";

/* ===================================================================
   Index Advisor — detects unused, missing, invalid, and redundant indexes
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

/** Row from pg_index for invalid index detection */
interface InvalidIndexRow {
  schemaname: string;
  relname: string;
  indexrelname: string;
  index_size: string;
  indisvalid: boolean;
  indisready: boolean;
  indexdef: string;
}

/** Row from redundant index detection */
interface RedundantIndexRow {
  schemaname: string;
  table_name: string;
  redundant_index_name: string;
  redundant_index_size: string;
  redundant_indexdef: string;
  covering_index_name: string;
  covering_index_size: string;
  covering_indexdef: string;
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
  AND i.indisvalid
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
 * Find INVALID indexes left behind by failed or cancelled CREATE INDEX CONCURRENTLY statements.
 */
const INVALID_INDEXES_QUERY = `
SELECT
  n.nspname AS schemaname,
  c.relname,
  i.relname AS indexrelname,
  pg_relation_size(i.oid)::text AS index_size,
  x.indisvalid,
  x.indisready,
  pg_get_indexdef(i.oid) AS indexdef
FROM pg_index x
JOIN pg_class c ON c.oid = x.indrelid
JOIN pg_class i ON i.oid = x.indexrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND (NOT x.indisvalid OR NOT x.indisready)
  AND c.relname NOT LIKE '_hyper_%'
  AND c.relname NOT LIKE '_timescaledb_%'
ORDER BY pg_relation_size(i.oid) DESC
LIMIT 50
`;

/**
 * Find REDUNDANT indexes where one index is a strict prefix duplicate of another covering index.
 */
const REDUNDANT_INDEXES_QUERY = `
WITH index_data AS (
  SELECT
    n.nspname AS schemaname,
    t.relname AS table_name,
    i.relname AS index_name,
    pg_relation_size(i.oid)::text AS index_size,
    pg_get_indexdef(i.oid) AS indexdef,
    ARRAY(
      SELECT pg_get_indexdef(i.oid, k + 1, true)
      FROM generate_subscripts(ind.indkey, 1) as k
      ORDER BY k
    ) AS index_columns,
    ind.indisunique,
    ind.indisprimary,
    ind.indpred IS NOT NULL AS is_partial
  FROM pg_index ind
  JOIN pg_class t ON t.oid = ind.indrelid
  JOIN pg_class i ON i.oid = ind.indexrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND ind.indisvalid
    AND t.relname NOT LIKE '_hyper_%'
    AND t.relname NOT LIKE '_timescaledb_%'
)
SELECT
  a.schemaname,
  a.table_name,
  a.index_name AS redundant_index_name,
  a.index_size AS redundant_index_size,
  a.indexdef AS redundant_indexdef,
  b.index_name AS covering_index_name,
  b.index_size AS covering_index_size,
  b.indexdef AS covering_indexdef
FROM index_data a
JOIN index_data b
  ON a.schemaname = b.schemaname
  AND a.table_name = b.table_name
  AND a.index_name <> b.index_name
  AND NOT a.indisprimary
  AND NOT a.indisunique
  AND a.is_partial = b.is_partial
  AND a.index_columns <@ b.index_columns
  AND a.index_columns[1] = b.index_columns[1]
  AND array_length(a.index_columns, 1) < array_length(b.index_columns, 1)
ORDER BY a.redundant_index_size::bigint DESC
LIMIT 30
`;

/* ---- Utility Functions ---- */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function computeImpact(indexSize: number, seqScans?: number): string {
  if (indexSize > 50 * 1024 * 1024) return "high"; // > 50MB
  if (indexSize > 10 * 1024 * 1024) return "medium";
  if (seqScans && seqScans > 100000) return "high";
  if (seqScans && seqScans > 10000) return "medium";
  return "low";
}

/**
 * Runs the full index advisor analysis on a monitored database.
 * Detects unused, missing, invalid, redundant, and bloated indexes.
 */
export async function analyzeIndexes(
  monitoredDbId: string,
  log: FastifyBaseLogger
): Promise<{ unusedCount: number; missingCount: number; invalidCount: number; redundantCount: number; bloatCount: number }> {
  const [monitoredDb] = await db
    .select()
    .from(monitoredDatabases)
    .where(eq(monitoredDatabases.id, monitoredDbId))
    .limit(1);

  if (!monitoredDb) {
    log.warn({ monitoredDbId }, "Monitored database not found for index advisor");
    return { unusedCount: 0, missingCount: 0, invalidCount: 0, redundantCount: 0, bloatCount: 0 };
  }

  const connectionString = decrypt(
    monitoredDb.connectionStringEncrypted,
    config.encryptionKey
  );

  log.info({ monitoredDbId }, "Running index advisor analysis");

  const unusedIndexes = await detectUnusedIndexes(monitoredDbId, connectionString, log);
  const missingIndexes = await detectMissingIndexes(monitoredDbId, connectionString, log);
  const invalidIndexes = await detectInvalidIndexes(monitoredDbId, connectionString, log);
  const redundantIndexes = await detectRedundantIndexes(monitoredDbId, connectionString, log);
  const bloatIndexes = await detectIndexBloat(monitoredDbId, connectionString, log);

  log.info(
    { monitoredDbId, unusedCount: unusedIndexes, missingCount: missingIndexes, invalidCount: invalidIndexes, redundantCount: redundantIndexes, bloatCount: bloatIndexes },
    "Index advisor analysis complete"
  );

  return {
    unusedCount: unusedIndexes,
    missingCount: missingIndexes,
    invalidCount: invalidIndexes,
    redundantCount: redundantIndexes,
    bloatCount: bloatIndexes,
  };
}

/**
 * Detects indexes with zero scans (not PKs/unique).
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
      suggestedDdl: `DROP INDEX CONCURRENTLY IF EXISTS "${row.indexrelname}";`,
      reason: `Index "${row.indexrelname}" on "${row.relname}" has 0 scans since last stats reset. It occupies ${formatBytes(indexSize)} and adds write overhead.`,
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

/**
 * Detects INVALID / non-ready indexes left behind by failed or aborted DDL.
 */
async function detectInvalidIndexes(
  monitoredDbId: string,
  connectionString: string,
  log: FastifyBaseLogger
): Promise<number> {
  let rows: InvalidIndexRow[];
  try {
    rows = await safeQuery<InvalidIndexRow[]>(
      connectionString,
      INVALID_INDEXES_QUERY,
      { timeoutMs: 15000 }
    );
  } catch (err) {
    log.warn({ err }, "Failed to query invalid indexes");
    return 0;
  }

  if (rows.length === 0) return 0;

  await db
    .delete(indexRecommendations)
    .where(
      and(
        eq(indexRecommendations.monitoredDbId, monitoredDbId),
        eq(indexRecommendations.recommendationType, "invalid"),
        eq(indexRecommendations.dismissed, false)
      )
    );

  const recommendations = rows.map((row) => {
    const indexSize = parseInt(row.index_size, 10) || 0;
    return {
      monitoredDbId,
      tableName: row.relname,
      indexName: row.indexrelname,
      recommendationType: "invalid" as const,
      suggestedDdl: `DROP INDEX CONCURRENTLY IF EXISTS "${row.indexrelname}";\n-- Or rebuild via:\n-- REINDEX INDEX CONCURRENTLY "${row.indexrelname}";`,
      reason: `Index "${row.indexrelname}" on "${row.relname}" is marked INVALID (indisvalid: ${row.indisvalid}, indisready: ${row.indisready}). It consumes ${formatBytes(indexSize)} of storage and degrades every INSERT/UPDATE write, but cannot be used by the query planner.`,
      impact: "high",
      metadata: {
        schemaname: row.schemaname,
        index_size_bytes: indexSize,
        indisvalid: row.indisvalid,
        indisready: row.indisready,
        indexdef: row.indexdef,
      },
    };
  });

  await db.insert(indexRecommendations).values(recommendations);
  return recommendations.length;
}

/**
 * Detects REDUNDANT / strict-prefix duplicate indexes.
 */
async function detectRedundantIndexes(
  monitoredDbId: string,
  connectionString: string,
  log: FastifyBaseLogger
): Promise<number> {
  let rows: RedundantIndexRow[];
  try {
    rows = await safeQuery<RedundantIndexRow[]>(
      connectionString,
      REDUNDANT_INDEXES_QUERY,
      { timeoutMs: 15000 }
    );
  } catch (err) {
    log.warn({ err }, "Failed to query redundant indexes");
    return 0;
  }

  if (rows.length === 0) return 0;

  await db
    .delete(indexRecommendations)
    .where(
      and(
        eq(indexRecommendations.monitoredDbId, monitoredDbId),
        eq(indexRecommendations.recommendationType, "redundant"),
        eq(indexRecommendations.dismissed, false)
      )
    );

  const recommendations = rows.map((row) => {
    const indexSize = parseInt(row.redundant_index_size, 10) || 0;
    return {
      monitoredDbId,
      tableName: row.table_name,
      indexName: row.redundant_index_name,
      recommendationType: "redundant" as const,
      suggestedDdl: `DROP INDEX CONCURRENTLY IF EXISTS "${row.redundant_index_name}";`,
      reason: `Index "${row.redundant_index_name}" (${formatBytes(indexSize)}) is redundant because "${row.covering_index_name}" already covers its leading columns. Dropping it eliminates write amplification without losing query performance.`,
      impact: computeImpact(indexSize),
      metadata: {
        schemaname: row.schemaname,
        redundant_index_name: row.redundant_index_name,
        redundant_index_size: indexSize,
        redundant_indexdef: row.redundant_indexdef,
        covering_index_name: row.covering_index_name,
        covering_index_size: parseInt(row.covering_index_size, 10) || 0,
        covering_indexdef: row.covering_indexdef,
      },
    };
  });

  await db.insert(indexRecommendations).values(recommendations);
  return recommendations.length;
}

/** Row from btree index bloat query */
interface IndexBloatRow {
  schemaname: string;
  table_name: string;
  index_name: string;
  index_size_bytes: string;
  page_count: number;
  estimated_pages: number;
  bloat_ratio_pct: string | number;
  bloat_bytes: string;
}

/**
 * Estimates B-Tree index page bloat by comparing allocated pages to estimated live tuple packing.
 */
const INDEX_BLOAT_QUERY = `
WITH btree_index_stats AS (
  SELECT
    current_database() as datname,
    n.nspname as schemaname,
    t.relname as table_name,
    i.relname as index_name,
    c.reltuples as num_rows,
    c.relpages as page_count,
    pg_relation_size(c.oid) as index_size_bytes,
    COALESCE(
      ceil(c.reltuples * (
        8 + (
          SELECT COALESCE(sum(s.avg_width), 8)
          FROM pg_attribute a
          JOIN pg_stats s ON s.schemaname = n.nspname AND s.tablename = t.relname AND s.attname = a.attname
          WHERE a.attrelid = t.oid AND a.attnum = ANY(string_to_array(ind.indkey::text, ' ')::int[])
        )
      ) / (8192 - 240)),
      1
    ) AS estimated_pages
  FROM pg_index ind
  JOIN pg_class i ON i.oid = ind.indexrelid
  JOIN pg_class t ON t.oid = ind.indrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  JOIN pg_am am ON am.oid = i.relam
  JOIN pg_class c ON c.oid = ind.indexrelid
  WHERE am.amname = 'btree'
    AND n.nspname = 'public'
    AND c.relpages > 10
    AND ind.indisvalid
    AND t.relname NOT LIKE '_hyper_%'
    AND t.relname NOT LIKE '_timescaledb_%'
)
SELECT
  schemaname,
  table_name,
  index_name,
  index_size_bytes::text,
  page_count,
  estimated_pages,
  CASE
    WHEN page_count > estimated_pages THEN
      round((1.0 - (estimated_pages::numeric / page_count::numeric)) * 100, 1)
    ELSE 0
  END as bloat_ratio_pct,
  CASE
    WHEN page_count > estimated_pages THEN
      ((page_count - estimated_pages) * 8192)::text
    ELSE '0'
  END as bloat_bytes
FROM btree_index_stats
WHERE page_count > estimated_pages * 1.3
  AND (page_count - estimated_pages) * 8192 > 10485760
ORDER BY ((page_count - estimated_pages) * 8192) DESC
LIMIT 30;
`;

/**
 * Detects bloated B-Tree indexes and recommends REINDEX INDEX CONCURRENTLY.
 */
async function detectIndexBloat(
  monitoredDbId: string,
  connectionString: string,
  log: FastifyBaseLogger
): Promise<number> {
  let rows: IndexBloatRow[];
  try {
    rows = await safeQuery<IndexBloatRow[]>(
      connectionString,
      INDEX_BLOAT_QUERY,
      { timeoutMs: 15000 }
    );
  } catch (err) {
    log.warn({ err }, "Failed to query index bloat stats");
    return 0;
  }

  if (rows.length === 0) return 0;

  await db
    .delete(indexRecommendations)
    .where(
      and(
        eq(indexRecommendations.monitoredDbId, monitoredDbId),
        eq(indexRecommendations.recommendationType, "bloat"),
        eq(indexRecommendations.dismissed, false)
      )
    );

  const recommendations = rows.map((row) => {
    const bloatBytes = parseInt(row.bloat_bytes, 10) || 0;
    const totalSize = parseInt(row.index_size_bytes, 10) || 0;
    const bloatPct = typeof row.bloat_ratio_pct === "number" ? row.bloat_ratio_pct : parseFloat(row.bloat_ratio_pct) || 0;

    return {
      monitoredDbId,
      tableName: row.table_name,
      indexName: row.index_name,
      recommendationType: "bloat" as const,
      suggestedDdl: `REINDEX INDEX CONCURRENTLY "${row.index_name}";`,
      reason: `B-Tree index "${row.index_name}" on "${row.table_name}" is estimated to be ${bloatPct}% bloated (${formatBytes(bloatBytes)} wasted of ${formatBytes(totalSize)} total). Running a concurrent reindex will defragment pages and speed up index lookups.`,
      impact: bloatBytes > 50 * 1024 * 1024 ? "high" : "medium",
      metadata: {
        schemaname: row.schemaname,
        bloat_bytes: bloatBytes,
        bloat_pct: bloatPct,
        index_size_bytes: totalSize,
        page_count: row.page_count,
        estimated_pages: row.estimated_pages,
      },
    };
  });

  await db.insert(indexRecommendations).values(recommendations);
  return recommendations.length;
}
