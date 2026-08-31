"use client";

import React, { useState } from "react";
import Link from "next/link";
import PublicNav from "../components/PublicNav";
import PublicFooter from "../components/PublicFooter";

export default function QuickstartPage() {
  const [activeTab, setActiveTab] = useState<"docker" | "sql" | "clouds">("docker");
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  const copyToClipboard = (text: string, sectionId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(sectionId);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  const sqlModern = `-- Create read-only monitoring user with connection ceiling
CREATE USER pgvitals_monitor WITH PASSWORD 'your_strong_password' CONNECTION LIMIT 5;

-- Grant statistics and data reading roles (PostgreSQL 14, 15, 16, 17, 18+)
GRANT CONNECT ON DATABASE your_database TO pgvitals_monitor;
GRANT pg_read_all_stats TO pgvitals_monitor;
GRANT pg_read_all_data TO pgvitals_monitor;

-- Enable statement-level query performance tracking
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- (Optional) Enable zero-risk hypothetical index simulation
CREATE EXTENSION IF NOT EXISTS hypopg;`;

  const sqlLegacy = `-- Create read-only monitoring user with connection ceiling
CREATE USER pgvitals_monitor WITH PASSWORD 'your_strong_password' CONNECTION LIMIT 5;

-- Grant permissions for PostgreSQL 10, 11, 12, 13
GRANT CONNECT ON DATABASE your_database TO pgvitals_monitor;
GRANT pg_read_all_stats TO pgvitals_monitor;
GRANT USAGE ON SCHEMA public TO pgvitals_monitor;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO pgvitals_monitor;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO pgvitals_monitor;

-- Enable statement tracking
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;`;

  return (
    <div className="landing-root">
      <div className="landing-glow-blob landing-glow-1" />
      <div className="landing-glow-blob landing-glow-2" />

      <PublicNav />

      <main className="landing-container" style={{ padding: "120px 24px 80px", maxWidth: 1100 }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <div className="landing-hero-badge" style={{ margin: "0 auto 16px" }}>
            <span>🚀 Quick Start Guide</span>
          </div>
          <h1 style={{ fontSize: "2.8rem", fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 16 }}>
            Up and Running in 3 Minutes
          </h1>
          <p style={{ fontSize: "1.15rem", color: "var(--text-secondary)", maxWidth: 640, margin: "0 auto" }}>
            Connect your PostgreSQL database safely with read-only permissions and start observing live metrics, root blockers, and index recommendations.
          </p>
        </div>

        {/* Navigation Tabs */}
        <div className="landing-tab-bar" style={{ maxWidth: 600, margin: "0 auto 40px" }}>
          <button
            onClick={() => setActiveTab("docker")}
            className={`landing-tab-btn ${activeTab === "docker" ? "active" : ""}`}
          >
            🐳 1. Local Dev Setup
          </button>
          <button
            onClick={() => setActiveTab("sql")}
            className={`landing-tab-btn ${activeTab === "sql" ? "active" : ""}`}
          >
            🐘 2. Monitored DB User
          </button>
          <button
            onClick={() => setActiveTab("clouds")}
            className={`landing-tab-btn ${activeTab === "clouds" ? "active" : ""}`}
          >
            ☁️ 3. Cloud Providers
          </button>
        </div>

        {/* Tab 1: Local Docker Setup */}
        {activeTab === "docker" && (
          <div className="glass-card animate-fade-in" style={{ padding: "32px", borderRadius: 16, marginBottom: 40 }}>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: 16 }}>
              Step 1: Spin up TimescaleDB & Redis
            </h2>
            <p style={{ color: "var(--text-secondary)", marginBottom: 24, lineHeight: 1.6 }}>
              PG Vitals uses <strong>TimescaleDB</strong> for time-series snapshot hypertables and <strong>Redis</strong> for distributed job queues.
            </p>

            <div style={{ position: "relative", marginBottom: 28 }}>
              <pre className="code-block" style={{ margin: 0, padding: 20, borderRadius: 10, overflowX: "auto" }}>
                <code>{`# 1. Clone the repository and install dependencies
git clone https://github.com/your-org/pgvitals.git
cd pgvitals
pnpm install

# 2. Start TimescaleDB and Redis containers
docker compose up -d

# 3. Configure environment variables
cp .env.example .env
cp .env apps/collector/.env
cp .env packages/db/.env

# 4. Run database migrations
pnpm db:migrate

# 5. Start dev server (Collector on :3001, Web on :3000)
pnpm dev`}</code>
              </pre>
              <button
                onClick={() =>
                  copyToClipboard(
                    `git clone https://github.com/your-org/pgvitals.git\ncd pgvitals\npnpm install\ndocker compose up -d\ncp .env.example .env\ncp .env apps/collector/.env\ncp .env packages/db/.env\npnpm db:migrate\npnpm dev`,
                    "docker-setup"
                  )
                }
                className="btn-secondary"
                style={{ position: "absolute", top: 12, right: 12, fontSize: "0.78rem", padding: "4px 10px" }}
              >
                {copiedSection === "docker-setup" ? "✓ Copied" : "Copy Commands"}
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
              <div style={{ padding: 16, borderRadius: 8, background: "var(--surface)", border: "1px solid var(--border)" }}>
                <h4 style={{ fontSize: "0.95rem", fontWeight: 600, marginBottom: 6 }}>Web Dashboard</h4>
                <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                  Open <a href="http://localhost:3000" target="_blank" rel="noreferrer" style={{ color: "var(--brand)" }}>http://localhost:3000</a> in your browser.
                </p>
              </div>
              <div style={{ padding: 16, borderRadius: 8, background: "var(--surface)", border: "1px solid var(--border)" }}>
                <h4 style={{ fontSize: "0.95rem", fontWeight: 600, marginBottom: 6 }}>OpenAPI / Swagger UI</h4>
                <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                  Inspect API endpoints at <a href="http://localhost:3001/documentation" target="_blank" rel="noreferrer" style={{ color: "var(--brand)" }}>http://localhost:3001/documentation</a>.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Monitored DB User */}
        {activeTab === "sql" && (
          <div className="glass-card animate-fade-in" style={{ padding: "32px", borderRadius: 16, marginBottom: 40 }}>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: 16 }}>
              Step 2: Create a Read-Only Monitoring User
            </h2>
            <p style={{ color: "var(--text-secondary)", marginBottom: 24, lineHeight: 1.6 }}>
              Run the setup script on the target PostgreSQL database you want to monitor. PG Vitals never writes to or alters your customer data.
            </p>

            <div style={{ marginBottom: 32 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontWeight: 600, fontSize: "0.9rem", color: "var(--brand)" }}>
                  PostgreSQL 14, 15, 16, 17, 18+ (Recommended)
                </span>
                <button
                  onClick={() => copyToClipboard(sqlModern, "sql-modern")}
                  className="btn-secondary"
                  style={{ fontSize: "0.78rem", padding: "4px 10px" }}
                >
                  {copiedSection === "sql-modern" ? "✓ Copied" : "Copy SQL"}
                </button>
              </div>
              <pre className="code-block" style={{ margin: 0, padding: 20, borderRadius: 10, overflowX: "auto" }}>
                <code>{sqlModern}</code>
              </pre>
            </div>

            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontWeight: 600, fontSize: "0.9rem", color: "var(--text-secondary)" }}>
                  PostgreSQL 10, 11, 12, 13 (Legacy)
                </span>
                <button
                  onClick={() => copyToClipboard(sqlLegacy, "sql-legacy")}
                  className="btn-secondary"
                  style={{ fontSize: "0.78rem", padding: "4px 10px" }}
                >
                  {copiedSection === "sql-legacy" ? "✓ Copied" : "Copy SQL"}
                </button>
              </div>
              <pre className="code-block" style={{ margin: 0, padding: 20, borderRadius: 10, overflowX: "auto" }}>
                <code>{sqlLegacy}</code>
              </pre>
            </div>
          </div>
        )}

        {/* Tab 3: Cloud Providers */}
        {activeTab === "clouds" && (
          <div className="glass-card animate-fade-in" style={{ padding: "32px", borderRadius: 16, marginBottom: 40 }}>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: 16 }}>
              Step 3: Supported Connection String Formats
            </h2>
            <p style={{ color: "var(--text-secondary)", marginBottom: 24, lineHeight: 1.6 }}>
              PG Vitals connects via standard PostgreSQL connection URIs with full TLS/SSL support:
            </p>

            <div style={{ display: "grid", gap: 16 }}>
              {[
                {
                  name: "AWS RDS / Aurora",
                  uri: "postgresql://pgvitals_monitor:pass@mydb.abc123xyz.us-east-1.rds.amazonaws.com:5432/production?sslmode=require",
                  note: "Ensure security groups allow inbound port 5432 from your collector IP.",
                },
                {
                  name: "Supabase",
                  uri: "postgresql://pgvitals_monitor:pass@db.xyz.supabase.co:5432/postgres?sslmode=require",
                  note: "Use direct connection (port 5432) or transaction pooler (port 6543).",
                },
                {
                  name: "Neon Serverless",
                  uri: "postgresql://pgvitals_monitor:pass@ep-cool-project-12345.us-east-2.aws.neon.tech/neondb?sslmode=require",
                  note: "Works seamlessly with Neon connection autoscaling.",
                },
                {
                  name: "Google Cloud SQL",
                  uri: "postgresql://pgvitals_monitor:pass@35.x.x.x:5432/app_db?sslmode=require",
                  note: "Connect directly via public IP with authorized networks or via Cloud SQL Auth Proxy.",
                },
              ].map((provider, i) => (
                <div
                  key={i}
                  style={{
                    padding: 16,
                    borderRadius: 10,
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <strong style={{ fontSize: "0.95rem" }}>{provider.name}</strong>
                    <button
                      onClick={() => copyToClipboard(provider.uri, `cloud-${i}`)}
                      className="btn-secondary"
                      style={{ fontSize: "0.75rem", padding: "3px 8px" }}
                    >
                      {copiedSection === `cloud-${i}` ? "✓ Copied" : "Copy URI"}
                    </button>
                  </div>
                  <code style={{ fontSize: "0.82rem", color: "var(--brand)", wordBreak: "break-all", display: "block", marginBottom: 6 }}>
                    {provider.uri}
                  </code>
                  <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: 0 }}>
                    💡 {provider.note}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CTA Box */}
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
          <h3 style={{ fontSize: "1.6rem", fontWeight: 700, marginBottom: 12 }}>Ready to Register Your Database?</h3>
          <p style={{ color: "var(--text-secondary)", marginBottom: 24, maxWidth: 500, margin: "0 auto 24px" }}>
            Paste your connection string in the dashboard and start seeing live query analytics instantly.
          </p>
          <div style={{ display: "flex", justifyContent: "center", gap: 16, flexWrap: "wrap" }}>
            <Link href="/" className="landing-cta-btn" style={{ padding: "12px 28px", fontSize: "1rem" }}>
              <span>Open Dashboard</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </Link>
            <Link href="/docs" className="btn-secondary" style={{ padding: "12px 24px", fontSize: "1rem" }}>
              Explore Documentation
            </Link>
          </div>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
