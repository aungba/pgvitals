"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  getDatabase,
  getVacuumStats,
  getDbHealth,
  getTableCacheHit,
  getDiskGrowth,
  getReplicationStats,
  getReplicationSlots,
  getXidPerTable,
} from "../../../lib/api";
import type {
  Database,
  TableBloatStat,
  DbHealthSnapshot,
  TableCacheHit,
  TableSizeEntry,
  ReplicationSnapshot,
  ReplicationSlotSnapshot,
  TableXidEntry,
} from "../../../lib/api";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  AreaChart,
  Area,
} from "recharts";
import { useChartColors } from "../../../lib/useChartColors";

/* ===================================================================
   Database Health & VACUUM Advisor — Enhanced UI
   =================================================================== */

// ── Formatting Helpers ──────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString();
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function getVacuumUrgency(table: TableBloatStat): "critical" | "warning" | "healthy" {
  if (table.deadTupRatio > 30) return "critical";
  if (table.deadTupRatio > 10) return "warning";
  // Check if last vacuum was > 7 days ago
  const lastVac = table.lastAutovacuum ?? table.lastVacuum;
  if (lastVac) {
    const daysSince = (Date.now() - new Date(lastVac).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince > 14) return "critical";
    if (daysSince > 7) return "warning";
  }
  return "healthy";
}

// ── Types ───────────────────────────────────────────────────────────

type TabId = "overview" | "vacuum" | "storage" | "replication";
type SortDir = "asc" | "desc";
type BloatFilter = "all" | "critical" | "warning" | "healthy";

interface SortState<K extends string> {
  key: K;
  dir: SortDir;
}

// ── Health Score Computation ────────────────────────────────────────

