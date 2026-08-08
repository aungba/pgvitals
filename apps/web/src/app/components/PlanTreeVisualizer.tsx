"use client";

import React, { useState, useMemo } from 'react';

export interface PlanNode {
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

export interface PlanTreeVisualizerProps {
  plan: any;
}

const getNodeColor = (nodeType: string) => {
  const lowerType = nodeType.toLowerCase();
  if (lowerType.includes('seq scan')) return 'var(--signal-warning, #f59e0b)';
  if (lowerType.includes('index')) return 'var(--signal-success, #10b981)';
  if (lowerType.includes('hash') || lowerType.includes('merge')) return 'var(--brand, #3b82f6)';
  if (lowerType.includes('nested loop')) return 'var(--signal-warning, #eab308)';
  if (lowerType.includes('sort')) return '#a855f7';
  if (lowerType.includes('aggregate')) return '#06b6d4';
  return 'var(--text-muted, #9ca3af)';
};

const PlanNodeCard: React.FC<{
  node: PlanNode;
  rootTotalCost: number;
  expanded: boolean;
  onToggleExpand: () => void;
}> = ({ node, rootTotalCost, expanded, onToggleExpand }) => {
  const [showTooltip, setShowTooltip] = useState(false);
  
  const nodeType = node["Node Type"] || "Unknown";
  const color = getNodeColor(nodeType);
  const cost = node["Total Cost"] || 0;
  const costPct = rootTotalCost > 0 ? Math.min(100, Math.max(0, (cost / rootTotalCost) * 100)) : 0;
  
  const hasChildren = node.Plans && node.Plans.length > 0;
  
  const getSubtext = () => {
    if (node["Relation Name"]) return `on ${node["Relation Name"]}${node["Alias"] ? ` (${node["Alias"]})` : ''}`;
    if (node["Index Name"]) return `using ${node["Index Name"]}`;
    if (node["Join Type"]) return `${node["Join Type"]} Join`;
    if (node["Sort Key"]) return `by ${node["Sort Key"].join(', ')}`;
    return null;
  };
  
  const subtext = getSubtext();
  const filterCond = node["Filter"] || node["Index Cond"] || node["Hash Cond"];

  return (
    <div 
      style={{
        position: 'relative',
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        margin: '0 var(--space-md, 16px)',
      }}
    >
      <div 
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        style={{
          background: 'var(--surface, #ffffff)',
          border: `1px solid var(--border, #e5e7eb)`,
          borderTop: `4px solid ${color}`,
          borderRadius: 'var(--radius-md, 8px)',
          padding: 'var(--space-md, 16px)',
          minWidth: '220px',
          maxWidth: '300px',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
          cursor: hasChildren ? 'pointer' : 'default',
          position: 'relative',
          zIndex: 2,
          transition: 'box-shadow 0.2s, transform 0.2s',
          textAlign: 'left',
          ... (hasChildren ? { ":hover": { transform: 'translateY(-2px)' } } : {})
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (hasChildren) onToggleExpand();
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-xs, 4px)' }}>
          <strong style={{ color: 'var(--text-primary, #111827)', fontSize: '1.1em' }}>{nodeType}</strong>
          {hasChildren && (
            <span style={{ color: 'var(--text-muted, #9ca3af)', fontSize: '12px' }}>
              {expanded ? '−' : '+'}
            </span>
          )}
        </div>
        
        {subtext && (
          <div style={{ color: 'var(--text-secondary, #4b5563)', fontSize: '0.9em', marginBottom: 'var(--space-sm, 8px)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {subtext}
          </div>
        )}
        
        {/* Cost Bar */}
        <div style={{ margin: 'var(--space-sm, 8px) 0', fontSize: '0.85em' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px', color: 'var(--text-secondary, #4b5563)' }}>
            <span>Cost: {cost.toFixed(1)}</span>
            <span>{costPct.toFixed(1)}%</span>
          </div>
          <div style={{ width: '100%', height: '6px', background: 'var(--surface-alt, #f3f4f6)', borderRadius: 'var(--radius-sm, 4px)', overflow: 'hidden' }}>
            <div style={{ 
              width: `${costPct}%`, 
              height: '100%', 
              background: `linear-gradient(90deg, var(--signal-success, #10b981) 0%, var(--signal-warning, #f59e0b) 50%, var(--signal-critical, #ef4444) 100%)`,
              backgroundSize: '300px 100%',
              backgroundPosition: `${(costPct / 100) * 100}% 0`
            }} />
          </div>
        </div>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85em', color: 'var(--text-secondary, #4b5563)' }}>
          <span>Rows: {node["Plan Rows"]?.toLocaleString() || '-'}</span>
          {node["Actual Rows"] !== undefined && (
            <span>Act: {node["Actual Rows"].toLocaleString()}</span>
          )}
        </div>

        {filterCond && (
          <div style={{ 
            marginTop: 'var(--space-sm, 8px)', 
            padding: 'var(--space-xs, 4px)', 
            background: 'var(--surface-alt, #f3f4f6)', 
            borderRadius: 'var(--radius-sm, 4px)',
            fontSize: '0.8em',
            fontFamily: 'var(--font-mono, monospace)',
            color: 'var(--text-secondary, #4b5563)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}>
            {filterCond}
          </div>
        )}

        {/* Tooltip */}
        {showTooltip && (
          <div style={{
            position: 'absolute',
            top: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginTop: 'var(--space-sm, 8px)',
            background: 'var(--text-primary, #111827)',
            color: 'var(--bg, #ffffff)',
            padding: 'var(--space-md, 16px)',
            borderRadius: 'var(--radius-md, 8px)',
            fontSize: '0.85em',
            zIndex: 10,
            width: 'max-content',
            maxWidth: '350px',
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
            pointerEvents: 'none',
            whiteSpace: 'pre-wrap',
            fontFamily: 'var(--font-mono, monospace)'
          }}>
            {Object.entries(node).map(([key, val]) => {
              if (key === 'Plans' || typeof val === 'object' && val !== null && !Array.isArray(val)) return null;
              return <div key={key} style={{ marginBottom: '4px' }}>
                <span style={{ color: 'var(--text-muted, #9ca3af)' }}>{key}:</span> {Array.isArray(val) ? val.join(', ') : String(val)}
              </div>;
            })}
          </div>
        )}
      </div>
    </div>
  );
};

const PlanTreeNode: React.FC<{
  node: PlanNode;
  rootTotalCost: number;
  isRoot?: boolean;
}> = ({ node, rootTotalCost, isRoot = false }) => {
  const [expanded, setExpanded] = useState(true);
  
  const hasChildren = node.Plans && node.Plans.length > 0;
  
  return (
    <div className="plan-tree-node" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div className="plan-tree-node-content" style={{ position: 'relative' }}>
        <PlanNodeCard 
          node={node} 
          rootTotalCost={rootTotalCost} 
          expanded={expanded} 
          onToggleExpand={() => setExpanded(!expanded)} 
        />
        {hasChildren && expanded && (
          <div className="tree-line-down" style={{
            position: 'absolute',
            bottom: '-20px',
            left: '50%',
            width: '2px',
            height: '20px',
            background: 'var(--border, #e5e7eb)',
            transform: 'translateX(-50%)',
            zIndex: 1
          }} />
        )}
      </div>
      
      {hasChildren && expanded && (
        <div className="plan-tree-children" style={{
          display: 'flex',
          flexDirection: 'row',
          justifyContent: 'center',
          paddingTop: '20px',
          position: 'relative'
        }}>
          {node.Plans!.map((child, i) => {
            const isFirst = i === 0;
            const isLast = i === node.Plans!.length - 1;
            const isOnly = node.Plans!.length === 1;
            
            return (
              <div key={i} style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 var(--space-md, 16px)' }}>
                {/* Horizontal connecting lines */}
                {!isOnly && (
                  <div style={{
                    position: 'absolute',
                    top: 0,
                    left: isFirst ? '50%' : 0,
                    right: isLast ? '50%' : 0,
                    height: '2px',
                    background: 'var(--border, #e5e7eb)',
                    zIndex: 1
                  }} />
                )}
                {/* Vertical line to child */}
                <div style={{
                  position: 'absolute',
                  top: 0,
                  left: '50%',
                  width: '2px',
                  height: '20px',
                  background: 'var(--border, #e5e7eb)',
                  transform: 'translateX(-50%)',
                  zIndex: 1
                }} />
                
                <div style={{ paddingTop: '20px' }}>
                  <PlanTreeNode node={child} rootTotalCost={rootTotalCost} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default function PlanTreeVisualizer({ plan }: PlanTreeVisualizerProps) {
  const rootNode = useMemo(() => {
    if (!plan) return null;
    return plan.Plan ? plan.Plan : plan;
  }, [plan]);

  if (!rootNode) return <div style={{ color: 'var(--text-secondary, #4b5563)', padding: 'var(--space-md, 16px)' }}>No plan data provided.</div>;

  const rootTotalCost = rootNode["Total Cost"] || 1;

  return (
    <div style={{
      width: '100%',
      overflowX: 'auto',
      overflowY: 'hidden',
      padding: 'var(--space-lg, 32px)',
      background: 'var(--bg, #f9fafb)',
      minHeight: '400px',
      display: 'flex',
      justifyContent: 'center'
    }}>
      <style>{`
        /* Global styles for tooltip scrolling if needed */
        .plan-tree-node-content:hover {
          z-index: 10;
        }
      `}</style>
      <div style={{ minWidth: 'min-content' }}>
        <PlanTreeNode node={rootNode} rootTotalCost={rootTotalCost} isRoot={true} />
      </div>
    </div>
  );
}
