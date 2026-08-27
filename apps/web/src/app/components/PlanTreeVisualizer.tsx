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

/* ---------- Helper to collect all node IDs ---------- */

function collectAllNodeIds(node: PlanNode, id = "0"): string[] {
  const ids: string[] = [];
  if (node.Plans && node.Plans.length > 0) {
    ids.push(id);
    node.Plans.forEach((child, i) => {
      ids.push(...collectAllNodeIds(child, `${id}-${i}`));
    });
  }
  return ids;
}

function countTotalNodes(node: PlanNode): number {
  let count = 1;
  if (node.Plans) {
    node.Plans.forEach((child) => {
      count += countTotalNodes(child);
    });
  }
  return count;
}

/* ---------- Main Visualizer ---------- */

export default function PlanTreeVisualizer({ plan }: PlanTreeVisualizerProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState<number>(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number }>({
    x: 0,
    y: 0,
    scrollLeft: 0,
    scrollTop: 0,
  });

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
  const totalNodesCount = useMemo(() => rootNode ? countTotalNodes(rootNode) : 0, [rootNode]);
  const allCollapsibleIds = useMemo(() => rootNode ? collectAllNodeIds(rootNode, "0") : [], [rootNode]);

  const onToggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleExpandAll = useCallback(() => {
    setCollapsed(new Set());
  }, []);

  const handleCollapseAll = useCallback(() => {
    setCollapsed(new Set(allCollapsibleIds));
  }, [allCollapsibleIds]);

  const handleZoomIn = useCallback(() => {
    setZoom((z) => Math.min(Number((z + 0.15).toFixed(2)), 2.0));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((z) => Math.max(Number((z - 0.15).toFixed(2)), 0.35));
  }, []);

  const handleResetZoom = useCallback(() => {
    setZoom(1);
  }, []);

  // Calculate dimensions
  const treeSize = useMemo(() => {
    if (!rootNode) return { width: NODE_W, height: NODE_H };
    return measureTree(rootNode, collapsed, "0");
  }, [rootNode, collapsed]);

  const totalWidth = treeSize.width + 80;
  const totalHeight = treeSize.height + 60;

  const handleFitToView = useCallback(() => {
    if (!containerRef.current) return;
    const availableWidth = containerRef.current.clientWidth - 40;
    if (availableWidth > 0 && totalWidth > 0) {
      const calculatedZoom = Math.min(1, Math.max(0.35, Number((availableWidth / totalWidth).toFixed(2))));
      setZoom(calculatedZoom);
      containerRef.current.scrollLeft = 0;
      containerRef.current.scrollTop = 0;
    }
  }, [totalWidth]);

  // Pan / Drag handlers
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Only start drag if clicking on the background container (not interactive card elements)
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("input") || target.closest("select")) {
      return;
    }
    if (!containerRef.current) return;
    setIsPanning(true);
    panStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      scrollLeft: containerRef.current.scrollLeft,
      scrollTop: containerRef.current.scrollTop,
    };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isPanning || !containerRef.current) return;
    e.preventDefault();
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    containerRef.current.scrollLeft = panStartRef.current.scrollLeft - dx;
    containerRef.current.scrollTop = panStartRef.current.scrollTop - dy;
  }, [isPanning]);

  const handleMouseUpOrLeave = useCallback(() => {
    if (isPanning) {
      setIsPanning(false);
    }
  }, [isPanning]);

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

  const svgLines: Array<{ x1: number; y1: number; x2: number; y2: number; color: string }> = [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", width: "100%", maxWidth: "100%" }}>
      {/* ── Visualizer Toolbar ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: "var(--space-sm)", flexWrap: "wrap", padding: "6px 12px",
        background: "var(--surface-alt)", borderRadius: "var(--radius-md)",
        border: "1px solid var(--border)", fontSize: "0.75rem",
      }}>
        {/* Left: Info stats */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--text-secondary)" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontWeight: 600 }}>
            <span>🌳</span>
            <span>{totalNodesCount} Nodes</span>
          </span>
          <span style={{ color: "var(--border)" }}>|</span>
          <span>Max Cost: <strong style={{ color: "var(--text-primary)" }}>{rootCost.toLocaleString(undefined, { maximumFractionDigits: 1 })}</strong></span>
        </div>

        {/* Right: Actions (Expand/Collapse, Zoom, Fit) */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {/* Expand / Collapse all */}
          <div style={{ display: "inline-flex", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", overflow: "hidden" }}>
            <button
              onClick={handleExpandAll}
              style={{
                padding: "3px 8px", fontSize: "0.7rem", background: "var(--surface)",
                color: "var(--text-secondary)", borderRight: "1px solid var(--border)", cursor: "pointer",
              }}
              title="Expand all nodes"
            >
              ⊞ Expand All
            </button>
            <button
              onClick={handleCollapseAll}
              style={{
                padding: "3px 8px", fontSize: "0.7rem", background: "var(--surface)",
                color: "var(--text-secondary)", cursor: "pointer",
              }}
              title="Collapse all child nodes"
            >
              ⊟ Collapse All
            </button>
          </div>

          {/* Zoom controls */}
          <div style={{ display: "inline-flex", alignItems: "center", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", overflow: "hidden", background: "var(--surface)" }}>
            <button
              onClick={handleZoomOut}
              disabled={zoom <= 0.35}
              style={{
                padding: "3px 8px", fontSize: "0.8rem", fontWeight: 700,
                background: "transparent", borderRight: "1px solid var(--border)",
                color: zoom <= 0.35 ? "var(--text-muted)" : "var(--text-primary)",
                cursor: zoom <= 0.35 ? "not-allowed" : "pointer",
              }}
              title="Zoom out"
            >
              −
            </button>
            <button
              onClick={handleResetZoom}
              style={{
                padding: "3px 8px", fontSize: "0.7rem", fontWeight: 600,
                background: "transparent", borderRight: "1px solid var(--border)",
                color: "var(--text-secondary)", minWidth: 44, textAlign: "center", cursor: "pointer",
              }}
              title="Reset zoom to 100%"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              onClick={handleZoomIn}
              disabled={zoom >= 2.0}
              style={{
                padding: "3px 8px", fontSize: "0.8rem", fontWeight: 700,
                background: "transparent", borderRight: "1px solid var(--border)",
                color: zoom >= 2.0 ? "var(--text-muted)" : "var(--text-primary)",
                cursor: zoom >= 2.0 ? "not-allowed" : "pointer",
              }}
              title="Zoom in"
            >
              +
            </button>
            <button
              onClick={handleFitToView}
              style={{
                padding: "3px 8px", fontSize: "0.7rem", fontWeight: 600,
                background: "transparent", color: "var(--brand)", cursor: "pointer",
              }}
              title="Fit tree width to container"
            >
              ⛶ Fit
            </button>
          </div>
        </div>
      </div>

      {/* ── Scrollable / Pannable Tree Canvas ── */}
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUpOrLeave}
        onMouseLeave={handleMouseUpOrLeave}
        style={{
          overflowX: "auto",
          overflowY: "auto",
          maxWidth: "100%",
          width: "100%",
          maxHeight: "72vh",
          minHeight: 420,
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--border)",
          background: "radial-gradient(ellipse at 50% 50%, var(--surface-alt) 0%, var(--bg) 100%)",
          padding: 24,
          position: "relative",
          cursor: isPanning ? "grabbing" : "grab",
          userSelect: isPanning ? "none" : "auto",
          boxSizing: "border-box",
        }}
      >
        {/* Scaled wrapper to enable natural scroll area calculation */}
        <div style={{
          width: totalWidth * zoom,
          height: totalHeight * zoom,
          minWidth: "100%",
          position: "relative",
        }}>
          <div style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: totalWidth,
            height: totalHeight,
            transform: `scale(${zoom})`,
            transformOrigin: "0 0",
            transition: isPanning ? "none" : "transform 0.15s ease-out",
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
              {/* Render connector lines */}
              <ConnectorLines rootNode={rootNode} collapsed={collapsed} offsetX={30} offsetY={20} />
            </svg>

            {/* Node cards layer */}
            <TreeNode
              node={rootNode}
              rootCost={rootCost}
              nodeId="0"
              collapsed={collapsed}
              onToggle={onToggle}
              svgLines={svgLines}
              offsetX={30}
              offsetY={20}
            />
          </div>
        </div>
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
