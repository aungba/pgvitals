# PG Vitals — End User Manual & Operational Guide

Welcome to the **PG Vitals User Manual**. This guide provides complete documentation on how to navigate, interpret, and resolve PostgreSQL performance bottlenecks using PG Vitals.

---

## Table of Contents

1. [Quick Start & Onboarding](#1-quick-start--onboarding)
2. [Live Connection & Session Monitoring](#2-live-connection--session-monitoring)
3. [Query Performance & Optimization Engine](#3-query-performance--optimization-engine)
4. [Index Advisor & HypoPG Simulation](#4-index-advisor--hypopg-simulation)
5. [Plan Regression & EXPLAIN Visualizer](#5-plan-regression--explain-visualizer)
6. [VACUUM Health, Bloat & Storage Management](#6-vacuum-health-bloat--storage-management)
7. [Log Insights, Deadlocks & Replication](#7-log-insights-deadlocks--replication)
8. [Alerts & Multi-Channel Integrations](#8-alerts--multi-channel-integrations)
9. [Tail Latencies (P95/P99) & Storage I/O Diagnostics](#9-tail-latencies-p95p99--storage-io-diagnostics)
10. [Autovacuum Starvation & Worker Contention Sentinel](#10-autovacuum-starvation--worker-contention-sentinel)
11. [Remote Remediation & Slack ChatOps](#11-remote-remediation--slack-chatops)
12. [Production DBA Sentinel Suite](#12-production-dba-sentinel-suite)
13. [Root Cause Hints & Incident Audit Logs](#13-root-cause-hints--incident-audit-logs)

---

## 1. Quick Start & Onboarding

### 1.1 Read-Only Permissions Setup
PG Vitals monitors your database safely using a dedicated, read-only PostgreSQL role. Run the following SQL on your monitored database:

```sql
-- Create read-only monitoring user
CREATE USER pgvitals_monitor WITH PASSWORD 'your_secure_password';

-- Grant connection and view inspection privileges
GRANT pg_monitor TO pgvitals_monitor;
GRANT CONNECT ON DATABASE your_database TO pgvitals_monitor;

-- Enable pg_stat_statements for query performance tracking (optional but recommended)
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

### 1.2 Adding a Database
1. Navigate to **Databases → Register Database** or use the **Onboarding Wizard** (`/onboarding`).
2. Paste your connection string (e.g. `postgresql://pgvitals_monitor:pass@db.example.com:5432/production?sslmode=require`).
3. PG Vitals validates connection latency, PostgreSQL version, and installed extensions (`pg_stat_statements`, `hypopg`, `pgbouncer`).
4. Click **Save & Start Monitoring**.

---

## 2. Live Connection & Session Monitoring

Located at: `/databases/[id]`

### 2.1 Connection Gauge & Utilization
- **Radial Gauge**: Displays live active connections vs. `max_connections`.
- **Warning Threshold**: Orange at $\ge 80\%$ utilization; Red at $\ge 90\%$.
- **Connection Breakdown**: Segregates connections by state: `active`, `idle`, `idle in transaction`, `waiting for locks`.

### 2.2 Time-Travel Session Replay
- Click any point on the **Connection Time-Series Chart** to jump back to that historical snapshot.
- Use **Step Forward (`▶`)** and **Step Backward (`◀`)** to scrub through session activity frame-by-frame during an incident.
- Click **"Exit Replay"** to return to live streaming.

### 2.3 Root Blocker & Lock Storm Detection
- When sessions are blocked waiting on row or table locks, PG Vitals identifies the **Root Blocker session ID (`pid`)**.
- Displays the blocking query, running duration, and one-click copyable termination command:
  ```sql
  SELECT pg_terminate_backend(12345);
  ```

### 2.4 Cascading Lock Queue Storm Sentinel
- **Detection**: Automatically detects when a root blocker or DDL query holds exclusive table locks and blocks $\ge 2$ downstream transactions.
- **Alerting**: Triggers `lock_queue_storm` high-priority notifications with root PID and queued query counts.

---

## 3. Query Performance & Optimization Engine

Located at: `/databases/[id]/queries`

### 3.1 Statement-Aware Optimization Advice
The Optimization Engine parses SQL statements from `pg_stat_statements` combined with runtime metrics (`calls`, `mean_time`, `shared_buffers`) to deliver statement-specific recommendations:

| Statement Type | Diagnostic Trigger | Actionable Recommendation |
| :--- | :--- | :--- |
| **`INSERT`** | $> 500$ calls, $< 15$ms avg | **High-Frequency Writes**: Recommends multi-row `VALUES (...), (...)` batching (100–1,000 rows/query), PostgreSQL bulk `COPY`, or wrapping inserts in transactions to reduce network roundtrips and WAL commit overhead. |
| **`UPDATE`** | $> 500$ calls, $< 15$ms avg | **High-Frequency Updates**: Recommends batch updates with `UPDATE ... FROM (VALUES (...))` or `WHERE id = ANY(...)`. |
| **`DELETE`** | $> 500$ calls, $< 15$ms avg | **High-Frequency Deletes**: Recommends chunked deletions and array filtering `WHERE id = ANY(...)`. |
| **`SELECT`** | $> 500$ calls, $< 15$ms avg | **N+1 Read Workload**: Suggests batching with `IN (...)` or `JOIN`s, and auto-generates covering index DDL. |
| **Any Query** | `temp_blks_written > 0` | **Disk Spill**: Advises increasing `work_mem` or creating composite sorted indexes. |

### 3.2 Covering Index Generation (`INCLUDE`)
For point-lookup queries, PG Vitals extracts the `WHERE` filters and projection columns to generate production-safe non-blocking DDL:
```sql
CREATE INDEX CONCURRENTLY idx_orders_user_id_opt 
ON "orders" (user_id) 
INCLUDE (status, total_amount);
```

---

## 4. Index Advisor & HypoPG Simulation

Located at: `/databases/[id]/indexes`

### 4.1 Default Table View & Search
- Displays all index recommendations in a high-density **Table View** (toggleable to **Cards**).
- Search by table name, column name, or index name.
- Filter chips: `All`, `Unused Indexes`, `Missing Indexes`, `Invalid Indexes`, `Redundant Indexes`, `Bloated Indexes`.

### 4.2 Safe Zero-Downtime DDL
- Every recommendation defaults to **`CREATE INDEX CONCURRENTLY`**, **`DROP INDEX CONCURRENTLY`**, and **`REINDEX INDEX CONCURRENTLY`** to prevent exclusive table locks during production hours.

### 4.3 HypoPG Hypothetical Simulation
- Test whether a recommended index will actually improve your query without creating physical indexes on disk.
- Enter a test query and click **"Test in HypoPG"** to simulate planner cost before and after.

### 4.4 Invalid Index Cleanup (`indisvalid = false`)
- Scans `pg_index` for indexes left invalid or unready due to interrupted `CREATE INDEX CONCURRENTLY` commands.
- Provides one-click `DROP INDEX CONCURRENTLY IF EXISTS` to clean up corrupted catalog definitions and stop wasted write overhead.

### 4.5 Redundant / Prefix-Overlapping Index Detection
- Evaluates column arrays (`indkey`) across all btree indexes per relation.
- Flags non-unique indexes whose columns form a strict leading prefix of another multi-column index, eliminating duplicate index maintenance costs.

### 4.6 B-Tree Index Bloat Estimator & REINDEX Advisor
- Computes physical page count vs. theoretical live tuple packing density across B-Tree indexes.
- Recommends `REINDEX INDEX CONCURRENTLY` for indexes exceeding 30% page bloat and wasting $> 10\text{ MB}$ of storage.

---

## 5. Plan Regression & EXPLAIN Visualizer

Located at: `/databases/[id]/plans`

### 5.1 Multi-Factor Regression Engine
PG Vitals tracks `EXPLAIN` plan changes across historical snapshots and alerts on:
- **Cost Surges**: Estimated planner cost increases by $\ge 30\%$ (Warning) or $\ge 100\%$ (Critical).
- **Dropped Indexes**: An `Index Scan` / `Index Only Scan` degrades into a full table `Seq Scan`.
- **Join Degradation**: A `Hash Join` degrades into an unindexed `Nested Loop`.
- **Stale Statistics**: Recommends instant remediation (e.g. `ANALYZE <table_name>;`).

### 5.2 Side-by-Side Diff View (`PlanDiffVisualizer`)
- Compares **Baseline Plan** against the **Regressed Plan** in two side-by-side columns.
- Highlights changed access paths in green (optimal index scans) and red (unindexed sequential scans).
- Shows exact cost deltas ($\Delta\%$) and row estimation differences.

### 5.3 Execution Map Tree & On-Demand Capture
- **🗺️ Tree View**: SVG visual tree with zoom/pan and node inspection.
- **📋 List View**: Indented tabular execution node hierarchy.
- **⚡ Capture Plan Now**: Click to execute an immediate live `EXPLAIN` and refresh plan snapshots.

---

## 6. VACUUM Health, Bloat & Storage Management

Located at: `/databases/[id]/health`

### 6.1 Table Bloat & Dead Tuple Tracking
- **Health Score (0–100)**: Aggregated health composite based on dead tuples, bloat ratio, and cache hits.
- **Dead Tuple Ratio**: Surfaces tables where dead tuples exceed 10% of total rows.
- **One-Click VACUUM Commands**: Click to copy production-safe commands:
  ```sql
  VACUUM (VERBOSE, ANALYZE) "public"."orders";
  ```

### 6.2 Transaction ID (XID) Wraparound Monitor
- Tracks `age(datfrozenxid)` per table.
- Warns when remaining transactions before emergency shutdown drop below 200,000,000 XIDs.

### 6.3 HOT (Heap-Only Tuple) Update Efficiency & Parameter Tuning
- Collects `n_tup_upd` vs. `n_tup_hot_upd` to measure whether updates modify indexed columns or find room on the same page.
- Tables with $< 60\%$ HOT ratio receive actionable storage tuning suggestions:
  ```sql
  ALTER TABLE "public"."orders" SET (fillfactor = 85, autovacuum_vacuum_scale_factor = 0.05);
  ```

### 6.4 Checkpoint Write vs. Sync Time Telemetry
- Inspects `pg_stat_bgwriter` for `checkpoint_write_time` vs. `checkpoint_sync_time`.
- Flags disk I/O fsync stalls when checkpoint sync exceeds 30 seconds.

### 6.5 WAL Generation Velocity & Archiving Health
- Calculates real-time WAL generation rate in **MB/min** by tracking LSN offsets.
- Monitors `pg_stat_archiver` and alerts immediately on failed WAL archive transfers (`failed_count > 0`).

---

## 7. Log Insights, Deadlocks & Replication

Located at: `/databases/[id]/logs` and `/databases/[id]/health` (Replication tab)

### 7.1 Deadlock Diagnostics
- Detects circular lock waits from `pg_stat_database`.
- Provides lock tree diagnostics and links to concurrent DML write queries.
- Suggests configuring `log_lock_waits = on` and `deadlock_timeout = '1s'` for deeper engine tracing.

### 7.2 Streaming Replication Lag
- Queries `pg_stat_replication` in real-time.
- Calculates WAL byte lag via `pg_wal_lsn_diff(sent_lsn, replay_lsn)`.
- Displays write lag, flush lag, and replay lag per replica.

### 7.3 Replication Slot Sentinel & WAL Retention Risk
- Monitors `pg_replication_slots` for inactive or orphaned physical and logical slots.
- Calculates retained WAL bytes on the primary node.
- Alerts on slots retaining $\ge 250\text{ MB}$ or in `unreserved` / `lost` state.
- Provides one-click drop remediation commands:
  ```sql
  SELECT pg_drop_replication_slot('debezium_cdc');
  ```

---

## 8. Alerts & Multi-Channel Integrations

Located at: `/databases/[id]/alerts`

### 8.1 Supported Notification Channels
- **Slack**: Webhook alerts with formatted rich message blocks.
- **Email (SMTP)**: HTML incident notifications with root cause context.
- **PagerDuty**: Events API v2 integration for on-call paging.
- **Microsoft Teams**: Office 365 / Adaptive Cards webhook payloads.
- **Generic Webhook**: Custom JSON POST with HMAC-SHA256 request signing.

### 8.2 Built-In Alert Rules
- `connection_spike`: Active connections $> 85\%$ of `max_connections`.
- `pool_exhaustion`: PgBouncer clients waiting $> 0$.
- `deadlock_storm`: Deadlock count increase $> 0$.
- `xid_wraparound_risk`: Table XID age $> 1.5$ billion.
- `replication_lag`: Replay lag $> 60$ seconds or $> 100$MB.
- `wal_retention_risk`: Replication slot retaining $\ge 1\text{ GB}$ of WAL or in `lost`/`unreserved` state.
- `replication_slot_stalled`: Replication slot inactive while retaining WAL.
- `invalid_indexes`: Database contains one or more `indisvalid = false` indexes.
- `lock_queue_storm`: Root blocker session or DDL blocking $\ge 2$ downstream transactions.
- `checkpoint_sync_stall`: Checkpoint fsync duration exceeding safety limits.

---

## 9. Tail Latencies (P95/P99) & Storage I/O Diagnostics

Located at: `/databases/[id]/queries` (Percentiles & I/O tabs)

### 9.1 Directional Percentile Estimation ($P_{50}, P_{95}, P_{99}$)
- PG Vitals models continuous log-normal query latency distributions bounded by $[min, max]$ from `pg_stat_statements`.
- **Variance Ratio**: Computes $(max - mean) / mean$ to highlight queries with extreme tail spikes.
- **High Variance Flag**: Instantly tags queries with $> 10\times$ variance spikes and $max > 500$ms.

### 9.2 Disk vs. CPU Bottleneck Classification (`track_io_timing`)
- Checks `track_io_timing` in PostgreSQL engine settings.
- If enabled, measures block read and write times per query (`blk_read_time` + `blk_write_time`).
- **I/O Stall Detection**: Flags queries spending $\ge 45\%$ of total execution time waiting on storage disk reads/writes with actionable remediation advice (e.g. creating indexes to replace sequential disk scans or provisioning higher AWS EBS IOPS).

---

## 10. Autovacuum Starvation & Worker Contention Sentinel

Located at: `/databases/[id]/health` (Autovacuum tab)

### 10.1 Worker Contention & Pool Saturation
- Compares active `autovacuum:` workers in `pg_stat_activity` against `autovacuum_max_workers`.
- Identifies when all background worker slots are saturated by long-running maintenance jobs.

### 10.2 Starved Table Candidate Identification
- Surfaces tables accumulating $> 10,000$ dead tuples with a dead tuple ratio $> 20\%$.
- Generates proactive tuning guidance (e.g. increasing `autovacuum_max_workers`, raising `autovacuum_vacuum_cost_limit`, or running manual `VACUUM ANALYZE`).

---

## 11. Remote Remediation & Slack ChatOps

### 11.1 Safe Session Cancellation API
- **Endpoint**: `POST /api/databases/:id/sessions/:pid/terminate`
- **Role Requirement**: Requires `admin` or `owner` privileges within the organization.
- Executes `SELECT pg_terminate_backend(pid)` to abort rogue blocking queries or orphan connections.

### 11.2 Interactive Slack Alerts & In-Channel Resolution
- When a blocking chain exceeds the 30-second threshold, PG Vitals sends an interactive Block Kit card to Slack.
- **Terminate Blocker Action**: Authorized team members can click **⚡ Terminate Blocker** with confirmation dialog.
- Validates `X-Slack-Signature` HMAC tokens and updates the Slack alert card in real-time with the acting operator's handle.

---

## 12. Production DBA Sentinel Suite

Summary of automated protections operating across polling cycles:

| Sentinel Guard | Source View | Detection Metric | Remediation |
| :--- | :--- | :--- | :--- |
| **Replication Slot Sentinel** | `pg_replication_slots` | Inactive slot or $\ge 250\text{MB}$ WAL retention | `SELECT pg_drop_replication_slot('slot_name');` |
| **Invalid Index Detector** | `pg_index` | `indisvalid = false` | `DROP INDEX CONCURRENTLY IF EXISTS "idx_name";` |
| **Redundant Index Detector** | `pg_index` (`indkey`) | Leading column prefix overlap on same table | `DROP INDEX CONCURRENTLY IF EXISTS "idx_name";` |
| **B-Tree Index Bloat Advisor** | `pg_class`, `pg_am`, `pg_stats` | Page bloat $> 30\%$ and bloat bytes $> 10\text{MB}$ | `REINDEX INDEX CONCURRENTLY "idx_name";` |
| **Cascading Lock Queue Storm** | `pg_locks`, `pg_stat_activity` | Root blocker session blocking $\ge 2$ queries | `SELECT pg_terminate_backend(root_pid);` |
| **HOT Update Tuner** | `pg_stat_user_tables` | `hot_update_ratio < 60%` on write-heavy tables | `ALTER TABLE ... SET (fillfactor = 85);` |
| **Checkpoint Sync & WAL Velocity** | `pg_stat_bgwriter`, `pg_stat_archiver` | Sync time $> 30\text{s}$ or failed archive $> 0$ | Investigate fsync IOPS / storage archive path |

---

## 13. Root Cause Hints & Incident Audit Logs

Located at: `/databases/[id]/hints` (with live preview widget on `/databases/[id]`)

### 13.1 Automated Root Cause Detection Rules
PG Vitals continuously evaluates 7 heuristic diagnostic rules during every collection cycle:
- **Idle in Transaction (`idle_in_transaction_long`)**: Surfaces sessions holding idle transactions $> 300\text{s}$.
- **Connection Hog (`connection_hog`)**: Detects a single client application consuming $> 70\%$ of available connections.
- **Blocking Lock Chain (`blocking_chain_long`)**: Pinpoints active transactions waiting on locks $> 30\text{s}$ with blocker PID and query.
- **Connection Exhaustion (`connection_exhaustion`)**: Flags when total connections surpass $80\%$ of `max_connections`.
- **Connection Spike (`connection_spike`)**: Alerts on sudden surges ($> 50\%$ spike from prior snapshot).
- **Lock Contention Storm (`micro_query_lock_storm`)**: Identifies high-frequency concurrency storms on hot table rows.
- **Lock Queue Storm (`lock_queue_storm`)**: Alerts on cascading lock queues ($\ge 2$ sessions queued behind a root blocker).

### 13.2 Dashboard Widget & Live Incident Feed
- Displays the most recent active hints next to the Connection Utilization gauge.
- Includes a direct link `View Full Logs & History →` to jump straight to historical logs.

### 13.3 Historical Audit Log & Inspector
- **Timeframe Selector**: Filter incident history across `1h`, `24h`, `7d`, `30d`, or `All Time`.
- **Multi-Filter & Search**: Filter by Severity (`Critical` / `Warning`), Rule Type, or search by PID, application name, or SQL snippet.
- **Incident Inspector Drawer**: Click any incident row to inspect:
  - Full anomaly description and exact timestamp.
  - Culprit SQL query formatted with a 1-click **📋 Copy SQL** button.
  - Diagnostic session metadata (PID, application name, duration, waiting session count).
  - Specific remediation guidance and recommended PostgreSQL parameter tuning.
- **Exporting Incident Logs**: Export filtered incident records to **CSV** or **JSON** for post-mortem reporting.


