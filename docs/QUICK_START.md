# PG Vitals — Quick Start Guide

Welcome to **PG Vitals**! This guide walks you through connecting your PostgreSQL database to PG Vitals SaaS, verifying read-only permissions, and exploring live diagnostic vitals in minutes.

---

## ⚡ 3-Step Setup Overview

```mermaid
flowchart LR
    Step1["1. Create Read-Only User\n(Target Database)"] --> Step2["2. Register in Dashboard\n(Paste Connection URI)"]
    Step2 --> Step3["3. Gain Live Vitals\n(Locks, Queries, Bloat, Alerts)"]
```

---

## Step 1: Create a Read-Only Monitoring User

Connect to your target PostgreSQL database (AWS RDS, Aurora, Supabase, Neon, GCP Cloud SQL, or self-hosted) as a superuser (e.g. `postgres`) and run the setup script:

### For PostgreSQL 14, 15, 16, 17, 18+ (Recommended)
```sql
-- 1. Create a dedicated monitoring user with connection ceiling
CREATE USER pgvitals_monitor WITH PASSWORD 'your_secure_password' CONNECTION LIMIT 5;

-- 2. Grant statistics and catalog read permissions
GRANT CONNECT ON DATABASE your_database TO pgvitals_monitor;
GRANT pg_read_all_stats TO pgvitals_monitor;
GRANT pg_read_all_data TO pgvitals_monitor;

-- 3. Enable statement-level query performance tracking
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- 4. (Optional) Enable zero-risk hypothetical index simulation
CREATE EXTENSION IF NOT EXISTS hypopg;
```

### For PostgreSQL 10, 11, 12, 13 (Legacy)
```sql
CREATE USER pgvitals_monitor WITH PASSWORD 'your_secure_password' CONNECTION LIMIT 5;
GRANT CONNECT ON DATABASE your_database TO pgvitals_monitor;
GRANT pg_read_all_stats TO pgvitals_monitor;
GRANT USAGE ON SCHEMA public TO pgvitals_monitor;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO pgvitals_monitor;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO pgvitals_monitor;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

> [!TIP]
> **Zero Customer Data Access Guarantee**: The `pg_read_all_stats` role only grants visibility into PostgreSQL internal engine catalogs (`pg_stat_activity`, `pg_stat_statements`, `pg_locks`). PG Vitals never reads or stores your customer table data.

---

## Step 2: Register Database in the PG Vitals Dashboard

1. Sign in to your PG Vitals dashboard at **[https://pgvitals.dev](https://pgvitals.dev)** (or your local dashboard).
2. Click **"Add Database"** in the top navigation bar or go to `/onboarding`.
3. Enter a friendly name (e.g., `Production US-East Primary`) and select the environment (`production`, `staging`, `development`).
4. Paste your PostgreSQL connection URI:
   ```text
   postgresql://pgvitals_monitor:your_secure_password@db.example.com:5432/your_database?sslmode=require
   ```
5. Click **"Test Connection"** to verify latency, PostgreSQL version, and extension availability (`pg_stat_statements`, `hypopg`).
6. Click **"Save & Start Monitoring"**.

---

## Step 3: Explore Live Vitals & Actionable Insights

Once registered, your dashboard begins streaming live telemetry:

| Feature | Location | What You'll See |
| :--- | :--- | :--- |
| **Live Sessions & Lock Trees** | `/databases/[id]` | Real-time connection gauges, active vs. idle in transaction states, root blocker PID identification with 1-click `pg_terminate_backend`, and time-travel replay scrubbers. |
| **Root Cause Hints** | `/databases/[id]/hints` | 7 automated heuristic diagnostic rules detecting connection hogs, lock queue storms, and idle transactions. |
| **Query Performance & P95/P99** | `/databases/[id]/queries` | Statement-aware advice for INSERT/UPDATE/DELETE/SELECT, covering index recommendations (`INCLUDE`), disk spill warnings (`work_mem`), and I/O stall classification. |
| **Index Advisor & HypoPG** | `/databases/[id]/indexes` | Scan for unused, invalid (`indisvalid = false`), redundant, and bloated indexes, with zero-risk HypoPG planner cost simulation before creating physical indexes. |
| **EXPLAIN Plan Regression** | `/databases/[id]/plans` | Side-by-side baseline vs. regressed plan diffs, cost surge warnings, and sequential scan regression alerts. |
| **VACUUM & Storage Health** | `/databases/[id]/health` | Dead tuple ratios, XID wraparound emergency headroom, HOT update efficiency tuning (`fillfactor = 85`), and autovacuum worker starvation detection. |
| **Alerts & Slack ChatOps** | `/databases/[id]/alerts` | Configure Slack webhooks, PagerDuty Events v2, Teams, or Email, with interactive in-channel ⚡ Terminate Blocker actions. |

---

## Next Steps

- 📖 Read the full [End User Manual & Operational Guide](USER_MANUAL.md)
- ❓ Check out the [Frequently Asked Questions (FAQ)](FAQ.md)
- 🚢 Review the [Production Deployment Guide](../deployment_guide.md)
