/* ===================================================================
   SQL-Aware Index & Query Advisor (§2.4)
   Parses normalized SQL query predicates and projections to generate
   production-safe, covering & partial index DDL with quantified CPU savings.
   =================================================================== */

export interface RecommendedIndex {
  tableName: string;
  recommendedIndexDdl: string;
  indexName: string;
}

export interface SqlAdvice {
  tableName: string | null;
  equalityColumns: string[];
  rangeColumns: string[];
  partialConditions: string[];
  projectionColumns: string[];
  recommendedIndexDdl: string | null;
  indexName: string | null;
  totalTimeHours: number;
  estimatedSavingsHours: number;
  estimatedSavingsPct: number;
  targetLatencyMs: number;
  allRecommendations?: RecommendedIndex[];
}

interface TableRef {
  tableName: string;
  alias: string;
}

interface TableAnalysis {
  tableName: string;
  equalityColumns: string[];
  rangeColumns: string[];
  partialConditions: string[];
  projectionColumns: string[];
}

interface ParsedColumn {
  prefix: string | null;
  columnName: string;
}

/**
 * Extracts clean column name or identifier.
 */
function cleanIdentifier(id: string): string {
  return id.replace(/["'`]/g, "").trim();
}

/**
 * Parses column identifier into prefix and base column name.
 * e.g. "tnt025.syskey" -> { prefix: "tnt025", columnName: "syskey" }
 * e.g. "syskey" -> { prefix: null, columnName: "syskey" }
 */
function parseColumnIdentifier(raw: string): ParsedColumn {
  const cleaned = cleanIdentifier(raw);
  if (cleaned.includes(".")) {
    const parts = cleaned.split(".");
    const columnName = parts.pop()!;
    const prefix = parts.pop() || null;
    return { prefix, columnName };
  }
  return { prefix: null, columnName: cleaned };
}

/**
 * Extracts all tables and their aliases from FROM, JOIN, UPDATE, INTO clauses.
 */
function extractTableRefs(sql: string): TableRef[] {
  const tables: TableRef[] = [];
  const seen = new Set<string>();

  const regex = /\b(?:FROM|JOIN|UPDATE|INTO)\s+([a-zA-Z0-9_".]+)(?:\s+(?:AS\s+)?(?!(?:WHERE|ON|JOIN|LEFT|RIGHT|INNER|OUTER|CROSS|FULL|SET|GROUP|ORDER|HAVING|LIMIT|OFFSET|USING|WINDOW|SELECT)\b)([a-zA-Z0-9_"]+))?/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(sql)) !== null) {
    let rawTable = match[1].replace(/["'`]/g, "").trim();
    if (rawTable.includes(".")) {
      rawTable = rawTable.split(".").pop() || rawTable;
    }
    if (!rawTable || rawTable.length < 2) continue;

    const alias = match[2] ? match[2].replace(/["'`]/g, "").trim() : rawTable;

    const key = `${rawTable.toLowerCase()}:${alias.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      tables.push({ tableName: rawTable, alias });
    }
  }

  return tables;
}

/**
 * Finds the table matching a column's prefix, or falls back to primary table if unqualified.
 */
function findTargetTable(parsed: ParsedColumn, tables: TableRef[]): TableRef | null {
  if (tables.length === 0) return null;

  if (parsed.prefix) {
    const pLower = parsed.prefix.toLowerCase();
    const found = tables.find(
      (t) => t.alias.toLowerCase() === pLower || t.tableName.toLowerCase() === pLower
    );
    if (found) return found;
    // If prefix is present but unrecognized in a multi-table query, avoid misattributing
    if (tables.length > 1) return null;
  }

  return tables[0];
}

/**
 * Parses SQL query shape and produces targeted index DDL and savings estimates.
 */
export function analyzeSqlAdvice(
  sql: string,
  calls: number,
  meanTimeMs: number,
  pctOfTotalTime = 0
): SqlAdvice {
  const totalTimeHours = Math.round(((calls * meanTimeMs) / (1000 * 60 * 60)) * 10) / 10;
  const targetLatencyMs = 0.05; // Target optimal Index-Only / B-Tree point-lookup latency
  const estimatedSavingsHours =
    Math.round(((calls * Math.max(0, meanTimeMs - targetLatencyMs)) / (1000 * 60 * 60)) * 10) / 10;
  const estimatedSavingsPct =
    meanTimeMs > targetLatencyMs
      ? Math.min(99, Math.round(((meanTimeMs - targetLatencyMs) / meanTimeMs) * 100))
      : 0;

  // 1. Extract Target Tables
  const tables = extractTableRefs(sql);
  const tableMap = new Map<string, TableAnalysis>();

  for (const t of tables) {
    if (!tableMap.has(t.tableName)) {
      tableMap.set(t.tableName, {
        tableName: t.tableName,
        equalityColumns: [],
        rangeColumns: [],
        partialConditions: [],
        projectionColumns: [],
      });
    }
  }

  // 2. Extract WHERE clause
  const whereMatch = sql.match(/\bWHERE\s+([\s\S]+?)(?:\s+(?:GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|OFFSET)|$)/i);
  const whereClause = whereMatch ? whereMatch[1].trim() : "";

  if (whereClause && tables.length > 0) {
    // Split by AND (basic predicate tokenizer)
    const predicates = whereClause.split(/\s+AND\s+/i);

    for (const pred of predicates) {
      const trimmed = pred.trim();

      // Equality: col = $1 or col = 'val'
      const eqMatch = trimmed.match(/^([a-zA-Z0-9_."]+)\s*=\s*(.+)$/i);
      if (eqMatch) {
        const parsed = parseColumnIdentifier(eqMatch[1]);
        const target = findTargetTable(parsed, tables);
        if (target) {
          const analysis = tableMap.get(target.tableName);
          if (analysis && !analysis.equalityColumns.includes(parsed.columnName)) {
            analysis.equalityColumns.push(parsed.columnName);
          }
        }
        continue;
      }

      // Range or IN: col IN (...) or col > $1 or col < $1
      const inOrRangeMatch = trimmed.match(/^([a-zA-Z0-9_."]+)\s+(?:IN\s*\(|>|<|>=|<=|BETWEEN)\s*(.+)$/i);
      if (inOrRangeMatch) {
        const parsed = parseColumnIdentifier(inOrRangeMatch[1]);
        const target = findTargetTable(parsed, tables);
        if (target) {
          const analysis = tableMap.get(target.tableName);
          if (analysis && !analysis.rangeColumns.includes(parsed.columnName) && !analysis.equalityColumns.includes(parsed.columnName)) {
            analysis.rangeColumns.push(parsed.columnName);
          }
        }
        continue;
      }

      // Partial condition: col IS NOT NULL or col IS NULL
      const nullMatch = trimmed.match(/^([a-zA-Z0-9_."]+)\s+(IS\s+NOT\s+NULL|IS\s+NULL)$/i);
      if (nullMatch) {
        const parsed = parseColumnIdentifier(nullMatch[1]);
        const target = findTargetTable(parsed, tables);
        if (target) {
          const analysis = tableMap.get(target.tableName);
          const cond = `${parsed.columnName} ${nullMatch[2].toUpperCase()}`;
          if (analysis && !analysis.partialConditions.includes(cond)) {
            analysis.partialConditions.push(cond);
          }
        }
        continue;
      }
    }
  }

  // 3. Extract Projections (SELECT col1, col2 FROM ...)
  const selectMatch = sql.match(/^\s*SELECT\s+([\s\S]+?)\s+FROM\s+/i);
  if (selectMatch && tables.length > 0) {
    const rawCols = selectMatch[1].split(",");
    for (const c of rawCols) {
      const trimmedCol = c.trim();
      if (!trimmedCol || trimmedCol === "*" || trimmedCol.includes("(") || trimmedCol.includes(")")) {
        continue;
      }
      const parsed = parseColumnIdentifier(trimmedCol);
      const target = findTargetTable(parsed, tables);
      if (target) {
        const analysis = tableMap.get(target.tableName);
        if (analysis && !analysis.projectionColumns.includes(parsed.columnName)) {
          analysis.projectionColumns.push(parsed.columnName);
        }
      }
    }
  }

  // Helper to build safe DDL for a specific table
  function buildIndexDdl(analysis: TableAnalysis): { ddl: string | null; indexName: string | null } {
    const { tableName, equalityColumns, rangeColumns, partialConditions, projectionColumns } = analysis;
    if (equalityColumns.length === 0 && rangeColumns.length === 0) {
      return { ddl: null, indexName: null };
    }

    const indexCols = [...equalityColumns, ...rangeColumns];
    const indexColStr = indexCols.join(", ");

    // Include columns: columns in SELECT projection that are NOT already in the index key
    const includeCols = projectionColumns.filter((p) => !indexCols.includes(p));

    // Sanitize index name so it never contains dots or illegal punctuation
    const shortColName = indexCols
      .slice(0, 2)
      .map((c) => c.replace(/[^a-zA-Z0-9_]/g, "_"))
      .join("_")
      .replace(/_+/g, "_");

    const cleanTableName = tableName.replace(/[^a-zA-Z0-9_]/g, "_");
    const indexName = `idx_${cleanTableName}_${shortColName}_opt`;

    let ddl = `CREATE INDEX CONCURRENTLY ${indexName} ON "${tableName}" (${indexColStr})`;

    if (includeCols.length > 0 && includeCols.length <= 4) {
      ddl += ` INCLUDE (${includeCols.join(", ")})`;
    }

    if (partialConditions.length > 0) {
      ddl += ` WHERE ${partialConditions.join(" AND ")}`;
    }

    ddl += `;`;
    return { ddl, indexName };
  }

  // 4. Select the best table to recommend an index for
  // If primary table has equality/range filters, prioritize it.
  // Otherwise, select the joined table with the most filters.
  const analyses = Array.from(tableMap.values());
  let chosenAnalysis: TableAnalysis | null = null;

  if (analyses.length > 0) {
    const primary = analyses[0];
    if (primary.equalityColumns.length > 0 || primary.rangeColumns.length > 0) {
      chosenAnalysis = primary;
    } else {
      // Pick table with highest filter count
      const filtered = analyses.filter((a) => a.equalityColumns.length > 0 || a.rangeColumns.length > 0);
      if (filtered.length > 0) {
        chosenAnalysis = filtered.reduce((prev, curr) =>
          curr.equalityColumns.length + curr.rangeColumns.length >
          prev.equalityColumns.length + prev.rangeColumns.length
            ? curr
            : prev
        );
      } else {
        chosenAnalysis = primary;
      }
    }
  }

  const allRecommendations: RecommendedIndex[] = [];
  for (const a of analyses) {
    const { ddl, indexName } = buildIndexDdl(a);
    if (ddl && indexName) {
      allRecommendations.push({
        tableName: a.tableName,
        recommendedIndexDdl: ddl,
        indexName,
      });
    }
  }

  let recommendedIndexDdl: string | null = null;
  let indexName: string | null = null;

  if (chosenAnalysis) {
    const res = buildIndexDdl(chosenAnalysis);
    recommendedIndexDdl = res.ddl;
    indexName = res.indexName;
  }

  return {
    tableName: chosenAnalysis?.tableName ?? null,
    equalityColumns: chosenAnalysis?.equalityColumns ?? [],
    rangeColumns: chosenAnalysis?.rangeColumns ?? [],
    partialConditions: chosenAnalysis?.partialConditions ?? [],
    projectionColumns: chosenAnalysis?.projectionColumns ?? [],
    recommendedIndexDdl,
    indexName,
    totalTimeHours,
    estimatedSavingsHours,
    estimatedSavingsPct,
    targetLatencyMs,
    allRecommendations,
  };
}
