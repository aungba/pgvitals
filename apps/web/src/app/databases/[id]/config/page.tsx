"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import {
  getGucAdvice,
  type GucAdviceResponse,
  type GucRecommendation,
} from "../../../lib/api";
import { useApiToken } from "../../../lib/useApiToken";

export default function GucAdvisorPage() {
  const params = useParams();
  const dbId = params.id as string;
  const { getToken } = useApiToken();

  // Hardware Profile States
  const [totalRamGb, setTotalRamGb] = useState<number>(8);
  const [cpuCores, setCpuCores] = useState<number>(4);
  const [diskType, setDiskType] = useState<"ssd" | "hdd" | "san">("ssd");
  const [workloadType, setWorkloadType] = useState<"web" | "oltp" | "dw" | "mixed" | "desktop">("web");
  const [maxConnections, setMaxConnections] = useState<number>(100);

  // Data & UI States
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<GucAdviceResponse | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [copiedAction, setCopiedAction] = useState<string | null>(null);
  const [showRawConf, setShowRawConf] = useState(false);

  const fetchAdvice = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await getGucAdvice(
        dbId,
        {
          totalRamGb,
          cpuCores,
          diskType,
          workloadType,
          maxConnections,
        },
        token
      );
      setData(res);
    } catch (err: any) {
      setError(err.message || "Failed to load GUC configuration advice");
    } finally {
      setLoading(false);
    }
  }, [dbId, totalRamGb, cpuCores, diskType, workloadType, maxConnections, getToken]);

  useEffect(() => {
    fetchAdvice();
  }, [fetchAdvice]);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedAction(label);
    setTimeout(() => setCopiedAction(null), 2500);
  };

  const filteredRecommendations = useMemo(() => {
    if (!data?.report?.recommendations) return [];
    return data.report.recommendations.filter((r) => {
      const matchesCategory = activeCategory === "all" || r.category === activeCategory;
      const matchesStatus =
        statusFilter === "all"
          ? true
          : statusFilter === "action_needed"
          ? r.status !== "optimal"
          : r.status === statusFilter;
      return matchesCategory && matchesStatus;
    });
  }, [data, activeCategory, statusFilter]);

  const summary = data?.report?.summary;

  return (
    <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "24px 16px" }}>
      {/* Page Title & Overview */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: "24px",
          flexWrap: "wrap",
          gap: "16px",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: "24px",
              fontWeight: 800,
              color: "var(--text-primary)",
              margin: 0,
              display: "flex",
              alignItems: "center",
              gap: "10px",
            }}
          >
            ⚙️ PostgreSQL Configuration Advisor (PGTune)
          </h1>
          <p
            style={{
              margin: "6px 0 0",
              fontSize: "14px",
              color: "var(--text-secondary)",
              maxWidth: "750px",
            }}
          >
            Compares live <code style={{ fontFamily: "var(--font-mono)" }}>pg_settings</code> against host hardware capacity, detects unoptimized engine defaults, and generates safe <code style={{ fontFamily: "var(--font-mono)" }}>ALTER SYSTEM</code> scripts.
          </p>
        </div>

        <div style={{ display: "flex", gap: "10px" }}>
          <button
            onClick={() => data?.report && copyToClipboard(data.report.alterSystemSql, "alter")}
            disabled={!data?.report}
            style={{
              padding: "10px 16px",
              borderRadius: "8px",
              backgroundColor: "var(--brand)",
              color: "#fff",
              border: "none",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              boxShadow: "var(--shadow-sm)",
            }}
          >
            {copiedAction === "alter" ? "✓ Copied ALTER SYSTEM!" : "📋 Copy ALTER SYSTEM SQL"}
          </button>
          <button
            onClick={() => setShowRawConf(!showRawConf)}
            style={{
              padding: "10px 16px",
              borderRadius: "8px",
              backgroundColor: "var(--surface)",
              color: "var(--text-primary)",
              border: "1px solid var(--border)",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {showRawConf ? "Hide postgresql.conf" : "📄 View postgresql.conf"}
          </button>
        </div>
      </div>

      {/* Raw postgresql.conf snippet drawer */}
      {showRawConf && data?.report && (
        <div
          style={{
            marginBottom: "24px",
            padding: "20px",
            borderRadius: "12px",
            backgroundColor: "var(--surface)",
            border: "1px solid var(--border)",
            boxShadow: "var(--shadow-md)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "12px",
            }}
          >
            <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-primary)" }}>
              Generated postgresql.conf Configuration Block
            </span>
            <button
              onClick={() => copyToClipboard(data.report.postgresqlConfSnippet, "conf")}
              style={{
                padding: "6px 12px",
                borderRadius: "6px",
                backgroundColor: "var(--brand-dim)",
                color: "var(--brand)",
                border: "1px solid var(--border)",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {copiedAction === "conf" ? "✓ Copied Conf!" : "📋 Copy to Clipboard"}
            </button>
          </div>
          <pre
            style={{
              margin: 0,
              padding: "16px",
              borderRadius: "8px",
              backgroundColor: "var(--surface-alt)",
              border: "1px solid var(--border)",
              fontFamily: "var(--font-mono)",
              fontSize: "12px",
              lineHeight: "1.6",
              overflowX: "auto",
              color: "var(--text-primary)",
            }}
          >
            {data.report.postgresqlConfSnippet}
          </pre>
        </div>
      )}

      {/* Hardware Profile Tuner Bar */}
      <div
        style={{
          padding: "20px",
          borderRadius: "14px",
          backgroundColor: "var(--surface)",
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow-sm)",
          marginBottom: "24px",
        }}
      >
        <div
          style={{
            fontSize: "13px",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            color: "var(--text-secondary)",
            marginBottom: "16px",
          }}
        >
          Target Server Hardware Profile & Workload Specification
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
            gap: "16px",
          }}
        >
          {/* RAM */}
          <div>
            <label
              style={{
                display: "block",
                fontSize: "12px",
                fontWeight: 600,
                color: "var(--text-secondary)",
                marginBottom: "6px",
              }}
            >
              Total Host RAM:
            </label>
            <select
              value={totalRamGb}
              onChange={(e) => setTotalRamGb(Number(e.target.value))}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: "8px",
                border: "1px solid var(--border)",
                backgroundColor: "var(--surface-alt)",
                color: "var(--text-primary)",
                fontSize: "13px",
                fontWeight: 600,
              }}
            >
              <option value={1}>1 GB (Micro / Hobby)</option>
              <option value={2}>2 GB (Small)</option>
              <option value={4}>4 GB (Medium)</option>
              <option value={8}>8 GB (Production 8G)</option>
              <option value={16}>16 GB (Production 16G)</option>
              <option value={32}>32 GB (High Memory 32G)</option>
              <option value={64}>64 GB (Enterprise 64G)</option>
              <option value={128}>128 GB (Extreme 128G)</option>
            </select>
          </div>

          {/* CPU Cores */}
          <div>
            <label
              style={{
                display: "block",
                fontSize: "12px",
                fontWeight: 600,
                color: "var(--text-secondary)",
                marginBottom: "6px",
              }}
            >
              CPU Cores:
            </label>
            <select
              value={cpuCores}
              onChange={(e) => setCpuCores(Number(e.target.value))}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: "8px",
                border: "1px solid var(--border)",
                backgroundColor: "var(--surface-alt)",
                color: "var(--text-primary)",
                fontSize: "13px",
                fontWeight: 600,
              }}
            >
              <option value={1}>1 vCPU</option>
              <option value={2}>2 vCPUs</option>
              <option value={4}>4 vCPUs</option>
              <option value={8}>8 vCPUs</option>
              <option value={16}>16 vCPUs</option>
              <option value={32}>32 vCPUs</option>
              <option value={64}>64 vCPUs</option>
            </select>
          </div>

          {/* Disk Type */}
          <div>
            <label
              style={{
                display: "block",
                fontSize: "12px",
                fontWeight: 600,
                color: "var(--text-secondary)",
                marginBottom: "6px",
              }}
            >
              Storage Subsystem:
            </label>
            <select
              value={diskType}
              onChange={(e) => setDiskType(e.target.value as any)}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: "8px",
                border: "1px solid var(--border)",
                backgroundColor: "var(--surface-alt)",
                color: "var(--text-primary)",
                fontSize: "13px",
                fontWeight: 600,
              }}
            >
              <option value="ssd">SSD / NVMe / EBS gp3</option>
              <option value="san">SAN / Network Attached Storage</option>
              <option value="hdd">Spinning HDD</option>
            </select>
          </div>

          {/* Workload Profile */}
          <div>
            <label
              style={{
                display: "block",
                fontSize: "12px",
                fontWeight: 600,
                color: "var(--text-secondary)",
                marginBottom: "6px",
              }}
            >
              Workload Profile:
            </label>
            <select
              value={workloadType}
              onChange={(e) => setWorkloadType(e.target.value as any)}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: "8px",
                border: "1px solid var(--border)",
                backgroundColor: "var(--surface-alt)",
                color: "var(--text-primary)",
                fontSize: "13px",
                fontWeight: 600,
              }}
            >
              <option value="web">Web Application (High Concurrency OLTP)</option>
              <option value="oltp">OLTP (Intensive Transactions)</option>
              <option value="dw">Data Warehouse / Analytics (OLAP)</option>
              <option value="mixed">Mixed Workload</option>
              <option value="desktop">Local Dev / Desktop</option>
            </select>
          </div>

          {/* Max Connections */}
          <div>
            <label
              style={{
                display: "block",
                fontSize: "12px",
                fontWeight: 600,
                color: "var(--text-secondary)",
                marginBottom: "6px",
              }}
            >
              Max Connections:
            </label>
            <input
              type="number"
              value={maxConnections}
              onChange={(e) => setMaxConnections(Math.max(10, Number(e.target.value)))}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: "8px",
                border: "1px solid var(--border)",
                backgroundColor: "var(--surface-alt)",
                color: "var(--text-primary)",
                fontSize: "13px",
                fontWeight: 600,
              }}
            />
          </div>
        </div>
      </div>

      {/* Summary Scorecards */}
      {summary && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "16px",
            marginBottom: "24px",
          }}
        >
          <div
            style={{
              padding: "16px",
              borderRadius: "12px",
              backgroundColor: "var(--surface)",
              border: "1px solid var(--border)",
            }}
          >
            <div style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: 600 }}>
              Parameters Evaluated
            </div>
            <div style={{ fontSize: "24px", fontWeight: 800, color: "var(--text-primary)", marginTop: "4px" }}>
              {summary.totalEvaluated}
            </div>
          </div>

          <div
            style={{
              padding: "16px",
              borderRadius: "12px",
              backgroundColor: "var(--surface)",
              border: "1px solid var(--border)",
            }}
          >
            <div style={{ fontSize: "12px", color: "var(--signal-healthy)", fontWeight: 600 }}>
              ✓ Optimal Configuration
            </div>
            <div style={{ fontSize: "24px", fontWeight: 800, color: "var(--signal-healthy)", marginTop: "4px" }}>
              {summary.optimalCount}
            </div>
          </div>

          <div
            style={{
              padding: "16px",
              borderRadius: "12px",
              backgroundColor: "var(--surface)",
              border: "1px solid var(--border)",
            }}
          >
            <div style={{ fontSize: "12px", color: "var(--signal-warning)", fontWeight: 600 }}>
              ⚠ Sub-optimal / Warnings
            </div>
            <div style={{ fontSize: "24px", fontWeight: 800, color: "var(--signal-warning)", marginTop: "4px" }}>
              {summary.warningCount}
            </div>
          </div>

          <div
            style={{
              padding: "16px",
              borderRadius: "12px",
              backgroundColor: "var(--surface)",
              border: "1px solid var(--border)",
            }}
          >
            <div style={{ fontSize: "12px", color: "var(--signal-critical)", fontWeight: 600 }}>
              🚨 Critical Defaults
            </div>
            <div style={{ fontSize: "24px", fontWeight: 800, color: "var(--signal-critical)", marginTop: "4px" }}>
              {summary.criticalCount}
            </div>
          </div>

          <div
            style={{
              padding: "16px",
              borderRadius: "12px",
              backgroundColor: "var(--surface)",
              border: "1px solid var(--border)",
            }}
          >
            <div style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: 600 }}>
              🔄 Require Restart
            </div>
            <div style={{ fontSize: "24px", fontWeight: 800, color: "var(--text-primary)", marginTop: "4px" }}>
              {summary.restartRequiredCount}
            </div>
          </div>
        </div>
      )}

      {/* Filter & Category Bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "12px",
          marginBottom: "16px",
        }}
      >
        {/* Category Tabs */}
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {[
            { id: "all", label: "All Categories" },
            { id: "memory", label: "🧠 Memory" },
            { id: "wal", label: "💾 WAL & Checkpoints" },
            { id: "storage", label: "⚡ Storage & Cost" },
            { id: "parallelism", label: "⚙️ Parallelism" },
            { id: "diagnostics", label: "🛡️ Diagnostics" },
          ].map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveCategory(c.id)}
              style={{
                padding: "6px 14px",
                borderRadius: "20px",
                border: "1px solid var(--border)",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
                backgroundColor: activeCategory === c.id ? "var(--brand)" : "var(--surface)",
                color: activeCategory === c.id ? "#fff" : "var(--text-secondary)",
              }}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Status Filter */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: 600 }}>
            Filter Status:
          </span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{
              padding: "6px 10px",
              borderRadius: "8px",
              border: "1px solid var(--border)",
              backgroundColor: "var(--surface)",
              color: "var(--text-primary)",
              fontSize: "12px",
              fontWeight: 600,
            }}
          >
            <option value="all">Show All</option>
            <option value="action_needed">Action Needed (Warnings & Critical)</option>
            <option value="critical">Critical Only</option>
            <option value="warning">Warnings Only</option>
            <option value="optimal">Optimal Only</option>
          </select>
        </div>
      </div>

      {/* Main Parameters Table */}
      <div
        style={{
          borderRadius: "14px",
          backgroundColor: "var(--surface)",
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow-sm)",
          overflow: "hidden",
        }}
      >
        {loading ? (
          <div style={{ padding: "60px 0", textAlign: "center", color: "var(--text-secondary)" }}>
            Loading live pg_settings & calculating optimal configuration...
          </div>
        ) : error ? (
          <div
            style={{
              padding: "24px",
              backgroundColor: "var(--signal-critical-dim)",
              color: "var(--signal-critical)",
            }}
          >
            Error loading settings: {error}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
              <thead>
                <tr
                  style={{
                    backgroundColor: "var(--surface-alt)",
                    borderBottom: "1px solid var(--border)",
                    fontSize: "12px",
                    fontWeight: 700,
                    color: "var(--text-secondary)",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                  }}
                >
                  <th style={{ padding: "14px 16px" }}>Parameter</th>
                  <th style={{ padding: "14px 16px" }}>Current Live Value</th>
                  <th style={{ padding: "14px 16px" }}>Recommended Target</th>
                  <th style={{ padding: "14px 16px" }}>Status</th>
                  <th style={{ padding: "14px 16px" }}>Apply Method</th>
                  <th style={{ padding: "14px 16px" }}>Optimization Rationale</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecommendations.map((rec) => {
                  const isCritical = rec.status === "critical";
                  const isWarning = rec.status === "warning";
                  const isOptimal = rec.status === "optimal";

                  return (
                    <tr
                      key={rec.name}
                      style={{
                        borderBottom: "1px solid var(--border)",
                        fontSize: "13px",
                        backgroundColor: isCritical
                          ? "rgba(239, 68, 68, 0.04)"
                          : isWarning
                          ? "rgba(245, 158, 11, 0.03)"
                          : "transparent",
                      }}
                    >
                      <td style={{ padding: "14px 16px", fontWeight: 700 }}>
                        <code style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
                          {rec.name}
                        </code>
                        <span
                          style={{
                            display: "block",
                            fontSize: "11px",
                            fontWeight: 500,
                            color: "var(--text-secondary)",
                            marginTop: "2px",
                          }}
                        >
                          {rec.category}
                        </span>
                      </td>
                      <td style={{ padding: "14px 16px", fontFamily: "var(--font-mono)" }}>
                        <span
                          style={{
                            color: isCritical
                              ? "var(--signal-critical)"
                              : isWarning
                              ? "var(--signal-warning)"
                              : "var(--text-primary)",
                            fontWeight: isCritical || isWarning ? 700 : 500,
                          }}
                        >
                          {rec.currentValueFormatted}
                        </span>
                      </td>
                      <td style={{ padding: "14px 16px", fontFamily: "var(--font-mono)" }}>
                        <span style={{ color: "var(--signal-healthy)", fontWeight: 700 }}>
                          {rec.recommendedValueFormatted}
                        </span>
                      </td>
                      <td style={{ padding: "14px 16px" }}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "3px 10px",
                            borderRadius: "999px",
                            fontSize: "11px",
                            fontWeight: 700,
                            textTransform: "uppercase",
                            backgroundColor: isCritical
                              ? "var(--signal-critical-dim)"
                              : isWarning
                              ? "var(--signal-warning-dim)"
                              : isOptimal
                              ? "var(--signal-healthy-dim)"
                              : "var(--surface-alt)",
                            color: isCritical
                              ? "var(--signal-critical)"
                              : isWarning
                              ? "var(--signal-warning)"
                              : isOptimal
                              ? "var(--signal-healthy)"
                              : "var(--text-secondary)",
                          }}
                        >
                          {rec.status}
                        </span>
                      </td>
                      <td style={{ padding: "14px 16px" }}>
                        {rec.restartRequired ? (
                          <span
                            style={{
                              fontSize: "11px",
                              padding: "3px 8px",
                              borderRadius: "6px",
                              backgroundColor: "rgba(239, 68, 68, 0.1)",
                              color: "var(--signal-critical)",
                              fontWeight: 600,
                            }}
                          >
                            🔄 Restart Required
                          </span>
                        ) : (
                          <span
                            style={{
                              fontSize: "11px",
                              padding: "3px 8px",
                              borderRadius: "6px",
                              backgroundColor: "rgba(16, 185, 129, 0.1)",
                              color: "var(--signal-healthy)",
                              fontWeight: 600,
                            }}
                          >
                            ⚡ Live Reload (pg_reload_conf)
                          </span>
                        )}
                      </td>
                      <td
                        style={{
                          padding: "14px 16px",
                          color: "var(--text-secondary)",
                          fontSize: "12px",
                          lineHeight: "1.4",
                          maxWidth: "380px",
                        }}
                      >
                        {rec.reason}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
