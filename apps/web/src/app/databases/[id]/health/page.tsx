"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  getDatabase,
  getVacuumStats,
  getDbHealth,
  getTableCacheHit,
  getDiskGrowth,
  getReplicationStats,
} from "../../../lib/api";
import type {
  Database,
  TableBloatStat,
  DbHealthSnapshot,
  TableCacheHit,
  TableSizeEntry,
  ReplicationSnapshot,
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
   Database Health & VACUUM Advisor — Phase 6
   =================================================================== */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
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

export default function HealthPage() {
  const params = useParams();
  const id = params.id as string;
  const colors = useChartColors();

  const [database, setDatabase] = useState<Database | null>(null);
  const [tables, setTables] = useState<TableBloatStat[]>([]);
  const [health, setHealth] = useState<DbHealthSnapshot | null>(null);
  const [healthHistory, setHealthHistory] = useState<DbHealthSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [cacheHitTables, setCacheHitTables] = useState<TableCacheHit[]>([]);
  const [diskGrowthTables, setDiskGrowthTables] = useState<TableSizeEntry[]>([]);
  const [replicas, setReplicas] = useState<ReplicationSnapshot[]>([]);

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
      // Fetch cache hit and disk growth data
      try {
        const [cacheData, growthData, replData] = await Promise.all([
          getTableCacheHit(id),
          getDiskGrowth(id),
          getReplicationStats(id),
        ]);
        setCacheHitTables(cacheData.tables);
        setDiskGrowthTables(growthData.tables);
        setReplicas(replData.replicas);
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

  if (loading) {
    return (
      <div className="animate-fade-in">
        <div className="skeleton" style={{ width: 300, height: 32, marginBottom: 16 }} />
        <div className="skeleton" style={{ height: 400, borderRadius: "var(--radius-lg)" }} />
      </div>
    );
  }

  const critTables = tables.filter((t) => getVacuumUrgency(t) === "critical");
  const warnTables = tables.filter((t) => getVacuumUrgency(t) === "warning");

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

      {/* ---- Health Gauges ---- */}
      {health && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "var(--space-md)", marginBottom: "var(--space-lg)" }}>
          <HealthGauge
            icon="💾"
            label="Cache Hit"
            value={`${health.cacheHitRatio?.toFixed(1) ?? "—"}%`}
            color={
              (health.cacheHitRatio ?? 0) >= 99 ? "var(--signal-healthy)"
                : (health.cacheHitRatio ?? 0) >= 95 ? "var(--signal-warning)"
                  : "var(--signal-critical)"
            }
            hint={
              (health.cacheHitRatio ?? 0) >= 99 ? "Excellent"
                : (health.cacheHitRatio ?? 0) >= 95 ? "Acceptable"
                  : "Low — consider more shared_buffers"
            }
          />
          <HealthGauge
            icon="📦"
            label="DB Size"
            value={health.dbSizeBytes != null ? formatBytes(health.dbSizeBytes) : "—"}
            color="var(--brand)"
            hint={`${health.numBackends ?? 0} active backends`}
          />
          <HealthGauge
            icon="✅"
            label="Commits"
            value={health.xactCommit != null ? formatNumber(health.xactCommit) : "—"}
            color="var(--signal-healthy)"
            hint={`${health.xactRollback ?? 0} rollbacks`}
          />
          <HealthGauge
            icon="🔒"
            label="Deadlocks"
            value={String(health.deadlocksCount ?? 0)}
            color={(health.deadlocksCount ?? 0) > 0 ? "var(--signal-critical)" : "var(--signal-healthy)"}
            hint={(health.deadlocksCount ?? 0) > 0 ? "Active deadlocks detected" : "No deadlocks"}
          />
          <HealthGauge
            icon="📝"
            label="Temp Files"
            value={health.tempFileBytes != null ? formatBytes(health.tempFileBytes) : "—"}
            color={(health.tempFileBytes ?? 0) > 100 * 1024 * 1024 ? "var(--signal-warning)" : "var(--text-muted)"}
            hint="Disk spills from sorts/hashes"
          />
          <HealthGauge
            icon="⚡"
            label="Checkpoints"
            value={`${health.checkpointsTimed ?? 0} / ${health.checkpointsRequested ?? 0}`}
            color={(health.checkpointsRequested ?? 0) > (health.checkpointsTimed ?? 0) ? "var(--signal-warning)" : "var(--signal-healthy)"}
            hint="Timed / Requested"
          />
          <HealthGauge
            icon="☢️"
            label="XID Wraparound"
            value={health.xidPercentUsed != null ? `${health.xidPercentUsed.toFixed(1)}%` : "—"}
            color={
              (health.xidPercentUsed ?? 0) > 80 ? "var(--signal-critical)"
                : (health.xidPercentUsed ?? 0) > 50 ? "var(--signal-warning)"
                  : "var(--signal-healthy)"
            }
            hint={
              (health.xidPercentUsed ?? 0) > 80 ? "Critical — force VACUUM FREEZE"
                : health.xidAge != null && health.autovacuumFreezeMaxAge != null
                  ? `${formatNumber(health.xidAge)} / ${formatNumber(health.autovacuumFreezeMaxAge)}`
                  : "No data"
            }
          />
        </div>
      )}

      {/* ---- XID Wraparound Warning Banner ---- */}
      {health && (health.xidPercentUsed ?? 0) > 50 && (
        <div style={{
          padding: "var(--space-md) var(--space-lg)",
          marginBottom: "var(--space-lg)",
          borderRadius: "var(--radius-md)",
          background: (health.xidPercentUsed ?? 0) > 80 ? "var(--signal-critical-dim)" : "var(--signal-warning-dim)",
          borderLeft: `3px solid ${(health.xidPercentUsed ?? 0) > 80 ? "var(--signal-critical)" : "var(--signal-warning)"}`,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4, color: (health.xidPercentUsed ?? 0) > 80 ? "var(--signal-critical)" : "var(--signal-warning)" }}>
            ☢️ Transaction ID Wraparound Risk: {health.xidPercentUsed?.toFixed(1)}%
          </div>
          <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
            Your database has consumed {health.xidAge != null ? formatNumber(health.xidAge) : "?"} of {health.autovacuumFreezeMaxAge != null ? formatNumber(health.autovacuumFreezeMaxAge) : "?"} available
            transaction IDs. {(health.xidPercentUsed ?? 0) > 80
              ? "At this level, PostgreSQL may force a shutdown to prevent data corruption."
              : "Approaching dangerous levels."}
            {" "}Run <code style={{ background: "var(--surface-alt)", padding: "1px 4px", borderRadius: 3, fontFamily: "var(--font-mono)", fontSize: "0.85em" }}>VACUUM FREEZE</code> on large tables to reduce XID age.
          </div>
        </div>
      )}

      {/* ---- Cache Hit Ratio Chart ---- */}
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

      {/* ---- VACUUM / Bloat Section ---- */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-md)" }}>
        <div className="section-title" style={{ marginBottom: 0 }}>Table Bloat & VACUUM Status</div>
        {(critTables.length > 0 || warnTables.length > 0) && (
          <div style={{ display: "flex", gap: 8, fontSize: "0.8rem" }}>
            {critTables.length > 0 && (
              <span style={{ color: "var(--signal-critical)", fontWeight: 600 }}>
                🔴 {critTables.length} critical
              </span>
            )}
            {warnTables.length > 0 && (
              <span style={{ color: "var(--signal-warning)", fontWeight: 600 }}>
                🟡 {warnTables.length} warning
              </span>
            )}
          </div>
        )}
      </div>

      {tables.length === 0 ? (
        <div className="glass-card-static" style={{ padding: "var(--space-xl)", textAlign: "center", color: "var(--text-muted)" }}>
          <div style={{ fontSize: "3rem", marginBottom: 8, opacity: 0.5 }}>🧹</div>
          No vacuum stats collected yet. Data appears after the first 5-minute polling cycle.
        </div>
      ) : (
        <div className="glass-card-static" style={{ overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th className="alert-table-th">Table</th>
                <th className="alert-table-th" style={{ width: 90 }}>Dead %</th>
                <th className="alert-table-th" style={{ width: 90 }}>Dead Tuples</th>
                <th className="alert-table-th" style={{ width: 90 }}>Live Tuples</th>
                <th className="alert-table-th" style={{ width: 80 }}>Size</th>
                <th className="alert-table-th" style={{ width: 100 }}>Last Vacuum</th>
                <th className="alert-table-th" style={{ width: 90 }}>VACUUM #</th>
              </tr>
            </thead>
            <tbody>
              {tables.map((t) => {
                const urgency = getVacuumUrgency(t);
                const lastVac = t.lastAutovacuum ?? t.lastVacuum;
                return (
                  <tr key={t.id} className="alert-table-row">
                    <td className="alert-table-td">
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
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
                          color:
                            t.deadTupRatio > 30 ? "var(--signal-critical)"
                              : t.deadTupRatio > 10 ? "var(--signal-warning)"
                                : "var(--text-muted)",
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
                      {t.vacuumCount + t.autovacuumCount}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* VACUUM advice for critical tables */}
      {critTables.length > 0 && (
        <div style={{ marginTop: "var(--space-lg)" }}>
          <div className="section-title" style={{ marginBottom: "var(--space-sm)" }}>
            ⚠️ VACUUM Recommendations
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            {critTables.map((t) => {
              const lastVac = t.lastAutovacuum ?? t.lastVacuum;
              const daysSince = lastVac
                ? Math.floor((Date.now() - new Date(lastVac).getTime()) / (1000 * 60 * 60 * 24))
                : null;

              return (
                <div key={t.id} className="glass-card-static" style={{
                  padding: "var(--space-md) var(--space-lg)",
                  borderLeft: "3px solid var(--signal-critical)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-md)" }}>
                    <div>
                      <div style={{ fontFamily: "var(--font-mono)", fontWeight: 600, marginBottom: 4 }}>
                        {t.tableName}
                      </div>
                      <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                        {t.deadTupRatio.toFixed(1)}% dead tuples ({formatNumber(t.nDeadTup)} dead / {formatNumber(t.nLiveTup)} live)
                        {daysSince !== null && ` — last vacuumed ${daysSince} days ago`}
                        {daysSince === null && " — never vacuumed"}
                      </div>
                    </div>
                    <div style={{
                      fontFamily: "var(--font-mono)", fontSize: "0.8rem",
                      background: "var(--surface-alt)", padding: "var(--space-sm) var(--space-md)",
                      borderRadius: "var(--radius-md)", whiteSpace: "nowrap",
                      color: "var(--text-secondary)",
                    }}>
                      VACUUM ANALYZE &quot;{t.tableName}&quot;;
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ---- Per-Table Cache Hit Ratio ---- */}
      {cacheHitTables.length > 0 && (
        <div style={{ marginTop: "var(--space-lg)" }}>
          <div className="section-title" style={{ marginBottom: "var(--space-md)" }}>Per-Table Cache Hit Ratio</div>
          <div className="glass-card-static" style={{ overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th className="alert-table-th">Table</th>
                  <th className="alert-table-th" style={{ width: 100 }}>Cache Hit %</th>
                  <th className="alert-table-th" style={{ width: 120 }}>Index Cache %</th>
                  <th className="alert-table-th" style={{ width: 80 }}>Size</th>
                </tr>
              </thead>
              <tbody>
                {cacheHitTables.map((t) => {
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

      {/* ---- Disk Growth Forecast ---- */}
      {diskGrowthTables.length > 0 && (
        <div style={{ marginTop: "var(--space-lg)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-md)" }}>
            <div className="section-title" style={{ marginBottom: 0 }}>Disk Growth Forecast</div>
            {diskGrowthTables.some((t) => (t.projectedDaysToDiskLimit ?? Infinity) <= 30) && (
              <span style={{ color: "var(--signal-critical)", fontWeight: 600, fontSize: "0.8rem" }}>
                🔴 Table(s) projected to hit disk limit within 30 days
              </span>
            )}
          </div>
          <div className="glass-card-static" style={{ overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th className="alert-table-th">Table</th>
                  <th className="alert-table-th" style={{ width: 100 }}>Current Size</th>
                  <th className="alert-table-th" style={{ width: 110 }}>Growth / Day</th>
                  <th className="alert-table-th" style={{ width: 130 }}>Days to Limit</th>
                </tr>
              </thead>
              <tbody>
                {diskGrowthTables.map((t) => {
                  const daysColor = (t.projectedDaysToDiskLimit ?? Infinity) <= 30 ? "var(--signal-critical)"
                    : (t.projectedDaysToDiskLimit ?? Infinity) <= 180 ? "var(--signal-warning)"
                      : "var(--signal-healthy)";
                  return (
                    <tr key={t.tableName} className="alert-table-row">
                      <td className="alert-table-td" style={{ fontFamily: "var(--font-mono)", fontSize: "0.85rem" }}>
                        {t.tableName}
                      </td>
                      <td className="alert-table-td" style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                        {formatBytes(t.totalSizeBytes)}
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

      {/* ---- Replication Lag Monitor ---- */}
      {replicas.length > 0 && (
        <div style={{ marginTop: "var(--space-lg)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-md)" }}>
            <div className="section-title" style={{ marginBottom: 0 }}>Replication Lag</div>
            {replicas.some((r) => r.replicationState !== "streaming") && (
              <span style={{ color: "var(--signal-critical)", fontWeight: 600, fontSize: "0.8rem" }}>
                🔴 Replica(s) not in streaming state
              </span>
            )}
          </div>
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
                Possible causes: network latency, heavy read load on replica, or a long-running query blocking WAL replay.
              </div>
            </div>
          )}
          <div className="glass-card-static" style={{ overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th className="alert-table-th">Replica</th>
                  <th className="alert-table-th" style={{ width: 80 }}>State</th>
                  <th className="alert-table-th" style={{ width: 100 }}>Byte Lag</th>
                  <th className="alert-table-th" style={{ width: 100 }}>Time Lag</th>
                  <th className="alert-table-th" style={{ width: 120 }}>Client</th>
                </tr>
              </thead>
              <tbody>
                {replicas.map((r) => {
                  const stateColor = r.replicationState === "streaming" ? "var(--signal-healthy)" : "var(--signal-critical)";
                  const lagColor = (r.timeLagSeconds ?? 0) > 30 ? "var(--signal-critical)"
                    : (r.timeLagSeconds ?? 0) > 5 ? "var(--signal-warning)"
                    : "var(--signal-healthy)";
                  const byteLagStr = r.byteLag >= 1073741824 ? `${(r.byteLag / 1073741824).toFixed(1)} GB`
                    : r.byteLag >= 1048576 ? `${(r.byteLag / 1048576).toFixed(1)} MB`
                    : r.byteLag >= 1024 ? `${(r.byteLag / 1024).toFixed(1)} KB`
                    : `${r.byteLag} B`;
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
        </div>
      )}
    </div>
  );
}

/* ----- Health Gauge Component ----- */

function HealthGauge({ icon, label, value, color, hint }: {
  icon: string; label: string; value: string; color: string; hint: string;
}) {
  return (
    <div className="glass-card-static" style={{ padding: "var(--space-lg)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: "var(--space-sm)" }}>
        <span style={{ fontSize: "1rem" }}>{icon}</span>
        <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-secondary)" }}>{label}</span>
      </div>
      <div style={{ fontSize: "1.6rem", fontWeight: 700, color, fontFamily: "var(--font-mono)", lineHeight: 1.1 }}>
        {value}
      </div>
      <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: 4 }}>{hint}</div>
    </div>
  );
}
