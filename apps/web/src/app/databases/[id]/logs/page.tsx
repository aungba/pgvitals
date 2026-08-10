"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getDatabase, getLogInsights, getErrorStats } from "../../../lib/api";
import type { Database, LogInsight, DbErrorStatEntry } from "../../../lib/api";

/* ===================================================================
   Log Insights Page — Phase 8
   Shows error/warning events, deadlock counts, rollback trends
   =================================================================== */

const ERROR_TYPE_LABELS: Record<string, string> = {
  deadlock: "Deadlock",
  replication_conflict: "Replication Conflict",
  high_rollback_rate: "High Rollback Rate",
  checkpoint_pressure: "Checkpoint Pressure",
  aborted_transaction: "Aborted Transaction",
  lock_contention: "Lock Contention",
};

const SEVERITY_STYLES: Record<string, { color: string; bg: string; emoji: string }> = {
  error: { color: "var(--signal-critical)", bg: "var(--signal-critical-dim)", emoji: "🔴" },
  warning: { color: "var(--signal-warning)", bg: "var(--signal-warning-dim)", emoji: "🟡" },
  info: { color: "var(--text-secondary)", bg: "var(--surface-alt)", emoji: "ℹ️" },
};

export default function LogInsightsPage() {
  const params = useParams();
  const id = params.id as string;

  const [database, setDatabase] = useState<Database | null>(null);
  const [insights, setInsights] = useState<LogInsight[]>([]);
  const [errorStats, setErrorStats] = useState<DbErrorStatEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [hours, setHours] = useState(24);
  const [severityFilter, setSeverityFilter] = useState<string>("all");

  const fetchData = useCallback(async () => {
    try {
      const [db, logData, statsData] = await Promise.all([
        getDatabase(id),
        getLogInsights(id, hours, severityFilter === "all" ? undefined : severityFilter),
        getErrorStats(id, hours),
      ]);
      setDatabase(db);
      setInsights(logData.insights);
      setErrorStats(statsData.stats);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [id, hours, severityFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    const interval = setInterval(fetchData, 60_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Compute summary stats
  const latestStats = errorStats.length > 0 ? errorStats[errorStats.length - 1] : null;
  const errorCount = insights.filter((i) => i.severity === "error").length;
  const warningCount = insights.filter((i) => i.severity === "warning").length;

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
          <div style={{ fontSize: "2rem", fontWeight: 700, color: errorCount > 0 ? "var(--signal-critical)" : "var(--signal-healthy)" }}>
            {errorCount}
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>Errors</div>
        </div>
        <div className="glass-card-static" style={{ padding: "var(--space-lg)", textAlign: "center" }}>
          <div style={{ fontSize: "2rem", fontWeight: 700, color: warningCount > 0 ? "var(--signal-warning)" : "var(--signal-healthy)" }}>
            {warningCount}
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>Warnings</div>
        </div>
        <div className="glass-card-static" style={{ padding: "var(--space-lg)", textAlign: "center" }}>
          <div style={{ fontSize: "2rem", fontWeight: 700, fontFamily: "var(--font-mono)" }}>
            {latestStats?.deadlocksCount ?? 0}
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>Deadlocks (cumulative)</div>
        </div>
        <div className="glass-card-static" style={{ padding: "var(--space-lg)", textAlign: "center" }}>
          <div style={{ fontSize: "2rem", fontWeight: 700, fontFamily: "var(--font-mono)" }}>
            {latestStats?.rollbacksCount ?? 0}
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>Rollbacks (cumulative)</div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: "var(--space-md)", marginBottom: "var(--space-lg)", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: "var(--space-xs)" }}>
          {[1, 6, 24, 72, 168].map((h) => (
            <button
              key={h}
              className={hours === h ? "btn-primary" : "btn-secondary"}
              onClick={() => setHours(h)}
              style={{ padding: "6px 14px", fontSize: "0.8rem" }}
            >
              {h < 24 ? `${h}h` : `${h / 24}d`}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: "var(--space-xs)" }}>
          {["all", "error", "warning"].map((s) => (
            <button
              key={s}
              className={severityFilter === s ? "btn-primary" : "btn-secondary"}
              onClick={() => setSeverityFilter(s)}
              style={{ padding: "6px 14px", fontSize: "0.8rem", textTransform: "capitalize" }}
            >
              {s === "all" ? "All" : `${SEVERITY_STYLES[s]?.emoji ?? ""} ${s}`}
            </button>
          ))}
        </div>
      </div>

      {/* Insight Events */}
      {insights.length === 0 ? (
        <div className="glass-card-static" style={{ padding: "var(--space-xl)", textAlign: "center" }}>
          <div style={{ fontSize: "2rem", marginBottom: "var(--space-sm)" }}>✅</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>No issues detected</div>
          <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
            No errors or warnings in the last {hours < 24 ? `${hours} hours` : `${hours / 24} days`}
          </div>
        </div>
      ) : (
        <div className="glass-card-static" style={{ overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th className="alert-table-th" style={{ width: 50 }}>Sev</th>
                <th className="alert-table-th" style={{ width: 160 }}>Type</th>
                <th className="alert-table-th">Message</th>
                <th className="alert-table-th" style={{ width: 60 }}>Count</th>
                <th className="alert-table-th" style={{ width: 140 }}>Time</th>
              </tr>
            </thead>
            <tbody>
              {insights.map((insight) => {
                const style = SEVERITY_STYLES[insight.severity] ?? SEVERITY_STYLES.info;
                const timeStr = new Date(insight.capturedAt).toLocaleTimeString("en-US", {
                  hour: "2-digit", minute: "2-digit",
                });
                const dateStr = new Date(insight.capturedAt).toLocaleDateString("en-US", {
                  month: "short", day: "numeric",
                });
                return (
                  <tr key={insight.id} className="alert-table-row">
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
                      <div>{insight.errorMessage}</div>
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
  );
}
