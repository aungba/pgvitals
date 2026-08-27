"use client";

import React, { useState } from "react";
import type { PlanSnapshot } from "../lib/api";

/* ===================================================================
   Plan Diff Visualizer — Side-by-Side EXPLAIN Plan Comparison
   
   Highlights structural changes, cost differences, dropped indexes,
   and unindexed scan additions between two plan snapshots.
   =================================================================== */

interface PlanNode {
  "Node Type": string;
  "Total Cost"?: number;
  "Startup Cost"?: number;
  "Plan Rows"?: number;
  "Plan Width"?: number;
  "Relation Name"?: string;
  "Alias"?: string;
  "Index Name"?: string;
  "Filter"?: string;
  "Index Cond"?: string;
  "Join Type"?: string;
  "Hash Cond"?: string;
  "Sort Key"?: string[];
  "Actual Total Time"?: number;
  "Actual Rows"?: number;
  "Actual Loops"?: number;
  Plans?: PlanNode[];
  [key: string]: any;
}

interface PlanDiffVisualizerProps {
  basePlan: PlanSnapshot;
  currentPlan: PlanSnapshot;
  onSelectBaseSnapshot?: (id: string) => void;
  availableSnapshots?: PlanSnapshot[];
}

function getPlanRoot(planJson: any): PlanNode | null {
  if (!planJson) return null;
  if (Array.isArray(planJson)) {
    if (planJson.length > 0 && planJson[0]?.["Plan"]) return planJson[0]["Plan"];
    if (planJson.length > 0 && planJson[0]?.["Node Type"]) return planJson[0];
  }
  if (planJson?.["Plan"]) return planJson["Plan"];
  if (planJson?.["Node Type"]) return planJson;
  return null;
}

function getNodeStyle(nodeType: string): { border: string; bg: string; icon: string } {
  const t = (nodeType || "").toLowerCase();
  if (t.includes("seq scan"))
    return { border: "var(--signal-critical, #ef4444)", bg: "rgba(239, 68, 68, 0.08)", icon: "⚠️" };
  if (t.includes("index only") || t.includes("index scan") || t.includes("bitmap index"))
    return { border: "var(--signal-healthy, #10b981)", bg: "rgba(16, 185, 129, 0.08)", icon: "⚡" };
  if (t.includes("hash join") || t.includes("merge join"))
    return { border: "var(--brand, #3b82f6)", bg: "rgba(59, 130, 246, 0.08)", icon: "🔗" };
  if (t.includes("nested loop"))
    return { border: "var(--signal-warning, #f59e0b)", bg: "rgba(245, 158, 11, 0.08)", icon: "🔄" };
  if (t.includes("sort"))
    return { border: "#a855f7", bg: "rgba(168, 85, 247, 0.08)", icon: "↕️" };
  return { border: "var(--border, #334155)", bg: "var(--surface-alt, #1e293b)", icon: "○" };
}

function formatNumber(n: number | undefined | null): string {
  if (n === undefined || n === null) return "—";
  return n.toLocaleString();
}

