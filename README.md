# PG Vitals — PostgreSQL Performance & Diagnostic Platform

<div align="center">

**Real-time PostgreSQL performance telemetry, root-cause diagnostics, index simulation, and automated remediation.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-14-black.svg)](https://nextjs.org/)
[![Fastify](https://img.shields.io/badge/Fastify-v4-green.svg)](https://fastify.dev/)
[![TimescaleDB](https://img.shields.io/badge/TimescaleDB-PostgreSQL%2016-orange.svg)](https://www.timescale.com/)
[![Drizzle ORM](https://img.shields.io/badge/Drizzle_ORM-orange.svg)](https://orm.drizzle.team/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

---

## ⚡ Highlights & Key Capabilities

- **🔴 Real-Time Session Monitoring & Time-Travel Replay**: Live active connections, radial utilization gauges, Server-Sent Events (SSE) streaming, and step-by-step time-travel session scrubbers.
- **🔒 Lock Tree Analysis & 1-Click Blocker Termination**: Instant identification of root blocker sessions and cascading lock storm sentinels with safe `pg_terminate_backend` execution.
- **⚡ Query Optimization & Tail Latencies (P95/P99)**: Continuous `pg_stat_statements` delta tracking, log-normal P95/P99 latency modeling, and disk vs. CPU I/O stall classification (`track_io_timing`).
- **💡 Index Advisor & HypoPG Hypothetical Simulation**: Scan for unused, invalid (`indisvalid = false`), redundant, and bloated indexes, with zero-risk in-memory query planner simulation using HypoPG before creating physical indexes.
- **🔍 EXPLAIN Plan Regression Visualizer**: Multi-factor cost change alerts, dropped index detection, and side-by-side visual diffs comparing baseline vs. regressed query execution trees.
- **🧹 VACUUM & Storage Health Sentinel**: Real-time table bloat tracking, Transaction ID (XID) wraparound monitors, Heap-Only Tuple (HOT) update ratio tuners, and autovacuum worker starvation guards.
- **📡 Multi-Channel Alerting & Slack ChatOps**: Instant alerting across Slack, PagerDuty, Microsoft Teams, Email, and Webhooks, with interactive in-channel blocker termination cards.
- **🛡️ Minimal Target Database Overhead**: Non-intrusive read-only transactions, LRU connection pooling with 3-minute idle eviction, query comment/PII redaction, and AES-256-GCM envelope encryption.

---

## 🚀 Quick Start (in 3 Minutes)

### 1. Start Infrastructure
```bash
# Start TimescaleDB & Redis
docker compose up -d
```

### 2. Configure Environment & Migrate
```bash
# Copy and configure environment variables
cp .env.example .env

# Generate encryption key for database connection strings
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# (Paste the generated 64-char key into ENCRYPTION_KEY in .env)

# Propagate env and apply database migrations
cp .env apps/collector/.env && cp .env packages/db/.env
pnpm install
pnpm db:migrate
pnpm db:seed # (Optional) Seed sample data
```

### 3. Launch Development Servers
```bash
pnpm dev
```
- **Web Dashboard**: [http://localhost:3000](http://localhost:3000)
- **Collector API & OpenAPI Swagger Docs**: [http://localhost:3001/documentation](http://localhost:3001/documentation)

👉 *For full step-by-step instructions, see the [Quick Start Guide](docs/QUICK_START.md).*

---

## 📖 Documentation Directory

Explore the complete PG Vitals documentation suite:

| Document | Description |
| :--- | :--- |
| 🚀 **[Quick Start Guide](docs/QUICK_START.md)** | Step-by-step setup, Docker infrastructure, and initial database registration. |
| ❓ **[Frequently Asked Questions (FAQ)](docs/FAQ.md)** | Answers on architecture, overhead, security, supported cloud providers, and debugging. |
| 📚 **[Documentation Master Hub](docs/DOCUMENTATION.md)** | Central index of all guides, architecture docs, and technical references. |
| 📖 **[User Manual & Operations Guide](docs/USER_MANUAL.md)** | Deep dive into every feature: lock trees, index advisor, HypoPG, EXPLAIN regression diffs, and VACUUM health. |
| 🏗️ **[System Architecture](docs/ARCHITECTURE.md)** | Technical design: monorepo layout, TimescaleDB hypertables, BullMQ queues, and in-memory SSE broadcaster. |
| 🔌 **[API Reference](docs/API_REFERENCE.md)** | Fastify REST endpoints, SSE streams, payload schemas, and OpenAPI 3.1 documentation. |
| 🛡️ **[Read-Only User Setup Guide](READONLY_USER_SETUP.md)** | Copy-paste SQL scripts to create the `pgvitals_monitor` role on PostgreSQL 10–18+. |
| 🔐 **[Clerk Authentication Setup](docs/clerk_auth_setup.md)** | Guide for enabling Clerk multi-tenant authentication, organizations, and user roles. |
| 🚢 **[Production Deployment Guide](deployment_guide.md)** | Comprehensive production guide for Linux/PM2, Nginx reverse proxy, and Jenkins CI/CD pipeline. |

---

## 🛠️ Monorepo Structure & Commands

```text
pgvitals/
├── apps/
│   ├── collector/     # Fastify diagnostic collector, rules engine & SSE broadcaster (port 3001)
│   └── web/           # Next.js 14 Web Dashboard (port 3000)
├── packages/
│   └── db/            # Drizzle ORM schema, TimescaleDB migrations & seeders
├── docs/              # Comprehensive guides (Quick Start, FAQ, User Manual, Architecture)
└── specs/             # Product specifications & test plans
```

### Essential CLI Commands

```bash
pnpm dev              # Run collector and web dashboard in parallel
pnpm dev:collector    # Run Fastify collector only
pnpm dev:web          # Run Next.js dashboard only
pnpm db:generate      # Generate Drizzle migration files
pnpm db:migrate       # Apply pending database migrations
pnpm db:seed          # Seed database with sample development data
pnpm build            # Build all packages for production
pnpm typecheck        # Run TypeScript typechecks across the monorepo
pnpm test             # Run unit and integration tests with Vitest
pnpm lint             # Run ESLint across all packages
```

---

## 🔒 Security & Privacy

- **Safe Read-Only Transactions**: Monitoring queries run with `SET default_transaction_read_only = on` and $3\text{s}$ timeouts.
- **Encrypted Credentials**: Monitored database connection strings are encrypted at rest using **AES-256-GCM** authenticated envelope encryption.
- **SQL Sanitization**: Query literals are parameterized via `pg_stat_statements`, and comments (`-- token=...`, `/* password */`), JSON credentials, and array literals are scrubbed before storage.

---

## 📄 License

This project is licensed under the MIT License.
