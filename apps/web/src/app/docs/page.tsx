"use client";

import React, { useState } from "react";
import Link from "next/link";
import PublicNav from "../components/PublicNav";
import PublicFooter from "../components/PublicFooter";

interface DocSection {
  id: string;
  title: string;
  category: string;
  content: React.ReactNode;
}

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState("getting-started");
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(id);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const sections: DocSection[] = [
    {
      id: "getting-started",
      category: "Getting Started",
      title: "1. Overview & Setup",
      content: (
        <div>
          <h2>1. Overview & Onboarding</h2>
          <p>
            PG Vitals connects to your PostgreSQL databases in <strong>read-only mode</strong> to collect performance metrics, trace lock contention, identify unindexed queries, and detect table bloat with zero downtime.
          </p>

          <h3>Read-Only Monitoring User Setup</h3>
          <p>Execute the following SQL as superuser on your target database:</p>

          <div style={{ position: "relative", marginBottom: 24 }}>
            <pre className="code-block" style={{ padding: 18, borderRadius: 10, overflowX: "auto" }}>
              <code>{`-- 1. Create read-only role with 5-connection limit
CREATE USER pgvitals_monitor WITH PASSWORD 'your_secure_password' CONNECTION LIMIT 5;

-- 2. Grant statistics and data reading permissions (PostgreSQL 14+)
GRANT CONNECT ON DATABASE your_database TO pgvitals_monitor;
GRANT pg_read_all_stats TO pgvitals_monitor;
GRANT pg_read_all_data TO pgvitals_monitor;

-- 3. Enable query performance tracking
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- 4. (Optional) Enable zero-risk hypothetical index simulation
CREATE EXTENSION IF NOT EXISTS hypopg;`}</code>
            </pre>
            <button
              onClick={() =>
                copyText(
                  `CREATE USER pgvitals_monitor WITH PASSWORD 'your_secure_password' CONNECTION LIMIT 5;\nGRANT CONNECT ON DATABASE your_database TO pgvitals_monitor;\nGRANT pg_read_all_stats TO pgvitals_monitor;\nGRANT pg_read_all_data TO pgvitals_monitor;\nCREATE EXTENSION IF NOT EXISTS pg_stat_statements;\nCREATE EXTENSION IF NOT EXISTS hypopg;`,
                  "sql-setup"
                )
              }
              className="btn-secondary"
              style={{ position: "absolute", top: 12, right: 12, fontSize: "0.75rem", padding: "4px 8px" }}
            >
              {copiedCode === "sql-setup" ? "✓ Copied" : "Copy SQL"}
            </button>
          </div>

          <div className="alert-box alert-box-info" style={{ padding: 16, borderRadius: 8, background: "var(--surface)", border: "1px solid var(--border)", marginBottom: 24 }}>
            <strong>💡 Pro-tip:</strong> For PostgreSQL 10–13 legacy versions, grant <code>GRANT USAGE ON SCHEMA public</code> and <code>GRANT SELECT ON ALL TABLES IN SCHEMA public</code>.
          </div>
        </div>
      ),
    },
    {
      id: "live-connections",
      category: "Features",
      title: "2. Live Sessions & Lock Trees",
      content: (
        <div>
          <h2>2. Live Session Monitoring & Root Blocker Detection</h2>
          <p>
            The live session dashboard monitors active connections in real time via Server-Sent Events (SSE) and automatically traces lock trees when transactions block one another.
          </p>

          <h3>Key Metrics:</h3>
          <ul>
            <li><strong>Radial Utilization Gauge</strong>: Live active connections vs. <code>max_connections</code> with &lt;1% sub-threshold indicators.</li>
            <li><strong>State Distribution</strong>: Breakdown of <code>Active</code>, <code>Idle in Transaction</code>, and <code>Idle</code> connections.</li>
            <li><strong>Root Blocker Identification</strong>: Pinpoints the specific PID and query holding row or table locks.</li>
            <li><strong>Time-Travel Session Replay</strong>: Step forward/backward frame-by-frame through historical incident snapshots.</li>
          </ul>

          <h3>Safe Blocker Termination</h3>
          <p>
            When a rogue transaction locks critical tables, authorized team members can terminate the backend session with one click:
          </p>
          <pre className="code-block" style={{ padding: 14, borderRadius: 8 }}>
            <code>SELECT pg_terminate_backend(blocking_pid);</code>
          </pre>
        </div>
      ),
    },
    {
      id: "query-performance",
      category: "Features",
      title: "3. Query Optimization & P95/P99",
      content: (
        <div>
          <h2>3. Query Performance & Tail Latency Engine</h2>
          <p>
            PG Vitals continuously aggregates deltas from <code>pg_stat_statements</code> to identify resource-heavy queries, disk spills, and tail latencies.
          </p>

          <h3>Statement-Aware Recommendations:</h3>
          <div style={{ overflowX: "auto", marginBottom: 24 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                  <th style={{ padding: "8px 12px" }}>Statement</th>
                  <th style={{ padding: "8px 12px" }}>Diagnostic Pattern</th>
                  <th style={{ padding: "8px 12px" }}>Actionable Advice</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "8px 12px" }}><strong>INSERT</strong></td>
                  <td style={{ padding: "8px 12px" }}>&gt; 500 calls, &lt; 15ms avg</td>
                  <td style={{ padding: "8px 12px" }}>Multi-row <code>VALUES (...), (...)</code> batching or <code>COPY</code> to reduce WAL roundtrips.</td>
                </tr>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "8px 12px" }}><strong>SELECT</strong></td>
                  <td style={{ padding: "8px 12px" }}>High mean time, seq scans</td>
                  <td style={{ padding: "8px 12px" }}>Covering index generation with <code>INCLUDE (...)</code> clause.</td>
                </tr>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "8px 12px" }}><strong>Any Query</strong></td>
                  <td style={{ padding: "8px 12px" }}><code>temp_blks_written &gt; 0</code></td>
                  <td style={{ padding: "8px 12px" }}>Increase <code>work_mem</code> to prevent disk spill sorting.</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h3>Tail Latencies (P95/P99) & Storage I/O Stalls</h3>
          <p>
            Queries are modeled with directional log-normal distributions to surface tail latency variance spikes. When <code>track_io_timing = on</code>, PG Vitals isolates disk read/write stalls from CPU execution time.
          </p>
        </div>
      ),
    },
    {
      id: "index-advisor",
      category: "Features",
      title: "4. Index Advisor & HypoPG Simulation",
      content: (
        <div>
          <h2>4. Index Advisor & HypoPG Simulation</h2>
          <p>
            Detect missing, unused, invalid, and bloated indexes, then simulate the planner cost reduction with HypoPG before creating physical indexes.
          </p>

          <h3>Zero-Downtime DDL</h3>
          <p>
            All generated recommendations strictly use <code>CONCURRENTLY</code> to avoid locking tables during business hours:
          </p>
          <pre className="code-block" style={{ padding: 14, borderRadius: 8 }}>
            <code>CREATE INDEX CONCURRENTLY idx_orders_user_id ON "orders" (user_id);</code>
          </pre>

          <h3>HypoPG Simulation</h3>
          <p>
            Test query planner cost improvements against hypothetical in-memory indexes without allocating storage or performing full table scans.
          </p>
        </div>
      ),
    },
    {
      id: "vacuum-health",
      category: "Features",
      title: "5. VACUUM Health & Table Bloat",
      content: (
        <div>
          <h2>5. VACUUM Health & Storage Optimization</h2>
          <p>
            Monitor dead tuple accumulation, estimated table/index bloat, and transaction ID (XID) wraparound safety margins.
          </p>

          <h3>Key Guardrails:</h3>
          <ul>
            <li><strong>Dead Tuple Ratio</strong>: Flags tables where dead tuples exceed 10% of total live rows.</li>
            <li><strong>XID Wraparound Sentinel</strong>: Tracks <code>age(datfrozenxid)</code> with emergency warnings when headroom drops below 200M transactions.</li>
            <li><strong>HOT Update Tuner</strong>: Recommends storage <code>fillfactor = 85</code> adjustments for write-heavy tables with &lt;60% Heap-Only Tuple updates.</li>
            <li><strong>Autovacuum Starvation</strong>: Alerts when all autovacuum worker slots are saturated, starving high-churn relations.</li>
          </ul>
        </div>
      ),
    },
    {
      id: "alerts-chatops",
      category: "Integrations",
      title: "6. Alerts & Slack ChatOps",
      content: (
        <div>
          <h2>6. Multi-Channel Alerting & Slack ChatOps</h2>
          <p>
            Receive incident notifications across Slack, PagerDuty, Microsoft Teams, Email, and custom webhooks with actionable context.
          </p>

          <h3>Slack Remote Remediation:</h3>
          <p>
            When a critical lock storm or long-running transaction is detected, PG Vitals sends an interactive Slack message containing the offending PID, query snippet, and a <strong>⚡ Terminate Blocker</strong> button. Authorized engineers can unblock the database directly from Slack.
          </p>
        </div>
      ),
    },
    {
      id: "api-reference",
      category: "Developer",
      title: "7. REST API & OpenAPI Explorer",
      content: (
        <div>
          <h2>7. Developer API & Swagger UI</h2>
          <p>
            PG Vitals provides a complete REST and Server-Sent Events (SSE) API documented with OpenAPI 3.1.
          </p>

          <h3>Interactive Documentation</h3>
          <p>
            Explore and test API endpoints in real time at <a href="http://localhost:3001/documentation" target="_blank" rel="noreferrer" style={{ color: "var(--brand)" }}>http://localhost:3001/documentation</a>.
          </p>

          <h3>SSE Live Streaming Endpoint:</h3>
          <pre className="code-block" style={{ padding: 14, borderRadius: 8 }}>
            <code>GET /api/databases/:id/live-sessions</code>
          </pre>
          <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
            Pushes active session deltas, lock trees, and connection headroom events to connected clients.
          </p>
        </div>
      ),
    },
  ];

  const filteredSections = sections.filter(
    (s) =>
      !searchQuery ||
      s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const currentSection = sections.find((s) => s.id === activeSection) || sections[0];

  return (
    <div className="landing-root">
      <div className="landing-glow-blob landing-glow-1" />
      <div className="landing-glow-blob landing-glow-2" />

      <PublicNav />

      <main className="landing-container" style={{ padding: "100px 24px 80px", maxWidth: 1200 }}>
        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <div className="landing-hero-badge" style={{ marginBottom: 12 }}>
            <span>📖 Documentation Portal</span>
          </div>
          <h1 style={{ fontSize: "2.4rem", fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 8 }}>
            PG Vitals Documentation
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "1.05rem" }}>
            Comprehensive technical guides, PostgreSQL tuning advice, and developer API references.
          </p>
        </div>

        {/* Layout Grid: Sidebar + Main Content */}
        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 36, alignItems: "start" }}>
          {/* Left Sticky Sidebar */}
          <aside
            className="glass-card"
            style={{
              position: "sticky",
              top: 90,
              padding: "20px 16px",
              borderRadius: 14,
              maxHeight: "calc(100vh - 120px)",
              overflowY: "auto",
            }}
          >
            <div style={{ marginBottom: 16 }}>
              <input
                type="text"
                placeholder="Filter topics..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: 8,
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  color: "var(--text-primary)",
                  fontSize: "0.85rem",
                  outline: "none",
                }}
              />
            </div>

            <nav style={{ display: "grid", gap: 4 }}>
              {filteredSections.map((s) => {
                const isActive = activeSection === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => setActiveSection(s.id)}
                    style={{
                      textAlign: "left",
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: "none",
                      background: isActive ? "rgba(59, 130, 246, 0.15)" : "transparent",
                      color: isActive ? "var(--brand)" : "var(--text-secondary)",
                      fontWeight: isActive ? 600 : 400,
                      fontSize: "0.88rem",
                      cursor: "pointer",
                      transition: "all var(--transition-fast)",
                    }}
                  >
                    {s.title}
                  </button>
                );
              })}
            </nav>

            <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
              <Link href="/quickstart" style={{ fontSize: "0.82rem", color: "var(--brand)", display: "block", marginBottom: 6 }}>
                🚀 Quickstart Guide →
              </Link>
              <Link href="/faq" style={{ fontSize: "0.82rem", color: "var(--brand)", display: "block" }}>
                ❓ FAQ →
              </Link>
            </div>
          </aside>

          {/* Right Main Article Content */}
          <article
            className="glass-card animate-fade-in"
            style={{
              padding: "36px 40px",
              borderRadius: 16,
              minHeight: 500,
            }}
          >
            {currentSection.content}
          </article>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
