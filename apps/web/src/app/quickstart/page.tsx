"use client";

import React, { useState } from "react";
import Link from "next/link";
import PublicNav from "../components/PublicNav";
import PublicFooter from "../components/PublicFooter";

export default function QuickstartPage() {
  const [activeTab, setActiveTab] = useState<"step1" | "step2" | "step3" | "step4">("step1");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyCode = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const modernSql = `-- 1. Create a dedicated read-only monitoring user
CREATE USER pgvitals_monitor WITH PASSWORD 'choose_a_strong_password' CONNECTION LIMIT 5;

-- 2. Grant statistics and schema inspection permissions (PostgreSQL 14, 15, 16, 17, 18+)
GRANT CONNECT ON DATABASE your_database TO pgvitals_monitor;
GRANT pg_read_all_stats TO pgvitals_monitor;
GRANT pg_read_all_data TO pgvitals_monitor;

-- 3. Enable query performance tracking (recommended)
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- 4. (Optional) Enable zero-risk hypothetical index simulation
CREATE EXTENSION IF NOT EXISTS hypopg;`;

  const legacySql = `-- 1. Create a dedicated read-only monitoring user
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

      <main className="landing-container" style={{ padding: "120px 24px 80px", maxWidth: 1060 }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <div className="landing-hero-badge" style={{ margin: "0 auto 16px" }}>
            <span>🚀 Getting Started with PG Vitals SaaS</span>
          </div>
          <h1 style={{ fontSize: "2.8rem", fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 16 }}>
            Start Monitoring Your PostgreSQL in 3 Steps
          </h1>
          <p style={{ fontSize: "1.15rem", color: "var(--text-secondary)", maxWidth: 660, margin: "0 auto" }}>
            PG Vitals is agentless. Simply create a read-only user on your database, paste your connection string into the dashboard, and immediately see live vitals, root-cause diagnostics, and optimization advice.
          </p>
        </div>

        {/* Interactive Step Navigator */}
        <div className="landing-tab-bar" style={{ maxWidth: 840, margin: "0 auto 36px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
          <button
            onClick={() => setActiveTab("step1")}
            className={`landing-tab-btn ${activeTab === "step1" ? "active" : ""}`}
            style={{ fontSize: "0.88rem" }}
          >
            1. Create Read-Only User
          </button>
          <button
            onClick={() => setActiveTab("step2")}
            className={`landing-tab-btn ${activeTab === "step2" ? "active" : ""}`}
            style={{ fontSize: "0.88rem" }}
          >
            2. Register in Dashboard
          </button>
          <button
            onClick={() => setActiveTab("step3")}
            className={`landing-tab-btn ${activeTab === "step3" ? "active" : ""}`}
            style={{ fontSize: "0.88rem" }}
          >
            3. Explore Live Vitals
          </button>
          <button
            onClick={() => setActiveTab("step4")}
            className={`landing-tab-btn ${activeTab === "step4" ? "active" : ""}`}
            style={{ fontSize: "0.88rem" }}
          >
            4. Connect Alerts & Slack
          </button>
        </div>

        {/* Step 1: Read-only user setup */}
        {activeTab === "step1" && (
          <div className="glass-card animate-fade-in" style={{ padding: "36px", borderRadius: 16, marginBottom: 40 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <span style={{ fontSize: "1.8rem" }}>🐘</span>
              <div>
                <h2 style={{ fontSize: "1.45rem", fontWeight: 700, margin: 0 }}>
                  Step 1: Set Up a Safe Read-Only PostgreSQL User
                </h2>
                <p style={{ color: "var(--text-secondary)", margin: "4px 0 0", fontSize: "0.95rem" }}>
                  Run this SQL in your database using <code>psql</code>, pgAdmin, DBeaver, or your cloud provider console.
                </p>
              </div>
            </div>

            <div style={{ marginBottom: 28 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontWeight: 600, fontSize: "0.9rem", color: "var(--brand)" }}>
                  PostgreSQL 14, 15, 16, 17, 18+ (Standard)
                </span>
                <button
                  onClick={() => copyCode(modernSql, "modern-sql")}
                  className="btn-secondary"
                  style={{ fontSize: "0.78rem", padding: "4px 10px" }}
                >
                  {copiedId === "modern-sql" ? "✓ Copied" : "Copy SQL"}
                </button>
              </div>
              <pre className="code-block" style={{ margin: 0, padding: 20, borderRadius: 10, overflowX: "auto" }}>
                <code>{modernSql}</code>
              </pre>
            </div>

            <div style={{ marginBottom: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontWeight: 600, fontSize: "0.88rem", color: "var(--text-secondary)" }}>
                  PostgreSQL 10, 11, 12, 13 (Legacy)
                </span>
                <button
                  onClick={() => copyCode(legacySql, "legacy-sql")}
                  className="btn-secondary"
                  style={{ fontSize: "0.78rem", padding: "4px 10px" }}
                >
                  {copiedId === "legacy-sql" ? "✓ Copied" : "Copy SQL"}
                </button>
              </div>
              <pre className="code-block" style={{ margin: 0, padding: 18, borderRadius: 10, overflowX: "auto" }}>
                <code>{legacySql}</code>
              </pre>
            </div>

            <div style={{ padding: "16px 20px", borderRadius: 10, background: "var(--surface)", border: "1px solid var(--border)" }}>
              <h4 style={{ fontSize: "0.92rem", fontWeight: 600, marginBottom: 6, color: "var(--text-primary)" }}>
                🛡️ Zero Customer Row Access Guarantee
              </h4>
              <p style={{ fontSize: "0.88rem", color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 }}>
                The <code>pg_read_all_stats</code> role only grants access to PostgreSQL internal diagnostic statistics views (<code>pg_stat_activity</code>, <code>pg_stat_statements</code>, <code>pg_locks</code>). PG Vitals never selects or reads your customer data.
              </p>
            </div>
          </div>
        )}

        {/* Step 2: Register in Dashboard */}
        {activeTab === "step2" && (
          <div className="glass-card animate-fade-in" style={{ padding: "36px", borderRadius: 16, marginBottom: 40 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <span style={{ fontSize: "1.8rem" }}>📋</span>
              <div>
                <h2 style={{ fontSize: "1.45rem", fontWeight: 700, margin: 0 }}>
                  Step 2: Add Database to PG Vitals
                </h2>
                <p style={{ color: "var(--text-secondary)", margin: "4px 0 0", fontSize: "0.95rem" }}>
                  Navigate to your PG Vitals dashboard and register your database.
                </p>
              </div>
            </div>

            <ol style={{ paddingLeft: 20, lineHeight: 1.8, color: "var(--text-secondary)", fontSize: "0.98rem", marginBottom: 28 }}>
              <li>
                Sign in to your PG Vitals account and click <strong>"Add Database"</strong> (or go to <Link href="/onboarding" style={{ color: "var(--brand)" }}>/onboarding</Link>).
              </li>
              <li>
                Choose a friendly name (e.g. <code>Production Primary</code>) and select an environment (<code>production</code>, <code>staging</code>, or <code>development</code>).
              </li>
              <li>
                Paste your PostgreSQL connection string:
                <div style={{ margin: "10px 0" }}>
                  <code style={{ padding: "6px 12px", borderRadius: 6, background: "var(--surface)", border: "1px solid var(--border)", display: "block", color: "var(--brand)", fontSize: "0.88rem" }}>
                    postgresql://pgvitals_monitor:your_password@db.example.com:5432/your_database?sslmode=require
                  </code>
                </div>
              </li>
              <li>
                Click <strong>"Test Connection"</strong>. PG Vitals validates connection latency, PostgreSQL version, and verifies extension availability (<code>pg_stat_statements</code>, <code>hypopg</code>).
              </li>
              <li>
                Click <strong>"Save & Start Monitoring"</strong>.
              </li>
            </ol>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
              {[
                { name: "AWS RDS / Aurora", note: "Allow inbound port 5432 in your AWS Security Group." },
                { name: "Supabase", note: "Use port 5432 (direct) or port 6543 (connection pooler)." },
                { name: "Neon Serverless", note: "Paste your Neon connection URI with ?sslmode=require." },
                { name: "Google Cloud SQL", note: "Whitelist PG Vitals or connect via Cloud SQL Auth Proxy." },
              ].map((c, i) => (
                <div key={i} style={{ padding: 14, borderRadius: 8, background: "var(--surface)", border: "1px solid var(--border)" }}>
                  <strong style={{ fontSize: "0.88rem", display: "block", marginBottom: 4 }}>{c.name}</strong>
                  <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{c.note}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step 3: Explore Live Vitals */}
        {activeTab === "step3" && (
          <div className="glass-card animate-fade-in" style={{ padding: "36px", borderRadius: 16, marginBottom: 40 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <span style={{ fontSize: "1.8rem" }}>⚡</span>
              <div>
                <h2 style={{ fontSize: "1.45rem", fontWeight: 700, margin: 0 }}>
                  Step 3: Monitor Live Sessions, Locks & Performance
                </h2>
                <p style={{ color: "var(--text-secondary)", margin: "4px 0 0", fontSize: "0.95rem" }}>
                  Your metrics begin streaming immediately via real-time push updates.
                </p>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18, marginTop: 20 }}>
              <div style={{ padding: 18, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)" }}>
                <h3 style={{ fontSize: "1.05rem", fontWeight: 700, marginBottom: 6, color: "var(--text-primary)" }}>
                  🔴 Live Connection Gauge & Locks
                </h3>
                <p style={{ fontSize: "0.88rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                  See active connections vs. max ceiling, idle in transaction sessions, and instantly identify root blocker queries with 1-click termination.
                </p>
              </div>

              <div style={{ padding: 18, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)" }}>
                <h3 style={{ fontSize: "1.05rem", fontWeight: 700, marginBottom: 6, color: "var(--text-primary)" }}>
                  💡 Automated Index Advisor
                </h3>
                <p style={{ fontSize: "0.88rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                  Detect missing indexes, bloated B-Trees, and simulate performance improvements in HypoPG before running non-blocking <code>CREATE INDEX CONCURRENTLY</code> scripts.
                </p>
              </div>

              <div style={{ padding: 18, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)" }}>
                <h3 style={{ fontSize: "1.05rem", fontWeight: 700, marginBottom: 6, color: "var(--text-primary)" }}>
                  🔍 Query Performance & P95/P99
                </h3>
                <p style={{ fontSize: "0.88rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                  Track top slowest queries, identify disk I/O fsync stalls vs CPU bottlenecks, and review side-by-side EXPLAIN plan regression visualizers.
                </p>
              </div>

              <div style={{ padding: 18, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)" }}>
                <h3 style={{ fontSize: "1.05rem", fontWeight: 700, marginBottom: 6, color: "var(--text-primary)" }}>
                  🧹 VACUUM & Bloat Health
                </h3>
                <p style={{ fontSize: "0.88rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                  Prevent transaction ID (XID) wraparounds, monitor dead tuple accumulation, tune HOT update fillfactors, and detect autovacuum worker starvation.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Alerts & Slack */}
        {activeTab === "step4" && (
          <div className="glass-card animate-fade-in" style={{ padding: "36px", borderRadius: 16, marginBottom: 40 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <span style={{ fontSize: "1.8rem" }}>📡</span>
              <div>
                <h2 style={{ fontSize: "1.45rem", fontWeight: 700, margin: 0 }}>
                  Step 4: Configure Incident Alerts & Slack ChatOps
                </h2>
                <p style={{ color: "var(--text-secondary)", margin: "4px 0 0", fontSize: "0.95rem" }}>
                  Get notified before database saturation impacts your users.
                </p>
              </div>
            </div>

            <p style={{ color: "var(--text-secondary)", lineHeight: 1.6, fontSize: "0.95rem" }}>
              Navigate to <strong>Alerts</strong> in your database dashboard to configure notification channels:
            </p>

            <ul style={{ paddingLeft: 20, lineHeight: 1.8, color: "var(--text-secondary)", fontSize: "0.95rem", marginBottom: 24 }}>
              <li><strong>Slack Webhooks:</strong> Rich alert cards with query context, blocker PIDs, and interactive <strong>⚡ Terminate Blocker</strong> buttons.</li>
              <li><strong>PagerDuty:</strong> Events API v2 on-call incident triggers with automatic resolution.</li>
              <li><strong>Email (SMTP):</strong> Diagnostic incident reports sent directly to engineering distribution lists.</li>
              <li><strong>Custom Webhooks:</strong> Signed HMAC-SHA256 JSON payloads for custom incident management pipelines.</li>
            </ul>

            <div style={{ padding: "16px 20px", borderRadius: 10, background: "rgba(59, 130, 246, 0.08)", border: "1px solid rgba(59, 130, 246, 0.25)" }}>
              <strong style={{ color: "var(--text-primary)", fontSize: "0.92rem" }}>🎯 Built-In Sentinel Protections:</strong>
              <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", margin: "4px 0 0" }}>
                Alert rules are pre-configured out-of-the-box for connection spikes (&gt;85%), deadlock storms, cascading lock queues, XID wraparound risk, and replication byte lag.
              </p>
            </div>
          </div>
        )}

        {/* Bottom CTA Banner */}
        <div
          className="glass-card"
          style={{
            textAlign: "center",
            padding: "48px 24px",
            borderRadius: 16,
            background: "linear-gradient(135deg, rgba(59, 130, 246, 0.08) 0%, rgba(139, 92, 246, 0.08) 100%)",
            border: "1px solid rgba(59, 130, 246, 0.2)",
          }}
        >
          <h3 style={{ fontSize: "1.7rem", fontWeight: 700, marginBottom: 12 }}>Ready to Get Started?</h3>
          <p style={{ color: "var(--text-secondary)", marginBottom: 24, maxWidth: 520, margin: "0 auto 24px" }}>
            Add your PostgreSQL database in seconds and gain full visibility into your query execution, locks, and storage health.
          </p>
          <div style={{ display: "flex", justifyContent: "center", gap: 16, flexWrap: "wrap" }}>
            <Link href="/" className="landing-cta-btn" style={{ padding: "12px 28px", fontSize: "1rem" }}>
              <span>Open PG Vitals Dashboard</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </Link>
            <Link href="/docs" className="btn-secondary" style={{ padding: "12px 24px", fontSize: "1rem" }}>
              Explore Full Documentation →
            </Link>
          </div>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
