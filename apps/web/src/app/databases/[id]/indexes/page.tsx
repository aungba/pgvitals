"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  getDatabase,
  getIndexRecommendations,
  dismissRecommendation,
  restoreRecommendation,
  triggerIndexAnalysis,
} from "../../../lib/api";
import type { Database, IndexRecommendation } from "../../../lib/api";

/* ===================================================================
   Index Advisor Page — Phase 5
   =================================================================== */

type FilterType = "all" | "unused" | "missing";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function IndexAdvisorPage() {
  const params = useParams();
  const id = params.id as string;

  const [database, setDatabase] = useState<Database | null>(null);
  const [recommendations, setRecommendations] = useState<IndexRecommendation[]>([]);
  const [filter, setFilter] = useState<FilterType>("all");
  const [showDismissed, setShowDismissed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [db, result] = await Promise.all([
        getDatabase(id),
        getIndexRecommendations(
          id,
          filter === "all" ? undefined : filter,
          showDismissed
        ),
      ]);
      setDatabase(db);
      setRecommendations(result.recommendations);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [id, filter, showDismissed]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      await triggerIndexAnalysis(id);
      await fetchData();
    } finally {
      setAnalyzing(false);
    }
  };

  const handleDismiss = async (recId: string) => {
    await dismissRecommendation(id, recId);
    setRecommendations((prev) => prev.filter((r) => r.id !== recId));
  };

  const handleRestore = async (recId: string) => {
    await restoreRecommendation(id, recId);
    setRecommendations((prev) => prev.filter((r) => r.id !== recId));
  };

  const handleCopy = (ddl: string, recId: string) => {
    navigator.clipboard.writeText(ddl);
    setCopiedId(recId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const unusedCount = recommendations.filter((r) => r.recommendationType === "unused").length;
  const missingCount = recommendations.filter((r) => r.recommendationType === "missing").length;

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
              color: "var(--text-secondary)", fontSize: "1rem", flexShrink: 0,
            }}
          >←</Link>
          <div>
            <h1>Index Advisor — {database?.name}</h1>
            <p style={{ fontSize: "0.9rem", color: "var(--text-secondary)", marginTop: 2 }}>
              Detect unused indexes and find missing index opportunities
            </p>
          </div>
        </div>
        <div className="detail-header-right">
          <button
            className="btn-primary"
            onClick={handleAnalyze}
            disabled={analyzing}
          >
            {analyzing ? "Analyzing…" : "🔍 Run Analysis"}
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "var(--space-md)", marginBottom: "var(--space-lg)" }}>
        <SummaryCard
          icon="🗑️"
          label="Unused Indexes"
          count={unusedCount}
          color="var(--signal-warning)"
          description="Zero scans, wasting disk & slowing writes"
        />
        <SummaryCard
          icon="🔎"
          label="Missing Indexes"
          count={missingCount}
          color="var(--signal-critical)"
          description="Tables with high sequential scan counts"
        />
        <SummaryCard
          icon="📋"
          label="Total"
          count={recommendations.length}
          color="var(--brand)"
          description="Active recommendations"
        />
      </div>

      {/* Filter bar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: "var(--space-md)", flexWrap: "wrap", gap: "var(--space-sm)",
      }}>
        <div className="tab-bar">
          {([
            ["all", "All"],
            ["unused", "Unused"],
            ["missing", "Missing"],
          ] as [FilterType, string][]).map(([key, label]) => (
            <button
              key={key}
              className={`tab-button ${filter === key ? "active" : ""}`}
              onClick={() => setFilter(key)}
            >{label}</button>
          ))}
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.85rem", color: "var(--text-secondary)", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={showDismissed}
            onChange={(e) => setShowDismissed(e.target.checked)}
            style={{ accentColor: "var(--brand)" }}
          />
          Show dismissed
        </label>
      </div>

      {/* Recommendations list */}
      {recommendations.length === 0 ? (
        <div className="glass-card-static" style={{ padding: "var(--space-xl)", textAlign: "center", color: "var(--text-muted)" }}>
          <div style={{ fontSize: "3rem", marginBottom: "var(--space-sm)", opacity: 0.5 }}>
            {filter === "all" ? "✅" : filter === "unused" ? "🗑️" : "🔎"}
          </div>
          <div style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: 4 }}>
            {showDismissed ? "No dismissed recommendations" : "No recommendations found"}
          </div>
          <div style={{ fontSize: "0.9rem" }}>
            {showDismissed
              ? "All recommendations are currently active."
              : "Click \"Run Analysis\" to scan your database for index optimization opportunities."}
          </div>
        </div>
      ) : (
        <div className="stagger-children" style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
          {recommendations.map((rec) => (
            <RecommendationCard
              key={rec.id}
              rec={rec}
              onDismiss={() => handleDismiss(rec.id)}
              onRestore={() => handleRestore(rec.id)}
              onCopy={(ddl) => handleCopy(ddl, rec.id)}
              copied={copiedId === rec.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ----- Summary Card ----- */

function SummaryCard({ icon, label, count, color, description }: {
  icon: string; label: string; count: number; color: string; description: string;
}) {
  return (
    <div className="glass-card-static" style={{ padding: "var(--space-lg)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", marginBottom: "var(--space-sm)" }}>
        <span style={{ fontSize: "1.2rem" }}>{icon}</span>
        <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-secondary)" }}>{label}</span>
      </div>
      <div style={{ fontSize: "2rem", fontWeight: 700, color, fontFamily: "var(--font-mono)", lineHeight: 1 }}>
        {count}
      </div>
      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 4 }}>{description}</div>
    </div>
  );
}

/* ----- Recommendation Card ----- */

function RecommendationCard({ rec, onDismiss, onRestore, onCopy, copied }: {
  rec: IndexRecommendation;
  onDismiss: () => void;
  onRestore: () => void;
  onCopy: (ddl: string) => void;
  copied: boolean;
}) {
  const isUnused = rec.recommendationType === "unused";
  const borderColor = isUnused ? "var(--signal-warning)" : "var(--signal-critical)";
  const bgColor = isUnused ? "var(--signal-warning-dim)" : "var(--signal-critical-dim)";
  const impactColors: Record<string, string> = {
    high: "var(--signal-critical)",
    medium: "var(--signal-warning)",
    low: "var(--text-muted)",
  };

  const meta = rec.metadata as Record<string, number | string | undefined>;

  return (
    <div
      className="glass-card-static"
      style={{
        borderLeft: `3px solid ${borderColor}`,
        padding: "var(--space-lg)",
        opacity: rec.dismissed ? 0.6 : 1,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--space-md)", marginBottom: "var(--space-md)" }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", marginBottom: 4 }}>
            <span style={{
              background: bgColor, color: borderColor,
              padding: "2px 8px", borderRadius: "var(--radius-full)",
              fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase",
            }}>
              {isUnused ? "Unused Index" : "Missing Index"}
            </span>
            <span style={{
              padding: "2px 8px", borderRadius: "var(--radius-full)",
              fontSize: "0.7rem", fontWeight: 600,
              color: impactColors[rec.impact] ?? "var(--text-muted)",
              border: `1px solid ${impactColors[rec.impact] ?? "var(--border)"}`,
            }}>
              {rec.impact} impact
            </span>
          </div>
          <div style={{
            fontFamily: "var(--font-mono)", fontSize: "0.9rem",
            fontWeight: 600, color: "var(--text-primary)",
          }}>
            {rec.tableName}
            {rec.indexName && (
              <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
                {" "}→ {rec.indexName}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: "var(--space-sm)", flexShrink: 0 }}>
          {rec.dismissed ? (
            <button className="btn-secondary" style={{ fontSize: "0.8rem", padding: "4px 12px" }} onClick={onRestore}>
              Restore
            </button>
          ) : (
            <button className="btn-secondary" style={{ fontSize: "0.8rem", padding: "4px 12px" }} onClick={onDismiss}>
              Dismiss
            </button>
          )}
        </div>
      </div>

      {/* Reason */}
      <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: "var(--space-md)" }}>
        {rec.reason}
      </p>

      {/* Metadata stats */}
      <div style={{
        display: "flex", gap: "var(--space-lg)", flexWrap: "wrap",
        marginBottom: rec.suggestedDdl ? "var(--space-md)" : 0,
        fontSize: "0.8rem",
      }}>
        {isUnused && meta.index_size_bytes !== undefined && (
          <MetaStat label="Index Size" value={formatBytes(Number(meta.index_size_bytes))} />
        )}
        {!isUnused && meta.seq_scan !== undefined && (
          <MetaStat label="Seq Scans" value={Number(meta.seq_scan).toLocaleString()} />
        )}
        {!isUnused && meta.n_live_tup !== undefined && (
          <MetaStat label="Live Rows" value={Number(meta.n_live_tup).toLocaleString()} />
        )}
        {!isUnused && meta.seq_ratio_pct !== undefined && (
          <MetaStat label="Seq Ratio" value={`${meta.seq_ratio_pct}%`} />
        )}
        {!isUnused && meta.table_size_bytes !== undefined && (
          <MetaStat label="Table Size" value={formatBytes(Number(meta.table_size_bytes))} />
        )}
      </div>

      {/* DDL */}
      {rec.suggestedDdl && (
        <div style={{ position: "relative" }}>
          <pre style={{
            fontFamily: "var(--font-mono)", fontSize: "0.8rem",
            background: "var(--surface-alt)", padding: "var(--space-md)",
            borderRadius: "var(--radius-md)", overflow: "auto",
            lineHeight: 1.5, color: "var(--text-secondary)",
            border: "1px solid var(--border)",
          }}>
            {rec.suggestedDdl}
          </pre>
          <button
            onClick={() => onCopy(rec.suggestedDdl!)}
            style={{
              position: "absolute", top: 8, right: 8,
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)", padding: "4px 8px",
              fontSize: "0.75rem", cursor: "pointer",
              color: copied ? "var(--signal-healthy)" : "var(--text-muted)",
            }}
          >
            {copied ? "✓ Copied" : "Copy"}
          </button>
        </div>
      )}
    </div>
  );
}

function MetaStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: "var(--text-muted)", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--text-primary)" }}>{value}</div>
    </div>
  );
}
