# PG Vitals — Frequently Asked Questions (FAQ)

Comprehensive answers to common questions about PG Vitals architecture, performance overhead, security, configuration, and troubleshooting.

---

## Table of Contents

1. [General & Architecture](#1-general--architecture)
2. [Performance & Overhead](#2-performance--overhead)
3. [Security & Credentials](#3-security--credentials)
4. [Target Database Compatibility](#4-target-database-compatibility)
5. [Extensions & Advanced Features](#5-extensions--advanced-features)
6. [Alerting & Integrations](#6-alerting--integrations)
7. [Troubleshooting & Common Errors](#7-troubleshooting--common-errors)

---

## 1. General & Architecture

### What is PG Vitals?
PG Vitals is a real-time PostgreSQL performance monitoring, root-cause diagnostic, and query optimization platform. It combines live connection tracking, lock tree analysis, query latency percentiles (P95/P99), automated index recommendations with HypoPG hypothetical simulation, autovacuum starvation detection, and Slack ChatOps remediation.

### How does PG Vitals differ from tools like pgAdmin or Datadog?
- **vs. pgAdmin / DBeaver**: While pgAdmin is a query editor and management tool, PG Vitals is an automated diagnostic and time-series telemetry platform. It continuously watches query plans, bloat, lock contention, and replication lag without manual inspection.
- **vs. General APMs (Datadog, New Relic)**: General APMs focus on application-tier spans and basic host CPU/RAM metrics. PG Vitals is purpose-built for deep PostgreSQL internals—detecting circular lock waits, B-Tree index bloat, Transaction ID (XID) wraparound, HOT update efficiency, checkpoint fsync stalls, and generating zero-downtime `CONCURRENTLY` DDL scripts.

### What is the architecture of PG Vitals?
PG Vitals is structured as a TypeScript monorepo managed with `pnpm`:
- **`apps/collector`**: Fastify-based ingestion and diagnostic engine with BullMQ job queues, SSE real-time broadcasting, and OpenAPI 3.1 documentation.
- **`apps/web`**: Next.js 14 App Router dashboard with Tailwind CSS, Lucide icons, and Recharts.
- **`packages/db`**: Drizzle ORM schema definitions and database client migrations targeting TimescaleDB.
- **Infrastructure**: TimescaleDB (time-series hypertable storage) and Redis (job queue & rate limiting).

---

## 2. Performance & Overhead

### What is the performance impact on monitored databases?
PG Vitals is engineered with minimal target overhead ($< 0.5\%$ CPU on monitored instances):
- **Read-Only Connections**: All diagnostic queries execute with `SET default_transaction_read_only = on` and strict statement timeouts ($3\text{s}$).
- **Connection Caching with LRU**: Monitored connections are pooled via an LRU cache with a 3-minute idle eviction policy, preventing connection churn.
- **Strict Connection Limits**: The monitoring user is constrained to $3\text{–}5$ connections.
- **$O(1)$ In-Memory SSE Hub**: The collector uses an internal `sessionBroadcaster` event hub. Even if 100 browser tabs are viewing the live dashboard, only a single lightweight poll occurs against the target database per interval.

### How frequently does PG Vitals poll the database?
- **Connection & Session Metrics**: Every $10$ seconds (configurable via `POLLING_INTERVAL_MS`).
- **Query Statistics (`pg_stat_statements`)**: Every $5$ minutes (configurable via `QUERY_STATS_INTERVAL_MS`).
- **Index & Bloat Analysis**: Background intervals or on-demand via the dashboard.

---

## 3. Security & Credentials

### What permissions does the monitoring user need?
PG Vitals only requires read access to statistics views:
- `pg_read_all_stats` and `pg_read_all_data` (PostgreSQL 14+)
- `CONNECT ON DATABASE`
- `pg_stat_statements` access

PG Vitals **does not** require superuser permissions for monitoring. (Superuser or table ownership is only needed if you explicitly execute remote session terminations or HypoPG simulations).

### How are connection strings and passwords stored?
Connection strings are encrypted at rest using **AES-256-GCM** authenticated envelope encryption (`v1:iv:authTag:ciphertext`). The encryption key is derived from the 64-character hex `ENCRYPTION_KEY` environment variable or pluggable KMS providers (AWS KMS, GCP KMS, HashiCorp Vault).

### Does PG Vitals store sensitive query parameters?
No. `pg_stat_statements` automatically normalizes queries and replaces literals with placeholders (`$1`, `$2`). Furthermore, PG Vitals runs a query sanitization pipeline that strips inline SQL comments (`-- password=...`, `/* secret */`), nested JSON payloads, and array literals prior to saving snapshot data.

---

## 4. Target Database Compatibility

### Which PostgreSQL versions are supported?
PG Vitals supports **PostgreSQL 10, 11, 12, 13, 14, 15, 16, 17, and 18+**. Version-specific catalog differences (e.g. `pg_stat_wal` in PG 14+, LSN functions, `pg_read_all_data` roles) are handled adaptively by the collector.

### Which cloud database providers are supported?
PG Vitals works with any standard PostgreSQL endpoint, including:
- **AWS RDS & AWS Aurora PostgreSQL**
- **Google Cloud SQL & AlloyDB**
- **Azure Database for PostgreSQL (Flexible Server)**
- **Supabase**
- **Neon Serverless Postgres**
- **Timescale Cloud**
- **Self-Hosted / Bare-Metal / Docker PostgreSQL**

---

## 5. Extensions & Advanced Features

### What is `pg_stat_statements` and do I need it?
`pg_stat_statements` is a standard PostgreSQL contrib module that tracks execution counts, total time, and block I/O per normalized SQL statement. While PG Vitals can monitor active connections and lock trees without it, `pg_stat_statements` is **strongly recommended** for query performance analytics, P95/P99 latency calculations, and index recommendations.

To enable it:
```ini
# postgresql.conf
shared_preload_libraries = 'pg_stat_statements'
pg_stat_statements.track = all
```
```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

### How does HypoPG simulation work?
[HypoPG](https://hypopg.readthedocs.io/) is an open-source extension that allows creating hypothetical, in-memory indexes that consume no disk space and do not perform table scans. PG Vitals uses HypoPG to run `EXPLAIN` simulations, proving whether an index will improve query performance before you build it in production.

### Can PG Vitals monitor PgBouncer connection pools?
Yes! If your connection string points to PgBouncer or includes port 6432, PG Vitals queries `SHOW POOLS` and `SHOW CLIENTS` to track client wait queues, server active connections, and pool exhaustion risks.

---

## 6. Alerting & Integrations

### Which alert channels are supported?
- **Slack**: Webhooks with interactive Block Kit cards and 1-click **⚡ Terminate Blocker** buttons.
- **PagerDuty**: Events API v2 integration for on-call escalation.
- **Microsoft Teams**: Office 365 / Adaptive Card webhooks.
- **Email (SMTP)**: HTML incident notifications with diagnostic context.
- **Custom Webhooks**: JSON POST payloads with HMAC-SHA256 signature verification.

### How does the Slack Remote Remediation work?
When a critical lock storm or long-running blocker is detected, PG Vitals posts a message with a "Terminate Blocker" button. An authorized engineer can click the button directly in Slack; PG Vitals verifies the Slack HMAC signature and executes `SELECT pg_terminate_backend(pid)` safely, notifying the channel of the action.

---

## 7. Troubleshooting & Common Errors

### Error: `ECONNREFUSED localhost:5432` or `localhost:6379`
- **Cause**: TimescaleDB or Redis Docker containers are not running.
- **Fix**: Run `docker compose up -d` and check status with `docker compose ps`.

### Error: `Missing required environment variable: DATABASE_URL`
- **Cause**: Sub-packages cannot find the `.env` file.
- **Fix**: Copy root `.env` to both `apps/collector/.env` and `packages/db/.env`:
  ```bash
  cp .env apps/collector/.env
  cp .env packages/db/.env
  ```

### Error: `relation "pg_stat_statements" does not exist`
- **Cause**: The extension has not been enabled on the monitored database.
- **Fix**: Connect as superuser and run `CREATE EXTENSION IF NOT EXISTS pg_stat_statements;`. If an error occurs, ensure `pg_stat_statements` is added to `shared_preload_libraries` in `postgresql.conf` and the database server is restarted.

### Dashboard shows "No Query Plan Available"
- **Cause**: The query contains non-deterministic functions, relies on temporary tables, or the user lacks permission to run `EXPLAIN` on that relation.
- **Fix**: Verify that the monitoring user has `GRANT SELECT` or `pg_read_all_data` on the schema.

### How do I reset development data or recreate hypertables?
```bash
# Stop containers and wipe volumes
docker compose down -v

# Start fresh containers
docker compose up -d

# Run migrations and seed
pnpm db:migrate
pnpm db:seed
```
