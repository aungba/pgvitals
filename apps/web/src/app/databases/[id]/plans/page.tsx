"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  getDatabase,
  getQueryPlanHistory,
  getQueryCostEstimates,
  getTrackedPlanQueryIds,
  captureExplainPlan,
} from "../../../lib/api";
import type { Database, PlanSnapshot, QueryCostEstimate } from "../../../lib/api";
import PlanTreeVisualizer from "../../../components/PlanTreeVisualizer";
import PlanListView from "../../../components/PlanListView";
import { PlanDiffVisualizer } from "../../../components/PlanDiffVisualizer";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { useChartColors } from "../../../lib/useChartColors";

/* ===================================================================
   Plan Regression & EXPLAIN Visualizer — Enhanced UI
   =================================================================== */

type ViewMode = "diff" | "tree" | "list" | "json";
type QueryFilter = "all" | "regressed" | "flagged" | "tracked";

function formatTimestamp(ts: string): string {
  return new Date(ts).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function formatNumber(n: number | undefined | null): string {
  if (n === undefined || n === null) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function truncateQuery(query: string, length = 120): string {
  const clean = (query || "").replace(/\s+/g, " ").trim();
  if (clean.length <= length) return clean;
  return clean.slice(0, length) + "…";
}

export default function PlansPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const preselectedQueryId = searchParams.get("queryid");
  const chartColors = useChartColors();

  // Core Data State
  const [database, setDatabase] = useState<Database | null>(null);
  const [queryList, setQueryList] = useState<QueryCostEstimate[]>([]);
  const [selectedQueryId, setSelectedQueryId] = useState<number | null>(
    preselectedQueryId ? parseInt(preselectedQueryId, 10) : null
  );
  const [plans, setPlans] = useState<PlanSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [plansLoading, setPlansLoading] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [captureMessage, setCaptureMessage] = useState<string | null>(null);
  const [trackedIds, setTrackedIds] = useState<Set<number>>(new Set());

  // Navigation & Filtering
  const [querySearch, setQuerySearch] = useState("");
  const [queryFilter, setQueryFilter] = useState<QueryFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("tree");
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);
  const [compareSnapshotId, setCompareSnapshotId] = useState<string | null>(null);

  // Paste modal state
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pastedPlan, setPastedPlan] = useState<any>(null);
  const [pasteText, setPasteText] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  // ── Data Fetching ──────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    try {
      const [db, costData, tracked] = await Promise.all([
        getDatabase(id),
        getQueryCostEstimates(id),
        getTrackedPlanQueryIds(id).catch(() => []),
      ]);
      setDatabase(db);
      const trackedSet = new Set(tracked);
      setTrackedIds(trackedSet);

      // Deduplicate queries by queryid
      const queryMap = new Map<number, QueryCostEstimate>();
      for (const est of costData.estimates) {
        if (!queryMap.has(est.queryid)) {
          queryMap.set(est.queryid, est);
        }
      }

      // Sort: queries with plans first, then by total time
      const sorted = Array.from(queryMap.values()).sort((a, b) => {
        const aHas = trackedSet.has(a.queryid) ? 1 : 0;
        const bHas = trackedSet.has(b.queryid) ? 1 : 0;
        if (aHas !== bHas) return bHas - aHas;
        return b.totalTimeMs - a.totalTimeMs;
      });

      setQueryList(sorted);
      if (!selectedQueryId && sorted.length > 0) {
        setSelectedQueryId(sorted[0].queryid);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [id, selectedQueryId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const fetchPlans = useCallback(async (queryid: number) => {
    setPlansLoading(true);
    try {
      const data = await getQueryPlanHistory(id, queryid);
      setPlans(data.plans);
      if (data.plans.length > 0) {
        setSelectedSnapshotId(data.plans[0].id);
        if (data.plans.length > 1) {
          setCompareSnapshotId(data.plans[1].id);
        }
      }
    } catch {
      setPlans([]);
    } finally {
      setPlansLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (selectedQueryId !== null) {
      fetchPlans(selectedQueryId);
    }
  }, [selectedQueryId, fetchPlans]);

  // Selected query metadata
  const selectedQuery = useMemo(() => {
    return queryList.find((q) => q.queryid === selectedQueryId);
  }, [queryList, selectedQueryId]);

  // Active snapshot for single view
  const currentSnapshot = useMemo(() => {
    if (!selectedSnapshotId) return plans[0] || null;
    return plans.find((p) => p.id === selectedSnapshotId) || plans[0] || null;
  }, [plans, selectedSnapshotId]);

  // Baseline snapshot for diff view
  const baseSnapshot = useMemo(() => {
    if (compareSnapshotId) {
      const found = plans.find((p) => p.id === compareSnapshotId);
      if (found) return found;
    }
    // Default to the previous snapshot or the oldest snapshot
    if (plans.length > 1) return plans[1];
    return null;
  }, [plans, compareSnapshotId]);

  // Regression / flags count
  const regressionCount = useMemo(() => plans.filter((p) => p.regression).length, [plans]);
  const latestHasRegression = plans.length > 0 && !!plans[0].regression;

  // Set default view mode to diff if regression exists, else tree
  useEffect(() => {
    if (latestHasRegression && plans.length > 1) {
      setViewMode("diff");
    }
  }, [latestHasRegression, plans.length]);

  // Filtered queries in sidebar
  const filteredQueries = useMemo(() => {
    let result = queryList;
    if (queryFilter === "tracked") {
      result = result.filter((q) => trackedIds.has(q.queryid));
    }
    if (querySearch.trim()) {
      const term = querySearch.toLowerCase();
      result = result.filter(
        (q) => q.queryText.toLowerCase().includes(term) || String(q.queryid).includes(term)
      );
    }
    return result;
  }, [queryList, queryFilter, querySearch, trackedIds]);

  // Trigger On-Demand Capture
  const handleCaptureNow = async () => {
    if (!selectedQuery) return;
    setCapturing(true);
    setCaptureMessage(null);
    try {
      await captureExplainPlan(id, selectedQuery.queryid, selectedQuery.queryText);
      await fetchPlans(selectedQuery.queryid);
      setCaptureMessage("Plan successfully captured!");
      setTimeout(() => setCaptureMessage(null), 3000);
    } catch {
      setCaptureMessage("Failed to capture plan. Query may require specific parameter bindings.");
    } finally {
      setCapturing(false);
    }
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedText(label);
      setTimeout(() => setCopiedText(null), 2000);
    } catch {
      // ignore
    }
  };

  const handlePaste = () => {
    setPasteError(null);
    try {
      const parsed = JSON.parse(pasteText);
      let planRoot;
      if (Array.isArray(parsed)) {
        planRoot = parsed[0]?.Plan || parsed[0];
      } else if (parsed.Plan) {
        planRoot = parsed.Plan;
      } else if (parsed["Node Type"]) {
        planRoot = parsed;
      } else {
        throw new Error("Unrecognized plan format");
      }
      setPastedPlan(planRoot);
      setShowPasteModal(false);
      setPasteText("");
    } catch (e) {
      setPasteError(e instanceof Error ? e.message : "Invalid JSON. Paste the output of EXPLAIN (FORMAT JSON).");
    }
  };

  const getPlanRoot = (planJson: any) => {
    if (!planJson) return null;
    if (Array.isArray(planJson)) {
      const first = planJson[0];
      return first?.Plan || first;
    }
    if (planJson.Plan) return planJson.Plan;
    if (planJson["Node Type"]) return planJson;
    return null;
  };

  // Render plan content based on view mode
  const renderPlanContent = (planJson: any) => {
    const root = getPlanRoot(planJson);
    if (!root) return <div style={{ color: "var(--text-muted)", padding: "var(--space-lg)", textAlign: "center" }}>No plan data available</div>;

    switch (viewMode) {
      case "diff":
        if (baseSnapshot && currentSnapshot) {
          return (
            <PlanDiffVisualizer
              basePlan={baseSnapshot}
              currentPlan={currentSnapshot}
              onSelectBaseSnapshot={(snapId) => setCompareSnapshotId(snapId)}
              availableSnapshots={plans}
            />
          );
        }
        return <PlanTreeVisualizer plan={root} />;
      case "tree":
        return <PlanTreeVisualizer plan={root} />;
      case "list":
        return <PlanListView plan={root} />;
      case "json":
        return (
          <pre style={{
            padding: "var(--space-md)", background: "var(--bg)",
            borderRadius: "var(--radius-md)", border: "1px solid var(--border)",
            overflow: "auto", maxHeight: 550, fontSize: "0.75rem",
            fontFamily: "var(--font-mono)", color: "var(--text-secondary)",
          }}>
            {JSON.stringify(planJson, null, 2)}
          </pre>
        );
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

  return (
    <div className="animate-fade-in">
      {/* ── Detail Header ── */}
      <div className="detail-header" style={{ marginBottom: "var(--space-md)" }}>
        <div className="detail-header-left">
          <Link
            href={`/databases/${id}`}
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 36, height: 36, borderRadius: "var(--radius-md)",
              background: "var(--surface-alt)", border: "1px solid var(--border)",
              color: "var(--text-secondary)", fontSize: "1rem", flexShrink: 0,
            }}
          >
            ←
          </Link>
          <div>
            <h1>Plan Regression & EXPLAIN — {database?.name}</h1>
            <p className="text-secondary" style={{ fontSize: "0.9rem" }}>
              Multi-factor query plan regression detection, side-by-side diffing & execution tree analysis
            </p>
          </div>
        </div>

        <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center", flexWrap: "wrap" }}>
          {/* Mode Switcher */}
          <div style={{
            display: "inline-flex", borderRadius: "var(--radius-md)",
            border: "1px solid var(--border)", overflow: "hidden",
          }}>
            {([
              { mode: "diff" as ViewMode, label: "🔀 Diff", disabled: plans.length < 2 },
              { mode: "tree" as ViewMode, label: "🗺️ Tree", disabled: false },
              { mode: "list" as ViewMode, label: "📋 List", disabled: false },
              { mode: "json" as ViewMode, label: "{ } JSON", disabled: false },
            ]).map(({ mode, label, disabled }) => (
              <button
                key={mode}
                disabled={disabled}
                onClick={() => setViewMode(mode)}
                style={{
                  padding: "6px 12px", fontSize: "0.75rem", fontWeight: 600,
                  border: "none", cursor: disabled ? "not-allowed" : "pointer",
                  background: viewMode === mode ? "var(--brand)" : "var(--surface-alt)",
                  color: viewMode === mode ? "#fff" : disabled ? "var(--text-muted)" : "var(--text-secondary)",
                  opacity: disabled ? 0.4 : 1,
                  transition: "all 0.15s ease",
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            onClick={() => setShowPasteModal(true)}
            className="btn-secondary"
            style={{ fontSize: "0.8rem", padding: "6px 12px" }}
          >
            📋 Paste Plan
          </button>
        </div>
      </div>

      {/* ── Main Layout: Sidebar (Query List) + Main Panel ── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "340px 1fr",
        gap: "var(--space-lg)",
        alignItems: "start",
      }}>
        {/* ── LEFT SIDEBAR: Queries ── */}
        <div className="glass-card-static" style={{ padding: "var(--space-md)", display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {/* Search Input */}
          <div className="table-search-wrap" style={{ width: "100%" }}>
            <span className="table-search-icon">🔍</span>
            <input
              className="table-search"
              placeholder="Search queries..."
              value={querySearch}
              onChange={(e) => setQuerySearch(e.target.value)}
              style={{ width: "100%" }}
            />
          </div>

          {/* Filter Chips */}
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", paddingBottom: "var(--space-xs)" }}>
            <button
              className="filter-chip"
              data-active={queryFilter === "all"}
              onClick={() => setQueryFilter("all")}
              style={{ fontSize: "0.72rem", padding: "3px 8px" }}
            >
              All ({queryList.length})
            </button>
            <button
              className="filter-chip"
              data-active={queryFilter === "tracked"}
              onClick={() => setQueryFilter("tracked")}
              style={{ fontSize: "0.72rem", padding: "3px 8px" }}
            >
              With Plans ({trackedIds.size})
            </button>
          </div>

          {/* Query Items List */}
          <div style={{ maxHeight: 680, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
            {filteredQueries.length === 0 ? (
              <div style={{ padding: "var(--space-lg)", textAlign: "center", color: "var(--text-muted)", fontSize: "0.85rem" }}>
                No matching queries found
              </div>
            ) : (
              filteredQueries.map((q, idx) => {
                const hasPlan = trackedIds.has(q.queryid);
                const isSelected = selectedQueryId === q.queryid;

                return (
                  <button
                    key={`${q.queryid}-${idx}`}
                    onClick={() => setSelectedQueryId(q.queryid)}
                    style={{
                      display: "block", width: "100%", textAlign: "left",
                      padding: "8px 10px",
                      background: isSelected ? "var(--brand-dim, var(--surface-alt))" : "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-md)",
                      cursor: "pointer", transition: "all 0.15s ease",
                      borderLeft: isSelected ? "3px solid var(--brand)" : "3px solid transparent",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginBottom: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {hasPlan ? (
                          <span style={{
                            width: 6, height: 6, borderRadius: "50%",
                            background: "var(--signal-healthy)", flexShrink: 0,
                            boxShadow: "0 0 6px rgba(16, 185, 129, 0.6)",
                          }} title="Has tracked plan history" />
                        ) : (
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--text-muted)", opacity: 0.4 }} />
                        )}
                        <span style={{ fontSize: "0.72rem", fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
                          #{q.queryid}
                        </span>
                      </div>

                      <span style={{ fontSize: "0.7rem", color: "var(--brand)", fontWeight: 600 }}>
                        ${q.estimatedTotalCostPerMonth.toFixed(2)}/mo
                      </span>
                    </div>

                    <code style={{
                      fontSize: "0.75rem", fontFamily: "var(--font-mono)",
                      color: "var(--text-primary)", display: "block",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {truncateQuery(q.queryText, 55)}
                    </code>

                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.68rem", color: "var(--text-muted)", marginTop: 4 }}>
                      <span>{formatNumber(q.calls)} calls</span>
                      <span>{q.totalTimeMs.toFixed(0)}ms total</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* ── RIGHT MAIN PANEL: Plan History & Visualizer ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
          {selectedQuery === null ? (
            <div className="glass-card-static" style={{ padding: "var(--space-2xl)", textAlign: "center", color: "var(--text-muted)" }}>
              <div style={{ fontSize: "2.5rem", marginBottom: "var(--space-md)" }}>📋</div>
              <p style={{ fontSize: "1.1rem", fontWeight: 500 }}>Select a query to view execution plans</p>
            </div>
          ) : (
            <>
              {/* Query Meta Banner + On Demand Capture */}
              <div className="glass-card-static" style={{ padding: "var(--space-md) var(--space-lg)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--space-md)", flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 260 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--brand)" }}>
                        Query #{selectedQuery?.queryid}
                      </span>
                      <button
                        onClick={() => copyToClipboard(selectedQuery?.queryText || "", "query")}
                        style={{
                          background: "transparent", border: "none", cursor: "pointer",
                          fontSize: "0.75rem", color: "var(--text-muted)",
                        }}
                      >
                        {copiedText === "query" ? "✓ Copied" : "📋 Copy SQL"}
                      </button>
                    </div>
                    <code style={{
                      display: "block", fontSize: "0.8rem", fontFamily: "var(--font-mono)",
                      color: "var(--text-primary)", background: "var(--bg)", padding: "6px 8px",
                      borderRadius: "var(--radius-sm)", border: "1px solid var(--border)",
                      maxHeight: 70, overflowY: "auto", wordBreak: "break-all",
                    }}>
                      {selectedQuery?.queryText}
                    </code>
                  </div>

                  <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center" }}>
                    <button
                      onClick={handleCaptureNow}
                      disabled={capturing}
                      className="btn-primary"
                      style={{ fontSize: "0.8rem", padding: "8px 16px", display: "flex", alignItems: "center", gap: 6 }}
                    >
                      {capturing ? (
                        <>
                          <span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>🔄</span>
                          Capturing…
                        </>
                      ) : (
                        <>⚡ Capture Plan Now</>
                      )}
                    </button>
                  </div>
                </div>

                {captureMessage && (
                  <div style={{
                    marginTop: "var(--space-sm)", padding: "6px 12px", borderRadius: "var(--radius-sm)",
                    background: captureMessage.includes("Failed") ? "var(--signal-critical-dim)" : "var(--signal-healthy-dim)",
                    color: captureMessage.includes("Failed") ? "var(--signal-critical)" : "var(--signal-healthy)",
                    fontSize: "0.8rem", fontWeight: 500,
                  }}>
                    {captureMessage}
                  </div>
                )}
              </div>

              {/* ── Active Regression / Warning Remediation Banner ── */}
              {currentSnapshot?.regression && (
                <div style={{
                  padding: "var(--space-md) var(--space-lg)",
                  background: currentSnapshot.regressionAnalysis?.severity === "critical"
                    ? "var(--signal-critical-dim)"
                    : "var(--signal-warning-dim)",
                  border: `1px solid ${
                    currentSnapshot.regressionAnalysis?.severity === "critical"
                      ? "var(--signal-critical)"
                      : "var(--signal-warning)"
                  }`,
                  borderRadius: "var(--radius-md)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: "1.2rem" }}>
                        {currentSnapshot.regressionAnalysis?.severity === "critical" ? "🔴" : "⚠️"}
                      </span>
                      <div>
                        <div style={{
                          fontWeight: 700, fontSize: "0.9rem",
                          color: currentSnapshot.regressionAnalysis?.severity === "critical"
                            ? "var(--signal-critical)"
                            : "var(--signal-warning)",
                        }}>
                          Plan Regression Detected: {currentSnapshot.regressionAnalysis?.summary || currentSnapshot.regression}
                        </div>
                        <div style={{ fontSize: "0.82rem", color: "var(--text-secondary)", marginTop: 2 }}>
                          {currentSnapshot.regressionAnalysis?.reason || currentSnapshot.regression}
                        </div>
                      </div>
                    </div>

                    {currentSnapshot.regressionAnalysis?.remediationSql && (
                      <button
                        onClick={() => copyToClipboard(currentSnapshot.regressionAnalysis!.remediationSql!, "remediation")}
                        className="copy-btn"
                        style={{ fontSize: "0.78rem" }}
                      >
                        {copiedText === "remediation" ? "✓ Copied" : "📋"} {currentSnapshot.regressionAnalysis.remediationSql}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* ── Historical Cost & Evolution Sparkline / Timeline ── */}
              {plans.length > 1 && (
                <div className="glass-card-static" style={{ padding: "var(--space-md)" }}>
                  <div style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    marginBottom: "var(--space-xs)", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)",
                    textTransform: "uppercase", letterSpacing: "0.05em",
                  }}>
                    <span>Plan Estimated Cost Trend ({plans.length} snapshots)</span>
                    <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>
                      Oldest → Latest
                    </span>
                  </div>

                  <ResponsiveContainer width="100%" height={90}>
                    <AreaChart
                      data={[...plans].reverse().map((p) => ({
                        time: new Date(p.capturedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                        cost: p.estimatedCost ?? 0,
                        hasRegression: !!p.regression,
                      }))}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={chartColors.border} />
                      <XAxis dataKey="time" tick={{ fontSize: 9, fill: chartColors.textMuted }} />
                      <YAxis tick={{ fontSize: 9, fill: chartColors.textMuted }} width={35} />
                      <Tooltip
                        contentStyle={{
                          background: "var(--tooltip-bg)", border: "1px solid var(--tooltip-border)",
                          borderRadius: 6, fontSize: "0.75rem",
                        }}
                        formatter={(val: number) => [`Cost: ${val.toFixed(1)}`, "Estimated Cost"]}
                      />
                      <Area
                        type="monotone"
                        dataKey="cost"
                        stroke={latestHasRegression ? "var(--signal-critical)" : chartColors.brand}
                        fill={latestHasRegression ? "rgba(239, 68, 68, 0.15)" : `${chartColors.brand}22`}
                        strokeWidth={2}
                        dot={{ r: 3, fill: chartColors.brand }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* ── Snapshot Selector Timeline Tabs ── */}
              {plans.length > 0 && (
                <div style={{
                  display: "flex", gap: "var(--space-xs)", overflowX: "auto", paddingBottom: 4,
                  alignItems: "center",
                }}>
                  <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700, marginRight: 4 }}>
                    Snapshots:
                  </span>
                  {plans.map((p, i) => {
                    const isSelected = p.id === currentSnapshot?.id;
                    return (
                      <button
                        key={p.id}
                        onClick={() => setSelectedSnapshotId(p.id)}
                        style={{
                          padding: "4px 10px", fontSize: "0.72rem", borderRadius: "var(--radius-sm)",
                          border: isSelected ? "1px solid var(--brand)" : "1px solid var(--border)",
                          background: isSelected ? "var(--brand-dim)" : "var(--surface)",
                          color: isSelected ? "var(--brand)" : "var(--text-secondary)",
                          cursor: "pointer", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 5,
                        }}
                      >
                        {p.regression && <span style={{ color: "var(--signal-critical)" }}>●</span>}
                        <span>{i === 0 ? "Latest" : `#${plans.length - i}`}</span>
                        <span style={{ opacity: 0.6 }}>({p.topNodeType || "Plan"})</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* ── Visualizer Content Area ── */}
              <div className="glass-card-static" style={{ padding: "var(--space-lg)" }}>
                {plansLoading ? (
                  <div className="skeleton" style={{ height: 260, borderRadius: "var(--radius-md)" }} />
                ) : plans.length === 0 ? (
                  <div style={{ padding: "var(--space-2xl)", textAlign: "center", color: "var(--text-muted)" }}>
                    <div style={{ fontSize: "2.5rem", marginBottom: "var(--space-md)" }}>🔍</div>
                    <p style={{ fontSize: "1.1rem", fontWeight: 500 }}>No EXPLAIN snapshots captured yet</p>
                    <p style={{ fontSize: "0.85rem", marginTop: 4 }}>
                      Click <strong>&quot;⚡ Capture Plan Now&quot;</strong> above to generate an immediate EXPLAIN plan.
                    </p>
                  </div>
                ) : (
                  renderPlanContent(currentSnapshot?.planJson)
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Paste Plan Modal ── */}
      {showPasteModal && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 1000,
          background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: "var(--space-lg)",
        }} onClick={() => setShowPasteModal(false)}>
          <div
            style={{
              background: "var(--surface)", borderRadius: "var(--radius-lg)",
              border: "1px solid var(--border)", padding: "var(--space-xl)",
              maxWidth: 640, width: "100%", maxHeight: "85vh", overflow: "auto",
              boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ fontSize: "1.2rem", fontWeight: 700, marginBottom: "var(--space-sm)" }}>
              📋 Paste EXPLAIN Plan JSON
            </h2>
            <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "var(--space-md)" }}>
              Paste the raw output of <code style={{ fontFamily: "var(--font-mono)", background: "var(--surface-alt)", padding: "1px 4px", borderRadius: 3 }}>EXPLAIN (FORMAT JSON) ...</code>
            </p>

            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder='[ { "Plan": { "Node Type": "Seq Scan", ... } } ]'
              style={{
                width: "100%", minHeight: 200, fontFamily: "var(--font-mono)", fontSize: "0.8rem",
                padding: "var(--space-md)", background: "var(--bg)", border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)", color: "var(--text-primary)",
              }}
            />

            {pasteError && (
              <div style={{
                marginTop: "var(--space-sm)", color: "var(--signal-critical)",
                fontSize: "0.8rem",
              }}>
                ⚠️ {pasteError}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-sm)", marginTop: "var(--space-md)" }}>
              <button
                onClick={() => setShowPasteModal(false)}
                className="btn-secondary"
                style={{ fontSize: "0.85rem" }}
              >
                Cancel
              </button>
              <button
                onClick={handlePaste}
                className="btn-primary"
                style={{ fontSize: "0.85rem" }}
              >
                Visualize Plan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
