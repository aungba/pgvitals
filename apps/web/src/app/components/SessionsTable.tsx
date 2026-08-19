"use client";

import React, { useState, useMemo } from "react";
import type { Session } from "../lib/api";
import StatusBadge from "./StatusBadge";

/* ===================================================================
   SessionsTable — Enhanced sortable & filterable sessions table
   =================================================================== */

interface SessionsTableProps {
  sessions: Session[];
}

type SortKey =
  | "pid"
  | "usename"
  | "state"
  | "stateDurationSeconds"
  | "applicationName"
  | "queryText"
  | "waitEventType"
  | "lockStatus";
type SortDir = "asc" | "desc";
type SessionStateFilter = "all" | "active" | "idle_in_txn" | "blocking" | "idle";

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
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<SessionStateFilter>("all");
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

  // Counts for filter chips
  const activeCount = useMemo(() => sessions.filter((s) => s.state === "active").length, [sessions]);
  const idleInTxnCount = useMemo(
    () => sessions.filter((s) => s.state === "idle in transaction" || s.state === "idle in transaction (aborted)").length,
    [sessions]
  );
  const blockerOrBlockedCount = useMemo(
    () => sessions.filter((s) => blockingPids.has(s.pid) || blockedPids.has(s.pid)).length,
    [sessions, blockingPids, blockedPids]
  );
  const idleCount = useMemo(() => sessions.filter((s) => s.state === "idle").length, [sessions]);

  const filteredAndSorted = useMemo(() => {
    let list = sessions;

    // State Filter
    if (stateFilter === "active") {
      list = list.filter((s) => s.state === "active");
    } else if (stateFilter === "idle_in_txn") {
      list = list.filter((s) => s.state === "idle in transaction" || s.state === "idle in transaction (aborted)");
    } else if (stateFilter === "blocking") {
      list = list.filter((s) => blockingPids.has(s.pid) || blockedPids.has(s.pid));
    } else if (stateFilter === "idle") {
      list = list.filter((s) => s.state === "idle");
    }

    // Search Query (PID, username, app, query text, client IP)
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          String(s.pid).includes(q) ||
          (s.applicationName && s.applicationName.toLowerCase().includes(q)) ||
          (s.usename && s.usename.toLowerCase().includes(q)) ||
          (s.queryText && s.queryText.toLowerCase().includes(q)) ||
          (s.clientAddr && s.clientAddr.toLowerCase().includes(q))
      );
    }

    // Sorting
    return [...list].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      if (sortKey === "lockStatus") {
        const getLockRank = (s: Session) => {
          if (blockingPids.has(s.pid)) return 2;
          if (blockedPids.has(s.pid)) return 1;
          return 0;
        };
        return dir * (getLockRank(a) - getLockRank(b));
      }
      if (sortKey === "waitEventType") {
        const wA = `${a.waitEventType || ""}:${a.waitEvent || ""}`;
        const wB = `${b.waitEventType || ""}:${b.waitEvent || ""}`;
        return dir * wA.localeCompare(wB);
      }
      const aVal = a[sortKey as keyof Session];
      const bVal = b[sortKey as keyof Session];
      if (typeof aVal === "number" && typeof bVal === "number") {
        return dir * (aVal - bVal);
      }
      const aStr = String(aVal || "");
      const bStr = String(bVal || "");
      return dir * aStr.localeCompare(bStr);
    });
  }, [sessions, stateFilter, search, sortKey, sortDir, blockingPids, blockedPids]);

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
      return <span style={{ opacity: 0.3, marginLeft: 4, fontSize: "0.7rem" }}>↕</span>;
    }
    return (
      <span style={{ marginLeft: 4, fontSize: "0.7rem", color: "var(--brand)" }}>
        {sortDir === "asc" ? "▲" : "▼"}
      </span>
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
        <div style={{ fontSize: "2rem", marginBottom: 8, opacity: 0.5 }}>🔌</div>
        <div>No active sessions connected</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
      {/* Search & State Filter Controls */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-md)",
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-md)", flex: 1 }}>
          {/* Quick Search */}
          <div style={{ position: "relative", minWidth: 220, maxWidth: 320, flex: 1 }}>
            <input
              type="text"
              placeholder="Search PID, user, app, SQL..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="table-search"
              style={{
                width: "100%",
                padding: "6px 12px",
                paddingLeft: 30,
                fontSize: "0.8rem",
                borderRadius: "var(--radius-md)",
                height: 32,
              }}
            />
            <span
              style={{
                position: "absolute",
                left: 10,
                top: "50%",
                transform: "translateY(-50%)",
                fontSize: "0.8rem",
                color: "var(--text-muted)",
                pointerEvents: "none",
              }}
            >
              🔍
            </span>
            {search && (
              <button
                onClick={() => setSearch("")}
                style={{
                  position: "absolute",
                  right: 8,
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: "0.8rem",
                  padding: 2,
                }}
              >
                ✕
              </button>
            )}
          </div>

          {/* State Filter Chips */}
          <div className="filter-chips">
            <button
              className="filter-chip"
              data-active={stateFilter === "all"}
              onClick={() => setStateFilter("all")}
            >
              All ({sessions.length})
            </button>
            <button
              className="filter-chip"
              data-active={stateFilter === "active"}
              onClick={() => setStateFilter("active")}
            >
              ⚡ Active ({activeCount})
            </button>
            <button
              className="filter-chip"
              data-active={stateFilter === "idle_in_txn"}
              onClick={() => setStateFilter("idle_in_txn")}
            >
              ⏳ Idle in Txn ({idleInTxnCount})
            </button>
            {blockerOrBlockedCount > 0 && (
              <button
                className="filter-chip"
                data-active={stateFilter === "blocking"}
                onClick={() => setStateFilter("blocking")}
              >
                ⛔ Lock Issues ({blockerOrBlockedCount})
              </button>
            )}
            <button
              className="filter-chip"
              data-active={stateFilter === "idle"}
              onClick={() => setStateFilter("idle")}
            >
              💤 Idle ({idleCount})
            </button>
          </div>
        </div>

        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
          Showing {filteredAndSorted.length} of {sessions.length} sessions
        </span>
      </div>

      {/* Sessions Data Table */}
      <div
        className="glass-card-static"
        style={{
          overflow: "auto",
          borderRadius: "var(--radius-lg)",
        }}
      >
        {filteredAndSorted.length === 0 ? (
          <div style={{ padding: "var(--space-xl)", textAlign: "center", color: "var(--text-muted)", fontSize: "0.85rem" }}>
            No sessions match your search or filter.
          </div>
        ) : (
          <table style={{ minWidth: 900, width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle} onClick={() => handleSort("pid")}>
                  PID <SortIcon column="pid" />
                </th>
                <th style={thStyle} onClick={() => handleSort("applicationName")}>
                  Application <SortIcon column="applicationName" />
                </th>
                <th style={thStyle} onClick={() => handleSort("usename")}>
                  User <SortIcon column="usename" />
                </th>
                <th style={thStyle} onClick={() => handleSort("state")}>
                  State <SortIcon column="state" />
                </th>
                <th style={thStyle} onClick={() => handleSort("stateDurationSeconds")}>
                  Duration <SortIcon column="stateDurationSeconds" />
                </th>
                <th style={thStyle} onClick={() => handleSort("queryText")}>
                  Query <SortIcon column="queryText" />
                </th>
                <th style={thStyle} onClick={() => handleSort("waitEventType")}>
                  Wait Event <SortIcon column="waitEventType" />
                </th>
                <th style={thStyle} onClick={() => handleSort("lockStatus")}>
                  Lock Status <SortIcon column="lockStatus" />
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredAndSorted.map((session) => {
                const isBlocker = blockingPids.has(session.pid);
                const isBlocked = blockedPids.has(session.pid);
                const isExpanded = expandedPid === session.pid;

                let rowBg = "transparent";
                if (isBlocker) rowBg = "var(--signal-critical-dim)";
                else if (isBlocked) rowBg = "var(--signal-warning-dim)";

                return (
                  <tr
                    key={session.pid}
                    style={{
                      background: rowBg,
                      transition: "background var(--transition-fast)",
                    }}
                    onMouseEnter={(e) => {
                      if (!isBlocker && !isBlocked) {
                        (e.currentTarget as HTMLTableRowElement).style.background = "var(--surface-alt)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLTableRowElement).style.background = rowBg;
                    }}
                  >
                    <td style={tdStyle}>
                      <span
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: "0.8rem",
                          color: isBlocker ? "var(--signal-critical)" : "var(--text-primary)",
                          fontWeight: isBlocker ? 700 : 500,
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
                            fontWeight: 600,
                          }}
                        >
                          ⛔ Blocker
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
                      title={session.applicationName || undefined}
                    >
                      {session.applicationName || "—"}
                    </td>
                    <td style={{ ...tdStyle, color: "var(--text-secondary)" }}>{session.usename || "—"}</td>
                    <td style={tdStyle}>
                      <StatusBadge variant={session.state || "disabled"} dot />
                    </td>
                    <td
                      style={{
                        ...tdStyle,
                        fontFamily: "var(--font-mono)",
                        color: session.stateDurationSeconds > 300 ? "var(--signal-warning)" : "var(--text-secondary)",
                        fontWeight: session.stateDurationSeconds > 300 ? 600 : 400,
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
                      onClick={() => setExpandedPid(isExpanded ? null : session.pid)}
                      title={session.queryText ? "Click to expand/collapse query" : undefined}
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
                            border: "1px solid var(--border)",
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
                            fontSize: "0.75rem",
                            color: "var(--signal-warning)",
                            fontWeight: 600,
                          }}
                        >
                          Blocked by {session.blockingPid}
                        </span>
                      ) : isBlocker ? (
                        <span
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: "0.75rem",
                            color: "var(--signal-critical)",
                            fontWeight: 600,
                          }}
                        >
                          Holding locks
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
        )}
      </div>
    </div>
  );
}
