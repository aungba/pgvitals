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
  const getToken = useApiToken();

  const fetchData = useCallback(async () => {
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
  }, [getToken]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10_000);
    return () => clearInterval(interval);
  }, [fetchData]);

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
        <div className="alert alert-error">
          <span>⚠️</span>
          <span>
            Unable to connect to the collector API. Make sure it&apos;s running
            on{" "}
            <code style={{ fontFamily: "var(--font-mono)" }}>
              {process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}
            </code>
          </span>
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
      <div className="page-header">
        <h1>Dashboard</h1>
        <p>
          Monitoring{" "}
          <strong style={{ color: "var(--brand)" }}>
            {items.length}
          </strong>{" "}
          database{items.length !== 1 ? "s" : ""} in real time
        </p>
      </div>

      <div className="db-grid stagger-children">
        {items.map(({ db, overview, activeAlerts }) => {
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
