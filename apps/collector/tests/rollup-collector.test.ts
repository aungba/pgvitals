import { describe, it, expect, vi } from "vitest";
import { computeRollupForDb } from "../src/collector/rollup-collector.js";

// Mock @pgvitals/db to test aggregation mapping logic
vi.mock("@pgvitals/db", () => {
  return {
    db: {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockResolvedValue([
            {
              activeAvg: 12.456,
              activeMax: 25,
              connAvg: 45.123,
              connMax: 80,
              idleInTxnMax: 3,
              avgTime: 14.82,
              maxTime: 230.5,
              sumCalls: 1540,
            },
          ]),
        })),
      })),
      insert: vi.fn().mockImplementation(() => ({
        values: vi.fn().mockResolvedValue([{ id: "test-rollup-id" }]),
      })),
    },
    snapshots: {
      activeCount: "active_count",
      connectionCount: "connection_count",
      idleInTxnCount: "idle_in_txn_count",
      monitoredDbId: "monitored_db_id",
      timestamp: "timestamp",
    },
    queryStats: {
      meanTimeMs: "mean_time_ms",
      maxTimeMs: "max_time_ms",
      calls: "calls",
      monitoredDbId: "monitored_db_id",
      capturedAt: "captured_at",
    },
    metricRollups: {
      monitoredDbId: "monitored_db_id",
      resolution: "resolution",
      bucket: "bucket",
      activeConnectionsAvg: "active_connections_avg",
      activeConnectionsMax: "active_connections_max",
      connectionCountAvg: "connection_count_avg",
      connectionCountMax: "connection_count_max",
      idleInTxnMax: "idle_in_txn_max",
      avgQueryTimeMs: "avg_query_time_ms",
      maxQueryTimeMs: "max_query_time_ms",
      totalCalls: "total_calls",
    },
  };
});

describe("computeRollupForDb", () => {
  it("computes formatted rollups across snapshots and query stats", async () => {
    const dbId = "00000000-0000-0000-0000-000000000001";
    const start = new Date("2026-08-24T12:00:00Z");
    const end = new Date("2026-08-24T12:05:00Z");

    const result = await computeRollupForDb(dbId, "5m", start, end);

    expect(result).toBeDefined();
    expect(result?.monitoredDbId).toBe(dbId);
    expect(result?.resolution).toBe("5m");
    expect(result?.bucket).toBe(start);
    expect(result?.activeConnectionsAvg).toBe(12.46);
    expect(result?.activeConnectionsMax).toBe(25);
    expect(result?.connectionCountAvg).toBe(45.12);
    expect(result?.connectionCountMax).toBe(80);
    expect(result?.idleInTxnMax).toBe(3);
  });
});
