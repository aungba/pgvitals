"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  getDatabase,
  getOverview,
  getSessions,
  getSnapshots,
  getHints,
  getActiveAlerts,
  deleteDatabase,
  getSchemaEvents,
} from "../../lib/api";
import type {
  Database,
  OverviewResponse,
  Session,
  Snapshot,
  Hint,
  Alert,
  SchemaEvent,
} from "../../lib/api";
import ConnectionGauge from "../../components/ConnectionGauge";
import ConnectionChart from "../../components/ConnectionChart";
import SessionsTable from "../../components/SessionsTable";
import HintCard from "../../components/HintCard";
import StatsCard from "../../components/StatsCard";
import StatusBadge from "../../components/StatusBadge";
import AlertBanner from "../../components/AlertBanner";
import SessionGroups from "../../components/SessionGroups";
import { ErrorBoundary } from "../../components/ErrorBoundary";
import { Skeleton, CardSkeleton, ChartSkeleton, TableSkeleton } from "../../components/Skeleton";
import Link from "next/link";

/* ===================================================================
   Database Detail — Enhanced Main Monitoring View
   =================================================================== */

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

export default function DatabaseDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [database, setDatabase] = useState<Database | null>(null);
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [hints, setHints] = useState<Hint[]>([]);
  const [activeAlerts, setActiveAlerts] = useState<Alert[]>([]);
  const [schemaEvents, setSchemaEvents] = useState<SchemaEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [countdown, setCountdown] = useState(10);
  const [selectedHistoricalTimestamp, setSelectedHistoricalTimestamp] = useState<string | null>(null);
  const [replaySnapshotTimestamp, setReplaySnapshotTimestamp] = useState<string | null>(null);
  const [replayLoading, setReplayLoading] = useState(false);
  const [copiedBlockerPid, setCopiedBlockerPid] = useState<number | null>(null);

  const handleDelete = useCallback(async () => {
    if (!database) return;
    const confirmed = window.confirm(
      `Are you sure you want to delete "${database.name}"? This will remove all snapshots, sessions, and hints.`
    );
    if (!confirmed) return;

    setDeleting(true);
    try {
      await deleteDatabase(id);
      router.push("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete database");
      setDeleting(false);
    }
  }, [database, id, router]);

  const fetchAll = useCallback(async () => {
    try {
      const [db, ov, sessRes, snaps, hnts, als, schEvt] = await Promise.all([
        getDatabase(id),
        getOverview(id),
        getSessions(id),
        getSnapshots(id, 200),
        getHints(id),
        getActiveAlerts(id),
        getSchemaEvents(id).catch(() => ({ events: [] as SchemaEvent[] })),
      ]);
      setDatabase(db);
      setOverview(ov);
      if (!selectedHistoricalTimestamp) {
        setSessions(sessRes.sessions);
      }
      setSnapshots(snaps);
      setHints(hnts);
      setActiveAlerts(als);
      setSchemaEvents(schEvt.events);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch data");
    } finally {
      setLoading(false);
      setCountdown(10);
    }
  }, [id, selectedHistoricalTimestamp]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Polling with countdown & pause capability (auto-pauses in time-travel mode)
  useEffect(() => {
    if (isPaused || selectedHistoricalTimestamp !== null) return;

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          fetchAll();
          return 10;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isPaused, selectedHistoricalTimestamp, fetchAll]);

  // Handle Point-in-Time Snapshot Selection
  const handleSelectSnapshot = useCallback(async (ts: string | null) => {
    if (!ts) {
      setSelectedHistoricalTimestamp(null);
      setReplaySnapshotTimestamp(null);
      fetchAll();
      return;
    }

    setSelectedHistoricalTimestamp(ts);
    setReplayLoading(true);
    try {
      const res = await getSessions(id, ts);
      setSessions(res.sessions);
      setReplaySnapshotTimestamp(res.snapshotTimestamp ?? ts);
    } catch {
      // ignore
    } finally {
      setReplayLoading(false);
    }
  }, [id, fetchAll]);

  // Find index of current historical snapshot in snapshots array for Prev / Next step
  const currentSnapshotIndex = useMemo(() => {
    if (!selectedHistoricalTimestamp || !snapshots.length) return -1;
    const targetMs = new Date(selectedHistoricalTimestamp).getTime();
    // Sort snapshots chronologically
    const sorted = [...snapshots].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return sorted.findIndex((s) => Math.abs(new Date(s.timestamp).getTime() - targetMs) < 5000);
  }, [selectedHistoricalTimestamp, snapshots]);

  const sortedChronologicalSnapshots = useMemo(() => {
    return [...snapshots].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [snapshots]);

  const handleStepSnapshot = (direction: "prev" | "next") => {
    if (!sortedChronologicalSnapshots.length) return;
    let newIndex = currentSnapshotIndex;
    if (newIndex === -1) {
      newIndex = sortedChronologicalSnapshots.length - 1;
    }
    if (direction === "prev" && newIndex > 0) {
      handleSelectSnapshot(sortedChronologicalSnapshots[newIndex - 1].timestamp);
    } else if (direction === "next") {
      if (newIndex < sortedChronologicalSnapshots.length - 1) {
        handleSelectSnapshot(sortedChronologicalSnapshots[newIndex + 1].timestamp);
      } else {
        handleSelectSnapshot(null); // Return to live
      }
    }
  };

  // Blocker chain detection
  const rootBlockers = useMemo(() => {
    const blockers = new Map<number, { session: Session; blockedPids: number[] }>();

    for (const s of sessions) {
      if (s.blockingPid) {
        const root = sessions.find((x) => x.pid === s.blockingPid);
        if (root) {
          if (!blockers.has(root.pid)) {
            blockers.set(root.pid, { session: root, blockedPids: [] });
          }
          blockers.get(root.pid)!.blockedPids.push(s.pid);
        }
      }
    }

    return Array.from(blockers.values());
  }, [sessions]);

  if (loading) {
    return (
      <div className="animate-fade-in">
        <div className="skeleton" style={{ width: 300, height: 32, marginBottom: 16 }} />
        <div className="skeleton" style={{ width: 160, height: 18, marginBottom: 40 }} />
        <div className="stats-row" style={{ marginBottom: "var(--space-xl)" }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton" style={{ height: 80, borderRadius: "var(--radius-lg)" }} />
          ))}
        </div>
        <div className="skeleton" style={{ height: 360, borderRadius: "var(--radius-lg)", marginBottom: 24 }} />
        <div className="skeleton" style={{ height: 300, borderRadius: "var(--radius-lg)" }} />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <Link href="/" className="btn-secondary" style={{ marginBottom: "var(--space-lg)", display: "inline-flex" }}>
          ← Back
        </Link>
        <div className="alert alert-error">
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (!database) return null;

  const snap = overview?.snapshot;
  const current = snap?.connectionCount ?? 0;
  const max = snap?.maxConnections ?? 100;
  const utilizationPercent = overview?.utilization?.percent ?? 0;
  const utilizationLabel =
    utilizationPercent < 60 ? "healthy" : utilizationPercent < 80 ? "warning" : "critical";

  const criticalHints = hints.filter((h) => h.severity === "critical");
  const warningHints = hints.filter((h) => h.severity === "warning");
  const sortedHints = [...criticalHints, ...warningHints];

  return (
    <div className="animate-fade-in">
      {/* ---------- Active Alerts Banner ---------- */}
      <AlertBanner alerts={activeAlerts} databaseId={id} />

      {/* ---------- Header ---------- */}
      <div className="detail-header">
        <div className="detail-header-left">
          <Link
            href="/"
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
            title="Back to dashboard"
          >
            ←
          </Link>
          <div>
            <h1>{database.name}</h1>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", marginTop: 4 }}>
              <StatusBadge variant={database.environment} size="sm" />
              <StatusBadge variant={utilizationLabel} label={`${utilizationPercent}% utilized`} size="sm" dot />
            </div>
          </div>
        </div>

        {/* Header Right: Live Refresh Controller & Settings */}
        <div className="detail-header-right" style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", flexWrap: "wrap" }}>
          {/* Refresh Controller */}
          <div className="refresh-controller">
            <div className={`live-dot ${isPaused ? "paused" : ""}`} style={{ opacity: isPaused ? 0.4 : 1 }} />
            <span>{isPaused ? "Paused" : `Live (${countdown}s)`}</span>
            <button
              className="refresh-toggle-btn"
              onClick={() => setIsPaused(!isPaused)}
              title={isPaused ? "Resume auto-refresh" : "Pause auto-refresh"}
            >
              {isPaused ? "▶ Resume" : "⏸ Pause"}
            </button>
          </div>

          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginLeft: 4 }}>
            Updated: {snap ? formatTimestamp(snap.timestamp) : "—"}
          </span>

          <button
            onClick={handleDelete}
            disabled={deleting}
            title="Delete database"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              borderRadius: "var(--radius-md)",
              background: "var(--signal-critical-dim)",
              border: "1px solid color-mix(in srgb, var(--signal-critical) 25%, transparent)",
              color: "var(--signal-critical)",
              fontSize: "0.85rem",
              cursor: deleting ? "not-allowed" : "pointer",
              opacity: deleting ? 0.5 : 1,
              transition: "all var(--transition-fast)",
              flexShrink: 0,
              marginLeft: 4,
            }}
          >
            {deleting ? "…" : "🗑"}
          </button>
        </div>
      </div>

      {/* ---------- Feature Sub-Navigation Bar ---------- */}
      <nav className="feature-subnav" aria-label="Database navigation">
        <Link href={`/databases/${id}/queries`} className="feature-subnav-item">
          📊 Queries
        </Link>
        <Link href={`/databases/${id}/indexes`} className="feature-subnav-item">
          🗂️ Index Advisor
        </Link>
        <Link href={`/databases/${id}/health`} className="feature-subnav-item">
          🩺 Health & VACUUM
        </Link>
        <Link href={`/databases/${id}/alerts`} className="feature-subnav-item">
          🔔 Alerts
          {activeAlerts.length > 0 && (
            <span className="feature-subnav-badge">{activeAlerts.length}</span>
          )}
        </Link>
        <Link href={`/databases/${id}/logs`} className="feature-subnav-item">
          📋 Log Insights
        </Link>
        <Link href={`/databases/${id}/schema`} className="feature-subnav-item">
          📐 Schema Diffs
        </Link>
        <Link href={`/databases/${id}/plans`} className="feature-subnav-item">
          🔀 Plan Regressions
        </Link>
        <Link href={`/databases/${id}/costs`} className="feature-subnav-item">
          💰 Cost Estimator
        </Link>
        <Link href={`/databases/${id}/pooler`} className="feature-subnav-item">
          🔌 PgBouncer
        </Link>
      </nav>

      {/* ---------- Root Blocker Diagnostic Alert Banner ---------- */}
      {rootBlockers.length > 0 && (
        <div className="blocker-alert-box">
          <div className="blocker-alert-icon">⛔</div>
          <div className="blocker-alert-content">
            <div className="blocker-alert-title">
              Active Blocking Lock Chain Detected ({rootBlockers.length} root blocker{rootBlockers.length !== 1 ? "s" : ""})
            </div>
            {rootBlockers.map(({ session, blockedPids }) => (
              <div key={session.pid} style={{ marginTop: 8 }}>
                <div className="blocker-alert-desc">
                  <strong>PID {session.pid}</strong> ({session.usename || "unknown user"}, {session.applicationName || "unnamed app"}) is in state{" "}
                  <code style={{ background: "var(--surface)", padding: "1px 4px", borderRadius: 3, fontFamily: "var(--font-mono)" }}>
                    {session.state}
                  </code>{" "}
                  for {Math.round(session.stateDurationSeconds)}s and is holding locks blocking{" "}
                  <strong>{blockedPids.length} session{blockedPids.length !== 1 ? "s" : ""}</strong>.
                </div>
                {session.queryText && (
                  <div className="blocker-alert-query-section">
                    <div className="blocker-alert-query-header">
                      <span className="blocker-alert-query-label">Root Blocker Query:</span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(session.queryText);
                          setCopiedBlockerPid(session.pid);
                          setTimeout(() => setCopiedBlockerPid(null), 2000);
                        }}
                        className="btn-secondary blocker-alert-copy-btn"
                        title="Copy query to clipboard"
                      >
                        {copiedBlockerPid === session.pid ? "✓ Copied" : "Copy Query"}
                      </button>
                    </div>
                    <pre className="blocker-alert-query-box">
                      <code>{session.queryText}</code>
                    </pre>
                  </div>
                )}
                <div className="blocker-alert-pids">
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", alignSelf: "center" }}>Blocked PIDs:</span>
                  {blockedPids.map((bPid) => (
                    <span key={bPid} className="blocker-alert-pill">
                      PID {bPid}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---------- Connection Stats Row ---------- */}
      <div className="stats-row stagger-children">
        <StatsCard
          label="Total"
          value={current}
          icon="🔗"
          color="var(--brand)"
          subtitle={`of ${max} max`}
        />
        <StatsCard
          label="Active"
          value={snap?.activeCount ?? 0}
          icon="⚡"
          color="var(--signal-healthy)"
        />
        <StatsCard
          label="Idle"
          value={snap?.idleCount ?? 0}
          icon="💤"
          color="var(--signal-idle)"
        />
        <StatsCard
          label="Idle in Txn"
          value={(snap?.idleInTxnCount ?? 0) + (snap?.idleInTxnAbortedCount ?? 0)}
          icon="⏳"
          color="var(--signal-warning)"
          subtitle={
            (snap?.idleInTxnAbortedCount ?? 0) > 0
              ? `${snap?.idleInTxnAbortedCount} aborted`
              : undefined
          }
        />
      </div>

      {/* ---------- Health Metrics Row ---------- */}
      {overview?.health && (
        <div className="stats-row stagger-children" style={{ marginTop: "var(--space-md)" }}>
          <StatsCard
            label="Cache Hit"
            value={
              overview.health.cacheHitRatio != null
                ? `${(overview.health.cacheHitRatio * 100).toFixed(2)}%`
                : "—"
            }
            icon="🎯"
            color={
              overview.health.cacheHitRatio != null && overview.health.cacheHitRatio >= 0.99
                ? "var(--signal-healthy)"
                : overview.health.cacheHitRatio != null && overview.health.cacheHitRatio >= 0.95
                  ? "var(--signal-warning)"
                  : "var(--signal-critical)"
            }
            subtitle={
              overview.health.cacheHitRatio != null && overview.health.cacheHitRatio >= 0.99
                ? "Excellent"
                : overview.health.cacheHitRatio != null && overview.health.cacheHitRatio >= 0.95
                  ? "Acceptable"
                  : "Needs tuning"
            }
          />
          <StatsCard
            label="DB Size"
            value={
              overview.health.dbSizeBytes != null
                ? formatBytes(overview.health.dbSizeBytes)
                : "—"
            }
            icon="💾"
            color="var(--brand)"
          />
          <StatsCard
            label="Temp Files"
            value={
              overview.health.tempFileBytes != null
                ? formatBytes(overview.health.tempFileBytes)
                : "—"
            }
            icon="📁"
            color={
              overview.health.tempFileBytes != null && overview.health.tempFileBytes > 100 * 1024 * 1024
                ? "var(--signal-warning)"
                : "var(--signal-healthy)"
            }
            subtitle={
              overview.health.tempFileBytes != null && overview.health.tempFileBytes > 100 * 1024 * 1024
                ? "High — increase work_mem"
                : "Normal"
            }
          />
          <StatsCard
            label="Deadlocks"
            value={overview.health.deadlocksCount ?? 0}
            icon="🔒"
            color={
              (overview.health.deadlocksCount ?? 0) > 0
                ? "var(--signal-critical)"
                : "var(--signal-healthy)"
            }
            subtitle={
              (overview.health.deadlocksCount ?? 0) > 0
                ? "Click to view events →"
                : undefined
            }
            href={`/databases/${id}/logs?filter=deadlock`}
          />
        </div>
      )}

      {/* ---------- Gauge + Root Cause Hints ---------- */}
      <div className="detail-grid" style={{ marginBottom: "var(--space-xl)", marginTop: "var(--space-md)" }}>
        {/* Gauge */}
        <div
          className="glass-card-static"
          style={{
            padding: "var(--space-lg)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div className="section-title" style={{ alignSelf: "flex-start", marginBottom: "var(--space-md)" }}>
            Connection Utilization
          </div>
          <ConnectionGauge current={current} max={max} size={200} strokeWidth={12} />
        </div>

        {/* Hints */}
        <div>
          <div className="section-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              Root Cause Hints{" "}
              {sortedHints.length > 0 && (
                <span
                  style={{
                    background: "var(--brand-dim)",
                    color: "var(--brand)",
                    padding: "1px 8px",
                    borderRadius: "9999px",
                    fontSize: "0.7rem",
                    fontWeight: 600,
                    marginLeft: 8,
                    textTransform: "none",
                    letterSpacing: 0,
                  }}
                >
                  {sortedHints.length}
                </span>
              )}
            </div>
            <Link
              href={`/databases/${id}/hints`}
              style={{
                fontSize: "0.8rem",
                color: "var(--brand)",
                textDecoration: "none",
                fontWeight: 500,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                transition: "opacity var(--transition-fast)",
              }}
            >
              View Full Logs & History →
            </Link>
          </div>
          {sortedHints.length > 0 ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-sm)",
                maxHeight: 360,
                overflowY: "auto",
              }}
            >
              {sortedHints.slice(0, 5).map((hint, i) => (
                <HintCard key={hint.id} hint={hint} index={i} />
              ))}
              {sortedHints.length > 5 && (
                <div style={{ textAlign: "center", paddingTop: "var(--space-xs)" }}>
                  <Link
                    href={`/databases/${id}/hints`}
                    style={{
                      fontSize: "0.78rem",
                      color: "var(--text-muted)",
                      textDecoration: "none",
                    }}
                  >
                    + {sortedHints.length - 5} more hints in full log →
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <div
              className="glass-card-static"
              style={{
                padding: "var(--space-xl)",
                textAlign: "center",
                color: "var(--text-muted)",
                height: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div style={{ fontSize: "2rem", marginBottom: 8, opacity: 0.5 }}>✅</div>
              <div style={{ fontSize: "0.9rem" }}>No issues detected — everything looks healthy</div>
              <Link
                href={`/databases/${id}/hints`}
                style={{
                  marginTop: "var(--space-sm)",
                  fontSize: "0.75rem",
                  color: "var(--brand)",
                  textDecoration: "none",
                }}
              >
                Browse past incident logs →
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* ---------- Connection History Chart ---------- */}
      <div className="chart-section">
        <div className="section-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Connection History</span>
          {selectedHistoricalTimestamp && (
            <button
              onClick={() => handleSelectSnapshot(null)}
              className="btn-secondary"
              style={{ fontSize: "0.75rem", padding: "3px 10px", borderRadius: "var(--radius-full)" }}
            >
              ● Return to Live
            </button>
          )}
        </div>
        <ErrorBoundary name="Connection Chart">
          <ConnectionChart
            snapshots={snapshots}
            schemaEvents={schemaEvents}
            selectedTimestamp={selectedHistoricalTimestamp}
            onSelectTimestamp={handleSelectSnapshot}
          />
        </ErrorBoundary>
      </div>

      {/* ---------- Time-Travel Replay Banner ---------- */}
      {selectedHistoricalTimestamp && (
        <div
          className="animate-fade-in"
          style={{
            background: "var(--brand-dim)",
            border: "1px solid var(--brand)",
            borderRadius: "var(--radius-md)",
            padding: "var(--space-md) var(--space-lg)",
            marginBottom: "var(--space-lg)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "var(--space-md)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
            <span style={{ fontSize: "1.2rem" }}>⏱️</span>
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.9rem", color: "var(--brand)" }}>
                Time-Travel Snapshot Replay Mode
              </div>
              <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: 2 }}>
                Viewing snapshot from{" "}
                <strong style={{ color: "var(--text-primary)" }}>
                  {formatTimestamp(replaySnapshotTimestamp ?? selectedHistoricalTimestamp)}
                </strong>
                {replayLoading && <span style={{ marginLeft: 8, color: "var(--text-muted)" }}>Loading…</span>}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
            <button
              onClick={() => handleStepSnapshot("prev")}
              disabled={currentSnapshotIndex === 0}
              className="btn-secondary"
              style={{ fontSize: "0.8rem", padding: "4px 10px" }}
              title="Previous snapshot (10s earlier)"
            >
              ◀ Prev
            </button>
            <button
              onClick={() => handleStepSnapshot("next")}
              className="btn-secondary"
              style={{ fontSize: "0.8rem", padding: "4px 10px" }}
              title="Next snapshot (10s later)"
            >
              Next ▶
            </button>
            <button
              onClick={() => handleSelectSnapshot(null)}
              className="btn-primary"
              style={{ fontSize: "0.8rem", padding: "4px 12px" }}
            >
              ● Resume Live
            </button>
          </div>
        </div>
      )}

      {/* ---------- Session Grouping ---------- */}
      <div style={{ marginBottom: "var(--space-xl)" }}>
        <ErrorBoundary name="Session Groups">
          <SessionGroups sessions={sessions} maxConnections={max} />
        </ErrorBoundary>
      </div>

      {/* ---------- Sessions Table with Search & Filters ---------- */}
      <div>
        <div className="section-title">
          {selectedHistoricalTimestamp ? "Historical Sessions Snapshot" : "Active Sessions"}{" "}
          {sessions.length > 0 && (
            <span
              style={{
                background: selectedHistoricalTimestamp ? "var(--signal-warning-dim)" : "var(--brand-dim)",
                color: selectedHistoricalTimestamp ? "var(--signal-warning)" : "var(--brand)",
                padding: "1px 8px",
                borderRadius: "9999px",
                fontSize: "0.7rem",
                fontWeight: 600,
                marginLeft: 8,
                textTransform: "none",
                letterSpacing: 0,
              }}
            >
              {sessions.length}
            </span>
          )}
        </div>
        <ErrorBoundary name="Sessions Table">
          <SessionsTable sessions={sessions} />
        </ErrorBoundary>
      </div>
    </div>
  );
}
