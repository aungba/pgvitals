"use client";

import React, { useState, useMemo } from "react";
import type { Session } from "../lib/api";
import StatusBadge from "./StatusBadge";

/* ===================================================================
   SessionsTable — Sortable sessions table with blocking indicators
   =================================================================== */

interface SessionsTableProps {
  sessions: Session[];
}

type SortKey = "pid" | "usename" | "state" | "stateDurationSeconds" | "applicationName";
type SortDir = "asc" | "desc";

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function truncateQuery(query: string, maxLen = 80): string {
  if (!query) return "—";
  if (query.length <= maxLen) return query;
  return query.slice(0, maxLen) + "…";
}

export default function SessionsTable({ sessions }: SessionsTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("stateDurationSeconds");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expandedPid, setExpandedPid] = useState<number | null>(null);

  const blockingPids = useMemo(() => {
    const set = new Set<number>();
    sessions.forEach((s) => {
      if (s.blockingPid) set.add(s.blockingPid);
    });
    return set;
  }, [sessions]);

  const blockedPids = useMemo(() => {
    const set = new Set<number>();
    sessions.forEach((s) => {
      if (s.blockingPid) set.add(s.pid);
    });
    return set;
  }, [sessions]);

  const sorted = useMemo(() => {
    const copy = [...sessions];
    copy.sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      const aStr = String(aVal || "");
      const bStr = String(bVal || "");
      return sortDir === "asc"
        ? aStr.localeCompare(bStr)
        : bStr.localeCompare(aStr);
    });
    return copy;
  }, [sessions, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function SortIcon({ column }: { column: SortKey }) {
    if (sortKey !== column) {
      return (
        <span style={{ opacity: 0.3, marginLeft: 4, fontSize: "0.7rem" }}>
          ↕
        </span>
      );
    }
    return (
      <span style={{ marginLeft: 4, fontSize: "0.7rem", color: "var(--brand)" }}>
        {sortDir === "asc" ? "↑" : "↓"}
      </span>
    );
  }

  if (!sessions.length) {
    return (
      <div
        className="glass-card-static"
        style={{
          padding: "var(--space-2xl)",
          textAlign: "center",
          color: "var(--text-muted)",
        }}
      >
        <div style={{ fontSize: "2rem", marginBottom: 8, opacity: 0.5 }}>
          🔌
        </div>
        <div>No active sessions</div>
      </div>
    );
  }

  const thStyle: React.CSSProperties = {
    padding: "10px 14px",
    textAlign: "left",
    fontSize: "0.7rem",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "var(--text-muted)",
    borderBottom: "1px solid var(--border)",
    cursor: "pointer",
    userSelect: "none",
    whiteSpace: "nowrap",
    transition: "color var(--transition-fast)",
  };

  const tdStyle: React.CSSProperties = {
    padding: "10px 14px",
    fontSize: "0.8rem",
    borderBottom: "1px solid var(--border)",
    verticalAlign: "top",
  };

  return (
    <div
      className="glass-card-static"
      style={{
        overflow: "auto",
        borderRadius: "var(--radius-lg)",
      }}
    >
      <table style={{ minWidth: 900 }}>
        <thead>
          <tr>
            <th style={thStyle} onClick={() => handleSort("pid")}>
              PID <SortIcon column="pid" />
            </th>
            <th
              style={thStyle}
              onClick={() => handleSort("applicationName")}
            >
              Application <SortIcon column="applicationName" />
            </th>
            <th style={thStyle} onClick={() => handleSort("usename")}>
              User <SortIcon column="usename" />
            </th>
            <th style={thStyle} onClick={() => handleSort("state")}>
              State <SortIcon column="state" />
            </th>
            <th
              style={thStyle}
              onClick={() => handleSort("stateDurationSeconds")}
            >
              Duration <SortIcon column="stateDurationSeconds" />
            </th>
            <th style={{ ...thStyle, cursor: "default" }}>Query</th>
            <th style={{ ...thStyle, cursor: "default" }}>Wait</th>
            <th style={{ ...thStyle, cursor: "default" }}>Blocking</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((session) => {
            const isBlocker = blockingPids.has(session.pid);
            const isBlocked = blockedPids.has(session.pid);
            const isExpanded = expandedPid === session.pid;

            let rowBg = "transparent";
            if (isBlocker)
              rowBg = "var(--signal-critical-dim)";
            else if (isBlocked)
              rowBg = "var(--signal-warning-dim)";

            return (
              <tr
                key={session.pid}
                style={{
                  background: rowBg,
                  transition: "background var(--transition-fast)",
                }}
                onMouseEnter={(e) => {
                  if (!isBlocker && !isBlocked)
                    (e.currentTarget as HTMLTableRowElement).style.background =
                      "var(--surface-alt)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLTableRowElement).style.background =
                    rowBg;
                }}
              >
                <td style={tdStyle}>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "0.8rem",
                      color: isBlocker ? "var(--signal-critical)" : "var(--text-primary)",
                      fontWeight: isBlocker ? 600 : 400,
                    }}
                  >
                    {session.pid}
                  </span>
                  {isBlocker && (
                    <span
                      style={{
                        display: "block",
                        fontSize: "0.65rem",
                        color: "var(--signal-critical)",
                        fontWeight: 500,
                      }}
                    >
                      ⛔ Blocking
                    </span>
                  )}
                  {isBlocked && (
                    <span
                      style={{
                        display: "block",
                        fontSize: "0.65rem",
                        color: "var(--signal-warning)",
                        fontWeight: 500,
                      }}
                    >
                      ⏳ Blocked by {session.blockingPid}
                    </span>
                  )}
                </td>
                <td
                  style={{
                    ...tdStyle,
                    color: "var(--text-secondary)",
                    maxWidth: 160,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {session.applicationName || "—"}
                </td>
                <td style={{ ...tdStyle, color: "var(--text-secondary)" }}>
                  {session.usename || "—"}
                </td>
                <td style={tdStyle}>
                  <StatusBadge variant={session.state || "disabled"} dot />
                </td>
                <td
                  style={{
                    ...tdStyle,
                    fontFamily: "var(--font-mono)",
                    color:
                      session.stateDurationSeconds > 300
                        ? "var(--signal-warning)"
                        : "var(--text-secondary)",
                  }}
                >
                  {formatDuration(session.stateDurationSeconds)}
                </td>
                <td
                  style={{
                    ...tdStyle,
                    maxWidth: 280,
                    fontFamily: "var(--font-mono)",
                    fontSize: "0.75rem",
                    color: "var(--text-secondary)",
                    cursor: session.queryText ? "pointer" : "default",
                    lineHeight: 1.5,
                  }}
                  onClick={() =>
                    setExpandedPid(isExpanded ? null : session.pid)
                  }
                  title={
                    session.queryText
                      ? "Click to expand/collapse"
                      : undefined
                  }
                >
                  {isExpanded ? (
                    <div
                      style={{
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-all",
                        maxHeight: 200,
                        overflow: "auto",
                        background: "var(--surface-alt)",
                        padding: "8px",
                        borderRadius: 6,
                      }}
                    >
                      {session.queryText || "—"}
                    </div>
                  ) : (
                    truncateQuery(session.queryText)
                  )}
                </td>
                <td
                  style={{
                    ...tdStyle,
                    fontSize: "0.75rem",
                    color: "var(--text-muted)",
                  }}
                >
                  {session.waitEventType ? (
                    <span>
                      {session.waitEventType}
                      {session.waitEvent && (
                        <span
                          style={{
                            display: "block",
                            fontSize: "0.7rem",
                            color: "var(--text-muted)",
                          }}
                        >
                          {session.waitEvent}
                        </span>
                      )}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td style={tdStyle}>
                  {session.blockingPid ? (
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "0.8rem",
                        color: "var(--signal-critical)",
                        fontWeight: 600,
                      }}
                    >
                      PID {session.blockingPid}
                    </span>
                  ) : (
                    <span style={{ color: "var(--text-muted)" }}>—</span>
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
