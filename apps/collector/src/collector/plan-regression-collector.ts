import type { FastifyBaseLogger } from "fastify";
import { db, queryStats, queryPlanSnapshots, monitoredDatabases } from "@pgvitals/db";
import { eq, and, desc, gt, sql, ne, isNotNull } from "drizzle-orm";
import { decrypt } from "../lib/encryption.js";
import { config } from "../config.js";
import type { GeneratedHint } from "./rules-engine.js";
import {
  executeRobustExplain,
  extractNodeTypes,
  hashPlanShape,
  detectPlanFlags,
  type PlanNode,
} from "../lib/explain-executor.js";

/* ===================================================================
   Plan Regression Collector — spec §2.10, Phase 9
   
   Periodically captures EXPLAIN plans for top queries and detects
   plan shape changes (e.g. index scan → seq scan).
   =================================================================== */

export { extractNodeTypes, hashPlanShape, detectPlanFlags, type PlanNode };

export interface PlanRegressionAnalysis {
  isRegression: boolean;
  severity: "info" | "warning" | "critical";
  summary: string;
  reason: string;
  remediationSql?: string;
  costDeltaPct?: number;
  oldCost?: number;
  newCost?: number;
}

/**
 * Multi-factor plan regression analyzer.
 * Evaluates shape changes, cost surges (>= 30%), index dropoffs, and join degradation.
 */
export function analyzePlanRegression(
  oldPlan: {
    topNodeType?: string | null;
    planShapeHash?: string | null;
    estimatedCost?: number | null;
    planFlags?: Record<string, unknown> | null;
  },
  newPlan: {
    topNodeType?: string | null;
    planShapeHash?: string | null;
    estimatedCost?: number | null;
    planFlags?: Record<string, unknown> | null;
  }
): PlanRegressionAnalysis | null {
  const oldCost = oldPlan.estimatedCost ?? 0;
  const newCost = newPlan.estimatedCost ?? 0;
  const oldTop = oldPlan.topNodeType ?? "Unknown";
  const newTop = newPlan.topNodeType ?? "Unknown";
  const shapeChanged = oldPlan.planShapeHash !== newPlan.planShapeHash;

  const costDeltaPct = oldCost > 0 ? ((newCost - oldCost) / oldCost) * 100 : 0;

  // 1. Critical degradation: Index Scan -> Seq Scan
  if (oldTop.includes("Index") && newTop.includes("Seq Scan")) {
    const table = (newPlan.planFlags?.seq_scan_table as string) || "the involved table";
    return {
      isRegression: true,
      severity: "critical",
      summary: `Index scan dropped → ${newTop}`,
      reason: `Query execution plan degraded from indexed scan (${oldTop}) to sequential scan (${newTop}). This can cause high disk I/O and query latency.`,
      remediationSql: `ANALYZE ${table};`,
      costDeltaPct,
      oldCost,
      newCost,
    };
  }

  // 2. Hash Join -> Nested Loop on high row count
  if (oldTop.includes("Hash Join") && newTop.includes("Nested Loop") && (newPlan.planFlags?.nested_loop_high_rows || costDeltaPct > 20)) {
    return {
      isRegression: true,
      severity: "warning",
      summary: `Hash Join → Nested Loop (high rows)`,
      reason: `Query switched from Hash Join to Nested Loop with large estimated rows, risking polynomial execution time.`,
      remediationSql: `ANALYZE;`,
      costDeltaPct,
      oldCost,
      newCost,
    };
  }

  // 3. Significant cost spike (>= 30% increase)
  if (costDeltaPct >= 30) {
    const isSevere = costDeltaPct >= 100;
    return {
      isRegression: true,
      severity: isSevere ? "critical" : "warning",
      summary: `Plan cost increased by +${costDeltaPct.toFixed(0)}%`,
      reason: `Planner estimated cost surged from ${oldCost.toFixed(1)} to ${newCost.toFixed(1)} (+${costDeltaPct.toFixed(0)}%).`,
      remediationSql: `ANALYZE;`,
      costDeltaPct,
      oldCost,
      newCost,
    };
  }

  // 4. Shape changed
  if (shapeChanged) {
    return {
      isRegression: true,
      severity: "info",
      summary: `Plan shape changed (${oldTop} → ${newTop})`,
      reason: `Plan execution tree structure shifted from ${oldTop} to ${newTop}.`,
      remediationSql: `ANALYZE;`,
      costDeltaPct,
      oldCost,
      newCost,
    };
  }

  return null;
}

/**
 * Generates a root-cause hint for a plan regression.
 */
function buildRegressionHint(
  queryid: number,
  analysis: PlanRegressionAnalysis,
  oldTopNode: string,
  newTopNode: string
): string {
  return `${analysis.reason} Recommended: ${analysis.remediationSql ?? "Run ANALYZE on involved tables."}`;
}

/**
 * Captures EXPLAIN plans for top queries and detects plan regressions.
 * Uses EXPLAIN (FORMAT JSON) — NOT EXPLAIN ANALYZE — to minimize overhead.
 */
