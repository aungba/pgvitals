import type { FastifyBaseLogger } from "fastify";
import { db, queryStats, queryPlanSnapshots, monitoredDatabases } from "@pgvitals/db";
import { eq, and, desc, gt, sql, ne, isNotNull } from "drizzle-orm";
import { decrypt } from "../lib/encryption.js";
import { safeQuery } from "../lib/safe-query.js";
import { config } from "../config.js";
import type { GeneratedHint } from "./rules-engine.js";
import * as crypto from "crypto";

/* ===================================================================
   Plan Regression Collector — spec §2.10, Phase 9
   
   Periodically captures EXPLAIN plans for top queries and detects
   plan shape changes (e.g. index scan → seq scan).
   =================================================================== */

interface PlanNode {
  "Node Type": string;
  "Total Cost"?: number;
  "Plan Rows"?: number;
  "Relation Name"?: string;
  Plans?: PlanNode[];
}

/**
 * Recursively extracts all node types from an EXPLAIN plan in DFS order.
 */
function extractNodeTypes(node: PlanNode): string[] {
  const types: string[] = [node["Node Type"]];
  if (node.Plans) {
    for (const child of node.Plans) {
      types.push(...extractNodeTypes(child));
    }
  }
  return types;
}

/**
 * Creates a normalized hash of plan node types for shape comparison.
 */
function hashPlanShape(nodeTypes: string[]): string {
  const shapeStr = nodeTypes.join(" → ");
  return crypto.createHash("sha256").update(shapeStr).digest("hex").slice(0, 16);
}

/**
 * Detects plan flags (concerning patterns) in the plan.
 */
function detectPlanFlags(node: PlanNode, flags: Record<string, unknown> = {}): Record<string, unknown> {
  const nodeType = node["Node Type"];
  const planRows = node["Plan Rows"] ?? 0;
  const relationName = node["Relation Name"];

  if (nodeType === "Seq Scan" && planRows > 10000) {
    flags["seq_scan_large_table"] = true;
    flags["seq_scan_table"] = relationName;
    flags["seq_scan_rows"] = planRows;
  }

  if (nodeType === "Nested Loop" && planRows > 10000) {
    flags["nested_loop_high_rows"] = true;
    flags["nested_loop_rows"] = planRows;
  }

  if (node.Plans) {
    for (const child of node.Plans) {
      detectPlanFlags(child, flags);
    }
  }

  return flags;
}

/**
 * Generates a root-cause hint for a plan regression.
 */
