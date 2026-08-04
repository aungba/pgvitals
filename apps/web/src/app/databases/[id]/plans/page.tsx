"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getDatabase, getQueryPlanHistory, getQueryCostEstimates } from "../../../lib/api";
import type { Database, PlanSnapshot, QueryCostEstimate } from "../../../lib/api";

/* ===================================================================
   Plan Regression Page — Phase 9
   Query plan shape tracking + regression detection
   =================================================================== */

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

  const regressionCount = plans.filter((p) => p.regression).length;

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
              Track EXPLAIN plan changes that may indicate performance degradation
            </p>
          </div>
        </div>
      </div>

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
                  fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)",
                  textTransform: "uppercase", letterSpacing: "0.05em",
                  marginBottom: "var(--space-lg)",
                }}>
                  Plan History ({plans.length} snapshots)
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
                          background: "var(--surface)", border: "1px solid var(--border)",
                          borderRadius: "var(--radius-sm)", cursor: "pointer",
                          color: "var(--text-secondary)",
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

                    {/* Expanded plan JSON */}
                    {expandedPlan === plan.id && plan.planJson && (
                      <pre style={{
                        marginTop: "var(--space-md)", padding: "var(--space-md)",
                        background: "var(--bg)", borderRadius: "var(--radius-md)",
                        border: "1px solid var(--border)", overflow: "auto",
                        maxHeight: 400, fontSize: "0.75rem", fontFamily: "var(--font-mono)",
                        color: "var(--text-secondary)",
                      }}>
                        {JSON.stringify(plan.planJson, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
