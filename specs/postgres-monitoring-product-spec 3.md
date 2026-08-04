# Product Spec: PG Connection & Performance Monitor
### (Working name — replace once you pick a brand)

---

## 1. Product Overview

**One-line pitch:** A PostgreSQL monitoring tool that doesn't just show you *what's* wrong — it traces problems back to the service/code path that caused them and tells you exactly what to fix.

**Target user:** Backend engineers, DevOps/SRE, and engineering managers at small-to-mid teams (5-50 engineers) running PostgreSQL in production without a dedicated DBA.

**Core wedge (differentiation vs. pganalyze/pgHero/Datadog):**
Existing tools surface metrics (idle connections, slow queries, lock waits) but stop at the database boundary. This product correlates database-level symptoms with application-level context (service name, endpoint, connection pool config) and produces a plain-English root cause + fix, not just a chart.

**Non-goals (explicitly out of scope for v1):**
- Not a general APM (no distributed tracing, no frontend/browser monitoring)
- Not a full BI/analytics tool
- Not multi-database-engine at launch (Postgres only; MySQL is a possible v2 expansion)
- Not a managed hosting/DBaaS product — this monitors databases the customer already hosts elsewhere

---

## 2. Feature Modules

### 2.1 Connection & Session Monitoring (Flagship — build first)

**Functional requirements:**
- Poll `pg_stat_activity` on a configurable interval (default: 10s)
- Classify every connection into: `active`, `idle`, `idle in transaction`, `idle in transaction (aborted)`, `disabled`
- Group connections by `application_name`, `client_addr`, `usename`, `datname`
- Track connection age (how long in current state) per session
- Compute utilization: current connections / `max_connections`

**Blocking chain detection:**
- Join `pg_locks` to `pg_stat_activity` to build a blocker→blocked tree
- Surface: which PID is blocking, for how long, what query each side is running
- Flag chains exceeding a configurable duration threshold (default: 30s)

**Data captured per snapshot:**
```
snapshot_id, timestamp, database_id,
pid, usename, application_name, client_addr,
state, state_change_duration_seconds,
query_text (truncated to 500 chars), query_start,
wait_event_type, wait_event,
blocking_pid (nullable)
```

**Root-cause hints (rules engine, v1 = simple heuristics, not ML):**
| Condition | Hint |
|---|---|
| idle in transaction > 5 min | "`{application_name}` opened a transaction and never committed/rolled back. Check for missing `COMMIT`/`ROLLBACK` or an exception path that skips cleanup." |
| connections from one app_name > 70% of max_connections | "`{application_name}` is consuming most of your connection budget. Check pool size configuration." |
| blocking chain > 30s | "Query `{query}` has been blocked by PID {blocking_pid} for {duration}. Consider whether the blocking transaction can be shortened or run at a lower isolation level." |
| total connections > 80% of max_connections, no pooler detected | "You're nearing your connection limit and no connection pooler (PgBouncer/RDS Proxy) was detected. Consider adding one to avoid connection exhaustion." |

---

### 2.2 Alerting

**Channels (v1):** Slack incoming webhook, email (via Resend/Postmark)
**Channels (later):** PagerDuty, generic webhook, Microsoft Teams

**Alert types:**
- Idle-in-transaction duration exceeds threshold
- Blocking chain duration exceeds threshold
- Connection count approaches `max_connections` (configurable %, default 80%)
- Sudden spike in connection count (rate-of-change based, not just absolute)

**Alert payload structure:**
```json
{
  "alert_type": "idle_in_transaction",
  "severity": "warning | critical",
  "database": "prod-primary",
  "detected_at": "ISO8601",
  "details": { "pid": 1234, "application_name": "checkout-service", "duration_seconds": 720 },
  "root_cause_hint": "text from rules engine",
  "dashboard_link": "https://app.yourtool.com/alerts/{id}"
}
```

**Deduplication:** don't re-fire the same alert every polling interval — use a cooldown window (default: 15 min) per unique alert fingerprint (type + pid/query hash).

