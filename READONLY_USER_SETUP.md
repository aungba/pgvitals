# Database Monitoring User Setup Guide

PG Vitals requires a **read-only monitoring user** on the target database to collect metrics (query stats, locks, replication lag, table bloat, connection counts, etc.). It does not write to or modify your target database.

---

## SQL Setup Scripts

### Option A: PostgreSQL 14, 15, 16, 17, or 18

Run the following SQL as a superuser (e.g. `postgres`) on your target database:

```sql
-- Create read-only user with a strict connection limit (e.g. 5 connections)
CREATE USER pgvitals_monitor WITH PASSWORD 'your_secure_password' CONNECTION LIMIT 5;

GRANT CONNECT ON DATABASE your_database_name TO pgvitals_monitor;
GRANT pg_read_all_stats TO pgvitals_monitor;
GRANT pg_read_all_data TO pgvitals_monitor;
```

---

### Option B: PostgreSQL 10, 11, 12, or 13

Run the following SQL as a superuser (e.g. `postgres`) on your target database:

```sql
-- Create read-only user with a strict connection limit (e.g. 5 connections)
CREATE USER pgvitals_monitor WITH PASSWORD 'your_secure_password' CONNECTION LIMIT 5;

GRANT CONNECT ON DATABASE your_database_name TO pgvitals_monitor;
GRANT pg_read_all_stats TO pgvitals_monitor;
GRANT USAGE ON SCHEMA public TO pgvitals_monitor;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO pgvitals_monitor;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO pgvitals_monitor;
```

---

## Restricting / Modifying Connection Limit

To limit or update the connection limit on an existing user:

```sql
-- Set connection limit to 5
ALTER ROLE pgvitals_monitor CONNECTION LIMIT 5;
```

*Note: A connection limit of **3 to 5** is recommended for PG Vitals collector background jobs.*

---

## Required Extension: `pg_stat_statements`

To track slow queries, query performance, and query execution plans, enable `pg_stat_statements`:

1. Ensure `pg_stat_statements` is added to `shared_preload_libraries` in your `postgresql.conf`:
   ```ini
   shared_preload_libraries = 'pg_stat_statements'
   pg_stat_statements.track = all
   ```
2. Enable the extension on your target database:
   ```sql
   CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
   ```

---

## Recommended: Query Text Size (`track_activity_query_size`)

By default, PostgreSQL truncates queries in `pg_stat_statements` at 1,024 bytes. For long queries or large CTEs, this can cut queries off mid-statement and prevent execution plan analysis (`EXPLAIN`).

To ensure complete query texts are captured, increase `track_activity_query_size` in `postgresql.conf`:

```ini
track_activity_query_size = 16384  # Requires server restart
```

---

## Note on `EXPLAIN` and Read-Only Users

In PostgreSQL, running `EXPLAIN` on an `INSERT`, `UPDATE`, or `DELETE` statement requires table modification permissions (`INSERT`/`UPDATE`/`DELETE`), even when not executing the statement (`ANALYZE` is disabled).

Because `pgvitals_monitor` is a read-only role, PG Vitals automated plan regression analysis focuses exclusively on `SELECT` queries and read-only CTEs to prevent permission errors.
