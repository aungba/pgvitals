import postgres from "postgres";
import crypto from "node:crypto";

export interface ClientPoolOptions {
  /** Maximum number of open connections per monitored database client instance (default: 2) */
  maxConnectionsPerDb?: number;
  /** Idle timeout in milliseconds before a client is eligible for eviction (default: 3 minutes) */
  idleTimeoutMs?: number;
  /** Connect timeout in seconds (default: 10s) */
  connectTimeoutSeconds?: number;
}

interface PooledClientEntry {
  client: postgres.Sql;
  lastUsedAt: number;
  key: string;
}

const DEFAULT_MAX_CONNECTIONS = 2;
const DEFAULT_IDLE_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes
const DEFAULT_CONNECT_TIMEOUT_SEC = 10;

export class TargetDbClientPool {
  private clients = new Map<string, PooledClientEntry>();
  private sweepTimer: NodeJS.Timeout | null = null;
  private readonly idleTimeoutMs: number;
  private readonly maxConnectionsPerDb: number;
  private readonly connectTimeoutSeconds: number;

  constructor(options: ClientPoolOptions = {}) {
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.maxConnectionsPerDb =
      options.maxConnectionsPerDb ?? DEFAULT_MAX_CONNECTIONS;
    this.connectTimeoutSeconds =
      options.connectTimeoutSeconds ?? DEFAULT_CONNECT_TIMEOUT_SEC;

    // Start periodic background idle cleanup
    this.sweepTimer = setInterval(() => {
      this.evictIdleClients().catch(() => {
        /* ignore sweep errors */
      });
    }, 30_000);

    // Prevent sweep timer from blocking process exit
    if (this.sweepTimer.unref) {
      this.sweepTimer.unref();
    }
  }

  private hashKey(connectionString: string): string {
    return crypto.createHash("sha256").update(connectionString).digest("hex");
  }

  /**
   * Retrieves or initializes a pooled postgres client for the given connection string.
   */
  public getClient(connectionString: string): postgres.Sql {
    const key = this.hashKey(connectionString);
    const existing = this.clients.get(key);

    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing.client;
    }

    const client = postgres(connectionString, {
      max: this.maxConnectionsPerDb,
      idle_timeout: Math.ceil(this.idleTimeoutMs / 1000),
      connect_timeout: this.connectTimeoutSeconds,
      connection: {
        application_name: "pgvitals_collector",
      },
    });

    this.clients.set(key, {
      client,
      lastUsedAt: Date.now(),
      key,
    });

    return client;
  }

  /**
   * Closes and removes idle clients from the pool.
   */
  public async evictIdleClients(): Promise<number> {
    const now = Date.now();
    let evictedCount = 0;
    const evictionPromises: Promise<void>[] = [];

    for (const [key, entry] of this.clients.entries()) {
      if (now - entry.lastUsedAt > this.idleTimeoutMs) {
        this.clients.delete(key);
        evictedCount++;
        evictionPromises.push(
          entry.client.end({ timeout: 5 }).catch(() => {
            /* ignore close errors */
          })
        );
      }
    }

    await Promise.allSettled(evictionPromises);
    return evictedCount;
  }

  /**
   * Closes a specific client for a given connection string.
   */
  public async closeClient(connectionString: string): Promise<boolean> {
    const key = this.hashKey(connectionString);
    const entry = this.clients.get(key);
    if (!entry) return false;

    this.clients.delete(key);
    try {
      await entry.client.end({ timeout: 5 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Closes all active clients and stops the background eviction timer.
   */
  public async closeAll(): Promise<void> {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }

    const closePromises = Array.from(this.clients.values()).map((entry) =>
      entry.client.end({ timeout: 5 }).catch(() => {
        /* ignore close errors */
      })
    );

    this.clients.clear();
    await Promise.allSettled(closePromises);
  }

  /**
   * Returns current pool diagnostic metrics.
   */
  public getStats(): { activeClients: number } {
    return {
      activeClients: this.clients.size,
    };
  }
}

export const globalClientPool = new TargetDbClientPool();
