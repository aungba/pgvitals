/**
 * Query Latency Distribution & P95/P99 Percentile Calculator
 * Spec §3.3 — Percentile Estimation Algorithm
 *
 * Uses continuous log-normal distribution modeling derived from
 * pg_stat_statements metrics (mean, stddev, min, max) without requiring
 * per-query distributed tracing overhead.
 */

export interface LatencyDistribution {
  p50: number;
  p95: number;
  p99: number;
  varianceRatio: number;
  isHighVariance: boolean;
}

export function estimatePercentiles(
  mean: number,
  stddev: number,
  min: number,
  max: number
): LatencyDistribution {
  if (mean <= 0 || isNaN(mean)) {
    return { p50: 0, p95: 0, p99: 0, varianceRatio: 0, isHighVariance: false };
  }

  const safeMin = Math.max(0, isNaN(min) ? 0 : min);
  const safeMax = Math.max(safeMin, isNaN(max) ? mean : max);
  const safeStddev = isNaN(stddev) || stddev < 0 ? 0 : stddev;

  // Parameter estimation for log-normal distribution modeling query latencies
  const variance = Math.pow(safeStddev, 2);
  const meanSq = Math.pow(mean, 2);
  const mu = Math.log(meanSq / Math.sqrt(variance + meanSq) || 1);
  const sigma = Math.sqrt(Math.log(1 + variance / meanSq)) || 0.1;

  // Derive percentiles bounded by recorded min/max
  const rawP50 = Math.exp(mu);
  const rawP95 = Math.exp(mu + 1.64485 * sigma);
  const rawP99 = Math.exp(mu + 2.32635 * sigma);

  const p50 = Number(Math.max(safeMin, Math.min(rawP50, safeMax)).toFixed(2));
  const p95 = Number(Math.max(safeMin, Math.min(rawP95, safeMax)).toFixed(2));
  const p99 = Number(Math.max(safeMin, Math.min(rawP99, safeMax)).toFixed(2));

  const varianceRatio = Number(((safeMax - mean) / mean).toFixed(2));
  const isHighVariance = varianceRatio > 10.0 && safeMax > 500; // Flag queries with 10x spikes > 500ms

  return { p50, p95, p99, varianceRatio, isHighVariance };
}
