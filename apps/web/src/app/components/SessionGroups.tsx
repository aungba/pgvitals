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

    return Array.from(map.entries())
      .map(([name, data]) => ({
        name,
        ...data,
        percent: maxConnections > 0 ? Math.round((data.total / maxConnections) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total);
  }, [sessions, groupBy, maxConnections]);

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
          {(Object.keys(GROUP_LABELS) as GroupBy[]).map((key) => (
            <button
              key={key}
              className={`tab-button ${groupBy === key ? "active" : ""}`}
              onClick={() => setGroupBy(key)}
            >
              {GROUP_LABELS[key]}
            </button>
          ))}
        </div>
      </div>

      <div className="glass-card-static" style={{ overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th className="alert-table-th">{GROUP_LABELS[groupBy]}</th>
              <th className="alert-table-th" style={{ width: 80 }}>
                Total
              </th>
              <th className="alert-table-th" style={{ width: 80 }}>
                Active
              </th>
              <th className="alert-table-th" style={{ width: 80 }}>
                Idle
              </th>
              <th className="alert-table-th" style={{ width: 100 }}>
                Idle in Txn
              </th>
              <th className="alert-table-th" style={{ width: 140 }}>
                % of Max
              </th>
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
                  {g.total}
                </td>
                <td
                  className="alert-table-td"
                  style={{
                    fontFamily: "var(--font-mono)",
                    color: g.active > 0 ? "var(--signal-healthy)" : "var(--text-muted)",
                  }}
                >
                  {g.active}
                </td>
                <td
                  className="alert-table-td"
                  style={{
                    fontFamily: "var(--font-mono)",
                    color: "var(--text-muted)",
                  }}
                >
                  {g.idle}
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
                  {g.idleInTxn}
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
