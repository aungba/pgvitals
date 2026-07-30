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

### 2.3 Query Performance

**Data source:** `pg_stat_statements` (requires extension enabled on customer DB — document this as a setup prerequisite)

**Metrics tracked per query fingerprint:**
- Total calls, total time, mean time, max time, rows returned
- Trend over time (is mean time increasing week-over-week?)
- `%` of total DB time consumed by this query

**EXPLAIN capture (v1 — manual trigger, not automatic):**
- User can request an EXPLAIN (ANALYZE, BUFFERS) run against a sample of a slow query from the dashboard
- Parse plan JSON, flag: sequential scans on large tables, high buffer reads, nested loop joins on large row estimates

---

### 2.4 Index Advisor (Phase 5)

- Detect unused indexes: `pg_stat_user_indexes.idx_scan = 0` over a sustained observation window (e.g. 30 days), excluding indexes enforcing constraints
- Detect missing index candidates: tables with high `seq_scan` count and large `n_live_tup`, correlated with WHERE/JOIN columns extracted from `pg_stat_statements` query text
- Output: suggested `CREATE INDEX` statement + estimated impact (rough heuristic, not guaranteed)

---

### 2.5 VACUUM / Bloat Advisor (Phase 6)

- Estimate table/index bloat (standard bloat-estimation queries against `pg_class`, `pg_stats`)
- Autovacuum health: last vacuum/analyze time per table vs. dead tuple ratio
- Transaction ID wraparound risk: age of oldest transaction ID vs. `autovacuum_freeze_max_age`, with escalating alert severity as risk increases

---

### 2.6 Log Insights (Phase 6)

- Optional log shipping (customer configures Postgres log destination or uploads log files)
- Parse for: deadlocks, connection errors, checkpoint warnings, slow query log entries not captured by `pg_stat_statements` (e.g. one-off ad hoc queries)
- Surface recurring error signatures (grouped by error type/message pattern)

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
  calls, total_time_ms, mean_time_ms, max_time_ms, rows

index_recommendations
  id, monitored_db_id, table_name, recommendation_type
  (unused | missing), suggested_ddl, detected_at, dismissed
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
| Pro | $39/mo per database | Full monitoring, alerting (Slack/email), 30-day retention, index/vacuum advisors |
| Team | $99/mo per database | Everything in Pro + log insights, 90-day retention, priority support, multiple environments |

---

## 7. Build Roadmap (10-20 hrs/week pace)

| Phase | Weeks | Deliverable |
|---|---|---|
| 1 | 1-4 | Collector + session/connection monitoring + basic dashboard |
| 2 | 5-7 | Alerting engine + Slack integration + root-cause hints |
| 3 | 8-10 | Auth (Clerk), billing (Stripe), multi-tenancy |
| 4 | 11-14 | Query performance module (`pg_stat_statements`, EXPLAIN capture) |
| 5 | 15-18 | Index Advisor |
| 6 | 19-24 | VACUUM/Bloat Advisor + Log Insights |

**Sellable milestone:** end of Phase 2 (~week 7) — connection monitoring + alerting with root-cause hints is already a differentiated, chargeable product.

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

## 9. Open Questions to Resolve Before Building

- [ ] Exact threshold defaults for each alert type — start conservative, make configurable per customer
- [ ] How to handle customers without `pg_stat_statements` enabled (detect + guide setup, vs. degrade gracefully)
- [ ] Whether to support self-hosted/on-prem Postgres (VPN/tunnel complexity) or cloud-hosted only for v1
- [ ] Legal/compliance: connection strings and query text may contain sensitive data — define a data handling and redaction policy up front
