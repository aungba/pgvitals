"use client";

import React, { useMemo } from 'react';

export interface PlanNode {
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
  Plans?: PlanNode[];
}

export interface PlanListViewProps {
  plan: any;
}

interface FlattenedNode {
  node: PlanNode;
  depth: number;
}

function flattenPlan(node: PlanNode, depth = 0): FlattenedNode[] {
  const result: FlattenedNode[] = [{ node, depth }];
  if (node.Plans) {
    for (const child of node.Plans) {
      result.push(...flattenPlan(child, depth + 1));
    }
  }
  return result;
}

function getNodeColor(nodeType: string): string {
  const type = nodeType.toLowerCase();
  if (type.includes('seq scan')) return 'var(--brand, #f97316)'; // orange
  if (type.includes('index scan')) return 'var(--success, #22c55e)'; // green
  if (type.includes('join')) return 'var(--info, #3b82f6)'; // blue
  if (type.includes('sort')) return 'var(--accent, #a855f7)'; // purple
  if (type.includes('hash')) return 'var(--warning, #eab308)'; // yellow
  return 'var(--text-secondary, #6b7280)';
}

function getCondition(node: PlanNode): string | undefined {
  if (node["Hash Cond"]) return node["Hash Cond"];
  if (node["Index Cond"]) return node["Index Cond"];
  if (node["Filter"]) return node["Filter"];
  if (node["Sort Key"]) return `Sort by: ${node["Sort Key"].join(', ')}`;
  return undefined;
}

export function PlanListView({ plan }: PlanListViewProps) {
  const rootNode = plan?.Plan || plan;

  const { nodes, maxCost } = useMemo(() => {
    if (!rootNode || !rootNode["Node Type"]) return { nodes: [], maxCost: 0 };
    const flattened = flattenPlan(rootNode);
    let max = 0;
    flattened.forEach(f => {
      if (f.node["Total Cost"] && f.node["Total Cost"] > max) {
        max = f.node["Total Cost"];
      }
    });
    return { nodes: flattened, maxCost: max };
  }, [rootNode]);

  if (!nodes.length) {
    return <div className="plan-list-empty">No plan data available</div>;
  }

  return (
    <div className="plan-list-container">
      <table className="plan-list-table">
        <thead>
          <tr>
            <th>Node Type</th>
            <th>Table / Index</th>
            <th>Cost</th>
            <th>Rows</th>
            <th>Width</th>
            <th>Condition</th>
          </tr>
        </thead>
        <tbody>
          {nodes.map((f, i) => {
            const isSeqScan = f.node["Node Type"] === 'Seq Scan';
            const color = getNodeColor(f.node["Node Type"]);
            const condition = getCondition(f.node);
            const target = f.node["Relation Name"] || f.node["Index Name"] || '-';
            const costPct = maxCost > 0 && f.node["Total Cost"] ? (f.node["Total Cost"] / maxCost) * 100 : 0;
            
            return (
              <tr 
                key={i} 
                className={`plan-list-row ${isSeqScan ? 'plan-list-row-seqscan' : ''} ${i % 2 === 0 ? 'row-even' : 'row-odd'}`}
              >
                <td style={{ paddingLeft: `calc(var(--space-md, 16px) + ${f.depth * 20}px)` }}>
                  <div className="node-type-cell">
                    <span className="node-dot" style={{ backgroundColor: color }}></span>
                    <span className="node-type-text">{f.node["Node Type"]}</span>
                  </div>
                </td>
                <td>{target}</td>
                <td>
                  <div className="cost-cell">
                    <div className="cost-text">{f.node["Total Cost"]?.toFixed(2) || '-'}</div>
                    {f.node["Total Cost"] !== undefined && (
                      <div className="cost-bar-container">
                        <div className="cost-bar" style={{ width: `${costPct}%`, backgroundColor: color }}></div>
                      </div>
                    )}
                  </div>
                </td>
                <td>{f.node["Plan Rows"]?.toLocaleString() || '-'}</td>
                <td>{f.node["Plan Width"] || '-'}</td>
                <td className="condition-cell" title={condition}>{condition || '-'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <style dangerouslySetInnerHTML={{ __html: `
        .plan-list-empty {
          padding: var(--space-md, 16px);
          color: var(--text-secondary, #6b7280);
          text-align: center;
          background: var(--surface, #ffffff);
          border: 1px solid var(--border, #e5e7eb);
          border-radius: var(--radius-md, 8px);
        }

        .plan-list-container {
          width: 100%;
          overflow-x: auto;
          background: var(--surface, #ffffff);
          border: 1px solid var(--border, #e5e7eb);
          border-radius: var(--radius-md, 8px);
        }

        .plan-list-table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
          font-size: 14px;
          color: var(--text-primary, #111827);
        }

        .plan-list-table th {
          position: sticky;
          top: 0;
          background: var(--surface, #ffffff);
          padding: 12px var(--space-md, 16px);
          font-weight: 600;
          border-bottom: 1px solid var(--border, #e5e7eb);
          color: var(--text-secondary, #4b5563);
          z-index: 10;
        }

        .plan-list-row td {
          padding: 8px var(--space-md, 16px);
          border-bottom: 1px solid var(--border, #e5e7eb);
          vertical-align: middle;
        }
        
        .plan-list-row:last-child td {
          border-bottom: none;
        }

        .row-even {
          background-color: var(--surface, #ffffff);
        }

        .row-odd {
          background-color: var(--surface-alt, #f9fafb);
        }

        .plan-list-row-seqscan td {
          background-color: rgba(249, 115, 22, 0.05); /* subtle orange */
        }

        .node-type-cell {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .node-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .node-type-text {
          font-weight: 500;
        }

        .cost-cell {
          display: flex;
          flex-direction: column;
          gap: 4px;
          width: 100px;
        }

        .cost-text {
          font-size: 12px;
          color: var(--text-secondary, #6b7280);
        }

        .cost-bar-container {
          width: 100%;
          height: 4px;
          background-color: var(--border, #e5e7eb);
          border-radius: 2px;
          overflow: hidden;
        }

        .cost-bar {
          height: 100%;
          border-radius: 2px;
          transition: width 0.3s ease;
        }

        .condition-cell {
          font-family: var(--font-mono, monospace);
          font-size: 12px;
          color: var(--text-secondary, #4b5563);
          max-width: 300px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      `}} />
    </div>
  );
}

export default PlanListView;
