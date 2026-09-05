import type { PlanNode } from "../lib/explain-executor.js";
import { analyzeSqlAdvice } from "./sql-advisor.js";

/* ===================================================================
   PG Vitals — AI Query Explainer & Rewriter
   Translates slow SQL queries and complex EXPLAIN plan trees into
   actionable root-cause diagnostics, suggests optimized rewrites,
   and recommends targeted index DDL with LLM API & heuristic support.
   =================================================================== */

export interface QueryBottleneck {
  title: string;
  severity: "info" | "warning" | "critical";
  explanation: string;
  suggestion: string;
}

export interface RecommendedIndex {
  tableName: string;
  indexDdl: string;
  reason: string;
}

export interface AiOptimizationResult {
  summary: string;
  bottlenecks: QueryBottleneck[];
  rewrittenSql: string;
  recommendedIndexes: RecommendedIndex[];
  estimatedSpeedup: string;
  provider: "gemini" | "openai" | "heuristic";
}

export interface OptimizeQueryOptions {
  queryText: string;
  planJson?: PlanNode[] | null;
  meanLatencyMs?: number;
  calls?: number;
}

/**
 * Main entry point for query analysis, explanation, and rewriting.
 */
export async function optimizeQueryWithAi(
  options: OptimizeQueryOptions
): Promise<AiOptimizationResult> {
  const { queryText, planJson, meanLatencyMs, calls } = options;

  // 1. If GEMINI_API_KEY is configured, try Google Gemini
  if (process.env.GEMINI_API_KEY) {
    try {
      const geminiResult = await callGeminiApi(
        process.env.GEMINI_API_KEY,
        queryText,
        planJson,
        meanLatencyMs,
        calls
      );
      if (geminiResult) {
        return { ...geminiResult, provider: "gemini" };
      }
    } catch {
      // Fall through to heuristic
    }
  }

  // 2. If OPENAI_API_KEY is configured, try OpenAI
  if (process.env.OPENAI_API_KEY) {
    try {
      const openaiResult = await callOpenAiApi(
        process.env.OPENAI_API_KEY,
        queryText,
        planJson,
        meanLatencyMs,
        calls
      );
      if (openaiResult) {
        return { ...openaiResult, provider: "openai" };
      }
    } catch {
      // Fall through to heuristic
    }
  }

  // 3. Robust internal heuristic fallback (works 100% offline & without API keys)
  return analyzeQueryHeuristically(queryText, planJson, meanLatencyMs, calls);
}

/**
 * Internal rule-based heuristic optimizer.
 */
