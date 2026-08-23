"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  getDatabase,
  getIndexRecommendations,
  dismissRecommendation,
  restoreRecommendation,
  triggerIndexAnalysis,
  simulateIndex,
} from "../../../lib/api";
import type { Database, IndexRecommendation, IndexSimulationResult } from "../../../lib/api";

/* ===================================================================
   Index Advisor Page — Enhanced UI
   =================================================================== */

type FilterType = "all" | "unused" | "missing" | "invalid" | "redundant" | "bloat" | "high_impact" | "medium_impact";
type SortOption = "impact" | "size" | "scans" | "table" | "newest";
type ViewMode = "cards" | "table";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function getSafeDdl(rec: IndexRecommendation, concurrently: boolean): string {
  if (!rec.suggestedDdl) return "";
  if ((rec.recommendationType === "unused" || rec.recommendationType === "invalid" || rec.recommendationType === "redundant") && rec.indexName) {
    return concurrently
      ? `DROP INDEX CONCURRENTLY IF EXISTS "${rec.indexName}";`
      : `DROP INDEX IF EXISTS "${rec.indexName}";`;
  }
  if (rec.recommendationType === "bloat" && rec.indexName) {
    return concurrently
      ? `REINDEX INDEX CONCURRENTLY "${rec.indexName}";`
      : `REINDEX INDEX "${rec.indexName}";`;
  }
  return rec.suggestedDdl;
}

