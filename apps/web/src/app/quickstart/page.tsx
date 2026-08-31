"use client";

import React, { useState } from "react";
import Link from "next/link";
import PublicNav from "../components/PublicNav";
import PublicFooter from "../components/PublicFooter";
import CodeCard from "../components/CodeCard";

export default function QuickstartPage() {
  const modernSql = `-- 1. Create a dedicated monitoring user with connection ceiling
CREATE USER pgvitals_monitor WITH PASSWORD 'choose_a_strong_password' CONNECTION LIMIT 5;

-- 2. Grant statistics and catalog read permissions (PostgreSQL 14+)
GRANT CONNECT ON DATABASE your_database TO pgvitals_monitor;
GRANT pg_read_all_stats TO pgvitals_monitor;
GRANT pg_read_all_data TO pgvitals_monitor;

-- 3. Enable statement-level query tracking (recommended)
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- 4. (Optional) Enable zero-risk hypothetical index simulation
CREATE EXTENSION IF NOT EXISTS hypopg;`;

  const legacySql = `-- 1. Create a dedicated monitoring user with connection ceiling
CREATE USER pgvitals_monitor WITH PASSWORD 'choose_a_strong_password' CONNECTION LIMIT 5;

-- 2. Grant permissions for PostgreSQL 10, 11, 12, 13
GRANT CONNECT ON DATABASE your_database TO pgvitals_monitor;
GRANT pg_read_all_stats TO pgvitals_monitor;
GRANT USAGE ON SCHEMA public TO pgvitals_monitor;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO pgvitals_monitor;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO pgvitals_monitor;

-- 3. Enable query performance tracking
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;`;

  return (
    <div className="landing-root">
      <div className="landing-glow-blob landing-glow-1" />
      <div className="landing-glow-blob landing-glow-2" />

      <PublicNav />

      <main className="docs-wrapper" style={{ maxWidth: 1040 }}>
        {/* Header Hero */}
        <div className="docs-header-hero" style={{ textAlign: "center" }}>
          <div className="landing-hero-badge" style={{ margin: "0 auto 14px" }}>
            <span>🚀 Quick Start Guide</span>
          </div>
          <h1>Connect Your PostgreSQL in 3 Steps</h1>
          <p style={{ margin: "0 auto" }}>
            PG Vitals is agentless. Set up a read-only user on your database, paste your connection string, and immediately observe live vitals, root blockers, and index recommendations.
          </p>
        </div>

        {/* Step 1 Card */}
        <div className="quickstart-step-card">
          <div className="quickstart-step-header">
            <div className="quickstart-step-number">1</div>
            <div>
              <h2 className="quickstart-step-title">Create a Read-Only User on Your Database</h2>
              <p className="quickstart-step-desc">
                Run this SQL in your PostgreSQL instance (AWS RDS, Supabase, Neon, GCP Cloud SQL, or self-hosted) using <code>psql</code>, pgAdmin, or your DB client.
              </p>
            </div>
          </div>

          <CodeCard
            code={modernSql}
            language="sql"
            title="SQL · PostgreSQL 14, 15, 16, 17, 18+"
          />

          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: "pointer", fontSize: "0.88rem", color: "var(--brand)", fontWeight: 600 }}>
              Need SQL for PostgreSQL 10–13 Legacy?
            </summary>
            <div style={{ marginTop: 10 }}>
              <CodeCard
                code={legacySql}
                language="sql"
                title="SQL · PostgreSQL 10, 11, 12, 13"
              />
            </div>
          </details>

          <div className="docs-callout docs-callout-info" style={{ marginTop: 20 }}>
            <div className="docs-callout-icon">🛡️</div>
            <div>
              <strong>Zero Customer Data Access Guarantee:</strong> The <code>pg_read_all_stats</code> role only permits reading PostgreSQL internal system performance views (<code>pg_stat_activity</code>, <code>pg_stat_statements</code>, <code>pg_locks</code>). PG Vitals never reads or stores your customer table records.
            </div>
          </div>
        </div>

        {/* Step 2 Card */}
        <div className="quickstart-step-card">
          <div className="quickstart-step-header">
            <div className="quickstart-step-number">2</div>
            <div>
              <h2 className="quickstart-step-title">Register Database in the Dashboard</h2>
              <p className="quickstart-step-desc">
                Provide your connection string in the PG Vitals dashboard.
              </p>
            </div>
          </div>

          <ol style={{ paddingLeft: 22, lineHeight: 1.8, fontSize: "0.96rem", color: "var(--text-secondary)" }}>
            <li>Open the PG Vitals dashboard and click <strong>"Add Database"</strong>.</li>
            <li>Give your database a name (e.g. <code>Production Primary</code>) and select an environment tag.</li>
            <li>Paste your standard PostgreSQL connection URI:
              <div style={{ margin: "8px 0" }}>
                <CodeCard
                  code="postgresql://pgvitals_monitor:your_password@db.example.com:5432/your_database?sslmode=require"
                  language="uri"
                  title="Connection URI Format"
                />
              </div>
            </li>
            <li>Click <strong>"Test Connection"</strong> to verify latency and extension availability.</li>
            <li>Click <strong>"Save & Start Monitoring"</strong>.</li>
          </ol>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginTop: 20 }}>
            {[
              { name: "AWS RDS / Aurora", note: "Allow port 5432 in your AWS Security Group." },
              { name: "Supabase", note: "Use port 5432 (direct) or 6543 (connection pooler)." },
              { name: "Neon Serverless", note: "Paste connection URI with ?sslmode=require." },
              { name: "Google Cloud SQL", note: "Connect via public authorized IP or Cloud SQL Proxy." },
            ].map((c, i) => (
              <div key={i} style={{ padding: 14, borderRadius: 10, background: "var(--surface-alt)", border: "1px solid var(--border)" }}>
                <strong style={{ fontSize: "0.88rem", display: "block", color: "var(--text-primary)", marginBottom: 4 }}>{c.name}</strong>
                <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>{c.note}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Step 3 Card */}
        <div className="quickstart-step-card">
          <div className="quickstart-step-header">
            <div className="quickstart-step-number">3</div>
            <div>
              <h2 className="quickstart-step-title">Explore Live Vitals & Actionable Diagnostics</h2>
              <p className="quickstart-step-desc">
                Your database telemetry begins streaming immediately with zero polling overhead.
              </p>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
            <div style={{ padding: 16, borderRadius: 10, background: "var(--surface-alt)", border: "1px solid var(--border)" }}>
              <h4 style={{ fontSize: "0.95rem", fontWeight: 700, margin: "0 0 6px", color: "var(--text-primary)" }}>
                🔴 Live Connection Gauge
              </h4>
              <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", margin: 0 }}>
                Real-time active connections, headroom slots, and root blocker PID identification with 1-click termination.
              </p>
            </div>

            <div style={{ padding: 16, borderRadius: 10, background: "var(--surface-alt)", border: "1px solid var(--border)" }}>
              <h4 style={{ fontSize: "0.95rem", fontWeight: 700, margin: "0 0 6px", color: "var(--text-primary)" }}>
                💡 HypoPG Index Advisor
              </h4>
              <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", margin: 0 }}>
                Test planner improvements in HypoPG before running zero-downtime <code>CREATE INDEX CONCURRENTLY</code> scripts.
              </p>
            </div>

            <div style={{ padding: 16, borderRadius: 10, background: "var(--surface-alt)", border: "1px solid var(--border)" }}>
              <h4 style={{ fontSize: "0.95rem", fontWeight: 700, margin: "0 0 6px", color: "var(--text-primary)" }}>
                ⚡ Query Performance
              </h4>
              <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", margin: 0 }}>
                Track slowest queries, disk vs CPU I/O stalls, and review side-by-side EXPLAIN plan diffs.
              </p>
            </div>

            <div style={{ padding: 16, borderRadius: 10, background: "var(--surface-alt)", border: "1px solid var(--border)" }}>
              <h4 style={{ fontSize: "0.95rem", fontWeight: 700, margin: "0 0 6px", color: "var(--text-primary)" }}>
                📡 Slack ChatOps
              </h4>
              <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", margin: 0 }}>
                Receive incident alerts in Slack and terminate rogue blockers directly from your team channel.
              </p>
            </div>
          </div>
        </div>

        {/* CTA Bottom Banner */}
        <div
          className="glass-card"
          style={{
            textAlign: "center",
            padding: "48px 24px",
            borderRadius: 16,
            background: "linear-gradient(135deg, rgba(99, 102, 241, 0.08) 0%, rgba(139, 92, 246, 0.08) 100%)",
            border: "1px solid rgba(99, 102, 241, 0.25)",
          }}
        >
          <h3 style={{ fontSize: "1.7rem", fontWeight: 700, marginBottom: 10 }}>Ready to Eliminate Database Blindspots?</h3>
          <p style={{ color: "var(--text-secondary)", marginBottom: 24, maxWidth: 520, margin: "0 auto 24px" }}>
            Start monitoring your PostgreSQL database today with real-time vitals and automated root cause alerts.
          </p>
          <div style={{ display: "flex", justifyContent: "center", gap: 14, flexWrap: "wrap" }}>
            <Link href="/" className="landing-cta-btn" style={{ padding: "12px 28px", fontSize: "0.98rem" }}>
              <span>Open Dashboard</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </Link>
            <Link href="/docs" className="btn-secondary" style={{ padding: "12px 24px", fontSize: "0.98rem" }}>
              Explore Full Documentation →
            </Link>
          </div>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
