/* ===================================================================
   PG Vitals — GUC Configuration Advisor (PGTune Engine)
   Calculates optimal PostgreSQL server settings based on hardware
   capacity and workload profile, compares against live pg_settings,
   and generates production-safe ALTER SYSTEM and postgresql.conf scripts.
   =================================================================== */

export type WorkloadType = "web" | "oltp" | "dw" | "mixed" | "desktop";
export type DiskType = "ssd" | "hdd" | "san";

export interface HardwareProfile {
  totalRamGb: number;
  cpuCores: number;
  diskType: DiskType;
  workloadType: WorkloadType;
  maxConnections?: number;
  pgVersion?: number; // e.g. 14, 15, 16, 17
}

export interface LiveSetting {
  name: string;
  setting: string;
  unit: string | null;
  category: string;
  context: string; // 'postmaster' | 'sighup' | 'user' | etc.
  bootVal: string | null;
  resetVal: string | null;
  shortDesc: string | null;
}

export interface GucRecommendation {
  name: string;
  category: "memory" | "wal" | "storage" | "parallelism" | "diagnostics";
  currentValue: string;
  currentValueFormatted: string;
  recommendedValue: string;
  recommendedValueFormatted: string;
  status: "optimal" | "warning" | "critical" | "info";
  restartRequired: boolean;
  context: string;
  unit: string | null;
  reason: string;
}

export interface GucAdviceReport {
  profile: HardwareProfile;
  summary: {
    totalEvaluated: number;
    optimalCount: number;
    warningCount: number;
    criticalCount: number;
    restartRequiredCount: number;
  };
  recommendations: GucRecommendation[];
  alterSystemSql: string;
  postgresqlConfSnippet: string;
}

/**
 * Normalizes memory strings (e.g., '128MB', '16GB', '8192kB', '4096', etc.) to megabytes for comparison.
 */
export function parseMemoryToMb(val: string, unit: string | null = null): number {
  if (!val) return 0;
  const clean = val.trim().toLowerCase();

  // If unit is explicitly provided from pg_settings (e.g. '8kB', '16kB', 'kB', 'MB', 'GB')
  const numMatch = clean.match(/^([0-9.]+)\s*([a-z]*)$/);
  if (!numMatch) return 0;

  const rawNum = parseFloat(numMatch[1]);
  const rawUnit = numMatch[2] || (unit ? unit.toLowerCase() : "");

  if (rawUnit === "8kb") return (rawNum * 8) / 1024;
  if (rawUnit === "16kb") return (rawNum * 16) / 1024;
  if (rawUnit === "kb" || rawUnit === "k") return rawNum / 1024;
  if (rawUnit === "mb" || rawUnit === "m") return rawNum;
  if (rawUnit === "gb" || rawUnit === "g") return rawNum * 1024;
  if (rawUnit === "tb" || rawUnit === "t") return rawNum * 1024 * 1024;

  // Assume 8kB pages if no unit on standard buffer settings like shared_buffers
  return (rawNum * 8) / 1024;
}

/**
 * Formats megabytes into a human-readable PostgreSQL unit string (e.g., '4GB', '256MB', '64kB').
 */
