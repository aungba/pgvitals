"use client";

import React, { useEffect, useState, useCallback } from "react";
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
import Link from "next/link";

/* ===================================================================
   Database Detail — Main monitoring view
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
      const [db, ov, sess, snaps, hnts, als, schEvt] = await Promise.all([
        getDatabase(id),
        getOverview(id),
        getSessions(id),
        getSnapshots(id, 100),
        getHints(id),
        getActiveAlerts(id),
        getSchemaEvents(id).catch(() => ({ events: [] as SchemaEvent[] })),
      ]);
      setDatabase(db);
      setOverview(ov);
      setSessions(sess);
      setSnapshots(snaps);
      setHints(hnts);
      setActiveAlerts(als);
      setSchemaEvents(schEvt.events);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch data");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 10_000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  if (loading) {
    return (
      <div className="animate-fade-in">
        <div
          className="skeleton"
          style={{ width: 300, height: 32, marginBottom: 16 }}
        />
        <div
          className="skeleton"
          style={{ width: 160, height: 18, marginBottom: 40 }}
        />
        <div
          className="stats-row"
          style={{ marginBottom: "var(--space-xl)" }}
        >
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="skeleton"
              style={{ height: 80, borderRadius: "var(--radius-lg)" }}
            />
          ))}
        </div>
        <div
          className="skeleton"
          style={{
            height: 360,
            borderRadius: "var(--radius-lg)",
            marginBottom: 24,
          }}
        />
        <div
          className="skeleton"
          style={{ height: 300, borderRadius: "var(--radius-lg)" }}
        />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <Link
          href="/"
          className="btn-secondary"
          style={{ marginBottom: "var(--space-lg)", display: "inline-flex" }}
        >
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
      {/* ---------- Active Alerts ---------- */}
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
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-sm)",
                marginTop: 4,
              }}
            >
              <StatusBadge variant={database.environment} size="sm" />
              <StatusBadge variant={utilizationLabel} label={`${utilizationPercent}% utilized`} size="sm" dot />
            </div>
          </div>
        </div>
        <div className="detail-header-right">
          <div className="live-dot" />
          <span>
            Last updated:{" "}
            {snap ? formatTimestamp(snap.timestamp) : "—"}
          </span>
          <Link
            href={`/databases/${id}/queries`}
            title="Query performance"
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
              fontSize: "0.9rem",
              transition: "all var(--transition-fast)",
              marginLeft: "var(--space-sm)",
              flexShrink: 0,
              textDecoration: "none",
            }}
          >
            📊
          </Link>
          <Link
            href={`/databases/${id}/indexes`}
            title="Index advisor"
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
              fontSize: "0.9rem",
              transition: "all var(--transition-fast)",
              marginLeft: "var(--space-sm)",
              flexShrink: 0,
              textDecoration: "none",
            }}
          >
            🗂️
          </Link>
          <Link
            href={`/databases/${id}/health`}
            title="Health & VACUUM"
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
              fontSize: "0.9rem",
              transition: "all var(--transition-fast)",
              marginLeft: "var(--space-sm)",
              flexShrink: 0,
              textDecoration: "none",
            }}
          >
            🩺
          </Link>
          <Link
            href={`/databases/${id}/alerts`}
            title="Alert settings"
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
              fontSize: "0.9rem",
              transition: "all var(--transition-fast)",
              marginLeft: "var(--space-sm)",
              flexShrink: 0,
              textDecoration: "none",
              position: "relative",
            }}
          >
            🔔
            {activeAlerts.length > 0 && (
              <span
                className={`alert-badge ${
                  activeAlerts.some((a) => a.severity === "critical")
                    ? "alert-badge-critical"
                    : "alert-badge-warning"
                }`}
                style={{
                  position: "absolute",
                  top: -6,
                  right: -6,
                  fontSize: "0.6rem",
                  minWidth: 16,
                  height: 16,
                  padding: "0 4px",
                }}
              >
                {activeAlerts.length}
              </span>
            )}
          </Link>
          <Link
            href={`/databases/${id}/logs`}
            title="Log Insights"
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
              fontSize: "0.9rem",
              transition: "all var(--transition-fast)",
              marginLeft: "var(--space-sm)",
              flexShrink: 0,
              textDecoration: "none",
            }}
          >
            📋
          </Link>
          <Link
            href={`/databases/${id}/schema`}
            title="Schema Changes"
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
              fontSize: "0.9rem",
              transition: "all var(--transition-fast)",
              marginLeft: "var(--space-sm)",
              flexShrink: 0,
              textDecoration: "none",
            }}
          >
            📐
          </Link>
          <Link
            href={`/databases/${id}/plans`}
            title="Plan Regression"
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
              fontSize: "0.9rem",
              transition: "all var(--transition-fast)",
              marginLeft: "var(--space-sm)",
              flexShrink: 0,
              textDecoration: "none",
            }}
          >
            🔀
          </Link>
          <Link
            href={`/databases/${id}/costs`}
            title="Cost Estimator"
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
              fontSize: "0.9rem",
              transition: "all var(--transition-fast)",
              marginLeft: "var(--space-sm)",
              flexShrink: 0,
              textDecoration: "none",
            }}
          >
            💰
          </Link>
          <Link
            href={`/databases/${id}/pooler`}
            title="PgBouncer Pools"
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
              fontSize: "0.9rem",
              transition: "all var(--transition-fast)",
              marginLeft: "var(--space-sm)",
              flexShrink: 0,
              textDecoration: "none",
            }}
          >
            🔌
          </Link>
          <button
            onClick={handleDelete}
            disabled={deleting}
            title="Delete database"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 36,
              height: 36,
              borderRadius: "var(--radius-md)",
              background: "var(--signal-critical-dim)",
              border: "1px solid color-mix(in srgb, var(--signal-critical) 25%, transparent)",
              color: "var(--signal-critical)",
              fontSize: "0.9rem",
              cursor: deleting ? "not-allowed" : "pointer",
              opacity: deleting ? 0.5 : 1,
              transition: "all var(--transition-fast)",
              marginLeft: "var(--space-sm)",
              flexShrink: 0,
            }}
          >
            {deleting ? "…" : "🗑"}
          </button>
        </div>
      </div>

      {/* ---------- Stats Row ---------- */}
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

      {/* ---------- Gauge + Hints ---------- */}
      <div className="detail-grid" style={{ marginBottom: "var(--space-xl)" }}>
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
          <div
            className="section-title"
            style={{ alignSelf: "flex-start", marginBottom: "var(--space-md)" }}
          >
            Connection Utilization
          </div>
          <ConnectionGauge
            current={current}
            max={max}
            size={200}
            strokeWidth={12}
          />
        </div>

        {/* Hints */}
        <div>
          <div className="section-title">
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
              {sortedHints.map((hint, i) => (
                <HintCard key={hint.id} hint={hint} index={i} />
              ))}
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
              <div style={{ fontSize: "2rem", marginBottom: 8, opacity: 0.5 }}>
                ✅
              </div>
              <div style={{ fontSize: "0.9rem" }}>
                No issues detected — everything looks healthy
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ---------- Connection Chart ---------- */}
      <div className="chart-section">
        <div className="section-title">Connection History</div>
        <ConnectionChart snapshots={snapshots} schemaEvents={schemaEvents} />
      </div>

      {/* ---------- Session Grouping ---------- */}
      <div style={{ marginBottom: "var(--space-xl)" }}>
        <SessionGroups sessions={sessions} maxConnections={max} />
      </div>

      {/* ---------- Sessions Table ---------- */}
      <div>
        <div className="section-title">
          Active Sessions{" "}
          {sessions.length > 0 && (
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
              {sessions.length}
            </span>
          )}
        </div>
        <SessionsTable sessions={sessions} />
      </div>
    </div>
  );
}
