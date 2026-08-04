import type { FastifyBaseLogger } from "fastify";
import { db, queryStats, queryPlanSnapshots, monitoredDatabases } from "@pgvitals/db";
import { eq, and, desc } from "drizzle-orm";
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

  if (topQueries.length === 0) return hints;

  const now = new Date();
  let capturedCount = 0;

  for (const query of topQueries) {
    try {
      // Run EXPLAIN (not ANALYZE) to get the plan without executing
      const explainResult = await safeQuery<Array<{ "QUERY PLAN": PlanNode[] }>>(
        connectionString,
        `EXPLAIN (FORMAT JSON) ${query.queryText}`,
        { timeoutMs: 10000 }
      );

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
