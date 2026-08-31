import type { FastifyBaseLogger } from "fastify";
import { db, explainCaptures, queryPlanSnapshots, monitoredDatabases } from "@pgvitals/db";
import { eq } from "drizzle-orm";
import { decrypt } from "../lib/encryption.js";
import { config } from "../config.js";
import {
  executeRobustExplain,
  type PlanWarning,
} from "../lib/explain-executor.js";

/* ===================================================================
   EXPLAIN Capture — on-demand query plan analysis
   =================================================================== */

export { type PlanWarning };

export interface ExplainResult {
  id: string;
  queryid: number;
  queryText: string;
  planJson: unknown;
  planText: string | null;
  warnings: PlanWarning[];
  capturedAt: string;
  planShapeHash?: string;
  topNodeType?: string;
  estimatedCost?: number | null;
  strategyUsed?: string;
}

/**
 * Captures an EXPLAIN plan for a query on a monitored database.
 * Uses robust multi-tiered EXPLAIN with parameter support — NO ANALYZE for safety.
 * Saves to both explain_captures and query_plan_snapshots.
 */
export async function captureExplain(
  monitoredDbId: string,
  queryid: number,
  queryText: string,
  log: FastifyBaseLogger,
  options?: {
    customParameters?: Record<string, string>;
    overrideQueryText?: string;
  }
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

  const effectiveQuery = (options?.overrideQueryText || queryText).trim();
  log.info({ monitoredDbId, queryid }, "Capturing EXPLAIN plan");

  // 3. Execute robust EXPLAIN
  const explainOutput = await executeRobustExplain(connectionString, effectiveQuery, {
    customParameters: options?.customParameters,
    log,
    timeoutMs: 15000,
  });

  const now = new Date();

  // 4. Store in explain_captures
  const [insertedExplain] = await db
    .insert(explainCaptures)
    .values({
      monitoredDbId,
      queryid,
      queryText: effectiveQuery,
      planJson: explainOutput.planJson,
      planText: explainOutput.planText,
      warnings: explainOutput.warnings,
      capturedAt: now,
    })
    .returning();

  // 5. Store in query_plan_snapshots for Plan Regression tracking & Plan tabs
  try {
    await db.insert(queryPlanSnapshots).values({
      monitoredDbId,
      queryid,
      capturedAt: now,
      planJson: explainOutput.planJson,
      planShapeHash: explainOutput.planShapeHash,
      estimatedCost: explainOutput.estimatedCost,
      topNodeType: explainOutput.topNodeType,
      planFlags: Object.keys(explainOutput.planFlags).length > 0 ? explainOutput.planFlags : null,
    });
  } catch (snapErr) {
    log.warn({ snapErr, queryid }, "Failed to mirror explain capture into query_plan_snapshots");
  }

  log.info(
    {
      monitoredDbId,
      queryid,
      warningCount: explainOutput.warnings.length,
      strategy: explainOutput.usedStrategy,
      topNode: explainOutput.topNodeType,
    },
    "EXPLAIN plan captured successfully"
  );

  return {
    id: insertedExplain.id,
    queryid: insertedExplain.queryid,
    queryText: insertedExplain.queryText,
    planJson: insertedExplain.planJson,
    planText: insertedExplain.planText,
    warnings: insertedExplain.warnings as PlanWarning[],
    capturedAt: insertedExplain.capturedAt.toISOString(),
    planShapeHash: explainOutput.planShapeHash,
    topNodeType: explainOutput.topNodeType,
    estimatedCost: explainOutput.estimatedCost,
    strategyUsed: explainOutput.usedStrategy,
  };
}

