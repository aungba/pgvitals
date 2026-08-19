"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getDatabase, getLogInsights, getErrorStats } from "../../../lib/api";
import type { Database, LogInsight, DbErrorStatEntry } from "../../../lib/api";

/* ===================================================================
   Log Insights Page — Phase 10
   =================================================================== */

type LogSortKey = "severity" | "errorType" | "errorMessage" | "errorCount" | "capturedAt";

const SEVERITY_STYLES: Record<string, { bg: string; color: string; emoji: string }> = {
  critical: { bg: "var(--signal-critical-dim)", color: "var(--signal-critical)", emoji: "🔴" },
  error: { bg: "var(--signal-critical-dim)", color: "var(--signal-critical)", emoji: "🔴" },
  warning: { bg: "var(--signal-warning-dim)", color: "var(--signal-warning)", emoji: "🟡" },
  info: { bg: "var(--brand-dim)", color: "var(--brand)", emoji: "🔵" },
};

const ERROR_TYPE_LABELS: Record<string, string> = {
  deadlock: "Deadlock",
  serialization_failure: "Serialization Failure",
  query_canceled: "Query Canceled",
  lock_timeout: "Lock Timeout",
  idle_in_transaction_timeout: "Idle in Txn Timeout",
  connection_error: "Connection Error",
  out_of_memory: "Out of Memory",
  checkpoint_warning: "Checkpoint Warning",
  replication_error: "Replication Error",
  auth_failure: "Auth Failure",
};

