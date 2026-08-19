"use client";

import React from "react";
import type { Alert } from "../lib/api";

/* ===================================================================
   AlertHistory — Table of fired alerts with status and severity
   =================================================================== */

interface AlertHistoryProps {
  alerts: Alert[];
  onFeedback?: (alertId: string, feedback: "useful" | "not_useful") => void;
}

const ALERT_TYPE_NAMES: Record<string, string> = {
  idle_in_transaction: "Idle in Transaction",
  connection_hog: "Connection Hog",
  blocking_chain: "Blocking Chain",
  connection_exhaustion: "Connection Exhaustion",
  connection_spike: "Connection Spike",
  replication_lag: "Replication Lag",
  monitoring_failure: "Monitoring Failure",
  pool_exhaustion: "Pool Exhaustion",
};

function formatTime(ts: string): string {
  return new Date(ts).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function AlertHistory({ alerts, onFeedback }: AlertHistoryProps) {
  const [alertSortKey, setAlertSortKey] = React.useState<"severity" | "type" | "rootCause" | "firedAt" | "status">("firedAt");
  const [alertSortDir, setAlertSortDir] = React.useState<"asc" | "desc">("desc");

  const sortedAlerts = React.useMemo(() => {
    return [...alerts].sort((a, b) => {
      const dir = alertSortDir === "asc" ? 1 : -1;
      switch (alertSortKey) {
        case "severity": {
          const rank = { critical: 2, warning: 1 };
          return dir * ((rank[a.severity as keyof typeof rank] || 0) - (rank[b.severity as keyof typeof rank] || 0));
        }
        case "type": {
          const nameA = ALERT_TYPE_NAMES[a.alertType] ?? a.alertType;
          const nameB = ALERT_TYPE_NAMES[b.alertType] ?? b.alertType;
          return dir * nameA.localeCompare(nameB);
        }
        case "rootCause": {
          const rcA = a.rootCauseHint ?? "";
          const rcB = b.rootCauseHint ?? "";
          return dir * rcA.localeCompare(rcB);
        }
        case "status": {
          const statusA = a.resolvedAt ? 1 : 0;
          const statusB = b.resolvedAt ? 1 : 0;
          return dir * (statusA - statusB);
        }
        case "firedAt":
        default:
          return dir * (new Date(a.firedAt).getTime() - new Date(b.firedAt).getTime());
      }
    });
  }, [alerts, alertSortKey, alertSortDir]);

  function handleAlertSort(key: typeof alertSortKey) {
    if (alertSortKey === key) {
      setAlertSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setAlertSortKey(key);
      setAlertSortDir("desc");
    }
  }

  function AlertSortHeader({
    label,
    k,
    style,
  }: {
    label: string;
    k: typeof alertSortKey;
    style?: React.CSSProperties;
  }) {
    const isActive = alertSortKey === k;
    return (
      <th
        className="alert-table-th"
        onClick={() => handleAlertSort(k)}
        style={{ ...style, cursor: "pointer", userSelect: "none" }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          {label}
          <span style={{ fontSize: "0.7rem", color: isActive ? "var(--brand)" : "var(--text-muted)", opacity: isActive ? 1 : 0.4 }}>
            {isActive ? (alertSortDir === "asc" ? "▲" : "▼") : "↕"}
          </span>
        </span>
      </th>
    );
  }

  if (alerts.length === 0) {
    return (
      <div
        className="glass-card-static"
        style={{
          padding: "var(--space-xl)",
          textAlign: "center",
          color: "var(--text-muted)",
        }}
      >
        <div style={{ fontSize: "2rem", marginBottom: 8, opacity: 0.5 }}>🔔</div>
        <div style={{ fontSize: "0.9rem" }}>No alerts recorded yet</div>
      </div>
    );
  }

  return (
    <div className="glass-card-static" style={{ overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <AlertSortHeader label="Sev" k="severity" style={{ width: 65, textAlign: "center" }} />
            <AlertSortHeader label="Type" k="type" style={{ width: 180 }} />
            <AlertSortHeader label="Root Cause" k="rootCause" />
            <AlertSortHeader label="Fired At" k="firedAt" style={{ width: 140 }} />
            <AlertSortHeader label="Status" k="status" style={{ width: 100 }} />
            <th className="alert-table-th" style={{ width: 90 }}>Helpful?</th>
          </tr>
        </thead>
        <tbody>
          {sortedAlerts.map((alert) => {
            const isResolved = alert.resolvedAt !== null;
            return (
              <tr
                key={alert.id}
                className="alert-table-row"
                style={{ opacity: isResolved ? 0.55 : 1 }}
              >
                <td className="alert-table-td" style={{ textAlign: "center" }}>
                  <span
                    className={`alert-severity-dot ${
                      alert.severity === "critical"
                        ? "alert-severity-critical"
                        : "alert-severity-warning"
                    }`}
                  />
                </td>
                <td className="alert-table-td" style={{ fontWeight: 500 }}>
                  {ALERT_TYPE_NAMES[alert.alertType] ?? alert.alertType}
                </td>
                <td
                  className="alert-table-td"
                  style={{
                    fontSize: "0.85rem",
                    color: "var(--text-secondary)",
                    maxWidth: 400,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {alert.rootCauseHint ?? "—"}
                </td>
                <td
                  className="alert-table-td"
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "0.8rem",
                  }}
                >
                  {formatTime(alert.firedAt)}
                </td>
                <td className="alert-table-td">
                  <span
                    className={`alert-status-badge ${
                      isResolved ? "alert-status-resolved" : "alert-status-active"
                    }`}
                  >
                    {isResolved ? "Resolved" : "Active"}
                  </span>
                </td>
                <td className="alert-table-td" style={{ textAlign: "center" }}>
                  {alert.rootCauseHint ? (
                    <span style={{ display: "inline-flex", gap: 4 }}>
                      <button
                        onClick={() => onFeedback?.(alert.id, "useful")}
                        disabled={alert.feedback !== null}
                        title="Helpful"
                        style={{
                          background: alert.feedback === "useful" ? "var(--signal-healthy-dim)" : "transparent",
                          border: alert.feedback === "useful" ? "1px solid var(--signal-healthy)" : "1px solid var(--border)",
                          borderRadius: "var(--radius-sm)",
                          cursor: alert.feedback ? "default" : "pointer",
                          padding: "2px 6px",
                          fontSize: "0.85rem",
                          opacity: alert.feedback && alert.feedback !== "useful" ? 0.3 : 1,
                        }}
                      >
                        👍
                      </button>
                      <button
                        onClick={() => onFeedback?.(alert.id, "not_useful")}
                        disabled={alert.feedback !== null}
                        title="Not helpful"
                        style={{
                          background: alert.feedback === "not_useful" ? "var(--signal-critical-dim)" : "transparent",
                          border: alert.feedback === "not_useful" ? "1px solid var(--signal-critical)" : "1px solid var(--border)",
                          borderRadius: "var(--radius-sm)",
                          cursor: alert.feedback ? "default" : "pointer",
                          padding: "2px 6px",
                          fontSize: "0.85rem",
                          opacity: alert.feedback && alert.feedback !== "not_useful" ? 0.3 : 1,
                        }}
                      >
                        👎
                      </button>
                    </span>
                  ) : (
                    <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