---

### 2.3 Query Optimizer

**Data source:** `pg_stat_statements` (requires extension enabled on customer DB — document this as a setup prerequisite)

**Metrics tracked per query fingerprint:**
```
query_fingerprint     — normalized query text, params stripped
calls                 — total number of times executed
total_exec_time_ms    — cumulative time across all calls
mean_exec_time_ms     — total_time / calls
min_exec_time_ms, max_exec_time_ms
rows                  — total rows returned/affected
rows_per_call         — rows / calls
shared_blks_hit       — cache hits (good)
shared_blks_read      — disk reads (bad — cache misses)
temp_blks_written     — spilling to disk (bad — work_mem too low)
first_seen, last_seen
```

**Ranking principle:** default sort is `total_exec_time_ms` (impact = frequency × duration combined), not raw slowness alone. A 50ms query called 500,000 times matters more than a 2s query run once a day.

**Additional views:**
- Top by call count (surfaces N+1 query patterns)
- Top by mean time (surfaces rare slow outliers)
- Top by disk spill (`temp_blks_written` > 0 — needs more `work_mem` or a rewrite)
- Trend delta (mean time increased >X% week-over-week — catches regressions early)

**Optimizer suggestions (rules engine):**
| Signal | Suggestion |
|---|---|
| High `calls`, low `mean_time`, tight repetition from one `application_name` | "This query runs {calls}x in the last hour from `{application_name}` — possible N+1 pattern. Consider batching with `IN (...)` or a JOIN." |
| High `shared_blks_read` vs. `shared_blks_hit` | "This query reads mostly from disk, not cache. Consider an index, or review `shared_buffers` sizing." |
| `temp_blks_written` > 0 | "This query is spilling to disk for sorts/hashes. Consider raising `work_mem` or reducing result set size." |
| Sequential scan on table >10k rows (via EXPLAIN) | "This query scans all of `{table}`. An index on `{columns}` may help." — links to Index Advisor |
| Mean time up >30% week-over-week | "This query has slowed {X}% over 7 days. Check table growth, missing VACUUM, or a recent schema change." |

**EXPLAIN capture (v1 — manual trigger, not automatic):**
- User requests an `EXPLAIN (ANALYZE, BUFFERS)` run against a sample of a query from the dashboard
- Parse plan JSON, flag: sequential scans on large tables, high buffer reads, nested loop joins on large row estimates

**UI concept:** sortable leaderboard table (Query / Calls / Total Time / Mean Time / Trend), expandable per row into full query text, rule-engine suggestion, EXPLAIN trigger, and a mini time-series chart of mean time over the retention window.

---

### 2.4 Index Advisor (Phase 5)

- Detect unused indexes: `pg_stat_user_indexes.idx_scan = 0` over a sustained observation window (e.g. 30 days), excluding indexes enforcing constraints
- Detect missing index candidates: tables with high `seq_scan` count and large `n_live_tup`, correlated with WHERE/JOIN columns extracted from `pg_stat_statements` query text
- Output: suggested `CREATE INDEX` statement + estimated impact (rough heuristic, not guaranteed)

**Simulate before recommending (HypoPG):**
- Requires the `hypopg` extension enabled on the customer's database (document as an optional setup step — feature degrades gracefully to heuristic-only suggestions if not installed)
- Flow: detect candidate index → create a *hypothetical* index via HypoPG (no disk write, no production impact) → re-run `EXPLAIN` on the slow query against the hypothetical index → capture estimated cost before/after
- Show the customer a concrete, checkable claim: *"Adding this index would reduce estimated query cost from 45,200 to 1,180 (~97% reduction)"* rather than an unverified suggestion
- This is a meaningfully stronger claim than most competitors make, and reinforces the product's core positioning (verified root cause + fix, not a guess)

---

### 2.5 VACUUM / Bloat Advisor (Phase 6)

**Data source:** `pg_stat_user_tables`, `pg_class`, `pg_stats`

