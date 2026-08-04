import type { FastifyBaseLogger } from "fastify";
import { db, queryStats, monitoredDatabases } from "@pgvitals/db";
import { eq } from "drizzle-orm";
import { decrypt } from "../lib/encryption.js";
import { safeQuery } from "../lib/safe-query.js";
import { config } from "../config.js";

/* ===================================================================
   Query Stats Collector — polls pg_stat_statements for query metrics
   =================================================================== */

/** Raw row from pg_stat_statements */
interface PgStatStatementsRow {
  queryid: string;
  query_text: string;
  calls: string;
  total_time_ms: string;
  mean_time_ms: string;
  max_time_ms: string;
  min_time_ms: string;
  rows: string;
  shared_blks_hit: string;
  shared_blks_read: string;
  temp_blks_written: string;
}

const CHECK_EXTENSION_QUERY = `
SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'
`;

const PG_STAT_STATEMENTS_QUERY = `
SELECT
  queryid::text,
  LEFT(query, 2000) AS query_text,
  calls::text,
  total_exec_time AS total_time_ms,
  mean_exec_time AS mean_time_ms,
  max_exec_time AS max_time_ms,
  min_exec_time AS min_time_ms,
  rows::text,
  shared_blks_hit::text,
  shared_blks_read::text,
  COALESCE(temp_blks_written, 0)::text AS temp_blks_written
FROM pg_stat_statements
WHERE queryid IS NOT NULL
  AND query NOT LIKE '%pg_stat_statements%'
  AND calls > 0
ORDER BY total_exec_time DESC
LIMIT 100
`;

/**
 * Checks if pg_stat_statements extension is available on the target database.
 */
export async function checkPgStatStatements(
  connectionString: string
): Promise<boolean> {
  try {
    const result = await safeQuery<Array<{ "?column?": number }>>(
      connectionString,
      CHECK_EXTENSION_QUERY,
      { timeoutMs: 5000 }
    );
    return result.length > 0;
  } catch {
    return false;
  }
}

/**
 * Collects query stats from pg_stat_statements and stores them in the query_stats table.
 * Computes pct_of_total_time for each query relative to total database time.
 */
export async function collectQueryStats(
  monitoredDbId: string,
  log: FastifyBaseLogger
): Promise<void> {
  // 1. Fetch the monitored database record
  const [monitoredDb] = await db
    .select()
    .from(monitoredDatabases)
    .where(eq(monitoredDatabases.id, monitoredDbId))
    .limit(1);

  if (!monitoredDb) {
    log.warn({ monitoredDbId }, "Monitored database not found for query stats");
    return;
  }

  // 2. Decrypt connection string
  const connectionString = decrypt(
    monitoredDb.connectionStringEncrypted,
    config.encryptionKey
  );

  // 3. Check if pg_stat_statements is available
  const isAvailable = await checkPgStatStatements(connectionString);
  if (!isAvailable) {
    log.debug(
      { monitoredDbId },
      "pg_stat_statements not available, skipping query stats collection"
    );
    return;
  }

  // 4. Query pg_stat_statements
  log.info({ monitoredDbId }, "Collecting query stats");

  let rows: PgStatStatementsRow[];
  try {
    rows = await safeQuery<PgStatStatementsRow[]>(
      connectionString,
      PG_STAT_STATEMENTS_QUERY,
      { timeoutMs: 15000 }
    );
  } catch (err: unknown) {
    // pg_stat_statements extension may exist in pg_extension but the module
    // isn't loaded via shared_preload_libraries (PG error code 55000).
    if (
      err instanceof Error &&
      "code" in err &&
      (err as Record<string, unknown>).code === "55000"
    ) {
      log.warn(
        { monitoredDbId },
        "pg_stat_statements is installed but not loaded via shared_preload_libraries — skipping query stats collection. " +
          "Add pg_stat_statements to shared_preload_libraries in postgresql.conf and restart PostgreSQL."
      );
      return;
    }
    throw err;
  }

  if (rows.length === 0) {
    log.info({ monitoredDbId }, "No query stats found");
    return;
  }

  // 5. Compute total time for percentage calculation
  const totalDbTime = rows.reduce(
    (sum, r) => sum + parseFloat(r.total_time_ms || "0"),
    0
  );

  // 6. Insert rows into query_stats
  const now = new Date();
  const statsRows = rows.map((r) => {
    const totalTimeMs = parseFloat(r.total_time_ms || "0");
    return {
      monitoredDbId,
      capturedAt: now,
      queryid: parseInt(r.queryid, 10),
      queryText: r.query_text || "",
      calls: parseInt(r.calls, 10) || 0,
      totalTimeMs,
      meanTimeMs: parseFloat(r.mean_time_ms || "0"),
      maxTimeMs: parseFloat(r.max_time_ms || "0"),
      minTimeMs: parseFloat(r.min_time_ms || "0"),
      rowsReturned: parseInt(r.rows, 10) || 0,
      sharedBlksHit: parseInt(r.shared_blks_hit, 10) || 0,
      sharedBlksRead: parseInt(r.shared_blks_read, 10) || 0,
      tempBlksWritten: parseInt(r.temp_blks_written, 10) || 0,
      pctOfTotalTime: totalDbTime > 0
        ? Math.round((totalTimeMs / totalDbTime) * 10000) / 100
        : 0,
    };
  });

  await db.insert(queryStats).values(statsRows);

  log.info(
    { monitoredDbId, queryCount: statsRows.length },
    "Query stats collected"
  );
}