export function formatMb(mb: number): string {
  if (mb >= 1024 && mb % 1024 === 0) {
    return `${Math.round(mb / 1024)}GB`;
  }
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)}GB`;
  }
  if (mb >= 1) {
    return `${Math.round(mb)}MB`;
  }
  return `${Math.round(mb * 1024)}kB`;
}

/**
 * Computes optimal settings based on hardware profile and PostgreSQL best practices.
 */
export function computeOptimalSettings(profile: HardwareProfile): Record<string, string> {
  const ramMb = profile.totalRamGb * 1024;
  const cores = Math.max(1, profile.cpuCores);
  const maxConns = profile.maxConnections || (profile.workloadType === "dw" ? 40 : profile.workloadType === "web" ? 200 : 100);

  // 1. Memory Settings
  let sharedBuffersMb: number;
  let effectiveCacheSizeMb: number;
  let maintenanceWorkMemMb: number;
  let workMemMb: number;

  switch (profile.workloadType) {
    case "dw":
      sharedBuffersMb = Math.min(ramMb * 0.4, 32 * 1024);
      effectiveCacheSizeMb = ramMb * 0.75;
      maintenanceWorkMemMb = Math.min(ramMb * 0.1, 4 * 1024);
      workMemMb = Math.max(4, Math.floor((ramMb - sharedBuffersMb) / (maxConns * 2)));
      break;
    case "desktop":
      sharedBuffersMb = Math.min(ramMb * 0.15, 1024);
      effectiveCacheSizeMb = ramMb * 0.5;
      maintenanceWorkMemMb = Math.min(ramMb * 0.05, 512);
      workMemMb = Math.max(4, Math.floor((ramMb - sharedBuffersMb) / (maxConns * 4)));
      break;
    case "web":
    case "oltp":
    case "mixed":
    default:
      // Standard recommended 25% of RAM, capped around 16-32GB for NUMA and OS caching
      sharedBuffersMb = Math.min(ramMb * 0.25, 16 * 1024);
      effectiveCacheSizeMb = ramMb * 0.75;
      maintenanceWorkMemMb = Math.min(ramMb * 0.05, 2 * 1024);
      workMemMb = Math.max(4, Math.floor((ramMb - sharedBuffersMb) / (maxConns * 3)));
      break;
  }

  // Cap work_mem to reasonable limits to prevent OOM
  workMemMb = Math.min(workMemMb, 1024);

  // WAL buffers: 3% of shared_buffers up to 16MB (Postgres 14+ default max) or 64MB
  const walBuffersMb = Math.min(64, Math.max(16, Math.floor(sharedBuffersMb * 0.03)));

  // Checkpoint & WAL sizing
  const minWalSizeMb = profile.workloadType === "dw" ? 4 * 1024 : Math.min(2 * 1024, Math.max(512, Math.floor(ramMb * 0.05)));
  const maxWalSizeMb = profile.workloadType === "dw" ? 16 * 1024 : Math.min(8 * 1024, Math.max(2 * 1024, minWalSizeMb * 4));

  // Storage / Planner Cost
  const isSsd = profile.diskType === "ssd" || profile.diskType === "san";
  const randomPageCost = isSsd ? "1.1" : "4.0";
  const effectiveIoConcurrency = isSsd ? (profile.diskType === "san" ? "300" : "200") : "2";

  // Parallelism
  const maxWorkerProcesses = cores.toString();
  const maxParallelWorkers = cores.toString();
  const maxParallelWorkersPerGather = Math.min(4, Math.max(1, Math.floor(cores / 2))).toString();

  return {
    shared_buffers: formatMb(sharedBuffersMb),
    effective_cache_size: formatMb(effectiveCacheSizeMb),
    maintenance_work_mem: formatMb(maintenanceWorkMemMb),
    work_mem: formatMb(workMemMb),
    wal_buffers: formatMb(walBuffersMb),
    min_wal_size: formatMb(minWalSizeMb),
    max_wal_size: formatMb(maxWalSizeMb),
    checkpoint_completion_target: "0.9",
    checkpoint_timeout: profile.workloadType === "dw" ? "30min" : "15min",
    default_statistics_target: profile.workloadType === "dw" ? "500" : "100",
    random_page_cost: randomPageCost,
    effective_io_concurrency: effectiveIoConcurrency,
    max_worker_processes: maxWorkerProcesses,
    max_parallel_workers: maxParallelWorkers,
    max_parallel_workers_per_gather: maxParallelWorkersPerGather,
    track_io_timing: "on",
    idle_in_transaction_session_timeout: "60000", // 60s in ms
    autovacuum_vacuum_cost_limit: isSsd ? "2000" : "200",
    autovacuum_max_workers: cores >= 8 ? "5" : "3",
  };
}

/**
 * Generates an end-to-end GUC advice report comparing live database settings with optimal targets.
 */
export function generateGucReport(
  profile: HardwareProfile,
  liveSettings: LiveSetting[]
): GucAdviceReport {
  const liveMap = new Map<string, LiveSetting>();
  for (const s of liveSettings) {
    liveMap.set(s.name, s);
  }

  const optimal = computeOptimalSettings(profile);
  const recommendations: GucRecommendation[] = [];

  for (const [name, targetVal] of Object.entries(optimal)) {
    const live = liveMap.get(name);
    const currentValue = live ? live.setting : "default";
    const context = live?.context || "sighup";
    const restartRequired = context === "postmaster";
    const unit = live?.unit || null;

    let category: GucRecommendation["category"] = "memory";
    let reason = "";

    switch (name) {
      case "shared_buffers":
        category = "memory";
        reason = `Dedicated database cache. 25% of total system RAM allows PostgreSQL to buffer hot pages while leaving RAM for the operating system page cache.`;
        break;
      case "effective_cache_size":
        category = "memory";
        reason = `Planner estimate of total memory available for disk caching (RAM + OS cache). Informs the planner whether index scans will fit in memory.`;
        break;
      case "work_mem":
        category = "memory";
        reason = `Memory allocated per complex sort/hash operation. Sized to allow fast in-memory sorting without risking out-of-memory (OOM) killer crashes under max concurrency.`;
        break;
      case "maintenance_work_mem":
        category = "memory";
        reason = `Memory allocated for maintenance operations: VACUUM, CREATE INDEX, and ALTER TABLE. Accelerates autovacuum and index creation significantly.`;
        break;
      case "wal_buffers":
        category = "wal";
        reason = `Write-Ahead Logging buffer space in shared memory. Adequate sizing avoids premature WAL disk writes during high-throughput transactions.`;
        break;
      case "min_wal_size":
      case "max_wal_size":
        category = "wal";
        reason = `Defines the WAL segment retention window between checkpoints. Sized to absorb write spikes without thrashing disk space.`;
        break;
      case "checkpoint_completion_target":
        category = "wal";
        reason = `Spreads checkpoint I/O over 90% of the checkpoint interval to smooth out write I/O spikes and avoid storage starvation.`;
        break;
      case "checkpoint_timeout":
        category = "wal";
        reason = `Maximum time between automatic WAL checkpoints. A 15–30 minute window balances crash recovery time and write performance.`;
        break;
      case "random_page_cost":
        category = "storage";
        reason = `Planner cost ratio of non-sequential to sequential disk page fetches. SSDs should use 1.1 (near-equal access time), preventing unwarranted sequential scans.`;
        break;
      case "effective_io_concurrency":
        category = "storage";
        reason = `Number of concurrent asynchronous disk I/O requests the underlying storage subsystem can service simultaneously. High on SSD/NVMe/SAN.`;
        break;
      case "default_statistics_target":
        category = "storage";
        reason = `Sample size for ANALYZE statistics. Higher values create more detailed planner histograms for complex join/filter selectivity.`;
        break;
      case "max_worker_processes":
      case "max_parallel_workers":
      case "max_parallel_workers_per_gather":
        category = "parallelism";
        reason = `Enables CPU parallel query execution across available hardware cores for large aggregations and sequential scans.`;
        break;
      case "track_io_timing":
        category = "diagnostics";
        reason = `Enables measuring block read and write times in pg_stat_statements. Vital for identifying disk bottlenecks with minimal overhead.`;
        break;
      case "idle_in_transaction_session_timeout":
        category = "diagnostics";
        reason = `Terminates connections that have opened a transaction and abandoned it after 60 seconds, preventing table bloat and XID wraparound.`;
        break;
      case "autovacuum_vacuum_cost_limit":
      case "autovacuum_max_workers":
        category = "diagnostics";
        reason = `Prevents autovacuum worker starvation on write-heavy databases by increasing throttle limits and parallel worker allocation.`;
        break;
    }

    // Evaluate status
    let status: GucRecommendation["status"] = "optimal";

    if (name === "shared_buffers") {
      const curMb = parseMemoryToMb(currentValue, unit);
      const targetMb = parseMemoryToMb(targetVal);
      if (curMb <= 128 && targetMb > 512) {
        status = "critical"; // Default 128MB on production machine
      } else if (Math.abs(curMb - targetMb) / targetMb > 0.3) {
        status = "warning";
      }
    } else if (name === "random_page_cost") {
      const cur = parseFloat(currentValue);
      const target = parseFloat(targetVal);
      if (profile.diskType === "ssd" && cur >= 3.5) {
        status = "warning"; // 4.0 on SSD causes unnecessary Seq Scans
      }
    } else if (name === "track_io_timing") {
      if (currentValue.toLowerCase() === "off") {
        status = "warning";
      }
    } else if (name === "checkpoint_completion_target") {
      const cur = parseFloat(currentValue);
      if (cur < 0.8) {
        status = "warning";
      }
    } else if (name === "work_mem" || name === "maintenance_work_mem") {
      const curMb = parseMemoryToMb(currentValue, unit);
      const targetMb = parseMemoryToMb(targetVal);
      if (curMb < targetMb * 0.25) {
        status = "warning";
      }
    } else {
      if (currentValue.toLowerCase() !== targetVal.toLowerCase()) {
        status = "info";
      }
    }

    recommendations.push({
      name,
      category,
      currentValue,
      currentValueFormatted: formatValue(name, currentValue, unit),
      recommendedValue: targetVal,
      recommendedValueFormatted: targetVal,
      status,
      restartRequired,
      context,
      unit,
      reason,
    });
  }

  // Generate ALTER SYSTEM script
  const alterStatements = recommendations
    .filter((r) => r.status !== "optimal")
    .map((r) => `ALTER SYSTEM SET ${r.name} = '${r.recommendedValue}';`)
    .join("\n");

  const alterSystemSql = `-- PG Vitals Automated GUC Recommendations
