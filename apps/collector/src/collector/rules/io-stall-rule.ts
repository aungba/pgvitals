/**
 * I/O Stall Rule Heuristic
 * Spec §4.3 — Rule Engine Heuristic for I/O Stalls
 *
 * Evaluates whether a query execution is heavily dominated by storage read/write waits.
 */

export interface IoStallEvaluation {
  severity: "warning" | "critical";
  ruleId: string;
  title: string;
  message: string;
  actionableFix: string;
  metadata: {
    queryid: number | string;
    total_exec_time: number;
    blk_read_time: number;
    blk_write_time: number;
    io_time_percentage: number;
  };
}

export function evaluateIoStall(record: {
  queryid: number | string;
  total_exec_time: number;
  blk_read_time: number;
  blk_write_time: number;
  io_time_percentage: number;
}): IoStallEvaluation | null {
  if (record.io_time_percentage >= 45.0 && record.total_exec_time > 1500) {
    const isCritical = record.io_time_percentage >= 75.0 || record.total_exec_time > 10000;
    return {
      severity: isCritical ? "critical" : "warning",
      ruleId: "io_stall_bottleneck",
      title: "Disk I/O Stall Dominated Execution",
      message: `Query ${record.queryid} spends ${record.io_time_percentage.toFixed(1)}% of total execution time waiting on storage reads/writes (${record.blk_read_time.toFixed(0)}ms read / ${record.blk_write_time.toFixed(0)}ms write).`,
      actionableFix:
        "Investigate missing indexes triggering high sequential disk scans or increase disk throughput (e.g., AWS EBS gp3 provisioned IOPS / burst limit).",
      metadata: {
        queryid: record.queryid,
        total_exec_time: record.total_exec_time,
        blk_read_time: record.blk_read_time,
        blk_write_time: record.blk_write_time,
        io_time_percentage: record.io_time_percentage,
      },
    };
  }
  return null;
}