**Metrics tracked per table:**
```
table_name, n_live_tup, n_dead_tup, dead_tuple_ratio (n_dead_tup / n_live_tup)
last_vacuum, last_autovacuum, last_analyze, last_autoanalyze
autovacuum_count, autoanalyze_count
estimated_bloat_bytes, estimated_bloat_pct
```

- Flag tables where `dead_tuple_ratio` exceeds a threshold (default 20%) and autovacuum hasn't run recently relative to write volume
- **Transaction ID wraparound risk:** track `age(datfrozenxid)` per database vs. `autovacuum_freeze_max_age`; escalate severity as the ratio climbs (warning at 50%, critical at 80%) — this is a genuinely dangerous, easy-to-miss failure mode worth surfacing early and loudly
- Output plain-English guidance: "`{table}` has {pct}% dead tuples and hasn't been autovacuumed in {duration} despite {n} writes/hour — autovacuum may not be keeping up. Consider tuning `autovacuum_vacuum_scale_factor` for this table."

---

### 2.6 Cache Hit Ratio Monitor

**Data source:** `pg_statio_user_tables`, `pg_statio_user_indexes`

**Metrics tracked:**
```
table_name, heap_blks_hit, heap_blks_read,
cache_hit_ratio (heap_blks_hit / (heap_blks_hit + heap_blks_read))
idx_blks_hit, idx_blks_read, index_cache_hit_ratio
```

- Overall DB-level cache hit ratio, plus per-table breakdown (a healthy production Postgres is typically >99%; below ~95% is worth investigating)
- Flag specific tables/indexes dragging the average down — often a signal that `shared_buffers` is undersized for the working set, or a large table is being scanned instead of using an index
- Root-cause hint: "`{table}`'s cache hit ratio is {pct}%, well below your database average of {avg}%. This table's working set may not fit in `shared_buffers` ({current_value}), or queries against it may be missing an index."

---

### 2.7 Replication Lag Monitor (for customers running read replicas)

**Data source:** `pg_stat_replication` (primary side), `pg_last_wal_receive_lsn`/`pg_last_wal_replay_lsn` (replica side)

**Metrics tracked per replica:**
```
replica_name/application_name, sent_lsn, write_lsn, flush_lsn, replay_lsn,
byte_lag (sent_lsn - replay_lsn), time_lag_seconds, replication_state
```