export async function collectPlanSnapshots(
  monitoredDbId: string,
  log: FastifyBaseLogger
): Promise<GeneratedHint[]> {
  const hints: GeneratedHint[] = [];

  const [monitoredDb] = await db
    .select()
    .from(monitoredDatabases)
    .where(eq(monitoredDatabases.id, monitoredDbId))
    .limit(1);

  if (!monitoredDb) {
    log.warn({ monitoredDbId }, "DB not found for plan regression collection");
    return hints;
  }

  const connectionString = decrypt(
    monitoredDb.connectionStringEncrypted,
    config.encryptionKey
  );

  // Get top 20 queries by total_time from latest query_stats snapshot
  const [latestCapture] = await db
    .select({ capturedAt: queryStats.capturedAt })
    .from(queryStats)
    .where(eq(queryStats.monitoredDbId, monitoredDbId))
    .orderBy(desc(queryStats.capturedAt))
    .limit(1);

  if (!latestCapture) {
    log.debug({ monitoredDbId }, "No query stats available for plan regression");
    return hints;
  }

   const topQueries = await db
    .select({
      queryid: queryStats.queryid,
      queryText: queryStats.queryText,
    })
    .from(queryStats)
    .where(
      and(
        eq(queryStats.monitoredDbId, monitoredDbId),
        eq(queryStats.capturedAt, latestCapture.capturedAt)
      )
    )
    .orderBy(desc(queryStats.totalTimeMs))
    .limit(20);

  // ── Auto-trigger: find queries with mean_time regression >30% ──
  // Compare latest two query_stats captures to detect regressions
  const autoTriggerQueries = await findRegressionTriggerQueries(
    monitoredDbId,
    latestCapture.capturedAt,
    log
  );

  // Also auto-trigger for queries with known seq_scan flags from prior snapshots
  const seqScanFlaggedQueries = await findSeqScanFlaggedQueries(
    monitoredDbId,
    latestCapture.capturedAt,
    log
  );

  // Merge: add auto-triggered queries that aren't already in top 20
  const topQueryIds = new Set(topQueries.map((q) => q.queryid));
  for (const q of [...autoTriggerQueries, ...seqScanFlaggedQueries]) {
    if (!topQueryIds.has(q.queryid)) {
      topQueries.push(q);
      topQueryIds.add(q.queryid);
    }
  }

  if (topQueries.length === 0) return hints;

  const now = new Date();
  let capturedCount = 0;

  for (const query of topQueries) {
    try {
      if (!query.queryText) continue;

      const explainOutput = await executeRobustExplain(connectionString, query.queryText, {
        log,
        timeoutMs: 10000,
      });

      if (!explainOutput.planJson || explainOutput.planJson.length === 0) continue;

      const planArray = explainOutput.planJson;
      const planShapeHash = explainOutput.planShapeHash;
      const topNodeType = explainOutput.topNodeType;
      const estimatedCost = explainOutput.estimatedCost;
      const planFlags = explainOutput.planFlags;

      // Store the plan snapshot
      await db.insert(queryPlanSnapshots).values({
        monitoredDbId,
        queryid: query.queryid,
        capturedAt: now,
        planJson: planArray,
        planShapeHash,
        estimatedCost,
        topNodeType,
        planFlags: Object.keys(planFlags).length > 0 ? planFlags : null,
      });

      capturedCount++;

      // Check for plan regression — get last 2 snapshots for this query
      const prevPlans = await db
        .select({
          planShapeHash: queryPlanSnapshots.planShapeHash,
          topNodeType: queryPlanSnapshots.topNodeType,
          estimatedCost: queryPlanSnapshots.estimatedCost,
          planFlags: queryPlanSnapshots.planFlags,
        })
        .from(queryPlanSnapshots)
        .where(
          and(
            eq(queryPlanSnapshots.monitoredDbId, monitoredDbId),
            eq(queryPlanSnapshots.queryid, query.queryid)
          )
        )
        .orderBy(desc(queryPlanSnapshots.capturedAt))
        .limit(2);

      if (prevPlans.length >= 2) {
        const oldPlan = prevPlans[1]; // The previous snapshot
        const analysis = analyzePlanRegression(
          {
            ...oldPlan,
            planFlags: oldPlan.planFlags as Record<string, unknown> | null,
          },
          {
            planShapeHash,
            topNodeType,
            estimatedCost,
            planFlags,
          }
        );

        if (analysis?.isRegression) {
          const hintText = buildRegressionHint(
            query.queryid,
            analysis,
            oldPlan.topNodeType ?? "unknown",
            topNodeType ?? "unknown"
          );

          hints.push({
            ruleType: "plan_regression",
            severity: analysis.severity,
            title: `Plan regression detected for query #${query.queryid}: ${analysis.summary}`,
            description: hintText,
            metadata: {
              queryid: query.queryid,
              summary: analysis.summary,
              severity: analysis.severity,
              reason: analysis.reason,
              remediation_sql: analysis.remediationSql,
              cost_delta_pct: analysis.costDeltaPct,
              old_cost: analysis.oldCost,
              new_cost: analysis.newCost,
              old_plan_shape: oldPlan.planShapeHash,
              new_plan_shape: planShapeHash,
              old_top_node: oldPlan.topNodeType,
              new_top_node: topNodeType,
              plan_flags: planFlags,
            },
          });

          log.warn(
            { monitoredDbId, queryid: query.queryid, summary: analysis.summary, severity: analysis.severity },
            "Plan regression detected"
          );
        }
      }
    } catch (err) {
      // EXPLAIN may fail for some queries (e.g. utility statements)
      log.debug({ err, queryid: query.queryid }, "Failed to capture EXPLAIN plan");
    }
  }

  log.info({ monitoredDbId, capturedCount }, "Plan snapshots collected");
  return hints;
}

