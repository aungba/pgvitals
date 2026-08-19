/* ===================================================================
   SQL-Aware Index & Query Advisor (§2.4)
   Parses normalized SQL query predicates and projections to generate
   production-safe, covering & partial index DDL with quantified CPU savings.
   =================================================================== */

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
}

/**
 * Extracts clean column name or identifier.
 */
function cleanIdentifier(id: string): string {
  return id.replace(/["'`]/g, "").trim();
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

  // 1. Extract Target Table Name
  let tableName: string | null = null;
  const tableMatch = sql.match(/\b(?:FROM|JOIN|UPDATE|INTO)\s+([a-zA-Z0-9_."]+)/i);
  if (tableMatch) {
    let raw = tableMatch[1].replace(/["']/g, "");
    if (raw.includes(".")) {
      raw = raw.split(".").pop() || raw;
    }
    if (raw.length > 1) {
      tableName = raw;
    }
  }

  // 2. Extract WHERE clause
  const whereMatch = sql.match(/\bWHERE\s+([\s\S]+?)(?:\s+(?:GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|OFFSET)|$)/i);
  const whereClause = whereMatch ? whereMatch[1].trim() : "";

  const equalityColumns: string[] = [];
  const rangeColumns: string[] = [];
  const partialConditions: string[] = [];

  if (whereClause) {
    // Split by AND (basic predicate tokenizer)
    const predicates = whereClause.split(/\s+AND\s+/i);

    for (const pred of predicates) {
      const trimmed = pred.trim();

      // Equality: col = $1 or col = 'val'
      const eqMatch = trimmed.match(/^([a-zA-Z0-9_."]+)\s*=\s*(.+)$/i);
      if (eqMatch) {
        const col = cleanIdentifier(eqMatch[1]);
        if (!equalityColumns.includes(col)) {
          equalityColumns.push(col);
        }
        continue;
      }

      // Range or IN: col IN (...) or col > $1 or col < $1
      const inOrRangeMatch = trimmed.match(/^([a-zA-Z0-9_."]+)\s+(?:IN\s*\(|>|<|>=|<=|BETWEEN)\s*(.+)$/i);
      if (inOrRangeMatch) {
        const col = cleanIdentifier(inOrRangeMatch[1]);
        if (!rangeColumns.includes(col) && !equalityColumns.includes(col)) {
          rangeColumns.push(col);
        }
        continue;
      }

      // Partial condition: col IS NOT NULL or col IS NULL
      const nullMatch = trimmed.match(/^([a-zA-Z0-9_."]+)\s+(IS\s+NOT\s+NULL|IS\s+NULL)$/i);
      if (nullMatch) {
        const col = cleanIdentifier(nullMatch[1]);
        const cond = nullMatch[2].toUpperCase();
        partialConditions.push(`${col} ${cond}`);
        continue;
      }
    }
  }

  // 3. Extract Projections (SELECT col1, col2 FROM ...)
  const projectionColumns: string[] = [];
  const selectMatch = sql.match(/^\s*SELECT\s+([\s\S]+?)\s+FROM\s+/i);
  if (selectMatch) {
    const rawCols = selectMatch[1].split(",");
    for (const c of rawCols) {
      const colClean = cleanIdentifier(c.trim());
      // Skip wildcard * and functions like count()
      if (colClean && colClean !== "*" && !colClean.includes("(") && !colClean.includes(")")) {
        // Exclude table prefix e.g. t.col -> col
        const baseCol = colClean.includes(".") ? colClean.split(".").pop()! : colClean;
        if (!projectionColumns.includes(baseCol)) {
          projectionColumns.push(baseCol);
        }
      }
    }
  }

  // 4. Generate Recommended Index DDL
  let recommendedIndexDdl: string | null = null;
  let indexName: string | null = null;

  if (tableName && (equalityColumns.length > 0 || rangeColumns.length > 0)) {
    const indexCols = [...equalityColumns, ...rangeColumns];
    const indexColStr = indexCols.join(", ");

    // Include columns: columns in SELECT projection that are NOT already in the index key
    const includeCols = projectionColumns.filter((p) => !indexCols.includes(p));

    const shortColName = indexCols.slice(0, 2).join("_");
    indexName = `idx_${tableName}_${shortColName}_opt`;

    let ddl = `CREATE INDEX CONCURRENTLY ${indexName} ON "${tableName}" (${indexColStr})`;

    if (includeCols.length > 0 && includeCols.length <= 4) {
      ddl += ` INCLUDE (${includeCols.join(", ")})`;
    }

    if (partialConditions.length > 0) {
      ddl += ` WHERE ${partialConditions.join(" AND ")}`;
    }

    ddl += `;`;
    recommendedIndexDdl = ddl;
  }

  return {
    tableName,
    equalityColumns,
    rangeColumns,
    partialConditions,
    projectionColumns,
    recommendedIndexDdl,
    indexName,
    totalTimeHours,
    estimatedSavingsHours,
    estimatedSavingsPct,
    targetLatencyMs,
  };
}
