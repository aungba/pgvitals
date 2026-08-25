import postgres from "postgres";
import { globalClientPool } from "./client-pool.js";

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Validates that a SQL string is a read-only SELECT/SHOW/WITH statement.
 * Rejects anything that looks like a write operation.
 */
export function assertReadOnly(sql: string): void {
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
  /** Whether to use the shared client pool (default: true). Set false for one-off isolated clients */
  usePool?: boolean;
}

/**
 * Executes a read-only query against a customer database using the managed pool
 * or an ephemeral connection, with strict timeout and read-only enforcement.
 */
export async function safeQuery<T extends postgres.MaybeRow[]>(
  connectionString: string,
  sql: string,
  options: SafeQueryOptions = {}
): Promise<T> {
  assertReadOnly(sql);

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const usePool = options.usePool ?? true;

  const client = usePool
    ? globalClientPool.getClient(connectionString)
    : postgres(connectionString, {
        max: 1,
        idle_timeout: 5,
        connect_timeout: 10,
        connection: {
          application_name: "pgvitals_collector",
        },
      });

  let timer: NodeJS.Timeout | null = null;

  try {
    const queryPromise = client.unsafe(sql) as Promise<T>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Query timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    const result = await Promise.race([queryPromise, timeoutPromise]);
    return result;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    if (!usePool) {
      await client.end({ timeout: 5 });
    }
  }
}

