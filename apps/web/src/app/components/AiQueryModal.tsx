"use client";

import React, { useState, useEffect } from "react";
import {
  optimizeQueryWithAi,
  type AiOptimizationResult,
} from "../lib/api";
import { useApiToken } from "../lib/useApiToken";

interface AiQueryModalProps {
  isOpen: boolean;
  onClose: () => void;
  dbId: string;
  queryText: string;
  planJson?: any;
  meanLatencyMs?: number;
  calls?: number;
}

export default function AiQueryModal({
  isOpen,
  onClose,
  dbId,
  queryText,
  planJson,
  meanLatencyMs,
  calls,
}: AiQueryModalProps) {
  const { getToken } = useApiToken();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AiOptimizationResult | null>(null);
  const [activeTab, setActiveTab] = useState<"analysis" | "rewrite" | "indexes">("analysis");
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !queryText) return;

    let mounted = true;
    setLoading(true);
    setError(null);
    setResult(null);

    async function run() {
      try {
        const token = await getToken();
        const data = await optimizeQueryWithAi(
          dbId,
          {
            queryText,
            planJson,
            meanLatencyMs,
            calls,
          },
          token
        );
        if (mounted) {
          setResult(data);
          setLoading(false);
        }
      } catch (err: any) {
        if (mounted) {
          setError(err.message || "Failed to analyze query with AI");
          setLoading(false);
        }
      }
    }

    run();

    return () => {
      mounted = false;
    };
  }, [isOpen, dbId, queryText, planJson, meanLatencyMs, calls, getToken]);

  if (!isOpen) return null;

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(label);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(10, 12, 24, 0.7)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: "16px",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          backgroundColor: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "16px",
          width: "100%",
          maxWidth: "880px",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 50px rgba(0, 0, 0, 0.3)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 24px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(139, 92, 246, 0.04))",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                fontSize: "24px",
                width: "42px",
                height: "42px",
                borderRadius: "10px",
                backgroundColor: "var(--brand-dim)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              🤖
            </div>
            <div>
              <h2
                style={{
                  margin: 0,
                  fontSize: "18px",
                  fontWeight: 700,
                  color: "var(--text-primary)",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                AI Query Explainer & Optimizer
                {result && (
                  <span
                    style={{
                      fontSize: "11px",
                      padding: "2px 8px",
                      borderRadius: "999px",
                      backgroundColor: result.provider === "gemini" ? "rgba(16, 185, 129, 0.15)" : "var(--surface-alt)",
                      color: result.provider === "gemini" ? "var(--signal-healthy)" : "var(--text-secondary)",
                      border: "1px solid var(--border)",
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                    }}
                  >
                    Powered by {result.provider}
                  </span>
                )}
              </h2>
              <p
                style={{
                  margin: "2px 0 0",
                  fontSize: "13px",
                  color: "var(--text-secondary)",
                }}
              >
                Deep execution plan analysis, anti-pattern detection & targeted SQL rewriting
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-secondary)",
              fontSize: "22px",
              cursor: "pointer",
              padding: "4px 8px",
              borderRadius: "8px",
            }}
          >
            ✕
          </button>
        </div>

        {/* Tab Navigation */}
        <div
          style={{
            display: "flex",
            gap: "8px",
            padding: "8px 24px",
            borderBottom: "1px solid var(--border)",
            backgroundColor: "var(--surface-alt)",
          }}
        >
          <button
            onClick={() => setActiveTab("analysis")}
            style={{
              padding: "8px 16px",
              borderRadius: "8px",
              border: "none",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
              backgroundColor: activeTab === "analysis" ? "var(--surface)" : "transparent",
              color: activeTab === "analysis" ? "var(--brand)" : "var(--text-secondary)",
              boxShadow: activeTab === "analysis" ? "var(--shadow-sm)" : "none",
              transition: "all 0.15s ease",
            }}
          >
            💡 Analysis & Bottlenecks {result?.bottlenecks?.length ? `(${result.bottlenecks.length})` : ""}
          </button>
          <button
            onClick={() => setActiveTab("rewrite")}
            style={{
              padding: "8px 16px",
              borderRadius: "8px",
              border: "none",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
              backgroundColor: activeTab === "rewrite" ? "var(--surface)" : "transparent",
              color: activeTab === "rewrite" ? "var(--brand)" : "var(--text-secondary)",
              boxShadow: activeTab === "rewrite" ? "var(--shadow-sm)" : "none",
              transition: "all 0.15s ease",
            }}
          >
            ⚡ Rewritten SQL Query
          </button>
          <button
            onClick={() => setActiveTab("indexes")}
            style={{
              padding: "8px 16px",
              borderRadius: "8px",
              border: "none",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
              backgroundColor: activeTab === "indexes" ? "var(--surface)" : "transparent",
              color: activeTab === "indexes" ? "var(--brand)" : "var(--text-secondary)",
              boxShadow: activeTab === "indexes" ? "var(--shadow-sm)" : "none",
              transition: "all 0.15s ease",
            }}
          >
            📇 Recommended Index DDL {result?.recommendedIndexes?.length ? `(${result.recommendedIndexes.length})` : ""}
          </button>
        </div>

        {/* Modal Body */}
        <div
          style={{
            padding: "24px",
            overflowY: "auto",
            flex: 1,
          }}
        >
          {loading && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: "60px 0",
                gap: "16px",
              }}
            >
              <div
                style={{
                  width: "48px",
                  height: "48px",
                  borderRadius: "50%",
                  border: "3px solid var(--border)",
                  borderTopColor: "var(--brand)",
                  animation: "spin 0.8s linear infinite",
                }}
              />
              <style jsx>{`
                @keyframes spin {
                  to {
                    transform: rotate(360deg);
                  }
                }
              `}</style>
              <div style={{ textAlign: "center" }}>
                <p style={{ fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>
                  Analyzing SQL Query & Execution Plan...
                </p>
                <p style={{ fontSize: "13px", color: "var(--text-secondary)", margin: "4px 0 0" }}>
                  Inspecting sequential scans, filter selectivity, temp files, and join predicates
                </p>
              </div>
            </div>
          )}

          {error && (
            <div
              style={{
                padding: "16px",
                borderRadius: "10px",
                backgroundColor: "var(--signal-critical-dim)",
                border: "1px solid var(--signal-critical)",
                color: "var(--signal-critical)",
                fontSize: "14px",
              }}
            >
              <strong>Error:</strong> {error}
            </div>
          )}

          {!loading && result && (
            <div>
              {/* Executive Summary Card */}
              <div
                style={{
                  padding: "16px 20px",
                  borderRadius: "12px",
                  backgroundColor: "var(--surface-alt)",
                  border: "1px solid var(--border)",
                  marginBottom: "20px",
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: "16px",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: "12px",
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                      color: "var(--text-secondary)",
                      fontWeight: 700,
                      marginBottom: "4px",
                    }}
                  >
                    Executive Diagnosis
                  </div>
                  <div
                    style={{
                      fontSize: "14px",
                      lineHeight: "1.5",
                      color: "var(--text-primary)",
                      fontWeight: 500,
                    }}
                  >
                    {result.summary}
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    whiteSpace: "nowrap",
                  }}
                >
                  <span
                    style={{
                      fontSize: "11px",
                      color: "var(--text-secondary)",
                      fontWeight: 600,
                    }}
                  >
                    Potential Speedup
                  </span>
                  <span
                    style={{
                      fontSize: "15px",
                      fontWeight: 700,
                      color: "var(--signal-healthy)",
                    }}
                  >
                    {result.estimatedSpeedup}
                  </span>
                </div>
              </div>

              {/* Tab 1: Analysis & Bottlenecks */}
              {activeTab === "analysis" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  {result.bottlenecks.length === 0 ? (
                    <div
                      style={{
                        padding: "32px",
                        textAlign: "center",
                        color: "var(--text-secondary)",
                        fontSize: "14px",
                      }}
                    >
                      ✅ No major execution anti-patterns detected in this query!
                    </div>
                  ) : (
                    result.bottlenecks.map((b, i) => (
                      <div
                        key={i}
                        style={{
                          padding: "16px",
                          borderRadius: "10px",
                          border: `1px solid ${
                            b.severity === "critical"
                              ? "var(--signal-critical)"
                              : b.severity === "warning"
                              ? "var(--signal-warning)"
                              : "var(--border)"
                          }`,
                          backgroundColor:
                            b.severity === "critical"
                              ? "var(--signal-critical-dim)"
                              : b.severity === "warning"
                              ? "var(--signal-warning-dim)"
                              : "var(--surface-alt)",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            marginBottom: "8px",
                          }}
                        >
                          <h4
                            style={{
                              margin: 0,
                              fontSize: "14px",
                              fontWeight: 700,
                              color: "var(--text-primary)",
                            }}
                          >
                            {b.title}
                          </h4>
                          <span
                            style={{
                              fontSize: "10px",
                              padding: "2px 8px",
                              borderRadius: "6px",
                              fontWeight: 700,
                              textTransform: "uppercase",
                              backgroundColor:
                                b.severity === "critical"
                                  ? "var(--signal-critical)"
                                  : b.severity === "warning"
                                  ? "var(--signal-warning)"
                                  : "var(--brand)",
                              color: "#fff",
                            }}
                          >
                            {b.severity}
                          </span>
                        </div>
                        <p
                          style={{
                            margin: "0 0 10px",
                            fontSize: "13px",
                            color: "var(--text-secondary)",
                            lineHeight: "1.5",
                          }}
                        >
                          {b.explanation}
                        </p>
                        <div
                          style={{
                            padding: "10px 12px",
                            borderRadius: "8px",
                            backgroundColor: "var(--surface)",
                            border: "1px solid var(--border)",
                            fontSize: "12px",
                            color: "var(--text-primary)",
                          }}
                        >
                          💡 <strong>Actionable Fix:</strong> {b.suggestion}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Tab 2: Rewritten SQL Query */}
              {activeTab === "rewrite" && (
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: "12px",
                    }}
                  >
                    <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
                      Optimized SQL query with predicate restructuring and comment annotations:
                    </span>
                    <button
                      onClick={() => copyToClipboard(result.rewrittenSql, "sql")}
                      style={{
                        padding: "6px 14px",
                        borderRadius: "8px",
                        backgroundColor: "var(--brand)",
                        color: "#fff",
                        border: "none",
                        fontSize: "12px",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      {copiedSection === "sql" ? "✓ Copied!" : "📋 Copy SQL"}
                    </button>
                  </div>

                  <pre
                    style={{
                      padding: "16px",
                      borderRadius: "10px",
                      backgroundColor: "var(--surface-alt)",
                      border: "1px solid var(--border)",
                      color: "var(--text-primary)",
                      fontFamily: "var(--font-mono)",
                      fontSize: "13px",
                      lineHeight: "1.5",
                      overflowX: "auto",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {result.rewrittenSql}
                  </pre>
                </div>
              )}

              {/* Tab 3: Recommended Indexes */}
              {activeTab === "indexes" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  {result.recommendedIndexes.length === 0 ? (
                    <div
                      style={{
                        padding: "32px",
                        textAlign: "center",
                        color: "var(--text-secondary)",
                        fontSize: "14px",
                      }}
                    >
                      No new indexes strictly required. Current indexes or query rewrite sufficient.
                    </div>
                  ) : (
                    result.recommendedIndexes.map((idx, i) => (
                      <div
                        key={i}
                        style={{
                          padding: "16px",
                          borderRadius: "10px",
                          backgroundColor: "var(--surface-alt)",
                          border: "1px solid var(--border)",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            marginBottom: "8px",
                          }}
                        >
                          <span
                            style={{
                              fontSize: "12px",
                              fontWeight: 700,
                              color: "var(--brand)",
                              textTransform: "uppercase",
                            }}
                          >
                            Table: {idx.tableName}
                          </span>
                          <button
                            onClick={() => copyToClipboard(idx.indexDdl, `idx-${i}`)}
                            style={{
                              padding: "4px 10px",
                              borderRadius: "6px",
                              backgroundColor: "var(--surface)",
                              color: "var(--text-primary)",
                              border: "1px solid var(--border)",
                              fontSize: "11px",
                              fontWeight: 600,
                              cursor: "pointer",
                            }}
                          >
                            {copiedSection === `idx-${i}` ? "✓ Copied!" : "📋 Copy DDL"}
                          </button>
                        </div>
                        <p
                          style={{
                            margin: "0 0 10px",
                            fontSize: "13px",
                            color: "var(--text-secondary)",
                          }}
                        >
                          {idx.reason}
                        </p>
                        <pre
                          style={{
                            margin: 0,
                            padding: "12px",
                            borderRadius: "8px",
                            backgroundColor: "var(--surface)",
                            border: "1px solid var(--border)",
                            fontFamily: "var(--font-mono)",
                            fontSize: "12px",
                            color: "var(--text-primary)",
                            overflowX: "auto",
                          }}
                        >
                          {idx.indexDdl}
                        </pre>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "16px 24px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            backgroundColor: "var(--surface)",
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: "8px 20px",
              borderRadius: "8px",
              backgroundColor: "var(--surface-alt)",
              color: "var(--text-primary)",
              border: "1px solid var(--border)",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
