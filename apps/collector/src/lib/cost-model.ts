/* ===================================================================
   Cost-Per-Query Estimator — spec §2.11, Phase 10

   Translates query I/O and CPU metrics into estimated monthly USD cost.
   Uses configurable cloud cost rates (defaults to AWS RDS pricing).

   NOTE: This is a directional estimate, not precise billing.
   Documented methodology, clearly labeled as an estimate.
   =================================================================== */

export interface CostModelConfig {
  /** Cost per IOPS operation (default: RDS gp3 ~$0.08/million IOPS) */
  costPerIop: number;
  /** Cost per vCPU-second (default: RDS db.r6g.large ~$0.26/hr) */
  costPerCpuSecond: number;
  /** Postgres page size in bytes (always 8192) */
  blockSizeBytes: number;
}

const DEFAULT_COST_MODEL: CostModelConfig = {
  costPerIop: 0.00000008,        // $0.08 per million IOPS
  costPerCpuSecond: 0.00004,     // ~$0.26/hr vCPU → $0.00004/s
  blockSizeBytes: 8192,
};

export interface QueryCostEstimate {
  queryid: number;
  queryText: string;
  calls: number;
  totalTimeMs: number;
  estimatedIoCostPerMonth: number;    // USD
  estimatedCpuCostPerMonth: number;   // USD
  estimatedTotalCostPerMonth: number; // USD
  breakdown: {
    diskReadsPerMonth: number;
    cpuSecondsPerMonth: number;
  };
}

/**
 * Estimate monthly cost for a set of query stats.
 *
 * Methodology:
 * - IO cost: shared_blks_read represents 8KB page reads from disk.
 *   At the current rate, extrapolate to monthly volume.
 * - CPU cost: total_exec_time_ms represents CPU time.
 *   Convert to seconds, extrapolate to monthly.
 * - Extrapolation: stats represent a snapshot window.
 *   Scale by (30 days / snapshot window) to get monthly estimate.
 */
export function estimateQueryCosts(
  queries: Array<{
    queryid: number;
    queryText: string;
    calls: number;
    totalTimeMs: number;
    sharedBlksRead: number;
  }>,
  snapshotWindowHours: number = 24,
  costModel: CostModelConfig = DEFAULT_COST_MODEL
): QueryCostEstimate[] {
  const hoursPerMonth = 30 * 24; // 720
  const scaleFactor = hoursPerMonth / snapshotWindowHours;

  return queries.map((q) => {
    // IO cost: each shared_blks_read is a disk read (one 8KB page)
    const monthlyDiskReads = q.sharedBlksRead * scaleFactor;
    const ioCost = monthlyDiskReads * costModel.costPerIop;

    // CPU cost: total execution time in seconds
    const cpuSeconds = q.totalTimeMs / 1000;
    const monthlyCpuSeconds = cpuSeconds * scaleFactor;
    const cpuCost = monthlyCpuSeconds * costModel.costPerCpuSecond;

    return {
      queryid: q.queryid,
      queryText: q.queryText,
      calls: q.calls,
      totalTimeMs: q.totalTimeMs,
      estimatedIoCostPerMonth: Math.round(ioCost * 100) / 100,
      estimatedCpuCostPerMonth: Math.round(cpuCost * 100) / 100,
      estimatedTotalCostPerMonth: Math.round((ioCost + cpuCost) * 100) / 100,
      breakdown: {
        diskReadsPerMonth: Math.round(monthlyDiskReads),
        cpuSecondsPerMonth: Math.round(monthlyCpuSeconds * 100) / 100,
      },
    };
  });
}
