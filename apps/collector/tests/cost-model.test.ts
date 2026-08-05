import { describe, it, expect } from "vitest";
import { estimateQueryCosts } from "../src/lib/cost-model.js";
import type { CostModelConfig } from "../src/lib/cost-model.js";

/* ===================================================================
   Tests: Cost-Per-Query Estimator (§2.11)
   =================================================================== */

describe("estimateQueryCosts", () => {
  const sampleQueries = [
    {
      queryid: 1001,
      queryText: "SELECT * FROM users WHERE id = $1",
      calls: 50000,
      totalTimeMs: 2500,  // 2.5s total
      sharedBlksRead: 10000,
    },
    {
      queryid: 1002,
      queryText: "INSERT INTO events (type, data) VALUES ($1, $2)",
      calls: 100000,
      totalTimeMs: 5000,  // 5s total
      sharedBlksRead: 0,  // no disk reads (cached)
    },
  ];

  it("should return estimates for all input queries", () => {
    const results = estimateQueryCosts(sampleQueries);
    expect(results).toHaveLength(2);
  });

  it("should preserve query metadata (queryid, queryText, calls)", () => {
    const results = estimateQueryCosts(sampleQueries);
    expect(results[0].queryid).toBe(1001);
    expect(results[0].queryText).toBe("SELECT * FROM users WHERE id = $1");
    expect(results[0].calls).toBe(50000);
  });

  it("should calculate IO cost based on shared_blks_read", () => {
    const results = estimateQueryCosts(sampleQueries, 24);
    const first = results[0];
    // IO: 10000 reads * (720/24) scale = 300,000 monthly reads
    // At $0.00000008/IOP = $0.024
    expect(first.estimatedIoCostPerMonth).toBeGreaterThan(0);
    expect(first.breakdown.diskReadsPerMonth).toBe(300000);
  });

  it("should calculate CPU cost based on total execution time", () => {
    const results = estimateQueryCosts(sampleQueries, 24);
    const first = results[0];
    // CPU: 2.5s / 1000 * (720/24) = 75 cpu-seconds/month
    // At $0.00004/s = $0.003 → rounds to $0.00 at 2dp
    // So check the breakdown (pre-rounding) instead
    expect(first.estimatedCpuCostPerMonth).toBeGreaterThanOrEqual(0);
    expect(first.breakdown.cpuSecondsPerMonth).toBe(75);
  });

  it("should return 0 IO cost for queries with no disk reads", () => {
    const results = estimateQueryCosts(sampleQueries, 24);
    const second = results[1];
    expect(second.estimatedIoCostPerMonth).toBe(0);
    expect(second.breakdown.diskReadsPerMonth).toBe(0);
  });

  it("should scale costs based on snapshot window", () => {
    const oneHour = estimateQueryCosts(sampleQueries, 1);
    const twentyFourHour = estimateQueryCosts(sampleQueries, 24);
    // 1-hour window scales 720x, 24-hour scales 30x
    // So 1-hour costs should be 24x higher than 24-hour costs
    expect(oneHour[0].estimatedTotalCostPerMonth).toBeGreaterThan(
      twentyFourHour[0].estimatedTotalCostPerMonth
    );
  });

  it("should accept custom cost model", () => {
    const expensive: CostModelConfig = {
      costPerIop: 0.001,           // 10000x more expensive
      costPerCpuSecond: 0.001,     // 25x more expensive
      blockSizeBytes: 8192,
    };
    const defaultResults = estimateQueryCosts(sampleQueries, 24);
    const expensiveResults = estimateQueryCosts(sampleQueries, 24, expensive);
    expect(expensiveResults[0].estimatedTotalCostPerMonth).toBeGreaterThan(
      defaultResults[0].estimatedTotalCostPerMonth
    );
  });

  it("should handle empty input", () => {
    const results = estimateQueryCosts([]);
    expect(results).toEqual([]);
  });

  it("should round costs to 2 decimal places", () => {
    const results = estimateQueryCosts(sampleQueries, 24);
    for (const r of results) {
      const ioParts = r.estimatedIoCostPerMonth.toString().split(".");
      const cpuParts = r.estimatedCpuCostPerMonth.toString().split(".");
      if (ioParts[1]) expect(ioParts[1].length).toBeLessThanOrEqual(2);
      if (cpuParts[1]) expect(cpuParts[1].length).toBeLessThanOrEqual(2);
    }
  });

  it("total cost should equal IO + CPU cost", () => {
    const results = estimateQueryCosts(sampleQueries, 24);
    for (const r of results) {
      // Account for rounding: total may differ by ±0.01
      expect(
        Math.abs(
          r.estimatedTotalCostPerMonth -
            (r.estimatedIoCostPerMonth + r.estimatedCpuCostPerMonth)
        )
      ).toBeLessThanOrEqual(0.01);
    }
  });
});