function formatCost(cost: number | undefined | null): string {
  if (cost === undefined || cost === null) return "—";
  return cost.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

export function PlanDiffVisualizer({
  basePlan,
  currentPlan,
  onSelectBaseSnapshot,
  availableSnapshots = [],
}: PlanDiffVisualizerProps) {
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set());

  const baseRoot = getPlanRoot(basePlan.planJson);
  const currentRoot = getPlanRoot(currentPlan.planJson);

  const baseCost = basePlan.estimatedCost ?? baseRoot?.["Total Cost"] ?? 0;
  const currentCost = currentPlan.estimatedCost ?? currentRoot?.["Total Cost"] ?? 0;
  const costDiff = currentCost - baseCost;
  const costPctChange = baseCost > 0 ? (costDiff / baseCost) * 100 : 0;

  const toggleNode = (id: string) => {
    setCollapsedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="plan-diff-visualizer" style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
      {/* ── Delta Summary Header Cards ── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: "var(--space-sm)",
      }}>
        {/* Cost Delta */}
        <div className="glass-card-static" style={{ padding: "var(--space-md)", borderLeft: `3px solid ${costDiff > 0 ? "var(--signal-critical)" : "var(--signal-healthy)"}` }}>
          <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>
            Estimated Cost Delta
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
            <span style={{ fontSize: "1.3rem", fontWeight: 700, fontFamily: "var(--font-mono)", color: costDiff > 0 ? "var(--signal-critical)" : "var(--signal-healthy)" }}>
              {costDiff > 0 ? `+${costPctChange.toFixed(1)}%` : `${costPctChange.toFixed(1)}%`}
            </span>
            <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
              ({formatCost(baseCost)} → {formatCost(currentCost)})
            </span>
          </div>
        </div>

        {/* Top Node Type */}
        <div className="glass-card-static" style={{ padding: "var(--space-md)" }}>
          <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>
            Top Node Type
          </div>
          <div style={{ fontSize: "0.88rem", fontWeight: 600, marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
            <span>{basePlan.topNodeType || "Unknown"}</span>
            <span style={{ color: "var(--text-muted)" }}>→</span>
            <span style={{
              color: basePlan.topNodeType !== currentPlan.topNodeType ? "var(--signal-warning)" : "var(--text-primary)"
            }}>
              {currentPlan.topNodeType || "Unknown"}
            </span>
          </div>
        </div>

        {/* Shape Hash */}
        <div className="glass-card-static" style={{ padding: "var(--space-md)" }}>
          <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>
            Plan Shape
          </div>
          <div style={{ fontSize: "0.85rem", marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
            {basePlan.planShapeHash === currentPlan.planShapeHash ? (
              <span style={{ color: "var(--signal-healthy)", fontWeight: 600 }}>Identical Shape</span>
            ) : (
              <span style={{ color: "var(--signal-critical)", fontWeight: 600 }}>
                ⚠️ Altered Execution Tree
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Side-by-Side Dual-Column Trees ── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
        gap: "var(--space-md)",
        minWidth: 0,
        maxWidth: "100%",
      }}>
        {/* Left: Baseline Plan */}
        <div className="glass-card-static" style={{ padding: "var(--space-md)", overflowX: "auto", minWidth: 0 }}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            paddingBottom: "var(--space-sm)", borderBottom: "1px solid var(--border)", marginBottom: "var(--space-md)",
          }}>
            <div>
              <span style={{
                fontSize: "0.7rem", fontWeight: 700, padding: "2px 8px", borderRadius: "var(--radius-full)",
                background: "rgba(16, 185, 129, 0.15)", color: "var(--signal-healthy)", textTransform: "uppercase",
              }}>
                Baseline Plan
              </span>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 4 }}>
                {new Date(basePlan.capturedAt).toLocaleString()}
              </div>
            </div>
            {availableSnapshots.length > 1 && onSelectBaseSnapshot && (
              <select
                value={basePlan.id}
                onChange={(e) => onSelectBaseSnapshot(e.target.value)}
                style={{
                  fontSize: "0.75rem", padding: "4px 8px", borderRadius: "var(--radius-sm)",
                  background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)",
                }}
              >
                {availableSnapshots
                  .filter((s) => s.id !== currentPlan.id)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {new Date(s.capturedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })} ({s.topNodeType})
                    </option>
                  ))}
              </select>
            )}
          </div>

          {baseRoot ? (
            <DiffNodeTree
              node={baseRoot}
              path="base"
              collapsed={collapsedNodes}
              onToggle={toggleNode}
              side="base"
              rootCost={baseCost}
            />
          ) : (
            <div style={{ color: "var(--text-muted)", fontSize: "0.8rem", textAlign: "center", padding: "var(--space-lg)" }}>
              No plan tree available
            </div>
          )}
        </div>

        {/* Right: Current Plan */}
        <div className="glass-card-static" style={{ padding: "var(--space-md)", overflowX: "auto", minWidth: 0 }}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            paddingBottom: "var(--space-sm)", borderBottom: "1px solid var(--border)", marginBottom: "var(--space-md)",
          }}>
            <div>
              <span style={{
                fontSize: "0.7rem", fontWeight: 700, padding: "2px 8px", borderRadius: "var(--radius-full)",
                background: currentPlan.regression ? "rgba(239, 68, 68, 0.15)" : "rgba(59, 130, 246, 0.15)",
                color: currentPlan.regression ? "var(--signal-critical)" : "var(--brand)",
                textTransform: "uppercase",
              }}>
                {currentPlan.regression ? "Regressed Plan" : "Current Plan"}
              </span>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 4 }}>
                {new Date(currentPlan.capturedAt).toLocaleString()}
              </div>
            </div>
            <div style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
              Cost: {formatCost(currentCost)}
            </div>
          </div>

          {currentRoot ? (
            <DiffNodeTree
              node={currentRoot}
              path="curr"
              collapsed={collapsedNodes}
              onToggle={toggleNode}
              side="current"
              rootCost={currentCost}
            />
          ) : (
            <div style={{ color: "var(--text-muted)", fontSize: "0.8rem", textAlign: "center", padding: "var(--space-lg)" }}>
              No plan tree available
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- Diff Node Tree Recursive Component ---------- */

function DiffNodeTree({
  node,
  path,
  collapsed,
  onToggle,
  side,
  rootCost,
}: {
  node: PlanNode;
  path: string;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  side: "base" | "current";
  rootCost: number;
}) {
  const isCollapsed = collapsed.has(path);
  const hasChildren = Array.isArray(node.Plans) && node.Plans.length > 0;
  const style = getNodeStyle(node["Node Type"]);

  const nodeCost = node["Total Cost"] ?? 0;
  const costPct = rootCost > 0 ? (nodeCost / rootCost) * 100 : 0;
  const isHighCost = costPct > 40;

  const isSeqScan = (node["Node Type"] || "").toLowerCase().includes("seq scan");
  const isIndex = (node["Node Type"] || "").toLowerCase().includes("index");

  return (
    <div style={{ marginLeft: path.split(".").length > 1 ? 16 : 0, marginTop: 8 }}>
      <div
        style={{
          border: `1px solid ${style.border}`,
          borderRadius: "var(--radius-md)",
          background: style.bg,
          padding: "8px 10px",
          transition: "all var(--transition-fast)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flex: 1 }}>
            {hasChildren && (
              <button
                onClick={() => onToggle(path)}
                style={{
                  background: "transparent", border: "none", cursor: "pointer",
                  fontSize: "0.7rem", color: "var(--text-muted)", padding: 0,
                }}
              >
                {isCollapsed ? "▶" : "▼"}
              </button>
            )}
            <span style={{ fontSize: "0.9rem" }}>{style.icon}</span>
            <span style={{ fontWeight: 600, fontSize: "0.82rem", color: "var(--text-primary)", whiteSpace: "nowrap" }}>
              {node["Node Type"]}
            </span>

            {node["Relation Name"] && (
              <span style={{
                fontSize: "0.72rem", fontFamily: "var(--font-mono)",
                background: "var(--surface)", border: "1px solid var(--border)",
                padding: "1px 5px", borderRadius: 3, color: "var(--text-secondary)",
              }}>
                {node["Relation Name"]}
              </span>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            {isSeqScan && (
              <span style={{
                fontSize: "0.65rem", fontWeight: 700, padding: "1px 5px",
                background: "rgba(239, 68, 68, 0.2)", color: "var(--signal-critical)",
                borderRadius: 3,
              }}>
                SEQ SCAN
              </span>
            )}
            {isIndex && (
              <span style={{
                fontSize: "0.65rem", fontWeight: 700, padding: "1px 5px",
                background: "rgba(16, 185, 129, 0.2)", color: "var(--signal-healthy)",
                borderRadius: 3,
              }}>
                INDEX
              </span>
            )}
            <span style={{
              fontSize: "0.75rem", fontFamily: "var(--font-mono)",
              color: isHighCost ? "var(--signal-warning)" : "var(--text-muted)", fontWeight: isHighCost ? 700 : 400,
            }}>
              {formatCost(nodeCost)}
            </span>
          </div>
        </div>

        {/* Node details: index name, rows, condition */}
        <div style={{
          marginTop: 6, paddingTop: 4, borderTop: "1px dashed rgba(255,255,255,0.06)",
          fontSize: "0.72rem", color: "var(--text-muted)", display: "flex", flexDirection: "column", gap: 2,
        }}>
          {node["Index Name"] && (
            <div>
              <strong style={{ color: "var(--text-secondary)" }}>Index: </strong>
              <code style={{ fontFamily: "var(--font-mono)", color: "var(--brand)" }}>{node["Index Name"]}</code>
            </div>
          )}
          {node["Plan Rows"] !== undefined && (
            <div>
              <strong style={{ color: "var(--text-secondary)" }}>Est. Rows: </strong>
              <span style={{ fontFamily: "var(--font-mono)" }}>{formatNumber(node["Plan Rows"])}</span>
            </div>
          )}
          {node["Filter"] && (
            <div style={{ wordBreak: "break-all" }}>
              <strong style={{ color: "var(--signal-warning)" }}>Filter: </strong>
              <code style={{ fontFamily: "var(--font-mono)", fontSize: "0.68rem" }}>{node["Filter"]}</code>
            </div>
          )}
          {node["Index Cond"] && (
            <div style={{ wordBreak: "break-all" }}>
              <strong style={{ color: "var(--signal-healthy)" }}>Index Cond: </strong>
              <code style={{ fontFamily: "var(--font-mono)", fontSize: "0.68rem" }}>{node["Index Cond"]}</code>
            </div>
          )}
        </div>
      </div>

      {/* Children */}
      {!isCollapsed && hasChildren && (
        <div style={{ borderLeft: "1px dashed var(--border)", marginLeft: 8, paddingLeft: 4 }}>
          {node.Plans!.map((child, idx) => (
            <DiffNodeTree
              key={`${path}.${idx}`}
              node={child}
              path={`${path}.${idx}`}
              collapsed={collapsed}
              onToggle={onToggle}
              side={side}
              rootCost={rootCost}
            />
          ))}
        </div>
      )}
    </div>
  );
}
