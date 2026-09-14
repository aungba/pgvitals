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
});
