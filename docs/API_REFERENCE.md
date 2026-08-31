# PG Vitals — API Reference

PG Vitals exposes a fully documented REST and Server-Sent Events (SSE) API built with Fastify, TypeScript, and OpenAPI 3.1.

---

## Interactive Documentation

- **Swagger UI**: Visit `http://localhost:3001/documentation` (or your collector's host URL) for interactive API exploration and direct request execution.
- **OpenAPI 3.1 Spec**: Available as raw JSON at `http://localhost:3001/openapi.json`.

---

## Base URLs & Authentication

- **Development Base URL**: `http://localhost:3001`
- **Authentication**: When Clerk authentication is enabled, supply the JWT Bearer token in the `Authorization` header:
  ```text
  Authorization: Bearer <clerk_session_jwt>
  ```
- **Organization Header**: Multi-tenant endpoints accept an optional `X-Organization-Id` header to scope operations.

---

## Summary of Key Endpoints

### 1. Database Management

| Method | Route | Description |
| :--- | :--- | :--- |
| `GET` | `/api/databases` | List all registered databases for the organization |
| `POST` | `/api/databases` | Register a new monitored database |
| `GET` | `/api/databases/:id` | Get database connection details & status |
| `PUT` | `/api/databases/:id` | Update database settings |
| `DELETE` | `/api/databases/:id` | Unregister and stop monitoring a database |
| `POST` | `/api/databases/test-connection` | Test connectivity, latency, and extensions before registering |
| `POST` | `/api/databases/discover` | Auto-discover schemas and installed extensions |

---

### 2. Live Monitoring & Telemetry

| Method | Route | Description |
| :--- | :--- | :--- |
| `GET` | `/api/databases/:id/overview` | Fetch latest connection metrics, active session counts, and health score |
| `GET` | `/api/databases/:id/live-sessions` | **SSE Stream**: Server-Sent Events real-time stream of active queries and lock waits |
| `GET` | `/api/databases/:id/rollups` | Retrieve pre-aggregated `5m`, `1h`, or `1d` historical metrics |
| `GET` | `/api/databases/:id/snapshots` | Retrieve raw historical connection snapshots |

---

### 3. Query Performance & Execution Plans

| Method | Route | Description |
| :--- | :--- | :--- |
| `GET` | `/api/databases/:id/queries` | Retrieve top queries from `pg_stat_statements` with delta computations |
| `GET` | `/api/databases/:id/queries/percentiles` | Directional P50, P95, P99 tail latency and variance ratio analysis |
| `GET` | `/api/databases/:id/plans` | Retrieve historical `EXPLAIN` query plans and cost regressions |
| `POST` | `/api/databases/:id/plans/capture` | Trigger an on-demand live `EXPLAIN` plan capture for a query |
| `GET` | `/api/databases/:id/plans/diff` | Compare baseline vs. regressed execution plan trees |

---

### 4. Index Advisor & HypoPG Simulation

| Method | Route | Description |
| :--- | :--- | :--- |
| `GET` | `/api/databases/:id/indexes` | List index recommendations (unused, missing, invalid, redundant, bloated) |
| `POST` | `/api/databases/:id/indexes/simulate` | Execute hypothetical index simulation using HypoPG |
| `GET` | `/api/databases/:id/indexes/bloat` | Calculate B-Tree index page bloat and estimated recoverable storage |

---

### 5. VACUUM, Storage & Replication Health

| Method | Route | Description |
| :--- | :--- | :--- |
| `GET` | `/api/databases/:id/health` | Retrieve dead tuple ratios, table bloat, XID age, and autovacuum saturation |
| `GET` | `/api/databases/:id/replication` | Track streaming replica lag (bytes and seconds) and slot health |
| `GET` | `/api/databases/:id/pooler` | Retrieve PgBouncer pool and client wait queue metrics |

---

### 6. Incident Hints, Alerts & Remediation

| Method | Route | Description |
| :--- | :--- | :--- |
| `GET` | `/api/databases/:id/hints` | Retrieve active diagnostic hints (connection hogs, blocking chains, idle transactions) |
| `GET` | `/api/databases/:id/hints/history` | Retrieve historical diagnostic incidents with timeframe filtering |
| `GET` | `/api/databases/:id/alerts` | List configured alert rules and notification channels |
| `POST` | `/api/databases/:id/alerts` | Create or update alert channels (Slack, PagerDuty, Email, Webhook) |
| `POST` | `/api/databases/:id/sessions/:pid/terminate` | Terminate a blocking backend process (`pg_terminate_backend`) |
| `POST` | `/api/slack/actions` | Handle Slack interactive button actions (e.g. ChatOps termination) |

---

## Example: Server-Sent Events (SSE) Client

```typescript
const eventSource = new EventSource(
  `http://localhost:3001/api/databases/${databaseId}/live-sessions`
);

eventSource.onmessage = (event) => {
  const snapshot = JSON.parse(event.data);
  console.log("Live Active Sessions:", snapshot.activeSessions);
  console.log("Root Blockers:", snapshot.blockingChains);
};

eventSource.onerror = (err) => {
  console.error("SSE connection error:", err);
};
```
