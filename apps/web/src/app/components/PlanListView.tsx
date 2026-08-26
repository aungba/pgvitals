"use client";

import React, { useMemo } from "react";

/* ===================================================================
   Plan List View — Flat indented table view of EXPLAIN plan nodes
   =================================================================== */

interface PlanNode {
  "Node Type": string;
  "Total Cost"?: number;
  "Startup Cost"?: number;
  "Plan Rows"?: number;
  "Plan Width"?: number;
  "Relation Name"?: string;
  "Index Name"?: string;
  "Filter"?: string;
  "Index Cond"?: string;
  "Join Type"?: string;
  "Hash Cond"?: string;
  "Sort Key"?: string[];
  "Actual Total Time"?: number;
  "Actual Rows"?: number;
  Plans?: PlanNode[];
  [key: string]: any;
}

interface PlanListViewProps {
  plan: any;
}

interface FlatRow {
  node: PlanNode;
  depth: number;
}

function flatten(node: PlanNode, depth = 0): FlatRow[] {
  const rows: FlatRow[] = [{ node, depth }];
  if (node.Plans) {
    for (const child of node.Plans) {
      rows.push(...flatten(child, depth + 1));
    }
  }
  return rows;
}

function getNodeDotColor(nodeType: string): string {
  const t = nodeType.toLowerCase();
  if (t.includes("seq scan")) return "#f59e0b";
  if (t.includes("index")) return "#10b981";
  if (t.includes("hash") || t.includes("merge")) return "#3b82f6";
  if (t.includes("nested loop")) return "#eab308";
  if (t.includes("sort")) return "#a855f7";
  if (t.includes("aggregate")) return "#06b6d4";
  if (t.includes("bitmap heap")) return "#06b6d4";
  return "#64748b";
}

function formatNum(n: number | undefined): string {
  if (n === undefined || n === null) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function PlanListView({ plan }: PlanListViewProps) {
  const rootNode: PlanNode | null = useMemo(() => {
    if (!plan) return null;
    if (Array.isArray(plan)) {
      const first = plan[0];
      return first?.Plan || first;
    }
    if (plan.Plan) return plan.Plan;
    if (plan["Node Type"]) return plan;
    return null;
  }, [plan]);

  const rows = useMemo(() => {
    if (!rootNode) return [];
    return flatten(rootNode);
  }, [rootNode]);

  const rootCost = rootNode?.["Total Cost"] ?? 1;

  if (!rootNode || rows.length === 0) {
    return (
      <div style={{ padding: "var(--space-lg)", textAlign: "center", color: "var(--text-muted)" }}>
        No plan data to display
      </div>
    );
  }

  return (
    <div style={{
      borderRadius: "var(--radius-md)", border: "1px solid var(--border)",
      overflow: "auto", background: "var(--bg)",
    }}>
      <table style={{
        width: "100%", borderCollapse: "collapse", fontSize: "0.78rem",
      }}>
        <thead>
          <tr style={{
            background: "var(--surface-alt)", position: "sticky", top: 0, zIndex: 1,
          }}>
            {["Node Operation", "Object", "Cost", "Rows", "Width", "Condition"].map((h) => (
              <th key={h} style={{
                padding: "10px 14px", textAlign: "left", fontWeight: 700,
                fontSize: "0.7rem", textTransform: "uppercase",
                letterSpacing: "0.05em", color: "var(--text-muted)",
                borderBottom: "2px solid var(--border)",
                whiteSpace: "nowrap",
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const { node, depth } = row;
            const cost = node["Total Cost"] ?? 0;
            const costPct = rootCost > 0 ? (cost / rootCost) * 100 : 0;
            const dotColor = getNodeDotColor(node["Node Type"]);
            const isSeqScan = node["Node Type"].toLowerCase().includes("seq scan");
            const relation = node["Relation Name"] || node["Index Name"] || "";
            const condition = node["Filter"] || node["Index Cond"] || node["Hash Cond"] || "";

            return (
              <tr
                key={i}
                style={{
                  background: isSeqScan
                    ? "rgba(245, 158, 11, 0.06)"
                    : i % 2 === 0 ? "transparent" : "var(--surface-alt)",
                  borderBottom: "1px solid var(--border)",
                  transition: "background 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLTableRowElement).style.background =
                    isSeqScan ? "rgba(245, 158, 11, 0.12)" : "var(--surface-alt)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLTableRowElement).style.background =
                    isSeqScan
                      ? "rgba(245, 158, 11, 0.06)"
                      : i % 2 === 0 ? "transparent" : "var(--surface-alt)";
                }}
              >
                {/* Node Type with indent + colored dot */}
                <td style={{ padding: "8px 14px", paddingLeft: 14 + depth * 24, whiteSpace: "nowrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {/* Tree indent lines */}
                    {depth > 0 && (
                      <span style={{
                        color: "var(--text-muted)", fontSize: "0.7rem", opacity: 0.4,
                      }}>
                        {"└─".padStart(1)}
                      </span>
                    )}
                    {/* Colored dot */}
                    <span style={{
                      width: 8, height: 8, borderRadius: "50%",
                      background: dotColor, flexShrink: 0,
                      boxShadow: `0 0 6px ${dotColor}60`,
                    }} />
                    <span style={{
                      fontWeight: 600, color: "var(--text-primary)",
                    }}>
                      {node["Node Type"]}
                    </span>
                    {isSeqScan && (
                      <span style={{
                        fontSize: "0.6rem", padding: "1px 6px",
                        background: "#f59e0b", color: "#fff",
                        borderRadius: 8, fontWeight: 700,
                      }}>
                        SEQ
                      </span>
                    )}
                  </div>
                </td>

                {/* Object (table/index) */}
                <td style={{
                  padding: "8px 14px", fontFamily: "var(--font-mono)",
                  fontSize: "0.72rem", color: dotColor, whiteSpace: "nowrap",
                }}>
                  {relation || "—"}
                </td>

                {/* Cost with mini bar */}
                <td style={{ padding: "8px 14px", minWidth: 120 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{
                      fontWeight: 600, fontSize: "0.72rem",
                      fontFamily: "var(--font-mono)", color: "var(--text-secondary)",
                      minWidth: 50,
                    }}>
                      {formatNum(cost)}
                    </span>
                    <div style={{
                      flex: 1, height: 4, borderRadius: 2,
                      background: "var(--surface-alt)", overflow: "hidden",
                      minWidth: 40, maxWidth: 80,
                    }}>
                      <div style={{
                        height: "100%", borderRadius: 2,
                        width: `${Math.min(costPct, 100)}%`,
                        background: costPct > 75 ? "#ef4444" : costPct > 50 ? "#f59e0b" : costPct > 25 ? "#eab308" : "#10b981",
                      }} />
                    </div>
                  </div>
                </td>

                {/* Rows */}
                <td style={{
                  padding: "8px 14px", fontFamily: "var(--font-mono)",
                  fontSize: "0.72rem", color: "var(--text-secondary)",
                }}>
                  {formatNum(node["Plan Rows"])}
                </td>

                {/* Width */}
                <td style={{
                  padding: "8px 14px", fontFamily: "var(--font-mono)",
                  fontSize: "0.72rem", color: "var(--text-muted)",
                }}>
                  {node["Plan Width"] ?? "—"}
                </td>

                {/* Condition */}
                <td style={{
                  padding: "8px 14px", fontFamily: "var(--font-mono)",
                  fontSize: "0.68rem", color: "var(--text-muted)",
                  maxWidth: 250, overflow: "hidden",
                  textOverflow: "ellipsis", whiteSpace: "nowrap",
                }} title={condition}>
                  {condition || "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
