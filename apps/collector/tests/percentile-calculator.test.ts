import { describe, it, expect } from "vitest";
import { estimatePercentiles } from "../src/collector/percentile-calculator.js";

describe("Percentile Calculator (Spec §3.3)", () => {
  it("returns zero percentiles for invalid or zero mean", () => {
    expect(estimatePercentiles(0, 0, 0, 0)).toEqual({
      p50: 0,
      p95: 0,
      p99: 0,
      varianceRatio: 0,
      isHighVariance: false,
    });
    expect(estimatePercentiles(-5, 2, 1, 10)).toEqual({
      p50: 0,
      p95: 0,
      p99: 0,
      varianceRatio: 0,
      isHighVariance: false,
    });
    expect(estimatePercentiles(NaN, 2, 1, 10)).toEqual({
      p50: 0,
      p95: 0,
      p99: 0,
      varianceRatio: 0,
      isHighVariance: false,
    });
  });

  it("calculates realistic P50, P95, and P99 percentiles bounded by min/max", () => {
    const mean = 10;
    const stddev = 5;
    const min = 2;
    const max = 80;

    const result = estimatePercentiles(mean, stddev, min, max);

    expect(result.p50).toBeGreaterThanOrEqual(min);
    expect(result.p50).toBeLessThanOrEqual(max);

    expect(result.p95).toBeGreaterThanOrEqual(result.p50);
    expect(result.p95).toBeLessThanOrEqual(max);

    expect(result.p99).toBeGreaterThanOrEqual(result.p95);
    expect(result.p99).toBeLessThanOrEqual(max);
  });

  it("correctly identifies high variance queries", () => {
    // 10x spike where max > 500ms
    const mean = 20;
    const stddev = 50;
    const min = 5;
    const max = 1500;

    const result = estimatePercentiles(mean, stddev, min, max);

    expect(result.varianceRatio).toBe((1500 - 20) / 20); // 74
    expect(result.isHighVariance).toBe(true);
  });

  it("does not flag high variance when max is below 500ms", () => {
    // 20x spike, but max is only 100ms
    const mean = 4;
    const stddev = 10;
    const min = 1;
    const max = 100;

    const result = estimatePercentiles(mean, stddev, min, max);

    expect(result.varianceRatio).toBe(24);
    expect(result.isHighVariance).toBe(false);
  });
});
