"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getDatabase, getPoolerStats, getPoolerHistory } from "../../../lib/api";
import type { Database, PoolerSnapshot } from "../../../lib/api";

/* ===================================================================
   PgBouncer Pool Stats Page — Phase 9
   =================================================================== */

type PoolSortKey = "poolName" | "clActive" | "clWaiting" | "svActive" | "svIdle" | "avgWaitTimeMs";

function formatMs(ms: number | null): string {
  if (ms === null || isNaN(ms)) return "—";
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export default function PoolerPage() {
  const params = useParams();
  const id = params.id as string;

  const [database, setDatabase] = useState<Database | null>(null);
  const [pools, setPools] = useState<PoolerSnapshot[]>([]);
  const [history, setHistory] = useState<PoolerSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [noPgBouncer, setNoPgBouncer] = useState(false);

  const [poolSortKey, setPoolSortKey] = useState<PoolSortKey>("clWaiting");
  const [poolSortDir, setPoolSortDir] = useState<"asc" | "desc">("desc");

  const fetchData = useCallback(async () => {
    try {
      const [db, poolData, histData] = await Promise.all([
        getDatabase(id),
        getPoolerStats(id),
        getPoolerHistory(id).catch(() => ({ history: [] })),
      ]);
      setDatabase(db);
      setPools(poolData.pools);
      setHistory(histData.history);
      setNoPgBouncer(poolData.pools.length === 0 && histData.history.length === 0);
    } catch {
      setNoPgBouncer(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    const interval = setInterval(fetchData, 10_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Aggregate totals
  const totalClActive = pools.reduce((s, p) => s + p.clActive, 0);
  const totalClWaiting = pools.reduce((s, p) => s + p.clWaiting, 0);
  const totalSvActive = pools.reduce((s, p) => s + p.svActive, 0);
  const totalSvIdle = pools.reduce((s, p) => s + p.svIdle, 0);

  const sortedPools = useMemo(() => {
    return [...pools].sort((a, b) => {
      const dir = poolSortDir === "asc" ? 1 : -1;
      switch (poolSortKey) {
        case "poolName":
          return dir * a.poolName.localeCompare(b.poolName);
        case "clActive":
          return dir * (a.clActive - b.clActive);
        case "clWaiting":
          return dir * (a.clWaiting - b.clWaiting);
        case "svActive":
          return dir * (a.svActive - b.svActive);
        case "svIdle":
          return dir * (a.svIdle - b.svIdle);
        case "avgWaitTimeMs":
        default:
          return dir * ((a.avgWaitTimeMs ?? 0) - (b.avgWaitTimeMs ?? 0));
      }
    });
  }, [pools, poolSortKey, poolSortDir]);

  function handlePoolSort(key: PoolSortKey) {
    if (poolSortKey === key) {
      setPoolSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setPoolSortKey(key);
      setPoolSortDir("desc");
    }
  }

  function PoolSortHeader({
    label,
    k,
    align = "left",
    style,
  }: {
    label: string;
    k: PoolSortKey;
    align?: "left" | "right";
    style?: React.CSSProperties;
  }) {
    const isActive = poolSortKey === k;
    return (
      <th
        onClick={() => handlePoolSort(k)}
        style={{
          padding: "var(--space-md) var(--space-lg)",
          color: "var(--text-muted)",
          fontWeight: 600,
          fontSize: "0.75rem",
          textTransform: "uppercase",
          textAlign: align,
          cursor: "pointer",
          userSelect: "none",
          ...style,
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, justifyContent: align === "right" ? "flex-end" : "flex-start", width: "100%" }}>
          {label}
          <span style={{ fontSize: "0.7rem", color: isActive ? "var(--brand)" : "var(--text-muted)", opacity: isActive ? 1 : 0.4 }}>
            {isActive ? (poolSortDir === "asc" ? "▲" : "▼") : "↕"}
          </span>
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
            <h1>PgBouncer Pools — {database?.name}</h1>
            <p className="text-secondary" style={{ fontSize: "0.9rem" }}>
              Connection pool metrics and health
            </p>
          </div>
        </div>
      </div>

      {noPgBouncer ? (
        <div className="glass-card-static" style={{
          padding: "var(--space-2xl)", textAlign: "center", color: "var(--text-muted)",
        }}>
          <div style={{ fontSize: "2.5rem", marginBottom: "var(--space-md)" }}>🔌</div>
          <p style={{ fontSize: "1.1rem", fontWeight: 500 }}>PgBouncer not configured</p>
          <p style={{ fontSize: "0.85rem", marginTop: "var(--space-sm)", maxWidth: 400, margin: "var(--space-sm) auto 0" }}>
            To enable pool monitoring, add a PgBouncer admin connection string to your database configuration.
          </p>
        </div>
      ) : (
        <>
          {/* Warning banner for waiting clients */}
          {totalClWaiting > 0 && (
            <div style={{
              padding: "var(--space-md) var(--space-lg)",
              background: totalClWaiting > 5 ? "var(--signal-critical-dim)" : "var(--signal-warning-dim)",
              borderRadius: "var(--radius-md)",
              border: `1px solid ${totalClWaiting > 5 ? "var(--signal-critical)" : "var(--signal-warning)"}`,
              marginBottom: "var(--space-lg)",
              display: "flex", alignItems: "center", gap: "var(--space-sm)",
              color: totalClWaiting > 5 ? "var(--signal-critical)" : "var(--signal-warning)",
              fontWeight: 500, fontSize: "0.9rem",
            }}>
              {totalClWaiting > 5 ? "🔴" : "🟡"} {totalClWaiting} client(s) waiting for server connections — pool may be exhausted
            </div>
          )}

          {/* Summary Cards */}
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: "var(--space-md)", marginBottom: "var(--space-xl)",
          }}>
            <div className="glass-card-static" style={{ padding: "var(--space-lg)", textAlign: "center" }}>
              <div style={{ fontSize: "2rem", fontWeight: 700, color: "var(--signal-healthy)" }}>
                {totalClActive}
              </div>
              <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>Clients Active</div>
            </div>
            <div className="glass-card-static" style={{ padding: "var(--space-lg)", textAlign: "center" }}>
              <div style={{ fontSize: "2rem", fontWeight: 700, color: totalClWaiting > 0 ? "var(--signal-critical)" : "var(--signal-healthy)" }}>
                {totalClWaiting}
              </div>
              <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>Clients Waiting</div>
            </div>
            <div className="glass-card-static" style={{ padding: "var(--space-lg)", textAlign: "center" }}>
              <div style={{ fontSize: "2rem", fontWeight: 700, color: "var(--brand)" }}>
                {totalSvActive}
              </div>
              <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>Servers Active</div>
            </div>
            <div className="glass-card-static" style={{ padding: "var(--space-lg)", textAlign: "center" }}>
              <div style={{ fontSize: "2rem", fontWeight: 700, color: "var(--text-primary)" }}>
                {totalSvIdle}
              </div>
              <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>Servers Idle</div>
            </div>
          </div>

          {/* Pool Details Table */}
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "var(--space-md)" }}>
            Pool Details ({sortedPools.length})
          </h2>
          <div className="glass-card-static" style={{ padding: 0, overflow: "hidden", marginBottom: "var(--space-xl)" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--border)", textAlign: "left" }}>
                    <PoolSortHeader label="Pool" k="poolName" />
                    <PoolSortHeader label="CL Active" k="clActive" align="right" style={{ padding: "var(--space-md)", width: 110 }} />
                    <PoolSortHeader label="CL Waiting" k="clWaiting" align="right" style={{ padding: "var(--space-md)", width: 120 }} />
                    <PoolSortHeader label="SV Active" k="svActive" align="right" style={{ padding: "var(--space-md)", width: 110 }} />
                    <PoolSortHeader label="SV Idle" k="svIdle" align="right" style={{ padding: "var(--space-md)", width: 100 }} />
                    <PoolSortHeader label="Avg Wait" k="avgWaitTimeMs" align="right" style={{ width: 120 }} />
                  </tr>
                </thead>
                <tbody>
                  {sortedPools.map((p, i) => (
                    <tr key={`${p.poolName}-${i}`} style={{
                      borderBottom: "1px solid var(--border)",
                      background: i % 2 === 0 ? "transparent" : "var(--surface-alt)",
                    }}>
                      <td style={{ padding: "var(--space-md) var(--space-lg)", fontWeight: 500 }}>
                        {p.poolName}
                      </td>
                      <td style={{ padding: "var(--space-md)", textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--signal-healthy)" }}>
                        {p.clActive}
                      </td>
                      <td style={{ padding: "var(--space-md)", textAlign: "right", fontFamily: "var(--font-mono)", color: p.clWaiting > 0 ? "var(--signal-critical)" : "var(--text-primary)", fontWeight: p.clWaiting > 0 ? 700 : 400 }}>
                        {p.clWaiting}
                      </td>
                      <td style={{ padding: "var(--space-md)", textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--brand)" }}>
                        {p.svActive}
                      </td>
                      <td style={{ padding: "var(--space-md)", textAlign: "right", fontFamily: "var(--font-mono)" }}>
                        {p.svIdle}
                      </td>
                      <td style={{ padding: "var(--space-md) var(--space-lg)", textAlign: "right", fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}>
                        {formatMs(p.avgWaitTimeMs)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
