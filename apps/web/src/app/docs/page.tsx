"use client";

import React, { useState } from "react";
import Link from "next/link";
import PublicNav from "../components/PublicNav";
import PublicFooter from "../components/PublicFooter";

interface DocSection {
  id: string;
  category: "Getting Started" | "Core Observability" | "Integrations & Settings";
  title: string;
  badge?: string;
  content: React.ReactNode;
}

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState("onboarding");
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyCode = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const sections: DocSection[] = [
    {
      id: "onboarding",
      category: "Getting Started",
      title: "Onboarding & Registration",
      badge: "Start Here",
      content: (
        <div>
          <h2>🚀 Onboarding & Database Registration</h2>
          <p>
            PG Vitals is completely <strong>agentless</strong>. It monitors your PostgreSQL databases non-intrusively using standard read-only statistics catalog views. It supports AWS RDS, Aurora, Google Cloud SQL, Supabase, Neon, Azure Database for PostgreSQL, and self-hosted instances.
          </p>

          <h3>1. Create the Read-Only Monitoring Role</h3>
          <p>Connect to your PostgreSQL database with administrative privileges and execute the setup script:</p>

          <div className="docs-code-card">
            <div className="docs-code-header">
              <div className="docs-code-dots">
                <span /><span /><span />
              </div>
              <span>SQL · PostgreSQL 14, 15, 16, 17, 18+</span>
              <button
                onClick={() =>
                  copyCode(
                    `-- Create monitoring user with 5-connection limit\nCREATE USER pgvitals_monitor WITH PASSWORD 'choose_a_strong_password' CONNECTION LIMIT 5;\n\n-- Grant catalog inspection privileges\nGRANT CONNECT ON DATABASE your_database TO pgvitals_monitor;\nGRANT pg_read_all_stats TO pgvitals_monitor;\nGRANT pg_read_all_data TO pgvitals_monitor;\n\n-- Enable query performance tracking\nCREATE EXTENSION IF NOT EXISTS pg_stat_statements;\n\n-- (Optional) Enable zero-risk hypothetical index simulation\nCREATE EXTENSION IF NOT EXISTS hypopg;`,
                    "sql-onboarding"
                  )
                }
                className="docs-copy-btn"
              >
                {copiedId === "sql-onboarding" ? "✓ Copied" : "Copy SQL"}
              </button>
            </div>
            <pre className="docs-code-content">
              <code>{`-- 1. Create a dedicated monitoring user with connection ceiling
CREATE USER pgvitals_monitor WITH PASSWORD 'choose_a_strong_password' CONNECTION LIMIT 5;

-- 2. Grant statistics and catalog read permissions
GRANT CONNECT ON DATABASE your_database TO pgvitals_monitor;
GRANT pg_read_all_stats TO pgvitals_monitor;
GRANT pg_read_all_data TO pgvitals_monitor;

-- 3. Enable statement-level query tracking (strongly recommended)
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- 4. (Optional) Enable zero-risk hypothetical index simulation
CREATE EXTENSION IF NOT EXISTS hypopg;`}</code>
            </pre>
          </div>

          <div className="docs-callout docs-callout-info">
            <div className="docs-callout-icon">💡</div>
            <div>
              <strong>For PostgreSQL 10–13 Legacy:</strong> Grant <code>GRANT USAGE ON SCHEMA public TO pgvitals_monitor;</code> and <code>GRANT SELECT ON ALL TABLES IN SCHEMA public TO pgvitals_monitor;</code> instead of <code>pg_read_all_data</code>.
            </div>
          </div>

          <h3>2. Add Database in Dashboard</h3>
          <ol>
            <li>Navigate to <strong>Databases → Add Database</strong> in your dashboard.</li>
            <li>Give your database a recognizable name (e.g. <code>Production US-East</code>) and assign an environment tag (<code>production</code>, <code>staging</code>, <code>development</code>).</li>
            <li>Paste your standard PostgreSQL connection URI:
              <div style={{ marginTop: 8, marginBottom: 8 }}>
                <code>postgresql://pgvitals_monitor:password@db.example.com:5432/your_db?sslmode=require</code>
              </div>
            </li>
            <li>Click <strong>Test Connection</strong> to verify network connectivity, latency, and extension availability.</li>
            <li>Click <strong>Save & Start Monitoring</strong>. Live metrics begin streaming immediately.</li>
          </ol>
        </div>
      ),
    },
    {
      id: "live-sessions",
      category: "Core Observability",
      title: "Live Sessions & Lock Trees",
      content: (
        <div>
          <h2>🔴 Live Connection & Session Explorer</h2>
          <p>
            Located at <code>/databases/[id]</code>. This dashboard streams live PostgreSQL session activity pushed via Server-Sent Events (SSE) with zero browser polling overhead.
          </p>

          <h3>Radial Connection Gauge & State Breakdown</h3>
          <ul>
            <li><strong>Radial Gauge</strong>: Live active connections vs. <code>max_connections</code> ceiling, with warning thresholds at <strong>≥ 80%</strong> (amber) and <strong>≥ 90%</strong> (critical red).</li>
            <li><strong>Composition Bar</strong>: Proportional color-coded distribution of <strong>Active</strong> (green), <strong>Idle in Transaction</strong> (amber), and <strong>Idle</strong> (purple) sessions.</li>
            <li><strong>Headroom Counter</strong>: Displays remaining available connection slots before pool exhaustion.</li>
          </ul>

          <h3>Root Blocker Identification & Lock Trees</h3>
          <p>
            When queries wait on exclusive table or row locks, PG Vitals isolates the <strong>Root Blocker session ID (PID)</strong> causing the cascading lock queue. The UI displays the culprit query, elapsed duration, and a 1-click copyable termination command:
          </p>

          <div className="docs-code-card">
            <div className="docs-code-header">
              <div className="docs-code-dots"><span /><span /><span /></div>
              <span>SQL · Blocker Session Cancellation</span>
              <button
                onClick={() => copyCode(`SELECT pg_terminate_backend(blocking_pid);`, "sql-term-session")}
                className="docs-copy-btn"
              >
                {copiedId === "sql-term-session" ? "✓ Copied" : "Copy SQL"}
              </button>
            </div>
            <pre className="docs-code-content">
              <code>SELECT pg_terminate_backend(blocking_pid);</code>
            </pre>
          </div>

          <h3>Time-Travel Session Replay</h3>
          <p>
            Click any point on the connection time-series chart to enter <strong>Replay Mode</strong>. Use <strong>◀ Step Backward</strong> and <strong>▶ Step Forward</strong> to scrub through historical incident snapshots frame-by-frame during post-mortem investigations.
          </p>
        </div>
      ),
    },
    {
      id: "query-performance",
      category: "Core Observability",
      title: "Query Performance & P95/P99",
      content: (
        <div>
          <h2>⚡ Query Performance & Tail Latency Engine</h2>
          <p>
            Located at <code>/databases/[id]/queries</code>. Combines <code>pg_stat_statements</code> delta metrics with heuristic analysis to deliver statement-specific recommendations.
          </p>

          <h3>Statement-Aware Recommendations</h3>
          <div className="docs-table-wrap">
            <table className="docs-table">
              <thead>
                <tr>
                  <th>Statement</th>
                  <th>Diagnostic Trigger</th>
                  <th>Actionable Advice</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>INSERT</strong></td>
                  <td>&gt; 500 calls, &lt; 15ms avg</td>
                  <td>Batch into multi-row <code>VALUES (...), (...)</code> or PostgreSQL <code>COPY</code> to reduce WAL roundtrips.</td>
                </tr>
                <tr>
                  <td><strong>UPDATE</strong></td>
                  <td>&gt; 500 calls, &lt; 15ms avg</td>
                  <td>Batch updates with <code>UPDATE ... FROM (VALUES (...))</code> or <code>WHERE id = ANY(...)</code>.</td>
                </tr>
                <tr>
                  <td><strong>SELECT</strong></td>
                  <td>Point lookup with sequential scan</td>
                  <td>Auto-generates non-blocking covering index DDL with <code>INCLUDE (...)</code> clause.</td>
                </tr>
                <tr>
                  <td><strong>Any Query</strong></td>
                  <td><code>temp_blks_written &gt; 0</code></td>
                  <td>Disk spill during sorting/hashing — advises increasing <code>work_mem</code>.</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h3>Tail Latencies (P95/P99) & Storage I/O Stalls</h3>
          <p>
            PG Vitals models continuous log-normal query distributions to compute directional P50, P95, and P99 latencies. When <code>track_io_timing = on</code>, queries spending <strong>≥ 45%</strong> of execution time waiting on storage disk reads/writes are flagged with disk I/O stall warnings.
          </p>
        </div>
      ),
    },
    {
      id: "index-advisor",
      category: "Core Observability",
      title: "Index Advisor & HypoPG",
      content: (
        <div>
          <h2>💡 Index Advisor & HypoPG Simulation</h2>
          <p>
            Located at <code>/databases/[id]/indexes</code>. Continuously evaluates table scan ratios, unused index overhead, and B-Tree bloat.
          </p>

          <h3>Five Specialized Index Filters</h3>
          <ul>
            <li><strong>Missing Indexes</strong>: Tables suffering frequent sequential scans on high-cardinality columns.</li>
            <li><strong>Unused Indexes</strong>: Indexes consuming disk space and slowing write operations with zero read scans.</li>
            <li><strong>Invalid Indexes (<code>indisvalid = false</code>)</strong>: Failed or interrupted concurrent index builds wasting maintenance overhead.</li>
            <li><strong>Redundant Indexes</strong>: Indexes whose indexed columns form a strict leading prefix of an existing composite index.</li>
            <li><strong>Bloated Indexes</strong>: B-Trees exceeding 30% page bloat and &gt; 10MB wasted storage.</li>
          </ul>

          <h3>HypoPG Simulation (Zero Risk)</h3>
          <p>
            Test whether a suggested index will actually speed up your queries without building it on disk. Click <strong>"Test in HypoPG"</strong> to evaluate the planner cost reduction in milliseconds before creating physical indexes.
          </p>

          <h3>Zero-Downtime DDL</h3>
          <p>
            Every generated script automatically uses <code>CONCURRENTLY</code> modifiers to ensure exclusive table locks are never held:
          </p>

          <div className="docs-code-card">
            <div className="docs-code-header">
              <div className="docs-code-dots"><span /><span /><span /></div>
              <span>SQL · Non-Blocking Index Creation</span>
              <button
                onClick={() => copyCode(`CREATE INDEX CONCURRENTLY idx_users_org_id ON "users" (org_id);`, "sql-create-idx")}
                className="docs-copy-btn"
              >
                {copiedId === "sql-create-idx" ? "✓ Copied" : "Copy SQL"}
              </button>
            </div>
            <pre className="docs-code-content">
              <code>CREATE INDEX CONCURRENTLY idx_users_org_id ON "users" (org_id);</code>
            </pre>
          </div>
        </div>
      ),
    },
    {
      id: "plan-regression",
      category: "Core Observability",
      title: "EXPLAIN Plan Visualizer",
      content: (
        <div>
          <h2>🔍 EXPLAIN Plan Visualizer & Regression Engine</h2>
          <p>
            Located at <code>/databases/[id]/plans</code>. Automatically tracks changes in query execution plans over time.
          </p>

          <h3>Plan Regression Triggers</h3>
          <ul>
            <li><strong>Cost Surges</strong>: Planner estimated cost increases by <strong>≥ 30%</strong> (Warning) or <strong>≥ 100%</strong> (Critical).</li>
            <li><strong>Access Path Degradation</strong>: Optimal Index Scan degrades into a full table Sequential Scan.</li>
            <li><strong>Join Degradation</strong>: Hash Join degrades into an unindexed Nested Loop.</li>
            <li><strong>Stale Statistics</strong>: Recommends immediate table <code>ANALYZE</code> remediation.</li>
          </ul>

          <h3>Side-by-Side Diff Visualizer</h3>
          <p>
            Compare your baseline execution plan against the regressed plan in two synchronized columns, with highlighted node changes, row estimate deltas, and visual tree maps.
          </p>
        </div>
      ),
    },
    {
      id: "vacuum-health",
      category: "Core Observability",
      title: "VACUUM Health & Storage",
      content: (
        <div>
          <h2>🧹 VACUUM Health, Bloat & Storage Sentinel</h2>
          <p>
            Located at <code>/databases/[id]/health</code>. Prevents catastrophic transaction ID wraparound shutdowns and dead tuple bloat.
          </p>

          <h3>Key Guardrails</h3>
          <ul>
            <li><strong>Dead Tuple Ratio</strong>: Flags tables accumulating &gt; 10% dead tuples with 1-click copyable <code>VACUUM (VERBOSE, ANALYZE)</code> commands.</li>
            <li><strong>Transaction ID (XID) Wraparound</strong>: Warns when remaining transactions before forced engine shutdown drop below 200,000,000 XIDs.</li>
            <li><strong>HOT (Heap-Only Tuple) Update Efficiency</strong>: Recommends storage <code>fillfactor = 85</code> adjustments for write-heavy tables with &lt; 60% HOT ratio.</li>
            <li><strong>Autovacuum Starvation Sentinel</strong>: Detects when long-running maintenance jobs saturate all <code>autovacuum_max_workers</code> slots.</li>
            <li><strong>Checkpoint fsync Telemetry</strong>: Flags disk I/O stalls when checkpoint sync time exceeds 30 seconds.</li>
          </ul>
        </div>
      ),
    },
    {
      id: "hints-audit",
      category: "Core Observability",
      title: "Root Cause Hints & Logs",
      content: (
        <div>
          <h2>🎯 Root Cause Hints & Incident Audit Logs</h2>
          <p>
            Located at <code>/databases/[id]/hints</code>. Evaluates 7 heuristic diagnostic rules on every polling snapshot:
          </p>

          <ol>
            <li><code>idle_in_transaction_long</code>: Sessions holding open idle transactions &gt; 300s.</li>
            <li><code>connection_hog</code>: Single application consuming &gt; 70% of total connections.</li>
            <li><code>blocking_chain_long</code>: Queries blocked on locks &gt; 30s with root blocker PID identified.</li>
            <li><code>connection_exhaustion</code>: Total connections exceeding 80% of <code>max_connections</code>.</li>
            <li><code>connection_spike</code>: Rapid connection surge (&gt; 50% increase between cycles).</li>
            <li><code>micro_query_lock_storm</code>: Concurrency storm on hot table rows.</li>
            <li><code>lock_queue_storm</code>: Cascading queue of ≥ 2 transactions queued behind a blocker.</li>
          </ol>

          <h3>Post-Mortem Export</h3>
          <p>
            Filter incidents across <code>1h</code>, <code>24h</code>, <code>7d</code>, <code>30d</code>, or <code>All Time</code>, and export filtered logs to <strong>CSV</strong> or <strong>JSON</strong> for engineering incident retrospectives.
          </p>
        </div>
      ),
    },
    {
      id: "alerts-chatops",
      category: "Integrations & Settings",
      title: "Alerts & Slack ChatOps",
      content: (
        <div>
          <h2>📡 Multi-Channel Alerting & Slack ChatOps</h2>
          <p>
            Located at <code>/databases/[id]/alerts</code>. Configure real-time incident routing to your team's communication channels.
          </p>

          <h3>Supported Channels</h3>
          <ul>
            <li><strong>Slack Webhooks</strong>: Rich Block Kit cards with query snippets, root blocker PIDs, and interactive <strong>⚡ Terminate Blocker</strong> buttons.</li>
            <li><strong>PagerDuty</strong>: Events API v2 on-call paging with automatic deduplication.</li>
            <li><strong>Microsoft Teams</strong>: Adaptive Card incident alerts.</li>
            <li><strong>Email (SMTP)</strong>: HTML incident reports with diagnostic root cause summaries.</li>
            <li><strong>Custom Webhooks</strong>: JSON POST payloads with HMAC-SHA256 signature validation.</li>
          </ul>

          <h3>Slack ChatOps Remote Remediation</h3>
          <p>
            When a lock storm or runaway blocker is detected, authorized team members can click <strong>⚡ Terminate Blocker</strong> directly inside Slack to abort the blocking query and resolve production downtime.
          </p>
        </div>
      ),
    },
    {
      id: "team-billing",
      category: "Integrations & Settings",
      title: "Teams, Roles & Billing",
      content: (
        <div>
          <h2>🏢 Team Management, Roles & Billing</h2>
          <p>
            Manage your organization settings, invite colleagues, and customize subscription plans.
          </p>

          <h3>User Roles</h3>
          <ul>
            <li><strong>Owner</strong>: Full administrative privileges, billing management, database registration, and session termination.</li>
            <li><strong>Admin</strong>: Can register databases, configure alert rules, and execute session terminations.</li>
            <li><strong>Member</strong>: Read-only access to vitals, query stats, index suggestions, and logs.</li>
          </ul>

          <h3>Subscription Plan Tiers</h3>
          <ul>
            <li><strong>Free ($0)</strong>: 1 Monitored Database, 1 User Seat, 24-hour telemetry retention.</li>
            <li><strong>Pro ($39/mo or $31/mo annual)</strong>: Up to 5 Databases, 3 Seats, 30-day retention, Index & Bloat Advisors, Slack/Email Alerts.</li>
            <li><strong>Team ($149/mo or $119/mo annual)</strong>: Up to 20 Databases, Unlimited Seats, 90-day retention, Multi-environment grouping, Log Insights, Priority SLA.</li>
          </ul>
        </div>
      ),
    },
  ];

  const categories = ["Getting Started", "Core Observability", "Integrations & Settings"] as const;

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

      <main className="docs-wrapper">
        {/* Header Hero */}
        <div className="docs-header-hero">
          <div className="landing-hero-badge">
            <span>📖 PG Vitals SaaS User Guide</span>
          </div>
          <h1>Documentation & Feature Guide</h1>
          <p>
            Learn how to navigate, interpret, and resolve PostgreSQL performance bottlenecks with PG Vitals.
          </p>
        </div>

        {/* Layout Grid */}
        <div className="docs-layout-grid">
          {/* Left Sidebar */}
          <aside className="docs-sidebar">
            <div className="docs-search-wrap">
              <span className="docs-search-icon">🔍</span>
              <input
                type="text"
                placeholder="Search topics & features..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="docs-search-input"
              />
            </div>

            {categories.map((cat) => {
              const catSections = filteredSections.filter((s) => s.category === cat);
              if (catSections.length === 0) return null;

              return (
                <div key={cat} className="docs-nav-group">
                  <div className="docs-nav-group-title">{cat}</div>
                  {catSections.map((s) => {
                    const isActive = activeSection === s.id;
                    return (
                      <button
                        key={s.id}
                        onClick={() => setActiveSection(s.id)}
                        className={`docs-nav-item ${isActive ? "active" : ""}`}
                      >
                        <span>{s.title}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}

            <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
              <Link href="/quickstart" style={{ fontSize: "0.84rem", color: "var(--brand)", display: "flex", alignItems: "center", gap: 6, textDecoration: "none", marginBottom: 8 }}>
                <span>🚀</span> Quickstart Guide →
              </Link>
              <Link href="/faq" style={{ fontSize: "0.84rem", color: "var(--brand)", display: "flex", alignItems: "center", gap: 6, textDecoration: "none" }}>
                <span>❓</span> FAQ →
              </Link>
            </div>
          </aside>

          {/* Right Main Article */}
          <article className="docs-article animate-fade-in">
            {currentSection.content}
          </article>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
