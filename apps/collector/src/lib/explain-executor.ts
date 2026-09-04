import type { FastifyBaseLogger } from "fastify";
import * as crypto from "crypto";
import { safeQuery } from "./safe-query.js";

/* ===================================================================
   Robust EXPLAIN Plan Executor
   
   Supports parameterized queries from pg_stat_statements ($1, $2, etc.)
   using multi-tier execution:
   1. Direct EXPLAIN (for queries without parameters)
   2. Untyped PREPARE + EXPLAIN (GENERIC_PLAN) [Postgres 16+]
   3. Typed PREPARE + EXPLAIN (GENERIC_PLAN)
   4. PREPARE + EXECUTE with dummy arguments
   5. Context-aware Smart Parameter Substitution (LIMIT, OFFSET, typecasts, etc.)
   =================================================================== */

export interface PlanNode {
  "Node Type": string;
  "Total Cost"?: number;
  "Plan Rows"?: number;
  "Shared Hit Blocks"?: number;
  "Shared Read Blocks"?: number;
  "Sort Method"?: string;
  "Relation Name"?: string;
  "Alias"?: string;
  "Filter"?: string;
  "Index Name"?: string;
  Plans?: PlanNode[];
  [key: string]: unknown;
}

export interface PlanWarning {
  type: string;
  message: string;
  nodeType: string;
  details: Record<string, unknown>;
}

export interface ExecuteExplainResult {
  planJson: PlanNode[] | null;
  planText: string | null;
  topNodeType: string;
  planShapeHash: string;
  estimatedCost: number | null;
  planFlags: Record<string, unknown>;
  warnings: PlanWarning[];
  substitutedQueryText?: string;
  usedStrategy: string;
}

/**
 * Checks if a query is a utility statement that cannot be EXPLAINed.
 */
export function isUtilityStatement(queryText: string): boolean {
  const trimmed = queryText.trim().toUpperCase();
  const nonExplainablePrefixes = [
    "SET ",
    "RESET ",
    "COPY ",
    "CREATE ",
    "ALTER ",
    "DROP ",
    "GRANT ",
    "REVOKE ",
    "VACUUM ",
    "ANALYZE ",
    "COMMIT",
    "BEGIN",
    "ROLLBACK",
    "LISTEN",
    "UNLISTEN",
    "CLOSE ",
    "DEALLOCATE ",
    "DISCARD ",
    "FETCH ",
    "MOVE ",
    "CHECKPOINT",
    "LOCK ",
  ];

  return nonExplainablePrefixes.some((prefix) => trimmed.startsWith(prefix));
}

/**
 * Checks if a query is a DML statement (INSERT, UPDATE, DELETE).
 * PostgreSQL strictly requires table modification privileges to EXPLAIN DML statements,
 * which read-only monitoring roles do not have.
 */
export function isDmlStatement(queryText: string): boolean {
  // Strip comments and string literals
  const cleaned = queryText
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--.*$/gm, "")
    .trim();
  const upper = cleaned.toUpperCase();

  // Top-level DML statements
  if (/^(INSERT\s+INTO|UPDATE\b|DELETE\s+(?:ONLY\s+)?FROM|MERGE\s+INTO)/i.test(cleaned)) {
    return true;
  }

  // Data-modifying CTEs (WITH ... INSERT/UPDATE/DELETE/MERGE)
  if (upper.startsWith("WITH")) {
    return /\b(INSERT\s+INTO|UPDATE\s+[\s\S]+?\bSET\b|DELETE\s+(?:ONLY\s+)?FROM|MERGE\s+INTO)\b/i.test(cleaned);
  }

  return false;
}

/**
 * Checks if a query text is truncated (e.g. cut off by PostgreSQL's track_activity_query_size).
 * Handles string literals, single-line and multi-line comments, and trailing semicolons.
 */
