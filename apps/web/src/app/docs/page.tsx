"use client";

import React, { useState } from "react";
import Link from "next/link";
import PublicNav from "../components/PublicNav";
import PublicFooter from "../components/PublicFooter";

interface DocSection {
  id: string;
  category: string;
  title: string;
  summary: string;
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
      title: "1. Onboarding & Registration",
      summary: "How to register your PostgreSQL databases safely using read-only permissions.",
      content: (
        <div>
          <h2>1. Onboarding & Database Registration</h2>
          <p>
            PG Vitals connects to your PostgreSQL database strictly using read-only catalog inspection privileges. It works across any cloud provider (AWS RDS, Aurora, GCP Cloud SQL, Supabase, Neon, Azure) and self-hosted instances.
          </p>

          <h3>1.1 Create the Read-Only Monitoring User</h3>
          <p>Connect to your database as a superuser and run the following setup script:</p>

          <div style={{ position: "relative", marginBottom: 20 }}>
            <pre className="code-block" style={{ padding: 18, borderRadius: 10, overflowX: "auto" }}>
              <code>{`-- Create user with 5-connection limit
CREATE USER pgvitals_monitor WITH PASSWORD 'your_secure_password' CONNECTION LIMIT 5;

-- Grant statistics and catalog permissions (PostgreSQL 14, 15, 16, 17, 18+)
GRANT CONNECT ON DATABASE your_database TO pgvitals_monitor;
GRANT pg_read_all_stats TO pgvitals_monitor;
GRANT pg_read_all_data TO pgvitals_monitor;

-- Enable pg_stat_statements for query performance insights
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- (Optional) Enable HypoPG for hypothetical index simulation
CREATE EXTENSION IF NOT EXISTS hypopg;`}</code>
            </pre>
            <button
              onClick={() =>
                copyCode(
                  `CREATE USER pgvitals_monitor WITH PASSWORD 'your_secure_password' CONNECTION LIMIT 5;\nGRANT CONNECT ON DATABASE your_database TO pgvitals_monitor;\nGRANT pg_read_all_stats TO pgvitals_monitor;\nGRANT pg_read_all_data TO pgvitals_monitor;\nCREATE EXTENSION IF NOT EXISTS pg_stat_statements;\nCREATE EXTENSION IF NOT EXISTS hypopg;`,
                  "sql-modern-user"
                )
              }
              className="btn-secondary"
              style={{ position: "absolute", top: 12, right: 12, fontSize: "0.75rem", padding: "4px 8px" }}
            >
              {copiedId === "sql-modern-user" ? "✓ Copied" : "Copy SQL"}
            </button>
          </div>

          <h3>1.2 Adding the Database in the Dashboard</h3>
          <ol style={{ paddingLeft: 20, lineHeight: 1.8 }}>
            <li>Navigate to <strong>Databases → Add Database</strong> or use the Onboarding Wizard (<code>/onboarding</code>).</li>
            <li>Enter a descriptive name (e.g., <code>Production Primary</code>) and select the environment tag (<code>production</code>, <code>staging</code>, <code>development</code>).</li>
            <li>Paste your standard connection string: <code>postgresql://pgvitals_monitor:password@host:5432/database?sslmode=require</code>.</li>
            <li>Click <strong>Test Connection</strong> to verify network reachability, latency, and extension compatibility.</li>
            <li>Click <strong>Save & Start Monitoring</strong>. Live metrics begin streaming immediately.</li>
          </ol>
        </div>
      ),
    },
    {
      id: "live-sessions",
      category: "Features",
      title: "2. Live Sessions & Lock Trees",
      summary: "Real-time connection gauges, state distributions, root blocker PID detection, and session replay.",
      content: (
        <div>
          <h2>2. Live Connection & Session Explorer</h2>
          <p>
            Located at <code>/databases/[id]</code>. This dashboard streams live PostgreSQL session activity pushed via Server-Sent Events (SSE) with zero browser polling overhead.
          </p>

          <h3>2.1 Radial Connection Gauge & State Breakdown</h3>
          <ul>
            <li><strong>Radial Gauge</strong>: Live active connections vs. <code>max_connections</code> ceiling, with warning thresholds at $\ge 80\%$ (amber) and $\ge 90\%$ (critical red).</li>
            <li><strong>Composition Bar</strong>: Proportional color-coded distribution of <strong>Active</strong> (green), <strong>Idle in Transaction</strong> (amber), and <strong>Idle</strong> (purple) sessions.</li>
            <li><strong>Headroom Counter</strong>: Displays remaining available connection slots before pool exhaustion.</li>
          </ul>

          <h3>2.2 Root Blocker Identification & Lock Trees</h3>
          <p>
            When queries wait on exclusive table or row locks, PG Vitals isolates the <strong>Root Blocker session ID (PID)</strong> causing the cascading lock queue. The UI displays the culprit query, elapsed duration, and a 1-click termination command:
          </p>
          <pre className="code-block" style={{ padding: 14, borderRadius: 8 }}>
            <code>SELECT pg_terminate_backend(blocking_pid);</code>
          </pre>

          <h3>2.3 Time-Travel Session Replay</h3>
          <p>
            Click any point on the connection time-series chart to enter <strong>Replay Mode</strong>. Use <strong>◀ Step Backward</strong> and <strong>▶ Step Forward</strong> to scrub through historical incident snapshots frame-by-frame.
          </p>
        </div>
      ),
    },
    {
      id: "query-performance",
      category: "Features",
      title: "3. Query Performance & P95/P99",
      summary: "Statement-aware optimization advice, covering indexes, and tail latency variance analysis.",
      content: (
        <div>
          <h2>3. Query Performance & Optimization Engine</h2>
          <p>
            Located at <code>/databases/[id]/queries</code>. Combines <code>pg_stat_statements</code> delta metrics with heuristic analysis to provide statement-level advice.
          </p>

          <h3>3.1 Statement-Aware Recommendations</h3>
          <div style={{ overflowX: "auto", margin: "16px 0" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                  <th style={{ padding: "8px 12px" }}>Statement</th>
                  <th style={{ padding: "8px 12px" }}>Diagnostic Trigger</th>
                  <th style={{ padding: "8px 12px" }}>Actionable Advice</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "8px 12px" }}><strong>INSERT</strong></td>
                  <td style={{ padding: "8px 12px" }}>&gt; 500 calls, &lt; 15ms avg</td>
                  <td style={{ padding: "8px 12px" }}>Batch into multi-row <code>VALUES (...), (...)</code> or PostgreSQL <code>COPY</code> to reduce WAL roundtrips.</td>
                </tr>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "8px 12px" }}><strong>SELECT</strong></td>
                  <td style={{ padding: "8px 12px" }}>Point lookup with sequential scan</td>
                  <td style={{ padding: "8px 12px" }}>Auto-generates non-blocking covering index DDL with <code>INCLUDE (...)</code> clause.</td>
                </tr>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "8px 12px" }}><strong>Any Query</strong></td>
                  <td style={{ padding: "8px 12px" }}><code>temp_blks_written &gt; 0</code></td>
                  <td style={{ padding: "8px 12px" }}>Disk spill during sorting/hashing — recommends increasing <code>work_mem</code>.</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h3>3.2 Tail Latencies (P95/P99) & Storage I/O Stalls</h3>
          <p>
            PG Vitals models continuous log-normal query distributions to compute directional P50, P95, and P99 latencies. When <code>track_io_timing = on</code>, queries spending $\ge 45\%$ of execution time waiting on storage disk reads/writes are flagged with disk I/O stall warnings.
          </p>
        </div>
      ),
    },
    {
      id: "index-advisor",
      category: "Features",
      title: "4. Index Advisor & HypoPG",
      summary: "Detect unused, invalid, redundant, and bloated indexes, with zero-risk HypoPG simulation.",
      content: (
        <div>
          <h2>4. Index Advisor & HypoPG Simulation</h2>
          <p>
            Located at <code>/databases/[id]/indexes</code>. Continuously analyzes table scan ratios and B-Tree index catalogs.
          </p>

          <h3>4.1 Five Specialized Index Filters</h3>
          <ul>
            <li><strong>Missing Indexes</strong>: Tables suffering frequent sequential scans on high-cardinality columns.</li>
            <li><strong>Unused Indexes</strong>: Indexes consuming disk space and slowing write operations with zero read scans.</li>
            <li><strong>Invalid Indexes (<code>indisvalid = false</code>)</strong>: Failed or interrupted concurrent index builds wasting maintenance overhead.</li>
            <li><strong>Redundant Indexes</strong>: Indexes whose indexed columns form a strict leading prefix of an existing composite index.</li>
            <li><strong>Bloated Indexes</strong>: B-Trees exceeding 30% page bloat and &gt; 10MB wasted storage.</li>
          </ul>

          <h3>4.2 Zero-Risk HypoPG Simulation</h3>
          <p>
            Test whether a suggested index will actually speed up your queries without building it on disk. Click <strong>"Test in HypoPG"</strong> to evaluate the planner cost reduction in milliseconds.
          </p>

          <h3>4.3 Zero-Downtime DDL</h3>
          <p>
            Every generated script automatically uses <code>CONCURRENTLY</code> modifiers to ensure table locks are never held during production hours:
          </p>
          <pre className="code-block" style={{ padding: 14, borderRadius: 8 }}>
            <code>CREATE INDEX CONCURRENTLY idx_users_org_id ON "users" (org_id);</code>
          </pre>
        </div>
      ),
    },
    {
      id: "plan-regression",
      category: "Features",
      title: "5. EXPLAIN Plan Visualizer",
      summary: "Side-by-side plan diffs, cost surge detection, and dropped index regression alerts.",
      content: (
        <div>
          <h2>5. EXPLAIN Plan Visualizer & Regression Engine</h2>
          <p>
            Located at <code>/databases/[id]/plans</code>. Automatically tracks changes in query execution plans over time.
          </p>

          <h3>5.1 Plan Regression Triggers</h3>
          <ul>
            <li><strong>Cost Surges</strong>: Planner estimated cost increases by $\ge 30\%$ (Warning) or $\ge 100\%$ (Critical).</li>
            <li><strong>Access Path Degradation</strong>: Optimal Index Scan degrades into a full table Sequential Scan.</li>
            <li><strong>Join Degradation</strong>: Hash Join degrades into an unindexed Nested Loop.</li>
            <li><strong>Stale Statistics</strong>: Recommends immediate table <code>ANALYZE</code> remediation.</li>
          </ul>

          <h3>5.2 Side-by-Side Diff Visualizer</h3>
          <p>
            Compare your baseline execution plan against the regressed plan in two synchronized columns, with highlighted node changes, row estimate deltas, and visual tree maps.
          </p>
        </div>
      ),
    },
    {
      id: "vacuum-health",
      category: "Features",
      title: "6. VACUUM Health & Storage",
      summary: "Table bloat tracking, XID wraparound headroom, HOT update tuning, and worker starvation.",
      content: (
        <div>
          <h2>6. VACUUM Health, Bloat & Storage Sentinel</h2>
          <p>
            Located at <code>/databases/[id]/health</code>. Prevents catastrophic transaction ID wraparound shutdowns and dead tuple bloat.
          </p>

          <h3>Key Guardrails:</h3>
          <ul>
            <li><strong>Dead Tuple Ratio</strong>: Flags tables accumulating &gt; 10% dead tuples with 1-click copyable <code>VACUUM (VERBOSE, ANALYZE)</code> commands.</li>
            <li><strong>Transaction ID (XID) Wraparound</strong>: Warns when remaining transactions before forced engine shutdown drop below 200,000,000 XIDs.</li>
            <li><strong>HOT (Heap-Only Tuple) Update Efficiency</strong>: Recommends storage <code>fillfactor = 85</code> adjustments for write-heavy tables with &lt;60% HOT ratio.</li>
            <li><strong>Autovacuum Starvation Sentinel</strong>: Detects when long-running maintenance jobs saturate all <code>autovacuum_max_workers</code> slots.</li>
            <li><strong>Checkpoint fsync Telemetry</strong>: Flags disk I/O stalls when checkpoint sync time exceeds 30 seconds.</li>
          </ul>
        </div>
      ),
    },
    {
      id: "alerts-chatops",
      category: "Integrations",
      title: "7. Alerts & Slack ChatOps",
      summary: "Multi-channel alerting across Slack, PagerDuty, Teams, Email, and in-channel ⚡ Terminate Blocker actions.",
      content: (
        <div>
          <h2>7. Multi-Channel Alerting & Slack ChatOps</h2>
          <p>
            Located at <code>/databases/[id]/alerts</code>. Configure real-time incident routing to your team's communication channels.
          </p>

          <h3>Supported Channels:</h3>
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
      id: "hints-audit",
      category: "Features",
      title: "8. Root Cause Hints & Audit Logs",
      summary: "Continuous heuristic incident rules, session inspector drawer, and CSV/JSON post-mortem export.",
      content: (
        <div>
          <h2>8. Root Cause Hints & Incident Audit Logs</h2>
          <p>
            Located at <code>/databases/[id]/hints</code>. Evaluates 7 heuristic diagnostic rules on every polling snapshot:
          </p>

          <ol style={{ paddingLeft: 20, lineHeight: 1.8 }}>
            <li><code>idle_in_transaction_long</code>: Sessions holding open idle transactions &gt; 300s.</li>
            <li><code>connection_hog</code>: Single application consuming &gt; 70% of total connections.</li>
            <li><code>blocking_chain_long</code>: Queries blocked on locks &gt; 30s with root blocker PID identified.</li>
            <li><code>connection_exhaustion</code>: Total connections exceeding 80% of <code>max_connections</code>.</li>
            <li><code>connection_spike</code>: Rapid connection surge (&gt; 50% increase between cycles).</li>
            <li><code>micro_query_lock_storm</code>: Concurrency storm on hot table rows.</li>
            <li><code>lock_queue_storm</code>: Cascading queue of $\ge 2$ transactions queued behind a blocker.</li>
          </ol>

          <h3>Post-Mortem Export</h3>
          <p>
            Filter incidents across <code>1h</code>, <code>24h</code>, <code>7d</code>, <code>30d</code>, or <code>All Time</code>, and export filtered logs to <strong>CSV</strong> or <strong>JSON</strong> for engineering incident retrospectives.
          </p>
        </div>
      ),
    },
    {
      id: "team-billing",
      category: "Settings",
      title: "9. Teams, Roles & Billing",
      summary: "Managing organizations, team member roles (Owner, Admin, Member), and upgrading plan tiers.",
      content: (
        <div>
          <h2>9. Team Management, Roles & Billing</h2>
          <p>
            Manage your organization settings, invite colleagues, and customize subscription plans.
          </p>

          <h3>9.1 User Roles</h3>
          <ul>
            <li><strong>Owner</strong>: Full administrative privileges, billing management, database registration, and session termination.</li>
            <li><strong>Admin</strong>: Can register databases, configure alert rules, and execute session terminations.</li>
            <li><strong>Member</strong>: Read-only access to vitals, query stats, index suggestions, and logs.</li>
          </ul>

          <h3>9.2 Subscription Plan Tiers</h3>
          <ul>
            <li><strong>Free ($0)</strong>: 1 Monitored Database, 1 User Seat, 24-hour telemetry retention.</li>
            <li><strong>Pro ($39/mo or $31/mo annual)</strong>: Up to 5 Databases, 3 Seats, 30-day retention, Index & Bloat Advisors, Slack/Email Alerts.</li>
            <li><strong>Team ($149/mo or $119/mo annual)</strong>: Up to 20 Databases, Unlimited Seats, 90-day retention, Multi-environment grouping, Log Insights, Priority SLA.</li>
          </ul>
        </div>
      ),
    },
  ];

  const filteredSections = sections.filter(
    (s) =>
      !searchQuery ||
      s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.summary.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const currentSection = sections.find((s) => s.id === activeSection) || sections[0];

  return (
    <div className="landing-root">
      <div className="landing-glow-blob landing-glow-1" />
      <div className="landing-glow-blob landing-glow-2" />

      <PublicNav />

      <main className="landing-container" style={{ padding: "110px 24px 80px", maxWidth: 1240 }}>
        {/* Header */}
        <div style={{ marginBottom: 36 }}>
          <div className="landing-hero-badge" style={{ marginBottom: 12 }}>
            <span>📖 PG Vitals SaaS User Guide</span>
          </div>
          <h1 style={{ fontSize: "2.6rem", fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 8 }}>
            Documentation & Feature Guide
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "1.1rem" }}>
            Learn how to navigate, interpret, and resolve PostgreSQL performance bottlenecks using PG Vitals.
          </p>
        </div>

        {/* Layout Grid: Sidebar + Article */}
        <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 36, alignItems: "start" }}>
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
                placeholder="Search topics & features..."
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

          {/* Right Main Article */}
          <article
            className="glass-card animate-fade-in"
            style={{
              padding: "36px 44px",
              borderRadius: 16,
              minHeight: 520,
              lineHeight: 1.7,
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