export default function LogsPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params.id as string;

  const [database, setDatabase] = useState<Database | null>(null);
  const [insights, setInsights] = useState<LogInsight[]>([]);
  const [errorStats, setErrorStats] = useState<DbErrorStatEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [hours] = useState(24);
  const [filter, setFilter] = useState<string>(searchParams.get("filter") || "all");

  const [logSortKey, setLogSortKey] = useState<LogSortKey>("capturedAt");
  const [logSortDir, setLogSortDir] = useState<"asc" | "desc">("desc");
  const [selectedInsight, setSelectedInsight] = useState<LogInsight | null>(null);

  useEffect(() => {
    const f = searchParams.get("filter");
    if (f) setFilter(f);
  }, [searchParams]);

  const fetchData = useCallback(async () => {
    try {
      const [db, insData, statsData] = await Promise.all([
        getDatabase(id),
        getLogInsights(id, hours, filter !== "all" ? filter : undefined),
        getErrorStats(id, hours),
      ]);
      setDatabase(db);
      setInsights(insData.insights);
      setErrorStats(statsData.stats);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [id, hours, filter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    const interval = setInterval(fetchData, 60_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Compute summary stats
  const latestStats = errorStats.length > 0 ? errorStats[errorStats.length - 1] : null;
  const warningCount = insights.filter((i) => i.severity === "warning").length;
  const infoCount = insights.filter((i) => i.severity === "info").length;

  const sortedInsights = useMemo(() => {
    return [...insights].sort((a, b) => {
      const dir = logSortDir === "asc" ? 1 : -1;
      if (logSortKey === "severity") {
        const order = { critical: 4, error: 3, warning: 2, info: 1 };
        return ((order[b.severity as keyof typeof order] || 0) - (order[a.severity as keyof typeof order] || 0)) * dir;
      }
      if (logSortKey === "errorType") return a.errorType.localeCompare(b.errorType) * dir;
      if (logSortKey === "errorMessage") return a.errorMessage.localeCompare(b.errorMessage) * dir;
      if (logSortKey === "errorCount") return (a.errorCount - b.errorCount) * dir;
      if (logSortKey === "capturedAt") {
        return (new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime()) * dir;
      }
      return 0;
    });
  }, [insights, logSortKey, logSortDir]);

  function LogSortHeader({ label, k, style }: { label: string; k: LogSortKey; style?: React.CSSProperties }) {
    const isActive = logSortKey === k;
    return (
      <th
        className="alert-table-th sortable-th"
        style={style}
        onClick={() => {
          if (logSortKey === k) {
            setLogSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
          } else {
            setLogSortKey(k);
            setLogSortDir("desc");
          }
        }}
      >
        {label}
        <span className="sort-arrow" data-active={isActive}>
          {isActive ? (logSortDir === "asc" ? "▲" : "▼") : "▲"}
        </span>
      </th>
    );
  }

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
              color: "var(--text-secondary)", fontSize: "1rem",
              transition: "all var(--transition-fast)", flexShrink: 0,
            }}
            title="Back to database"
          >
            ←
          </Link>
          <div>
            <h1>Log Insights — {database?.name}</h1>
            <p className="text-secondary" style={{ fontSize: "0.9rem" }}>
              Error signals, deadlocks, conflicts, and anomalies
            </p>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        gap: "var(--space-md)", marginBottom: "var(--space-xl)",
      }}>
        <div className="glass-card-static" style={{ padding: "var(--space-lg)", textAlign: "center" }}>
          <div style={{ fontSize: "2rem", fontWeight: 700, color: warningCount > 0 ? "var(--signal-warning)" : "var(--signal-healthy)" }}>
            {warningCount}
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>Warnings</div>
        </div>
        <div className="glass-card-static" style={{ padding: "var(--space-lg)", textAlign: "center" }}>
          <div style={{ fontSize: "2rem", fontWeight: 700, color: "var(--brand)" }}>
            {infoCount}
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>Info Signals</div>
        </div>
        <div className="glass-card-static" style={{ padding: "var(--space-lg)", textAlign: "center" }}>
          <div style={{ fontSize: "2rem", fontWeight: 700, color: (latestStats?.deadlocksCount ?? 0) > 0 ? "var(--signal-critical)" : "var(--signal-healthy)" }}>
            {latestStats?.deadlocksCount ?? 0}
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>Deadlocks (24h)</div>
        </div>
        <div className="glass-card-static" style={{ padding: "var(--space-lg)", textAlign: "center" }}>
          <div style={{ fontSize: "2rem", fontWeight: 700, color: "var(--text-primary)" }}>
            {latestStats?.rollbacksCount ?? 0}
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>Rollbacks (24h)</div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div style={{ display: "flex", gap: "var(--space-sm)", marginBottom: "var(--space-lg)", flexWrap: "wrap" }}>
        {[
          { key: "all" as const, label: "All Events" },
          { key: "deadlock" as const, label: "Deadlocks" },
          { key: "serialization_failure" as const, label: "Serialization" },
          { key: "query_canceled" as const, label: "Canceled" },
          { key: "lock_timeout" as const, label: "Lock Timeouts" },
          { key: "connection_error" as const, label: "Conn Errors" },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={filter === tab.key ? "btn-primary" : "btn-secondary"}
            style={{ padding: "6px 14px", fontSize: "0.8rem", borderRadius: "var(--radius-md)" }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Two Column Layout: Events Table + Inspector Drawer */}
      <div style={{ display: "flex", gap: "var(--space-lg)", alignItems: "flex-start" }}>
        {/* Left Column: Events Table */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {sortedInsights.length === 0 ? (
            <div className="glass-card-static" style={{
              padding: "var(--space-2xl)", textAlign: "center", color: "var(--text-muted)",
            }}>
              <div style={{ fontSize: "2.5rem", marginBottom: "var(--space-md)" }}>✅</div>
              <p style={{ fontSize: "1.1rem", fontWeight: 500 }}>Clean log history</p>
              <div style={{ fontSize: "0.85rem", marginTop: "var(--space-sm)" }}>
                No errors or warnings in the last {hours < 24 ? `${hours} hours` : `${hours / 24} days`}
              </div>
            </div>
          ) : (
            <div className="glass-card-static" style={{ overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <LogSortHeader label="Sev" k="severity" style={{ width: 65 }} />
                    <LogSortHeader label="Type" k="errorType" style={{ width: 160 }} />
                    <LogSortHeader label="Message" k="errorMessage" />
                    <LogSortHeader label="Count" k="errorCount" style={{ width: 75 }} />
                    <LogSortHeader label="Time" k="capturedAt" style={{ width: 140 }} />
                  </tr>
                </thead>
                <tbody>
                  {sortedInsights.map((insight) => {
                    const style = SEVERITY_STYLES[insight.severity] ?? SEVERITY_STYLES.info;
                    const isSelected = selectedInsight?.id === insight.id;
                    const timeStr = new Date(insight.capturedAt).toLocaleTimeString("en-US", {
                      hour: "2-digit", minute: "2-digit",
                    });
                    const dateStr = new Date(insight.capturedAt).toLocaleDateString("en-US", {
                      month: "short", day: "numeric",
                    });
                    return (
                      <tr
                        key={insight.id}
                        className={`alert-table-row ${isSelected ? "selected-row" : ""}`}
                        onClick={() => setSelectedInsight(isSelected ? null : insight)}
                        style={{ cursor: "pointer", background: isSelected ? "var(--surface-alt)" : undefined }}
                      >
                        <td className="alert-table-td">
                          <span style={{
                            display: "inline-flex", alignItems: "center", justifyContent: "center",
                            width: 28, height: 28, borderRadius: "var(--radius-full)",
                            background: style.bg, fontSize: "0.75rem",
                          }}>
                            {style.emoji}
                          </span>
                        </td>
                        <td className="alert-table-td">
                          <span style={{
                            fontSize: "0.8rem", fontWeight: 600, color: style.color,
                            padding: "2px 8px", borderRadius: "var(--radius-full)",
                            background: style.bg,
                          }}>
                            {ERROR_TYPE_LABELS[insight.errorType] ?? insight.errorType}
                          </span>
                        </td>
                        <td className="alert-table-td" style={{ fontSize: "0.85rem", lineHeight: 1.4 }}>
                          <div style={{ fontWeight: isSelected ? 600 : 400 }}>{insight.errorMessage}</div>
                          {insight.sampleQuery && (
                            <div style={{
                              marginTop: 4, padding: "4px 8px", borderRadius: "var(--radius-sm)",
                              background: "var(--surface-alt)", fontFamily: "var(--font-mono)",
                              fontSize: "0.75rem", color: "var(--text-muted)",
                              maxWidth: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}>
                              {insight.sampleQuery}
                            </div>
                          )}
                        </td>
                        <td className="alert-table-td" style={{
                          fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: "0.85rem",
                          color: insight.errorCount > 10 ? "var(--signal-critical)" : "var(--text-primary)",
                        }}>
                          {insight.errorCount}
                        </td>
                        <td className="alert-table-td" style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                          <div>{dateStr}</div>
                          <div>{timeStr}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right Column: Diagnostic & Root Cause Inspector Drawer */}
        {selectedInsight && (
          <div style={{ flex: "0 0 450px", minWidth: 350 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-md)" }}>
              <div className="section-title" style={{ marginBottom: 0 }}>Event Diagnostics</div>
              <button
                onClick={() => setSelectedInsight(null)}
                style={{
                  background: "none", border: "none", color: "var(--text-muted)",
                  cursor: "pointer", fontSize: "0.85rem",
                }}
              >
                Close ✕
              </button>
            </div>

            <div className="glass-card-static" style={{ padding: "var(--space-lg)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", marginBottom: "var(--space-md)" }}>
                <span style={{ fontSize: "1.3rem" }}>
                  {SEVERITY_STYLES[selectedInsight.severity]?.emoji || "ℹ️"}
                </span>
                <div>
                  <div style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text-primary)" }}>
                    {ERROR_TYPE_LABELS[selectedInsight.errorType] ?? selectedInsight.errorType}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    Captured: {new Date(selectedInsight.capturedAt).toLocaleString()}
                  </div>
                </div>
              </div>

              {/* Message */}
              <div
                style={{
                  padding: "var(--space-sm) var(--space-md)",
                  background: "var(--surface-alt)",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border)",
                  fontSize: "0.85rem",
                  color: "var(--text-primary)",
                  marginBottom: "var(--space-md)",
                }}
              >
                {selectedInsight.errorMessage}
              </div>

              {/* Specific Diagnostics for Deadlocks */}
              {selectedInsight.errorType === "deadlock" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
                  <div>
                    <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--signal-critical)", marginBottom: 4 }}>
                      🔍 ROOT CAUSE ANALYSIS
                    </div>
                    <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", lineHeight: 1.5, margin: 0 }}>
                      Two or more concurrent database transactions attempted to acquire row or table locks in opposing sequence (e.g. <em>Txn A</em> holds Row 1 and waits for Row 2; <em>Txn B</em> holds Row 2 and waits for Row 1). PostgreSQL detected this circular dependency and aborted one transaction to unblock the system.
                    </p>
                  </div>

                  {/* Why queries are logged in server logs */}
                  <div
                    style={{
                      background: "var(--surface-alt)",
                      padding: "var(--space-sm) var(--space-md)",
                      borderRadius: "var(--radius-md)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--brand)", marginBottom: 4 }}>
                      📋 HOW TO LOG EXACT DEADLOCK QUERIES IN POSTGRESQL
                    </div>
                    <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.4, margin: "0 0 6px 0" }}>
                      Because deadlocks are aborted immediately by the engine, PostgreSQL outputs the full query cycle and PIDs directly into its server log. Ensure these parameters are enabled in your database configuration:
                    </p>
                    <code
                      style={{
                        display: "block",
                        fontFamily: "var(--font-mono)",
                        fontSize: "0.75rem",
                        background: "var(--background)",
                        padding: "6px 8px",
                        borderRadius: "var(--radius-sm)",
                        color: "var(--text-primary)",
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {`# In postgresql.conf or AWS RDS / Cloud SQL:\nlog_lock_waits = on\ndeadlock_timeout = '1s'\nlog_line_prefix = '%m [%p] %q%u@%d '`}
                    </code>
                  </div>

                  {/* Fast Action Bridges */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
                    <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-primary)" }}>
                      🛠️ RECOMMENDED INVESTIGATION STEPS
                    </div>
                    <Link
                      href={`/databases/${id}/queries?filter=dml`}
                      className="btn-secondary"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "8px 12px",
                        fontSize: "0.8rem",
                        textDecoration: "none",
                      }}
                    >
                      <span>✏️ Inspect Concurrent Write Queries</span>
                      <span>→</span>
                    </Link>
                    <Link
                      href={`/databases/${id}/indexes`}
                      className="btn-secondary"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "8px 12px",
                        fontSize: "0.8rem",
                        textDecoration: "none",
                      }}
                    >
                      <span>🗂️ Check Missing Foreign Key Indexes</span>
                      <span>→</span>
                    </Link>
                  </div>

                  {/* Prevention Patterns */}
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
                    <strong>Architecture Best Practices:</strong>
                    <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
                      <li>Always update tables and rows in consistent order (e.g. <code>ORDER BY id</code>).</li>
                      <li>Keep transactions short — avoid external HTTP calls inside transactions.</li>
                      <li>Use <code>SELECT ... FOR UPDATE SKIP LOCKED</code> for queue processing.</li>
                    </ul>
                  </div>
                </div>
              )}

              {/* Specific Diagnostics for High Rollbacks */}
              {selectedInsight.errorType === "high_rollback_rate" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
                  <div>
                    <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--signal-critical)", marginBottom: 4 }}>
                      🔍 TRANSACTION ROLLBACK ROOT CAUSE
                    </div>
                    <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", lineHeight: 1.5, margin: 0 }}>
                      High rollback volume occurs when application transactions encounter constraint violations (e.g. unique violations on <code>INSERT</code>), application-level exception aborts, deadlocks, or lock statement timeouts.
                    </p>
                  </div>
                  <Link
                    href={`/databases/${id}/queries`}
                    className="btn-primary"
                    style={{ textAlign: "center", fontSize: "0.8rem", padding: "8px 12px", textDecoration: "none" }}
                  >
                    Check Queries & Hotspots →
                  </Link>
                </div>
              )}

              {/* Specific Diagnostics for Checkpoints */}
              {selectedInsight.errorType === "checkpoint_pressure" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
                  <div>
                    <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--signal-warning)", marginBottom: 4 }}>
                      ⚡ CHECKPOINT TUNING
                    </div>
                    <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", lineHeight: 1.5, margin: 0 }}>
                      Requested checkpoints exceed timed checkpoints. PostgreSQL is forced to flush WAL data to disk frequently under heavy write load.
                    </p>
                  </div>
                  <div
                    style={{
                      background: "var(--surface-alt)",
                      padding: "var(--space-sm) var(--space-md)",
                      borderRadius: "var(--radius-md)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--brand)", marginBottom: 4 }}>
                      RECOMMENDED POSTGRESQL CONFIG
                    </div>
                    <code style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
                      {`max_wal_size = '16GB'\ncheckpoint_completion_target = 0.9`}
                    </code>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
