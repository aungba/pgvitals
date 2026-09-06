import React from "react";
import CodeCard from "../components/CodeCard";

export interface DocSection {
  id: string;
  category: "Getting Started" | "Core Observability" | "Integrations & Settings";
  title: string;
  badge?: string;
  keywords: string;
  content: React.ReactNode;
}

export const docCategories = [
  "Getting Started",
  "Core Observability",
  "Integrations & Settings",
] as const;

export const docSections: DocSection[] = [
  // =========================================================================
  // 1. Onboarding & Registration
  // =========================================================================
  {
    id: "onboarding",
    category: "Getting Started",
    title: "Onboarding & Registration",
    badge: "Start Here",
    keywords: "onboarding registration setup connect install role permission agentless read-only uri credentials rds aurora cloudsql supabase neon",
    content: (
      <div>
        <h2>🚀 Onboarding & Database Registration</h2>
        <p>
          PG Vitals is completely <strong>agentless</strong>. It monitors your PostgreSQL databases non-intrusively using standard read-only statistics catalog views. It does not install background daemons, binary agents, or proprietary extensions on your database host.
        </p>
        <p>
          Supported platforms include <strong>AWS RDS, AWS Aurora, Google Cloud SQL, Supabase, Neon, Azure Database for PostgreSQL, Tembo, Crunchy Data, and self-hosted instances</strong> (PostgreSQL 10 through 18+).
        </p>

        <div className="docs-callout docs-callout-info">
          <div className="docs-callout-icon">🛡️</div>
          <div>
            <strong>Zero Customer Data Access Guarantee:</strong> The <code>pg_read_all_stats</code> role only grants visibility into PostgreSQL engine catalogs (<code>pg_stat_activity</code>, <code>pg_stat_statements</code>, <code>pg_locks</code>, <code>pg_stat_user_tables</code>). PG Vitals never queries, copies, or stores customer application table data.
          </div>
        </div>

        <h3>Step 1: Create the Read-Only Monitoring Role</h3>
        <p>Connect to your PostgreSQL database with administrative privileges (e.g. via <code>psql</code> or your database GUI) and execute the setup script:</p>

        <CodeCard
          code={`-- 1. Create a dedicated monitoring user with connection ceiling
CREATE USER pgvitals_monitor WITH PASSWORD 'choose_a_strong_password' CONNECTION LIMIT 5;

-- 2. Grant statistics and catalog read permissions (PostgreSQL 14+)
GRANT CONNECT ON DATABASE your_database TO pgvitals_monitor;
GRANT pg_read_all_stats TO pgvitals_monitor;

-- 3. Enable statement-level query tracking (strongly recommended)
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- 4. (Optional) Enable zero-risk hypothetical index simulation
CREATE EXTENSION IF NOT EXISTS hypopg;`}
          language="sql"
          title="SQL · PostgreSQL 14, 15, 16, 17, 18+"
        />

        <details style={{ marginTop: 12, marginBottom: 24 }}>
          <summary style={{ cursor: "pointer", fontSize: "0.88rem", color: "var(--brand)", fontWeight: 600 }}>
            Need the setup script for PostgreSQL 10–13 Legacy?
          </summary>
          <div style={{ marginTop: 10 }}>
            <CodeCard
              code={`-- 1. Create a dedicated monitoring user with connection ceiling
CREATE USER pgvitals_monitor WITH PASSWORD 'choose_a_strong_password' CONNECTION LIMIT 5;

-- 2. Grant permissions for PostgreSQL 10, 11, 12, 13
GRANT CONNECT ON DATABASE your_database TO pgvitals_monitor;
GRANT pg_read_all_stats TO pgvitals_monitor;
GRANT USAGE ON SCHEMA public TO pgvitals_monitor;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO pgvitals_monitor;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO pgvitals_monitor;

-- 3. Enable statement-level query tracking
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;`}
              language="sql"
              title="SQL · PostgreSQL 10, 11, 12, 13"
            />
          </div>
        </details>

        <h3>Step 2: Add Database in the Dashboard</h3>
        <ol>
          <li>Navigate to <strong>Databases → Add Database</strong> (or <code>/databases/new</code>) in your dashboard.</li>
          <li>Enter a recognizable <strong>Database Name</strong> (e.g. <code>Production US-East</code>).</li>
          <li>Select an <strong>Environment Tag</strong> (<code>production</code>, <code>staging</code>, or <code>development</code>).</li>
          <li>
            Paste your standard PostgreSQL connection URI:
            <div style={{ marginTop: 8, marginBottom: 8 }}>
              <CodeCard
                code="postgresql://pgvitals_monitor:your_password@db.example.com:5432/your_database?sslmode=require"
                language="uri"
                title="Connection URI Format"
              />
            </div>
          </li>
          <li>Click <strong>Test Connection</strong>. PG Vitals validates network reachability, TLS handshake, latency, engine version, and available extensions.</li>
          <li>Click <strong>Save & Start Monitoring</strong>. Live metrics begin streaming immediately.</li>
        </ol>

        <h3>Step 3: Network & Firewall Checklist</h3>
        <p>Ensure your cloud firewall or security group permits inbound TCP traffic from PG Vitals collector IPs on port <code>5432</code> (or your custom PostgreSQL port):</p>
        <ul>
          <li><strong>AWS RDS / Aurora</strong>: Add an inbound rule to your VPC Security Group allowing port 5432.</li>
          <li><strong>Google Cloud SQL</strong>: Add PG Vitals IP addresses to <em>Authorized Networks</em> or connect via Cloud SQL Auth Proxy.</li>
          <li><strong>Supabase / Neon</strong>: Ensure <em>Direct Connection</em> or <em>Connection Pooling</em> URI with <code>sslmode=require</code> is used.</li>
        </ul>
      </div>
    ),
  },

  // =========================================================================
  // 2. Live Sessions, Lock Trees & Time-Travel Replay
  // =========================================================================
  {
    id: "live-sessions",
    category: "Core Observability",
    title: "Live Sessions & Lock Trees",
    badge: "Real-Time",
    keywords: "live sessions lock trees blocking replay time travel radial connection gauge active idle in transaction terminate pid blocker",
    content: (
      <div>
        <h2>🔴 Live Sessions, Lock Trees & Time-Travel Replay</h2>
        <p>
          Located at <code>/databases/[id]</code>. This is your primary real-time command center. It streams live PostgreSQL connection activity, session states, and lock contention graphs pushed directly via Server-Sent Events (SSE) with zero browser polling overhead.
        </p>

        <h3>Key Interface Components & Metrics</h3>
        <div className="docs-table-wrap">
          <table className="docs-table">
            <thead>
              <tr>
                <th>Element</th>
                <th>Interpretation & Safe Thresholds</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Radial Connection Gauge</strong></td>
                <td>
                  Visualizes active connections vs. <code>max_connections</code>. Displays <strong>Green</strong> (&lt; 80%), <strong>Amber Warning</strong> (≥ 80%), and <strong>Critical Red</strong> (≥ 90%).
                </td>
              </tr>
              <tr>
                <td><strong>Composition Bar</strong></td>
                <td>
                  Horizontal breakdown of <strong>Active</strong> (green: executing queries), <strong>Idle in Transaction</strong> (amber: holding locks without active query), and <strong>Idle</strong> (purple: waiting for client).
                </td>
              </tr>
              <tr>
                <td><strong>Headroom Counter</strong></td>
                <td>
                  Calculates exact remaining connection slots available before reaching connection saturation or rejection.
                </td>
              </tr>
              <tr>
                <td><strong>Lock Contention Trees</strong></td>
                <td>
                  Hierarchical tree identifying the <strong>Root Blocker session ID (PID)</strong> at the apex and all cascading blocked queries queued beneath it.
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3>Step-by-Step Usage: Diagnosing & Terminating a Lock Storm</h3>
        <ol>
          <li>
            <strong>Inspect Connection Gauge:</strong> If active connections or <em>Idle in Transaction</em> counts spike suddenly, look at the <strong>Active Sessions Table</strong> directly below.
          </li>
          <li>
            <strong>Filter by State:</strong> Click the <strong>"Waiting on Locks"</strong> or <strong>"Idle in Transaction"</strong> filter chip to isolate problematic sessions.
          </li>
          <li>
            <strong>Identify the Root Blocker:</strong> When sessions are blocked, PG Vitals highlights the root blocker session in red at the top of the lock tree, showing the SQL query, elapsed duration, client application, and blocked session count.
          </li>
          <li>
            <strong>Terminate the Culprit:</strong> Click the <strong>⚡ Terminate Blocker</strong> button. A confirmation modal will appear displaying the PID and statement. Confirm termination to execute:
            <div style={{ marginTop: 8, marginBottom: 8 }}>
              <CodeCard
                code="SELECT pg_terminate_backend(blocking_pid);"
                language="sql"
                title="SQL · Blocker Session Termination"
              />
            </div>
            The blocked queue clears instantly, and live streaming metrics reflect the restored throughput.
          </li>
        </ol>

        <h3>Time-Travel Session Replay Mode</h3>
        <p>
          Investigating incidents that occurred while you were away? PG Vitals records high-frequency session snapshots continuously:
        </p>
        <ol>
          <li>Click any point or spike on the <strong>Connection History Time-Series Chart</strong>.</li>
          <li>The dashboard enters <strong>Replay Mode</strong> (indicated by a distinctive amber banner).</li>
          <li>Use <strong>◀ Step Backward</strong> and <strong>▶ Step Forward</strong> to scrub through historical incident snapshots second-by-second.</li>
          <li>Inspect which query was blocking tables, which user initiated it, and how locks cascaded at that exact moment.</li>
          <li>Click <strong>"Exit Replay"</strong> to return to live streaming.</li>
        </ol>
      </div>
    ),
  },

  // =========================================================================
  // 3. Query Performance, P95/P99 & I/O Diagnostics
  // =========================================================================
  {
    id: "query-performance",
    category: "Core Observability",
    title: "Query Performance & P95/P99",
    badge: "Analytics",
    keywords: "queries query performance p95 p99 latency tail latency pg_stat_statements io disk temp blks work_mem slow queries explain covering index",
    content: (
      <div>
        <h2>⚡ Query Performance & Tail Latency Engine</h2>
        <p>
          Located at <code>/databases/[id]/queries</code>. Combines continuous <code>pg_stat_statements</code> delta collection with statistical modeling to reveal slow queries, tail latency spikes, disk I/O bottlenecks, and statement-specific optimization opportunities.
        </p>

        <h3>Key Metrics & What They Mean</h3>
        <ul>
          <li><strong>Calls / sec</strong>: Statement throughput frequency.</li>
          <li><strong>Mean Latency</strong>: Average execution duration across calls.</li>
          <li><strong>P95 / P99 Tail Latencies</strong>: Directional 95th and 99th percentile estimates. Highlights queries that appear fast on average (e.g. 10ms mean) but experience brutal tail spikes (e.g. 1,500ms P99) during traffic bursts.</li>
          <li><strong>Disk I/O Wait %</strong>: Percentage of total execution time spent waiting on disk reads/writes (available when <code>track_io_timing = on</code>).</li>
          <li><strong>Temp Blocks Written</strong>: Queries spilling work to temporary disk files because query memory exceeds <code>work_mem</code>.</li>
        </ul>

        <h3>Step-by-Step Query Optimization Workflow</h3>
        <ol>
          <li>
            <strong>Sort by Impact:</strong> Click the <strong>Total Time %</strong> column header to sort queries by their total cumulative consumption of database CPU and I/O resources.
          </li>
          <li>
            <strong>Check the Heuristic Advice Badge:</strong> PG Vitals automatically classifies query patterns and displays targeted optimization advice:
          </li>
        </ol>

        <div className="docs-table-wrap">
          <table className="docs-table">
            <thead>
              <tr>
                <th>Statement Pattern</th>
                <th>Diagnostic Condition</th>
                <th>Actionable User Workflow</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>High-Volume INSERT</strong></td>
                <td>&gt; 500 calls, &lt; 15ms avg</td>
                <td>Batch individual inserts into multi-row <code>VALUES (...), (...)</code> chunks or use PostgreSQL <code>COPY</code> to reduce WAL and network roundtrips.</td>
              </tr>
              <tr>
                <td><strong>High-Volume UPDATE</strong></td>
                <td>&gt; 500 calls, &lt; 15ms avg</td>
                <td>Batch updates with <code>UPDATE ... FROM (VALUES (...))</code> or <code>WHERE id = ANY(...)</code> instead of single-row loop updates.</td>
              </tr>
              <tr>
                <td><strong>Unindexed SELECT Lookup</strong></td>
                <td>Sequential scan on point query</td>
                <td>Click <strong>"Generate Covering Index"</strong> to produce a non-blocking index with <code>INCLUDE</code> columns.</td>
              </tr>
              <tr>
                <td><strong>Disk Temp Spill</strong></td>
                <td><code>temp_blks_written &gt; 0</code></td>
                <td>Query sort/hash exceeds memory. Increase <code>work_mem</code> for that session or optimize <code>ORDER BY / GROUP BY</code> clauses.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3>Generating Covering Indexes with <code>INCLUDE</code></h3>
        <p>
          For point-lookup queries, PG Vitals extracts the query's filter columns and projection list, generating production-ready non-blocking DDL:
        </p>

        <CodeCard
          code={`-- Non-blocking covering index generated by PG Vitals
CREATE INDEX CONCURRENTLY idx_orders_customer_status
ON "orders" (customer_id)
INCLUDE (status, total_amount, created_at);`}
          language="sql"
          title="SQL · Non-Blocking Covering Index"
        />

        <div className="docs-callout docs-callout-info">
          <div className="docs-callout-icon">💡</div>
          <div>
            <strong>Pro-Tip (Enable I/O Timing):</strong> Enable <code>track_io_timing = on</code> in your <code>postgresql.conf</code> or cloud parameter group. This unlocks granular disk vs. CPU bottleneck classification across all queries.
          </div>
        </div>
      </div>
    ),
  },

  // =========================================================================
  // 4. Index Advisor & HypoPG Simulation
  // =========================================================================
  {
    id: "index-advisor",
    category: "Core Observability",
    title: "Index Advisor & HypoPG",
    badge: "Advisor",
    keywords: "index advisor hypopg simulation missing indexes unused indexes invalid redundant bloat reindex concurrently zero downtime",
    content: (
      <div>
        <h2>💡 Index Advisor & HypoPG Simulation</h2>
        <p>
          Located at <code>/databases/[id]/indexes</code>. Continuously analyzes table access patterns, unused index storage overhead, corrupt indexes, and B-Tree page bloat to keep your database lean and fast.
        </p>

        <h3>The 5 Specialized Index Audit Tabs</h3>
        <ul>
          <li><strong>Missing Indexes</strong>: Identifies tables suffering frequent sequential scans on high-cardinality columns where an index would eliminate full table reads.</li>
          <li><strong>Unused Indexes</strong>: Catalogs indexes consuming disk storage and slowing down <code>INSERT</code>, <code>UPDATE</code>, and <code>DELETE</code> operations with zero read scans (<code>idx_scan = 0</code>).</li>
          <li><strong>Invalid Indexes (<code>indisvalid = false</code>)</strong>: Pinpoints indexes left in an unready or corrupt state by aborted or failed <code>CREATE INDEX CONCURRENTLY</code> commands.</li>
          <li><strong>Redundant Indexes</strong>: Flags duplicate indexes whose leading indexed columns strictly overlap with another composite index on the same table.</li>
          <li><strong>Bloated Indexes</strong>: Detects B-Trees exceeding 30% page bloat and wasting &gt; 10MB of storage.</li>
        </ul>

        <h3>Step-by-Step Usage: Testing Suggestions with HypoPG (Zero Risk)</h3>
        <p>
          Never guess whether an index will improve query performance. PG Vitals integrates with the PostgreSQL <code>hypopg</code> extension to simulate index creation in memory without creating physical files on disk:
        </p>
        <ol>
          <li>Navigate to the <strong>Missing Indexes</strong> tab.</li>
          <li>Find a recommended index for your slow table and click <strong>"Test in HypoPG"</strong>.</li>
          <li>PG Vitals launches a virtual simulation: the PostgreSQL planner calculates the estimated query execution cost <em>with</em> and <em>without</em> the index.</li>
          <li>Review the cost delta: if cost drops significantly (e.g. from <code>45,210</code> to <code>12.4</code>), you know with mathematical certainty that the index will be utilized by the planner.</li>
        </ol>

        <h3>Applying Safe Zero-Downtime DDL</h3>
        <p>
          Every script generated by PG Vitals automatically includes the <code>CONCURRENTLY</code> modifier to guarantee that table locks are never held during production:
        </p>

        <CodeCard
          code={`-- 1. Create missing index without locking table writes
CREATE INDEX CONCURRENTLY idx_users_org_id ON "users" (org_id);

-- 2. Drop safe unused or invalid index without blocking reads
DROP INDEX CONCURRENTLY IF EXISTS "idx_legacy_unused";

-- 3. De-bloat B-Tree index online
REINDEX INDEX CONCURRENTLY "idx_orders_created_at";`}
          language="sql"
          title="SQL · Zero-Downtime Index Operations"
        />

        <div className="docs-callout docs-callout-warning">
          <div className="docs-callout-icon">⚠️</div>
          <div>
            <strong>Important:</strong> Never run <code>CREATE INDEX</code> without <code>CONCURRENTLY</code> on production tables, as standard index creation acquires an <code>ACCESS EXCLUSIVE</code> lock that queues all read and write queries.
          </div>
        </div>
      </div>
    ),
  },

  // =========================================================================
  // 5. EXPLAIN Plan Visualizer & Regression Diff
  // =========================================================================
  {
    id: "plan-regression",
    category: "Core Observability",
    title: "EXPLAIN Plan Visualizer",
    badge: "Deep Dive",
    keywords: "explain plan visualizer regression diff execution plan cost surge scan nested loop analyze svg tree capture",
    content: (
      <div>
        <h2>🔍 EXPLAIN Plan Visualizer & Regression Diff</h2>
        <p>
          Located at <code>/databases/[id]/plans</code>. Automatically tracks execution plans across queries over time, flagging when PostgreSQL unexpectedly switches from fast index lookups to full table sequential scans or degrades join strategies.
        </p>

        <h3>Automated Plan Regression Detection</h3>
        <p>PG Vitals continuously compares current execution plans against historical baselines and alerts on:</p>
        <ul>
          <li><strong>Cost Surges</strong>: Total planner estimated cost increases by <strong>≥ 30%</strong> (Warning) or <strong>≥ 100%</strong> (Critical).</li>
          <li><strong>Access Path Degradation</strong>: An <code>Index Scan</code> or <code>Index Only Scan</code> degrades into a full table <code>Seq Scan</code>.</li>
          <li><strong>Join Degradation</strong>: A fast <code>Hash Join</code> degrades into an unindexed <code>Nested Loop</code>, causing quadratic row processing.</li>
          <li><strong>Stale Statistics</strong>: Discrepancy between planner estimated row counts and actual table scale, indicating an urgent need for <code>ANALYZE</code>.</li>
        </ul>

        <h3>Step-by-Step Usage: Side-by-Side Diff Visualizer</h3>
        <ol>
          <li>Open <code>/databases/[id]/plans</code> and select a flagged query from the plan regression list.</li>
          <li>
            The <strong>PlanDiffVisualizer</strong> presents two synchronized columns:
            <ul>
              <li><strong>Baseline Plan (Left)</strong>: The optimal historical plan.</li>
              <li><strong>Current Plan (Right)</strong>: The regressed execution plan.</li>
            </ul>
          </li>
          <li>Degraded execution nodes are highlighted in <strong>Red</strong> (e.g. <code>Seq Scan on large_table</code>) while optimal nodes are in <strong>Green</strong>.</li>
          <li>
            Inspect the <strong>Delta Badge</strong> at the top to see exact cost differences (e.g. <code>+340% Cost Surge</code>).
          </li>
          <li>
            Switch between <strong>📋 List View</strong> and <strong>🗺️ SVG Tree View</strong> to visually pan and zoom across complex execution nodes.
          </li>
          <li>
            Click <strong>"⚡ Capture Plan Now"</strong> to run an immediate on-demand <code>EXPLAIN</code> and verify whether statistics remediation resolved the issue.
          </li>
        </ol>

        <h3>Remediation Workflow</h3>
        <p>If a plan regressed due to stale statistics after a bulk data import or batch deletion, execute:</p>

        <CodeCard
          code={`-- Update PostgreSQL planner distribution statistics immediately
ANALYZE "public"."orders";

-- (Optional) Increase statistics target for columns with skewed distributions
ALTER TABLE "public"."orders" ALTER COLUMN customer_id SET STATISTICS 500;
ANALYZE "public"."orders";`}
          language="sql"
          title="SQL · Statistics Remediation"
        />
      </div>
    ),
  },

  // =========================================================================
  // 6. VACUUM Health, Bloat & Storage Sentinel
  // =========================================================================
  {
    id: "vacuum-health",
    category: "Core Observability",
    title: "VACUUM Health & Storage",
    badge: "Health",
    keywords: "vacuum health bloat storage dead tuples xid wraparound hot heap only tuple checkpoint fsync wal velocity",
    content: (
      <div>
        <h2>🧹 VACUUM Health, Bloat & Storage Sentinel</h2>
        <p>
          Located at <code>/databases/[id]/health</code>. Protects your PostgreSQL instances against dead tuple accumulation, table bloat, disk exhaustion, and catastrophic Transaction ID (XID) wraparound outages.
        </p>

        <h3>Key Guardrails & Metrics</h3>
        <div className="docs-table-wrap">
          <table className="docs-table">
            <thead>
              <tr>
                <th>Guardrail</th>
                <th>Threshold</th>
                <th>Risk & Action</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Database Health Score</strong></td>
                <td>0–100 Scale</td>
                <td>Composite health rating combining dead tuple percentage, bloat ratio, and cache hit efficiency.</td>
              </tr>
              <tr>
                <td><strong>Dead Tuple Ratio</strong></td>
                <td>&gt; 10% of rows</td>
                <td>Table bloat; copy the 1-click <code>VACUUM (VERBOSE, ANALYZE)</code> command to reclaim page space.</td>
              </tr>
              <tr>
                <td><strong>XID Wraparound Sentinel</strong></td>
                <td>&lt; 200M XIDs left</td>
                <td>Critical danger of forced PostgreSQL engine shutdown. Demands immediate <code>VACUUM FREEZE</code>.</td>
              </tr>
              <tr>
                <td><strong>HOT Update Efficiency</strong></td>
                <td>&lt; 60% HOT ratio</td>
                <td>Updates are modifying indexed columns, generating duplicate index pointers. Tune <code>fillfactor = 85</code>.</td>
              </tr>
              <tr>
                <td><strong>Checkpoint fsync Telemetry</strong></td>
                <td>Sync time &gt; 30s</td>
                <td>Storage disk I/O stalls during checkpoint flush; provision higher IOPS or tune <code>checkpoint_completion_target</code>.</td>
              </tr>
              <tr>
                <td><strong>WAL Velocity (MB/min)</strong></td>
                <td>Spikes &amp; Failed Archives</td>
                <td>Monitors WAL write rates and alerts immediately on failed archive transfers (<code>failed_count &gt; 0</code>).</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3>Step-by-Step Usage: Resolving Table Bloat & Dead Tuples</h3>
        <ol>
          <li>Open the <strong>Table Bloat</strong> table on the Health dashboard.</li>
          <li>Sort by <strong>Dead Tuples</strong> or <strong>Bloat Wasted Bytes</strong>.</li>
          <li>Click the <strong>📋 Copy VACUUM</strong> button next to any bloated table to copy the safe non-blocking command:
            <div style={{ marginTop: 8, marginBottom: 8 }}>
              <CodeCard
                code={`-- Reclaim space and update planner statistics safely
VACUUM (VERBOSE, ANALYZE) "public"."orders";`}
                language="sql"
                title="SQL · Non-Blocking Table Vacuum"
              />
            </div>
          </li>
          <li>
            For tables with frequent updates that suffer low HOT update ratios (&lt; 60%), adjust the table's fillfactor so new row versions fit inside the same page:
            <div style={{ marginTop: 8, marginBottom: 8 }}>
              <CodeCard
                code={`-- Reserve 15% page space for in-place HOT updates
ALTER TABLE "public"."orders" SET (fillfactor = 85);`}
                language="sql"
                title="SQL · HOT Update Optimization"
              />
            </div>
          </li>
        </ol>

        <div className="docs-callout docs-callout-warning">
          <div className="docs-callout-icon">⚠️</div>
          <div>
            <strong>Avoid Plain VACUUM FULL:</strong> <code>VACUUM FULL</code> acquires an exclusive lock that locks out all reads and writes for hours on large tables. Use standard <code>VACUUM</code> or tools like <code>pg_repack</code> for zero-downtime compaction.
          </div>
        </div>
      </div>
    ),
  },

  // =========================================================================
  // 7. Autovacuum Starvation & Worker Contention
  // =========================================================================
  {
    id: "autovacuum-sentinel",
    category: "Core Observability",
    title: "Autovacuum Starvation Sentinel",
    badge: "DBA Sentinel",
    keywords: "autovacuum starvation worker contention max workers vacuum cost limit starved tables",
    content: (
      <div>
        <h2>⚙️ Autovacuum Starvation & Worker Contention</h2>
        <p>
          Located at <code>/databases/[id]/health</code> under the <strong>Autovacuum</strong> tab. Autovacuum is PostgreSQL's automatic garbage collection engine. If long-running maintenance jobs or misconfigured cost limits saturate all background worker slots, critical application tables are starved of vacuuming, leading to runaway bloat.
        </p>

        <h3>Key Metrics & Indicators</h3>
        <ul>
          <li><strong>Active Autovacuum Workers</strong>: Real-time count of active <code>autovacuum: VACUUM</code> processes in <code>pg_stat_activity</code> compared to <code>autovacuum_max_workers</code>.</li>
          <li><strong>Pool Saturation Warning</strong>: Triggers when 100% of worker slots are occupied, preventing new tables from being serviced.</li>
          <li><strong>Starved Table Candidates</strong>: Identifies tables with &gt; 10,000 dead tuples and &gt; 20% dead tuple ratio that have not been vacuumed within the threshold window.</li>
        </ul>

        <h3>Step-by-Step Usage: Triage & Capacity Tuning</h3>
        <ol>
          <li>Open the <strong>Autovacuum Sentinel</strong> tab during elevated database write loads.</li>
          <li>Review the <strong>Active Workers</strong> counter. If all worker slots (e.g. 3 of 3) are active, check the running duration of each worker.</li>
          <li>If a single massive table is hogging a worker for 12+ hours due to restrictive cost delay throttling, adjust its per-table autovacuum parameters:
            <div style={{ marginTop: 8, marginBottom: 8 }}>
              <CodeCard
                code={`-- Accelerate autovacuum on a specific write-heavy table
ALTER TABLE "public"."audit_logs" SET (
  autovacuum_vacuum_cost_limit = 2000,
  autovacuum_vacuum_cost_delay = 2,
  autovacuum_vacuum_scale_factor = 0.05
);`}
                language="sql"
                title="SQL · Table-Specific Autovacuum Acceleration"
              />
            </div>
          </li>
          <li>
            If worker starvation is systemic across the database cluster, raise global worker capacity in <code>postgresql.conf</code>:
            <div style={{ marginTop: 8, marginBottom: 8 }}>
              <CodeCard
                code={`# postgresql.conf recommendations for multi-core instances
autovacuum_max_workers = 6
autovacuum_vacuum_cost_limit = 1000
autovacuum_vacuum_cost_delay = 2`}
                language="ini"
                title="Config · postgresql.conf"
              />
            </div>
          </li>
        </ol>
      </div>
    ),
  },

  // =========================================================================
  // 8. Streaming Replication Lag & Slot Sentinel
  // =========================================================================
  {
    id: "replication-sentinel",
    category: "Core Observability",
    title: "Replication Lag & Slot Sentinel",
    badge: "High Availability",
    keywords: "replication lag streaming replica replication slot slot sentinel wal retention byte lag lost slot drop slot cdc debezium",
    content: (
      <div>
        <h2>🔄 Streaming Replication Lag & Slot Sentinel</h2>
        <p>
          Located at <code>/databases/[id]/health</code> under the <strong>Replication</strong> tab. Monitors read replicas in real-time and guards against the #1 cause of unexpected primary database disk crashes: <strong>abandoned replication slots retaining unpurged WAL segments</strong>.
        </p>

        <h3>Why Replication Slots are Dangerous</h3>
        <p>
          When you create a logical or physical replication slot (for a replica, Debezium CDC, Kafka connector, or migration tool), PostgreSQL guarantees that WAL files will <em>never</em> be deleted until the slot acknowledges receiving them.
        </p>
        <p>
          If a subscriber crashes, disconnects, or is decommissioned without dropping its slot, the primary database will continue accumulating WAL files on disk indefinitely until <strong>disk utilization hits 100%</strong>, causing a catastrophic database crash.
        </p>

        <h3>Key Replication Guardrails</h3>
        <div className="docs-table-wrap">
          <table className="docs-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th>Alert Threshold</th>
                <th>Meaning</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Replication Lag (Bytes)</strong></td>
                <td>&gt; 100 MB</td>
                <td>Replica is falling behind the primary LSN write position.</td>
              </tr>
              <tr>
                <td><strong>Replication Lag (Seconds)</strong></td>
                <td>&gt; 60 seconds</td>
                <td>Replica replay delay; clients reading from this replica are seeing stale data.</td>
              </tr>
              <tr>
                <td><strong>Retained Slot WAL</strong></td>
                <td>≥ 250 MB</td>
                <td>Replication slot is holding onto unpurged WAL files on the primary node.</td>
              </tr>
              <tr>
                <td><strong>Inactive Slot Status</strong></td>
                <td><code>active = false</code></td>
                <td>Subscriber is disconnected while the slot continues to hold WAL.</td>
              </tr>
              <tr>
                <td><strong>Slot State Lost</strong></td>
                <td><code>unreserved / lost</code></td>
                <td>Slot has exceeded <code>max_slot_wal_keep_size</code> and cannot catch up without full re-sync.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3>Step-by-Step Usage: Dropping an Abandoned Slot</h3>
        <ol>
          <li>Navigate to the <strong>Replication</strong> tab on the Health page.</li>
          <li>Inspect the <strong>Replication Slots</strong> table. Inactive slots with high retained WAL are flagged in amber/red.</li>
          <li>Verify whether the subscriber service is still supposed to be connected.</li>
          <li>If the slot belongs to an obsolete consumer, copy the one-click cleanup command:
            <div style={{ marginTop: 8, marginBottom: 8 }}>
              <CodeCard
                code={`-- Drop the abandoned slot to free up held WAL files immediately
SELECT pg_drop_replication_slot('debezium_orders_slot');`}
                language="sql"
                title="SQL · Drop Replication Slot"
              />
            </div>
          </li>
          <li>PostgreSQL will immediately reclaim gigabytes of disk space on the next checkpoint.</li>
        </ol>
      </div>
    ),
  },

  // =========================================================================
  // 9. Deadlock & Slow Query Log Diagnostics
  // =========================================================================
  {
    id: "logs-diagnostics",
    category: "Core Observability",
    title: "Deadlocks & Log Insights",
    badge: "Diagnostics",
    keywords: "deadlock logs rollbacks circular lock wait graph slow queries log insights log_lock_waits deadlock_timeout",
    content: (
      <div>
        <h2>🪵 Deadlock & Slow Query Log Diagnostics</h2>
        <p>
          Located at <code>/databases/[id]/logs</code>. Provides deep visibility into transactional deadlocks, rollback rates, and slow query executions.
        </p>

        <h3>24-Hour Delta Baselining vs. Lifetime Engine Counters</h3>
        <p>
          In standard PostgreSQL catalog views (<code>pg_stat_database</code>), deadlock and rollback counts accumulate over the entire lifetime of the server (which may span months or years). This leads to false alarms on traditional monitoring tools that report hundreds of deadlocks from old incidents.
        </p>
        <p>
          PG Vitals establishes a clean baseline snapshot upon database registration and calculates <strong>true 24-hour delta metrics</strong>. You only see deadlocks that occurred within the selected operational window.
        </p>

        <h3>Step-by-Step Usage: Debugging Deadlocks</h3>
        <ol>
          <li>Open <code>/databases/[id]/logs</code> when your application reports <code>ERROR: deadlock detected (SQLSTATE 40P01)</code>.</li>
          <li>Review the <strong>Deadlock Activity Graph</strong> to pinpoint the exact minute the deadlock occurred.</li>
          <li>Inspect the <strong>Circular Wait Breakdown</strong>: PG Vitals isolates the two conflicting transactions (e.g. Transaction A updated Row 1 then requested Row 2, while Transaction B updated Row 2 then requested Row 1).</li>
          <li>
            Enable statement-level lock tracing in your PostgreSQL configuration so your engine logs the complete statement text whenever transactions wait on locks:
            <div style={{ marginTop: 8, marginBottom: 8 }}>
              <CodeCard
                code={`# postgresql.conf recommended deadlock diagnostics settings
log_lock_waits = on
deadlock_timeout = '1s'
log_min_duration_statement = 500  # Log any query running > 500ms`}
                language="ini"
                title="Config · postgresql.conf"
              />
            </div>
          </li>
        </ol>
      </div>
    ),
  },

  // =========================================================================
  // 10. Connection Pooler & PgBouncer Monitoring
  // =========================================================================
  {
    id: "pooler-monitoring",
    category: "Core Observability",
    title: "Connection Pooler & PgBouncer",
    badge: "Infrastructure",
    keywords: "pooler pgbouncer connection pool transaction pooling session pooling queue client wait exhaustion",
    content: (
      <div>
        <h2>🏊 Connection Pooler & PgBouncer Monitoring</h2>
        <p>
          Located at <code>/databases/[id]/pooler</code>. If you run PgBouncer, Supabase Supavisor, AWS RDS Proxy, or built-in poolers in front of your PostgreSQL instance, this dashboard provides dedicated proxy telemetry.
        </p>

        <h3>Key Pooler Metrics</h3>
        <ul>
          <li><strong>Multiplexing Efficiency Ratio</strong>: Compares frontend client connections from your web application servers against backend server connections to PostgreSQL (e.g. 1,200 client connections multiplexed into 40 database backends).</li>
          <li><strong>Client Waiting Queue</strong>: Real-time counter of client queries queued waiting for an available server connection. Any value &gt; 0 indicates pool exhaustion.</li>
          <li><strong>Pool Mode</strong>: Identifies whether the pool operates in <strong>Transaction</strong> mode (recommended for web APIs), <strong>Session</strong> mode, or <strong>Statement</strong> mode.</li>
        </ul>

        <h3>Step-by-Step Usage: Preventing Pool Starvation</h3>
        <ol>
          <li>Check the <strong>Client Waiting</strong> gauge during traffic surges.</li>
          <li>If queries are queuing while PostgreSQL CPU utilization is low, your connection pooler's <code>default_pool_size</code> is too restrictive.</li>
          <li>
            Adjust your <code>pgbouncer.ini</code> settings to provide adequate headroom:
            <div style={{ marginTop: 8, marginBottom: 8 }}>
              <CodeCard
                code={`# pgbouncer.ini optimal settings
pool_mode = transaction
max_client_conn = 2000
default_pool_size = 50
reserve_pool_size = 10
reserve_pool_timeout = 5`}
                language="ini"
                title="Config · pgbouncer.ini"
              />
            </div>
          </li>
          <li>
            <strong>ORM Caution (Prisma / TypeORM / Hibernate):</strong> When using PgBouncer in <em>Transaction Mode</em>, ensure your application configures <code>pgbouncer=true</code> or disables prepared statements to avoid <code>prepared statement "xxx" already exists</code> errors across shared connections.
          </li>
        </ol>
      </div>
    ),
  },

  // =========================================================================
  // 11. Schema Explorer & Table Inspector
  // =========================================================================
  {
    id: "schema-explorer",
    category: "Core Observability",
    title: "Schema Explorer & Tables",
    badge: "Catalog",
    keywords: "schema explorer tables relations columns foreign keys constraints row counts table size cache hit ratio",
    content: (
      <div>
        <h2>🗂️ Schema Explorer & Table Inspector</h2>
        <p>
          Located at <code>/databases/[id]/schema</code>. Provides an interactive catalog of your database schemas, tables, views, columns, foreign keys, row counts, and physical disk storage footprints.
        </p>

        <h3>Key Features</h3>
        <ul>
          <li><strong>Disk Footprint Breakdown</strong>: Separates raw table heap storage from index storage (e.g. 12 GB Table Data vs. 28 GB Index Data).</li>
          <li><strong>Cache Hit Ratio</strong>: Measures <code>heap_blks_hit / (heap_blks_hit + heap_blks_read)</code> per table. Tables with &lt; 95% cache hit ratio indicate high random disk reads and may need memory provisioning or indexing.</li>
          <li><strong>Foreign Key &amp; Constraint Inspector</strong>: Inspects foreign keys and identifies unindexed foreign key columns that cause full-table locks during parent row updates or deletes.</li>
        </ul>

        <h3>Step-by-Step Usage</h3>
        <ol>
          <li>Select a schema from the dropdown (e.g. <code>public</code>).</li>
          <li>Sort the table list by <strong>Total Size</strong> to locate your largest database relations.</li>
          <li>Click any table to expand its detailed column definitions, data types, nullability, and associated B-Tree / GIN indexes.</li>
          <li>Verify whether secondary lookup columns used in application filters have corresponding indexes.</li>
        </ol>
      </div>
    ),
  },

  // =========================================================================
  // 12. Root Cause Hints & Incident Audit Logs
  // =========================================================================
  {
    id: "hints-audit",
    category: "Core Observability",
    title: "Root Cause Hints & Logs",
    badge: "Diagnostic AI",
    keywords: "hints root cause incident audit logs rules idle in transaction connection hog blocking chain spike export csv json",
    content: (
      <div>
        <h2>🎯 Root Cause Hints & Incident Audit Logs</h2>
        <p>
          Located at <code>/databases/[id]/hints</code> (with a live preview widget on <code>/databases/[id]</code>). Continuously evaluates <strong>7 heuristic diagnostic rules</strong> during every collection cycle to instantly identify the operational root cause of database degradation.
        </p>

        <h3>The 7 Automated Heuristic Rules</h3>
        <div className="docs-table-wrap">
          <table className="docs-table">
            <thead>
              <tr>
                <th>Rule Name</th>
                <th>Trigger Threshold</th>
                <th>Root Cause & Diagnostic Impact</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>idle_in_transaction_long</code></td>
                <td>Session idle &gt; 300s</td>
                <td>Application opened <code>BEGIN</code> but failed to <code>COMMIT/ROLLBACK</code>, holding locks and blocking vacuuming.</td>
              </tr>
              <tr>
                <td><code>connection_hog</code></td>
                <td>Single app &gt; 70% connections</td>
                <td>Leaky connection pool or rogue worker process monopolizing available slots.</td>
              </tr>
              <tr>
                <td><code>blocking_chain_long</code></td>
                <td>Query blocked &gt; 30s</td>
                <td>Transaction waiting on row or table lock with root blocker PID identified.</td>
              </tr>
              <tr>
                <td><code>connection_exhaustion</code></td>
                <td>Total connections &gt; 80%</td>
                <td>Approaching <code>max_connections</code> ceiling; incoming client queries will soon be rejected.</td>
              </tr>
              <tr>
                <td><code>connection_spike</code></td>
                <td>&gt; 50% surge between cycles</td>
                <td>Sudden traffic spike or application server restart opening massive connection pools simultaneously.</td>
              </tr>
              <tr>
                <td><code>micro_query_lock_storm</code></td>
                <td>High concurrency on hot rows</td>
                <td>Multiple concurrent transactions updating the exact same primary key row simultaneously.</td>
              </tr>
              <tr>
                <td><code>lock_queue_storm</code></td>
                <td>≥ 2 transactions queued</td>
                <td>Cascading lock backlog queued behind a single blocking transaction or DDL statement.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3>Step-by-Step Usage: Investigating & Exporting Incident Logs</h3>
        <ol>
          <li>Navigate to <code>/databases/[id]/hints</code>.</li>
          <li>Use the <strong>Timeframe Selector</strong> to choose your investigation window (<code>1h</code>, <code>24h</code>, <code>7d</code>, <code>30d</code>, or <code>All Time</code>).</li>
          <li>Filter by <strong>Severity</strong> (<code>Critical</code> or <code>Warning</code>) or search by PID, application name, or SQL snippet.</li>
          <li>
            Click any incident row to open the <strong>Incident Inspector Drawer</strong>:
            <ul>
              <li>View the full anomaly timeline and exact timestamp.</li>
              <li>Inspect the formatted culprit SQL query and click <strong>📋 Copy SQL</strong>.</li>
              <li>Inspect diagnostic session metadata (PID, user, client IP address, duration, and waiting sessions).</li>
              <li>Read tailored remediation advice and recommended PostgreSQL parameter adjustments.</li>
            </ul>
          </li>
          <li>
            Click <strong>Export CSV</strong> or <strong>Export JSON</strong> to download the complete audit trail for your team's engineering post-mortem meeting.
          </li>
        </ol>
      </div>
    ),
  },

  // =========================================================================
  // 13. Multi-Channel Alerts & Slack ChatOps
  // =========================================================================
  {
    id: "alerts-chatops",
    category: "Integrations & Settings",
    title: "Alerts & Slack ChatOps",
    badge: "Integrations",
    keywords: "alerts slack chatops pagerduty teams webhook email smtp terminate blocker notification rules threshold",
    content: (
      <div>
        <h2>📡 Multi-Channel Alerting & Slack ChatOps</h2>
        <p>
          Located at <code>/databases/[id]/alerts</code>. Routes real-time alerts to your team's existing communication and on-call tools whenever performance thresholds are breached or anomalies are detected.
        </p>

        <h3>Supported Notification Channels</h3>
        <ul>
          <li><strong>Slack</strong>: Rich Block Kit cards with query snippets, root blocker PIDs, and interactive remediation buttons.</li>
          <li><strong>PagerDuty</strong>: High-urgency incident creation via Events API v2 with automatic deduplication.</li>
          <li><strong>Microsoft Teams</strong>: Adaptive Cards delivered to your engineering channels.</li>
          <li><strong>Email (SMTP)</strong>: HTML incident summaries with diagnostic root cause context.</li>
          <li><strong>Custom Webhooks</strong>: Raw JSON POST payloads with HMAC-SHA256 signature headers for automated infrastructure webhooks.</li>
        </ul>

        <h3>Slack ChatOps: Remote Blocker Termination</h3>
        <p>
          When a lock queue storm or runaway query blocks your production database, every second of downtime matters. PG Vitals brings interactive resolution straight to Slack:
        </p>
        <ol>
          <li>When an incident occurs, PG Vitals posts a formatted alert card to your designated Slack channel.</li>
          <li>The card displays the root blocker PID, the blocking query snippet, and how many downstream queries are waiting.</li>
          <li>
            Authorized team members can click the <strong>⚡ Terminate Blocker</strong> button directly inside Slack.
          </li>
          <li>A Slack confirmation dialog prompts to verify the action. Upon confirmation, PG Vitals executes the session termination securely via the API.</li>
          <li>The Slack message automatically updates with a green resolution banner showing which operator terminated the session and at what time.</li>
        </ol>

        <h3>Step-by-Step Channel Configuration</h3>
        <ol>
          <li>Navigate to <code>/databases/[id]/alerts</code> and click <strong>"Add Notification Channel"</strong>.</li>
          <li>Select <strong>Slack Webhook</strong> and paste your Slack Incoming Webhook URL.</li>
          <li>Configure built-in alert triggers (e.g. <code>connection_spike &gt; 85%</code>, <code>lock_queue_storm</code>, <code>xid_wraparound_risk</code>).</li>
          <li>Click <strong>"Send Test Alert"</strong> to verify that your channel receives the payload.</li>
          <li>Save the channel to enable automated monitoring.</li>
        </ol>
      </div>
    ),
  },

  // =========================================================================
  // 14. Teams, Roles & Billing
  // =========================================================================
  {
    id: "team-billing",
    category: "Integrations & Settings",
    title: "Teams, Roles & Billing",
    badge: "Organization",
    keywords: "team roles rbac billing pricing stripe seat owner admin member invoice subscription upgrade",
    content: (
      <div>
        <h2>🏢 Team Management, Roles & Billing</h2>
        <p>
          Located under <strong>Settings → Team</strong> (<code>/settings/team</code>) and <strong>Settings → Billing</strong> (<code>/settings/billing</code>). Manage your organization members, access permissions, and subscription plans.
        </p>

        <h3>Granular Role-Based Access Control (RBAC)</h3>
        <div className="docs-table-wrap">
          <table className="docs-table">
            <thead>
              <tr>
                <th>Role</th>
                <th>Permissions &amp; Capabilities</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Owner</strong></td>
                <td>Full administrative access: invite/remove team members, manage billing and Stripe subscriptions, register/delete databases, and execute session terminations.</td>
              </tr>
              <tr>
                <td><strong>Admin</strong></td>
                <td>Can register/configure databases, manage alert channels and thresholds, run HypoPG simulations, and execute session terminations. Cannot modify billing.</td>
              </tr>
              <tr>
                <td><strong>Member</strong></td>
                <td>Read-only access to vitals dashboards, live sessions, query analytics, index suggestions, and logs. Cannot terminate sessions or modify database configurations.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3>Subscription Plan Tiers</h3>
        <ul>
          <li><strong>Free ($0)</strong>: 1 Monitored Database, 1 User Seat, 24-hour telemetry retention. Perfect for hobbyists and individual developers.</li>
          <li><strong>Pro ($39/mo or $31/mo annual)</strong>: Up to 5 Databases, 3 Seats, 30-day retention, Index Advisor, VACUUM Bloat Sentinel, Slack and Email alerts.</li>
          <li><strong>Team ($149/mo or $119/mo annual)</strong>: Up to 20 Databases, Unlimited Seats, 90-day retention, Multi-environment grouping, Log Insights, Slack ChatOps, Priority SLA.</li>
        </ul>

        <h3>Managing Subscriptions & Invoices</h3>
        <ol>
          <li>Navigate to <code>/settings/billing</code>.</li>
          <li>Click <strong>"Manage Subscription"</strong> to open the secure Stripe Customer Portal.</li>
          <li>Update payment methods, view historical PDF receipts/invoices, or upgrade your plan tier instantly.</li>
        </ol>
      </div>
    ),
  },

  // =========================================================================
  // 15. Developer API & OpenAPI Explorer
  // =========================================================================
  {
    id: "developer-api",
    category: "Integrations & Settings",
    title: "Developer API & OpenAPI",
    badge: "API",
    keywords: "developer api openapi swagger rest endpoints sse curl fastify sdk automation",
    content: (
      <div>
        <h2>🔌 Developer API & Interactive OpenAPI Explorer</h2>
        <p>
          PG Vitals provides a comprehensive REST and Server-Sent Events (SSE) API built with Fastify and OpenAPI 3.1. You can programmatically query vitals, export historical snapshots, integrate with internal dashboards, or automate session terminations.
        </p>

        <h3>Interactive Swagger UI & OpenAPI 3.1 Spec</h3>
        <ul>
          <li><strong>Swagger Documentation Portal</strong>: Visit <code>http://localhost:3001/documentation</code> (or your collector URL) to test endpoints interactively in your browser.</li>
          <li><strong>OpenAPI Specification</strong>: Available at <code>/openapi.json</code> for generating client SDKs in TypeScript, Python, Go, or Java.</li>
        </ul>

        <h3>Core API Endpoints</h3>
        <div className="docs-table-wrap">
          <table className="docs-table">
            <thead>
              <tr>
                <th>Method</th>
                <th>Endpoint</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>GET</code></td>
                <td><code>/api/databases/:id/overview</code></td>
                <td>Returns current connection gauge utilization, active sessions, and database health metrics.</td>
              </tr>
              <tr>
                <td><code>GET</code></td>
                <td><code>/api/databases/:id/live-sessions</code></td>
                <td>Server-Sent Events (SSE) push stream of real-time active sessions and lock contention trees.</td>
              </tr>
              <tr>
                <td><code>GET</code></td>
                <td><code>/api/databases/:id/rollups</code></td>
                <td>Retrieves pre-aggregated metric rollups (<code>5m</code>, <code>1h</code>, <code>1d</code>) over a specified time window.</td>
              </tr>
              <tr>
                <td><code>GET</code></td>
                <td><code>/api/databases/:id/queries</code></td>
                <td>Fetches <code>pg_stat_statements</code> delta metrics, calls/sec, and P95/P99 latency estimates.</td>
              </tr>
              <tr>
                <td><code>GET</code></td>
                <td><code>/api/databases/:id/indexes</code></td>
                <td>Lists missing, unused, invalid, redundant, and bloated indexes with non-blocking DDL.</td>
              </tr>
              <tr>
                <td><code>GET</code></td>
                <td><code>/api/databases/:id/health</code></td>
                <td>Vacuum health scores, dead tuple ratios, XID wraparound countdown, and replication lag.</td>
              </tr>
              <tr>
                <td><code>POST</code></td>
                <td><code>/api/databases/:id/sessions/:pid/terminate</code></td>
                <td>Executes safe session termination. Requires <code>admin</code> or <code>owner</code> API key.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3>Sample API Request: Fetching Live Overview</h3>
        <CodeCard
          code={`curl -X GET "https://api.pgvitals.com/api/databases/db_12345/overview" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Accept: application/json"`}
          language="bash"
          title="Bash · cURL"
        />
      </div>
    ),
  },
];
