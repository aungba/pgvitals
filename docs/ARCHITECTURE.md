# PG Vitals — Architecture & System Design

PG Vitals is an enterprise-grade PostgreSQL telemetry, root-cause diagnostic, and optimization platform designed for minimal overhead, horizontal scalability, and real-time incident visibility.

---

## 1. High-Level Architecture

```mermaid
flowchart TB
    subgraph Monitored_PostgreSQL["Monitored PostgreSQL Instances"]
        TargetDB["PostgreSQL (v10-18+)\npg_stat_statements\npg_locks / pg_stat_activity\nHypoPG"]
    end

    subgraph Collector_Tier["Collector Tier (apps/collector)"]
        Scheduler["Cron / Polling Scheduler\n(10s Sessions, 5m Queries)"]
        ClientPool["LRU Monitored Pool\n(Idle Eviction 3m)"]
        SafeExecutor["Safe Read-Only Query Executor\n(3s Timeout)"]
        Broadcaster["Session Broadcaster\n(In-Memory SSE Hub)"]
        RulesEngine["Diagnostic Rules Engine\n(7 Heuristic Detectors)"]
        RollupWorker["Metric Rollup Engine\n(5m / 1h / 1d Aggregation)"]
        OpenAPIServer["Fastify API & OpenAPI 3.1\n(Swagger UI / Routes)"]
    end

    subgraph Storage_Tier["Storage & Queue Tier"]
        Timescale["TimescaleDB (Hypertable Metrics)\nSnapshots, Hints, Plans, Bloat"]
        Redis["Redis (BullMQ)\nJob Queues & Rate Limiting"]
    end

    subgraph Frontend_Tier["Frontend Tier (apps/web)"]
        NextJS["Next.js 14 App Router\nServer & Client Components"]
        SSEHook["Live SSE Stream Hook\n(Push-based Zero Polling)"]
        Visualizer["Recharts / Lucide UI\nTime-Series & Diff Trees"]
    end

    subgraph Integrations["Alerting & Remediation"]
        Slack["Slack Block Kit &\nChatOps Remote Kill"]
        PagerDuty["PagerDuty Events v2"]
        Email["SMTP Email Alerts"]
        Webhook["Signed HMAC Webhooks"]
    end

    TargetDB -->|Lightweight Read-Only Stats| ClientPool
    ClientPool --> SafeExecutor
    Scheduler --> ClientPool
    SafeExecutor --> RulesEngine
    SafeExecutor --> Broadcaster
    SafeExecutor --> RollupWorker

    RulesEngine -->|Store Incidents| Timescale
    RollupWorker -->|Store Rollups| Timescale
    Scheduler -->|Enqueue Jobs| Redis
    Redis --> Collector_Tier

    Broadcaster -->|Push Deltas (SSE)| SSEHook
    OpenAPIServer -->|Fetch REST API| NextJS
    SSEHook --> Visualizer

    RulesEngine -->|Trigger Alerts| Slack
    RulesEngine -->|Trigger Alerts| PagerDuty
    RulesEngine -->|Trigger Alerts| Email
    RulesEngine -->|Trigger Alerts| Webhook

    Slack -.->|Interactive Terminate Session| OpenAPIServer
    OpenAPIServer -.->|pg_terminate_backend(pid)| TargetDB
```

---

## 2. Monorepo Structure

The project is structured as a `pnpm` monorepo:

