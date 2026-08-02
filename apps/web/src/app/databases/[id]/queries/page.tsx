"use client";

import React, { useEffect, useState, useCallback } from "react";
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
} from "../../../lib/api";
import type {
  Database,
  QueryStat,
  ExplainCapture,
  QuerySuggestion,
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
import Link from "next/link";

/* ===================================================================
   Query Performance Page — Phase 4
   =================================================================== */

type SortBy = "total_time" | "calls" | "mean_time" | "rows";

function formatMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function truncateQuery(q: string, len = 80): string {
  return q.length > len ? q.slice(0, len) + "…" : q;
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

  // Detail panel state
  const [selectedQuery, setSelectedQuery] = useState<QueryStat | null>(null);
  const [timeSeries, setTimeSeries] = useState<QueryStat[]>([]);
  const [explains, setExplains] = useState<ExplainCapture[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [explainLoading, setExplainLoading] = useState(false);

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
      // Fetch suggestions
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

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const result = await getQueries(id, sortBy);
        setQueries(result.queries);
        setLatestCapturedAt(result.latestCapturedAt);
      } catch {
        // ignore
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, [id, sortBy]);

  const handleSelectQuery = async (q: QueryStat) => {
    setSelectedQuery(q);
    setDetailLoading(true);
    try {
      const [detail, explainData] = await Promise.all([
        getQueryDetail(id, q.queryid),
        getExplainCaptures(id, q.queryid),
      ]);
      setTimeSeries(detail.timeSeries);
      setExplains(explainData.explains);
    } catch {
      // ignore
    } finally {
      setDetailLoading(false);
    }
  };

  const handleExplain = async () => {
    if (!selectedQuery) return;
    setExplainLoading(true);
    try {
      const { explain } = await captureExplainPlan(
        id,
        selectedQuery.queryid,
        selectedQuery.queryText
      );
      setExplains((prev) => [explain, ...prev]);
    } catch {
      // ignore
    } finally {
      setExplainLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="animate-fade-in">
        <div className="skeleton" style={{ width: 300, height: 32, marginBottom: 16 }} />
        <div className="skeleton" style={{ height: 400, borderRadius: "var(--radius-lg)" }} />
      </div>
    );
  }

  // Extension not available — show setup instructions
  if (extensionAvailable === false) {
    return (
      <div className="animate-fade-in">
        <div className="detail-header">
          <div className="detail-header-left">
            <Link
              href={`/databases/${id}`}
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 36, height: 36, borderRadius: "var(--radius-md)",
                background: "var(--surface-alt)", border: "1px solid var(--border)",
                color: "var(--text-secondary)", fontSize: "1rem", flexShrink: 0,
              }}
            >←</Link>
            <div>
              <h1>Queries — {database?.name}</h1>
            </div>
          </div>
        </div>
        <div className="glass-card-static" style={{ padding: "var(--space-xl)", textAlign: "center" }}>
          <div style={{ fontSize: "3rem", marginBottom: "var(--space-md)", opacity: 0.5 }}>📊</div>
          <h2 style={{ marginBottom: "var(--space-md)", color: "var(--text-primary)" }}>
            pg_stat_statements not enabled
          </h2>
          <p style={{ color: "var(--text-secondary)", maxWidth: 500, margin: "0 auto var(--space-lg)" }}>
            Query performance monitoring requires the <code style={{
              background: "var(--surface-alt)", padding: "2px 6px",
              borderRadius: "var(--radius-sm)", fontFamily: "var(--font-mono)", fontSize: "0.85em",
            }}>pg_stat_statements</code> extension.
          </p>
          <div style={{
            background: "var(--surface-alt)", padding: "var(--space-lg)",
            borderRadius: "var(--radius-md)", textAlign: "left", maxWidth: 500, margin: "0 auto",
            fontFamily: "var(--font-mono)", fontSize: "0.85rem", lineHeight: 1.7,
          }}>
            <div style={{ color: "var(--text-muted)", marginBottom: "var(--space-sm)" }}>-- Run as superuser:</div>
            <div style={{ color: "var(--signal-healthy)" }}>CREATE EXTENSION</div>
            <div style={{ paddingLeft: "1em", color: "var(--text-primary)" }}>pg_stat_statements;</div>
            <div style={{ color: "var(--text-muted)", marginTop: "var(--space-md)", marginBottom: "var(--space-sm)" }}>-- Add to postgresql.conf:</div>
            <div style={{ color: "var(--text-primary)" }}>shared_preload_libraries = &apos;pg_stat_statements&apos;</div>
          </div>
        </div>
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
              color: "var(--text-secondary)", fontSize: "1rem", flexShrink: 0,
            }}
          >←</Link>
          <div>
            <h1>Queries — {database?.name}</h1>
            <p className="text-secondary" style={{ fontSize: "0.9rem" }}>
              Query performance from pg_stat_statements
              {latestCapturedAt && (
                <span style={{ marginLeft: 8, color: "var(--text-muted)", fontSize: "0.8rem" }}>
                  Last updated: {new Date(latestCapturedAt).toLocaleTimeString()}
                </span>
              )}
            </p>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: "var(--space-lg)", flexWrap: "wrap", minWidth: 0 }}>
        {/* Left: Query List */}
        <div style={{ flex: "1 1 500px", minWidth: 0, overflow: "hidden" }}>
          {/* Sort tabs */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-md)", flexWrap: "wrap", gap: "var(--space-sm)" }}>
            <div className="section-title" style={{ marginBottom: 0 }}>Top Queries</div>
            <div className="tab-bar">
              {([
                ["total_time", "Total Time"],
                ["calls", "Calls"],
                ["mean_time", "Avg Time"],
                ["rows", "Rows"],
              ] as [SortBy, string][]).map(([key, label]) => (
                <button
                  key={key}
                  className={`tab-button ${sortBy === key ? "active" : ""}`}
                  onClick={() => setSortBy(key)}
                >{label}</button>
              ))}
            </div>
          </div>

          {/* Suggestions Panel */}
          {suggestions.length > 0 && (() => {
            const COLLAPSED_LIMIT = 2;
            const visibleSuggestions = showAllSuggestions ? suggestions : suggestions.slice(0, COLLAPSED_LIMIT);
            const hiddenCount = suggestions.length - COLLAPSED_LIMIT;

            return (
              <div style={{ marginBottom: "var(--space-lg)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-sm)" }}>
                  <div className="section-title" style={{ marginBottom: 0 }}>
                    Suggestions
                    <span style={{
                      background: suggestions.some((s) => s.severity === "critical") ? "var(--signal-critical-dim)" : "var(--signal-warning-dim)",
                      color: suggestions.some((s) => s.severity === "critical") ? "var(--signal-critical)" : "var(--signal-warning)",
                      padding: "1px 8px",
                      borderRadius: "9999px",
                      fontSize: "0.7rem",
                      fontWeight: 600,
                      marginLeft: 8,
                      textTransform: "none",
                      letterSpacing: 0,
                    }}>
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
                        transition: "all var(--transition-fast)",
                      }}
                    >
                      {showAllSuggestions ? "Show less ▲" : `Show ${hiddenCount} more ▼`}
                    </button>
                  )}
                </div>
                <div style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--space-sm)",
                  maxHeight: showAllSuggestions ? 400 : undefined,
                  overflowY: showAllSuggestions ? "auto" : undefined,
                }}>
                  {visibleSuggestions.map((s) => {
                    const icon = s.suggestionType === "n_plus_one" ? "🔄" : s.suggestionType === "cache_miss" ? "💾" : s.suggestionType === "temp_spill" ? "📝" : "📈";
                    const borderColor = s.severity === "critical" ? "var(--signal-critical)" : s.severity === "warning" ? "var(--signal-warning)" : "var(--brand)";
                    return (
                      <div key={s.id} className="glass-card-static" style={{
                        padding: "var(--space-sm) var(--space-md)",
                        borderLeft: `3px solid ${borderColor}`,
                      }}>
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--space-sm)" }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                              <span style={{ fontSize: "0.9rem" }}>{icon}</span>
                              <span style={{ fontWeight: 600, fontSize: "0.8rem" }}>{s.title}</span>
                            </div>
                            <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", lineHeight: 1.4 }}>
                              {s.description}
                            </div>
                            {typeof (s.metadata as Record<string, unknown>)?.queryText === "string" && (
                              <div style={{
                                marginTop: 4,
                                padding: "4px 6px",
                                background: "var(--surface-alt)",
                                borderRadius: "var(--radius-sm)",
                                fontFamily: "var(--font-mono)",
                                fontSize: "0.7rem",
                                color: "var(--text-muted)",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                maxWidth: "100%",
                              }}>
                                {String((s.metadata as Record<string, unknown>).queryText)}
                              </div>
                            )}
                          </div>
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              await dismissQuerySuggestion(id, s.id);
                              setSuggestions((prev) => prev.filter((x) => x.id !== s.id));
                            }}
                            style={{
                              background: "none", border: "1px solid var(--border)",
                              borderRadius: "var(--radius-sm)", padding: "2px 6px",
                              color: "var(--text-muted)", cursor: "pointer", fontSize: "0.7rem",
                              flexShrink: 0, whiteSpace: "nowrap",
                              transition: "all var(--transition-fast)",
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

          {queries.length === 0 ? (
            <div className="glass-card-static" style={{ padding: "var(--space-xl)", textAlign: "center", color: "var(--text-muted)" }}>
              <div style={{ fontSize: "2rem", marginBottom: 8, opacity: 0.5 }}>📊</div>
              No query stats collected yet. Data appears after the first 5-minute polling cycle.
            </div>
          ) : (
            <div className="glass-card-static" style={{ overflow: "hidden" }}>
              <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th className="alert-table-th">Query</th>
                    <th className="alert-table-th" style={{ width: 90 }}>Calls</th>
                    <th className="alert-table-th" style={{ width: 100 }}>Total Time</th>
                    <th className="alert-table-th" style={{ width: 90 }}>Avg Time</th>
                    <th className="alert-table-th" style={{ width: 70 }}>% Time</th>
                    <th className="alert-table-th" style={{ width: 80 }}>Rows</th>
                  </tr>
                </thead>
                <tbody>
                  {queries.map((q) => (
                    <tr
                      key={q.queryid}
                      className="alert-table-row"
                      style={{
                        cursor: "pointer",
                        background: selectedQuery?.queryid === q.queryid ? "var(--brand-dim)" : undefined,
                      }}
                      onClick={() => handleSelectQuery(q)}
                    >
                      <td className="alert-table-td" style={{
                        fontFamily: "var(--font-mono)", fontSize: "0.8rem",
                        maxWidth: 350, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {truncateQuery(q.queryText)}
                      </td>
                      <td className="alert-table-td" style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                        {formatNumber(q.calls)}
                      </td>
                      <td className="alert-table-td" style={{ fontFamily: "var(--font-mono)" }}>
                        {formatMs(q.totalTimeMs)}
                      </td>
                      <td className="alert-table-td" style={{
                        fontFamily: "var(--font-mono)",
                        color: q.meanTimeMs > 1000 ? "var(--signal-critical)" : q.meanTimeMs > 100 ? "var(--signal-warning)" : "var(--text-secondary)",
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          {formatMs(q.meanTimeMs)}
                          {q.meanTimeTrend != null && Math.abs(q.meanTimeTrend) >= 5 && (
                            <span style={{
                              fontSize: "0.65rem",
                              fontWeight: 700,
                              padding: "1px 4px",
                              borderRadius: "var(--radius-sm)",
                              color: q.meanTimeTrend > 30 ? "var(--signal-critical)"
                                : q.meanTimeTrend > 0 ? "var(--signal-warning)"
                                : "var(--signal-healthy)",
                              background: q.meanTimeTrend > 30 ? "var(--signal-critical-dim)"
                                : q.meanTimeTrend > 0 ? "var(--signal-warning-dim)"
                                : "var(--signal-healthy-dim)",
                            }}>
                              {q.meanTimeTrend > 0 ? "↑" : "↓"}{Math.abs(q.meanTimeTrend).toFixed(0)}%
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="alert-table-td">
                        <div style={{
                          display: "flex", alignItems: "center", gap: 6,
                        }}>
                          <div style={{
                            flex: 1, height: 4, background: "var(--surface-alt)",
                            borderRadius: "var(--radius-full)", overflow: "hidden",
                          }}>
                            <div style={{
                              width: `${Math.min(q.pctOfTotalTime, 100)}%`, height: "100%",
                              background: q.pctOfTotalTime > 50 ? "var(--signal-critical)" : q.pctOfTotalTime > 20 ? "var(--signal-warning)" : "var(--brand)",
                              borderRadius: "var(--radius-full)",
                            }} />
                          </div>
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--text-muted)", minWidth: 32 }}>
                            {q.pctOfTotalTime.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                      <td className="alert-table-td" style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
                        {formatNumber(q.rowsReturned)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </div>

        {/* Right: Detail Panel */}
        {selectedQuery && (
          <div style={{ flex: "0 0 420px", minWidth: 320 }}>
            <div className="section-title" style={{ marginBottom: "var(--space-md)" }}>Query Detail</div>
            <div className="glass-card-static" style={{ padding: "var(--space-lg)" }}>
              {/* Query text */}
              <div style={{
                fontFamily: "var(--font-mono)", fontSize: "0.8rem",
                background: "var(--surface-alt)", padding: "var(--space-md)",
                borderRadius: "var(--radius-md)", marginBottom: "var(--space-lg)",
                maxHeight: 150, overflow: "auto", wordBreak: "break-all",
                lineHeight: 1.5, color: "var(--text-secondary)",
              }}>
                {selectedQuery.queryText}
              </div>

              {/* Stats grid */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-md)", marginBottom: "var(--space-lg)" }}>
                <StatMini label="Total Calls" value={formatNumber(selectedQuery.calls)} />
                <StatMini label="Total Time" value={formatMs(selectedQuery.totalTimeMs)} />
                <StatMini label="Mean Time" value={formatMs(selectedQuery.meanTimeMs)} color={selectedQuery.meanTimeMs > 100 ? "var(--signal-warning)" : undefined} />
                <StatMini label="Max Time" value={formatMs(selectedQuery.maxTimeMs)} color={selectedQuery.maxTimeMs > 1000 ? "var(--signal-critical)" : undefined} />
                <StatMini label="Min Time" value={formatMs(selectedQuery.minTimeMs)} />
                <StatMini label="Rows Returned" value={formatNumber(selectedQuery.rowsReturned)} />
                <StatMini label="Cache Hit" value={`${selectedQuery.sharedBlksHit + selectedQuery.sharedBlksRead > 0 ? Math.round((selectedQuery.sharedBlksHit / (selectedQuery.sharedBlksHit + selectedQuery.sharedBlksRead)) * 100) : 0}%`} />
                <StatMini label="% of DB Time" value={`${selectedQuery.pctOfTotalTime.toFixed(1)}%`} />
              </div>

              {/* Time series chart */}
              {!detailLoading && timeSeries.length > 1 && (
                <div style={{ marginBottom: "var(--space-lg)" }}>
                  <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "var(--space-sm)", color: "var(--text-secondary)" }}>
                    Mean Time (24h)
                  </div>
                  <ResponsiveContainer width="100%" height={120}>
                    <LineChart data={timeSeries.map((ts) => ({
                      time: new Date(ts.capturedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                      meanTime: ts.meanTimeMs,
                      calls: ts.calls,
                    }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke={colors.border} />
                      <XAxis dataKey="time" tick={{ fontSize: 10, fill: colors.textMuted }} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 10, fill: colors.textMuted }} width={45} tickFormatter={(v: number) => formatMs(v)} />
                      <Tooltip
                        contentStyle={{
                          background: "var(--tooltip-bg)", border: "1px solid var(--tooltip-border)",
                          borderRadius: 8, fontSize: "0.8rem",
                        }}
                        labelStyle={{ color: colors.textSecondary }}
                        formatter={(value: number) => [formatMs(value), "Mean Time"]}
                      />
                      <Line type="monotone" dataKey="meanTime" stroke={colors.brand} strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* EXPLAIN button */}
              <button
                className="btn-primary"
                onClick={handleExplain}
                disabled={explainLoading}
                style={{ width: "100%", marginBottom: "var(--space-md)" }}
              >
                {explainLoading ? "Running EXPLAIN…" : "📋 Run EXPLAIN"}
              </button>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", textAlign: "center", marginBottom: "var(--space-lg)" }}>
                EXPLAIN only — does not execute the query
              </div>

              {/* EXPLAIN results */}
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
    </div>
  );
}

/* ----- Helper Components ----- */

function StatMini({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "1rem", fontWeight: 600, color: color ?? "var(--text-primary)" }}>{value}</div>
    </div>
  );
}

function ExplainCard({ explain }: { explain: ExplainCapture }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{
      border: "1px solid var(--border)", borderRadius: "var(--radius-md)",
      marginBottom: "var(--space-sm)", overflow: "hidden",
    }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: "var(--space-sm) var(--space-md)", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: "var(--surface-alt)", fontSize: "0.8rem",
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
          {new Date(explain.capturedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {explain.warnings.length > 0 && (
            <span style={{
              background: "var(--signal-warning-dim)", color: "var(--signal-warning)",
              padding: "1px 6px", borderRadius: "var(--radius-full)", fontSize: "0.7rem", fontWeight: 600,
            }}>
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
                <div key={i} style={{
                  padding: "var(--space-sm) var(--space-md)",
                  background: "var(--signal-warning-dim)",
                  borderRadius: "var(--radius-sm)",
                  marginBottom: 4, fontSize: "0.8rem",
                  color: "var(--signal-warning)",
                  borderLeft: "3px solid var(--signal-warning)",
                }}>
                  ⚠️ {w.message}
                </div>
              ))}
            </div>
          )}
          {/* Plan text */}
          {explain.planText && (
            <pre style={{
              fontFamily: "var(--font-mono)", fontSize: "0.75rem",
              background: "var(--surface-alt)", padding: "var(--space-md)",
              borderRadius: "var(--radius-md)", overflow: "auto",
              maxHeight: 300, whiteSpace: "pre-wrap", lineHeight: 1.4,
              color: "var(--text-secondary)",
            }}>
              {explain.planText}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
