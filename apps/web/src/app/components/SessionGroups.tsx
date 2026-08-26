"use client";

import React, { useMemo, useState } from "react";
import type { Session } from "../lib/api";

/* ===================================================================
   SessionGroups — Group connections by application, user, or client
   =================================================================== */

interface SessionGroupsProps {
  sessions: Session[];
  maxConnections: number;
}

type GroupBy = "applicationName" | "usename" | "clientAddr";

interface GroupData {
  name: string;
  total: number;
  active: number;
  idle: number;
  idleInTxn: number;
  percent: number;
}

const GROUP_LABELS: Record<GroupBy, string> = {
  applicationName: "Application",
  usename: "User",
  clientAddr: "Client IP",
};

export default function SessionGroups({
  sessions,
  maxConnections,
}: SessionGroupsProps) {
  const [groupBy, setGroupBy] = useState<GroupBy>("applicationName");
  const [sortKey, setSortKey] = useState<
    "name" | "total" | "active" | "idle" | "idleInTxn" | "percent"
  >("total");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const groups = useMemo((): GroupData[] => {
    const map = new Map<
      string,
      { total: number; active: number; idle: number; idleInTxn: number }
    >();

    for (const s of sessions) {
      let key: string;
      switch (groupBy) {
        case "applicationName":
          key = s.applicationName || "(unnamed)";
          break;
        case "usename":
          key = s.usename || "(unknown)";
          break;
        case "clientAddr":
          key = s.clientAddr || "(local)";
          break;
      }

      const existing = map.get(key) ?? {
        total: 0,
        active: 0,
        idle: 0,
        idleInTxn: 0,
      };
      existing.total++;
      if (s.state === "active") existing.active++;
      else if (s.state === "idle") existing.idle++;
      else if (
        s.state === "idle in transaction" ||
        s.state === "idle in transaction (aborted)"
      )
        existing.idleInTxn++;

      map.set(key, existing);
    }

    const list = Array.from(map.entries()).map(([name, data]) => ({
      name,
      ...data,
      percent:
        maxConnections > 0
          ? Math.round((data.total / maxConnections) * 100)
          : 0,
    }));

    return list.sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      switch (sortKey) {
        case "name":
          return dir * a.name.localeCompare(b.name);
        case "active":
          return dir * (a.active - b.active);
        case "idle":
          return dir * (a.idle - b.idle);
        case "idleInTxn":
          return dir * (a.idleInTxn - b.idleInTxn);
        case "percent":
          return dir * (a.percent - b.percent);
        case "total":
        default:
          return dir * (a.total - b.total);
      }
    });
  }, [sessions, groupBy, maxConnections, sortKey, sortDir]);

  function handleSort(key: typeof sortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function SortHeader({
    label,
    k,
    style,
  }: {
    label: string;
    k: typeof sortKey;
    style?: React.CSSProperties;
  }) {
    const isActive = sortKey === k;
    return (
      <th
        className="alert-table-th"
        onClick={() => handleSort(k)}
        style={{ ...style, cursor: "pointer", userSelect: "none" }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          {label}
          <span
            style={{
              fontSize: "0.7rem",
              color: isActive ? "var(--brand)" : "var(--text-muted)",
              opacity: isActive ? 1 : 0.4,
            }}
          >
            {isActive ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
          </span>
        </span>
      </th>
    );
  }

  if (!sessions.length) return null;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "var(--space-md)",
        }}
      >
        <div className="section-title" style={{ marginBottom: 0 }}>
          Connection Breakdown
        </div>
        <div className="tab-bar">
          {(["applicationName", "usename", "clientAddr"] as GroupBy[]).map(
            (key) => (
              <button
                key={key}
                className={`tab-button ${groupBy === key ? "active" : ""}`}
                onClick={() => setGroupBy(key)}
              >
                {GROUP_LABELS[key]}
              </button>
            )
          )}
        </div>
      </div>

      <div className="glass-card-static" style={{ overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <SortHeader label={GROUP_LABELS[groupBy]} k="name" />
              <SortHeader label="Total" k="total" style={{ width: 90 }} />
              <SortHeader label="Active" k="active" style={{ width: 90 }} />
              <SortHeader label="Idle" k="idle" style={{ width: 90 }} />
              <SortHeader
                label="Idle in Txn"
                k="idleInTxn"
                style={{ width: 110 }}
              />
              <SortHeader
                label="% of Max"
                k="percent"
                style={{ width: 140 }}
              />
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.name} className="alert-table-row">
                <td
                  className="alert-table-td"
                  style={{
                    fontWeight: 500,
                    maxWidth: 250,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {g.name}
                </td>
                <td
                  className="alert-table-td"
                  style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}
                >
                  {g.total.toLocaleString()}
                </td>
                <td
                  className="alert-table-td"
                  style={{
                    fontFamily: "var(--font-mono)",
                    color: g.active > 0 ? "var(--signal-healthy)" : "var(--text-muted)",
                  }}
                >
                  {g.active.toLocaleString()}
                </td>
                <td
                  className="alert-table-td"
                  style={{
                    fontFamily: "var(--font-mono)",
                    color: "var(--text-muted)",
                  }}
                >
                  {g.idle.toLocaleString()}
                </td>
                <td
                  className="alert-table-td"
                  style={{
                    fontFamily: "var(--font-mono)",
                    color:
                      g.idleInTxn > 0
                        ? "var(--signal-warning)"
                        : "var(--text-muted)",
                  }}
                >
                  {g.idleInTxn.toLocaleString()}
                </td>
                <td className="alert-table-td">
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--space-sm)",
                    }}
                  >
                    <div
                      style={{
                        flex: 1,
                        height: 6,
                        background: "var(--surface-alt)",
                        borderRadius: "var(--radius-full)",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.min(g.percent, 100)}%`,
                          height: "100%",
                          borderRadius: "var(--radius-full)",
                          background:
                            g.percent > 70
                              ? "var(--signal-critical)"
                              : g.percent > 40
                                ? "var(--signal-warning)"
                                : "var(--brand)",
                          transition: "width var(--transition-base)",
                        }}
                      />
                    </div>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "0.75rem",
                        color: "var(--text-muted)",
                        width: 35,
                        textAlign: "right",
                      }}
                    >
                      {g.percent}%
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
