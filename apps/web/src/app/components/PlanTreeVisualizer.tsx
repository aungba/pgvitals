"use client";

import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";

/* ===================================================================
   Plan Tree Visualizer — Premium EXPLAIN Plan Visualization
   
   Renders PostgreSQL EXPLAIN (FORMAT JSON) as an interactive tree
   with SVG connector lines, cost bars, and color-coded node types.
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
  "Strategy"?: string;
  "Actual Total Time"?: number;
  "Actual Rows"?: number;
  "Actual Loops"?: number;
  Plans?: PlanNode[];
  [key: string]: any;
}

interface PlanTreeVisualizerProps {
  plan: any;
}

/* ---------- Node type → color mapping ---------- */

interface NodeStyle {
  border: string;
  bg: string;
  icon: string;
}

function getNodeStyle(nodeType: string): NodeStyle {
  const t = nodeType.toLowerCase();
  if (t.includes("seq scan"))
    return { border: "#f59e0b", bg: "rgba(245, 158, 11, 0.08)", icon: "⚠️" };
  if (t.includes("index only"))
    return { border: "#10b981", bg: "rgba(16, 185, 129, 0.08)", icon: "⚡" };
  if (t.includes("index scan") || t.includes("bitmap index"))
    return { border: "#10b981", bg: "rgba(16, 185, 129, 0.08)", icon: "🔍" };
  if (t.includes("bitmap heap"))
    return { border: "#06b6d4", bg: "rgba(6, 182, 212, 0.08)", icon: "📄" };
  if (t.includes("hash join") || t.includes("merge join"))
    return { border: "#3b82f6", bg: "rgba(59, 130, 246, 0.08)", icon: "🔗" };
  if (t.includes("nested loop"))
    return { border: "#eab308", bg: "rgba(234, 179, 8, 0.08)", icon: "🔄" };
  if (t.includes("sort"))
    return { border: "#a855f7", bg: "rgba(168, 85, 247, 0.08)", icon: "↕️" };
  if (t.includes("aggregate") || t.includes("group"))
    return { border: "#06b6d4", bg: "rgba(6, 182, 212, 0.08)", icon: "∑" };
  if (t.includes("hash"))
    return { border: "#6366f1", bg: "rgba(99, 102, 241, 0.08)", icon: "#" };
  if (t.includes("materialize"))
    return { border: "#8b5cf6", bg: "rgba(139, 92, 246, 0.08)", icon: "📦" };
  if (t.includes("limit"))
    return { border: "#64748b", bg: "rgba(100, 116, 139, 0.08)", icon: "✂️" };
  if (t.includes("append") || t.includes("merge append"))
    return { border: "#0ea5e9", bg: "rgba(14, 165, 233, 0.08)", icon: "➕" };
  return { border: "#64748b", bg: "rgba(100, 116, 139, 0.06)", icon: "○" };
}

/* ---------- Cost bar gradient ---------- */

function getCostBarColor(pct: number): string {
  if (pct < 25) return "#10b981";
  if (pct < 50) return "#eab308";
  if (pct < 75) return "#f59e0b";
  return "#ef4444";
}

/* ---------- Format numbers ---------- */

