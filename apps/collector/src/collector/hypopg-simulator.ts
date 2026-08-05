import type { FastifyBaseLogger } from "fastify";
import postgres from "postgres";
import { safeQuery } from "../lib/safe-query.js";

/* ===================================================================
   HypoPG Index Simulator — Spec §2.4
   
   Creates hypothetical indexes using HypoPG extension and measures
   EXPLAIN cost reduction without any disk writes.
   =================================================================== */

export interface SimulationResult {
  indexDdl: string;
  tableName: string;
  testQuery: string;
  costBefore: number;
  costAfter: number;
  costReductionPct: number;
  planBefore: string;
  planAfter: string;
}

/**
 * Check if HypoPG extension is available on the target database.
 */
export async function isHypoPGAvailable(
  connectionString: string
): Promise<boolean> {
  try {
    const result = await safeQuery<Array<{ extname: string }>>(
      connectionString,
      "SELECT extname FROM pg_extension WHERE extname = 'hypopg'",
      { timeoutMs: 5000 }
    );
    return result.length > 0;
  } catch {
    return false;
  }
}

interface PlanNode {
  "Node Type": string;
  "Total Cost"?: number;
  Plans?: PlanNode[];
}

/**
 * Extracts the top-level node type and total cost from an EXPLAIN JSON plan.
 */
function parsePlan(
  planResult: Array<{ "QUERY PLAN": PlanNode[] }>
): { topNode: string; cost: number } | null {
  if (!planResult || planResult.length === 0) return null;
  const planArray = planResult[0]["QUERY PLAN"];
  if (!planArray || planArray.length === 0) return null;
  const root = planArray[0];
  return {
    topNode: root["Node Type"] ?? "Unknown",
    cost: root["Total Cost"] ?? 0,
  };
}

/**
 * Simulate a hypothetical index using HypoPG.
 * 
 * Flow:
 * 1. Run EXPLAIN on the query WITHOUT the hypothetical index (baseline)
 * 2. Create hypothetical index via hypopg_create_index()
 * 3. Run EXPLAIN on the query WITH the hypothetical index
 * 4. Clean up with hypopg_reset()
 * 5. Return before/after comparison
 * 
 * Uses a direct postgres connection (not safeQuery) because HypoPG
 * functions require the same session for the hypothetical index to be visible.
 */
export async function simulateIndex(
  connectionString: string,
  indexDdl: string,
  testQuery: string,
  log: FastifyBaseLogger
): Promise<SimulationResult | null> {
  if (!indexDdl || !testQuery) {
    log.warn("simulateIndex called with empty indexDdl or testQuery");
    return null;
  }

  // Extract table name from DDL (e.g. "CREATE INDEX ON users(email)" -> "users")
  const tableMatch = indexDdl.match(/ON\s+(?:\w+\.)?(\w+)/i);
  const tableName = tableMatch?.[1] ?? "unknown";

  // Use a single connection — HypoPG hypothetical indexes are session-scoped
  const client = postgres(connectionString, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
  });

  try {
    // 1. Baseline EXPLAIN (without hypothetical index)
    const planBeforeRaw = await client.unsafe(
      `EXPLAIN (FORMAT JSON) ${testQuery}`
    ) as unknown as Array<{ "QUERY PLAN": PlanNode[] }>;

    const before = parsePlan(planBeforeRaw);
    if (!before) {
      log.warn({ testQuery }, "Failed to parse baseline EXPLAIN plan");
      return null;
    }

    // 2. Create hypothetical index (session-scoped, no disk write)
    await client.unsafe(
      `SELECT * FROM hypopg_create_index('${indexDdl.replace(/'/g, "''")}')`
    );

    // 3. EXPLAIN with hypothetical index (same session)
    let after: { topNode: string; cost: number } | null = null;
    try {
      const planAfterRaw = await client.unsafe(
        `EXPLAIN (FORMAT JSON) ${testQuery}`
      ) as unknown as Array<{ "QUERY PLAN": PlanNode[] }>;
      after = parsePlan(planAfterRaw);
    } finally {
      // 4. Always clean up hypothetical indexes
      try {
        await client.unsafe("SELECT hypopg_reset()");
      } catch (cleanupErr) {
        log.warn({ cleanupErr }, "Failed to reset HypoPG");
      }
    }

    if (!after) {
      log.warn({ testQuery }, "Failed to parse plan with hypothetical index");
      return null;
    }

    // 5. Calculate cost reduction
    const costReductionPct =
      before.cost > 0
        ? Math.round(((before.cost - after.cost) / before.cost) * 100 * 100) / 100
        : 0;

    const result: SimulationResult = {
      indexDdl,
      tableName,
      testQuery,
      costBefore: Math.round(before.cost * 100) / 100,
      costAfter: Math.round(after.cost * 100) / 100,
      costReductionPct,
      planBefore: before.topNode,
      planAfter: after.topNode,
    };

    log.info(
      { tableName, costBefore: result.costBefore, costAfter: result.costAfter, costReductionPct },
      "HypoPG simulation complete"
    );

    return result;
  } catch (err) {
    log.warn({ err, indexDdl, testQuery }, "HypoPG simulation failed");
    return null;
  } finally {
    await client.end({ timeout: 5 });
  }
}
