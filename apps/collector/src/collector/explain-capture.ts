import type { FastifyBaseLogger } from "fastify";
import { db, explainCaptures, monitoredDatabases } from "@pgvitals/db";
import { eq } from "drizzle-orm";
import { decrypt } from "../lib/encryption.js";
import { safeQuery } from "../lib/safe-query.js";
import { config } from "../config.js";

/* ===================================================================
   EXPLAIN Capture — on-demand query plan analysis
   =================================================================== */

export interface PlanWarning {
  type: string;
  message: string;
  nodeType: string;
  details: Record<string, unknown>;
}

export interface ExplainResult {
  id: string;
  queryid: number;
  queryText: string;
  planJson: unknown;
  planText: string | null;
  warnings: PlanWarning[];
  capturedAt: string;
}

/**
 * Captures an EXPLAIN plan for a query on a monitored database.
 * Uses EXPLAIN (FORMAT JSON, BUFFERS, COSTS) — NO ANALYZE for safety.
 */
export async function captureExplain(
  monitoredDbId: string,
  queryid: number,
  queryText: string,
  log: FastifyBaseLogger
): Promise<ExplainResult> {
  // 1. Fetch the monitored database record
  const [monitoredDb] = await db
    .select()
    .from(monitoredDatabases)
    .where(eq(monitoredDatabases.id, monitoredDbId))
    .limit(1);

  if (!monitoredDb) {
    throw new Error(`Monitored database not found: ${monitoredDbId}`);
  }

  // 2. Decrypt connection string
  const connectionString = decrypt(
    monitoredDb.connectionStringEncrypted,
    config.encryptionKey
  );

  log.info({ monitoredDbId, queryid }, "Capturing EXPLAIN plan");

  // 3. Get JSON plan (EXPLAIN without ANALYZE — safe, no execution)
  const jsonPlanRows = await safeQuery<Array<{ "QUERY PLAN": unknown }>>(
    connectionString,
    `EXPLAIN (FORMAT JSON, BUFFERS, COSTS) ${queryText}`,
    { timeoutMs: 15000 }
  );

  const planJson = jsonPlanRows[0]?.["QUERY PLAN"] ?? null;

  // 4. Get text plan for human-readable display
  let planText: string | null = null;
  try {
    const textPlanRows = await safeQuery<Array<{ "QUERY PLAN": string }>>(
      connectionString,
      `EXPLAIN (BUFFERS, COSTS) ${queryText}`,
      { timeoutMs: 15000 }
    );
    planText = textPlanRows.map((r) => r["QUERY PLAN"]).join("\n");
  } catch (err) {
    log.warn({ err, monitoredDbId }, "Failed to capture text plan");
  }

  // 5. Parse plan for warnings
  const warnings = parsePlanWarnings(planJson);

  // 6. Store in database
  const [inserted] = await db
    .insert(explainCaptures)
    .values({
      monitoredDbId,
      queryid,
      queryText,
      planJson,
      planText,
      warnings,
    })
    .returning();

  log.info(
    { monitoredDbId, queryid, warningCount: warnings.length },
    "EXPLAIN plan captured"
  );

  return {
    id: inserted.id,
    queryid: inserted.queryid,
    queryText: inserted.queryText,
    planJson: inserted.planJson,
    planText: inserted.planText,
    warnings: inserted.warnings as PlanWarning[],
    capturedAt: inserted.capturedAt.toISOString(),
  };
}

/* ===================================================================
   Plan Warning Parser — walks the EXPLAIN plan tree
   =================================================================== */

interface PlanNode {
  "Node Type"?: string;
  "Plan Rows"?: number;
  "Shared Hit Blocks"?: number;
  "Shared Read Blocks"?: number;
  "Sort Method"?: string;
  "Relation Name"?: string;
  "Total Cost"?: number;
  Plans?: PlanNode[];
  [key: string]: unknown;
}

/**
 * Recursively walks the EXPLAIN plan tree and flags common performance issues.
 */
function parsePlanWarnings(planJson: unknown): PlanWarning[] {
  const warnings: PlanWarning[] = [];

  if (!planJson || !Array.isArray(planJson)) return warnings;

  const topLevel = planJson[0] as { Plan?: PlanNode } | undefined;
  if (!topLevel?.Plan) return warnings;

  walkPlanNode(topLevel.Plan, warnings);
  return warnings;
}

function walkPlanNode(node: PlanNode, warnings: PlanWarning[]): void {
  const nodeType = node["Node Type"] ?? "Unknown";
  const planRows = node["Plan Rows"] ?? 0;
  const hitBlocks = node["Shared Hit Blocks"] ?? 0;
  const readBlocks = node["Shared Read Blocks"] ?? 0;
  const sortMethod = node["Sort Method"] ?? "";
  const relationName = node["Relation Name"] ?? "";

  // Sequential scan on large table
  if (nodeType === "Seq Scan" && planRows > 10000) {
    warnings.push({
      type: "seq_scan_large_table",
      message: `Sequential scan on "${relationName}" with ~${planRows.toLocaleString()} estimated rows. Consider adding an index.`,
      nodeType,
      details: { relationName, planRows },
    });
  }

  // Nested loop with high row estimate
  if (nodeType === "Nested Loop" && planRows > 10000) {
    warnings.push({
      type: "nested_loop_high_rows",
      message: `Nested loop join producing ~${planRows.toLocaleString()} rows. This could be slow — consider restructuring the query or adding indexes.`,
      nodeType,
      details: { planRows },
    });
  }

  // High cache miss ratio
  if (readBlocks > 0 && readBlocks > hitBlocks) {
    warnings.push({
      type: "high_cache_miss",
      message: `High cache miss rate: ${readBlocks} disk reads vs ${hitBlocks} cache hits for "${nodeType}" on "${relationName}". Consider increasing shared_buffers or optimizing the query.`,
      nodeType,
      details: { readBlocks, hitBlocks, relationName },
    });
  }

  // Sort spilling to disk
  if (sortMethod && sortMethod.toLowerCase().includes("external")) {
    warnings.push({
      type: "sort_disk_spill",
      message: `Sort operation spilling to disk (${sortMethod}). Consider increasing work_mem or reducing the result set.`,
      nodeType,
      details: { sortMethod },
    });
  }

  // Recurse into child nodes
  if (node.Plans && Array.isArray(node.Plans)) {
    for (const child of node.Plans) {
      walkPlanNode(child, warnings);
    }
  }
}
