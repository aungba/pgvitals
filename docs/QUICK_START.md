# PG Vitals — Quick Start Guide

Welcome to **PG Vitals**! This guide will walk you through setting up PG Vitals locally, configuring your environment, running database migrations, and registering your first target PostgreSQL database for real-time monitoring and automated diagnostics.

---

## Prerequisites

Before starting, ensure you have the following installed on your machine:

| Tool | Required Version | Verification Command |
| :--- | :--- | :--- |
| **Node.js** | $\ge 20.0.0$ | `node -v` |
| **pnpm** | $\ge 9.0.0$ | `pnpm -v` |
| **Docker** | Latest | `docker --version` |
| **Docker Compose** | v2+ | `docker compose version` |

> [!TIP]
> If you have Node.js $\ge 20$, you can enable `pnpm` instantly via:
> ```bash
> corepack enable && corepack prepare pnpm@latest --activate
> ```

---

## Step 1: Clone and Install Dependencies

```bash
git clone <repository-url> pgvitals
cd pgvitals
pnpm install
```

---

## Step 2: Start Infrastructure Services

PG Vitals uses **TimescaleDB** (PostgreSQL 16 with time-series extensions) for storing historical metrics and **Redis** for background job queues:

```bash
docker compose up -d
```

Verify that both containers are running and healthy:

```bash
docker compose ps
```

*Default Container Ports:*
- **TimescaleDB**: `localhost:5432` (`user: pgvitals`, `password: pgvitals_dev`, `database: pgvitals`)
- **Redis**: `localhost:6379`

---

## Step 3: Configure Environment Variables

1. Copy the example `.env` file to your root directory:
   ```bash
   cp .env.example .env
   ```

2. Generate a secure 32-byte (64-character hex) encryption key for encrypting monitored database connection credentials:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

3. Update the `.env` file with the generated key:
   ```ini
   DATABASE_URL=postgresql://pgvitals:pgvitals_dev@localhost:5432/pgvitals
   REDIS_URL=redis://localhost:6379
   COLLECTOR_PORT=3001
   POLLING_INTERVAL_MS=10000
   NEXT_PUBLIC_API_URL=http://localhost:3001
   ENCRYPTION_KEY=<paste_your_64_character_hex_key_here>
   ```

4. Propagate the environment variables to the sub-packages:
   ```bash
   cp .env apps/collector/.env
   cp .env packages/db/.env
   ```

5. Create `apps/web/.env.local` for the frontend:
   ```ini
   NEXT_PUBLIC_API_URL=http://localhost:3001
   ```

---

## Step 4: Run Database Migrations & (Optional) Seed

Apply the Drizzle ORM database migrations to create all necessary hypertable schemas and indexes in TimescaleDB:

```bash
pnpm db:migrate
```

*(Optional)* Seed sample database instances, metrics, and alerts to explore the dashboard immediately without connecting a live database:

```bash
pnpm db:seed
```

---

## Step 5: Start the Development Servers

Start both the **Collector API** (port `3001`) and the **Next.js Web Dashboard** (port `3000`) concurrently:

```bash
pnpm dev
```

Alternatively, run them in separate terminal windows:
```bash
# Terminal 1 — Fastify Collector & Polling Scheduler
pnpm dev:collector

# Terminal 2 — Next.js Web Frontend
pnpm dev:web
```

---

## Step 6: Connect a Target PostgreSQL Database

To monitor a target PostgreSQL database, create a lightweight read-only user on the database you wish to monitor.

### 1. Run Setup SQL on Your Monitored Database

Connect to your target PostgreSQL database as a superuser (e.g. `postgres`) and run:

```sql
-- Create read-only user with connection limit
CREATE USER pgvitals_monitor WITH PASSWORD 'choose_a_strong_password' CONNECTION LIMIT 5;

-- Grant permissions for PostgreSQL 14, 15, 16, 17, 18+
GRANT CONNECT ON DATABASE your_database_name TO pgvitals_monitor;
GRANT pg_read_all_stats TO pgvitals_monitor;
GRANT pg_read_all_data TO pgvitals_monitor;

-- Enable pg_stat_statements (for query performance and execution statistics)
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- (Optional) Enable HypoPG for hypothetical zero-risk index simulation
CREATE EXTENSION IF NOT EXISTS hypopg;
```

> [!NOTE]
> For PostgreSQL 10–13, see our [Database Monitoring User Setup Guide](../READONLY_USER_SETUP.md) for legacy permission grants.

### 2. Register Database in PG Vitals

1. Open your browser and navigate to **[http://localhost:3000](http://localhost:3000)**.
2. Click **"Add Database"** in the top navigation bar or go to `/onboarding`.
3. Provide a friendly name and your connection string:
   ```text
   postgresql://pgvitals_monitor:choose_a_strong_password@your-db-host.com:5432/your_database_name?sslmode=require
   ```
4. Click **"Test Connection"** to verify latency, PostgreSQL version, and extension availability (`pg_stat_statements`, `hypopg`, `pgbouncer`).
5. Click **"Save & Start Monitoring"**.

---

## Step 7: Explore Key Features

Once registered, PG Vitals begins streaming live metrics:

- **Live Sessions & Lock Tree** (`/databases/[id]`): View live active connections, session durations, and detect root blocker queries with 1-click termination.
- **Root Cause Hints & Audit Logs** (`/databases/[id]/hints`): Automated heuristic rules flagging connection hogs, idle in transactions, and cascading lock storms.
- **Query Performance & Tail Latencies** (`/databases/[id]/queries`): Track top time-consuming queries, disk vs. CPU I/O stalls, and P95/P99 latency variance.
- **Index Advisor & HypoPG Simulation** (`/databases/[id]/indexes`): Detect unused, invalid (`indisvalid = false`), redundant, and bloated indexes with instant HypoPG simulation.
- **EXPLAIN Plan Regression Visualizer** (`/databases/[id]/plans`): Side-by-side execution plan comparison and cost jump detection.
- **VACUUM & Storage Health** (`/databases/[id]/health`): Dead tuple ratios, XID wraparound headroom, HOT update efficiency, and replication slot status.
- **Developer API & Swagger UI**: Explore the interactive OpenAPI explorer at **[http://localhost:3001/documentation](http://localhost:3001/documentation)**.

---

## Common CLI Commands

| Command | Purpose |
| :--- | :--- |
| `pnpm dev` | Launch collector and web dashboard concurrently |
| `pnpm dev:collector` | Run Fastify collector backend with hot-reloading |
| `pnpm dev:web` | Run Next.js dashboard with hot-reloading |
| `pnpm db:migrate` | Execute pending database migrations |
| `pnpm db:seed` | Seed development sample data |
| `pnpm build` | Compile all monorepo packages for production |
| `pnpm test` | Run test suite with Vitest |
| `pnpm typecheck` | Run TypeScript type validation across monorepo |
| `pnpm lint` | Run ESLint across monorepo |

---

## Next Steps

- 📖 Read the full [End User Manual & Operational Guide](USER_MANUAL.md)
- ❓ Check out the [Frequently Asked Questions (FAQ)](FAQ.md)
- 🔐 Set up [Clerk Authentication](clerk_auth_setup.md) for multi-tenant team access
- 🚢 Review the [Production Deployment Guide](../deployment_guide.md)