- Alert when byte or time lag exceeds a configurable threshold — critical for teams reading from replicas, since stale reads silently cause bugs (e.g. a user doesn't see their own just-written data)
- Root-cause hint distinguishes causes where possible: network lag vs. replica under heavy read load vs. a long-running query blocking WAL replay

---

### 2.8 Table & Disk Growth Forecast

**Data source:** `pg_total_relation_size()` per table, sampled daily

**Metrics tracked:**
```
table_name, total_size_bytes, table_size_bytes, index_size_bytes,
growth_rate_bytes_per_day (7-day rolling average), projected_days_to_disk_limit
```

- Simple linear projection: at current growth rate, when does this table (or the whole database) hit a configured disk size warning threshold
- Genuinely useful for teams on fixed-size managed Postgres instances (RDS/Cloud SQL) who get surprised by a storage-full incident — this is a "boring" feature but a real, recurring source of production incidents worth catching weeks in advance rather than the day it happens

---

### 2.9 Log Insights (Phase 6)

- Optional log shipping (customer configures Postgres log destination or uploads log files)
- Parse for: deadlocks, connection errors, checkpoint warnings, slow query log entries not captured by `pg_stat_statements` (e.g. one-off ad hoc queries)
- Surface recurring error signatures (grouped by error type/message pattern)

---

### 2.10 Query Plan Regression Detection

**Data source:** periodic `EXPLAIN` capture (not `EXPLAIN ANALYZE`, to keep overhead low) for top queries by total time

**Metrics tracked:**
```
query_fingerprint, captured_at, plan_shape_hash (normalized node types: seq scan / index scan / nested loop / hash join etc.),
estimated_cost, actual_mean_time_ms (cross-referenced from pg_stat_statements)
```

- Diff `plan_shape_hash` over time per query fingerprint; flag when a query flips from an index scan to a sequential scan (or similar plan degradation)
- Common causes worth naming in the root-cause hint: stale table statistics (missing `ANALYZE`), data growth crossing a planner cost threshold, or a parameter-sensitive plan ("parameter sniffing")
- This targets a genuinely hard-to-diagnose incident class — "nothing changed in our code, but the query got slow" — and few competitors surface it explicitly

---

### 2.11 Cost-Per-Query Estimator

**Data source:** `pg_stat_statements` I/O metrics (`shared_blks_read`, `total_exec_time_ms`) combined with a configurable cloud cost model

**Metrics tracked:**
```
query_fingerprint, estimated_io_cost_usd_per_month, estimated_cpu_cost_usd_per_month
(based on customer-provided or default RDS/Cloud SQL per-IOPS and per-vCPU-hour rates)
```

- Directional estimate, not precise billing — documented methodology, clearly labeled as an estimate
- Reframes engineering findings in budget-owner language ("this query pattern costs an estimated $340/month in IOPS") rather than pure latency — useful for justifying optimization work to non-engineering stakeholders and a natural hook for selling into engineering managers/finance, not just individual engineers

---

### 2.12 Connection Pooler Awareness (PgBouncer)

**Data source:** PgBouncer admin console (`SHOW STATS`, `SHOW POOLS`, `SHOW CLIENTS` via a dedicated read-only PgBouncer connection)

**Metrics tracked:**
```
pool_name, cl_active, cl_waiting, sv_active, sv_idle,
avg_wait_time_ms, total_wait_time_ms
```

- Correlate pool-level wait times directly with database-side idle-in-transaction/blocking findings — turns a previously heuristic root-cause guess ("you may need a pooler") into a stated fact backed by real pooler metrics when one is present
- New alert type: pool exhaustion (`cl_waiting` > 0 sustained) — this often precedes a full connection-limit incident and is catchable earlier than database-side signals alone

---

### 2.13 Schema & Migration Change Markers

**Data source:** either log parsing (DDL statements in Postgres logs) or periodic schema diffing (`information_schema`/`pg_catalog` snapshots compared over time)

**Events tracked:**
```
event_type (create_index | drop_index | alter_table | create_table | drop_table),
object_name, detected_at
```

- Overlay these as markers on connection, query performance, and cache hit ratio charts (same UI pattern as the deploy markers feature)
- Directly supports one of the most common real-world root causes — "this query/table got slow right after a migration ran" — surfaced automatically instead of requiring the customer to remember or dig through migration history

---

## 2.x Future Expansion (v2+, not in initial build)

**CI/CD integration (PR-time query linting):**
A CLI/GitHub Action that runs `EXPLAIN` against new or modified queries in a pull request (against a staging database) and comments on the PR — or fails the build — if a new query would trigger a sequential scan on a large table.

- Shifts the product from reactive ("tells you after it's a problem") to preventive ("catches it before merge")
- A meaningful category expansion, best pursued once the core monitoring product has real paying customers and feedback — natural fit as an Enterprise/premium tier feature later

---

## 3. Data Model (Application Database — separate from customer's monitored DB)

```
organizations
  id, name, created_at, plan_tier, stripe_customer_id

users
  id, org_id, email, role, created_at

monitored_databases
  id, org_id, name, connection_string_encrypted,
  db_engine, environment (prod/staging), created_at

snapshots (TimescaleDB hypertable, partitioned by time)
  id, monitored_db_id, timestamp,
  connection_count, idle_count, idle_in_txn_count,
  max_connections, raw_payload (jsonb)

sessions_snapshot (TimescaleDB hypertable)
  snapshot_id, pid, usename, application_name, client_addr,
  state, state_duration_seconds, query_text, wait_event_type,
  wait_event, blocking_pid

alerts
  id, monitored_db_id, alert_type, severity, fingerprint,
  details (jsonb), root_cause_hint, fired_at, resolved_at,
  last_notified_at

alert_rules
  id, monitored_db_id, alert_type, threshold_value,
  cooldown_minutes, enabled, channels (jsonb)

query_stats (TimescaleDB hypertable)
  monitored_db_id, query_fingerprint, captured_at,
  calls, total_time_ms, mean_time_ms, max_time_ms, rows,
  shared_blks_hit, shared_blks_read, temp_blks_written

index_recommendations
  id, monitored_db_id, table_name, recommendation_type
  (unused | missing), suggested_ddl, detected_at, dismissed

table_health_snapshots (TimescaleDB hypertable)
  monitored_db_id, table_name, captured_at,
  n_live_tup, n_dead_tup, dead_tuple_ratio,
  last_autovacuum, last_autoanalyze,
  cache_hit_ratio, total_size_bytes, growth_rate_bytes_per_day

replication_snapshots (TimescaleDB hypertable)
  monitored_db_id, replica_name, captured_at,
  byte_lag, time_lag_seconds, replication_state

query_plan_snapshots (TimescaleDB hypertable)
  monitored_db_id, query_fingerprint, captured_at,
  plan_shape_hash, estimated_cost, actual_mean_time_ms

pooler_snapshots (TimescaleDB hypertable)
  monitored_db_id, pool_name, captured_at,
  cl_active, cl_waiting, sv_active, sv_idle, avg_wait_time_ms

schema_events
  id, monitored_db_id, event_type, object_name, detected_at
```

---

## 4. Architecture

```
┌─────────────────────┐
│ Customer Postgres DB │  (read-only role: monitor_readonly)
└──────────┬───────────┘
           │ scheduled polling (10s connections, 5min query stats, hourly bloat)
           ▼
┌──────────────────────┐
│  Collector Service     │  Node.js worker, one job type per metric family
│  (BullMQ + Redis queue) │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  TimescaleDB           │  stores snapshots, sessions, query_stats (hypertables)
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  Rules/Analysis Engine │  evaluates thresholds, generates root-cause hints
└──────────┬───────────┘
           ▼
┌──────────────────────┐        ┌─────────────────────┐
│  Alerting Service      │──────▶│ Slack / Email        │
└──────────────────────┘        └─────────────────────┘
           │
           ▼
┌──────────────────────┐
│  Web App (Next.js)     │  dashboards, alert config, billing (Stripe), auth (Clerk)
└──────────────────────┘
```

**Connection security requirements:**
- Customer provides a read-only Postgres role (`monitor_readonly`) — document exact `GRANT` statements needed
- Connection strings encrypted at rest (e.g. libsodium sealed boxes or KMS-backed encryption)
- Support SSL-required connections; validate certs where provided
- No write access to customer database, ever — enforce this in code (reject any non-SELECT statement at the query-execution layer as a safety net, not just via DB role)

---

## 5. Non-Functional Requirements

- **Polling overhead:** collector queries must be lightweight — avoid expensive joins on every 10s poll; heavier analysis (bloat, index recs) runs on longer intervals (hourly/daily)
- **Multi-tenancy isolation:** strict `org_id` scoping on every query — no cross-tenant data leakage
- **Reliability:** alerting must not silently fail — if a collector job fails repeatedly for a given database, alert the *customer* that monitoring itself is broken (a meta-alert)
- **Data retention:** default 30 days of raw snapshots on free/pro tier, longer retention (90-365 days) as a paid upsell
- **Uptime target:** since this is diagnostic/alerting infrastructure, aim for 99.5%+ once out of beta — document this honestly to customers rather than overpromising early on

---

## 6. Pricing (draft)

| Tier | Price | Includes |
|---|---|---|
| Free | $0 | 1 database, connection/session monitoring only, 24h retention, no alerting |
| Pro | $39/mo per database | Full monitoring, alerting (Slack/email), Query Optimizer, cache hit ratio, disk growth forecast, 30-day retention |
| Team | $99/mo per database | Everything in Pro + Index/VACUUM advisors, replication lag monitoring, log insights, 90-day retention, priority support, multiple environments |

---

## 7. Build Roadmap (10-20 hrs/week pace)

| Phase | Weeks | Deliverable |
|---|---|---|
| 1 | 1-4 | Collector + session/connection monitoring + basic dashboard |
| 2 | 5-7 | Alerting engine + Slack integration + root-cause hints |
| 3 | 8-10 | Auth (Clerk), billing (Stripe), multi-tenancy |
| 4 | 11-14 | Query Optimizer (`pg_stat_statements` leaderboard, N+1 detection, EXPLAIN capture) |
| 5 | 15-17 | Cache Hit Ratio Monitor + Table & Disk Growth Forecast (cheap to build, high perceived value) |
| 6 | 18-21 | Index Advisor + HypoPG-based index simulation |
| 7 | 22-25 | VACUUM/Bloat Advisor (incl. wraparound risk) + Replication Lag Monitor |
| 8 | 26-28 | Log Insights + Schema/Migration Change Markers |
| 9 | 29-32 | Query Plan Regression Detection + PgBouncer Awareness |
| 10 | 33-35 | Cost-Per-Query Estimator |

**Sellable milestone:** end of Phase 2 (~week 7) — connection monitoring + alerting with root-cause hints is already a differentiated, chargeable product. The Query Optimizer (Phase 4) is likely your strongest upsell trigger — it's the most immediately "wow" feature for a prospect to see in a demo. HypoPG-based index simulation (Phase 6) is the next standout demo moment once you're further along.

---

## 8. Tech Stack Summary

- **Backend:** Node.js + Fastify or NestJS
- **Metrics store:** TimescaleDB (Postgres extension)
- **App data ORM:** Drizzle or Prisma
- **Job scheduling:** BullMQ + Redis
- **Frontend:** Next.js + Tailwind + Recharts
- **Auth:** Clerk
- **Billing:** Stripe
- **Alert delivery:** Slack Incoming Webhooks, Resend/Postmark for email
- **Hosting (early stage):** Railway or Render

---

## 9. Onboarding Flow

**Goal:** time-to-first-value under 5 minutes from signup to seeing real data on a connected database. This is treated as a tracked product metric, not just a design aspiration (see Success Metrics below).

**Step-by-step wizard:**
1. **Sign up** (Clerk) → create organization
2. **Connect a database** — customer pastes a connection string or fills in host/port/db/user fields
3. **Generate setup SQL** — the wizard outputs the exact `CREATE ROLE`/`GRANT` statements needed for a read-only `monitor_readonly` role, copy-pasteable, with a "I've run this" confirmation step
4. **Validate connection** — test the connection live in the wizard before proceeding; surface clear, specific errors (wrong credentials vs. network/firewall vs. SSL issue) rather than a generic failure
5. **Capability detection** — check for `pg_stat_statements`, `hypopg`, and PgBouncer reachability; for each missing optional extension, show a short guided snippet to enable it, but do not block progress — degrade gracefully (e.g. Query Optimizer view shows a clear "enable pg_stat_statements to unlock this" prompt rather than an empty/broken screen)
6. **First dashboard view** — land directly on the connection/session monitoring dashboard with real data already populated (first collector run triggered synchronously during onboarding, not waiting for the next scheduled poll)
7. **Optional: connect Slack** for alerting — can be deferred, but prompted here while intent is high

**Failure handling:** every validation step needs a specific, actionable error message. "Connection failed" is not acceptable; "Connection timed out — check that your database allows inbound connections from `{our IP range}`" is the bar.

---

## 10. Security & Compliance

**Data handling for query text (resolves the redaction open question below):**
- Query text captured from `pg_stat_activity`/`pg_stat_statements` may contain literal parameter values (potentially PII) in poorly parameterized queries
- v1 requirement: attempt to detect and redact literal values in captured query text before storage (basic pattern-based redaction of string/numeric literals); document this as a best-effort protection, not a guarantee, and say so plainly to customers
- Longer term: prefer normalized query fingerprints (which `pg_stat_statements` already provides, params stripped) as the primary stored form, keeping raw query text capture opt-in and time-limited

**Credential handling:**
- Connection strings encrypted at rest (KMS-backed or libsodium sealed boxes, per Architecture section)
- Read-only enforcement at two layers: the customer's DB role, and a code-level guard rejecting any non-SELECT statement before execution
- Credential rotation support — customers can update/rotate the read-only credentials without a support ticket

**Compliance roadmap (not required at launch, but plan for it):**
- SOC 2 Type I/II — many B2B buyers will ask for this once you're selling to companies beyond very early-stage startups; budget for this once you have meaningful ARR, not before
- Note this explicitly to early customers as "on the roadmap" rather than pretending it's done

**Incident response:**
- Document (even briefly, internally) what happens if your own infrastructure is compromised, given you hold read credentials to customers' production databases — this is a real responsibility disproportionate to a typical SaaS tool, and worth taking seriously from day one rather than retrofitting later

---

## 11. Success Metrics / KPIs

Track these from the earliest usable version onward, not just after launch:

| Metric | Why it matters |
|---|---|
| Time-to-first-value (signup → first real dashboard data) | Directly measures onboarding friction |
| Weekly active dashboards | Signals whether people return outside of incidents — the core retention risk for monitoring tools |
| Alert-to-acknowledgment time | Are alerts actually being seen/acted on, or ignored? |
| Root-cause hint usefulness (simple thumbs up/down on each alert) | Cheap signal for whether your core differentiator is actually landing |
| Free → paid conversion rate | Standard funnel health |
| Monthly churn rate (once you have paying customers) | The real test of whether this is a sustainable business, not just an interesting tool |

---

## 12. Competitive Positioning

| | PgVitals | pganalyze | pgHero | Datadog |
|---|---|---|---|---|
| Price (entry) | $39/mo/db | $149+/mo | Free | $85+/mo |
| Root-cause hints (not just metrics) | Yes, core focus | Partial | No | Partial |
| Index simulation before recommending (HypoPG) | Yes | No | No | No |
| Setup time | Target <5 min | Moderate | Fast | Moderate-high |
| App-level correlation (deploys, schema changes) | Yes | Limited | No | Yes (broader APM) |
| Postgres-specific depth | High | High | Moderate | Low (general APM) |

*(Fill in/verify competitor specifics before using this externally — treat as a working draft based on current research, not confirmed pricing/feature facts.)*

---

## 13. Go-to-Market Notes

- **Initial channel:** the dev.to incident write-up + targeted community posts (Postgres Slack, r/PostgreSQL) already planned — leads to a waitlist/landing page
- **First customers:** aim for founders/engineers in the same communities who engage with the incident post — warmer and more likely to give real feedback than cold outreach
- **Pricing page messaging:** lead with the root-cause differentiation ("not just what's wrong — which service caused it, and what to change"), not a feature checklist
- **Early feedback loop:** treat the first 10-20 customers as design partners — prioritize Phase 4-6 features based on their actual pain points over the roadmap ordering above if there's a clear signal

---

## 14. Support Model

- Solo-stage target: respond to bug reports/questions within 24 hours on business days — set this expectation explicitly on the pricing/contact page rather than leaving it undefined
- Use a lightweight shared inbox or simple ticket tool (e.g. a shared email address to start) rather than building custom support infrastructure
- Revisit formal SLA commitments only once Team-tier customers ask for them

---

## 15. Open Questions to Resolve Before Building

- [ ] Exact threshold defaults for each alert type — start conservative, make configurable per customer
- [ ] How to handle customers without `pg_stat_statements` enabled (detect + guide setup, vs. degrade gracefully) — addressed in Onboarding Flow above, finalize exact UX
- [ ] Whether to support self-hosted/on-prem Postgres (VPN/tunnel complexity) or cloud-hosted only for v1
- [x] Legal/compliance: connection strings and query text may contain sensitive data — redaction approach now defined in Security & Compliance section; finalize exact redaction implementation before storing any real customer query text