function formatNumber(n: number | undefined): string {
  if (n === undefined || n === null) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/* ---------- Node Card Component ---------- */

const NodeCard: React.FC<{
  node: PlanNode;
  rootCost: number;
  nodeId: string;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
}> = ({ node, rootCost, nodeId, collapsed, onToggle }) => {
  const style = getNodeStyle(node["Node Type"]);
  const cost = node["Total Cost"] ?? 0;
  const costPct = rootCost > 0 ? (cost / rootCost) * 100 : 0;
  const hasChildren = node.Plans && node.Plans.length > 0;
  const isCollapsed = collapsed.has(nodeId);
  const relation = node["Relation Name"] || node["Index Name"] || node["Alias"] || "";
  const condition = node["Filter"] || node["Index Cond"] || node["Hash Cond"] || "";

  return (
    <div
      onClick={hasChildren ? () => onToggle(nodeId) : undefined}
      style={{
        width: 260,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderLeft: `4px solid ${style.border}`,
        borderRadius: "var(--radius-md)",
        padding: "12px 14px",
        cursor: hasChildren ? "pointer" : "default",
        transition: "all 0.2s ease",
        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
        position: "relative",
        userSelect: "none",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = `0 4px 16px rgba(0,0,0,0.15), 0 0 0 1px ${style.border}40`;
        (e.currentTarget as HTMLDivElement).style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)";
        (e.currentTarget as HTMLDivElement).style.transform = "none";
      }}
    >
      {/* Node type header */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: "0.85rem" }}>{style.icon}</span>
        <span style={{
          fontSize: "0.8rem", fontWeight: 700, color: "var(--text-primary)",
          letterSpacing: "-0.01em",
        }}>
          {node["Node Type"]}
        </span>
        {hasChildren && (
          <span style={{
            marginLeft: "auto", fontSize: "0.65rem", color: "var(--text-muted)",
            width: 18, height: 18, display: "flex", alignItems: "center",
            justifyContent: "center", borderRadius: "50%",
            background: "var(--surface-alt)", transition: "transform 0.2s ease",
            transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
          }}>
            ▼
          </span>
        )}
      </div>

      {/* Table/index name */}
      {relation && (
        <div style={{
          fontSize: "0.72rem", color: style.border, fontFamily: "var(--font-mono)",
          marginBottom: 8, opacity: 0.9,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {relation}
        </div>
      )}

      {/* Cost bar */}
      <div style={{
        height: 4, borderRadius: 2, background: "var(--surface-alt)",
        marginBottom: 8, overflow: "hidden",
      }}>
        <div style={{
          height: "100%", borderRadius: 2,
          width: `${Math.min(costPct, 100)}%`,
          background: getCostBarColor(costPct),
          transition: "width 0.3s ease",
        }} />
      </div>

      {/* Metrics row */}
      <div style={{
        display: "flex", justifyContent: "space-between",
        fontSize: "0.68rem", color: "var(--text-muted)",
      }}>
        <span>Rows: <b style={{ color: "var(--text-secondary)" }}>{formatNumber(node["Plan Rows"])}</b></span>
        <span>Cost: <b style={{ color: "var(--text-secondary)" }}>{formatNumber(cost)}</b></span>
        <span style={{
          color: getCostBarColor(costPct), fontWeight: 600,
        }}>{costPct.toFixed(0)}%</span>
      </div>

      {/* Condition (truncated) */}
      {condition && (
        <div style={{
          marginTop: 6, fontSize: "0.65rem", color: "var(--text-muted)",
          fontFamily: "var(--font-mono)", overflow: "hidden",
          textOverflow: "ellipsis", whiteSpace: "nowrap",
          padding: "3px 6px", background: "var(--surface-alt)",
          borderRadius: "var(--radius-sm)",
        }} title={condition}>
          {condition.length > 40 ? condition.slice(0, 40) + "…" : condition}
        </div>
      )}

      {/* Actual time badge (if EXPLAIN ANALYZE) */}
      {node["Actual Total Time"] !== undefined && (
        <div style={{
          position: "absolute", top: -8, right: 12,
          fontSize: "0.6rem", fontWeight: 700, padding: "2px 8px",
          background: node["Actual Total Time"] > 100 ? "#ef4444" : "#10b981",
          color: "#fff", borderRadius: 10,
        }}>
          {node["Actual Total Time"].toFixed(1)}ms
        </div>
      )}
    </div>
  );
};

/* ---------- Recursive Tree Renderer ---------- */

interface NodePosition {
  x: number;
  y: number;
  width: number;
}

const NODE_W = 260;
const NODE_H = 130;
const GAP_X = 32;
const GAP_Y = 60;

function measureTree(node: PlanNode, collapsed: Set<string>, id = "0"): { width: number; height: number } {
  const hasChildren = node.Plans && node.Plans.length > 0 && !collapsed.has(id);
  if (!hasChildren) {
    return { width: NODE_W, height: NODE_H };
  }
  let totalChildWidth = 0;
  let maxChildHeight = 0;
  node.Plans!.forEach((child, i) => {
    const childId = `${id}-${i}`;
    const m = measureTree(child, collapsed, childId);
    totalChildWidth += m.width;
    maxChildHeight = Math.max(maxChildHeight, m.height);
    if (i < node.Plans!.length - 1) totalChildWidth += GAP_X;
  });
  return {
    width: Math.max(NODE_W, totalChildWidth),
    height: NODE_H + GAP_Y + maxChildHeight,
  };
}

const TreeNode: React.FC<{
  node: PlanNode;
  rootCost: number;
  nodeId: string;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  svgLines: Array<{ x1: number; y1: number; x2: number; y2: number; color: string }>;
  offsetX: number;
  offsetY: number;
}> = ({ node, rootCost, nodeId, collapsed, onToggle, svgLines, offsetX, offsetY }) => {
  const hasChildren = node.Plans && node.Plans.length > 0 && !collapsed.has(nodeId);
  const treeSize = measureTree(node, collapsed, nodeId);

  // Center this node within its allocated width
  const nodeX = offsetX + (treeSize.width - NODE_W) / 2;
  const nodeY = offsetY;

  // Calculate child positions
  let childElements: React.ReactNode[] = [];
  if (hasChildren) {
    let childX = offsetX;
    node.Plans!.forEach((child, i) => {
      const childId = `${nodeId}-${i}`;
      const childSize = measureTree(child, collapsed, childId);
      const childNodeX = childX + (childSize.width - NODE_W) / 2;
      const childNodeY = nodeY + NODE_H + GAP_Y;

      // Add connector line
      const childStyle = getNodeStyle(child["Node Type"]);
      svgLines.push({
        x1: nodeX + NODE_W / 2,
        y1: nodeY + NODE_H,
        x2: childNodeX + NODE_W / 2,
        y2: childNodeY,
        color: childStyle.border,
      });

      childElements.push(
        <TreeNode
          key={childId}
          node={child}
          rootCost={rootCost}
          nodeId={childId}
          collapsed={collapsed}
          onToggle={onToggle}
          svgLines={svgLines}
          offsetX={childX}
          offsetY={childNodeY}
        />
      );

      childX += childSize.width + GAP_X;
    });
  }

  return (
    <>
      <div style={{
        position: "absolute",
        left: nodeX,
        top: nodeY,
        transition: "all 0.3s ease",
      }}>
        <NodeCard
          node={node}
          rootCost={rootCost}
          nodeId={nodeId}
          collapsed={collapsed}
          onToggle={onToggle}
        />
      </div>
      {childElements}
    </>
  );
};

/* ---------- Main Visualizer ---------- */

export default function PlanTreeVisualizer({ plan }: PlanTreeVisualizerProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  // Resolve root node
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

  const rootCost = rootNode?.["Total Cost"] ?? 1;

  const onToggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (!rootNode) {
    return (
      <div style={{
        padding: "var(--space-xl)", textAlign: "center",
        color: "var(--text-muted)", fontSize: "0.9rem",
      }}>
        No valid plan data to visualize
      </div>
    );
  }

  // Calculate dimensions and collect SVG lines
  const treeSize = measureTree(rootNode, collapsed, "0");
  const svgLines: Array<{ x1: number; y1: number; x2: number; y2: number; color: string }> = [];

  const totalWidth = treeSize.width + 40;
  const totalHeight = treeSize.height + 40;

  return (
    <div
      ref={containerRef}
      style={{
        overflow: "auto",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--border)",
        background: "var(--bg)",
        padding: 20,
      }}
    >
      <div style={{
        position: "relative",
        width: totalWidth,
        height: totalHeight,
        minWidth: "100%",
      }}>
        {/* SVG layer for connector lines */}
        <svg
          width={totalWidth}
          height={totalHeight}
          style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}
        >
          <defs>
            <filter id="glow">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {/* Render connector lines - we need to re-traverse to get them */}
          <ConnectorLines rootNode={rootNode} collapsed={collapsed} offsetX={20} offsetY={20} />
        </svg>

        {/* Node cards layer */}
        <TreeNode
          node={rootNode}
          rootCost={rootCost}
          nodeId="0"
          collapsed={collapsed}
          onToggle={onToggle}
          svgLines={svgLines}
          offsetX={20}
          offsetY={20}
        />
      </div>
    </div>
  );
}

