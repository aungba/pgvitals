"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getDatabase, getQueryPlanHistory, getQueryCostEstimates } from "../../../lib/api";
import type { Database, PlanSnapshot, QueryCostEstimate } from "../../../lib/api";
import PlanTreeVisualizer from "../../../components/PlanTreeVisualizer";
import PlanListView from "../../../components/PlanListView";

/* ===================================================================
   Plan Regression Page — Phase 9 + Spec v4 §2.3
   Query plan shape tracking + regression detection + visualization
   =================================================================== */

type ViewMode = "tree" | "list" | "json";

function formatTimestamp(ts: string): string {
  return new Date(ts).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export default function PlansPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const preselectedQueryId = searchParams.get("queryid");

  const [database, setDatabase] = useState<Database | null>(null);
  const [queryList, setQueryList] = useState<QueryCostEstimate[]>([]);
  const [selectedQueryId, setSelectedQueryId] = useState<number | null>(
    preselectedQueryId ? parseInt(preselectedQueryId, 10) : null
  );
  const [plans, setPlans] = useState<PlanSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [plansLoading, setPlansLoading] = useState(false);
  const [expandedPlan, setExpandedPlan] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("tree");
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pastedPlan, setPastedPlan] = useState<any>(null);
  const [pasteText, setPasteText] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [db, costData] = await Promise.all([
        getDatabase(id),
        getQueryCostEstimates(id),
      ]);
      setDatabase(db);
      setQueryList(costData.estimates);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const fetchPlans = useCallback(async (queryid: number) => {
    setPlansLoading(true);
    try {
      const data = await getQueryPlanHistory(id, queryid);
      setPlans(data.plans);
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

  const handlePaste = () => {
    setPasteError(null);
    try {
      const parsed = JSON.parse(pasteText);
      // Handle various EXPLAIN JSON formats
      let planRoot;
      if (Array.isArray(parsed)) {
        // EXPLAIN (FORMAT JSON) returns an array with one element containing { "Plan": {...} }
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

  const regressionCount = plans.filter((p) => p.regression).length;

  const getPlanRoot = (planJson: any) => {
    if (!planJson) return null;
    // planJson is stored as the array from EXPLAIN, e.g. [{ "Plan": {...}, "Planning Time": ... }]
    if (Array.isArray(planJson)) {
      const first = planJson[0];
      return first?.Plan || first;
    }
    if (planJson.Plan) return planJson.Plan;
    if (planJson["Node Type"]) return planJson;
    return null;
  };

  // View mode toggle buttons
  const ViewModeToggle = () => (
    <div style={{
      display: "inline-flex", borderRadius: "var(--radius-md)",
      border: "1px solid var(--border)", overflow: "hidden",
    }}>
      {([
        { mode: "tree" as ViewMode, label: "🗺️ Tree", title: "Map View" },
        { mode: "list" as ViewMode, label: "📋 List", title: "List View" },
        { mode: "json" as ViewMode, label: "{ }", title: "Raw JSON" },
      ]).map(({ mode, label, title }) => (
        <button
          key={mode}
          onClick={() => setViewMode(mode)}
          title={title}
          style={{
            padding: "6px 14px", fontSize: "0.75rem", fontWeight: 600,
            border: "none", cursor: "pointer",
            background: viewMode === mode ? "var(--brand)" : "var(--surface-alt)",
            color: viewMode === mode ? "#fff" : "var(--text-secondary)",
            transition: "all 0.15s ease",
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );

  // Render plan content based on view mode
  const renderPlanContent = (planJson: any) => {
    const root = getPlanRoot(planJson);
    if (!root) return <div style={{ color: "var(--text-muted)" }}>No plan data available</div>;

    switch (viewMode) {
      case "tree":
        return <PlanTreeVisualizer plan={root} />;
      case "list":
        return <PlanListView plan={root} />;
      case "json":
        return (
          <pre style={{
            padding: "var(--space-md)", background: "var(--bg)",
            borderRadius: "var(--radius-md)", border: "1px solid var(--border)",
            overflow: "auto", maxHeight: 500, fontSize: "0.75rem",
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
            <h1>Plan Regression — {database?.name}</h1>
            <p className="text-secondary" style={{ fontSize: "0.9rem" }}>
              Track EXPLAIN plan changes and visualize execution plans
            </p>
          </div>
        </div>
        <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center" }}>
          <ViewModeToggle />
          <button
            onClick={() => setShowPasteModal(true)}
            style={{
              padding: "8px 16px", fontSize: "0.8rem", fontWeight: 600,
              background: "var(--surface-alt)", border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)", cursor: "pointer",
              color: "var(--text-primary)", transition: "all 0.15s ease",
              display: "flex", alignItems: "center", gap: "var(--space-xs)",
            }}
          >
            📋 Paste Plan
          </button>
        </div>
      </div>

      {/* Pasted plan display */}
      {pastedPlan && (
        <div style={{ marginBottom: "var(--space-lg)" }}>
          <div className="glass-card-static" style={{ padding: "var(--space-lg)" }}>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              marginBottom: "var(--space-md)",
            }}>
              <div style={{
                fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)",
                textTransform: "uppercase", letterSpacing: "0.05em",
              }}>
                📋 Pasted Plan
              </div>
              <button
                onClick={() => setPastedPlan(null)}
                style={{
                  padding: "4px 12px", fontSize: "0.75rem",
                  background: "var(--surface-alt)", border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)", cursor: "pointer",
                  color: "var(--text-secondary)",
                }}
              >
                ✕ Close
              </button>
            </div>
            {renderPlanContent(pastedPlan)}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: "var(--space-lg)", alignItems: "start" }}>
        {/* Query Selector */}
        <div className="glass-card-static" style={{ padding: "var(--space-md)", maxHeight: 600, overflowY: "auto" }}>
          <div style={{
            fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)",
            textTransform: "uppercase", letterSpacing: "0.05em",
            padding: "var(--space-sm) var(--space-sm) var(--space-md)",
            borderBottom: "1px solid var(--border)",
          }}>
            Select a Query ({queryList.length})
          </div>
          {queryList.length === 0 ? (
            <div style={{ padding: "var(--space-lg)", textAlign: "center", color: "var(--text-muted)", fontSize: "0.85rem" }}>
              No queries available
            </div>
          ) : (
            queryList.map((q) => (
              <button
                key={q.queryid}
                onClick={() => setSelectedQueryId(q.queryid)}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  padding: "var(--space-sm) var(--space-md)",
                  background: selectedQueryId === q.queryid ? "var(--brand-dim, var(--surface-alt))" : "transparent",
                  border: "none", borderBottom: "1px solid var(--border)",
                  cursor: "pointer", transition: "background 0.15s",
                  borderLeft: selectedQueryId === q.queryid ? "3px solid var(--brand)" : "3px solid transparent",
                }}
              >
                <code style={{
                  fontSize: "0.75rem", fontFamily: "var(--font-mono)",
                  color: "var(--text-primary)", display: "block",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {q.queryText.slice(0, 60)}
                </code>
                <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                  {q.calls.toLocaleString()} calls · {q.totalTimeMs.toFixed(0)}ms total
                </span>
              </button>
            ))
          )}
        </div>

        {/* Plan History */}
        <div>
          {selectedQueryId === null ? (
            <div className="glass-card-static" style={{
              padding: "var(--space-2xl)", textAlign: "center", color: "var(--text-muted)",
            }}>
              <div style={{ fontSize: "2.5rem", marginBottom: "var(--space-md)" }}>📋</div>
              <p style={{ fontSize: "1.1rem", fontWeight: 500 }}>Select a query to view plan history</p>
              <p style={{ fontSize: "0.85rem", marginTop: "var(--space-sm)" }}>
                Pick a query from the left panel to see its EXPLAIN plan evolution
              </p>
            </div>
          ) : plansLoading ? (
            <div className="glass-card-static" style={{ padding: "var(--space-lg)" }}>
              <div className="skeleton" style={{ height: 200, borderRadius: "var(--radius-md)" }} />
            </div>
          ) : plans.length === 0 ? (
            <div className="glass-card-static" style={{
              padding: "var(--space-2xl)", textAlign: "center", color: "var(--text-muted)",
            }}>
              <div style={{ fontSize: "2.5rem", marginBottom: "var(--space-md)" }}>🔍</div>
              <p style={{ fontSize: "1.1rem", fontWeight: 500 }}>No plan snapshots yet</p>
              <p style={{ fontSize: "0.85rem", marginTop: "var(--space-sm)" }}>
                Plan snapshots are captured every 5 minutes for top queries
              </p>
            </div>
          ) : (
            <>
              {/* Regression summary */}
              {regressionCount > 0 && (
                <div style={{
                  padding: "var(--space-md) var(--space-lg)",
                  background: "var(--signal-warning-dim)",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--signal-warning)",
                  marginBottom: "var(--space-lg)",
                  display: "flex", alignItems: "center", gap: "var(--space-sm)",
                  color: "var(--signal-warning)", fontWeight: 500, fontSize: "0.9rem",
                }}>
                  ⚠️ {regressionCount} plan regression(s) detected in history
                </div>
              )}

              <div className="glass-card-static" style={{ padding: "var(--space-lg)" }}>
                <div style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  marginBottom: "var(--space-lg)",
                }}>
                  <div style={{
                    fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)",
                    textTransform: "uppercase", letterSpacing: "0.05em",
                  }}>
                    Plan History ({plans.length} snapshots)
                  </div>
                </div>

                {plans.map((plan) => (
                  <div
                    key={plan.id}
                    style={{
                      padding: "var(--space-md)",
                      borderLeft: plan.regression
                        ? "3px solid var(--signal-warning)"
                        : "3px solid var(--border)",
                      marginBottom: "var(--space-md)",
                      background: plan.regression ? "var(--signal-warning-dim)" : "var(--surface-alt)",
                      borderRadius: "0 var(--radius-md) var(--radius-md) 0",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <span style={{
                          fontWeight: 600, fontSize: "0.85rem",
                          display: "inline-flex", alignItems: "center", gap: "var(--space-xs)",
                        }}>
                          {plan.topNodeType || "Unknown"}
                          {plan.regression && (
                            <span style={{
                              fontSize: "0.65rem", padding: "2px 8px",
                              background: "var(--signal-warning)", color: "#fff",
                              borderRadius: "var(--radius-sm)", fontWeight: 600,
                            }}>
                              REGRESSION
                            </span>
                          )}
                        </span>
                        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 2 }}>
                          {formatTimestamp(plan.capturedAt)} · Cost: {plan.estimatedCost?.toFixed(2) ?? "—"} · Hash: <code style={{ fontFamily: "var(--font-mono)" }}>{plan.planShapeHash.slice(0, 8)}</code>
                        </div>
                      </div>
                      <button
                        onClick={() => setExpandedPlan(expandedPlan === plan.id ? null : plan.id)}
                        style={{
                          padding: "4px 12px", fontSize: "0.75rem",
                          background: expandedPlan === plan.id ? "var(--brand)" : "var(--surface)",
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius-sm)", cursor: "pointer",
                          color: expandedPlan === plan.id ? "#fff" : "var(--text-secondary)",
                          transition: "all 0.15s ease",
                        }}
                      >
                        {expandedPlan === plan.id ? "Hide Plan" : "View Plan"}
                      </button>
                    </div>

                    {plan.regression && (
                      <div style={{
                        marginTop: "var(--space-sm)", fontSize: "0.8rem",
                        color: "var(--signal-warning)", fontStyle: "italic",
                      }}>
                        {plan.regression}
                      </div>
                    )}

                    {/* Plan flags */}
                    {plan.planFlags && Object.keys(plan.planFlags).length > 0 && (
                      <div style={{
                        marginTop: "var(--space-xs)", display: "flex", gap: "var(--space-xs)", flexWrap: "wrap",
                      }}>
                        {Object.keys(plan.planFlags).map((flag) => (
                          <span key={flag} style={{
                            fontSize: "0.65rem", padding: "2px 6px",
                            background: "var(--signal-critical-dim)", color: "var(--signal-critical)",
                            borderRadius: "var(--radius-sm)",
                          }}>
                            {flag.replace(/_/g, " ")}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Expanded plan visualization */}
                    {expandedPlan === plan.id && plan.planJson && (
                      <div style={{ marginTop: "var(--space-md)" }}>
                        {renderPlanContent(plan.planJson)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Paste Plan Modal */}
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
              maxWidth: 640, width: "100%", maxHeight: "80vh", overflow: "auto",
              boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ fontSize: "1.2rem", fontWeight: 700, marginBottom: "var(--space-sm)" }}>
              📋 Paste EXPLAIN Plan
            </h2>
            <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "var(--space-md)" }}>
              Paste the output of <code style={{ fontFamily: "var(--font-mono)", background: "var(--surface-alt)", padding: "2px 6px", borderRadius: 4 }}>EXPLAIN (FORMAT JSON) your_query</code>
            </p>
            <textarea
              value={pasteText}
              onChange={(e) => { setPasteText(e.target.value); setPasteError(null); }}
              placeholder={`[\n  {\n    "Plan": {\n      "Node Type": "Seq Scan",\n      "Relation Name": "users",\n      "Total Cost": 45200.00,\n      "Plan Rows": 100000,\n      ...\n    }\n  }\n]`}
              style={{
                width: "100%", minHeight: 200, padding: "var(--space-md)",
                fontFamily: "var(--font-mono)", fontSize: "0.8rem",
                background: "var(--bg)", border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)", color: "var(--text-primary)",
                resize: "vertical",
              }}
            />
            {pasteError && (
              <div style={{
                marginTop: "var(--space-sm)", fontSize: "0.8rem",
                color: "var(--signal-critical)", padding: "var(--space-sm)",
                background: "var(--signal-critical-dim)", borderRadius: "var(--radius-sm)",
              }}>
                ❌ {pasteError}
              </div>
            )}
            <div style={{ display: "flex", gap: "var(--space-sm)", marginTop: "var(--space-md)", justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowPasteModal(false)}
                style={{
                  padding: "8px 20px", fontSize: "0.85rem", fontWeight: 500,
                  background: "var(--surface-alt)", border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)", cursor: "pointer",
                  color: "var(--text-secondary)",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handlePaste}
                disabled={!pasteText.trim()}
                style={{
                  padding: "8px 20px", fontSize: "0.85rem", fontWeight: 600,
                  background: pasteText.trim() ? "var(--brand)" : "var(--surface-alt)",
                  border: "none", borderRadius: "var(--radius-md)", cursor: "pointer",
                  color: pasteText.trim() ? "#fff" : "var(--text-muted)",
                  transition: "all 0.15s ease",
                }}
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