/* ===================================================================
   Auto-EXPLAIN Trigger Functions — spec §2.3
   
   These identify queries that should get an EXPLAIN capture even if
   they're not in the top 20 by total time.
   =================================================================== */

/**
 * Find queries whose mean_time has regressed >30% between the two
 * most recent query_stats captures.
 */
async function findRegressionTriggerQueries(
  monitoredDbId: string,
  latestCapturedAt: Date,
  log: FastifyBaseLogger
): Promise<Array<{ queryid: number; queryText: string }>> {
  try {
    // Get the second-latest capture time
    const prevCaptures = await db
      .select({ capturedAt: queryStats.capturedAt })
      .from(queryStats)
      .where(
        and(
          eq(queryStats.monitoredDbId, monitoredDbId),
          ne(queryStats.capturedAt, latestCapturedAt)
        )
      )
      .orderBy(desc(queryStats.capturedAt))
      .limit(1);

    if (prevCaptures.length === 0) return [];

    const prevCapturedAt = prevCaptures[0].capturedAt;

    // Join latest vs previous stats, find queries where mean_time increased >30%
    const regressedRows = await db.execute(sql`
      SELECT
        curr.queryid,
        curr.query_text,
        curr.mean_time_ms AS curr_mean,
        prev.mean_time_ms AS prev_mean
      FROM query_stats curr
      JOIN query_stats prev
        ON curr.queryid = prev.queryid
        AND curr.monitored_db_id = prev.monitored_db_id
      WHERE curr.monitored_db_id = ${monitoredDbId}
        AND curr.captured_at = ${latestCapturedAt}
        AND prev.captured_at = ${prevCapturedAt}
        AND prev.mean_time_ms > 0
        AND curr.mean_time_ms > prev.mean_time_ms * 1.3
        AND curr.calls > 10
      ORDER BY (curr.mean_time_ms - prev.mean_time_ms) DESC
      LIMIT 20
    `);

    const results = regressedRows as unknown as Array<{
      queryid: string | number;
      query_text: string;
      curr_mean: number;
      prev_mean: number;
    }>;

    if (results.length > 0) {
      log.info(
        { monitoredDbId, count: results.length },
        "Auto-trigger: queries with >30% mean_time regression"
      );
    }

    return results.map((r) => ({
      queryid: typeof r.queryid === "string" ? parseInt(r.queryid, 10) : r.queryid,
      queryText: r.query_text,
    }));
  } catch (err) {
    log.debug({ err }, "Failed to find regression trigger queries");
    return [];
  }
}

/**
 * Find queries that have prior plan snapshots flagged with seq_scan_large_table.
 * These should be re-captured to check if the seq scan persists.
 */
async function findSeqScanFlaggedQueries(
  monitoredDbId: string,
  latestCapturedAt: Date,
  log: FastifyBaseLogger
): Promise<Array<{ queryid: number; queryText: string }>> {
  try {
    // Find queryids that had seq_scan_large_table in their latest plan snapshot
    const flaggedRows = await db.execute(sql`
      SELECT DISTINCT ON (qps.queryid)
        qps.queryid,
        qs.query_text
      FROM query_plan_snapshots qps
      JOIN query_stats qs
        ON qs.queryid = qps.queryid
        AND qs.monitored_db_id = qps.monitored_db_id
        AND qs.captured_at = ${latestCapturedAt}
      WHERE qps.monitored_db_id = ${monitoredDbId}
        AND qps.plan_flags->>'seq_scan_large_table' = 'true'
      ORDER BY qps.queryid, qps.captured_at DESC
      LIMIT 20
    `);

    const results = flaggedRows as unknown as Array<{
      queryid: string | number;
      query_text: string;
    }>;

    if (results.length > 0) {
      log.info(
        { monitoredDbId, count: results.length },
        "Auto-trigger: queries with seq_scan_large_table flag"
      );
    }

    return results.map((r) => ({
      queryid: typeof r.queryid === "string" ? parseInt(r.queryid, 10) : r.queryid,
      queryText: r.query_text,
    }));
  } catch (err) {
    log.debug({ err }, "Failed to find seq scan flagged queries");
    return [];
  }
}
