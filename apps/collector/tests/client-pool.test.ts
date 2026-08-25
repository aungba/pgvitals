import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TargetDbClientPool } from "../src/lib/client-pool.js";

describe("TargetDbClientPool", () => {
  let pool: TargetDbClientPool;

  beforeEach(() => {
    pool = new TargetDbClientPool({
      idleTimeoutMs: 50, // short timeout for testing
      maxConnectionsPerDb: 1,
      connectTimeoutSeconds: 2,
    });
  });

  afterEach(async () => {
    await pool.closeAll();
  });

  it("initializes with empty pool stats", () => {
    const stats = pool.getStats();
    expect(stats.activeClients).toBe(0);
  });

  it("caches and reuses client instances for the same connection string", () => {
    const connStr = "postgres://user:pass@localhost:5432/testdb";
    const client1 = pool.getClient(connStr);
    const client2 = pool.getClient(connStr);

    expect(client1).toBe(client2);
    expect(pool.getStats().activeClients).toBe(1);
  });

  it("creates distinct clients for distinct connection strings", () => {
    const conn1 = "postgres://user:pass@localhost:5432/db1";
    const conn2 = "postgres://user:pass@localhost:5432/db2";

    const client1 = pool.getClient(conn1);
    const client2 = pool.getClient(conn2);

    expect(client1).not.toBe(client2);
    expect(pool.getStats().activeClients).toBe(2);
  });

  it("evicts clients that have exceeded the idle timeout", async () => {
    const connStr = "postgres://user:pass@localhost:5432/evictdb";
    pool.getClient(connStr);
    expect(pool.getStats().activeClients).toBe(1);

    // Wait for idleTimeoutMs (50ms)
    await new Promise((resolve) => setTimeout(resolve, 70));

    const evicted = await pool.evictIdleClients();
    expect(evicted).toBe(1);
    expect(pool.getStats().activeClients).toBe(0);
  });

  it("closes specific clients via closeClient", async () => {
    const connStr = "postgres://user:pass@localhost:5432/closedb";
    pool.getClient(connStr);
    expect(pool.getStats().activeClients).toBe(1);

    const closed = await pool.closeClient(connStr);
    expect(closed).toBe(true);
    expect(pool.getStats().activeClients).toBe(0);

    const closedAgain = await pool.closeClient(connStr);
    expect(closedAgain).toBe(false);
  });

  it("closes all clients cleanly via closeAll", async () => {
    pool.getClient("postgres://user:pass@localhost:5432/db1");
    pool.getClient("postgres://user:pass@localhost:5432/db2");
    expect(pool.getStats().activeClients).toBe(2);

    await pool.closeAll();
    expect(pool.getStats().activeClients).toBe(0);
  });
});
