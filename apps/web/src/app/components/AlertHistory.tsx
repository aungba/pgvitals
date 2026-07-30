"use client";

import React from "react";
import type { Alert } from "../lib/api";

/* ===================================================================
   AlertHistory — Table of fired alerts with status and severity
   =================================================================== */

interface AlertHistoryProps {
  alerts: Alert[];
}

const ALERT_TYPE_NAMES: Record<string, string> = {
  idle_in_transaction: "Idle in Transaction",
  connection_hog: "Connection Hog",
  blocking_chain: "Blocking Chain",
  connection_exhaustion: "Connection Exhaustion",
  connection_spike: "Connection Spike",
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

export default function AlertHistory({ alerts }: AlertHistoryProps) {
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
            <th className="alert-table-th" style={{ width: 40 }}></th>
            <th className="alert-table-th">Type</th>
            <th className="alert-table-th">Root Cause</th>
            <th className="alert-table-th" style={{ width: 140 }}>Fired At</th>
            <th className="alert-table-th" style={{ width: 100 }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((alert) => {
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
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
