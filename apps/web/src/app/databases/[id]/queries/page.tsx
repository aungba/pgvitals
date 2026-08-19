"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import {
  getDatabase,
  getQueries,
  getQueryDetail,
  getQueryStatsStatus,
  captureExplainPlan,
  getExplainCaptures,
  getQuerySuggestions,
  dismissQuerySuggestion,
  simulateIndex,
} from "../../../lib/api";
import type {
  Database,
  QueryStat,
  ExplainCapture,
  QuerySuggestion,
  IndexSimulationResult,
} from "../../../lib/api";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { useChartColors } from "../../../lib/useChartColors";
import { analyzeSqlAdvice } from "../../../lib/sqlAdvisor";
import Link from "next/link";

/* ===================================================================
   Query Performance Page — Enhanced UI Design & Diagnostics Suite
   =================================================================== */

type SortBy = "total_time" | "calls" | "mean_time" | "rows" | "temp_blks";
type TableSortKey = "queryText" | "calls" | "totalTimeMs" | "meanTimeMs" | "pctOfTotalTime" | "rowsReturned" | "rowsPerCall";
type QueryFilterType = "all" | "select" | "dml" | "slow" | "high_impact" | "regressing";
type ChartMetric = "mean_time" | "calls";

function formatMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatHours(ms: number): string {
  const hours = ms / (1000 * 60 * 60);
  if (hours >= 1) return `${hours.toFixed(1)}h`;
  const mins = ms / (1000 * 60);
  if (mins >= 1) return `${mins.toFixed(1)}m`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function truncateQuery(q: string, len = 75): string {
  return q.length > len ? q.slice(0, len) + "…" : q;
}

function extractTableName(sql: string): string | null {
  const match = sql.match(/\b(?:FROM|JOIN|UPDATE|INTO)\s+([a-zA-Z0-9_."]+)/i);
  if (!match) return null;
  let name = match[1].replace(/["']/g, "");
  if (name.includes(".")) {
    name = name.split(".").pop() || name;
  }
  return name.length > 1 ? name : null;
}

function formatSqlCode(sql: string): string {
  const majorKeywords = [
    "SELECT",
    "FROM",
    "WHERE",
    "GROUP BY",
    "HAVING",
    "ORDER BY",
    "LIMIT",
    "OFFSET",
    "LEFT JOIN",
    "RIGHT JOIN",
    "INNER JOIN",
    "CROSS JOIN",
    "JOIN",
    "UPDATE",
    "SET",
    "INSERT INTO",
    "VALUES",
    "DELETE FROM",
  ];
  let formatted = sql.trim();
  majorKeywords.forEach((kw) => {
    const regex = new RegExp(`\\b${kw}\\b`, "gi");
    formatted = formatted.replace(regex, `\n${kw}`);
  });
  return formatted.trim();
}

export default function QueriesPage() {
  const params = useParams();
  const id = params.id as string;
  const colors = useChartColors();

  const [database, setDatabase] = useState<Database | null>(null);
  const [queries, setQueries] = useState<QueryStat[]>([]);
  const [sortBy, setSortBy] = useState<SortBy>("total_time");
  const [loading, setLoading] = useState(true);
  const [extensionAvailable, setExtensionAvailable] = useState<boolean | null>(null);
  const [latestCapturedAt, setLatestCapturedAt] = useState<string | null>(null);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<QueryFilterType>("all");

  // Column-level interactive sorting
  const [tableSortKey, setTableSortKey] = useState<TableSortKey>("pctOfTotalTime");
  const [tableSortDir, setTableSortDir] = useState<"asc" | "desc">("desc");

  // Detail panel state
  const [selectedQuery, setSelectedQuery] = useState<QueryStat | null>(null);
  const [timeSeries, setTimeSeries] = useState<QueryStat[]>([]);
  const [explains, setExplains] = useState<ExplainCapture[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [explainLoading, setExplainLoading] = useState(false);
  const [chartMetric, setChartMetric] = useState<ChartMetric>("mean_time");
  const [copiedQueryId, setCopiedQueryId] = useState<number | null>(null);
  const [isFormattedSql, setIsFormattedSql] = useState(false);

  // HypoPG Simulation State
  const [simDdl, setSimDdl] = useState("");
  const [simLoading, setSimLoading] = useState(false);
  const [simResult, setSimResult] = useState<IndexSimulationResult | null>(null);
  const [simError, setSimError] = useState<string | null>(null);
  const [showSimModal, setShowSimModal] = useState(false);

  // Suggestions state
  const [suggestions, setSuggestions] = useState<QuerySuggestion[]>([]);
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [db, status, result] = await Promise.all([
        getDatabase(id),
        getQueryStatsStatus(id),
        getQueries(id, sortBy),
      ]);
      setDatabase(db);
      setExtensionAvailable(status.available);
      setQueries(result.queries);
      setLatestCapturedAt(result.latestCapturedAt);
      try {
        const sugData = await getQuerySuggestions(id);
        setSuggestions(sugData.suggestions);
      } catch {
        // suggestions are optional
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [id, sortBy]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Load detail panel when a query is selected
  const handleSelectQuery = async (query: QueryStat) => {
    setSelectedQuery(query);
    setDetailLoading(true);
    setSimResult(null);
    setSimError(null);
    const table = extractTableName(query.queryText);
    setSimDdl(table ? `CREATE INDEX idx_${table}_opt ON ${table} ()` : "");
    try {
      const [detail, explainList] = await Promise.all([
        getQueryDetail(id, query.queryid),
        getExplainCaptures(id, query.queryid),
      ]);
      setTimeSeries(detail.timeSeries);
      setExplains(explainList.explains);
    } catch {
      // ignore
    } finally {
      setDetailLoading(false);
    }
  };

  // Run on-demand EXPLAIN
  const handleExplain = async () => {
    if (!selectedQuery) return;
    setExplainLoading(true);
    try {
      const result = await captureExplainPlan(id, selectedQuery.queryid, selectedQuery.queryText);
      setExplains((prev) => [result.explain, ...prev]);
    } catch {
      // ignore
    } finally {
      setExplainLoading(false);
    }
  };

  // Run HypoPG Simulation
  const handleRunSimulation = async () => {
    if (!selectedQuery || !simDdl.trim()) return;
    setSimLoading(true);
    setSimError(null);
    try {
      const res = await simulateIndex(id, simDdl.trim(), selectedQuery.queryText);
      setSimResult(res);
    } catch (e) {
      setSimError(e instanceof Error ? e.message : "Simulation failed. Verify HypoPG is enabled.");
    } finally {
      setSimLoading(false);
    }
  };

  // Copy SQL to clipboard
  const handleCopySql = (query: QueryStat, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    navigator.clipboard.writeText(query.queryText);
    setCopiedQueryId(query.queryid);
    setTimeout(() => setCopiedQueryId(null), 2000);
  };

  // Workload KPIs
  const totalCalls = useMemo(() => queries.reduce((s, q) => s + q.calls, 0), [queries]);
  const totalDbTimeMs = useMemo(() => queries.reduce((s, q) => s + q.totalTimeMs, 0), [queries]);
  const avgWorkloadLatency = useMemo(() => (totalCalls > 0 ? totalDbTimeMs / totalCalls : 0), [totalCalls, totalDbTimeMs]);
  const highImpactCount = useMemo(() => queries.filter((q) => q.pctOfTotalTime >= 15 || q.meanTimeMs >= 100).length, [queries]);

  // Filtered and Sorted Queries
  const filteredAndSortedQueries = useMemo(() => {
    let result = queries;

    // Filter by search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (item) =>
          item.queryText.toLowerCase().includes(q) ||
          item.queryid.toString().includes(q) ||
          (extractTableName(item.queryText) || "").toLowerCase().includes(q)
      );
    }

    // Filter by type chips
    if (filterType === "select") {
      result = result.filter((q) => /^\s*SELECT/i.test(q.queryText));
    } else if (filterType === "dml") {
      result = result.filter((q) => /^\s*(UPDATE|INSERT|DELETE)/i.test(q.queryText));
    } else if (filterType === "slow") {
      result = result.filter((q) => q.meanTimeMs >= 100);
    } else if (filterType === "high_impact") {
      result = result.filter((q) => q.pctOfTotalTime >= 15);
    } else if (filterType === "regressing") {
      result = result.filter((q) => (q.meanTimeTrend ?? 0) > 10);
    }

    // Sort
    return [...result].sort((a, b) => {
      const dir = tableSortDir === "asc" ? 1 : -1;
      switch (tableSortKey) {
        case "queryText":
          return dir * a.queryText.localeCompare(b.queryText);
        case "calls":
          return dir * (a.calls - b.calls);
        case "totalTimeMs":
          return dir * (a.totalTimeMs - b.totalTimeMs);
        case "meanTimeMs":
          return dir * (a.meanTimeMs - b.meanTimeMs);
        case "pctOfTotalTime":
          return dir * (a.pctOfTotalTime - b.pctOfTotalTime);
        case "rowsReturned":
          return dir * (a.rowsReturned - b.rowsReturned);
        case "rowsPerCall": {
          const rpcA = a.calls > 0 ? a.rowsReturned / a.calls : 0;
          const rpcB = b.calls > 0 ? b.rowsReturned / b.calls : 0;
          return dir * (rpcA - rpcB);
        }
        default:
          return 0;
      }
    });
  }, [queries, searchQuery, filterType, tableSortKey, tableSortDir]);

  function handleTableSort(key: TableSortKey) {
    if (tableSortKey === key) {
      setTableSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setTableSortKey(key);
      setTableSortDir("desc");
    }
  }

  function SortHeader({
    label,
    sortKey,
    style,
    align = "left",
  }: {
    label: string;
    sortKey: TableSortKey;
    style?: React.CSSProperties;
    align?: "left" | "right";
  }) {
    const isActive = tableSortKey === sortKey;
    return (
      <th
        className="alert-table-th sortable-th"
        style={{ ...style, cursor: "pointer", userSelect: "none", textAlign: align }}
        onClick={() => handleTableSort(sortKey)}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            justifyContent: align === "right" ? "flex-end" : "flex-start",
            width: "100%",
          }}
        >
          {label}
          <span
            style={{
              fontSize: "0.7rem",
              color: isActive ? "var(--brand)" : "var(--text-muted)",
              opacity: isActive ? 1 : 0.4,
            }}
          >
            {isActive ? (tableSortDir === "asc" ? "▲" : "▼") : "↕"}
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

  const selectedTable = selectedQuery ? extractTableName(selectedQuery.queryText) : null;

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="detail-header">
        <div className="detail-header-left">
          <Link
            href={`/databases/${id}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 36,
              height: 36,
              borderRadius: "var(--radius-md)",
              background: "var(--surface-alt)",
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
              fontSize: "1rem",
              flexShrink: 0,
            }}
            title="Back to database overview"
          >
            ←
          </Link>
          <div>
            <h1>Queries — {database?.name}</h1>
            <p style={{ fontSize: "0.9rem", color: "var(--text-secondary)", marginTop: 2 }}>
              Workload impact, execution hotspots & statement diagnostics
            </p>
          </div>
        </div>
        <div className="detail-header-right">
          {latestCapturedAt && (
            <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
              Captured: {new Date(latestCapturedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
      </div>

      {extensionAvailable === false ? (
        <div className="glass-card-static" style={{ padding: "var(--space-2xl)", textAlign: "center" }}>
          <div style={{ fontSize: "2.5rem", marginBottom: "var(--space-md)" }}>🔌</div>
          <p style={{ fontSize: "1.1rem", fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>
            pg_stat_statements is not enabled
          </p>
          <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", maxWidth: 500, margin: "0 auto var(--space-lg)", lineHeight: 1.6 }}>
            Enable pg_stat_statements in your PostgreSQL configuration to track query execution metrics, identify slow queries, and capture EXPLAIN plans.
          </p>
          <div
            style={{
              background: "var(--surface-alt)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              padding: "var(--space-md)",
              fontFamily: "var(--font-mono)",
              fontSize: "0.8rem",
              maxWidth: 450,
              margin: "0 auto",
              textAlign: "left",
              color: "var(--text-secondary)",
            }}
          >
            <div style={{ color: "var(--text-muted)", marginBottom: 4 }}>-- Add to postgresql.conf:</div>
            <div>shared_preload_libraries = &apos;pg_stat_statements&apos;</div>
            <div>pg_stat_statements.track = all</div>
            <div style={{ color: "var(--text-muted)", marginTop: 8, marginBottom: 4 }}>-- Then in psql:</div>
            <div>CREATE EXTENSION IF NOT EXISTS pg_stat_statements;</div>
          </div>
        </div>
      ) : (
        <>
          {/* Workload KPI Strip */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: "var(--space-md)",
              marginBottom: "var(--space-xl)",
            }}
          >
            <div className="glass-card-static" style={{ padding: "var(--space-lg)", textAlign: "center" }}>
              <div style={{ fontSize: "1.8rem", fontWeight: 700, color: "var(--brand)", fontFamily: "var(--font-mono)" }}>
                {formatNumber(totalCalls)}
              </div>
              <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>Total Calls (24h)</div>
            </div>
            <div className="glass-card-static" style={{ padding: "var(--space-lg)", textAlign: "center" }}>
              <div style={{ fontSize: "1.8rem", fontWeight: 700, color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
                {formatHours(totalDbTimeMs)}
              </div>
              <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>Cumulative DB Time</div>
            </div>
            <div className="glass-card-static" style={{ padding: "var(--space-lg)", textAlign: "center" }}>
              <div
                style={{
                  fontSize: "1.8rem",
                  fontWeight: 700,
                  color: avgWorkloadLatency > 50 ? "var(--signal-warning)" : "var(--signal-healthy)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {formatMs(avgWorkloadLatency)}
              </div>
              <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>Avg Workload Latency</div>
            </div>
            <div className="glass-card-static" style={{ padding: "var(--space-lg)", textAlign: "center" }}>
              <div
                style={{
                  fontSize: "1.8rem",
                  fontWeight: 700,
                  color: highImpactCount > 0 ? "var(--signal-warning)" : "var(--signal-healthy)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {highImpactCount}
              </div>
              <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>Tuning Hotspots</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: "var(--space-lg)", flexWrap: "wrap", minWidth: 0 }}>
            {/* Left Column: Query Table & Filters */}
            <div style={{ flex: "1 1 550px", minWidth: 0, overflow: "hidden" }}>
              {/* Primary Search & Fast Filter Chips */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--space-sm)",
                  marginBottom: "var(--space-md)",
                }}
              >
                <div style={{ display: "flex", gap: "var(--space-sm)", flexWrap: "wrap", alignItems: "center" }}>
                  <div style={{ flex: "1 1 240px", position: "relative" }}>
                    <input
                      type="text"
                      placeholder="🔍 Search query SQL, table (e.g. 'orders'), or query ID..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="input-search"
                      style={{
                        width: "100%",
                        padding: "8px 12px",
                        fontSize: "0.85rem",
                        borderRadius: "var(--radius-md)",
                        border: "1px solid var(--border)",
                        background: "var(--surface-alt)",
                        color: "var(--text-primary)",
                      }}
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery("")}
                        style={{
                          position: "absolute",
                          right: 10,
                          top: "50%",
                          transform: "translateY(-50%)",
                          background: "none",
                          border: "none",
                          color: "var(--text-muted)",
                          cursor: "pointer",
                          fontSize: "0.8rem",
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  {/* Preset Sorting Tabs */}
                  <div className="tab-bar">
                    {([
                      ["total_time", "Total Time"],
                      ["calls", "Calls"],
                      ["mean_time", "Avg Time"],
                      ["rows", "Rows"],
                      ["temp_blks", "Disk Spill"],
                    ] as [SortBy, string][]).map(([key, label]) => (
                      <button
                        key={key}
                        className={`tab-button ${sortBy === key ? "active" : ""}`}
                        onClick={() => setSortBy(key)}
                        style={{ fontSize: "0.75rem", padding: "5px 10px" }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Filter Chips */}
                <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginRight: 4 }}>Filter:</span>
                  {[
                    { key: "all" as const, label: "All Statements" },
                    { key: "select" as const, label: "⚡ SELECT" },
                    { key: "dml" as const, label: "✏️ DML (Writes)" },
                    { key: "slow" as const, label: "🐢 Slow (>100ms)" },
                    { key: "high_impact" as const, label: "🔥 Heavy (>15% DB)" },
                    { key: "regressing" as const, label: "📈 Regressing" },
                  ].map((chip) => (
                    <button
                      key={chip.key}
                      onClick={() => setFilterType(chip.key)}
                      className={filterType === chip.key ? "filter-chip active" : "filter-chip"}
                      data-active={filterType === chip.key}
                      style={{ fontSize: "0.75rem", padding: "3px 9px" }}
                    >
                      {chip.label}
                    </button>
                  ))}
                  {filteredAndSortedQueries.length !== queries.length && (
                    <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginLeft: 6 }}>
                      Showing {filteredAndSortedQueries.length} of {queries.length}
                    </span>
                  )}
                </div>
              </div>

              {/* Suggestions Panel */}
              {suggestions.length > 0 && (() => {
                const COLLAPSED_LIMIT = 2;
                const visibleSuggestions = showAllSuggestions ? suggestions : suggestions.slice(0, COLLAPSED_LIMIT);
                const hiddenCount = suggestions.length - COLLAPSED_LIMIT;

                return (
                  <div style={{ marginBottom: "var(--space-lg)" }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: "var(--space-sm)",
                      }}
                    >
                      <div className="section-title" style={{ marginBottom: 0 }}>
                        Optimization Suggestions
                        <span
                          style={{
                            background: suggestions.some((s) => s.severity === "critical")
                              ? "var(--signal-critical-dim)"
                              : "var(--signal-warning-dim)",
                            color: suggestions.some((s) => s.severity === "critical")
                              ? "var(--signal-critical)"
                              : "var(--signal-warning)",
                            padding: "1px 8px",
                            borderRadius: "9999px",
                            fontSize: "0.7rem",
                            fontWeight: 600,
                            marginLeft: 8,
                            textTransform: "none",
                            letterSpacing: 0,
                          }}
                        >
                          {suggestions.length}
                        </span>
                      </div>
                      {suggestions.length > COLLAPSED_LIMIT && (
                        <button
                          onClick={() => setShowAllSuggestions(!showAllSuggestions)}
                          style={{
                            background: "none",
                            border: "none",
                            color: "var(--brand)",
                            cursor: "pointer",
                            fontSize: "0.8rem",
                            fontWeight: 500,
                            padding: "4px 8px",
                            borderRadius: "var(--radius-sm)",
                          }}
                        >
                          {showAllSuggestions ? "Show less ▲" : `Show ${hiddenCount} more ▼`}
                        </button>
                      )}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
                      {visibleSuggestions.map((s) => {
                        const targetQuery = queries.find((q) => q.queryid === s.queryid);
                        const queryText = (
                          typeof (s.metadata as Record<string, unknown>)?.queryText === "string"
                            ? String((s.metadata as Record<string, unknown>).queryText)
                            : targetQuery?.queryText || ""
                        ).trim();

                        const metaCalls =
                          typeof (s.metadata as Record<string, unknown>)?.calls === "number"
                            ? Number((s.metadata as Record<string, unknown>).calls)
                            : targetQuery?.calls || 1000;

                        const metaMeanMs =
                          typeof (s.metadata as Record<string, unknown>)?.meanTimeMs === "number"
                            ? Number((s.metadata as Record<string, unknown>).meanTimeMs)
                            : targetQuery?.meanTimeMs || 1;

                        const advice = queryText ? analyzeSqlAdvice(queryText, metaCalls, metaMeanMs) : null;
                        const recommendedDdl =
                          (typeof (s.metadata as Record<string, unknown>)?.recommendedIndexDdl === "string"
                            ? String((s.metadata as Record<string, unknown>).recommendedIndexDdl)
                            : advice?.recommendedIndexDdl) || null;

                        const savingsHours =
                          typeof (s.metadata as Record<string, unknown>)?.estimatedSavingsHours === "number"
                            ? Number((s.metadata as Record<string, unknown>).estimatedSavingsHours)
                            : advice?.estimatedSavingsHours ?? 0;

                        const savingsPct =
                          typeof (s.metadata as Record<string, unknown>)?.estimatedSavingsPct === "number"
                            ? Number((s.metadata as Record<string, unknown>).estimatedSavingsPct)
                            : advice?.estimatedSavingsPct ?? 0;

                        const icon =
                          s.suggestionType === "micro_query_lock_storm"
                            ? "⚡"
                            : s.suggestionType === "n_plus_one"
                            ? "🔄"
                            : s.suggestionType === "unbatched_insert"
                            ? "📥"
                            : s.suggestionType === "unbatched_update"
                            ? "✏️"
                            : s.suggestionType === "unbatched_delete"
                            ? "🗑️"
                            : s.suggestionType === "cache_miss"
                            ? "💾"
                            : s.suggestionType === "temp_spill"
                            ? "📝"
                            : "📈";
                        const borderColor =
                          s.severity === "critical"
                            ? "var(--signal-critical)"
                            : s.severity === "warning"
                            ? "var(--signal-warning)"
                            : "var(--brand)";
                        return (
                          <div
                            key={s.id}
                            className="glass-card-static"
                            style={{
                              padding: "var(--space-sm) var(--space-md)",
                              borderLeft: `3px solid ${borderColor}`,
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "flex-start",
                                justifyContent: "space-between",
                                gap: "var(--space-sm)",
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-sm)", flex: 1, minWidth: 0 }}>
                                <span style={{ fontSize: "1rem", flexShrink: 0 }}>{icon}</span>
                                <div style={{ minWidth: 0, flex: 1 }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", flexWrap: "wrap" }}>
                                    <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-primary)" }}>{s.title}</span>
                                    {savingsHours > 0 && (
                                      <span
                                        style={{
                                          fontSize: "0.7rem",
                                          fontWeight: 700,
                                          color: "var(--signal-healthy)",
                                          background: "var(--signal-healthy-dim)",
                                          padding: "1px 6px",
                                          borderRadius: "var(--radius-sm)",
                                        }}
                                      >
                                        ⚡ Saves ~{savingsHours}h CPU ({savingsPct}% drop)
                                      </span>
                                    )}
                                  </div>
                                  <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: 2, lineHeight: 1.4 }}>
                                    {s.description}
                                  </div>

                                  {/* Query text preview */}
                                  {queryText && (
                                    <code
                                      style={{
                                        display: "block",
                                        marginTop: 4,
                                        padding: "2px 6px",
                                        background: "var(--surface-alt)",
                                        borderRadius: "var(--radius-sm)",
                                        fontSize: "0.75rem",
                                        fontFamily: "var(--font-mono)",
                                        color: "var(--text-muted)",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                      }}
                                    >
                                      {queryText}
                                    </code>
                                  )}

                                  {/* Actionable Recommended Index DDL Box */}
                                  {recommendedDdl && (
                                    <div
                                      style={{
                                        marginTop: 8,
                                        padding: "6px 10px",
                                        background: "var(--surface-alt)",
                                        borderRadius: "var(--radius-md)",
                                        border: "1px solid var(--border)",
                                      }}
                                    >
                                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                                        <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "var(--brand)", textTransform: "uppercase" }}>
                                          💡 Recommended Index DDL
                                        </span>
                                        <div style={{ display: "flex", gap: 4 }}>
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              navigator.clipboard.writeText(recommendedDdl);
                                            }}
                                            className="btn-secondary"
                                            style={{ fontSize: "0.7rem", padding: "1px 6px" }}
                                            title="Copy DDL statement"
                                          >
                                            📋 Copy DDL
                                          </button>
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              if (targetQuery) {
                                                handleSelectQuery(targetQuery);
                                              }
                                              setSimDdl(recommendedDdl);
                                              setShowSimModal(true);
                                            }}
                                            className="btn-primary"
                                            style={{ fontSize: "0.7rem", padding: "1px 6px" }}
                                            title="Test this index with HypoPG simulation"
                                          >
                                            🧪 Test in HypoPG
                                          </button>
                                        </div>
                                      </div>
                                      <code
                                        style={{
                                          display: "block",
                                          fontFamily: "var(--font-mono)",
                                          fontSize: "0.75rem",
                                          color: "var(--text-primary)",
                                          wordBreak: "break-all",
                                          whiteSpace: "pre-wrap",
                                        }}
                                      >
                                        {recommendedDdl}
                                      </code>
                                    </div>
                                  )}
                                </div>
                              </div>
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  await dismissQuerySuggestion(id, s.id);
                                  setSuggestions((prev) => prev.filter((x) => x.id !== s.id));
                                }}
                                style={{
                                  background: "none",
                                  border: "1px solid var(--border)",
                                  borderRadius: "var(--radius-sm)",
                                  padding: "2px 6px",
                                  color: "var(--text-muted)",
                                  cursor: "pointer",
                                  fontSize: "0.7rem",
                                  flexShrink: 0,
                                  whiteSpace: "nowrap",
                                  marginLeft: "var(--space-sm)",
                                }}
                              >
                                Dismiss
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {filteredAndSortedQueries.length === 0 ? (
                <div className="glass-card-static" style={{ padding: "var(--space-2xl)", textAlign: "center", color: "var(--text-muted)" }}>
                  <div style={{ fontSize: "2rem", marginBottom: 8, opacity: 0.5 }}>🔍</div>
                  No queries matched your search and filter criteria.
                </div>
              ) : (
                <div className="glass-card-static" style={{ overflow: "hidden", padding: 0 }}>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                      <thead>
                        <tr style={{ borderBottom: "2px solid var(--border)", textAlign: "left" }}>
                          <SortHeader label="Query / SQL Statement" sortKey="queryText" />
                          <SortHeader label="Calls" sortKey="calls" align="right" style={{ width: 85 }} />
                          <SortHeader label="Avg Time" sortKey="meanTimeMs" align="right" style={{ width: 105 }} />
                          <SortHeader label="% DB Time" sortKey="pctOfTotalTime" align="left" style={{ width: 130 }} />
                          <SortHeader label="Total Time" sortKey="totalTimeMs" align="right" style={{ width: 95 }} />
                          <SortHeader label="Rows/Call" sortKey="rowsPerCall" align="right" style={{ width: 80 }} />
                          <th style={{ width: 45, textAlign: "center" }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredAndSortedQueries.map((q) => {
                          const isSelected = selectedQuery?.queryid === q.queryid;
                          const heatColor =
                            q.pctOfTotalTime > 30
                              ? "var(--signal-critical)"
                              : q.pctOfTotalTime > 10
                              ? "var(--signal-warning)"
                              : "var(--signal-healthy)";

                          const latencyColor =
                            q.meanTimeMs > 1000
                              ? "var(--signal-critical)"
                              : q.meanTimeMs > 100
                              ? "var(--signal-warning)"
                              : "var(--text-primary)";

                          const isCopied = copiedQueryId === q.queryid;

                          return (
                            <tr
                              key={q.id}
                              className="alert-table-row"
                              style={{
                                cursor: "pointer",
                                background: isSelected ? "var(--brand-dim)" : undefined,
                                borderLeft: isSelected ? "3px solid var(--brand)" : "3px solid transparent",
                              }}
                              onClick={() => handleSelectQuery(q)}
                            >
                              <td
                                className="alert-table-td"
                                style={{
                                  fontFamily: "var(--font-mono)",
                                  fontSize: "0.8rem",
                                  maxWidth: 280,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {truncateQuery(q.queryText)}
                              </td>
                              <td
                                className="alert-table-td"
                                style={{ fontFamily: "var(--font-mono)", fontWeight: 600, textAlign: "right" }}
                              >
                                {formatNumber(q.calls)}
                              </td>
                              <td
                                className="alert-table-td"
                                style={{
                                  fontFamily: "var(--font-mono)",
                                  color: latencyColor,
                                  textAlign: "right",
                                }}
                              >
                                <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                  {formatMs(q.meanTimeMs)}
                                  {q.meanTimeTrend != null && Math.abs(q.meanTimeTrend) >= 5 && (
                                    <span
                                      style={{
                                        fontSize: "0.65rem",
                                        fontWeight: 700,
                                        padding: "1px 4px",
                                        borderRadius: "var(--radius-sm)",
                                        color:
                                          q.meanTimeTrend > 30
                                            ? "var(--signal-critical)"
                                            : q.meanTimeTrend > 0
                                            ? "var(--signal-warning)"
                                            : "var(--signal-healthy)",
                                        background:
                                          q.meanTimeTrend > 30
                                            ? "var(--signal-critical-dim)"
                                            : q.meanTimeTrend > 0
                                            ? "var(--signal-warning-dim)"
                                            : "var(--signal-healthy-dim)",
                                      }}
                                    >
                                      {q.meanTimeTrend > 0 ? `+${q.meanTimeTrend.toFixed(0)}%` : `${q.meanTimeTrend.toFixed(0)}%`}
                                    </span>
                                  )}
                                </div>
                              </td>
                              {/* Workload Impact Bar */}
                              <td className="alert-table-td" style={{ minWidth: 120 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
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
                                        width: `${Math.min(Math.max(q.pctOfTotalTime, 2), 100)}%`,
                                        height: "100%",
                                        background: heatColor,
                                        borderRadius: "var(--radius-full)",
                                        transition: "width 0.3s ease",
                                      }}
                                    />
                                  </div>
                                  <span
                                    style={{
                                      fontFamily: "var(--font-mono)",
                                      fontSize: "0.75rem",
                                      fontWeight: q.pctOfTotalTime > 15 ? 700 : 400,
                                      color: heatColor,
                                      width: 42,
                                      textAlign: "right",
                                    }}
                                  >
                                    {q.pctOfTotalTime.toFixed(1)}%
                                  </span>
                                </div>
                              </td>
                              <td
                                className="alert-table-td"
                                style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)", textAlign: "right" }}
                              >
                                {formatMs(q.totalTimeMs)}
                              </td>
                              <td
                                className="alert-table-td"
                                style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)", textAlign: "right" }}
                              >
                                {q.calls > 0 ? (q.rowsReturned / q.calls).toFixed(1) : "—"}
                              </td>
                              <td className="alert-table-td" style={{ textAlign: "center" }}>
                                <button
                                  onClick={(e) => handleCopySql(q, e)}
                                  style={{
                                    background: "none",
                                    border: "none",
                                    cursor: "pointer",
                                    fontSize: "0.85rem",
                                    opacity: 0.6,
                                    padding: 2,
                                  }}
                                  title="Copy SQL statement"
                                >
                                  {isCopied ? "✓" : "📋"}
                                </button>
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

            {/* Right Column: Query Detail & Diagnostics Panel */}
            {selectedQuery && (
              <div style={{ flex: "0 0 450px", minWidth: 340 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-md)" }}>
                  <div className="section-title" style={{ marginBottom: 0 }}>Statement Inspector</div>
                  <button
                    onClick={() => setSelectedQuery(null)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--text-muted)",
                      cursor: "pointer",
                      fontSize: "0.85rem",
                    }}
                  >
                    Close ✕
                  </button>
                </div>

                <div className="glass-card-static" style={{ padding: "var(--space-lg)" }}>
                  {/* Top action toolbar */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-sm)" }}>
                    <div style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
                      Query ID: #{selectedQuery.queryid}
                    </div>
                    <div style={{ display: "flex", gap: "var(--space-xs)" }}>
                      <button
                        onClick={() => setIsFormattedSql(!isFormattedSql)}
                        className="btn-secondary"
                        style={{ fontSize: "0.75rem", padding: "2px 8px" }}
                      >
                        {isFormattedSql ? "Raw SQL" : "Format SQL"}
                      </button>
                      <button
                        onClick={() => handleCopySql(selectedQuery)}
                        className="btn-secondary"
                        style={{ fontSize: "0.75rem", padding: "2px 8px" }}
                      >
                        {copiedQueryId === selectedQuery.queryid ? "✓ Copied" : "📋 Copy SQL"}
                      </button>
                    </div>
                  </div>

                  {/* SQL Code Box with Syntax Styling */}
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "0.8rem",
                      background: "var(--surface-alt)",
                      padding: "var(--space-md)",
                      borderRadius: "var(--radius-md)",
                      marginBottom: "var(--space-md)",
                      maxHeight: 180,
                      overflow: "auto",
                      wordBreak: "break-all",
                      lineHeight: 1.5,
                      border: "1px solid var(--border)",
                      color: "var(--text-primary)",
                      whiteSpace: isFormattedSql ? "pre-wrap" : "normal",
                    }}
                  >
                    {isFormattedSql ? formatSqlCode(selectedQuery.queryText) : selectedQuery.queryText}
                  </div>

                  {/* Quick Bridge to Index Advisor & Recommended Index */}
                  {selectedTable && (
                    <div
                      style={{
                        background: "var(--surface-alt)",
                        padding: "8px 12px",
                        borderRadius: "var(--radius-md)",
                        marginBottom: "var(--space-md)",
                        border: "1px solid var(--border)",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                        <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                          Target Table: <strong style={{ color: "var(--brand)" }}>{selectedTable}</strong>
                        </span>
                        <Link
                          href={`/databases/${id}/indexes?search=${encodeURIComponent(selectedTable)}`}
                          style={{
                            fontSize: "0.75rem",
                            color: "var(--brand)",
                            textDecoration: "none",
                            fontWeight: 600,
                          }}
                        >
                          🗂️ View Index Advisor →
                        </Link>
                      </div>

                      {(() => {
                        const advice = analyzeSqlAdvice(selectedQuery.queryText, selectedQuery.calls, selectedQuery.meanTimeMs);
                        if (!advice.recommendedIndexDdl) return null;
                        return (
                          <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px dashed var(--border)" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                              <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "var(--brand)" }}>
                                💡 TAILORED COVERING INDEX:
                              </span>
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(advice.recommendedIndexDdl!);
                                  setCopiedQueryId(selectedQuery.queryid);
                                  setTimeout(() => setCopiedQueryId(null), 2000);
                                }}
                                className="btn-secondary"
                                style={{ fontSize: "0.65rem", padding: "1px 5px" }}
                              >
                                {copiedQueryId === selectedQuery.queryid ? "✓ Copied" : "📋 Copy DDL"}
                              </button>
                            </div>
                            <code
                              style={{
                                display: "block",
                                fontFamily: "var(--font-mono)",
                                fontSize: "0.7rem",
                                color: "var(--text-secondary)",
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-all",
                              }}
                            >
                              {advice.recommendedIndexDdl}
                            </code>
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* Stats Grid */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "var(--space-md)",
                      marginBottom: "var(--space-lg)",
                      paddingBottom: "var(--space-md)",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    <StatMini label="Total Calls" value={formatNumber(selectedQuery.calls)} />
                    <StatMini label="Total Time" value={formatMs(selectedQuery.totalTimeMs)} />
                    <StatMini
                      label="Mean Latency"
                      value={formatMs(selectedQuery.meanTimeMs)}
                      color={selectedQuery.meanTimeMs > 100 ? "var(--signal-warning)" : undefined}
                    />
                    <StatMini
                      label="Max Latency"
                      value={formatMs(selectedQuery.maxTimeMs)}
                      color={selectedQuery.maxTimeMs > 1000 ? "var(--signal-critical)" : undefined}
                    />
                    <StatMini label="Min Latency" value={formatMs(selectedQuery.minTimeMs)} />
                    <StatMini label="Rows Returned" value={formatNumber(selectedQuery.rowsReturned)} />
                    <StatMini
                      label="Buffer Cache Hit"
                      value={`${
                        selectedQuery.sharedBlksHit + selectedQuery.sharedBlksRead > 0
                          ? Math.round(
                              (selectedQuery.sharedBlksHit / (selectedQuery.sharedBlksHit + selectedQuery.sharedBlksRead)) * 100
                            )
                          : 0
                      }%`}
                    />
                    <StatMini label="% of DB Time" value={`${selectedQuery.pctOfTotalTime.toFixed(1)}%`} />
                  </div>

                  {/* 24-Hour Dual-Metric Historical Sparkline */}
                  {!detailLoading && timeSeries.length > 1 && (
                    <div style={{ marginBottom: "var(--space-lg)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-sm)" }}>
                        <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-secondary)" }}>
                          24h Trend: {chartMetric === "mean_time" ? "Mean Latency" : "Call Volume"}
                        </div>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button
                            onClick={() => setChartMetric("mean_time")}
                            className={chartMetric === "mean_time" ? "filter-chip active" : "filter-chip"}
                            data-active={chartMetric === "mean_time"}
                            style={{ fontSize: "0.7rem", padding: "2px 6px" }}
                          >
                            Latency
                          </button>
                          <button
                            onClick={() => setChartMetric("calls")}
                            className={chartMetric === "calls" ? "filter-chip active" : "filter-chip"}
                            data-active={chartMetric === "calls"}
                            style={{ fontSize: "0.7rem", padding: "2px 6px" }}
                          >
                            Calls
                          </button>
                        </div>
                      </div>
                      <ResponsiveContainer width="100%" height={130}>
                        <LineChart
                          data={timeSeries.map((ts) => ({
                            time: new Date(ts.capturedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                            value: chartMetric === "mean_time" ? ts.meanTimeMs : ts.calls,
                          }))}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke={colors.border} />
                          <XAxis dataKey="time" tick={{ fontSize: 10, fill: colors.textMuted }} interval="preserveStartEnd" />
                          <YAxis
                            tick={{ fontSize: 10, fill: colors.textMuted }}
                            width={50}
                            tickFormatter={(v: number) => (chartMetric === "mean_time" ? formatMs(v) : formatNumber(v))}
                          />
                          <Tooltip
                            contentStyle={{
                              background: "var(--tooltip-bg)",
                              border: "1px solid var(--tooltip-border)",
                              borderRadius: 8,
                              fontSize: "0.8rem",
                            }}
                            labelStyle={{ color: colors.textSecondary }}
                            formatter={(value: number) => [
                              chartMetric === "mean_time" ? formatMs(value) : formatNumber(value),
                              chartMetric === "mean_time" ? "Mean Latency" : "Calls",
                            ]}
                          />
                          <Line
                            type="monotone"
                            dataKey="value"
                            stroke={chartMetric === "mean_time" ? colors.brand : colors.healthy}
                            strokeWidth={2}
                            dot={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {/* Actions: EXPLAIN and HypoPG Simulation */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-sm)", marginBottom: "var(--space-md)" }}>
                    <button className="btn-primary" onClick={handleExplain} disabled={explainLoading} style={{ width: "100%", fontSize: "0.85rem" }}>
                      {explainLoading ? "Running EXPLAIN…" : "📋 Run EXPLAIN"}
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => setShowSimModal(!showSimModal)}
                      style={{ width: "100%", fontSize: "0.85rem" }}
                    >
                      🧪 HypoPG Test
                    </button>
                  </div>

                  {/* HypoPG Interactive Simulation Panel */}
                  {showSimModal && (
                    <div
                      style={{
                        padding: "var(--space-md)",
                        background: "var(--surface-alt)",
                        borderRadius: "var(--radius-md)",
                        border: "1px solid var(--brand)",
                        marginBottom: "var(--space-lg)",
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: "0.85rem", color: "var(--brand)", marginBottom: 4 }}>
                        HypoPG Hypothetical Index Test
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "var(--space-sm)" }}>
                        Simulate query cost reduction without building real index on disk
                      </div>
                      <input
                        type="text"
                        value={simDdl}
                        onChange={(e) => setSimDdl(e.target.value)}
                        placeholder="CREATE INDEX idx_name ON table (col)"
                        style={{
                          width: "100%",
                          padding: "6px 8px",
                          fontFamily: "var(--font-mono)",
                          fontSize: "0.75rem",
                          borderRadius: "var(--radius-sm)",
                          border: "1px solid var(--border)",
                          background: "var(--surface)",
                          color: "var(--text-primary)",
                          marginBottom: "var(--space-sm)",
                        }}
                      />
                      <button
                        onClick={handleRunSimulation}
                        disabled={simLoading || !simDdl.trim()}
                        className="btn-primary"
                        style={{ width: "100%", fontSize: "0.8rem", padding: "4px 8px" }}
                      >
                        {simLoading ? "Simulating Plan Cost…" : "Run HypoPG Cost Check"}
                      </button>

                      {simError && (
                        <div style={{ fontSize: "0.75rem", color: "var(--signal-critical)", marginTop: 6 }}>
                          ⚠️ {simError}
                        </div>
                      )}

                      {simResult && (
                        <div
                          style={{
                            marginTop: "var(--space-sm)",
                            padding: "var(--space-sm)",
                            borderRadius: "var(--radius-sm)",
                            background: "var(--surface)",
                            border: "1px solid var(--border)",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Estimated Cost Impact:</span>
                            <span
                              style={{
                                fontSize: "0.85rem",
                                fontWeight: 700,
                                color: simResult.costReductionPct > 0 ? "var(--signal-healthy)" : "var(--signal-warning)",
                              }}
                            >
                              {simResult.costReductionPct > 0
                                ? `-${simResult.costReductionPct.toFixed(1)}% cost reduction`
                                : "No plan improvement"}
                            </span>
                          </div>
                          <div style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
                            Cost: {simResult.costBefore.toFixed(1)} → {simResult.costAfter.toFixed(1)}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* EXPLAIN Results */}
                  {explains.length > 0 && (
                    <div>
                      <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "var(--space-sm)", color: "var(--text-secondary)" }}>
                        EXPLAIN Plans ({explains.length})
                      </div>
                      {explains.map((ex) => (
                        <ExplainCard key={ex.id} explain={ex} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ----- Helper Components ----- */

function StatMini({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "1rem", fontWeight: 600, color: color ?? "var(--text-primary)" }}>
        {value}
      </div>
    </div>
  );
}

function ExplainCard({ explain }: { explain: ExplainCapture }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        marginBottom: "var(--space-sm)",
        overflow: "hidden",
      }}
    >
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: "var(--space-sm) var(--space-md)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "var(--surface-alt)",
          fontSize: "0.8rem",
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
          {new Date(explain.capturedAt).toLocaleString([], {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {explain.warnings.length > 0 && (
            <span
              style={{
                background: "var(--signal-warning-dim)",
                color: "var(--signal-warning)",
                padding: "1px 6px",
                borderRadius: "var(--radius-full)",
                fontSize: "0.7rem",
                fontWeight: 600,
              }}
            >
              {explain.warnings.length} warning{explain.warnings.length !== 1 ? "s" : ""}
            </span>
          )}
          <span style={{ color: "var(--text-muted)" }}>{expanded ? "▲" : "▼"}</span>
        </div>
      </div>
      {expanded && (
        <div style={{ padding: "var(--space-md)" }}>
          {/* Warnings */}
          {explain.warnings.length > 0 && (
            <div style={{ marginBottom: "var(--space-md)" }}>
              {explain.warnings.map((w, i) => (
                <div
                  key={i}
                  style={{
                    padding: "var(--space-sm) var(--space-md)",
                    background: "var(--signal-warning-dim)",
                    borderRadius: "var(--radius-sm)",
                    marginBottom: 4,
                    fontSize: "0.8rem",
                    color: "var(--signal-warning)",
                    borderLeft: "3px solid var(--signal-warning)",
                  }}
                >
                  ⚠️ {w.message}
                </div>
              ))}
            </div>
          )}
          {/* Plan text */}
          {explain.planText && (
            <pre
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "0.75rem",
                background: "var(--surface-alt)",
                padding: "var(--space-md)",
                borderRadius: "var(--radius-md)",
                overflow: "auto",
                maxHeight: 300,
                whiteSpace: "pre-wrap",
                lineHeight: 1.4,
                color: "var(--text-secondary)",
              }}
            >
              {explain.planText}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