export function analyzeQueryHeuristically(
  sql: string,
  planJson?: PlanNode[] | null,
  meanLatencyMs?: number,
  calls?: number
): AiOptimizationResult {
  const bottlenecks: QueryBottleneck[] = [];
  const recommendedIndexes: RecommendedIndex[] = [];
  let rewritten = sql.trim();
  let estimatedSpeedup = "2x - 5x expected improvement";

  const sqlUpper = sql.toUpperCase();

  // 1. Check for SELECT *
  if (/^\s*SELECT\s+\*\s+FROM/i.test(sql)) {
    bottlenecks.push({
      title: "Wildcard Projection (`SELECT *`)",
      severity: "warning",
      explanation:
        "Selecting all columns forces PostgreSQL to fetch heap tuples from disk or buffer cache, preventing Index-Only Scans and increasing network payload.",
      suggestion:
        "Project only the specific columns needed by the application to enable covering index lookups.",
    });
  }

  // 2. Check for non-sargable date/function wraps in WHERE
  const dateFnMatch = sql.match(/\b(DATE|TO_CHAR|DATE_TRUNC)\s*\(\s*([a-zA-Z0-9_.]+)\s*[,)]/i);
  if (dateFnMatch) {
    const fnName = dateFnMatch[1].toUpperCase();
    const colName = dateFnMatch[2];
    bottlenecks.push({
      title: `Non-Sargable Function Wrap: \`${fnName}(${colName})\``,
      severity: "critical",
      explanation: `Wrapping column \`${colName}\` inside \`${fnName}()\` prevents the PostgreSQL query planner from using standard B-Tree indexes on that column, forcing a full sequential scan.`,
      suggestion: `Rewrite the predicate as a half-open range comparison (e.g. \`${colName} >= '2026-01-01' AND ${colName} < '2026-01-02'\`) or create an expression index: \`CREATE INDEX ON table ((${fnName}(${colName})));\`.`,
    });
    estimatedSpeedup = "10x - 100x speedup with index range scan";
  }

  // 3. Check for leading wildcard LIKE '%...'
  if (/LIKE\s+['"]%[^'"]+['"]/i.test(sql) || /ILIKE\s+['"]%[^'"]+['"]/i.test(sql)) {
    bottlenecks.push({
      title: "Leading Wildcard Pattern (`LIKE '%...'`)",
      severity: "critical",
      explanation:
        "Leading wildcard searches cannot traverse B-Tree index trees and must inspect every row in the table or index.",
      suggestion:
        "Enable the `pg_trgm` extension and create a GIN trigram index (`CREATE INDEX ... USING gin (col gin_trgm_ops)`) or full-text search.",
    });
  }

  // 4. Check for NOT IN subqueries
  if (/NOT\s+IN\s*\(\s*SELECT\b/i.test(sql)) {
    bottlenecks.push({
      title: "`NOT IN` Subquery Anti-Pattern",
      severity: "critical",
      explanation:
        "`NOT IN` with a subquery must yield NULL if any returned row is NULL, forcing PostgreSQL to perform expensive nested subplans for every outer row.",
      suggestion:
        "Rewrite using `NOT EXISTS (SELECT 1 FROM ...)` or a `LEFT JOIN ... WHERE ... IS NULL`.",
    });

    rewritten = rewritten.replace(
      /([a-zA-Z0-9_.]+)\s+NOT\s+IN\s*\(\s*SELECT\s+([a-zA-Z0-9_.]+)\s+FROM\s+([a-zA-Z0-9_.]+)\s+WHERE\s+([^)]+)\)/gi,
      `NOT EXISTS (\n  /* Optimized NOT EXISTS: NULL-safe & enables Anti-Join planner node */\n  SELECT 1 FROM $3 WHERE $4 AND $3.$2 = $1\n)`
    );
  }

  // 5. Check for missing LIMIT on unbounded sorting
  if (/\bORDER\s+BY\b/i.test(sql) && !/\bLIMIT\b/i.test(sql)) {
    bottlenecks.push({
      title: "Unbounded ORDER BY Sorting",
      severity: "warning",
      explanation:
        "Sorting entire tables without a LIMIT requires sorting all matched rows in memory or spilling to temporary disk files (`work_mem`).",
      suggestion: "Add a `LIMIT` clause or paginate with keyset pagination.",
    });
  }

  // 6. Plan Inspection (if planJson provided)
  if (planJson && Array.isArray(planJson) && planJson.length > 0) {
    const seqScans: string[] = [];
    const highCostNodes: string[] = [];
    let externalSort = false;

    function walkPlan(node: PlanNode) {
      if (node["Node Type"] === "Seq Scan" && node["Relation Name"]) {
        seqScans.push(node["Relation Name"]);
      }
      if (typeof node["Sort Method"] === "string" && node["Sort Method"].toLowerCase().includes("external")) {
        externalSort = true;
      }
      if (typeof node["Total Cost"] === "number" && node["Total Cost"] > 1000) {
        highCostNodes.push(`${node["Node Type"]} (Cost: ${Math.round(node["Total Cost"])})`);
      }
      if (Array.isArray(node.Plans)) {
        node.Plans.forEach(walkPlan);
      }
    }

    walkPlan(planJson[0]);

    if (seqScans.length > 0) {
      const uniqueTables = Array.from(new Set(seqScans));
      bottlenecks.push({
        title: `Sequential Scan on ${uniqueTables.map((t) => `\`${t}\``).join(", ")}`,
        severity: "critical",
        explanation: `The query planner chose a sequential scan over an index scan. Either an applicable index does not exist, or statistics estimate too many rows match.`,
        suggestion: `Create a B-Tree index matching WHERE and JOIN filter conditions.`,
      });
      estimatedSpeedup = "10x - 50x speedup with index";
    }

    if (externalSort) {
      bottlenecks.push({
        title: "External Disk Sort Spill",
        severity: "critical",
        explanation:
          "Sorting spilled to temporary disk files because memory requirements exceeded PostgreSQL `work_mem`.",
        suggestion: "Increase `work_mem` for this transaction or create an index matching the `ORDER BY` columns.",
      });
    }
  }

  // 7. Generate Targeted Index Recommendations via SQL Advisor
  const advice = analyzeSqlAdvice(sql, calls || 1000, meanLatencyMs || 50);
  if (advice.recommendedIndexDdl && advice.tableName) {
    recommendedIndexes.push({
      tableName: advice.tableName,
      indexDdl: advice.recommendedIndexDdl,
      reason: `Covering index for ${advice.equalityColumns.length} equality predicates and ${advice.rangeColumns.length} range columns. Estimated ~${advice.estimatedSavingsPct}% latency reduction.`,
    });
  }

  // 8. Add general comments to rewritten SQL
  if (rewritten === sql.trim()) {
    rewritten = `-- PG Vitals Recommended Optimization
-- 1. Ensure target index exists (see recommended DDL)
-- 2. Use explicit projections rather than SELECT *
${rewritten}`;
  }

  const latencyStr = meanLatencyMs ? ` (${meanLatencyMs.toFixed(1)}ms mean latency)` : "";
  const summary = bottlenecks.length > 0
    ? `Identified ${bottlenecks.length} potential bottleneck${bottlenecks.length > 1 ? "s" : ""}${latencyStr}. Primary issue: ${bottlenecks[0].title}.`
    : `Query structure appears well-formed${latencyStr}. Ensure supporting indexes exist for WHERE predicates.`;

  return {
    summary,
    bottlenecks,
    rewrittenSql: rewritten,
    recommendedIndexes,
    estimatedSpeedup,
    provider: "heuristic",
  };
}

/**
 * Invokes Gemini 2.0 / 1.5 Flash API with structured JSON output schema.
 */
async function callGeminiApi(
  apiKey: string,
  sql: string,
  planJson?: PlanNode[] | null,
  meanLatencyMs?: number,
  calls?: number
): Promise<AiOptimizationResult | null> {
  const prompt = `You are a Principal PostgreSQL Database Architect.
Analyze the following PostgreSQL query and execution plan:

SQL Query:
\`\`\`sql
${sql}
\`\`\`

Execution Context:
- Mean Latency: ${meanLatencyMs ?? "unknown"} ms
- Execution Calls: ${calls ?? "unknown"}
${planJson ? `- Execution Plan JSON:\n${JSON.stringify(planJson, null, 2)}` : ""}

Provide a structured optimization analysis in valid JSON adhering strictly to this schema:
{
  "summary": "1-2 sentence executive summary of query function and key bottleneck",
  "bottlenecks": [
    {
      "title": "Short title",
      "severity": "info" | "warning" | "critical",
      "explanation": "Detailed explanation of why this slows down PostgreSQL",
      "suggestion": "Specific actionable fix"
    }
  ],
  "rewrittenSql": "Optimized SQL query with SQL comments explaining the changes",
  "recommendedIndexes": [
    {
      "tableName": "table_name",
      "indexDdl": "CREATE INDEX CONCURRENTLY idx_... ON ...;",
      "reason": "Why this index helps"
    }
  ],
  "estimatedSpeedup": "Estimated speedup factor, e.g. '5x - 20x speedup'"
}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2,
        },
      }),
      signal: AbortSignal.timeout(8000),
    }
  );

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as any;
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) return null;

  const parsed = JSON.parse(rawText) as AiOptimizationResult;
  return parsed;
}

/**
 * Invokes OpenAI-compatible Chat Completions API with structured JSON output.
 */
async function callOpenAiApi(
  apiKey: string,
  sql: string,
  planJson?: PlanNode[] | null,
  meanLatencyMs?: number,
  calls?: number
): Promise<AiOptimizationResult | null> {
  const prompt = `You are a Principal PostgreSQL Database Architect.
Analyze the following PostgreSQL query and execution plan:

SQL Query:
${sql}

- Mean Latency: ${meanLatencyMs ?? "unknown"} ms
- Execution Calls: ${calls ?? "unknown"}
${planJson ? `- Execution Plan JSON:\n${JSON.stringify(planJson, null, 2)}` : ""}

Respond ONLY with valid JSON with fields: summary, bottlenecks (array of {title, severity, explanation, suggestion}), rewrittenSql, recommendedIndexes (array of {tableName, indexDdl, reason}), estimatedSpeedup.`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are an expert PostgreSQL DBA and query optimizer." },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as any;
  const content = data?.choices?.[0]?.message?.content;
  if (!content) return null;

  return JSON.parse(content) as AiOptimizationResult;
}