-- Hardware Profile: ${profile.totalRamGb}GB RAM, ${profile.cpuCores} Cores, ${profile.diskType.toUpperCase()} Disk, ${profile.workloadType.toUpperCase()} Workload
${alterStatements}

-- Reload non-restart parameters immediately:
SELECT pg_reload_conf();
-- (Note: Settings marked as requiring restart will take effect on next PostgreSQL service restart)`;

  // Generate postgresql.conf block
  const confLines = recommendations
    .map((r) => `${r.name} = '${r.recommendedValue}'\t# ${r.reason.slice(0, 70)}...`)
    .join("\n");

  const postgresqlConfSnippet = `# -------------------------------------------------------------
# PG Vitals Recommended postgresql.conf Settings
# Profile: ${profile.totalRamGb}GB RAM, ${profile.cpuCores} Cores, ${profile.diskType.toUpperCase()}, ${profile.workloadType.toUpperCase()}
# Generated: ${new Date().toISOString()}
# -------------------------------------------------------------
${confLines}`;

  const summary = {
    totalEvaluated: recommendations.length,
    optimalCount: recommendations.filter((r) => r.status === "optimal").length,
    warningCount: recommendations.filter((r) => r.status === "warning").length,
    criticalCount: recommendations.filter((r) => r.status === "critical").length,
    restartRequiredCount: recommendations.filter((r) => r.restartRequired && r.status !== "optimal").length,
  };

  return {
    profile,
    summary,
    recommendations,
    alterSystemSql,
    postgresqlConfSnippet,
  };
}

function formatValue(name: string, val: string, unit: string | null): string {
  if (!val) return "default";
  if (unit && unit.toLowerCase() === "8kb") {
    const mb = (parseFloat(val) * 8) / 1024;
    return formatMb(mb);
  }
  if (unit && unit.toLowerCase() === "kb") {
    const mb = parseFloat(val) / 1024;
    return formatMb(mb);
  }
  if (unit && unit.toLowerCase() === "ms") {
    return `${val}ms`;
  }
  if (unit) {
    return `${val}${unit}`;
  }
  return val;
}
