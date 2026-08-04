"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getDatabase, getPoolerStats, getPoolerHistory } from "../../../lib/api";
import type { Database, PoolerSnapshot } from "../../../lib/api";

/* ===================================================================
   PgBouncer Pool Dashboard — Phase 9
   Real-time pool metrics and 24h history
   =================================================================== */

function formatMs(val: number | null): string {
  if (val === null || val === undefined) return "—";
  if (val < 1) return `${(val * 1000).toFixed(0)}µs`;
  if (val < 1000) return `${val.toFixed(1)}ms`;
  return `${(val / 1000).toFixed(2)}s`;
}

export default function PoolerPage() {
  const params = useParams();
  const id = params.id as string;

  const [database, setDatabase] = useState<Database | null>(null);
  const [pools, setPools] = useState<PoolerSnapshot[]>([]);
  const [history, setHistory] = useState<PoolerSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [noPgBouncer, setNoPgBouncer] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [db, poolData, histData] = await Promise.all([
        getDatabase(id),
        getPoolerStats(id),
        getPoolerHistory(id),
      ]);
      setDatabase(db);
      setPools(poolData.pools);
      setHistory(histData.history);
      if (poolData.pools.length === 0) setNoPgBouncer(true);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    const interval = setInterval(fetchData, 10_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const totalClActive = pools.reduce((s, p) => s + p.clActive, 0);
  const totalClWaiting = pools.reduce((s, p) => s + p.clWaiting, 0);
  const totalSvActive = pools.reduce((s, p) => s + p.svActive, 0);
  const totalSvIdle = pools.reduce((s, p) => s + p.svIdle, 0);

  // Build simple sparkline from history
  const sparklineData = history.reduce<{ time: string; clActive: number; clWaiting: number }[]>((acc, h) => {
    const key = new Date(h.capturedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
    const existing = acc.find((x) => x.time === key);
    if (existing) {
      existing.clActive += h.clActive;
      existing.clWaiting += h.clWaiting;
    } else {
      acc.push({ time: key, clActive: h.clActive, clWaiting: h.clWaiting });
    }
    return acc;
  }, []);

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
              <div style={{ fontSize: "2rem", fontWeight: 700, color: "var(--text-secondary)" }}>
                {totalSvIdle}
              </div>
              <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>Servers Idle</div>
            </div>
          </div>

          {/* Pool Details Table */}
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "var(--space-md)" }}>
            Pool Details
          </h2>
          <div className="glass-card-static" style={{ padding: 0, overflow: "hidden", marginBottom: "var(--space-xl)" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--border)", textAlign: "left" }}>
                    <th style={{ padding: "var(--space-md) var(--space-lg)", color: "var(--text-muted)", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase" }}>Pool</th>
                    <th style={{ padding: "var(--space-md)", color: "var(--text-muted)", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase", textAlign: "right" }}>CL Active</th>
                    <th style={{ padding: "var(--space-md)", color: "var(--text-muted)", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase", textAlign: "right" }}>CL Waiting</th>
                    <th style={{ padding: "var(--space-md)", color: "var(--text-muted)", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase", textAlign: "right" }}>SV Active</th>
                    <th style={{ padding: "var(--space-md)", color: "var(--text-muted)", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase", textAlign: "right" }}>SV Idle</th>
                    <th style={{ padding: "var(--space-md) var(--space-lg)", color: "var(--text-muted)", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase", textAlign: "right" }}>Avg Wait</th>
                  </tr>
                </thead>
                <tbody>
                  {pools.map((p, i) => (
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

          {/* Simple History Chart */}
          {sparklineData.length > 1 && (
            <>
              <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "var(--space-md)" }}>
                24h Connection History
              </h2>
              <div className="glass-card-static" style={{ padding: "var(--space-lg)" }}>
                <svg viewBox={`0 0 ${sparklineData.length * 12} 100`} style={{ width: "100%", height: 120 }}>
                  {(() => {
                    const maxVal = Math.max(...sparklineData.map((d) => d.clActive + d.clWaiting), 1);
                    return sparklineData.map((d, i) => {
                      const x = i * 12 + 2;
                      const barWidth = 8;
                      const activeH = (d.clActive / maxVal) * 80;
                      const waitH = (d.clWaiting / maxVal) * 80;
                      return (
                        <g key={i}>
                          <rect
                            x={x} y={90 - activeH - waitH}
                            width={barWidth} height={waitH}
                            fill="var(--signal-critical)" rx={1} opacity={0.8}
                          />
                          <rect
                            x={x} y={90 - activeH}
                            width={barWidth} height={activeH}
                            fill="var(--signal-healthy)" rx={1} opacity={0.7}
                          />
                        </g>
                      );
                    });
                  })()}
                </svg>
                <div style={{ display: "flex", justifyContent: "center", gap: "var(--space-lg)", marginTop: "var(--space-sm)", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  <span><span style={{ display: "inline-block", width: 10, height: 10, background: "var(--signal-healthy)", borderRadius: 2, marginRight: 4 }} />Active</span>
                  <span><span style={{ display: "inline-block", width: 10, height: 10, background: "var(--signal-critical)", borderRadius: 2, marginRight: 4 }} />Waiting</span>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
