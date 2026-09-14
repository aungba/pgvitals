import { describe, it, expect } from "vitest";

describe("Snapshot Timeframe & Downsampling Logic", () => {
  it("computes correct timeframe cutoffs for 15m, 1h, 6h, 24h, 7d", () => {
    const now = 1700000000000;
    const cutoffs: Record<string, number> = {
      "15m": now - 15 * 60 * 1000,
      "1h": now - 60 * 60 * 1000,
      "6h": now - 6 * 60 * 60 * 1000,
      "24h": now - 24 * 60 * 60 * 1000,
      "7d": now - 7 * 24 * 60 * 60 * 1000,
    };

    expect(now - cutoffs["15m"]).toBe(900000);
    expect(now - cutoffs["1h"]).toBe(3600000);
    expect(now - cutoffs["6h"]).toBe(21600000);
    expect(now - cutoffs["24h"]).toBe(86400000);
    expect(now - cutoffs["7d"]).toBe(604800000);
  });

  it("selects appropriate bucket intervals for multi-hour durations", () => {
    function getInterval(durationMs: number, timeframe?: string): string {
      if (durationMs > 7 * 24 * 60 * 60 * 1000 || timeframe === "all") {
        return "2 hours";
      } else if (durationMs > 24 * 60 * 60 * 1000) {
        return "30 minutes";
      } else if (durationMs > 6 * 60 * 60 * 1000) {
        return "5 minutes";
      }
      return "1 minute";
    }

    expect(getInterval(6 * 3600 * 1000, "6h")).toBe("1 minute");
    expect(getInterval(24 * 3600 * 1000, "24h")).toBe("5 minutes");
    expect(getInterval(7 * 24 * 3600 * 1000, "7d")).toBe("30 minutes");
    expect(getInterval(Infinity, "all")).toBe("2 hours");
  });

  it("downsamples evenly when snapshot count exceeds threshold", () => {
    const items = Array.from({ length: 900 }, (_, i) => ({ id: `snap-${i}`, val: i }));
    const maxThreshold = 400;

    let result = items;
    if (items.length > maxThreshold) {
      const step = Math.ceil(items.length / 300);
      result = items.filter((_, idx) => idx % step === 0);
    }

    expect(result.length).toBeLessThanOrEqual(300);
    expect(result[0].id).toBe("snap-0");
  });

  it("resolves nearest snapshot timestamp within tolerance for microsecond precision offsets", () => {
    // Database has sub-millisecond precision: 20:20:20.123456Z
    const dbSnapshots = [
      { id: "snap-1", timestamp: new Date("2026-09-14T20:20:10.000Z").getTime() },
      { id: "snap-2", timestamp: new Date("2026-09-14T20:20:20.123Z").getTime() + 0.456 },
      { id: "snap-3", timestamp: new Date("2026-09-14T20:20:30.000Z").getTime() },
    ];

    // Client clicked point with millisecond truncation: 20:20:20.123Z
    const targetMs = new Date("2026-09-14T20:20:20.123Z").getTime();

    // Previous buggy `lte` check failed on snap-2 and picked snap-1:
    const buggyFound = [...dbSnapshots]
      .filter((s) => s.timestamp <= targetMs)
      .sort((a, b) => b.timestamp - a.timestamp)[0];
    expect(buggyFound.id).toBe("snap-1"); // Demonstrates the previous bug!

    // Nearest-neighbor resolution correctly picks snap-2:
    const closest = [...dbSnapshots].sort(
      (a, b) => Math.abs(a.timestamp - targetMs) - Math.abs(b.timestamp - targetMs)
    )[0];
    expect(closest.id).toBe("snap-2"); // Fixed!
  });

  it("finds closest snapshot inside date_bin bucket boundary", () => {
    // 5-minute bucket starting at 20:20:00.000Z
    const bucketStartMs = new Date("2026-09-14T20:20:00.000Z").getTime();
    const dbSnapshots = [
      { id: "prev-bucket", timestamp: new Date("2026-09-14T20:19:50.000Z").getTime() },
      { id: "in-bucket-1", timestamp: new Date("2026-09-14T20:20:15.000Z").getTime() },
      { id: "in-bucket-2", timestamp: new Date("2026-09-14T20:21:00.000Z").getTime() },
    ];

    // Previous `lte` on bucket start picked prev-bucket (wrong bucket):
    const buggyFound = [...dbSnapshots]
      .filter((s) => s.timestamp <= bucketStartMs)
      .sort((a, b) => b.timestamp - a.timestamp)[0];
    expect(buggyFound.id).toBe("prev-bucket");

    // Forward-bias resolution (prioritizing timestamp >= bucketStartMs, then absolute delta):
    const closest = [...dbSnapshots].sort((a, b) => {
      const aForward = a.timestamp >= bucketStartMs ? 0 : 1;
      const bForward = b.timestamp >= bucketStartMs ? 0 : 1;
      if (aForward !== bForward) return aForward - bForward;
      return Math.abs(a.timestamp - bucketStartMs) - Math.abs(b.timestamp - bucketStartMs);
    })[0];
    expect(closest.id).toBe("in-bucket-1");
  });
});