function buildRegressionHint(
  queryid: number,
  oldTopNode: string,
  newTopNode: string,
  oldHash: string,
  newHash: string
): string {
  // Detect specific plan degradation patterns
  if (oldTopNode.includes("Index") && newTopNode.includes("Seq Scan")) {
    return `Query plan degraded from ${oldTopNode} to ${newTopNode}. Possible causes: stale statistics (run ANALYZE on involved tables), data growth crossing a planner cost threshold, or index corruption. Check that relevant indexes still exist.`;
  }

  if (oldTopNode.includes("Hash Join") && newTopNode.includes("Nested Loop")) {
    return `Query switched from Hash Join to Nested Loop, likely due to changed row count estimates. Run ANALYZE on involved tables to refresh statistics.`;
  }

  if (oldTopNode.includes("Nested Loop") && newTopNode.includes("Hash Join")) {
    return `Query switched from Nested Loop to Hash Join. This may indicate table growth — the planner now estimates more rows. Usually benign, but monitor query performance.`;
  }

  return `Query execution plan changed shape (${oldTopNode} → ${newTopNode}). Review table statistics (run ANALYZE) and check for recent schema changes.`;
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

      // Skip utility statements that can't be EXPLAINed
      const trimmed = query.queryText.trim().toUpperCase();
      if (
        trimmed.startsWith("SET ") ||
        trimmed.startsWith("RESET ") ||
        trimmed.startsWith("COPY ") ||
        trimmed.startsWith("CREATE ") ||
        trimmed.startsWith("ALTER ") ||
        trimmed.startsWith("DROP ") ||
        trimmed.startsWith("GRANT ") ||
        trimmed.startsWith("REVOKE ") ||
        trimmed.startsWith("VACUUM ") ||
        trimmed.startsWith("ANALYZE ") ||
        trimmed.startsWith("COMMIT") ||
        trimmed.startsWith("BEGIN") ||
        trimmed.startsWith("ROLLBACK") ||
        trimmed.startsWith("LISTEN") ||
        trimmed.startsWith("UNLISTEN") ||
        trimmed.startsWith("CLOSE") ||
        trimmed.startsWith("DEALLOCATE") ||
        trimmed.startsWith("DISCARD")
      ) {
        continue;
      }

      // pg_stat_statements stores queries with $1, $2 parameter placeholders.
      // We need to use PREPARE + EXPLAIN (GENERIC_PLAN) to get plans for these.
      // Count the number of parameters to build the type list.
      const paramMatches = query.queryText.match(/\$\d+/g);
      const paramCount = paramMatches
        ? Math.max(...paramMatches.map((p) => parseInt(p.slice(1), 10)))
        : 0;

      let explainResult: Array<{ "QUERY PLAN": PlanNode[] }> | undefined;

      if (paramCount > 0) {
        // Strategy 1: PREPARE + EXPLAIN (GENERIC_PLAN) — PG 16+
        const paramTypes = Array(paramCount).fill("unknown").join(", ");
        const stmtName = `pgv_plan_${query.queryid}`;

        try {
          await safeQuery(
            connectionString,
            `DEALLOCATE ${stmtName}`,
            { timeoutMs: 3000 }
          ).catch(() => {}); // ignore if not exists

          await safeQuery(
            connectionString,
            `PREPARE ${stmtName}(${paramTypes}) AS ${query.queryText}`,
            { timeoutMs: 5000 }
          );

          explainResult = await safeQuery<Array<{ "QUERY PLAN": PlanNode[] }>>(
            connectionString,
            `EXPLAIN (FORMAT JSON, GENERIC_PLAN) EXECUTE ${stmtName}`,
            { timeoutMs: 10000 }
          );

          await safeQuery(
            connectionString,
            `DEALLOCATE ${stmtName}`,
            { timeoutMs: 3000 }
          ).catch(() => {});
        } catch {
          // Strategy 2: Replace $N with NULL — works on all PG versions.
          // This gives approximate plan shape (NULLs may produce different
          // cost estimates, but the node types / plan shape will be correct
          // in most cases, which is sufficient for regression detection).
          try {
            const nullQuery = query.queryText.replace(/\$\d+/g, "NULL");
            explainResult = await safeQuery<Array<{ "QUERY PLAN": PlanNode[] }>>(
              connectionString,
              `EXPLAIN (FORMAT JSON) ${nullQuery}`,
              { timeoutMs: 10000 }
            );
          } catch {
            log.debug({ queryid: query.queryid }, "EXPLAIN with NULL substitution also failed, skipping");
            continue;
          }
        }
      } else {
        // No parameters — EXPLAIN directly
        explainResult = await safeQuery<Array<{ "QUERY PLAN": PlanNode[] }>>(
          connectionString,
          `EXPLAIN (FORMAT JSON) ${query.queryText}`,
          { timeoutMs: 10000 }
        );
      }

      if (!explainResult || explainResult.length === 0) continue;

      const planArray = explainResult[0]["QUERY PLAN"];
      if (!planArray || planArray.length === 0) continue;

      const rootNode = planArray[0];
      const nodeTypes = extractNodeTypes(rootNode);
      const planShapeHash = hashPlanShape(nodeTypes);
      const topNodeType = rootNode["Node Type"];
      const estimatedCost = rootNode["Total Cost"] ?? null;
      const planFlags = detectPlanFlags(rootNode);

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
        if (oldPlan.planShapeHash !== planShapeHash) {
          const hintText = buildRegressionHint(
            query.queryid,
            oldPlan.topNodeType ?? "unknown",
            topNodeType ?? "unknown",
            oldPlan.planShapeHash,
            planShapeHash
          );

          hints.push({
            ruleType: "plan_regression",
            severity: "warning",
            title: `Plan regression detected for queryid ${query.queryid}`,
            description: hintText,
            metadata: {
              queryid: query.queryid,
              old_plan_shape: oldPlan.planShapeHash,
              new_plan_shape: planShapeHash,
              old_top_node: oldPlan.topNodeType,
              new_top_node: topNodeType,
              plan_flags: planFlags,
            },
          });

          log.warn(
            { monitoredDbId, queryid: query.queryid, oldHash: oldPlan.planShapeHash, newHash: planShapeHash },
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