```
pgvitals/
├── apps/
│   ├── collector/              # Fastify diagnostic & metrics collector engine
│   │   ├── src/
│   │   │   ├── alerting/       # Multi-channel notification engine (Slack, PagerDuty, Email)
│   │   │   ├── collector/      # Metric polling workers (connections, queries, bloat, replication)
│   │   │   ├── lib/            # LRU connection pool, encryption, query sanitizer, broadcaster
│   │   │   ├── middleware/     # Clerk authentication, plan tier limits, CORS
│   │   │   ├── routes/         # REST endpoints & SSE streaming handlers
│   │   │   └── config.ts       # Centralized runtime configuration
│   └── web/                    # Next.js 14 Web Dashboard
│       └── src/
│           ├── app/            # App Router pages (/databases, /hints, /queries, /indexes)
│           ├── components/     # UI components (charts, lock trees, diff visualizers)
│           └── lib/            # API client and formatting utilities
├── packages/
│   └── db/                     # Drizzle ORM schema, TimescaleDB migrations & seeders
│       └── src/
│           ├── schema/         # Hypertable schemas (monitoring, alerts, indexes, plans)
│           └── client.ts       # Database connection instance
├── docs/                       # Comprehensive documentation suite
└── specs/                      # Engineering product specifications & test plans
```

---

## 3. Core Subsystems

### 3.1 LRU Monitored Client Pool (`apps/collector/src/lib/client-pool.ts`)
- Maintains an in-memory pool of PostgreSQL clients for each monitored database.
- Implements an **LRU eviction policy** that closes connections idle for $> 3$ minutes.
- Guarantees the collector does not exhaust database connection ceilings on target instances.

### 3.2 Safe Read-Only Query Executor (`apps/collector/src/lib/safe-query.ts`)
- Injects `SET statement_timeout = 3000` (3 seconds) and `SET default_transaction_read_only = on` before executing metric collection queries.
- Guarantees that monitoring queries never block application workloads or perform accidental mutations.

### 3.3 Centralized Session Broadcaster (`apps/collector/src/lib/session-broadcaster.ts`)
- Provides an $O(1)$ pub/sub hub for Server-Sent Events (SSE).
- Even when hundreds of dashboard browser sessions are open simultaneously, the collector performs only a single periodic query against the target database and fans out the results in-memory.

### 3.4 Diagnostic Rules Engine (`apps/collector/src/collector/rules-engine.ts`)
Evaluates 7 heuristic diagnostic rules on every snapshot:
1. **`idle_in_transaction_long`**: Sessions holding open transactions $> 300\text{s}$.
2. **`connection_hog`**: Single application consuming $> 70\%$ of available connection capacity.
3. **`blocking_chain_long`**: Transactions waiting on locks $> 30\text{s}$ with blocker identification.
4. **`connection_exhaustion`**: Total active connections exceeding $80\%$ of `max_connections`.
5. **`connection_spike`**: Rapid connection influx ($> 50\%$ increase between cycles).
6. **`micro_query_lock_storm`**: High-frequency row contention storms.
7. **`lock_queue_storm`**: Cascading lock queues behind a root blocker session.

### 3.5 Time-Series Storage & Hypertables (`packages/db`)
Metrics are stored in TimescaleDB hypertables partitioned by time:
- `connection_snapshots`: High-frequency active session and pool states.
- `metric_rollups`: Pre-aggregated 5-minute, 1-hour, and 1-day metric averages for instant multi-month trend analysis.
- `query_stat_snapshots`: `pg_stat_statements` deltas, execution counts, mean latency, and I/O wait times.
- `index_recommendations`: Unused, invalid, redundant, and bloated index telemetry.
- `vacuum_health_snapshots`: Dead tuple counts, bloat ratios, XID ages, and autovacuum worker saturation.

### 3.6 Secret Encryption & Query Redaction (`apps/collector/src/lib/encryption.ts`)
- **AES-256-GCM** authenticated encryption for database connection strings.
- Query sanitization engine that redacts SQL comments, JSON credentials, and array literals prior to saving query logs.

---

## 4. Scalability & Resilience

| Characteristic | Design Implementation |
| :--- | :--- |
| **Worker Concurrency** | BullMQ distributed queues backed by Redis |
| **Storage Optimization** | Omission of redundant raw JSON payloads in favor of typed columns |
| **Metric Compression** | TimescaleDB chunk compression policies for older hypertable chunks |
| **Zero-Downtime DDL** | All generated remediation scripts use `CONCURRENTLY` modifiers |
| **High Availability** | Stateless collector containers deployable across multiple replicas |