function computeHealthScore(
  health: DbHealthSnapshot | null,
  tables: TableBloatStat[],
  replicas: ReplicationSnapshot[],
): { score: number; grade: string; color: string; items: Array<{ label: string; value: string; color: string }> } {
  let score = 100;
  const items: Array<{ label: string; value: string; color: string }> = [];

  // Cache hit ratio (20% weight)
  if (health?.cacheHitRatio != null) {
    const cacheDeduction = Math.max(0, (99 - health.cacheHitRatio) * 4);
    score -= Math.min(cacheDeduction, 20);
    items.push({
      label: "Cache Hit",
      value: `${health.cacheHitRatio.toFixed(1)}%`,
      color: health.cacheHitRatio >= 99 ? "var(--signal-healthy)" : health.cacheHitRatio >= 95 ? "var(--signal-warning)" : "var(--signal-critical)",
    });
  }

  // Dead tuples (25% weight)
  const critCount = tables.filter((t) => getVacuumUrgency(t) === "critical").length;
  const warnCount = tables.filter((t) => getVacuumUrgency(t) === "warning").length;
  score -= Math.min(critCount * 8 + warnCount * 3, 25);
  if (critCount > 0 || warnCount > 0) {
    items.push({
      label: "VACUUM",
      value: critCount > 0 ? `${critCount} critical` : `${warnCount} warning`,
      color: critCount > 0 ? "var(--signal-critical)" : "var(--signal-warning)",
    });
  } else {
    items.push({ label: "VACUUM", value: "Healthy", color: "var(--signal-healthy)" });
  }

  // XID wraparound (20% weight)
  if (health?.xidPercentUsed != null) {
    const xidDeduction = health.xidPercentUsed > 80 ? 20 : health.xidPercentUsed > 50 ? 10 : health.xidPercentUsed > 30 ? 5 : 0;
    score -= xidDeduction;
    items.push({
      label: "XID",
      value: `${health.xidPercentUsed.toFixed(1)}%`,
      color: health.xidPercentUsed > 80 ? "var(--signal-critical)" : health.xidPercentUsed > 50 ? "var(--signal-warning)" : "var(--signal-healthy)",
    });
  }

  // Replication lag (10% weight)
  if (replicas.length > 0) {
    const maxLag = Math.max(...replicas.map((r) => r.timeLagSeconds ?? 0));
    const lagDeduction = maxLag > 30 ? 10 : maxLag > 5 ? 5 : 0;
    score -= lagDeduction;
    items.push({
      label: "Replication",
      value: maxLag > 0 ? `${maxLag.toFixed(1)}s lag` : "In sync",
      color: maxLag > 30 ? "var(--signal-critical)" : maxLag > 5 ? "var(--signal-warning)" : "var(--signal-healthy)",
    });
  }

  // Deadlocks (10% weight)
  if (health?.deadlocksCount != null && health.deadlocksCount > 0) {
    score -= Math.min(health.deadlocksCount * 5, 10);
    items.push({ label: "Deadlocks", value: String(health.deadlocksCount), color: "var(--signal-critical)" });
  }

  // Checkpoint pressure (10% weight)
  if (health?.checkpointsRequested != null && health?.checkpointsTimed != null) {
    if (health.checkpointsRequested > health.checkpointsTimed) {
      score -= 5;
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const grade = score >= 90 ? "Excellent" : score >= 75 ? "Good" : score >= 50 ? "Fair" : "Poor";
  const color = score >= 90 ? "var(--signal-healthy)" : score >= 75 ? "var(--brand)" : score >= 50 ? "var(--signal-warning)" : "var(--signal-critical)";

  return { score, grade, color, items };
}

// ── Main Component ──────────────────────────────────────────────────

export default function HealthPage() {
  const params = useParams();
  const id = params.id as string;
  const colors = useChartColors();

  // Data state
  const [database, setDatabase] = useState<Database | null>(null);
  const [tables, setTables] = useState<TableBloatStat[]>([]);
  const [health, setHealth] = useState<DbHealthSnapshot | null>(null);
  const [healthHistory, setHealthHistory] = useState<DbHealthSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [cacheHitTables, setCacheHitTables] = useState<TableCacheHit[]>([]);
  const [diskGrowthTables, setDiskGrowthTables] = useState<TableSizeEntry[]>([]);
  const [diskGrowthHistory, setDiskGrowthHistory] = useState<Array<{ tableName: string; totalSizeBytes: number; capturedAt: string }>>([]);
  const [replicas, setReplicas] = useState<ReplicationSnapshot[]>([]);
  const [slots, setSlots] = useState<ReplicationSlotSnapshot[]>([]);
  const [copiedSlotDrop, setCopiedSlotDrop] = useState<string | null>(null);
  const [tableXids, setTableXids] = useState<TableXidEntry[]>([]);
  const [xidFreezeMax, setXidFreezeMax] = useState<number>(200000000);

  // UI state
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [bloatFilter, setBloatFilter] = useState<BloatFilter>("all");
  const [bloatSearch, setBloatSearch] = useState("");
  const [bloatSort, setBloatSort] = useState<SortState<"tableName" | "deadTupRatio" | "nDeadTup" | "totalSizeBytes" | "lastVacuum">>({ key: "deadTupRatio", dir: "desc" });
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [cacheSearch, setCacheSearch] = useState("");
  const [cacheSort, setCacheSort] = useState<SortState<"tableName" | "cacheHitRatio" | "idxCacheHitRatio" | "totalSizeBytes">>({ key: "cacheHitRatio", dir: "asc" });
  const [diskSearch, setDiskSearch] = useState("");
  const [diskSort, setDiskSort] = useState<SortState<"tableName" | "totalSizeBytes" | "growthRateBytesPerDay" | "projectedDaysToDiskLimit">>({ key: "projectedDaysToDiskLimit", dir: "asc" });

  // ── Data Fetching ──────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    try {
      const [db, vacuumData, healthData] = await Promise.all([
        getDatabase(id),
        getVacuumStats(id),
        getDbHealth(id),
      ]);
      setDatabase(db);
      setTables(vacuumData.tables);
      setHealth(healthData.current);
      setHealthHistory(healthData.history);
      // Fetch cache hit, disk growth, replication, and slot data
      try {
        const [cacheData, growthData, replData, slotData, xidData] = await Promise.all([
          getTableCacheHit(id),
          getDiskGrowth(id),
          getReplicationStats(id),
          getReplicationSlots(id).catch(() => ({ slots: [] })),
          getXidPerTable(id).catch(() => ({ freezeMaxAge: 200000000, tables: [] })),
        ]);
        setCacheHitTables(cacheData.tables);
        setDiskGrowthTables(growthData.tables);
        setDiskGrowthHistory(growthData.history ?? []);
        setReplicas(replData.replicas);
        setSlots(slotData.slots ?? []);
        setTableXids(xidData.tables);
        setXidFreezeMax(xidData.freezeMaxAge);
      } catch {
        // optional data
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh every 60s
  useEffect(() => {
    const interval = setInterval(fetchData, 60_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Auto-switch to VACUUM tab if there are critical tables
  useEffect(() => {
    if (!loading && tables.some((t) => getVacuumUrgency(t) === "critical")) {
      setActiveTab("vacuum");
    }
  }, [loading, tables]);

  // ── Computed Values ────────────────────────────────────────────

  const critTables = useMemo(() => tables.filter((t) => getVacuumUrgency(t) === "critical"), [tables]);
  const warnTables = useMemo(() => tables.filter((t) => getVacuumUrgency(t) === "warning"), [tables]);
  const actionTables = useMemo(() => [...critTables, ...warnTables], [critTables, warnTables]);

  const healthScore = useMemo(() => computeHealthScore(health, tables, replicas), [health, tables, replicas]);

  // Sorted & filtered bloat tables
  const filteredBloatTables = useMemo(() => {
    let filtered = tables;
    if (bloatFilter !== "all") {
      filtered = filtered.filter((t) => getVacuumUrgency(t) === bloatFilter);
    }
    if (bloatSearch) {
      const q = bloatSearch.toLowerCase();
      filtered = filtered.filter((t) => t.tableName.toLowerCase().includes(q) || t.schemaName.toLowerCase().includes(q));
    }
    const sorted = [...filtered].sort((a, b) => {
      const dir = bloatSort.dir === "asc" ? 1 : -1;
      switch (bloatSort.key) {
        case "tableName": return dir * a.tableName.localeCompare(b.tableName);
        case "deadTupRatio": return dir * (a.deadTupRatio - b.deadTupRatio);
        case "nDeadTup": return dir * (a.nDeadTup - b.nDeadTup);
        case "totalSizeBytes": return dir * (a.totalSizeBytes - b.totalSizeBytes);
        case "lastVacuum": {
          const aTime = new Date(a.lastAutovacuum ?? a.lastVacuum ?? 0).getTime();
          const bTime = new Date(b.lastAutovacuum ?? b.lastVacuum ?? 0).getTime();
          return dir * (aTime - bTime);
        }
        default: return 0;
      }
    });
    return sorted;
  }, [tables, bloatFilter, bloatSearch, bloatSort]);

  // Sorted & filtered cache tables
  const filteredCacheTables = useMemo(() => {
    let filtered = cacheHitTables;
    if (cacheSearch) {
      const q = cacheSearch.toLowerCase();
      filtered = filtered.filter((t) => t.tableName.toLowerCase().includes(q));
    }
    return [...filtered].sort((a, b) => {
      const dir = cacheSort.dir === "asc" ? 1 : -1;
      switch (cacheSort.key) {
        case "tableName": return dir * a.tableName.localeCompare(b.tableName);
        case "cacheHitRatio": return dir * ((a.cacheHitRatio ?? 0) - (b.cacheHitRatio ?? 0));
        case "idxCacheHitRatio": return dir * ((a.idxCacheHitRatio ?? 0) - (b.idxCacheHitRatio ?? 0));
        case "totalSizeBytes": return dir * (a.totalSizeBytes - b.totalSizeBytes);
        default: return 0;
      }
    });
  }, [cacheHitTables, cacheSearch, cacheSort]);

  // Sorted & filtered disk tables
  const filteredDiskTables = useMemo(() => {
    let filtered = diskGrowthTables;
    if (diskSearch) {
      const q = diskSearch.toLowerCase();
      filtered = filtered.filter((t) => t.tableName.toLowerCase().includes(q));
    }
    return [...filtered].sort((a, b) => {
      const dir = diskSort.dir === "asc" ? 1 : -1;
      switch (diskSort.key) {
        case "tableName": return dir * a.tableName.localeCompare(b.tableName);
        case "totalSizeBytes": return dir * (a.totalSizeBytes - b.totalSizeBytes);
        case "growthRateBytesPerDay": return dir * ((a.growthRateBytesPerDay ?? 0) - (b.growthRateBytesPerDay ?? 0));
        case "projectedDaysToDiskLimit": return dir * ((a.projectedDaysToDiskLimit ?? 99999) - (b.projectedDaysToDiskLimit ?? 99999));
        default: return 0;
      }
    });
  }, [diskGrowthTables, diskSearch, diskSort]);

  // Sparkline data per table
  const sparklineData = useMemo(() => {
    const map = new Map<string, Array<{ time: string; size: number }>>();
    for (const entry of diskGrowthHistory) {
      if (!map.has(entry.tableName)) map.set(entry.tableName, []);
      map.get(entry.tableName)!.push({
        time: new Date(entry.capturedAt).toLocaleDateString([], { month: "short", day: "numeric" }),
        size: entry.totalSizeBytes,
      });
    }
    return map;
  }, [diskGrowthHistory]);

  // ── Handlers ───────────────────────────────────────────────────

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const copyCommand = async (tableName: string, id: string) => {
    try {
      await navigator.clipboard.writeText(`VACUUM ANALYZE "${tableName}";`);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // fallback — ignore
    }
  };

  function toggleBloatSort(key: typeof bloatSort.key) {
    setBloatSort((prev) => ({
      key,
      dir: prev.key === key && prev.dir === "desc" ? "asc" : "desc",
    }));
  }

  function toggleCacheSort(key: typeof cacheSort.key) {
    setCacheSort((prev) => ({
      key,
      dir: prev.key === key && prev.dir === "desc" ? "asc" : "desc",
    }));
  }

  function toggleDiskSort(key: typeof diskSort.key) {
    setDiskSort((prev) => ({
      key,
      dir: prev.key === key && prev.dir === "desc" ? "asc" : "desc",
    }));
  }

  // ── Render ─────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="animate-fade-in">
        <div className="skeleton" style={{ width: 300, height: 32, marginBottom: 16 }} />
        <div className="skeleton" style={{ height: 400, borderRadius: "var(--radius-lg)" }} />
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="detail-header">
        <div className="detail-header-left">
          <Link
            href={`/databases/${id}`}
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 36, height: 36, borderRadius: "var(--radius-md)",
              background: "var(--surface-alt)", border: "1px solid var(--border)",
              color: "var(--text-secondary)", fontSize: "1rem", flexShrink: 0,
            }}
          >←</Link>
          <div>
            <h1>Health — {database?.name}</h1>
            <p style={{ fontSize: "0.9rem", color: "var(--text-secondary)", marginTop: 2 }}>
              VACUUM, bloat, cache, checkpoints & database vitals
            </p>
          </div>
        </div>
      </div>

      {/* ── Health Score Banner ── */}
      <HealthScoreBanner score={healthScore} />

      {/* ── Tab Navigation ── */}
      <div className="health-tabs">
        <button className="health-tab" data-active={activeTab === "overview"} onClick={() => setActiveTab("overview")}>
          📊 Overview
        </button>
        <button className="health-tab" data-active={activeTab === "vacuum"} onClick={() => setActiveTab("vacuum")}>
          🧹 VACUUM & Bloat
          {critTables.length > 0 && <span className="health-tab-badge" data-severity="critical">{critTables.length}</span>}
          {critTables.length === 0 && warnTables.length > 0 && <span className="health-tab-badge" data-severity="warning">{warnTables.length}</span>}
        </button>
        <button className="health-tab" data-active={activeTab === "storage"} onClick={() => setActiveTab("storage")}>
          💾 Storage
          {diskGrowthTables.some((t) => (t.projectedDaysToDiskLimit ?? Infinity) <= 30) && (
            <span className="health-tab-badge" data-severity="critical">!</span>
          )}
        </button>
        <button className="health-tab" data-active={activeTab === "replication"} onClick={() => setActiveTab("replication")}>
          🔄 Replication
          {replicas.some((r) => (r.timeLagSeconds ?? 0) > 30) && (
            <span className="health-tab-badge" data-severity="critical">!</span>
          )}
        </button>
      </div>

      {/* ════════════════════════════════════════════════════════════
         TAB: Overview
         ════════════════════════════════════════════════════════════ */}
      {activeTab === "overview" && (
        <div className="animate-fade-in">
          {/* Deadlock Active Alert Callout Banner */}
          {health && (health.deadlocksCount ?? 0) > 0 && (
            <div
              style={{
                padding: "var(--space-md) var(--space-lg)",
                background: "var(--signal-critical-dim)",
                border: "1px solid var(--signal-critical)",
                borderRadius: "var(--radius-md)",
                marginBottom: "var(--space-lg)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: "var(--space-sm)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
                <span style={{ fontSize: "1.3rem" }}>🔒</span>
                <div>
                  <div style={{ fontWeight: 600, color: "var(--signal-critical)", fontSize: "0.9rem" }}>
                    {health.deadlocksCount} Deadlock{(health.deadlocksCount ?? 0) > 1 ? "s" : ""} Detected (Last 24h)
                  </div>
                  <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: 2 }}>
                    Concurrent transactions blocked each other and were aborted by PostgreSQL deadlock detector.
                  </div>
                </div>
              </div>
              <Link
                href={`/databases/${id}/logs?filter=deadlock`}
                className="btn-primary"
                style={{ fontSize: "0.8rem", padding: "6px 14px", textDecoration: "none" }}
              >
                View Deadlock Queries & Events →
              </Link>
            </div>
          )}

          {/* Health Gauges */}
          {health && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "var(--space-md)", marginBottom: "var(--space-lg)" }}>
              <HealthGauge
                icon="💾" label="Cache Hit"
                value={`${health.cacheHitRatio?.toFixed(1) ?? "—"}%`}
                color={(health.cacheHitRatio ?? 0) >= 99 ? "var(--signal-healthy)" : (health.cacheHitRatio ?? 0) >= 95 ? "var(--signal-warning)" : "var(--signal-critical)"}
                hint={(health.cacheHitRatio ?? 0) >= 99 ? "Excellent" : (health.cacheHitRatio ?? 0) >= 95 ? "Acceptable" : "Low — consider more shared_buffers"}
              />
              <HealthGauge
                icon="📦" label="DB Size"
                value={health.dbSizeBytes != null ? formatBytes(health.dbSizeBytes) : "—"}
                color="var(--brand)"
                hint={`${health.numBackends ?? 0} active backends`}
              />
              <HealthGauge
                icon="✅" label="Commits"
                value={health.xactCommit != null ? formatNumber(health.xactCommit) : "—"}
                color="var(--signal-healthy)"
                hint={`${health.xactRollback ?? 0} rollbacks`}
              />
              <HealthGauge
                icon="🔒" label="Deadlocks"
                value={String(health.deadlocksCount ?? 0)}
                color={(health.deadlocksCount ?? 0) > 0 ? "var(--signal-critical)" : "var(--signal-healthy)"}
                hint={(health.deadlocksCount ?? 0) > 0 ? "Active deadlocks detected" : "No deadlocks"}
                href={`/databases/${id}/logs?filter=deadlock`}
                actionLabel="View Deadlock Events →"
              />
              <HealthGauge
                icon="📝" label="Temp Files"
                value={health.tempFileBytes != null ? formatBytes(health.tempFileBytes) : "—"}
                color={(health.tempFileBytes ?? 0) > 100 * 1024 * 1024 ? "var(--signal-warning)" : "var(--text-muted)"}
                hint="Disk spills from sorts/hashes"
              />
              <HealthGauge
                icon="⚡" label="Checkpoints"
                value={`${health.checkpointsTimed ?? 0} / ${health.checkpointsRequested ?? 0}`}
                color={(health.checkpointsRequested ?? 0) > (health.checkpointsTimed ?? 0) ? "var(--signal-warning)" : "var(--signal-healthy)"}
                hint={health.checkpointSyncTime != null ? `Sync: ${(health.checkpointSyncTime / 1000).toFixed(1)}s | Write: ${((health.checkpointWriteTime ?? 0) / 1000).toFixed(1)}s` : "Timed / Requested"}
              />
              <HealthGauge
                icon="🌊" label="WAL Velocity"
                value={health.walVelocityMbPerMin != null ? `${health.walVelocityMbPerMin.toFixed(1)} MB/m` : "—"}
                color={(health.walVelocityMbPerMin ?? 0) > 50 ? "var(--signal-warning)" : "var(--brand)"}
                hint="Rate of WAL generation"
              />
              <HealthGauge
                icon="📦" label="WAL Archiving"
                value={String(health.archivedWalCount ?? 0)}
                color={(health.failedWalCount ?? 0) > 0 ? "var(--signal-critical)" : "var(--signal-healthy)"}
                hint={(health.failedWalCount ?? 0) > 0 ? `⚠️ ${health.failedWalCount} failed archives` : "Archiver healthy"}
              />
              <HealthGauge
                icon="☢️" label="XID Wraparound"
                value={health.xidPercentUsed != null ? `${health.xidPercentUsed.toFixed(1)}%` : "—"}
                color={
                  (health.xidPercentUsed ?? 0) > 80 ? "var(--signal-critical)"
                    : (health.xidPercentUsed ?? 0) > 50 ? "var(--signal-warning)"
                      : "var(--signal-healthy)"
                }
                hint={
                  (health.xidPercentUsed ?? 0) > 80 ? "Critical — force VACUUM FREEZE"
                    : health.xidAge != null && health.autovacuumFreezeMaxAge != null
                      ? `Age ${formatNumber(health.xidAge)} (freeze threshold: ${formatNumber(health.autovacuumFreezeMaxAge)})`
                      : "No data"
                }
              />
            </div>
          )}

          {/* XID Wraparound Warning Banner */}
          {health && (health.xidPercentUsed ?? 0) > 50 && (
            <div style={{
              padding: "var(--space-md) var(--space-lg)",
              marginBottom: "var(--space-lg)",
              borderRadius: "var(--radius-md)",
              background: (health.xidPercentUsed ?? 0) > 80 ? "var(--signal-critical-dim)" : "var(--signal-warning-dim)",
              borderLeft: `3px solid ${(health.xidPercentUsed ?? 0) > 80 ? "var(--signal-critical)" : "var(--signal-warning)"}`,
            }}>
              <div style={{ fontWeight: 600, marginBottom: 4, color: (health.xidPercentUsed ?? 0) > 80 ? "var(--signal-critical)" : "var(--signal-warning)" }}>
                ☢️ Transaction ID Wraparound Risk: {health.xidPercentUsed?.toFixed(1)}% of freeze threshold
              </div>
              <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                XID age is {health.xidAge != null ? formatNumber(health.xidAge) : "?"} vs.{" "}
                <code style={{ background: "var(--surface-alt)", padding: "1px 4px", borderRadius: 3, fontFamily: "var(--font-mono)", fontSize: "0.85em" }}>autovacuum_freeze_max_age</code>{" "}
                of {health.autovacuumFreezeMaxAge != null ? formatNumber(health.autovacuumFreezeMaxAge) : "?"}.
                {(health.xidPercentUsed ?? 0) > 100
                  ? " Anti-wraparound autovacuum should have already triggered. If XID age continues to grow, autovacuum may be blocked by long-running transactions or is not keeping up — this can eventually force a PostgreSQL shutdown."
                  : (health.xidPercentUsed ?? 0) > 80
                    ? " Approaching the anti-wraparound autovacuum threshold. PostgreSQL will soon trigger aggressive autovacuum to freeze old tuples."
                    : " Nearing the autovacuum freeze threshold. Verify autovacuum is enabled and running."
                }
                {" "}Run <code style={{ background: "var(--surface-alt)", padding: "1px 4px", borderRadius: 3, fontFamily: "var(--font-mono)", fontSize: "0.85em" }}>VACUUM FREEZE</code> on large tables if autovacuum is not keeping up.
              </div>
            </div>
          )}

          {/* Per-Table XID Ages */}
          {tableXids.length > 0 && (
            <div className="glass-card-static" style={{ padding: "var(--space-lg)", marginBottom: "var(--space-lg)" }}>
              <div className="section-title" style={{ marginBottom: "var(--space-md)" }}>
                Per-Table XID Ages
                <span style={{ fontSize: "0.75rem", fontWeight: 400, color: "var(--text-secondary)", marginLeft: 8 }}>
                  freeze threshold: {formatNumber(xidFreezeMax)}
                </span>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table className="data-table" style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th>Table</th>
                      <th>XID Age</th>
                      <th>% of Threshold</th>
                      <th>Size</th>
                      <th>Last Vacuum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableXids.map((t) => {
                      const barColor = t.xidPercent > 80 ? "var(--signal-critical)" : t.xidPercent > 50 ? "var(--signal-warning)" : "var(--accent)";
                      return (
                        <tr key={`${t.schemaName}.${t.tableName}`}>
                          <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.82rem" }}>
                            {t.schemaName !== "public" ? `${t.schemaName}.` : ""}{t.tableName}
                          </td>
                          <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.82rem" }}>
                            {formatNumber(t.xidAge)}
                          </td>
                          <td style={{ minWidth: 160 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <div style={{
                                flex: 1, height: 8, borderRadius: 4,
                                background: "var(--surface-alt)", overflow: "hidden",
                              }}>
                                <div style={{
                                  width: `${Math.min(t.xidPercent, 100)}%`,
                                  height: "100%", borderRadius: 4,
                                  background: barColor,
                                  transition: "width 0.3s ease",
                                }} />
                              </div>
                              <span style={{
                                fontSize: "0.78rem", fontFamily: "var(--font-mono)",
                                color: barColor, fontWeight: t.xidPercent > 80 ? 600 : 400,
                                minWidth: 45, textAlign: "right",
                              }}>
                                {t.xidPercent.toFixed(1)}%
                              </span>
                            </div>
                          </td>
                          <td style={{ fontSize: "0.82rem" }}>{formatBytes(t.tableSize)}</td>
                          <td style={{ fontSize: "0.82rem", color: "var(--text-secondary)" }}>
                            {timeAgo(t.lastAutovacuum ?? t.lastVacuum)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Cache Hit Ratio Chart */}
          {healthHistory.length > 1 && (
            <div className="glass-card-static" style={{ padding: "var(--space-lg)", marginBottom: "var(--space-lg)" }}>
              <div className="section-title" style={{ marginBottom: "var(--space-md)" }}>Cache Hit Ratio (24h)</div>
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={healthHistory.map((h) => ({
                  time: new Date(h.capturedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                  cacheHit: h.cacheHitRatio,
                }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke={colors.border} />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: colors.textMuted }} interval="preserveStartEnd" />
                  <YAxis domain={[90, 100]} tick={{ fontSize: 10, fill: colors.textMuted }} width={40} tickFormatter={(v: number) => `${v}%`} />
                  <Tooltip
                    contentStyle={{ background: "var(--tooltip-bg)", border: "1px solid var(--tooltip-border)", borderRadius: 8, fontSize: "0.8rem" }}
                    formatter={(value: number) => [`${value?.toFixed(2)}%`, "Cache Hit"]}
                  />
                  <Area type="monotone" dataKey="cacheHit" stroke={colors.brand} fill={`${colors.brand}22`} strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
         TAB: VACUUM & Bloat
         ════════════════════════════════════════════════════════════ */}
      {activeTab === "vacuum" && (
        <div className="animate-fade-in">
          {/* Toolbar: Search + Filter Chips */}
          <div className="table-toolbar">
            <div className="table-search-wrap">
              <span className="table-search-icon">🔍</span>
              <input
                className="table-search"
                placeholder="Search tables..."
                value={bloatSearch}
                onChange={(e) => setBloatSearch(e.target.value)}
              />
            </div>
            <div className="filter-chips">
              {(["all", "critical", "warning", "healthy"] as BloatFilter[]).map((f) => {
                const count = f === "all" ? tables.length : tables.filter((t) => getVacuumUrgency(t) === f).length;
                return (
                  <button key={f} className="filter-chip" data-active={bloatFilter === f} onClick={() => setBloatFilter(f)}>
                    {f === "all" ? "All" : f === "critical" ? "🔴 Critical" : f === "warning" ? "🟡 Warning" : "🟢 Healthy"} ({count})
                  </button>
                );
              })}
            </div>
          </div>

          {/* Bloat Table */}
          {filteredBloatTables.length === 0 ? (
            <div className="glass-card-static" style={{ padding: "var(--space-xl)", textAlign: "center", color: "var(--text-muted)" }}>
              <div style={{ fontSize: "3rem", marginBottom: 8, opacity: 0.5 }}>🧹</div>
              {tables.length === 0
                ? "No vacuum stats collected yet. Data appears after the first 5-minute polling cycle."
                : "No tables match your filter."}
            </div>
          ) : (
            <div className="glass-card-static" style={{ overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <SortableHeader label="Table" sortKey="tableName" currentSort={bloatSort} onSort={toggleBloatSort} />
                    <SortableHeader label="Dead %" sortKey="deadTupRatio" currentSort={bloatSort} onSort={toggleBloatSort} style={{ width: 90 }} />
                    <SortableHeader label="Dead Tuples" sortKey="nDeadTup" currentSort={bloatSort} onSort={toggleBloatSort} style={{ width: 100 }} />
                    <th className="alert-table-th" style={{ width: 90 }}>Live Tuples</th>
                    <th className="alert-table-th" style={{ width: 80 }}>HOT %</th>
                    <SortableHeader label="Size" sortKey="totalSizeBytes" currentSort={bloatSort} onSort={toggleBloatSort} style={{ width: 80 }} />
                    <SortableHeader label="Last Vacuum" sortKey="lastVacuum" currentSort={bloatSort} onSort={toggleBloatSort} style={{ width: 100 }} />
                    <th className="alert-table-th" style={{ width: 60 }}>VACUUM #</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBloatTables.map((t) => {
                    const urgency = getVacuumUrgency(t);
                    const lastVac = t.lastAutovacuum ?? t.lastVacuum;
                    const isExpanded = expandedRows.has(t.id);
                    return (
                      <React.Fragment key={t.id}>
                        <tr className="expandable-row" onClick={() => toggleRow(t.id)}>
                          <td className="alert-table-td">
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span className="expand-icon" data-expanded={isExpanded}>▶</span>
                              <div
                                className="alert-severity-dot"
                                style={{
                                  background:
                                    urgency === "critical" ? "var(--signal-critical)"
                                      : urgency === "warning" ? "var(--signal-warning)"
                                        : "var(--signal-healthy)",
                                }}
                              />
                              <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.85rem" }}>
                                {t.tableName}
                              </span>
                            </div>
                          </td>
                          <td className="alert-table-td">
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <div style={{
                                flex: 1, height: 6, background: "var(--surface-alt)",
                                borderRadius: "var(--radius-full)", overflow: "hidden", maxWidth: 50,
                              }}>
                                <div style={{
                                  width: `${Math.min(t.deadTupRatio, 100)}%`, height: "100%",
                                  background:
                                    t.deadTupRatio > 30 ? "var(--signal-critical)"
                                      : t.deadTupRatio > 10 ? "var(--signal-warning)"
                                        : "var(--signal-healthy)",
                                  borderRadius: "var(--radius-full)",
                                  transition: "width 0.3s ease",
                                }} />
                              </div>
                              <span style={{
                                fontFamily: "var(--font-mono)", fontSize: "0.8rem",
                                color: t.deadTupRatio > 30 ? "var(--signal-critical)" : t.deadTupRatio > 10 ? "var(--signal-warning)" : "var(--text-muted)",
                                fontWeight: t.deadTupRatio > 10 ? 600 : 400,
                              }}>
                                {t.deadTupRatio.toFixed(1)}%
                              </span>
                            </div>
                          </td>
                          <td className="alert-table-td" style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: t.nDeadTup > 10000 ? "var(--signal-warning)" : "var(--text-secondary)" }}>
                            {formatNumber(t.nDeadTup)}
                          </td>
                          <td className="alert-table-td" style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--text-muted)" }}>
                            {formatNumber(t.nLiveTup)}
                          </td>
                          <td className="alert-table-td" style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}>
                            {t.hotUpdateRatio != null ? (
                              <span style={{ color: t.hotUpdateRatio >= 80 ? "var(--signal-healthy)" : t.hotUpdateRatio < 50 ? "var(--signal-warning)" : "var(--text-secondary)", fontWeight: 600 }}>
                                {t.hotUpdateRatio.toFixed(0)}%
                              </span>
                            ) : "—"}
                          </td>
                          <td className="alert-table-td" style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--text-muted)" }}>
                            {formatBytes(t.totalSizeBytes)}
                          </td>
                          <td className="alert-table-td" style={{ fontSize: "0.8rem" }}>
                            <span style={{
                              color: !lastVac ? "var(--signal-critical)" : "var(--text-secondary)",
                              fontWeight: !lastVac ? 600 : 400,
                            }}>
                              {timeAgo(lastVac)}
                            </span>
                          </td>
                          <td className="alert-table-td" style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--text-muted)" }}>
                            {(t.vacuumCount + t.autovacuumCount).toLocaleString()}
                          </td>
                        </tr>
                        {/* Expanded Detail Row */}
                        {isExpanded && (
                          <tr className="expanded-detail">
                            <td colSpan={8}>
                              <div className="expanded-detail-inner">
                                <div className="detail-item">
                                  <div className="detail-item-label">Schema</div>
                                  <div className="detail-item-value">{t.schemaName}</div>
                                </div>
                                <div className="detail-item">
                                  <div className="detail-item-label">Table Size</div>
                                  <div className="detail-item-value">{formatBytes(t.tableSizeBytes)}</div>
                                </div>
                                <div className="detail-item">
                                  <div className="detail-item-label">Total (+ indexes)</div>
                                  <div className="detail-item-value">{formatBytes(t.totalSizeBytes)}</div>
                                </div>
                                <div className="detail-item">
                                  <div className="detail-item-label">Cache Hit</div>
                                  <div className="detail-item-value" style={{
                                    color: (t.cacheHitRatio ?? 0) >= 99 ? "var(--signal-healthy)" : (t.cacheHitRatio ?? 0) >= 95 ? "var(--signal-warning)" : "var(--signal-critical)",
                                  }}>
                                    {t.cacheHitRatio != null ? `${t.cacheHitRatio.toFixed(1)}%` : "—"}
                                  </div>
                                </div>
                                <div className="detail-item">
                                  <div className="detail-item-label">Index Cache Hit</div>
                                  <div className="detail-item-value" style={{
                                    color: (t.idxCacheHitRatio ?? 0) >= 99 ? "var(--signal-healthy)" : (t.idxCacheHitRatio ?? 0) >= 95 ? "var(--signal-warning)" : "var(--signal-critical)",
                                  }}>
                                    {t.idxCacheHitRatio != null ? `${t.idxCacheHitRatio.toFixed(1)}%` : "—"}
                                  </div>
                                </div>
                                <div className="detail-item">
                                  <div className="detail-item-label">HOT Updates / Total Updates</div>
                                  <div className="detail-item-value">
                                    {formatNumber(t.nHotUpd ?? 0)} / {formatNumber(t.nUpd ?? 0)} ({t.hotUpdateRatio?.toFixed(1) ?? 100}%)
                                  </div>
                                </div>
                                <div className="detail-item">
                                  <div className="detail-item-label">Seq / Idx Scans</div>
                                  <div className="detail-item-value">
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                      <div className="scan-ratio-bar" style={{ width: 80 }}>
                                        {(t.seqScan + t.idxScan) > 0 && (
                                          <>
                                            <div className="scan-ratio-bar-idx" style={{ width: `${(t.idxScan / (t.seqScan + t.idxScan)) * 100}%` }} />
                                            <div className="scan-ratio-bar-seq" style={{ width: `${(t.seqScan / (t.seqScan + t.idxScan)) * 100}%` }} />
                                          </>
                                        )}
                                      </div>
                                      <span style={{ fontSize: "0.78rem" }}>{formatNumber(t.seqScan)} / {formatNumber(t.idxScan)}</span>
                                    </div>
                                  </div>
                                </div>
                                <div className="detail-item">
                                  <div className="detail-item-label">Last Manual Vacuum</div>
                                  <div className="detail-item-value">{timeAgo(t.lastVacuum)}</div>
                                </div>
                                <div className="detail-item">
                                  <div className="detail-item-label">Last Autovacuum</div>
                                  <div className="detail-item-value">{timeAgo(t.lastAutovacuum)}</div>
                                </div>
                                <div className="detail-item">
                                  <div className="detail-item-label">Last Analyze</div>
                                  <div className="detail-item-value">{timeAgo(t.lastAnalyze)}</div>
                                </div>
                                <div className="detail-item">
                                  <div className="detail-item-label">Last Autoanalyze</div>
                                  <div className="detail-item-value">{timeAgo(t.lastAutoanalyze)}</div>
                                </div>

                                {t.hotUpdateRatio != null && t.hotUpdateRatio < 60 && (t.nUpd ?? 0) > 1000 && (
                                  <div style={{
                                    gridColumn: "1 / -1",
                                    padding: "var(--space-sm) var(--space-md)",
                                    background: "var(--surface-alt)",
                                    borderLeft: "3px solid var(--signal-warning)",
                                    borderRadius: "var(--radius-sm)",
                                    fontSize: "0.8rem",
                                    marginTop: "var(--space-xs)",
                                  }}>
                                    💡 <strong>Low HOT update efficiency ({t.hotUpdateRatio.toFixed(1)}%):</strong> Table updates are modifying indexed columns or running out of free page space, requiring new index entries. Consider setting a fillfactor and tuning autovacuum:
                                    <div style={{ fontFamily: "var(--font-mono)", marginTop: 4, color: "var(--brand)" }}>
                                      ALTER TABLE &quot;{t.schemaName}&quot;.&quot;{t.tableName}&quot; SET (fillfactor = 85, autovacuum_vacuum_scale_factor = 0.05);
                                    </div>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* VACUUM Recommendations */}
          {actionTables.length > 0 && (
            <div style={{ marginTop: "var(--space-lg)" }}>
              <div className="section-title" style={{ marginBottom: "var(--space-sm)" }}>
                ⚠️ VACUUM Recommendations ({actionTables.length} table{actionTables.length !== 1 ? "s" : ""})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
                {actionTables.map((t) => {
                  const urgency = getVacuumUrgency(t);
                  const lastVac = t.lastAutovacuum ?? t.lastVacuum;
                  const daysSince = lastVac
                    ? Math.floor((Date.now() - new Date(lastVac).getTime()) / (1000 * 60 * 60 * 24))
                    : null;
                  const isCopied = copiedId === t.id;

                  return (
                    <div key={t.id} className="glass-card-static" style={{
                      padding: "var(--space-md) var(--space-lg)",
                      borderLeft: `3px solid ${urgency === "critical" ? "var(--signal-critical)" : "var(--signal-warning)"}`,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-md)", flexWrap: "wrap" }}>
                        <div style={{ flex: 1, minWidth: 200 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                            <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                              {t.tableName}
                            </span>
                            <span className="bloat-badge" style={{
                              background: urgency === "critical" ? "var(--signal-critical-dim)" : "var(--signal-warning-dim)",
                              color: urgency === "critical" ? "var(--signal-critical)" : "var(--signal-warning)",
                            }}>
                              {urgency}
                            </span>
                          </div>
                          <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                            {t.deadTupRatio.toFixed(1)}% dead tuples ({formatNumber(t.nDeadTup)} dead / {formatNumber(t.nLiveTup)} live)
                            {daysSince !== null && ` — last vacuumed ${daysSince} days ago`}
                            {daysSince === null && " — never vacuumed"}
                          </div>
                        </div>
                        <button
                          className="copy-btn"
                          data-copied={isCopied}
                          onClick={() => copyCommand(t.tableName, t.id)}
                        >
                          {isCopied ? "✓ Copied" : "📋"} VACUUM ANALYZE &quot;{t.tableName}&quot;;
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
         TAB: Storage
         ════════════════════════════════════════════════════════════ */}
      {activeTab === "storage" && (
        <div className="animate-fade-in">
          {/* Per-Table Cache Hit Ratio */}
          {cacheHitTables.length > 0 && (
            <div style={{ marginBottom: "var(--space-xl)" }}>
              <div className="section-title" style={{ marginBottom: "var(--space-md)" }}>Per-Table Cache Hit Ratio</div>
              <div className="table-toolbar">
                <div className="table-search-wrap">
                  <span className="table-search-icon">🔍</span>
                  <input
                    className="table-search"
                    placeholder="Search tables..."
                    value={cacheSearch}
                    onChange={(e) => setCacheSearch(e.target.value)}
                  />
                </div>
              </div>
              <div className="glass-card-static" style={{ overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <SortableHeader label="Table" sortKey="tableName" currentSort={cacheSort} onSort={toggleCacheSort} />
                      <SortableHeader label="Cache Hit %" sortKey="cacheHitRatio" currentSort={cacheSort} onSort={toggleCacheSort} style={{ width: 100 }} />
                      <SortableHeader label="Index Cache %" sortKey="idxCacheHitRatio" currentSort={cacheSort} onSort={toggleCacheSort} style={{ width: 120 }} />
                      <SortableHeader label="Size" sortKey="totalSizeBytes" currentSort={cacheSort} onSort={toggleCacheSort} style={{ width: 80 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCacheTables.map((t) => {
                      const hitColor = (t.cacheHitRatio ?? 0) >= 99 ? "var(--signal-healthy)"
                        : (t.cacheHitRatio ?? 0) >= 95 ? "var(--signal-warning)"
                          : "var(--signal-critical)";
                      const idxColor = (t.idxCacheHitRatio ?? 0) >= 99 ? "var(--signal-healthy)"
                        : (t.idxCacheHitRatio ?? 0) >= 95 ? "var(--signal-warning)"
                          : "var(--signal-critical)";
                      return (
                        <tr key={t.tableName} className="alert-table-row">
                          <td className="alert-table-td" style={{ fontFamily: "var(--font-mono)", fontSize: "0.85rem" }}>
                            {t.tableName}
                          </td>
                          <td className="alert-table-td" style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: t.cacheHitRatio != null ? hitColor : "var(--text-muted)" }}>
                            {t.cacheHitRatio != null ? `${t.cacheHitRatio.toFixed(1)}%` : "—"}
                          </td>
                          <td className="alert-table-td" style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: t.idxCacheHitRatio != null ? idxColor : "var(--text-muted)" }}>
                            {t.idxCacheHitRatio != null ? `${t.idxCacheHitRatio.toFixed(1)}%` : "—"}
                          </td>
                          <td className="alert-table-td" style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--text-muted)" }}>
                            {formatBytes(t.totalSizeBytes)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Disk Growth Forecast */}
          {diskGrowthTables.length > 0 && (
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-md)" }}>
                <div className="section-title" style={{ marginBottom: 0 }}>Disk Growth Forecast</div>
                {diskGrowthTables.some((t) => (t.projectedDaysToDiskLimit ?? Infinity) <= 30) && (
                  <span style={{ color: "var(--signal-critical)", fontWeight: 600, fontSize: "0.8rem" }}>
                    🔴 Table(s) projected to hit disk limit within 30 days
                  </span>
                )}
              </div>
              <div className="table-toolbar">
                <div className="table-search-wrap">
                  <span className="table-search-icon">🔍</span>
                  <input
                    className="table-search"
                    placeholder="Search tables..."
                    value={diskSearch}
                    onChange={(e) => setDiskSearch(e.target.value)}
                  />
                </div>
              </div>
              <div className="glass-card-static" style={{ overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <SortableHeader label="Table" sortKey="tableName" currentSort={diskSort} onSort={toggleDiskSort} />
                      <SortableHeader label="Current Size" sortKey="totalSizeBytes" currentSort={diskSort} onSort={toggleDiskSort} style={{ width: 100 }} />
                      <th className="alert-table-th" style={{ width: 120 }}>Trend</th>
                      <SortableHeader label="Growth / Day" sortKey="growthRateBytesPerDay" currentSort={diskSort} onSort={toggleDiskSort} style={{ width: 110 }} />
                      <SortableHeader label="Days to Limit" sortKey="projectedDaysToDiskLimit" currentSort={diskSort} onSort={toggleDiskSort} style={{ width: 110 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDiskTables.map((t) => {
                      const daysColor = (t.projectedDaysToDiskLimit ?? Infinity) <= 30 ? "var(--signal-critical)"
                        : (t.projectedDaysToDiskLimit ?? Infinity) <= 180 ? "var(--signal-warning)"
                          : "var(--signal-healthy)";
                      const tableHistory = sparklineData.get(t.tableName);
                      return (
                        <tr key={t.tableName} className="alert-table-row">
                          <td className="alert-table-td" style={{ fontFamily: "var(--font-mono)", fontSize: "0.85rem" }}>
                            {t.tableName}
                          </td>
                          <td className="alert-table-td" style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                            {formatBytes(t.totalSizeBytes)}
                          </td>
                          <td className="alert-table-td" style={{ padding: "4px 8px" }}>
                            {tableHistory && tableHistory.length > 1 ? (
                              <ResponsiveContainer width={100} height={28}>
                                <LineChart data={tableHistory}>
                                  <Line
                                    type="monotone"
                                    dataKey="size"
                                    stroke={(t.growthRateBytesPerDay ?? 0) > 0 ? colors.brand : "var(--signal-healthy)"}
                                    strokeWidth={1.5}
                                    dot={false}
                                  />
                                </LineChart>
                              </ResponsiveContainer>
                            ) : (
                              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>—</span>
                            )}
                          </td>
                          <td className="alert-table-td" style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                            {t.growthRateBytesPerDay != null ? `${formatBytes(Math.abs(t.growthRateBytesPerDay))}/d` : "—"}
                          </td>
                          <td className="alert-table-td" style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", fontWeight: 600, color: t.projectedDaysToDiskLimit != null ? daysColor : "var(--text-muted)" }}>
                            {t.projectedDaysToDiskLimit != null ? `${t.projectedDaysToDiskLimit.toLocaleString()}d` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
         TAB: Replication
         ════════════════════════════════════════════════════════════ */}
      {activeTab === "replication" && (
        <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: "var(--space-xl)" }}>
          {/* Section 1: Streaming Replicas */}
          <div>
            <h3 style={{ fontSize: "1.05rem", fontWeight: 600, marginBottom: "var(--space-md)", color: "var(--text-primary)" }}>
              📡 Streaming Replicas
            </h3>
            {replicas.length === 0 ? (
              <div className="glass-card-static" style={{ padding: "var(--space-lg)", textAlign: "center", color: "var(--text-muted)" }}>
                <div style={{ fontSize: "2rem", marginBottom: 6, opacity: 0.6 }}>🔄</div>
                No streaming replicas connected to this database.
              </div>
            ) : (
              <>
                {replicas.some((r) => (r.timeLagSeconds ?? 0) > 30) && (
                  <div style={{
                    padding: "var(--space-md) var(--space-lg)",
                    marginBottom: "var(--space-md)",
                    borderRadius: "var(--radius-md)",
                    background: "var(--signal-critical-dim)",
                    borderLeft: "3px solid var(--signal-critical)",
                  }}>
                    <div style={{ fontWeight: 600, marginBottom: 4, color: "var(--signal-critical)" }}>
                      ⚠️ High Replication Lag Detected
                    </div>
                    <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                      One or more replicas have significant replication lag. Reads from these replicas may return stale data.
                    </div>
                  </div>
                )}
                <div className="glass-card-static" style={{ overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <th className="alert-table-th">Replica</th>
                        <th className="alert-table-th" style={{ width: 90 }}>State</th>
                        <th className="alert-table-th" style={{ width: 110 }}>Byte Lag</th>
                        <th className="alert-table-th" style={{ width: 110 }}>Time Lag</th>
                        <th className="alert-table-th" style={{ width: 130 }}>Client</th>
                      </tr>
                    </thead>
                    <tbody>
                      {replicas.map((r) => {
                        const stateColor = r.replicationState === "streaming" ? "var(--signal-healthy)" : "var(--signal-critical)";
                        const lagColor = (r.timeLagSeconds ?? 0) > 30 ? "var(--signal-critical)"
                          : (r.timeLagSeconds ?? 0) > 5 ? "var(--signal-warning)"
                          : "var(--signal-healthy)";
                        const byteLagStr = formatBytes(r.byteLag);
                        return (
                          <tr key={r.id} className="alert-table-row">
                            <td className="alert-table-td" style={{ fontFamily: "var(--font-mono)", fontSize: "0.85rem" }}>
                              {r.replicaName}
                            </td>
                            <td className="alert-table-td">
                              <span style={{
                                display: "inline-flex", alignItems: "center", gap: 4,
                                fontSize: "0.75rem", fontWeight: 600, color: stateColor,
                                padding: "2px 8px", borderRadius: "var(--radius-full)",
                                background: r.replicationState === "streaming" ? "var(--signal-healthy-dim)" : "var(--signal-critical-dim)",
                              }}>
                                <span style={{ width: 6, height: 6, borderRadius: "50%", background: stateColor }} />
                                {r.replicationState}
                              </span>
                            </td>
                            <td className="alert-table-td" style={{
                              fontFamily: "var(--font-mono)", fontSize: "0.8rem", fontWeight: 600,
                              color: lagColor,
                            }}>
                              {byteLagStr}
                            </td>
                            <td className="alert-table-td" style={{
                              fontFamily: "var(--font-mono)", fontSize: "0.8rem", fontWeight: 600,
                              color: lagColor,
                            }}>
                              {r.timeLagSeconds != null ? (
                                r.timeLagSeconds < 1 ? `${(r.timeLagSeconds * 1000).toFixed(0)}ms`
                                  : r.timeLagSeconds < 60 ? `${r.timeLagSeconds.toFixed(1)}s`
                                  : `${(r.timeLagSeconds / 60).toFixed(1)}m`
                              ) : "—"}
                            </td>
                            <td className="alert-table-td" style={{
                              fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--text-muted)",
                            }}>
                              {r.clientAddr ?? "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          {/* Section 2: Replication Slots & WAL Retention Risk */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-md)" }}>
              <h3 style={{ fontSize: "1.05rem", fontWeight: 600, color: "var(--text-primary)" }}>
                🛡️ Replication Slots & WAL Retention Sentinel
              </h3>
              <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                Guards against unmanaged WAL file accumulation on primary
              </span>
            </div>

            {slots.length === 0 ? (
              <div className="glass-card-static" style={{ padding: "var(--space-lg)", textAlign: "center", color: "var(--text-muted)" }}>
                No replication slots found on this instance.
              </div>
            ) : (
              <>
                {slots.some((s) => s.retainedBytes > 250 * 1024 * 1024 || !s.active) && (
                  <div style={{
                    padding: "var(--space-md) var(--space-lg)",
                    marginBottom: "var(--space-md)",
                    borderRadius: "var(--radius-md)",
                    background: "var(--signal-warning-dim)",
                    borderLeft: "3px solid var(--signal-warning)",
                  }}>
                    <div style={{ fontWeight: 600, marginBottom: 4, color: "var(--signal-warning)" }}>
                      ⚠️ Inactive / WAL-Retaining Slot Detected
                    </div>
                    <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                      Inactive replication slots hold WAL files on the primary database, preventing checkpoint cleanup.
                      If the consumer is dead or orphaned, drop the slot to reclaim disk space.
                    </div>
                  </div>
                )}
                <div className="glass-card-static" style={{ overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <th className="alert-table-th">Slot Name</th>
                        <th className="alert-table-th" style={{ width: 100 }}>Type</th>
                        <th className="alert-table-th" style={{ width: 90 }}>Status</th>
                        <th className="alert-table-th" style={{ width: 110 }}>WAL Status</th>
                        <th className="alert-table-th" style={{ width: 130 }}>Retained WAL</th>
                        <th className="alert-table-th" style={{ width: 150 }}>Restart LSN</th>
                        <th className="alert-table-th" style={{ width: 140, textAlign: "right" }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {slots.map((s) => {
                        const isBloated = s.retainedBytes > 1000 * 1024 * 1024;
                        const isWarning = s.retainedBytes > 250 * 1024 * 1024;
                        const walColor = isBloated ? "var(--signal-critical)" : isWarning ? "var(--signal-warning)" : "var(--signal-healthy)";
                        const dropCmd = `SELECT pg_drop_replication_slot('${s.slotName}');`;
                        const isCopied = copiedSlotDrop === s.slotName;

                        return (
                          <tr key={s.id} className="alert-table-row">
                            <td className="alert-table-td" style={{ fontFamily: "var(--font-mono)", fontSize: "0.85rem", fontWeight: 600 }}>
                              {s.slotName}
                            </td>
                            <td className="alert-table-td" style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                              {s.slotType} {s.plugin ? `(${s.plugin})` : ""}
                            </td>
                            <td className="alert-table-td">
                              <span style={{
                                display: "inline-flex", alignItems: "center", gap: 4,
                                fontSize: "0.75rem", fontWeight: 600,
                                color: s.active ? "var(--signal-healthy)" : "var(--signal-critical)",
                                padding: "2px 8px", borderRadius: "var(--radius-full)",
                                background: s.active ? "var(--signal-healthy-dim)" : "var(--signal-critical-dim)",
                              }}>
                                <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.active ? "var(--signal-healthy)" : "var(--signal-critical)" }} />
                                {s.active ? "Active" : "Inactive"}
                              </span>
                            </td>
                            <td className="alert-table-td" style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                              {s.walStatus ?? "normal"}
                            </td>
                            <td className="alert-table-td" style={{
                              fontFamily: "var(--font-mono)", fontSize: "0.85rem", fontWeight: 700,
                              color: walColor,
                            }}>
                              {formatBytes(s.retainedBytes)}
                            </td>
                            <td className="alert-table-td" style={{
                              fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--text-muted)",
                            }}>
                              {s.restartLsn ?? "—"}
                            </td>
                            <td className="alert-table-td" style={{ textAlign: "right" }}>
                              <button
                                className="copy-btn"
                                data-copied={isCopied}
                                onClick={() => {
                                  navigator.clipboard.writeText(dropCmd);
                                  setCopiedSlotDrop(s.slotName);
                                  setTimeout(() => setCopiedSlotDrop(null), 2000);
                                }}
                                title={dropCmd}
                                style={{ fontSize: "0.75rem" }}
                              >
                                {isCopied ? "✓ Copied" : "📋 Drop Slot"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-Components ──────────────────────────────────────────────────

function HealthGauge({ icon, label, value, color, hint, href, actionLabel }: {
  icon: string;
  label: string;
  value: string;
  color: string;
  hint: string;
  href?: string;
  actionLabel?: string;
}) {
  const card = (
    <div
      className="glass-card-static"
      style={{
        padding: "var(--space-lg)",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        cursor: href ? "pointer" : "default",
        transition: "border-color var(--transition-fast)",
      }}
    >
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: "var(--space-sm)" }}>
          <span style={{ fontSize: "1rem" }}>{icon}</span>
          <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-secondary)" }}>{label}</span>
        </div>
        <div style={{ fontSize: "1.6rem", fontWeight: 700, color, fontFamily: "var(--font-mono)", lineHeight: 1.1 }}>
          {value}
        </div>
        <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: 4 }}>{hint}</div>
      </div>
      {href && (
        <div style={{ fontSize: "0.75rem", color: "var(--brand)", fontWeight: 600, marginTop: "var(--space-sm)" }}>
          {actionLabel || "View details →"}
        </div>
      )}
    </div>
  );

  if (href) {
    return (
      <Link href={href} style={{ textDecoration: "none", color: "inherit", display: "block" }}>
        {card}
      </Link>
    );
  }

  return card;
}

function HealthScoreBanner({ score: { score, grade, color, items } }: {
  score: { score: number; grade: string; color: string; items: Array<{ label: string; value: string; color: string }> };
}) {
  const circumference = 2 * Math.PI * 34;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="health-score-banner">
      <div className="health-score-ring">
        <svg width="80" height="80" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r="34" fill="none" stroke="var(--surface-alt)" strokeWidth="6" />
          <circle
            cx="40" cy="40" r="34" fill="none"
            stroke={color} strokeWidth="6"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 0.6s ease" }}
          />
        </svg>
        <div className="health-score-ring-value">
          <span className="health-score-ring-number" style={{ color }}>{score}</span>
          <span className="health-score-ring-label">/100</span>
        </div>
      </div>
      <div className="health-score-details">
        <div className="health-score-title">
          Database Health: <span style={{ color }}>{grade}</span>
        </div>
        <div className="health-score-chips">
          {items.map((item) => (
            <span key={item.label} className="health-score-chip" style={{ color: item.color }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: item.color, flexShrink: 0 }} />
              {item.label}: {item.value}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function SortableHeader<K extends string>({ label, sortKey, currentSort, onSort, style }: {
  label: string;
  sortKey: K;
  currentSort: SortState<K>;
  onSort: (key: K) => void;
  style?: React.CSSProperties;
}) {
  const isActive = currentSort.key === sortKey;
  return (
    <th
      className="alert-table-th sortable-th"
      style={style}
      onClick={() => onSort(sortKey)}
    >
      {label}
      <span className="sort-arrow" data-active={isActive}>
        {isActive ? (currentSort.dir === "asc" ? "▲" : "▼") : "▲"}
      </span>
    </th>
  );
}