export default function IndexAdvisorPage() {
  const params = useParams();
  const id = params.id as string;

  const [database, setDatabase] = useState<Database | null>(null);
  const [recommendations, setRecommendations] = useState<IndexRecommendation[]>([]);
  const [filter, setFilter] = useState<FilterType>("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("impact");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [showDismissed, setShowDismissed] = useState(false);
  const [concurrentlyMode, setConcurrentlyMode] = useState(true);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [simulating, setSimulating] = useState<string | null>(null);
  const [simResults, setSimResults] = useState<Record<string, IndexSimulationResult>>({});
  const [simQuery, setSimQuery] = useState<Record<string, string>>({});
  const [expandedDefs, setExpandedDefs] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    try {
      const [db, result] = await Promise.all([
        getDatabase(id),
        getIndexRecommendations(
          id,
          undefined, // fetch all types so client filtering and stats stay accurate
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
  }, [id, showDismissed]);

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

  const toggleDef = (recId: string) => {
    setExpandedDefs((prev) => {
      const next = new Set(prev);
      if (next.has(recId)) next.delete(recId);
      else next.add(recId);
      return next;
    });
  };

  // Aggregated Summary Statistics
  const unusedCount = useMemo(() => recommendations.filter((r) => r.recommendationType === "unused").length, [recommendations]);
  const missingCount = useMemo(() => recommendations.filter((r) => r.recommendationType === "missing").length, [recommendations]);
  const invalidCount = useMemo(() => recommendations.filter((r) => r.recommendationType === "invalid").length, [recommendations]);
  const redundantCount = useMemo(() => recommendations.filter((r) => r.recommendationType === "redundant").length, [recommendations]);
  const bloatCount = useMemo(() => recommendations.filter((r) => r.recommendationType === "bloat").length, [recommendations]);
  const highImpactCount = useMemo(() => recommendations.filter((r) => r.impact === "high").length, [recommendations]);
  const mediumImpactCount = useMemo(() => recommendations.filter((r) => r.impact === "medium").length, [recommendations]);

  const totalReclaimableBytes = useMemo(() => {
    return recommendations
      .filter((r) => r.recommendationType === "unused" || r.recommendationType === "invalid" || r.recommendationType === "redundant" || r.recommendationType === "bloat")
      .reduce((sum, r) => {
        const meta = r.metadata as Record<string, number | string | undefined>;
        return sum + (Number(meta?.bloat_bytes || meta?.index_size_bytes || meta?.redundant_index_size) || 0);
      }, 0);
  }, [recommendations]);

  const totalSeqScans = useMemo(() => {
    return recommendations
      .filter((r) => r.recommendationType === "missing")
      .reduce((sum, r) => {
        const meta = r.metadata as Record<string, number | string | undefined>;
        return sum + (Number(meta?.seq_scan) || 0);
      }, 0);
  }, [recommendations]);

  // Filtered & Sorted Recommendations
  const processedRecommendations = useMemo(() => {
    let list = recommendations;

    // Type / Impact Filter
    if (filter === "unused") {
      list = list.filter((r) => r.recommendationType === "unused");
    } else if (filter === "missing") {
      list = list.filter((r) => r.recommendationType === "missing");
    } else if (filter === "invalid") {
      list = list.filter((r) => r.recommendationType === "invalid");
    } else if (filter === "redundant") {
      list = list.filter((r) => r.recommendationType === "redundant");
    } else if (filter === "bloat") {
      list = list.filter((r) => r.recommendationType === "bloat");
    } else if (filter === "high_impact") {
      list = list.filter((r) => r.impact === "high");
    } else if (filter === "medium_impact") {
      list = list.filter((r) => r.impact === "medium");
    }

    // Search Query (table, index, reason)
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) =>
          r.tableName.toLowerCase().includes(q) ||
          (r.indexName && r.indexName.toLowerCase().includes(q)) ||
          r.reason.toLowerCase().includes(q)
      );
    }

    // Sorting
    return [...list].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      const metaA = (a.metadata ?? {}) as Record<string, number | string | undefined>;
      const metaB = (b.metadata ?? {}) as Record<string, number | string | undefined>;

      switch (sortBy) {
        case "impact": {
          const rank = { high: 3, medium: 2, low: 1 };
          const diff = ((rank[a.impact as keyof typeof rank] || 0) - (rank[b.impact as keyof typeof rank] || 0));
          if (diff !== 0) return dir * diff;
          return dir * ((Number(metaA.index_size_bytes || metaA.seq_scan) || 0) - (Number(metaB.index_size_bytes || metaB.seq_scan) || 0));
        }
        case "size": {
          const sizeA = Number(metaA.index_size_bytes || metaA.table_size_bytes) || 0;
          const sizeB = Number(metaB.index_size_bytes || metaB.table_size_bytes) || 0;
          return dir * (sizeA - sizeB);
        }
        case "scans": {
          const scansA = Number(metaA.seq_scan) || 0;
          const scansB = Number(metaB.seq_scan) || 0;
          return dir * (scansA - scansB);
        }
        case "table":
          return dir * a.tableName.localeCompare(b.tableName);
        case "newest":
        default:
          return dir * (new Date(a.detectedAt).getTime() - new Date(b.detectedAt).getTime());
      }
    });
  }, [recommendations, filter, search, sortBy, sortDir]);

  function handleHeaderSort(key: SortOption) {
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDir("desc");
    }
  }

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
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 36,
              height: 36,
              borderRadius: "var(--radius-md)",
              background: "var(--surface-alt)",
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
              fontSize: "1rem",
              flexShrink: 0,
            }}
          >
            ←
          </Link>
          <div>
            <h1>Index Advisor — {database?.name}</h1>
            <p style={{ fontSize: "0.9rem", color: "var(--text-secondary)", marginTop: 2 }}>
              Detect unused indexes and find missing index opportunities with HypoPG simulation
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

      {/* Summary cards with Opportunity Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "var(--space-md)", marginBottom: "var(--space-lg)" }}>
        <SummaryCard
          icon="🗑️"
          label="Unused Indexes"
          count={unusedCount}
          color="var(--signal-warning)"
          description="0 scans since stats reset"
        />
        <SummaryCard
          icon="🔎"
          label="Missing Indexes"
          count={missingCount}
          color="var(--signal-critical)"
          description={`${formatNumber(totalSeqScans)} unindexed seq scans`}
        />
        <SummaryCard
          icon="⚠️"
          label="Invalid Indexes"
          count={invalidCount}
          color="var(--signal-critical)"
          description="Corrupted / aborted builds"
        />
        <SummaryCard
          icon="🔄"
          label="Redundant Indexes"
          count={redundantCount}
          color="var(--signal-idle)"
          description="Covered by prefix indexes"
        />
        <SummaryCard
          icon="🗜️"
          label="Bloated Indexes"
          count={bloatCount}
          color="var(--signal-warning)"
          description="Reindex candidates (>30% bloat)"
        />
        <SummaryCard
          icon="📋"
          label="Total Active"
          count={recommendations.length}
          color="var(--brand)"
          description={`${formatBytes(totalReclaimableBytes)} reclaimable disk`}
        />
      </div>

      {/* Toolbar: Search, Filters, Sort & View Mode */}
      <div className="table-toolbar" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center", flexWrap: "wrap", flex: 1 }}>
          {/* Search Box */}
          <div className="table-search-wrap">
            <span className="table-search-icon">🔍</span>
            <input
              className="table-search"
              placeholder="Search table, index, or column..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Filter Chips */}
          <div className="filter-chips">
            <button
              className="filter-chip"
              data-active={filter === "all"}
              onClick={() => setFilter("all")}
            >
              All ({recommendations.length})
            </button>
            <button
              className="filter-chip"
              data-active={filter === "unused"}
              onClick={() => setFilter("unused")}
            >
              🗑️ Unused ({unusedCount})
            </button>
            <button
              className="filter-chip"
              data-active={filter === "missing"}
              onClick={() => setFilter("missing")}
            >
              🔎 Missing ({missingCount})
            </button>
            {invalidCount > 0 && (
              <button
                className="filter-chip"
                data-active={filter === "invalid"}
                onClick={() => setFilter("invalid")}
              >
                ⚠️ Invalid ({invalidCount})
              </button>
            )}
            {redundantCount > 0 && (
              <button
                className="filter-chip"
                data-active={filter === "redundant"}
                onClick={() => setFilter("redundant")}
              >
                🔄 Redundant ({redundantCount})
              </button>
            )}
            {bloatCount > 0 && (
              <button
                className="filter-chip"
                data-active={filter === "bloat"}
                onClick={() => setFilter("bloat")}
              >
                🗜️ Bloat ({bloatCount})
              </button>
            )}
            {highImpactCount > 0 && (
              <button
                className="filter-chip"
                data-active={filter === "high_impact"}
                onClick={() => setFilter("high_impact")}
              >
                ⚡ High Impact ({highImpactCount})
              </button>
            )}
            {mediumImpactCount > 0 && (
              <button
                className="filter-chip"
                data-active={filter === "medium_impact"}
                onClick={() => setFilter("medium_impact")}
              >
                🟡 Medium Impact ({mediumImpactCount})
              </button>
            )}
          </div>
        </div>

        {/* Sort, View Mode & Dismissed Controls */}
        <div style={{ display: "flex", gap: "var(--space-md)", alignItems: "center", flexWrap: "wrap" }}>
          {/* Sort Selector */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: "0.78rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>Sort:</span>
            <select
              className="index-select-dropdown"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
            >
              <option value="impact">Highest Impact</option>
              <option value="size">Largest Size / Waste</option>
              <option value="scans">Most Seq Scans</option>
              <option value="table">Table Name (A-Z)</option>
              <option value="newest">Newest Detected</option>
            </select>
          </div>

          {/* View Mode Toggle */}
          <div className="view-mode-toggle">
            <button
              className="view-mode-btn"
              data-active={viewMode === "cards"}
              onClick={() => setViewMode("cards")}
              title="Card View"
            >
              🗂️ Cards
            </button>
            <button
              className="view-mode-btn"
              data-active={viewMode === "table"}
              onClick={() => setViewMode("table")}
              title="Table View"
            >
              📋 Table
            </button>
          </div>

          {/* Show Dismissed */}
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8rem", color: "var(--text-secondary)", cursor: "pointer", userSelect: "none" }}>
            <input
              type="checkbox"
              checked={showDismissed}
              onChange={(e) => setShowDismissed(e.target.checked)}
              style={{ accentColor: "var(--brand)" }}
            />
            Show dismissed
          </label>
        </div>
      </div>

      {/* Global Safe DDL Setting Bar */}
      <div className="safe-ddl-bar">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <label className="safe-ddl-switch">
            <input
              type="checkbox"
              checked={concurrentlyMode}
              onChange={(e) => setConcurrentlyMode(e.target.checked)}
              style={{ accentColor: "var(--brand)" }}
            />
            <span style={{ fontWeight: 600, color: "var(--text-secondary)" }}>
              Use <code style={{ fontFamily: "var(--font-mono)", fontSize: "0.85em", color: "var(--brand)" }}>CONCURRENTLY</code> for DDL (Zero-downtime, recommended for production)
            </span>
          </label>
        </div>
        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
          Showing {processedRecommendations.length} of {recommendations.length} recommendations
        </span>
      </div>

      {/* Recommendations Output */}
      {processedRecommendations.length === 0 ? (
        <div className="glass-card-static" style={{ padding: "var(--space-xl)", textAlign: "center", color: "var(--text-muted)" }}>
          <div style={{ fontSize: "3rem", marginBottom: "var(--space-sm)", opacity: 0.5 }}>
            {filter === "all" ? "✅" : filter === "unused" ? "🗑️" : "🔎"}
          </div>
          <div style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: 4 }}>
            {showDismissed ? "No dismissed recommendations" : recommendations.length === 0 ? "No recommendations found" : "No matching recommendations"}
          </div>
          <div style={{ fontSize: "0.9rem" }}>
            {showDismissed
              ? "All recommendations are currently active."
              : recommendations.length === 0
              ? 'Click "Run Analysis" to scan your database for index optimization opportunities.'
              : "Try adjusting your search query or filter."}
          </div>
        </div>
      ) : viewMode === "cards" ? (
        /* Card View */
        <div className="stagger-children" style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
          {processedRecommendations.map((rec) => (
            <RecommendationCard
              key={rec.id}
              rec={rec}
              concurrently={concurrentlyMode}
              onDismiss={() => handleDismiss(rec.id)}
              onRestore={() => handleRestore(rec.id)}
              onCopy={(ddl) => handleCopy(ddl, rec.id)}
              copied={copiedId === rec.id}
              dbId={id}
              simulating={simulating === rec.id}
              simResult={simResults[rec.id]}
              simQuery={simQuery[rec.id] ?? ""}
              onSimQueryChange={(val) => setSimQuery((prev) => ({ ...prev, [rec.id]: val }))}
              defExpanded={expandedDefs.has(rec.id)}
              onToggleDef={() => toggleDef(rec.id)}
              onSimulate={async () => {
                const query = simQuery[rec.id];
                if (!query?.trim() || !rec.suggestedDdl) return;
                setSimulating(rec.id);
                try {
                  const result = await simulateIndex(id, rec.suggestedDdl, query);
                  setSimResults((prev) => ({ ...prev, [rec.id]: result }));
                } catch {
                  // Could show error inline
                } finally {
                  setSimulating(null);
                }
              }}
            />
          ))}
        </div>
      ) : (
        /* Table View */
        <div className="glass-card-static" style={{ overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th className="alert-table-th" style={{ width: 140, cursor: "pointer", userSelect: "none" }} onClick={() => handleHeaderSort("newest")}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    Type
                    <span style={{ fontSize: "0.7rem", color: sortBy === "newest" ? "var(--brand)" : "var(--text-muted)", opacity: sortBy === "newest" ? 1 : 0.4 }}>
                      {sortBy === "newest" ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
                    </span>
                  </span>
                </th>
                <th className="alert-table-th" style={{ cursor: "pointer", userSelect: "none" }} onClick={() => handleHeaderSort("table")}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    Table / Index
                    <span style={{ fontSize: "0.7rem", color: sortBy === "table" ? "var(--brand)" : "var(--text-muted)", opacity: sortBy === "table" ? 1 : 0.4 }}>
                      {sortBy === "table" ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
                    </span>
                  </span>
                </th>
                <th className="alert-table-th" style={{ width: 120, cursor: "pointer", userSelect: "none" }} onClick={() => handleHeaderSort("impact")}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    Impact
                    <span style={{ fontSize: "0.7rem", color: sortBy === "impact" ? "var(--brand)" : "var(--text-muted)", opacity: sortBy === "impact" ? 1 : 0.4 }}>
                      {sortBy === "impact" ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
                    </span>
                  </span>
                </th>
                <th className="alert-table-th" style={{ width: 130, cursor: "pointer", userSelect: "none" }} onClick={() => handleHeaderSort("size")}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    Size / Scans
                    <span style={{ fontSize: "0.7rem", color: (sortBy === "size" || sortBy === "scans") ? "var(--brand)" : "var(--text-muted)", opacity: (sortBy === "size" || sortBy === "scans") ? 1 : 0.4 }}>
                      {(sortBy === "size" || sortBy === "scans") ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
                    </span>
                  </span>
                </th>
                <th className="alert-table-th" style={{ width: 220 }}>Suggested Action</th>
                <th className="alert-table-th" style={{ width: 80, textAlign: "right" }}>Manage</th>
              </tr>
            </thead>
            <tbody>
              {processedRecommendations.map((rec) => {
                const isUnused = rec.recommendationType === "unused";
                const meta = (rec.metadata ?? {}) as Record<string, number | string | undefined>;
                const ddl = getSafeDdl(rec, concurrentlyMode);
                const isCopied = copiedId === rec.id;

                const impactColors: Record<string, string> = {
                  high: "var(--signal-critical)",
                  medium: "var(--signal-warning)",
                  low: "var(--text-muted)",
                };

                return (
                  <tr key={rec.id} className="alert-table-row" style={{ opacity: rec.dismissed ? 0.6 : 1 }}>
                    <td className="alert-table-td">
                      <span style={{
                        background: rec.recommendationType === "unused"
                          ? "var(--signal-warning-dim)"
                          : rec.recommendationType === "invalid"
                          ? "var(--signal-critical-dim)"
                          : rec.recommendationType === "redundant"
                          ? "var(--surface-alt)"
                          : rec.recommendationType === "bloat"
                          ? "var(--signal-warning-dim)"
                          : "var(--brand-dim)",
                        color: rec.recommendationType === "unused"
                          ? "var(--signal-warning)"
                          : rec.recommendationType === "invalid"
                          ? "var(--signal-critical)"
                          : rec.recommendationType === "redundant"
                          ? "var(--signal-idle)"
                          : rec.recommendationType === "bloat"
                          ? "var(--signal-warning)"
                          : "var(--brand)",
                        padding: "2px 8px",
                        borderRadius: "var(--radius-full)",
                        fontSize: "0.7rem",
                        fontWeight: 700,
                        textTransform: "uppercase",
                      }}>
                        {rec.recommendationType === "unused"
                          ? "🗑️ Unused"
                          : rec.recommendationType === "missing"
                          ? "🔎 Missing"
                          : rec.recommendationType === "invalid"
                          ? "⚠️ Invalid"
                          : rec.recommendationType === "redundant"
                          ? "🔄 Redundant"
                          : rec.recommendationType === "bloat"
                          ? "🗜️ Bloated"
                          : rec.recommendationType}
                      </span>
                    </td>
                    <td className="alert-table-td">
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.85rem", fontWeight: 600 }}>
                        {rec.tableName}
                      </div>
                      {rec.indexName && (
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                          ↳ {rec.indexName}
                        </div>
                      )}
                    </td>
                    <td className="alert-table-td">
                      <span style={{
                        padding: "2px 8px",
                        borderRadius: "var(--radius-full)",
                        fontSize: "0.7rem",
                        fontWeight: 600,
                        color: impactColors[rec.impact] ?? "var(--text-muted)",
                        border: `1px solid ${impactColors[rec.impact] ?? "var(--border)"}`,
                      }}>
                        {rec.impact} impact
                      </span>
                    </td>
                    <td className="alert-table-td" style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}>
                      {rec.recommendationType === "bloat" && meta.bloat_bytes !== undefined ? (
                        <span style={{ color: "var(--signal-warning)", fontWeight: 600 }}>
                          {meta.bloat_pct}% ({formatBytes(Number(meta.bloat_bytes))})
                        </span>
                      ) : isUnused && meta.index_size_bytes !== undefined ? (
                        <span style={{ color: "var(--signal-warning)", fontWeight: 600 }}>
                          {formatBytes(Number(meta.index_size_bytes))}
                        </span>
                      ) : meta.seq_scan !== undefined ? (
                        <span>{formatNumber(Number(meta.seq_scan))} scans</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="alert-table-td">
                      {ddl ? (
                        <button
                          className="copy-btn"
                          data-copied={isCopied}
                          onClick={() => handleCopy(ddl, rec.id)}
                          style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}
                          title={ddl}
                        >
                          {isCopied ? "✓ Copied" : "📋"} {ddl}
                        </button>
                      ) : (
                        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>See card view</span>
                      )}
                    </td>
                    <td className="alert-table-td" style={{ textAlign: "right" }}>
                      {rec.dismissed ? (
                        <button
                          className="btn-secondary"
                          style={{ fontSize: "0.75rem", padding: "2px 8px" }}
                          onClick={() => handleRestore(rec.id)}
                        >
                          Restore
                        </button>
                      ) : (
                        <button
                          className="btn-secondary"
                          style={{ fontSize: "0.75rem", padding: "2px 8px" }}
                          onClick={() => handleDismiss(rec.id)}
                        >
                          Dismiss
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ----- Summary Card Component ----- */

function SummaryCard({
  icon,
  label,
  count,
  color,
  description,
}: {
  icon: string;
  label: string;
  count: number;
  color: string;
  description: string;
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

/* ----- Recommendation Card Component ----- */

function RecommendationCard({
  rec,
  concurrently,
  onDismiss,
  onRestore,
  onCopy,
  copied,
  dbId,
  simulating,
  simResult,
  simQuery,
  onSimQueryChange,
  onSimulate,
  defExpanded,
  onToggleDef,
}: {
  rec: IndexRecommendation;
  concurrently: boolean;
  onDismiss: () => void;
  onRestore: () => void;
  onCopy: (ddl: string) => void;
  copied: boolean;
  dbId: string;
  simulating: boolean;
  simResult?: IndexSimulationResult;
  simQuery: string;
  onSimQueryChange: (val: string) => void;
  onSimulate: () => void;
  defExpanded: boolean;
  onToggleDef: () => void;
}) {
  const isUnused = rec.recommendationType === "unused";
  const isInvalid = rec.recommendationType === "invalid";
  const isRedundant = rec.recommendationType === "redundant";
  const isBloat = rec.recommendationType === "bloat";

  const borderColor = isUnused
    ? "var(--signal-warning)"
    : isInvalid
    ? "var(--signal-critical)"
    : isRedundant
    ? "var(--signal-idle)"
    : isBloat
    ? "var(--signal-warning)"
    : "var(--brand)";
  const bgColor = isUnused
    ? "var(--signal-warning-dim)"
    : isInvalid
    ? "var(--signal-critical-dim)"
    : isRedundant
    ? "var(--surface-alt)"
    : isBloat
    ? "var(--signal-warning-dim)"
    : "var(--brand-dim)";

  const impactColors: Record<string, string> = {
    high: "var(--signal-critical)",
    medium: "var(--signal-warning)",
    low: "var(--text-muted)",
  };

  const meta = (rec.metadata ?? {}) as Record<string, number | string | undefined>;
  const activeDdl = getSafeDdl(rec, concurrently);

  const typeLabel = isUnused
    ? "🗑️ Unused Index"
    : isInvalid
    ? "⚠️ Invalid Index"
    : isRedundant
    ? "🔄 Redundant Index"
    : isBloat
    ? "🗜️ Bloated Index"
    : "🔎 Missing Index";

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
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--space-md)", marginBottom: "var(--space-md)", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", marginBottom: 4 }}>
            <span
              style={{
                background: bgColor,
                color: borderColor,
                padding: "2px 8px",
                borderRadius: "var(--radius-full)",
                fontSize: "0.7rem",
                fontWeight: 700,
                textTransform: "uppercase",
              }}
            >
              {typeLabel}
            </span>
            <span
              style={{
                padding: "2px 8px",
                borderRadius: "var(--radius-full)",
                fontSize: "0.7rem",
                fontWeight: 600,
                color: impactColors[rec.impact] ?? "var(--text-muted)",
                border: `1px solid ${impactColors[rec.impact] ?? "var(--border)"}`,
              }}
            >
              {rec.impact} impact
            </span>
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.95rem",
              fontWeight: 600,
              color: "var(--text-primary)",
            }}
          >
            {rec.tableName}
            {rec.indexName && (
              <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
                {" "}→ {rec.indexName}
              </span>
            )}
          </div>

          {/* Expandable Index Definition for Unused Indexes */}
          {isUnused && meta.indexdef && (
            <div>
              <button className="index-def-toggle" onClick={onToggleDef}>
                {defExpanded ? "▼ Hide original definition" : "▶ View original definition"}
              </button>
              {defExpanded && (
                <pre className="index-def-snippet">
                  {String(meta.indexdef)}
                </pre>
              )}
            </div>
          )}
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
      <div
        style={{
          display: "flex",
          gap: "var(--space-lg)",
          flexWrap: "wrap",
          marginBottom: activeDdl ? "var(--space-md)" : 0,
          fontSize: "0.8rem",
        }}
      >
        {isUnused && meta.index_size_bytes !== undefined && (
          <MetaStat label="Index Size" value={formatBytes(Number(meta.index_size_bytes))} color="var(--signal-warning)" />
        )}
        {!isUnused && meta.seq_scan !== undefined && (
          <MetaStat label="Seq Scans" value={Number(meta.seq_scan).toLocaleString()} color="var(--signal-critical)" />
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

      {/* DDL Output */}
      {activeDdl && (
        <div style={{ position: "relative" }}>
          <pre
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.8rem",
              background: "var(--surface-alt)",
              padding: "var(--space-md)",
              borderRadius: "var(--radius-md)",
              overflow: "auto",
              lineHeight: 1.5,
              color: "var(--text-secondary)",
              border: "1px solid var(--border)",
            }}
          >
            {activeDdl}
          </pre>
          <button
            onClick={() => onCopy(activeDdl)}
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              padding: "4px 8px",
              fontSize: "0.75rem",
              cursor: "pointer",
              color: copied ? "var(--signal-healthy)" : "var(--text-muted)",
              fontWeight: 500,
            }}
          >
            {copied ? "✓ Copied" : "📋 Copy"}
          </button>
        </div>
      )}

      {/* HypoPG Simulation — only for missing indexes */}
      {!isUnused && rec.suggestedDdl && !rec.dismissed && (
        <div
          style={{
            marginTop: "var(--space-md)",
            padding: "var(--space-md)",
            background: "var(--surface)",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
            <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-secondary)" }}>
              🧪 HypoPG Index Simulation
            </div>
            {/* Quick Fill Sample Query */}
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>Quick test query:</span>
              <button
                className="query-template-btn"
                onClick={() => onSimQueryChange(`SELECT * FROM "${rec.tableName}" LIMIT 50;`)}
              >
                SELECT * LIMIT 50
              </button>
            </div>
          </div>

          {simResult ? (
            <div style={{ display: "flex", gap: "var(--space-lg)", flexWrap: "wrap", alignItems: "center", padding: "var(--space-sm) 0" }}>
              <MetaStat label="Cost Before" value={simResult.costBefore.toLocaleString()} />
              <span style={{ fontSize: "1.2rem", color: "var(--text-muted)" }}>→</span>
              <MetaStat label="Cost After" value={simResult.costAfter.toLocaleString()} />
              <div>
                <div style={{ color: "var(--text-muted)", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Cost Reduction
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontWeight: 700,
                    color: simResult.costReductionPct > 50 ? "var(--signal-healthy)" : "var(--signal-warning)",
                    fontSize: "1.1rem",
                  }}
                >
                  {simResult.costReductionPct}%
                </div>
              </div>
              <MetaStat label="Plan Change" value={`${simResult.planBefore} → ${simResult.planAfter}`} />
            </div>
          ) : (
            <div>
              <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                <input
                  type="text"
                  placeholder={`SELECT * FROM "${rec.tableName}" WHERE ...;`}
                  value={simQuery}
                  onChange={(e) => onSimQueryChange(e.target.value)}
                  style={{
                    flex: 1,
                    minWidth: 220,
                    padding: "8px 12px",
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-sm)",
                    color: "var(--text-primary)",
                    fontFamily: "var(--font-mono)",
                    fontSize: "0.8rem",
                  }}
                />
                <button
                  onClick={onSimulate}
                  disabled={!simQuery.trim() || simulating}
                  style={{
                    padding: "8px 16px",
                    background: simQuery.trim() && !simulating ? "var(--brand)" : "var(--surface)",
                    color: simQuery.trim() && !simulating ? "#fff" : "var(--text-muted)",
                    border: "none",
                    borderRadius: "var(--radius-sm)",
                    cursor: simQuery.trim() && !simulating ? "pointer" : "not-allowed",
                    fontWeight: 600,
                    fontSize: "0.8rem",
                    whiteSpace: "nowrap",
                  }}
                >
                  {simulating ? "Simulating…" : "🧪 Simulate"}
                </button>
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                Simulates hypothetical index creation in memory without modifying the database. Requires <code style={{ fontFamily: "var(--font-mono)", fontSize: "0.9em" }}>hypopg</code> extension.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MetaStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ color: "var(--text-muted)", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: color || "var(--text-primary)" }}>{value}</div>
    </div>
  );
}
