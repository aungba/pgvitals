"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getDatabase, getHints } from "../../../lib/api";
import type { Database, Hint } from "../../../lib/api";

/* ===================================================================
   Root Cause Hints & Incident Logs Page
   =================================================================== */

type HintSortKey = "severity" | "ruleType" | "title" | "detectedAt";

const RULE_TYPE_INFO: Record<
  string,
  { label: string; icon: string; category: string; remediation: string }
> = {
  idle_in_transaction_long: {
    label: "Idle in Transaction",
    icon: "⏳",
    category: "Transaction Management",
    remediation:
      "Configure `idle_in_transaction_session_timeout` (e.g. 60s) in postgresql.conf to automatically kill hanging transactions. Audit application code for missing COMMIT or ROLLBACK in exception handlers.",
  },
  connection_hog: {
    label: "Connection Hog",
    icon: "🐷",
    category: "Connection Pooling",
    remediation:
      "Deploy a connection pooler like PgBouncer or AWS RDS Proxy. Reduce max pool size per application replica to prevent a single microservice from starving the database.",
  },
  blocking_chain_long: {
    label: "Blocking Lock Chain",
    icon: "⛓️",
    category: "Lock Contention",
    remediation:
      "Investigate and terminate the root blocker using `SELECT pg_terminate_backend(pid)`. Optimize the offending query, ensure index coverage on foreign keys, and keep transactions as short as possible.",
  },
  connection_exhaustion: {
    label: "Connection Exhaustion",
    icon: "🛑",
    category: "Capacity",
    remediation:
      "Connection count has exceeded safe capacity. Increase `max_connections` if memory permits, or immediately place transactions behind a transactional connection pooler.",
  },
  connection_spike: {
    label: "Connection Spike",
    icon: "📈",
    category: "Traffic Surge",
    remediation:
      "A sudden surge in incoming connections was detected. Check for traffic spikes, runaway autoscaling, or unpooled batch worker processes spinning up simultaneously.",
  },
  micro_query_lock_storm: {
    label: "Lock Storm",
    icon: "⚡",
    category: "High-Concurrency Locks",
    remediation:
      "High volume of concurrent queries contending for the same row or table locks. Review concurrent UPDATE/DELETE queries on hot counter rows or consider sharding/partitioning hot tables.",
  },
  lock_queue_storm: {
    label: "Lock Queue Storm",
    icon: "🌪️",
    category: "Cascading Lock Queue",
    remediation:
      "Multiple sessions are queued behind a primary blocker (often an exclusive lock or heavy DDL). Avoid running table migrations during peak business hours and use `lock_timeout`.",
  },
};

