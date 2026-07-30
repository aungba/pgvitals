# Deployment Guide

How to deploy PG Vitals to production.

---

## Architecture Overview

PG Vitals consists of three components that need to be deployed:

```
┌─────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   Web (Next.js) │────▶│ Collector (Fastify)│────▶│   TimescaleDB    │
│   Port 3000     │     │   Port 3001       │     │   Port 5432      │
└─────────────────┘     │                   │────▶│                  │
                        └──────────────────┘     └──────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │   Redis (BullMQ)  │
                        │   Port 6379       │
                        └──────────────────┘
```

| Component        | Description                                                  |
| ---------------- | ------------------------------------------------------------ |
| **Web**          | Next.js 15 dashboard — serves the UI                        |
| **Collector**    | Fastify API — polls monitored PostgreSQL instances via BullMQ jobs, stores snapshots |
| **TimescaleDB**  | PostgreSQL 16 + TimescaleDB — stores all application data   |
| **Redis**        | BullMQ job queue — schedules and processes polling jobs      |

---

## Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9
- A PostgreSQL 16 / TimescaleDB instance
- A Redis instance
- A reverse proxy (Nginx, Caddy, etc.) or cloud platform

---

## 1. Environment Variables

Set these environment variables in your production environment:

| Variable               | Required | Description                              | Example                                     |
| ---------------------- | -------- | ---------------------------------------- | ------------------------------------------- |
| `DATABASE_URL`         | ✅       | TimescaleDB connection string            | `postgresql://user:pass@db-host:5432/pgvitals` |
| `REDIS_URL`            | ✅       | Redis connection string                  | `redis://redis-host:6379`                   |
| `ENCRYPTION_KEY`       | ✅       | 64-char hex key for encrypting stored connection strings | *(see below)* |
| `COLLECTOR_PORT`       | ❌       | Collector listen port (default: `3001`)  | `3001`                                       |
| `POLLING_INTERVAL_MS`  | ❌       | Polling frequency in ms (default: `10000`) | `30000`                                    |
| `NEXT_PUBLIC_API_URL`  | ✅       | Public URL of the Collector API           | `https://api.pgvitals.example.com`          |
| `NODE_ENV`             | ❌       | Set to `production` for optimized logging | `production`                                |
| `LOG_LEVEL`            | ❌       | Pino log level (default: `info`)         | `warn`                                       |

**Generate the encryption key (one-time):**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> [!CAUTION]
> The `ENCRYPTION_KEY` is used to encrypt/decrypt database connection strings stored in TimescaleDB. If you lose this key, you will need to re-register all monitored databases. **Back it up securely.**

---

## 2. Build for Production

```bash
# Install dependencies
pnpm install --frozen-lockfile

# Run database migrations
pnpm db:migrate

# Build all packages
pnpm build
```

This produces:
- `apps/web/.next/` — Next.js production build
- `apps/collector/dist/` — Compiled collector

---

## 3. Deployment Options

### Option A: Docker Compose (Recommended for VPS)

Create a `docker-compose.prod.yml`:

```yaml
services:
  timescaledb:
    image: timescale/timescaledb:latest-pg16
    restart: always
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: pgvitals
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: always
    command: redis-server --requirepass ${REDIS_PASSWORD}
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  collector:
    build:
      context: .
      dockerfile: Dockerfile.collector
    restart: always
    ports:
      - "3001:3001"
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@timescaledb:5432/pgvitals
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
      COLLECTOR_PORT: "3001"
      POLLING_INTERVAL_MS: "10000"
      NODE_ENV: production
    depends_on:
      timescaledb:
        condition: service_healthy
      redis:
        condition: service_healthy

  web:
    build:
      context: .
      dockerfile: Dockerfile.web
    restart: always
    ports:
      - "3000:3000"
    environment:
      NEXT_PUBLIC_API_URL: ${NEXT_PUBLIC_API_URL}
    depends_on:
      - collector

volumes:
  pgdata:
  redisdata:
```

**Example `Dockerfile.collector`:**

```dockerfile
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# Install dependencies
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/collector/package.json apps/collector/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile --prod

# Copy source
COPY packages/db packages/db
COPY apps/collector apps/collector
COPY tsconfig.base.json .

# Build
RUN pnpm --filter @pgvitals/collector build

EXPOSE 3001
CMD ["node", "apps/collector/dist/index.js"]
```

**Example `Dockerfile.web`:**

```dockerfile
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# Install dependencies
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile

# Copy source & build
COPY packages/db packages/db
COPY apps/web apps/web
COPY tsconfig.base.json .

RUN pnpm --filter @pgvitals/web build

EXPOSE 3000
CMD ["pnpm", "--filter", "@pgvitals/web", "start"]
```

**Deploy:**

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

---

### Option B: Manual VPS / Bare Metal

