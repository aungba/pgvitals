/* ===================================================================
   Query Text Redaction — strips literal values from captured SQL
   
   Spec §10: "v1 requirement: attempt to detect and redact literal
   values in captured query text before storage (basic pattern-based
   redaction of string/numeric literals)"
   
   This is best-effort, not a guarantee. Documented as such.
   =================================================================== */

/**
 * Redacts literal values from SQL query text to prevent PII storage.
 * Replaces:
 * - String literals: 'value' → '$1' (handles escaped quotes)
 * - Numeric literals: 123, 45.67 → $N
 * - Dollar-quoted strings: $$value$$ → $N
 * - Hex literals: 0xFF → $N
 * - Boolean literals: TRUE/FALSE → $N
 * - UUID-like values: 550e8400-e29b-41d4-a716-446655440000 → $N
 *
 * NOTE: This is a best-effort pattern-based approach. Some edge cases
 * (dynamic SQL construction, unusual quoting) may not be caught.
 * Normalized query fingerprints from pg_stat_statements already have
 * params stripped; this is primarily for pg_stat_activity query text.
 */
export function redactQueryLiterals(sql: string): string {
  if (!sql) return sql;

  let counter = 0;
  const next = () => `$${++counter}`;

  let result = sql;

  // 1. Replace dollar-quoted strings: $$...$$, $tag$...$tag$
  result = result.replace(/\$([a-zA-Z_]*)\$[\s\S]*?\$\1\$/g, () => next());

  // 2. Replace single-quoted strings (handling escaped quotes: '')
  result = result.replace(/'(?:[^']|'')*'/g, () => next());

  // 3. Replace UUID-like patterns (before general hex/numeric)
  result = result.replace(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    () => next()
  );

  // 4. Replace hex literals: 0x1F, x'1F'
  result = result.replace(/\b0x[0-9a-fA-F]+\b/g, () => next());
  result = result.replace(/x'[0-9a-fA-F]*'/gi, () => next());

  // 5. Replace numeric literals (integers and decimals, not part of identifiers)
  // Negative lookahead/lookbehind to avoid mangling column names like "col1"
  result = result.replace(/(?<![a-zA-Z_])\b\d+\.?\d*(?:[eE][+-]?\d+)?\b(?![a-zA-Z_])/g, (match, offset) => {
    // Don't replace numbers that are part of $N placeholders we already inserted
    if (offset > 0 && result[offset - 1] === '$') return match;
    // Don't replace numbers that look like they're part of identifiers
    return next();
  });

  // 6. Replace boolean literals
  result = result.replace(/\bTRUE\b/gi, () => next());
  result = result.replace(/\bFALSE\b/gi, () => next());

  return result;
}
