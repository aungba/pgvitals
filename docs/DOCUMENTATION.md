# PG Vitals — Documentation Hub

Welcome to the **PG Vitals** documentation portal. This hub indexes all operational guides, technical references, architectural deep dives, and onboarding instructions.

---

## 📚 Documentation Index

### 1. Getting Started & Onboarding
- 🚀 **[Quick Start Guide](QUICK_START.md)**: Zero-to-running local setup in 5 minutes with Docker Compose, TimescaleDB, and Redis.
- 💻 **[How to Run](../how_to_run.md)**: Developer setup, running individual services, and local troubleshooting.
- 🛡️ **[Read-Only User Setup Guide](../READONLY_USER_SETUP.md)**: SQL scripts for creating the `pgvitals_monitor` role on PostgreSQL 10–18+.

### 2. Product Features & User Guides
- 📖 **[End User Manual & Operational Guide](USER_MANUAL.md)**: Comprehensive guide detailing live session monitoring, lock trees, root blocker termination, index advisor, HypoPG simulation, EXPLAIN plan regression diffs, table bloat, autovacuum starvation, and log insights.
- ❓ **[Frequently Asked Questions (FAQ)](FAQ.md)**: Common architectural questions, performance overhead benchmarks, security policies, and debugging tips.

### 3. Architecture & API Reference
- 🏗️ **[System Architecture & Design](ARCHITECTURE.md)**: Monorepo layout, TimescaleDB hypertable design, BullMQ queues, in-memory SSE event hub, LRU client pool, and diagnostic rules engine.
- 🔌 **[API Reference & Endpoints](API_REFERENCE.md)**: Complete guide to REST endpoints, Server-Sent Events (SSE) streaming, parameter schemas, and Swagger UI / OpenAPI 3.1 docs.

### 4. Authentication, Security & Deployment
- 🔐 **[Clerk Authentication Setup](clerk_auth_setup.md)**: Configuring multi-tenant authentication, organization scoping, user roles, and plan tiers.
- 🚢 **[Production Deployment Guide](../deployment_guide.md)**: End-to-end production deployment guide covering Linux systemd / PM2 (`ecosystem.config.cjs`), Nginx reverse proxy with SSL, and Jenkins CI/CD pipeline (`Jenkinsfile`).

---

## 🗺️ Feature & Guide Quick Lookup

| If you want to... | Consult Guide |
| :--- | :--- |
| **Install and test PG Vitals locally** | [Quick Start Guide](QUICK_START.md) |
| **Configure permissions on AWS RDS / GCP / Supabase** | [Database Monitoring User Setup](../READONLY_USER_SETUP.md) |
| **Understand overhead & polling performance** | [Frequently Asked Questions (FAQ)](FAQ.md#2-performance--overhead) |
| **Diagnose lock storms & terminate blockers** | [User Manual: Live Connections & Locks](USER_MANUAL.md#2-live-connection--session-monitoring) |
| **Simulate indexes with HypoPG before creating them** | [User Manual: Index Advisor](USER_MANUAL.md#4-index-advisor--hypopg-simulation) |
| **Identify disk vs. CPU I/O stalls & P95/P99 latency** | [User Manual: Tail Latencies & Storage I/O](USER_MANUAL.md#9-tail-latencies-p95p99--storage-io-diagnostics) |
| **Tune autovacuum for bloated tables** | [User Manual: VACUUM Health & Bloat](USER_MANUAL.md#6-vacuum-health-bloat--storage-management) |
| **Set up Slack, PagerDuty, or Webhook alerts** | [User Manual: Alerts & Integrations](USER_MANUAL.md#8-alerts--multi-channel-integrations) |
| **Connect via REST or Server-Sent Events** | [API Reference](API_REFERENCE.md) |
| **Deploy to production with Nginx, PM2, or Jenkins** | [Production Deployment Guide](../deployment_guide.md) |
