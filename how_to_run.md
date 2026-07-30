# How to Run PG Vitals

Quick guide to get PG Vitals running locally for development.

---

## Prerequisites

| Tool        | Version | Check                    |
| ----------- | ------- | ------------------------ |
| **Node.js** | ≥ 20    | `node -v`                |
| **pnpm**    | ≥ 9     | `pnpm -v`                |
| **Docker**  | Latest  | `docker --version`       |
| **Docker Compose** | v2+ | `docker compose version` |

> [!TIP]
> Install pnpm via `corepack enable && corepack prepare pnpm@latest --activate` if you have Node ≥ 20.

---

## 1. Clone & Install Dependencies

```bash
git clone <repo-url> pgvitals
cd pgvitals
pnpm install
```

---

## 2. Start Infrastructure (TimescaleDB + Redis)

PG Vitals uses **TimescaleDB** (PostgreSQL 16 + time-series extensions) and **Redis** (for BullMQ job queues).

```bash
docker compose up -d
```

This starts:
- **TimescaleDB** on `localhost:5432` (user: `pgvitals`, password: `pgvitals_dev`, db: `pgvitals`)
- **Redis** on `localhost:6379`

Verify they're healthy:

```bash
docker compose ps
```

---

## 3. Configure Environment Variables

Copy the example env file and fill in the values:

```bash
cp .env.example .env
```

**Required variables:**

| Variable               | Default / Example                                           | Description                        |
| ---------------------- | ----------------------------------------------------------- | ---------------------------------- |
| `DATABASE_URL`         | `postgresql://pgvitals:pgvitals_dev@localhost:5432/pgvitals` | TimescaleDB connection string      |
| `REDIS_URL`            | `redis://localhost:6379`                                     | Redis connection string            |
| `COLLECTOR_PORT`       | `3001`                                                       | Port the Collector API listens on  |
| `POLLING_INTERVAL_MS`  | `10000`                                                      | How often to poll monitored DBs    |
| `NEXT_PUBLIC_API_URL`  | `http://localhost:3001`                                      | Collector URL for the web frontend |
| `ENCRYPTION_KEY`       | *(generate, see below)*                                      | 64-char hex key for encrypting connection strings |

**Generate an encryption key:**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Paste the output into `ENCRYPTION_KEY` in your `.env` file.

> [!IMPORTANT]
> The `.env` file at the project root is symlinked/copied into both `apps/collector/.env` and `packages/db/.env`. If they don't exist, copy it manually:
> ```bash
> cp .env apps/collector/.env
> cp .env packages/db/.env
> ```

The web app uses `apps/web/.env.local` with:
```
NEXT_PUBLIC_API_URL=http://localhost:3001
```

---

## 4. Run Database Migrations

Generate and apply the Drizzle schema migrations:

```bash
pnpm db:migrate
```

This creates all required tables in TimescaleDB (databases, connection snapshots, hints, etc.).

---

## 5. (Optional) Seed Sample Data

Populate the database with sample data for development:

```bash
pnpm db:seed
```

---

## 6. Start the Development Servers

### Option A: Start everything at once

```bash
pnpm dev
```

This starts both the **Collector** (port 3001) and **Web** (port 3000) in parallel.

### Option B: Start individually

```bash
# Terminal 1 — Collector API + background polling
pnpm dev:collector

# Terminal 2 — Next.js web dashboard
pnpm dev:web
```

---

## 7. Open the Dashboard

Navigate to **[http://localhost:3000](http://localhost:3000)** in your browser.

- **Collector API** health check: [http://localhost:3001/health](http://localhost:3001/health)
- **Drizzle Studio** (DB browser): `pnpm --filter @pgvitals/db studio`

---

## Common Commands Reference

| Command                | Description                                  |
| ---------------------- | -------------------------------------------- |
| `pnpm dev`             | Start collector + web in parallel            |
| `pnpm dev:collector`   | Start collector only                         |
| `pnpm dev:web`         | Start web only                               |
| `pnpm db:generate`     | Generate Drizzle migration files             |
| `pnpm db:migrate`      | Apply pending migrations                     |
| `pnpm db:seed`         | Seed the database with sample data           |
| `pnpm build`           | Build all packages for production            |
| `pnpm lint`            | Run linting across all packages              |
| `pnpm typecheck`       | Type-check all packages                      |

---

## Stopping Everything

```bash
# Stop dev servers
Ctrl+C

# Stop Docker containers
docker compose down

# Stop containers AND delete data volumes
docker compose down -v
```

---

## Troubleshooting

| Problem                             | Solution                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------ |
| `Missing required environment variable: DATABASE_URL` | Ensure `.env` exists in `apps/collector/` and `packages/db/` — copy from root `.env` |
| `ECONNREFUSED localhost:5432`       | Run `docker compose up -d` and wait for TimescaleDB to be healthy        |
| `ECONNREFUSED localhost:6379`       | Run `docker compose up -d` and check Redis is running                    |
| Web dashboard shows API error       | Ensure the collector is running on port 3001                             |
| Port already in use                 | Kill the process on that port: `lsof -ti :3001 \| xargs kill -9`        |
