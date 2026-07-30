import postgres from "postgres";

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Validates that a SQL string is a read-only SELECT/SHOW/WITH statement.
 * Rejects anything that looks like a write operation.
 */
function assertReadOnly(sql: string): void {
  // Normalize: strip leading whitespace, comments, and get the first keyword
  const normalized = sql
    .replace(/\/\*[\s\S]*?\*\//g, "") // remove block comments
    .replace(/--.*$/gm, "")           // remove line comments
    .trimStart();

  const firstKeyword = normalized.split(/\s+/)[0]?.toUpperCase();

  const allowedKeywords = new Set([
    "SELECT",
    "SHOW",
    "WITH",
    "EXPLAIN",
  ]);

  if (!firstKeyword || !allowedKeywords.has(firstKeyword)) {
    throw new Error(
      `Unsafe SQL rejected: only SELECT/SHOW/WITH/EXPLAIN statements are allowed. Got: "${firstKeyword}"`
    );
  }
}

export interface SafeQueryOptions {
  /** Query timeout in milliseconds. Default: 10000 */
  timeoutMs?: number;
}

/**
 * Creates a temporary postgres.js connection to a customer database,
 * executes a read-only query, and returns the results.
 * The connection is closed after use.
 */
export async function safeQuery<T extends postgres.MaybeRow[]>(
  connectionString: string,
  sql: string,
  options: SafeQueryOptions = {}
): Promise<T> {
  assertReadOnly(sql);

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const client = postgres(connectionString, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
  });

  try {
    const result = await Promise.race([
      client.unsafe(sql) as Promise<T>,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Query timed out after ${timeoutMs}ms`)),
          timeoutMs
        )
      ),
    ]);

    return result;
  } finally {
    await client.end({ timeout: 5 });
  }
}