1. **Provision infrastructure:**
   - TimescaleDB instance (or standard PostgreSQL 16)
   - Redis instance
   - Node.js 20 runtime

2. **Clone and build:**

   ```bash
   git clone <repo-url> /opt/pgvitals
   cd /opt/pgvitals
   pnpm install --frozen-lockfile
   pnpm db:migrate
   pnpm build
   ```

3. **Run with a process manager** (e.g., PM2):

   ```bash
   # Install PM2 globally
   npm install -g pm2

   # Start the collector
   pm2 start apps/collector/dist/index.js --name pgvitals-collector

   # Start the web app
   cd apps/web && pm2 start npm --name pgvitals-web -- start
   cd ../..

   # Save and enable startup
   pm2 save
   pm2 startup
   ```

4. **Configure Nginx as reverse proxy:**

   ```nginx
   # /etc/nginx/sites-available/pgvitals
   server {
       listen 80;
       server_name pgvitals.example.com;

       location / {
           proxy_pass http://127.0.0.1:3000;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }

   server {
       listen 80;
       server_name api.pgvitals.example.com;

       location / {
           proxy_pass http://127.0.0.1:3001;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```

   Enable with SSL via Certbot:

   ```bash
   sudo ln -s /etc/nginx/sites-available/pgvitals /etc/nginx/sites-enabled/
   sudo certbot --nginx -d pgvitals.example.com -d api.pgvitals.example.com
   sudo nginx -t && sudo systemctl reload nginx
   ```

---

### Option C: Cloud Platforms

#### Vercel (Web) + Railway/Render (Collector)

| Component    | Platform            | Notes                                            |
| ------------ | ------------------- | ------------------------------------------------ |
| **Web**      | Vercel              | Connect repo, set root to `apps/web`             |
| **Collector**| Railway or Render   | Deploy as Node.js service from `apps/collector`  |
| **TimescaleDB** | Timescale Cloud  | Managed TimescaleDB                              |
| **Redis**    | Upstash or Redis Cloud | Managed Redis                                 |

**Vercel setup for the web app:**
1. Connect your repo to Vercel
2. Set **Root Directory** to `apps/web`
3. Set **Build Command** to `cd ../.. && pnpm install && pnpm --filter @pgvitals/web build`
4. Set **Output Directory** to `.next`
5. Add environment variable: `NEXT_PUBLIC_API_URL` = your collector URL

**Railway/Render setup for the collector:**
1. Set **Root Directory** to `apps/collector`
2. Set **Build Command** to `cd ../.. && pnpm install && pnpm --filter @pgvitals/collector build`
3. Set **Start Command** to `node dist/index.js`
4. Add all required environment variables

---

## 4. Database Backup Strategy

> [!WARNING]
> Always set up automated backups for your TimescaleDB instance before going to production.

**Using `pg_dump`:**

```bash
# Full backup
pg_dump -Fc -U pgvitals -h db-host pgvitals > pgvitals_$(date +%Y%m%d).dump

# Restore
pg_restore -U pgvitals -h db-host -d pgvitals pgvitals_20240101.dump
```

**Automate with cron:**

```bash
# Daily backup at 2 AM
0 2 * * * pg_dump -Fc -U pgvitals -h db-host pgvitals > /backups/pgvitals_$(date +\%Y\%m\%d).dump
```

---

## 5. Security Checklist

- [ ] **HTTPS everywhere** — Use TLS for web, API, and database connections
- [ ] **Strong `ENCRYPTION_KEY`** — 32 random bytes, stored in a secrets manager
- [ ] **Database credentials** — Use strong passwords, don't use defaults
- [ ] **Redis authentication** — Set `requirepass` in production
- [ ] **Network isolation** — TimescaleDB and Redis should not be publicly accessible
- [ ] **CORS configuration** — Restrict origins in the collector's CORS config for production
- [ ] **Rate limiting** — Add rate limiting to the collector API
- [ ] **Firewall rules** — Only expose ports 80/443 publicly

---

## 6. Monitoring the Monitor

Keep an eye on PG Vitals itself:

| What to monitor                   | How                                              |
| --------------------------------- | ------------------------------------------------ |
| Collector health                  | `GET /health` returns `{ status: "ok" }`        |
| BullMQ job queue                  | Check Redis for stuck/failed jobs                |
| TimescaleDB disk usage            | Monitor the `pgdata` volume                      |
| Web app availability              | HTTP health check on port 3000                   |
| Error logs                        | Collector outputs structured JSON logs (Pino)    |

---

## 7. Updating

```bash
# Pull latest code
git pull origin main

# Install any new dependencies
pnpm install --frozen-lockfile

# Run new migrations (if any)
pnpm db:migrate

# Rebuild
pnpm build

# Restart services
pm2 restart all
# or
docker compose -f docker-compose.prod.yml up -d --build
```