function formatRuleLabel(ruleType: string): string {
  if (RULE_TYPE_INFO[ruleType]) {
    return RULE_TYPE_INFO[ruleType].label;
  }
  return ruleType
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / 1000
  );
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function HintsPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params.id as string;

  const [database, setDatabase] = useState<Database | null>(null);
  const [hints, setHints] = useState<Hint[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Filters
  const [hours, setHours] = useState<number>(24);
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [ruleTypeFilter, setRuleTypeFilter] = useState<string>(
    searchParams.get("rule") || "all"
  );
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Sorting
  const [sortKey, setSortKey] = useState<HintSortKey>("detectedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Selection for Inspector Drawer
  const [selectedHint, setSelectedHint] = useState<Hint | null>(null);
  const [copiedQuery, setCopiedQuery] = useState(false);

  const fetchData = useCallback(
    async (showLoading = true) => {
      if (showLoading) setLoading(true);
      else setIsRefreshing(true);
      try {
        const [db, hintsData] = await Promise.all([
          getDatabase(id),
          getHints(id, {
            hours: hours > 0 ? hours : 0,
            severity: severityFilter !== "all" ? severityFilter : undefined,
            ruleType: ruleTypeFilter !== "all" ? ruleTypeFilter : undefined,
            limit: 300,
          }),
        ]);
        setDatabase(db);
        setHints(hintsData);
      } catch (err) {
        console.error("Failed to load root cause hints:", err);
      } finally {
        setLoading(false);
        setIsRefreshing(false);
      }
    },
    [id, hours, severityFilter, ruleTypeFilter]
  );

  useEffect(() => {
    fetchData(true);
  }, [fetchData]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => fetchData(false), 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Filtered and searched hints
  const filteredHints = useMemo(() => {
    return hints.filter((hint) => {
      if (severityFilter !== "all" && hint.severity !== severityFilter) {
        return false;
      }
      if (ruleTypeFilter !== "all" && hint.ruleType !== ruleTypeFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const titleMatch = hint.title.toLowerCase().includes(query);
        const descMatch = hint.description.toLowerCase().includes(query);
        const ruleMatch = hint.ruleType.toLowerCase().includes(query);
        const metaStr = JSON.stringify(hint.metadata || {}).toLowerCase();
        const metaMatch = metaStr.includes(query);
        return titleMatch || descMatch || ruleMatch || metaMatch;
      }
      return true;
    });
  }, [hints, severityFilter, ruleTypeFilter, searchQuery]);

  // Sorted hints
  const sortedHints = useMemo(() => {
    return [...filteredHints].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      if (sortKey === "severity") {
        const order: Record<string, number> = { critical: 2, warning: 1 };
        return ((order[b.severity] || 0) - (order[a.severity] || 0)) * dir;
      }
      if (sortKey === "ruleType") {
        return a.ruleType.localeCompare(b.ruleType) * dir;
      }
      if (sortKey === "title") {
        return a.title.localeCompare(b.title) * dir;
      }
      if (sortKey === "detectedAt") {
        return (
          (new Date(a.detectedAt).getTime() - new Date(b.detectedAt).getTime()) *
          dir
        );
      }
      return 0;
    });
  }, [filteredHints, sortKey, sortDir]);

  // KPI calculations
  const criticalCount = useMemo(
    () => hints.filter((h) => h.severity === "critical").length,
    [hints]
  );
  const warningCount = useMemo(
    () => hints.filter((h) => h.severity === "warning").length,
    [hints]
  );

  const topRuleType = useMemo(() => {
    if (hints.length === 0) return "None";
    const counts: Record<string, number> = {};
    for (const h of hints) {
      counts[h.ruleType] = (counts[h.ruleType] || 0) + 1;
    }
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return formatRuleLabel(sorted[0][0]);
  }, [hints]);

  // Export handlers
  const exportJSON = () => {
    const dataStr =
      "data:text/json;charset=utf-8," +
      encodeURIComponent(JSON.stringify(sortedHints, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute(
      "download",
      `root-cause-hints-${database?.name || id}-${Date.now()}.json`
    );
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const exportCSV = () => {
    const headers = [
      "ID",
      "DetectedAt",
      "Severity",
      "RuleType",
      "Title",
      "Description",
      "PID",
      "ApplicationName",
      "QuerySnippet",
    ];
    const rows = sortedHints.map((h) => {
      const meta = (h.metadata || {}) as Record<string, unknown>;
      const queryText = (meta.query_text || meta.blocked_query || "") as string;
      const cleanQuery = queryText.replace(/"/g, '""').replace(/\n/g, " ");
      const appName = ((meta.application_name || "") as string).replace(
        /"/g,
        '""'
      );
      const title = h.title.replace(/"/g, '""');
      const desc = h.description.replace(/"/g, '""');
      return [
        `"${h.id}"`,
        `"${h.detectedAt}"`,
        `"${h.severity}"`,
        `"${h.ruleType}"`,
        `"${title}"`,
        `"${desc}"`,
        `"${meta.pid || ""}"`,
        `"${appName}"`,
        `"${cleanQuery}"`,
      ].join(",");
    });
    const csvContent =
      "data:text/csv;charset=utf-8," + [headers.join(","), ...rows].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute(
      "download",
      `root-cause-hints-${database?.name || id}-${Date.now()}.csv`
    );
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const handleCopyQuery = (query: string) => {
    navigator.clipboard.writeText(query);
    setCopiedQuery(true);
    setTimeout(() => setCopiedQuery(false), 2000);
  };

  function TableSortHeader({
    label,
    k,
    style,
  }: {
    label: string;
    k: HintSortKey;
    style?: React.CSSProperties;
  }) {
    const isActive = sortKey === k;
    return (
      <th
        className="alert-table-th sortable-th"
        style={style}
        onClick={() => {
          if (sortKey === k) {
            setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
          } else {
            setSortKey(k);
            setSortDir("desc");
          }
        }}
      >
        {label}
        <span className="sort-arrow" data-active={isActive}>
          {isActive ? (sortDir === "asc" ? "▲" : "▼") : "▲"}
        </span>
      </th>
    );
  }

  if (loading) {
    return (
      <div className="animate-fade-in">
        <div
          className="skeleton"
          style={{ width: 320, height: 32, marginBottom: 16 }}
        />
        <div
          className="skeleton"
          style={{ height: 100, marginBottom: 24, borderRadius: "var(--radius-lg)" }}
        />
        <div
          className="skeleton"
          style={{ height: 400, borderRadius: "var(--radius-lg)" }}
        />
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="detail-header" style={{ marginBottom: "var(--space-lg)" }}>
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
              transition: "all var(--transition-fast)",
              flexShrink: 0,
            }}
            title="Back to database overview"
          >
            ←
          </Link>
          <div>
            <h1 style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
              <span>Root Cause Hints & Incident Logs</span>
              {database && (
                <span
                  style={{
                    fontSize: "0.85rem",
                    fontWeight: 500,
                    color: "var(--text-muted)",
                    background: "var(--surface-alt)",
                    padding: "2px 10px",
                    borderRadius: "var(--radius-full)",
                  }}
                >
                  {database.name}
                </span>
              )}
            </h1>
            <p className="text-secondary" style={{ fontSize: "0.88rem", marginTop: 2 }}>
              Chronological log of heuristic rules engine detections, lock contention storms, and performance bottlenecks
            </p>
          </div>
        </div>

        {/* Header Actions */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
          <button
            onClick={() => fetchData(false)}
            className="btn-secondary"
            disabled={isRefreshing}
            style={{ fontSize: "0.8rem", padding: "6px 12px" }}
          >
            {isRefreshing ? "Refreshing..." : "🔄 Refresh"}
          </button>
          <button
            onClick={exportCSV}
            disabled={sortedHints.length === 0}
            className="btn-secondary"
            style={{ fontSize: "0.8rem", padding: "6px 12px" }}
            title="Export to CSV format"
          >
            📥 CSV
          </button>
          <button
            onClick={exportJSON}
            disabled={sortedHints.length === 0}
            className="btn-secondary"
            style={{ fontSize: "0.8rem", padding: "6px 12px" }}
            title="Export to JSON format"
          >
            📄 JSON
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: "var(--space-md)",
          marginBottom: "var(--space-xl)",
        }}
      >
        <div
          className="glass-card-static"
          style={{ padding: "var(--space-lg)", textAlign: "center" }}
        >
          <div
            style={{
              fontSize: "2rem",
              fontWeight: 700,
              color: hints.length > 0 ? "var(--brand)" : "var(--signal-healthy)",
            }}
          >
            {hints.length}
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>
            Total Incidents Logged
          </div>
        </div>

        <div
          className="glass-card-static"
          style={{ padding: "var(--space-lg)", textAlign: "center" }}
        >
          <div
            style={{
              fontSize: "2rem",
              fontWeight: 700,
              color: criticalCount > 0 ? "var(--signal-critical)" : "var(--signal-healthy)",
            }}
          >
            {criticalCount}
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>
            Critical Incidents
          </div>
        </div>

        <div
          className="glass-card-static"
          style={{ padding: "var(--space-lg)", textAlign: "center" }}
        >
          <div
            style={{
              fontSize: "2rem",
              fontWeight: 700,
              color: warningCount > 0 ? "var(--signal-warning)" : "var(--signal-healthy)",
            }}
          >
            {warningCount}
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>
            Warnings
          </div>
        </div>

        <div
          className="glass-card-static"
          style={{ padding: "var(--space-lg)", textAlign: "center" }}
        >
          <div
            style={{
              fontSize: "1.1rem",
              fontWeight: 700,
              color: "var(--text-primary)",
              marginTop: 6,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={topRuleType}
          >
            {topRuleType}
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 8 }}>
            Top Triggered Anomaly
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div
        className="glass-card-static"
        style={{
          padding: "var(--space-md) var(--space-lg)",
          marginBottom: "var(--space-lg)",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-md)",
        }}
      >
        {/* Left Side: Time Range and Filters */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-sm)" }}>
          {/* Time range buttons */}
          <div
            style={{
              display: "inline-flex",
              background: "var(--surface-alt)",
              padding: 2,
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border)",
            }}
          >
            {[
              { label: "1h", value: 1 },
              { label: "24h", value: 24 },
              { label: "7d", value: 168 },
              { label: "30d", value: 720 },
              { label: "All", value: 0 },
            ].map((t) => (
              <button
                key={t.value}
                onClick={() => setHours(t.value)}
                style={{
                  padding: "4px 10px",
                  fontSize: "0.75rem",
                  fontWeight: hours === t.value ? 600 : 400,
                  borderRadius: "var(--radius-sm)",
                  background: hours === t.value ? "var(--brand)" : "transparent",
                  color: hours === t.value ? "#ffffff" : "var(--text-secondary)",
                  border: "none",
                  cursor: "pointer",
                  transition: "all var(--transition-fast)",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Severity filter */}
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="input-field"
            style={{
              padding: "4px 10px",
              fontSize: "0.8rem",
              borderRadius: "var(--radius-md)",
              width: "auto",
            }}
          >
            <option value="all">All Severities</option>
            <option value="critical">🔴 Critical Only</option>
            <option value="warning">🟡 Warning Only</option>
          </select>

          {/* Rule Type filter */}
          <select
            value={ruleTypeFilter}
            onChange={(e) => setRuleTypeFilter(e.target.value)}
            className="input-field"
            style={{
              padding: "4px 10px",
              fontSize: "0.8rem",
              borderRadius: "var(--radius-md)",
              width: "auto",
            }}
          >
            <option value="all">All Anomaly Rules</option>
            <option value="idle_in_transaction_long">⏳ Idle in Transaction</option>
            <option value="blocking_chain_long">⛓️ Blocking Lock Chain</option>
            <option value="micro_query_lock_storm">⚡ Lock Storm</option>
            <option value="lock_queue_storm">🌪️ Lock Queue Storm</option>
            <option value="connection_hog">🐷 Connection Hog</option>
            <option value="connection_exhaustion">🛑 Connection Exhaustion</option>
            <option value="connection_spike">📈 Connection Spike</option>
          </select>
        </div>

        {/* Right Side: Search */}
        <div style={{ minWidth: 240, flex: "0 1 300px" }}>
          <input
            type="text"
            placeholder="Search queries, PIDs, apps..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input-field"
            style={{
              padding: "6px 12px",
              fontSize: "0.8rem",
              borderRadius: "var(--radius-md)",
              width: "100%",
            }}
          />
        </div>
      </div>

      {/* Main Content Layout: Table + Inspector Drawer */}
      <div style={{ display: "flex", gap: "var(--space-lg)", alignItems: "flex-start" }}>
        {/* Left Column: Hint Logs Table */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {sortedHints.length === 0 ? (
            <div
              className="glass-card-static"
              style={{
                padding: "var(--space-2xl)",
                textAlign: "center",
                color: "var(--text-muted)",
              }}
            >
              <div style={{ fontSize: "2.5rem", marginBottom: "var(--space-md)" }}>
                ✅
              </div>
              <p style={{ fontSize: "1.1rem", fontWeight: 600, color: "var(--text-primary)" }}>
                No Root Cause Incidents Found
              </p>
              <div style={{ fontSize: "0.85rem", marginTop: "var(--space-sm)" }}>
                {hints.length === 0
                  ? `No diagnostic anomalies were triggered in the selected ${
                      hours === 0
                        ? "database history"
                        : hours < 24
                        ? `${hours} hours`
                        : `${hours / 24} days`
                    }.`
                  : "No hints match your active search or filter criteria."}
              </div>
              {(severityFilter !== "all" ||
                ruleTypeFilter !== "all" ||
                searchQuery !== "") && (
                <button
                  onClick={() => {
                    setSeverityFilter("all");
                    setRuleTypeFilter("all");
                    setSearchQuery("");
                  }}
                  className="btn-secondary"
                  style={{ marginTop: "var(--space-md)", fontSize: "0.8rem" }}
                >
                  Clear Filters
                </button>
              )}
            </div>
          ) : (
            <div className="glass-card-static" style={{ overflow: "hidden" }}>
              <div
                style={{
                  padding: "var(--space-sm) var(--space-md)",
                  background: "var(--surface-alt)",
                  borderBottom: "1px solid var(--border)",
                  fontSize: "0.75rem",
                  color: "var(--text-muted)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span>
                  Showing <strong>{sortedHints.length}</strong> incident log
                  {sortedHints.length === 1 ? "" : "s"}
                </span>
                <span>Click any row for full diagnostic inspection</span>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <TableSortHeader label="Sev" k="severity" style={{ width: 60 }} />
                      <TableSortHeader label="Rule" k="ruleType" style={{ width: 170 }} />
                      <TableSortHeader label="Incident & Root Cause" k="title" />
                      <th className="alert-table-th" style={{ width: 150 }}>
                        Session Context
                      </th>
                      <TableSortHeader label="Time" k="detectedAt" style={{ width: 130 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedHints.map((hint) => {
                      const isCritical = hint.severity === "critical";
                      const isSelected = selectedHint?.id === hint.id;
                      const ruleInfo = RULE_TYPE_INFO[hint.ruleType];
                      const meta = (hint.metadata || {}) as Record<string, unknown>;
                      const pid = meta.pid as number | undefined;
                      const appName = (meta.application_name as string) || null;
                      const queryText = (meta.query_text || meta.blocked_query) as
                        | string
                        | undefined;

                      const timeFormatted = new Date(hint.detectedAt).toLocaleTimeString(
                        "en-US",
                        { hour: "2-digit", minute: "2-digit", second: "2-digit" }
                      );
                      const dateFormatted = new Date(hint.detectedAt).toLocaleDateString(
                        "en-US",
                        { month: "short", day: "numeric" }
                      );

                      return (
                        <tr
                          key={hint.id}
                          className={`alert-table-row ${isSelected ? "selected-row" : ""}`}
                          onClick={() =>
                            setSelectedHint(isSelected ? null : hint)
                          }
                          style={{
                            cursor: "pointer",
                            background: isSelected ? "var(--surface-alt)" : undefined,
                          }}
                        >
                          {/* Severity */}
                          <td className="alert-table-td">
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                width: 28,
                                height: 28,
                                borderRadius: "var(--radius-full)",
                                background: isCritical
                                  ? "var(--signal-critical-dim)"
                                  : "var(--signal-warning-dim)",
                                fontSize: "0.75rem",
                              }}
                              title={isCritical ? "Critical" : "Warning"}
                            >
                              {isCritical ? "🔴" : "🟡"}
                            </span>
                          </td>

                          {/* Rule Type */}
                          <td className="alert-table-td">
                            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              <span>{ruleInfo?.icon || "🔍"}</span>
                              <span
                                style={{
                                  fontSize: "0.78rem",
                                  fontWeight: 600,
                                  color: isCritical
                                    ? "var(--signal-critical)"
                                    : "var(--signal-warning)",
                                }}
                              >
                                {formatRuleLabel(hint.ruleType)}
                              </span>
                            </div>
                          </td>

                          {/* Incident Title & Description */}
                          <td className="alert-table-td" style={{ fontSize: "0.85rem", lineHeight: 1.4 }}>
                            <div style={{ fontWeight: isSelected ? 600 : 500, color: "var(--text-primary)" }}>
                              {hint.title}
                            </div>
                            <div
                              style={{
                                fontSize: "0.78rem",
                                color: "var(--text-secondary)",
                                marginTop: 2,
                                display: "-webkit-box",
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: "vertical",
                                overflow: "hidden",
                              }}
                            >
                              {hint.description}
                            </div>
                            {queryText && (
                              <div
                                style={{
                                  marginTop: 4,
                                  padding: "3px 8px",
                                  borderRadius: "var(--radius-sm)",
                                  background: "var(--surface-alt)",
                                  fontFamily: "var(--font-mono)",
                                  fontSize: "0.72rem",
                                  color: "var(--text-muted)",
                                  maxWidth: 450,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {queryText}
                              </div>
                            )}
                          </td>

                          {/* Session Context */}
                          <td className="alert-table-td" style={{ fontSize: "0.78rem" }}>
                            {pid != null && (
                              <div style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
                                PID: <strong>{pid}</strong>
                              </div>
                            )}
                            {appName && (
                              <div
                                style={{
                                  color: "var(--text-muted)",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                  maxWidth: 130,
                                }}
                                title={appName}
                              >
                                {appName}
                              </div>
                            )}
                            {meta.duration_seconds != null && (
                              <div style={{ color: "var(--signal-warning)", fontSize: "0.72rem" }}>
                                {Number(meta.duration_seconds).toFixed(1)}s hold
                              </div>
                            )}
                          </td>

                          {/* Detected Time */}
                          <td className="alert-table-td" style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                            <div>{dateFormatted}</div>
                            <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem" }}>
                              {timeFormatted}
                            </div>
                            <div style={{ fontSize: "0.7rem", opacity: 0.8 }}>
                              {timeAgo(hint.detectedAt)}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Diagnostic Inspector Drawer */}
        {selectedHint && (
          <div style={{ flex: "0 0 460px", minWidth: 360 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "var(--space-md)",
              }}
            >
              <div className="section-title" style={{ marginBottom: 0 }}>
                Incident Inspector
              </div>
              <button
                onClick={() => setSelectedHint(null)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                  padding: "4px 8px",
                }}
              >
                Close ✕
              </button>
            </div>

            <div className="glass-card-static" style={{ padding: "var(--space-lg)" }}>
              {/* Header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "var(--space-sm)",
                  marginBottom: "var(--space-md)",
                }}
              >
                <span style={{ fontSize: "1.4rem", marginTop: 2 }}>
                  {selectedHint.severity === "critical" ? "🔴" : "🟡"}
                </span>
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: "0.68rem",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      color:
                        selectedHint.severity === "critical"
                          ? "var(--signal-critical)"
                          : "var(--signal-warning)",
                    }}
                  >
                    {selectedHint.severity.toUpperCase()} INCIDENT
                  </div>
                  <div
                    style={{
                      fontSize: "1rem",
                      fontWeight: 700,
                      color: "var(--text-primary)",
                      marginTop: 2,
                    }}
                  >
                    {selectedHint.title}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 2 }}>
                    Detected: {new Date(selectedHint.detectedAt).toLocaleString()} ({timeAgo(selectedHint.detectedAt)})
                  </div>
                </div>
              </div>

              {/* Description */}
              <div
                style={{
                  padding: "var(--space-sm) var(--space-md)",
                  background: "var(--surface-alt)",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border)",
                  fontSize: "0.84rem",
                  color: "var(--text-primary)",
                  lineHeight: 1.5,
                  marginBottom: "var(--space-md)",
                }}
              >
                {selectedHint.description}
              </div>

              {/* Culprit Query Block if present */}
              {(() => {
                const meta = (selectedHint.metadata || {}) as Record<string, unknown>;
                const queryText = (meta.query_text || meta.blocked_query) as string | undefined;
                if (!queryText) return null;

                return (
                  <div style={{ marginBottom: "var(--space-md)" }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: 4,
                      }}
                    >
                      <span
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: 700,
                          color: "var(--text-primary)",
                        }}
                      >
                        CULPRIT / IMPACTED QUERY
                      </span>
                      <button
                        onClick={() => handleCopyQuery(queryText)}
                        style={{
                          background: "none",
                          border: "none",
                          color: "var(--brand)",
                          fontSize: "0.72rem",
                          cursor: "pointer",
                          fontWeight: 600,
                        }}
                      >
                        {copiedQuery ? "✓ Copied!" : "📋 Copy SQL"}
                      </button>
                    </div>
                    <pre
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "0.74rem",
                        background: "var(--background)",
                        padding: "8px 12px",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--border)",
                        color: "var(--text-primary)",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-all",
                        maxHeight: 160,
                        overflowY: "auto",
                        margin: 0,
                      }}
                    >
                      {queryText}
                    </pre>
                  </div>
                );
              })()}

              {/* Context Metadata */}
              <div style={{ marginBottom: "var(--space-md)" }}>
                <div
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 700,
                    color: "var(--text-primary)",
                    marginBottom: 6,
                  }}
                >
                  DIAGNOSTIC METADATA
                </div>
                <div
                  style={{
                    background: "var(--surface-alt)",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border)",
                    padding: "var(--space-sm) var(--space-md)",
                    fontSize: "0.78rem",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-muted)" }}>Rule Type:</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                      {selectedHint.ruleType}
                    </span>
                  </div>
                  {(() => {
                    const meta = (selectedHint.metadata || {}) as Record<string, unknown>;
                    return (
                      <>
                        {meta.pid != null && (
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: "var(--text-muted)" }}>Session PID:</span>
                            <span style={{ fontFamily: "var(--font-mono)" }}>
                              {String(meta.pid)}
                            </span>
                          </div>
                        )}
                        {meta.application_name && (
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: "var(--text-muted)" }}>App Name:</span>
                            <span style={{ fontFamily: "var(--font-mono)" }}>
                              {String(meta.application_name)}
                            </span>
                          </div>
                        )}
                        {meta.duration_seconds != null && (
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: "var(--text-muted)" }}>Duration:</span>
                            <span>{Number(meta.duration_seconds).toFixed(1)}s</span>
                          </div>
                        )}
                        {meta.waiting_sessions_count != null && (
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: "var(--text-muted)" }}>Waiting Sessions:</span>
                            <span style={{ color: "var(--signal-critical)", fontWeight: 600 }}>
                              {String(meta.waiting_sessions_count)}
                            </span>
                          </div>
                        )}
                        {meta.utilization_percent != null && (
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: "var(--text-muted)" }}>Utilization:</span>
                            <span>{(Number(meta.utilization_percent) * 100).toFixed(0)}%</span>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* Remediation Guide */}
              <div style={{ marginBottom: "var(--space-md)" }}>
                <div
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 700,
                    color: "var(--brand)",
                    marginBottom: 4,
                  }}
                >
                  💡 RECOMMENDED REMEDIATION
                </div>
                <div
                  style={{
                    fontSize: "0.78rem",
                    color: "var(--text-secondary)",
                    lineHeight: 1.5,
                    background: "var(--surface-alt)",
                    padding: "var(--space-sm) var(--space-md)",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border)",
                  }}
                >
                  {RULE_TYPE_INFO[selectedHint.ruleType]?.remediation ||
                    "Review recent query performance and ensure connection pools and transaction timeouts are properly configured."}
                </div>
              </div>

              {/* Fast Action Bridges */}
              <div>
                <div
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 700,
                    color: "var(--text-primary)",
                    marginBottom: 6,
                  }}
                >
                  EXPLORE RELATED DATA
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
                  <Link
                    href={`/databases/${id}/logs`}
                    className="btn-secondary"
                    style={{
                      fontSize: "0.78rem",
                      padding: "6px 10px",
                      textAlign: "center",
                      textDecoration: "none",
                    }}
                  >
                    📋 View PostgreSQL Server Logs
                  </Link>
                  <Link
                    href={`/databases/${id}/queries`}
                    className="btn-secondary"
                    style={{
                      fontSize: "0.78rem",
                      padding: "6px 10px",
                      textAlign: "center",
                      textDecoration: "none",
                    }}
                  >
                    🔍 Inspect Slow Queries
                  </Link>
                  <Link
                    href={`/databases/${id}`}
                    className="btn-secondary"
                    style={{
                      fontSize: "0.78rem",
                      padding: "6px 10px",
                      textAlign: "center",
                      textDecoration: "none",
                    }}
                  >
                    📊 Live Sessions & Connection Utilization
                  </Link>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
