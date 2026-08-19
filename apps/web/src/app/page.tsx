"use client";

import React, { useEffect, useState, useCallback } from "react";
import { getDatabases, getOverview, getActiveAlerts } from "./lib/api";
import type { Database, OverviewResponse, Alert } from "./lib/api";
import { useApiToken } from "./lib/useApiToken";
import Link from "next/link";
import ConnectionGauge from "./components/ConnectionGauge";
import StatusBadge from "./components/StatusBadge";

/* ===================================================================
   Dashboard Home — Lists all monitored databases with utilization
   =================================================================== */

interface DbWithOverview {
  db: Database;
  overview: OverviewResponse | null;
  activeAlerts: Alert[];
}

export default function DashboardPage() {
  const [items, setItems] = useState<DbWithOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<"name" | "env" | "utilization" | "alerts">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const { getToken, isReady } = useApiToken();

  const fetchData = useCallback(async () => {
    if (!isReady) return;
    try {
      const token = await getToken();
      const databases = await getDatabases(token);
      const withOverviews = await Promise.all(
        databases.map(async (db) => {
          try {
            const [overview, activeAlerts] = await Promise.all([
              getOverview(db.id, token),
              getActiveAlerts(db.id, token),
            ]);
            return { db, overview, activeAlerts };
          } catch {
            return { db, overview: null, activeAlerts: [] };
          }
        }),
      );
      setItems(withOverviews);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch databases");
    } finally {
      setLoading(false);
    }
  }, [getToken, isReady]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const sortedItems = React.useMemo(() => {
    return [...items].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      switch (sortKey) {
        case "name":
          return dir * a.db.name.localeCompare(b.db.name);
        case "env":
          return dir * a.db.environment.localeCompare(b.db.environment);
        case "utilization": {
          const utilA = a.overview?.utilization?.percent ?? 0;
          const utilB = b.overview?.utilization?.percent ?? 0;
          return dir * (utilA - utilB);
        }
        case "alerts":
          return dir * (a.activeAlerts.length - b.activeAlerts.length);
        default:
          return 0;
      }
    });
  }, [items, sortKey, sortDir]);

  function handleSort(key: typeof sortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <h1>Dashboard</h1>
          <p>Monitor your PostgreSQL databases in real time</p>
        </div>
        <div className="db-grid stagger-children">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="glass-card"
              style={{ padding: "var(--space-lg)", height: 220 }}
            >
              <div
                className="skeleton"
                style={{ width: "60%", height: 20, marginBottom: 12 }}
              />
              <div
                className="skeleton"
                style={{ width: "30%", height: 16, marginBottom: 24 }}
              />
              <div
                className="skeleton"
                style={{
                  width: 100,
                  height: 100,
                  borderRadius: "50%",
                  margin: "0 auto",
                }}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <div className="page-header">
          <h1>Dashboard</h1>
          <p>Monitor your PostgreSQL databases in real time</p>
        </div>
        <div className="empty-state animate-fade-in-up">
          <div className="empty-state-icon">⚠️</div>
          <h3>Failed to load databases</h3>
          <p style={{ marginBottom: "var(--space-lg)", color: "var(--signal-critical)" }}>
            {error}
          </p>
          <button onClick={fetchData} className="btn-primary">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!items.length) {
    return (
      <div>
        <div className="page-header">
          <h1>Dashboard</h1>
          <p>Monitor your PostgreSQL databases in real time</p>
        </div>
        <div className="empty-state animate-fade-in-up">
          <div className="empty-state-icon">🐘</div>
          <h3>No databases monitored yet</h3>
          <p style={{ marginBottom: "var(--space-lg)" }}>
            Add your first PostgreSQL database to start monitoring
          </p>
          <Link href="/databases/new" className="btn-primary">
            Add Database
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "var(--space-md)" }}>
        <div>
          <h1>Dashboard</h1>
          <p>
            Monitoring{" "}
            <strong style={{ color: "var(--brand)" }}>
              {items.length}
            </strong>{" "}
            database{items.length !== 1 ? "s" : ""} in real time
          </p>
        </div>
        <div style={{ display: "flex", gap: "var(--space-xs)", alignItems: "center" }}>
          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginRight: 4 }}>Sort:</span>
          {[
            { key: "name" as const, label: "Name" },
            { key: "env" as const, label: "Env" },
            { key: "utilization" as const, label: "Utilization" },
            { key: "alerts" as const, label: "Alerts" },
          ].map((opt) => (
            <button
              key={opt.key}
              onClick={() => handleSort(opt.key)}
              className={sortKey === opt.key ? "filter-chip active" : "filter-chip"}
              data-active={sortKey === opt.key}
              style={{ fontSize: "0.75rem", padding: "4px 8px" }}
            >
              {opt.label} {sortKey === opt.key ? (sortDir === "asc" ? "▲" : "▼") : ""}
            </button>
          ))}
        </div>
      </div>

      <div className="db-grid stagger-children">
        {sortedItems.map(({ db, overview, activeAlerts }) => {
          const current = overview?.snapshot?.connectionCount ?? 0;
          const max = overview?.snapshot?.maxConnections ?? 100;
          const utilization = overview?.utilization?.percent ?? 0;
          const hasCritical = activeAlerts.some((a) => a.severity === "critical");

          return (
            <Link
              key={db.id}
              href={`/databases/${db.id}`}
              className="glass-card db-card"
            >
              <div className="db-card-header">
                <div className="db-card-name">
                  {db.name}
                  {activeAlerts.length > 0 && (
                    <span
                      className={`alert-badge ${hasCritical ? "alert-badge-critical" : "alert-badge-warning"}`}
                      style={{ marginLeft: 8 }}
                    >
                      {activeAlerts.length}
                    </span>
                  )}
                </div>
                <StatusBadge variant={db.environment} size="sm" />
              </div>

              <div className="db-card-gauge">
                <ConnectionGauge
                  current={current}
                  max={max}
                  size={120}
                  strokeWidth={8}
                />
              </div>

              <div className="db-card-meta">
                <span>
                  {current} connection{current !== 1 ? "s" : ""}
                </span>
                <span style={{ opacity: 0.3 }}>·</span>
                <span>
                  {utilization}% utilized
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