export function isQueryTruncated(queryText: string): boolean {
  const trimmed = queryText.trim().replace(/;+\s*$/, "");
  if (!trimmed) return false;

  let inSingleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let openParens = 0;
  let codeWithoutComments = "";

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    const nextChar = trimmed[i + 1];

    if (inLineComment) {
      if (char === "\n") inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && nextChar === "/") {
        inBlockComment = false;
        i++; // skip /
      }
      continue;
    }

    if (inSingleQuote) {
      if (char === "'") {
        if (nextChar === "'") {
          i++; // skip escaped quote ''
        } else {
          inSingleQuote = false;
        }
      }
      continue;
    }

    // Normal SQL mode: check comment or string starts
    if (char === "-" && nextChar === "-") {
      inLineComment = true;
      i++;
      continue;
    }

    if (char === "/" && nextChar === "*") {
      inBlockComment = true;
      i++;
      continue;
    }

    if (char === "'") {
      inSingleQuote = true;
      continue;
    }

    if (char === "(") {
      openParens++;
    } else if (char === ")") {
      openParens--;
    }

    codeWithoutComments += char;
  }

  // If query cuts off inside a string literal, unclosed block comment, or unclosed parentheses
  if (inSingleQuote || inBlockComment || openParens > 0) {
    return true;
  }

  const cleanCode = codeWithoutComments.trim();

  // Check for trailing punctuation / opening brackets that cannot end a valid statement
  if (/[,(\[]\s*$/.test(cleanCode)) {
    return true;
  }

  // Check for trailing clause keywords or operators that indicate cut-off SQL
  if (
    /\b(WHERE|AND|OR|JOIN|ON|FROM|SELECT|SET|VALUES|IN|BETWEEN|AS|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|OFFSET)\s*$/i.test(
      cleanCode
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Extracts parameter count and identifiers (e.g. $1, $2, $3).
 */
export function extractParameterInfo(queryText: string): {
  hasParameters: boolean;
  maxParamIndex: number;
  paramMatches: string[];
} {
  const matches = queryText.match(/\$\d+/g) || [];
  const indices = matches.map((m) => parseInt(m.slice(1), 10)).filter((n) => !isNaN(n));
  const maxParamIndex = indices.length > 0 ? Math.max(...indices) : 0;

  return {
    hasParameters: matches.length > 0,
    maxParamIndex,
    paramMatches: Array.from(new Set(matches)),
  };
}

/**
 * Applies custom user-supplied parameter bindings (e.g. { "$1": "42", "$2": "'admin'" }).
 */
export function applyUserParameters(
  queryText: string,
  parameters?: Record<string, string>
): string {
  if (!parameters || Object.keys(parameters).length === 0) {
    return queryText;
  }

  let result = queryText;
  // Sort keys by length descending ($10 before $1) so replacing $1 doesn't mess up $10
  const sortedKeys = Object.keys(parameters).sort((a, b) => b.length - a.length);

  for (const key of sortedKeys) {
    const rawVal = parameters[key];
    if (rawVal === undefined || rawVal === null) continue;
    const formattedKey = key.startsWith("$") ? `\\${key}` : `\\$${key}`;
    const regex = new RegExp(`${formattedKey}\\b`, "g");
    result = result.replace(regex, rawVal);
  }

  return result;
}

/**
 * Performs context-aware substitution for parameters ($1, $2, etc.) to produce a valid SQL statement
 * for EXPLAIN when PREPARE/GENERIC_PLAN cannot be used.
 */
export function substituteQueryParameters(
  queryText: string,
  defaultParamValue: "string" | "number" | "null" | "default" = "string"
): string {
  let modified = queryText;

  // 1. Replace LIMIT $N -> LIMIT 100
  modified = modified.replace(/\bLIMIT\s+\$\d+\b/gi, "LIMIT 100");

  // 2. Replace OFFSET $N -> OFFSET 0
  modified = modified.replace(/\bOFFSET\s+\$\d+\b/gi, "OFFSET 0");

  // 3. Replace typed casts: $N::type
  modified = modified.replace(/\$\d+::uuid\b/gi, "'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid");
  modified = modified.replace(/\$\d+::(timestamptz|timestamp)\b/gi, "NOW()::$1");
  modified = modified.replace(/\$\d+::date\b/gi, "CURRENT_DATE");
  modified = modified.replace(/\$\d+::time\b/gi, "CURRENT_TIME");
  modified = modified.replace(/\$\d+::(int|integer|bigint|smallint|numeric|decimal|float|real|double\s+precision)\b/gi, "1::$1");
  modified = modified.replace(/\$\d+::(bool|boolean)\b/gi, "true");
  modified = modified.replace(/\$\d+::(json|jsonb)\b/gi, "'{}'::$1");
  modified = modified.replace(/\$\d+::(text|varchar|char)\b/gi, "'sample'::$1");

  // 4. Context-aware positional parameter substitutions to prevent Postgres syntax/type errors:
  // 4a. AT TIME ZONE $N -> AT TIME ZONE 'UTC'
  modified = modified.replace(/\bAT\s+TIME\s+ZONE\s+\$\d+\b/gi, "AT TIME ZONE 'UTC'");

  // 4b. EXTRACT($N FROM ...) -> EXTRACT(epoch FROM ...)
  modified = modified.replace(/\bEXTRACT\s*\(\s*\$\d+\s+FROM\b/gi, "EXTRACT(epoch FROM");

  // 4c. JOIN ... ON $N -> ON true / ON ($N) -> ON (true)
  modified = modified.replace(/\bON\s*\(\s*\$\d+\s*\)/gi, "ON (true)");
  modified = modified.replace(/\bON\s+\$\d+\b/gi, "ON true");

  // 4d. Array indexing subscripts: [$N] -> [1]
  modified = modified.replace(/\[\s*\$\d+\s*\]/g, "[1]");

  // 4e. TO_CHAR(..., $N) -> TO_CHAR(..., 'YYYY-MM-DD') with balanced parenthesis check
  modified = modified.replace(/\bTO_CHAR\s*\(([\s\S]*?),\s*\$\d+\s*\)/gi, (match, p1) => {
    let open = 0;
    for (const c of p1) {
      if (c === "(") open++;
      else if (c === ")") open--;
    }
    if (open === 0) {
      return `TO_CHAR(${p1}, 'YYYY-MM-DD')`;
    }
    return match;
  });

  // 5. Replace remaining $N with fallback based on requested default
  let fallbackVal: string;
  switch (defaultParamValue) {
    case "number":
      fallbackVal = "1";
      break;
    case "null":
      fallbackVal = "NULL";
      break;
    case "default":
      fallbackVal = "DEFAULT";
      break;
    case "string":
    default:
      fallbackVal = "'1'"; // '1' is coerced nicely to string, int, uuid, timestamp in Postgres
      break;
  }

  modified = modified.replace(/\$\d+\b/g, fallbackVal);
  return modified;
}

/**
 * Recursively extracts all node types from an EXPLAIN plan in DFS order.
 */
export function extractNodeTypes(node: PlanNode): string[] {
  const types: string[] = [node["Node Type"] || "Unknown"];
  if (node.Plans && Array.isArray(node.Plans)) {
    for (const child of node.Plans) {
      types.push(...extractNodeTypes(child));
    }
  }
  return types;
}

/**
 * Creates a normalized hash of plan node types for shape comparison.
 */
export function hashPlanShape(nodeTypes: string[]): string {
  const shapeStr = nodeTypes.join(" → ");
  return crypto.createHash("sha256").update(shapeStr).digest("hex").slice(0, 16);
}

/**
 * Detects plan flags (concerning patterns) in the plan.
 */
export function detectPlanFlags(
  node: PlanNode,
  flags: Record<string, unknown> = {}
): Record<string, unknown> {
  const nodeType = node["Node Type"] ?? "";
  const planRows = node["Plan Rows"] ?? 0;
  const relationName = node["Relation Name"] ?? node["Alias"];

  if (nodeType.includes("Seq Scan") && planRows > 5000) {
    flags["seq_scan_large_table"] = true;
    if (relationName) flags["seq_scan_table"] = relationName;
    flags["seq_scan_rows"] = planRows;
  }

  if (nodeType.includes("Nested Loop") && planRows > 5000) {
    flags["nested_loop_high_rows"] = true;
    flags["nested_loop_rows"] = planRows;
  }

  if (node["Filter"] && nodeType.includes("Seq Scan")) {
    flags["unindexed_filter"] = true;
  }

  if (node.Plans && Array.isArray(node.Plans)) {
    for (const child of node.Plans) {
      detectPlanFlags(child, flags);
    }
  }

  return flags;
}

/**
 * Recursively walks the EXPLAIN plan tree and flags common performance issues.
 */
export function parsePlanWarnings(planJson: unknown): PlanWarning[] {
  const warnings: PlanWarning[] = [];

  if (!planJson) return warnings;

  let rootNode: PlanNode | undefined;
  if (Array.isArray(planJson)) {
    const first = planJson[0] as { Plan?: PlanNode } | PlanNode | undefined;
    rootNode = (first as { Plan?: PlanNode })?.Plan || (first as PlanNode);
  } else if ((planJson as { Plan?: PlanNode }).Plan) {
    rootNode = (planJson as { Plan?: PlanNode }).Plan;
  } else if ((planJson as PlanNode)["Node Type"]) {
    rootNode = planJson as PlanNode;
  }

  if (!rootNode) return warnings;

  walkPlanNode(rootNode, warnings);
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
      message: `Nested loop join producing ~${planRows.toLocaleString()} rows. Consider restructuring the query or adding indexes.`,
      nodeType,
      details: { planRows },
    });
  }

  // High cache miss ratio
  if (readBlocks > 0 && readBlocks > hitBlocks) {
    warnings.push({
      type: "high_cache_miss",
      message: `High cache miss rate: ${readBlocks} disk reads vs ${hitBlocks} cache hits for "${nodeType}" on "${relationName}".`,
      nodeType,
      details: { readBlocks, hitBlocks, relationName },
    });
  }

  // Sort spilling to disk
  if (sortMethod && typeof sortMethod === "string" && sortMethod.toLowerCase().includes("external")) {
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

/**
 * Executes an EXPLAIN command using a multi-tiered fallback approach.
 */
export async function executeRobustExplain(
  connectionString: string,
  queryText: string,
  options?: {
    customParameters?: Record<string, string>;
    log?: FastifyBaseLogger;
    timeoutMs?: number;
  }
): Promise<ExecuteExplainResult> {
  const timeoutMs = options?.timeoutMs ?? 15000;
  const log = options?.log;

  if (isUtilityStatement(queryText)) {
    throw new Error("Utility statements (SET, VACUUM, COMMIT, etc.) do not have an EXPLAIN execution plan.");
  }

  // If user supplied parameter bindings, apply them first
  let workingQuery = applyUserParameters(queryText, options?.customParameters);

  if (isQueryTruncated(workingQuery)) {
    throw new Error("Query text is truncated in pg_stat_statements; cannot EXPLAIN incomplete statement.");
  }

  const paramInfo = extractParameterInfo(workingQuery);

  let rawJsonResult: Array<{ "QUERY PLAN": PlanNode[] | PlanNode }> | undefined;
  let rawTextResult: Array<{ "QUERY PLAN": string }> | undefined;
  let usedStrategy = "direct";
  let substitutedQueryText: string | undefined;

  const checkPermissionError = (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("permission denied") || (err as { code?: string })?.code === "42501") {
      throw new Error(`Database user lacks permissions required by PostgreSQL to EXPLAIN this statement: ${msg}`);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // Strategy 1: Direct EXPLAIN if no $N parameters exist
  // ─────────────────────────────────────────────────────────────
  if (!paramInfo.hasParameters) {
    try {
      rawJsonResult = await safeQuery<Array<{ "QUERY PLAN": PlanNode[] | PlanNode }>>(
        connectionString,
        `EXPLAIN (FORMAT JSON, COSTS) ${workingQuery}`,
        { timeoutMs }
      );
      try {
        rawTextResult = await safeQuery<Array<{ "QUERY PLAN": string }>>(
          connectionString,
          `EXPLAIN (COSTS) ${workingQuery}`,
          { timeoutMs: 5000 }
        );
      } catch {
        // text plan is optional
      }
      usedStrategy = "direct";
    } catch (directErr) {
      checkPermissionError(directErr);
      log?.debug({ err: directErr }, "Direct EXPLAIN failed, attempting parameter substitution fallback");
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Strategy 2: PREPARE statement + EXPLAIN (GENERIC_PLAN)
  // ─────────────────────────────────────────────────────────────
  if (!rawJsonResult && paramInfo.hasParameters) {
    const stmtName = `pgv_exp_${Date.now()}_${Math.floor(Math.random() * 100000)}`;

    // 2a. Untyped PREPARE (Postgres infers column types automatically) + GENERIC_PLAN (PG 16+)
    try {
      await safeQuery(connectionString, `DEALLOCATE ${stmtName}`, { timeoutMs: 3000 }).catch(() => {});
      await safeQuery(
        connectionString,
        `PREPARE ${stmtName} AS ${workingQuery}`,
        { timeoutMs: 5000 }
      );

      rawJsonResult = await safeQuery<Array<{ "QUERY PLAN": PlanNode[] | PlanNode }>>(
        connectionString,
        `EXPLAIN (FORMAT JSON, GENERIC_PLAN) EXECUTE ${stmtName}`,
        { timeoutMs }
      );

      try {
        rawTextResult = await safeQuery<Array<{ "QUERY PLAN": string }>>(
          connectionString,
          `EXPLAIN (GENERIC_PLAN) EXECUTE ${stmtName}`,
          { timeoutMs: 5000 }
        );
      } catch {
        // text plan optional
      }

      await safeQuery(connectionString, `DEALLOCATE ${stmtName}`, { timeoutMs: 3000 }).catch(() => {});
      usedStrategy = "prepare_generic_untyped";
    } catch (untypedErr) {
      checkPermissionError(untypedErr);
      log?.debug({ err: untypedErr }, "Untyped PREPARE + GENERIC_PLAN failed, trying typed PREPARE");
      await safeQuery(connectionString, `DEALLOCATE ${stmtName}`, { timeoutMs: 3000 }).catch(() => {});
    }

    // 2b. Typed PREPARE with `(unknown, ...)` + GENERIC_PLAN
    if (!rawJsonResult) {
      try {
        const paramTypes = Array(paramInfo.maxParamIndex).fill("unknown").join(", ");
        await safeQuery(
          connectionString,
          `PREPARE ${stmtName}(${paramTypes}) AS ${workingQuery}`,
          { timeoutMs: 5000 }
        );

        rawJsonResult = await safeQuery<Array<{ "QUERY PLAN": PlanNode[] | PlanNode }>>(
          connectionString,
          `EXPLAIN (FORMAT JSON, GENERIC_PLAN) EXECUTE ${stmtName}`,
          { timeoutMs }
        );

        await safeQuery(connectionString, `DEALLOCATE ${stmtName}`, { timeoutMs: 3000 }).catch(() => {});
        usedStrategy = "prepare_generic_typed";
      } catch (typedErr) {
        checkPermissionError(typedErr);
        log?.debug({ err: typedErr }, "Typed PREPARE + GENERIC_PLAN failed, trying EXECUTE with dummy args");
        await safeQuery(connectionString, `DEALLOCATE ${stmtName}`, { timeoutMs: 3000 }).catch(() => {});
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Strategy 3: Context-aware Parameter Substitution Fallbacks
  // ─────────────────────────────────────────────────────────────
  if (!rawJsonResult) {
    const substitutionModes: Array<"string" | "number" | "null"> = [
      "string",
      "number",
      "null",
    ];

    let lastSubError: unknown = null;

    for (const mode of substitutionModes) {
      try {
        const subSql = substituteQueryParameters(workingQuery, mode);
        rawJsonResult = await safeQuery<Array<{ "QUERY PLAN": PlanNode[] | PlanNode }>>(
          connectionString,
          `EXPLAIN (FORMAT JSON, COSTS) ${subSql}`,
          { timeoutMs }
        );

        try {
          rawTextResult = await safeQuery<Array<{ "QUERY PLAN": string }>>(
            connectionString,
            `EXPLAIN (COSTS) ${subSql}`,
            { timeoutMs: 5000 }
          );
        } catch {
          // ignore
        }

        substitutedQueryText = subSql;
        usedStrategy = `substitution_${mode}`;
        break;
      } catch (subErr) {
        lastSubError = subErr;
        checkPermissionError(subErr);
      }
    }

    if (!rawJsonResult) {
      throw lastSubError || new Error("Failed to execute EXPLAIN query. Please provide specific parameter bindings.");
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Parse and normalize the captured plan
  // ─────────────────────────────────────────────────────────────
  const rawPlan = rawJsonResult[0]?.["QUERY PLAN"];
  let planArray: PlanNode[] = [];

  if (Array.isArray(rawPlan)) {
    planArray = rawPlan as PlanNode[];
  } else if (rawPlan && typeof rawPlan === "object") {
    planArray = [rawPlan as PlanNode];
  }

  if (planArray.length === 0) {
    throw new Error("EXPLAIN returned an empty plan structure.");
  }

  const rootNode = (planArray[0] as { Plan?: PlanNode })?.Plan || (planArray[0] as PlanNode);
  const topNodeType = rootNode["Node Type"] || "Unknown";
  const nodeTypes = extractNodeTypes(rootNode);
  const planShapeHash = hashPlanShape(nodeTypes);
  const estimatedCost = rootNode["Total Cost"] ?? null;
  const planFlags = detectPlanFlags(rootNode);
  const warnings = parsePlanWarnings(planArray);
  const planText = rawTextResult?.map((r) => r["QUERY PLAN"]).join("\n") || null;

  return {
    planJson: planArray,
    planText,
    topNodeType,
    planShapeHash,
    estimatedCost,
    planFlags,
    warnings,
    substitutedQueryText,
    usedStrategy,
  };
}