/* ---------- SVG Connector Lines ---------- */

const ConnectorLines: React.FC<{
  rootNode: PlanNode;
  collapsed: Set<string>;
  offsetX: number;
  offsetY: number;
}> = ({ rootNode, collapsed, offsetX, offsetY }) => {
  const lines: React.ReactNode[] = [];

  function traverse(node: PlanNode, nodeId: string, ox: number, oy: number) {
    const treeSize = measureTree(node, collapsed, nodeId);
    const nodeX = ox + (treeSize.width - NODE_W) / 2;
    const nodeY = oy;
    const hasChildren = node.Plans && node.Plans.length > 0 && !collapsed.has(nodeId);

    if (hasChildren) {
      let childX = ox;
      node.Plans!.forEach((child, i) => {
        const childId = `${nodeId}-${i}`;
        const childSize = measureTree(child, collapsed, childId);
        const childNodeX = childX + (childSize.width - NODE_W) / 2;
        const childNodeY = nodeY + NODE_H + GAP_Y;

        const x1 = nodeX + NODE_W / 2;
        const y1 = nodeY + NODE_H;
        const x2 = childNodeX + NODE_W / 2;
        const y2 = childNodeY;
        const midY = y1 + (y2 - y1) / 2;

        const childStyle = getNodeStyle(child["Node Type"]);

        lines.push(
          <path
            key={`line-${childId}`}
            d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
            fill="none"
            stroke={childStyle.border}
            strokeWidth={2}
            strokeOpacity={0.5}
            filter="url(#glow)"
          />
        );

        // Arrow head
        lines.push(
          <polygon
            key={`arrow-${childId}`}
            points={`${x2 - 4},${y2 - 6} ${x2 + 4},${y2 - 6} ${x2},${y2}`}
            fill={childStyle.border}
            fillOpacity={0.7}
          />
        );

        traverse(child, childId, childX, childNodeY);
        childX += childSize.width + GAP_X;
      });
    }
  }

  traverse(rootNode, "0", offsetX, offsetY);
  return <>{lines}</>;
};
