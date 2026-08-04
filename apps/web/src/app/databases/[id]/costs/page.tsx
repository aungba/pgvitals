"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getDatabase, getQueryCostEstimates } from "../../../lib/api";
import type { Database, QueryCostEstimate } from "../../../lib/api";

/* ===================================================================
   Cost Estimator Page — Phase 10
   Estimated monthly cost per query based on IO + CPU metrics
   =================================================================== */

function formatUsd(val: number): string {
  if (val < 0.01 && val > 0) return "<$0.01";
  return `$${val.toFixed(2)}`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function truncateQuery(q: string, max: number = 80): string {
  if (q.length <= max) return q;
  return q.slice(0, max) + "…";
}

export default function CostEstimatorPage() {
  const params = useParams();
  const id = params.id as string;

  const [database, setDatabase] = useState<Database | null>(null);
  const [estimates, setEstimates] = useState<QueryCostEstimate[]>([]);
  const [disclaimer, setDisclaimer] = useState("");
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<"total" | "io" | "cpu">("total");

  const fetchData = useCallback(async () => {
    try {
      const [db, data] = await Promise.all([
        getDatabase(id),
        getQueryCostEstimates(id),
      ]);
      setDatabase(db);
      setEstimates(data.estimates);
      setDisclaimer(data.disclaimer);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const sorted = [...estimates].sort((a, b) => {
    if (sortBy === "io") return b.estimatedIoCostPerMonth - a.estimatedIoCostPerMonth;
    if (sortBy === "cpu") return b.estimatedCpuCostPerMonth - a.estimatedCpuCostPerMonth;
    return b.estimatedTotalCostPerMonth - a.estimatedTotalCostPerMonth;
  });

  const totalMonthlyCost = estimates.reduce((s, e) => s + e.estimatedTotalCostPerMonth, 0);
  const totalIoCost = estimates.reduce((s, e) => s + e.estimatedIoCostPerMonth, 0);
  const totalCpuCost = estimates.reduce((s, e) => s + e.estimatedCpuCostPerMonth, 0);

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
            <h1>Cost Estimator — {database?.name}</h1>
            <p className="text-secondary" style={{ fontSize: "0.9rem" }}>
              Estimated monthly database cost per query
            </p>
          </div>
        </div>
      </div>

      {/* Disclaimer */}
      {disclaimer && (
        <div style={{
          padding: "var(--space-md) var(--space-lg)",
          background: "var(--surface-alt)", borderRadius: "var(--radius-md)",
          border: "1px solid var(--border)", marginBottom: "var(--space-lg)",
          fontSize: "0.8rem", color: "var(--text-muted)",
          display: "flex", alignItems: "center", gap: "var(--space-sm)",
        }}>
          <span style={{ fontSize: "1rem" }}>ℹ️</span>
          {disclaimer}
        </div>
      )}

      {/* Summary Cards */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: "var(--space-md)", marginBottom: "var(--space-xl)",
      }}>
        <div className="glass-card-static" style={{ padding: "var(--space-lg)", textAlign: "center" }}>
          <div style={{ fontSize: "2rem", fontWeight: 700, color: "var(--brand)" }}>
            {formatUsd(totalMonthlyCost)}
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>Total Est./Month</div>
        </div>
        <div className="glass-card-static" style={{ padding: "var(--space-lg)", textAlign: "center" }}>
          <div style={{ fontSize: "2rem", fontWeight: 700, color: "var(--signal-warning)" }}>
            {formatUsd(totalIoCost)}
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>I/O Cost</div>
        </div>
        <div className="glass-card-static" style={{ padding: "var(--space-lg)", textAlign: "center" }}>
          <div style={{ fontSize: "2rem", fontWeight: 700, color: "var(--signal-idle)" }}>
            {formatUsd(totalCpuCost)}
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>CPU Cost</div>
        </div>
        <div className="glass-card-static" style={{ padding: "var(--space-lg)", textAlign: "center" }}>
          <div style={{ fontSize: "2rem", fontWeight: 700, color: "var(--text-primary)" }}>
            {estimates.length}
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>Queries Analyzed</div>
        </div>
      </div>

      {/* Sort */}
      <div style={{ display: "flex", gap: "var(--space-sm)", marginBottom: "var(--space-lg)" }}>
        {[
          { key: "total" as const, label: "Total Cost" },
          { key: "io" as const, label: "I/O Cost" },
          { key: "cpu" as const, label: "CPU Cost" },
        ].map((opt) => (
          <button
            key={opt.key}
            onClick={() => setSortBy(opt.key)}
            className={sortBy === opt.key ? "btn-primary" : "btn-secondary"}
            style={{ padding: "6px 14px", fontSize: "0.8rem", borderRadius: "var(--radius-md)" }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Table */}
      {sorted.length === 0 ? (
        <div className="glass-card-static" style={{
          padding: "var(--space-2xl)", textAlign: "center", color: "var(--text-muted)",
        }}>
          <div style={{ fontSize: "2.5rem", marginBottom: "var(--space-md)" }}>💰</div>
          <p style={{ fontSize: "1.1rem", fontWeight: 500 }}>No cost data available</p>
          <p style={{ fontSize: "0.85rem", marginTop: "var(--space-sm)" }}>
            Cost estimates will appear once query stats are collected
          </p>
        </div>
      ) : (
        <div className="glass-card-static" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid var(--border)", textAlign: "left" }}>
                  <th style={{ padding: "var(--space-md) var(--space-lg)", color: "var(--text-muted)", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase" }}>Query</th>
                  <th style={{ padding: "var(--space-md)", color: "var(--text-muted)", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase", textAlign: "right" }}>Calls</th>
                  <th style={{ padding: "var(--space-md)", color: "var(--text-muted)", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase", textAlign: "right" }}>I/O</th>
                  <th style={{ padding: "var(--space-md)", color: "var(--text-muted)", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase", textAlign: "right" }}>CPU</th>
                  <th style={{ padding: "var(--space-md) var(--space-lg)", color: "var(--text-muted)", fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase", textAlign: "right" }}>Total/Month</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((q, i) => {
                  const pct = totalMonthlyCost > 0
                    ? (q.estimatedTotalCostPerMonth / totalMonthlyCost) * 100
                    : 0;
                  return (
                    <tr key={q.queryid} style={{
                      borderBottom: "1px solid var(--border)",
                      background: i % 2 === 0 ? "transparent" : "var(--surface-alt)",
                    }}>
                      <td style={{ padding: "var(--space-md) var(--space-lg)", maxWidth: 400 }}>
                        <code style={{
                          fontSize: "0.8rem", fontFamily: "var(--font-mono)",
                          color: "var(--text-primary)", wordBreak: "break-all",
                        }}>
                          {truncateQuery(q.queryText)}
                        </code>
                        {/* Cost bar */}
                        <div style={{
                          marginTop: 4, height: 3, borderRadius: 2,
                          background: "var(--surface-alt)", overflow: "hidden",
                        }}>
                          <div style={{
                            height: "100%", borderRadius: 2,
                            width: `${Math.min(pct, 100)}%`,
                            background: pct > 50 ? "var(--signal-critical)" : pct > 20 ? "var(--signal-warning)" : "var(--brand)",
                            transition: "width 0.3s ease",
                          }} />
                        </div>
                      </td>
                      <td style={{ padding: "var(--space-md)", textAlign: "right", fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}>
                        {formatNumber(q.calls)}
                      </td>
                      <td style={{ padding: "var(--space-md)", textAlign: "right", fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--signal-warning)" }}>
                        {formatUsd(q.estimatedIoCostPerMonth)}
                      </td>
                      <td style={{ padding: "var(--space-md)", textAlign: "right", fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--signal-idle)" }}>
                        {formatUsd(q.estimatedCpuCostPerMonth)}
                      </td>
                      <td style={{ padding: "var(--space-md) var(--space-lg)", textAlign: "right", fontWeight: 600, fontFamily: "var(--font-mono)", fontSize: "0.85rem" }}>
                        {formatUsd(q.estimatedTotalCostPerMonth)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
