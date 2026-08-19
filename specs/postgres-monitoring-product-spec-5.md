# PG Vitals — Extended Feature Specifications & Architecture Addendum

> **Document Version:** 0.5.0  
> **Target Release:** Version 0.5.0 (Phase 11 & Integrations)  
> **Status:** Approved Specification  
> **Scope:** Authentication (Clerk), Tenant Scoping, Latency Percentiles (P95/P99), I/O Timing Diagnostics, Autovacuum Starvation Sentinel, and Remote Chat Remediation.

---

## Table of Contents

1. [Executive Summary & Roadmap Integration](#1-executive-summary--roadmap-integration)
2. [Authentication & Multi-Tenant Scoping (Clerk JWT)](#2-authentication--multi-tenant-scoping-clerk-jwt)
   - [2.1 Architecture & Token Verification Flow](#21-architecture--token-verification-flow)
   - [2.2 Schema Definitions (packages/db)](#22-schema-definitions-packagesdb)
   - [2.3 Fastify Middleware & Guard Hooks](#23-fastify-middleware--guard-hooks)
3. [Query Latency Distribution & P95/P99 Percentile Tracking](#3-query-latency-distribution--p95p99-percentile-tracking)
   - [3.1 Problem Statement & Statistical Modeling](#31-problem-statement--statistical-modeling)
   - [3.2 Hypertable Schema Extensions](#32-hypertable-schema-extensions)
   - [3.3 Percentile Estimation Algorithm](#33-percentile-estimation-algorithm)
4. [I/O Timing Diagnostics & `track_io_timing` Ingestion](#4-io-timing-diagnostics--track_io_timing-ingestion)
   - [4.1 Detection & Capabilities Check](#41-detection--capabilities-check)
   - [4.2 Ingestion Query & Metrics](#42-ingestion-query--metrics)
   - [4.3 Rule Engine Heuristic for I/O Stalls](#43-rule-engine-heuristic-for-io-stalls)
5. [Autovacuum Starvation & Worker Contention Sentinel](#5-autovacuum-starvation--worker-contention-sentinel)
   - [5.1 Diagnostic Mechanics](#51-diagnostic-mechanics)
   - [5.2 Starvation & Worker Contention Query](#52-starvation--worker-contention-query)
   - [5.3 Schema & Event Tracking](#53-schema--event-tracking)
6. [Interactive Remote Remediation (Kill Action)](#6-interactive-remote-remediation-kill-action)
   - [6.1 End-to-End Chatops Lifecycle](#61-end-to-end-chatops-lifecycle)
   - [6.2 Fastify Remediation Endpoint](#62-fastify-remediation-endpoint)
   - [6.3 Slack Block Kit & Microsoft Teams Payloads](#63-slack-block-kit--microsoft-teams-payloads)
7. [API Route Summary & OpenAPI Reference](#7-api-route-summary--openapi-reference)

---

## 1. Executive Summary & Roadmap Integration

PG Vitals 0.4.0 delivered core database telemetry, heuristic root-cause hints, HypoPG index simulations, and time-series hypertables. 

Version 0.5.0 bridges the remaining operational gaps:
- **Zero-Trust Multi-Tenancy:** Hardened JWT authentication using Clerk with tenant isolation across all routes.
- **Micro-Outlier Visibility:** Moving past raw means by modeling P95/P99 latency spreads and variance ratios.
- **Hardware-Level Bottleneck Identification:** Disk vs. CPU classification using `track_io_timing`.
- **Proactive Maintenance:** Detecting blocked or starved autovacuum workers before table bloat triggers write-amplification.
- **Closed-Loop Incident Remediation:** Safe, role-restricted session cancellation directly inside Slack and Microsoft Teams.

---

## 2. Authentication & Multi-Tenant Scoping (Clerk JWT)

### 2.1 Architecture & Token Verification Flow

```
┌───────────────────────────┐
│ Next.js Web Client        │
│ (Clerk Frontend SDK)      │
└─────────────┬─────────────┘
              │ 1. Request with Bearer <Clerk_Session_JWT>
              ▼
┌───────────────────────────┐
│ Fastify Collector API     │
│ (apps/collector)          │
├───────────────────────────┤
│ • verifyToken(jwt)        │ ◄── Validates signature via Clerk JWKS / PEM
│ • Resolve internal User   │ ◄── Matches clerk_user_id → internal UUID
│ • Assert Org Ownership    │ ◄── Ensures database_id belongs to user's org
└─────────────┬─────────────┘
              │ 2. Scoped query execution
              ▼
┌───────────────────────────┐
│ TimescaleDB Hypertables   │
└───────────────────────────┘
```

### 2.2 Schema Definitions (packages/db)

```typescript
// packages/db/src/schema/organizations.ts
import { pgTable, uuid, text, timestamp, varchar, boolean } from 'drizzle-orm/pg-core';

export const organizations = pgTable('organizations', {
  id: uuid('id').defaultRandom().primaryKey(),
  clerkOrgId: varchar('clerk_org_id', { length: 255 }).unique().notNull(),
  name: text('name').notNull(),
  planTier: varchar('plan_tier', { length: 32 }).default('free').notNull(), // 'free' | 'pro' | 'team'
  stripeCustomerId: varchar('stripe_customer_id', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  clerkUserId: varchar('clerk_user_id', { length: 255 }).unique().notNull(),
  organizationId: uuid('organization_id')
    .references(() => organizations.id, { onDelete: 'cascade' })
    .notNull(),
  email: text('email').notNull(),
  role: varchar('role', { length: 32 }).default('member').notNull(), // 'owner' | 'admin' | 'member'
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
```

### 2.3 Fastify Middleware & Guard Hooks

```typescript
// apps/collector/src/middleware/auth.ts
import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken } from '@clerk/backend';
import { db } from '@pgvitals/db';
import { users, monitored_databases } from '@pgvitals/db/schema';
import { eq, and } from 'drizzle-orm';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: {
      userId: string;
      orgId: string;
      role: 'owner' | 'admin' | 'member';
    };
  }
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = await verifyToken(token, {
      jwtKey: process.env.CLERK_JWT_KEY,
      secretKey: process.env.CLERK_SECRET_KEY,
    });

    const clerkUserId = payload.sub;
    if (!clerkUserId) {
      return reply.status(401).send({ error: 'Invalid token subject' });
    }

    const [userRecord] = await db
      .select()
      .from(users)
      .where(eq(users.clerkUserId, clerkUserId))
      .limit(1);

    if (!userRecord) {
      return reply.status(403).send({ error: 'User profile not synchronized with organization' });
    }

    req.auth = {
      userId: userRecord.id,
      orgId: userRecord.organizationId,
      role: userRecord.role as 'owner' | 'admin' | 'member',
    };
  } catch (err) {
    return reply.status(401).send({ error: 'Unauthorized: Session expired or signature invalid' });
  }
}

export async function requireDbAccess(req: FastifyRequest, reply: FastifyReply) {
  const { id: dbId } = req.params as { id: string };
  if (!dbId || !req.auth) return;

  const [monitoredDb] = await db
    .select({ id: monitored_databases.id })
    .from(monitored_databases)
    .where(
      and(
        eq(monitored_databases.id, dbId),
        eq(monitored_databases.organization_id, req.auth.orgId)
      )
    )
    .limit(1);

  if (!monitoredDb) {
    return reply.status(404).send({ error: 'Monitored database not found or permission denied' });
  }
}
```

---

## 3. Query Latency Distribution & P95/P99 Percentile Tracking

### 3.1 Problem Statement & Statistical Modeling

A query with `mean_exec_time = 4.2ms` can hide occasional 8,000ms lock-waits that degrade user experience. Standard `pg_stat_statements` exposes:
- `calls`
- `total_exec_time`
- `min_exec_time`
- `max_exec_time`
- `mean_exec_time`
- `stddev_exec_time`

Using continuous standard deviation and log-normal parameter estimation, PG Vitals derives directional P95 and P99 latencies without requiring heavy per-query distributed tracing overhead.

### 3.2 Hypertable Schema Extensions

```typescript
// packages/db/src/schema/query-performance.ts
import { doublePrecision } from 'drizzle-orm/pg-core';

export const queryStatsPercentileColumns = {
  stddevExecTime: doublePrecision('stddev_exec_time'),
  minExecTime: doublePrecision('min_exec_time'),
  maxExecTime: doublePrecision('max_exec_time'),
  p95ExecTime: doublePrecision('p95_exec_time'),
  p99ExecTime: doublePrecision('p99_exec_time'),
  varianceRatio: doublePrecision('variance_ratio'), // (max_exec_time - mean_exec_time) / mean_exec_time
};
```

### 3.3 Percentile Estimation Algorithm

```typescript
// apps/collector/src/collector/percentile-calculator.ts
export interface LatencyDistribution {
  p50: number;
  p95: number;
  p99: number;
  varianceRatio: number;
  isHighVariance: boolean;
}

export function estimatePercentiles(
  mean: number,
  stddev: number,
  min: number,
  max: number
): LatencyDistribution {
  if (mean <= 0 || isNaN(mean)) {
    return { p50: 0, p95: 0, p99: 0, varianceRatio: 0, isHighVariance: false };
  }

  // Parameter estimation for log-normal distribution modeling query latencies
  const variance = Math.pow(stddev, 2);
  const meanSq = Math.pow(mean, 2);
  const mu = Math.log(meanSq / Math.sqrt(variance + meanSq) || 1);
  const sigma = Math.sqrt(Math.log(1 + (variance / meanSq))) || 0.1;

  // Derive percentiles bounded by recorded min/max
  const rawP50 = Math.exp(mu);
  const rawP95 = Math.exp(mu + 1.64485 * sigma);
  const rawP99 = Math.exp(mu + 2.32635 * sigma);

  const p50 = Number(Math.max(min, Math.min(rawP50, max)).toFixed(2));
  const p95 = Number(Math.max(min, Math.min(rawP95, max)).toFixed(2));
  const p99 = Number(Math.max(min, Math.min(rawP99, max)).toFixed(2));

  const varianceRatio = Number(((max - mean) / mean).toFixed(2));
  const isHighVariance = varianceRatio > 10.0 && max > 500; // Flag queries with 10x spikes > 500ms

  return { p50, p95, p99, varianceRatio, isHighVariance };
}
```

---

## 4. I/O Timing Diagnostics & `track_io_timing` Ingestion

### 4.1 Detection & Capabilities Check

When `track_io_timing` is `off`, PostgreSQL does not measure block read/write durations, showing `blk_read_time = 0` despite intensive disk waits.

**Capabilities Validation Query:**
```sql
SELECT name, setting, unit, context 
FROM pg_settings 
WHERE name = 'track_io_timing';
```

If `setting == 'off'`, the onboarding wizard displays a non-blocking configuration prompt:
```sql
-- Enable block I/O time tracking (Requires reload or superuser session)
ALTER SYSTEM SET track_io_timing = 'on';
SELECT pg_reload_conf();
```

### 4.2 Ingestion Query & Metrics

```sql
SELECT 
  queryid,
  calls,
  total_exec_time,
  mean_exec_time,
  shared_blks_hit,
  shared_blks_read,
  shared_blks_written,
  blk_read_time,
  blk_write_time,
  CASE 
    WHEN total_exec_time > 0 
    THEN ((blk_read_time + blk_write_time) / total_exec_time) * 100 
    ELSE 0 
  END AS io_time_percentage
FROM pg_stat_statements
WHERE calls > 10
ORDER BY (blk_read_time + blk_write_time) DESC
LIMIT 50;
```

### 4.3 Rule Engine Heuristic for I/O Stalls

```typescript
// apps/collector/src/collector/rules/io-stall-rule.ts
export function evaluateIoStall(record: {
  queryid: string;
  total_exec_time: number;
  blk_read_time: number;
  blk_write_time: number;
  io_time_percentage: number;
}) {
  if (record.io_time_percentage >= 45.0 && record.total_exec_time > 1500) {
    return {
      severity: 'warning',
      ruleId: 'io_stall_bottleneck',
      title: 'Disk I/O Stall Dominated Execution',
      message: `Query ${record.queryid} spends ${record.io_time_percentage.toFixed(1)}% of total execution time waiting on storage reads/writes (${record.blk_read_time.toFixed(0)}ms read / ${record.blk_write_time.toFixed(0)}ms write).`,
      actionableFix: 'Investigate missing indexes triggering high sequential disk scans or increase disk throughput (e.g., AWS EBS gp3 provisioned IOPS / burst limit).',
    };
  }
  return null;
}
```

---

## 5. Autovacuum Starvation & Worker Contention Sentinel

### 5.1 Diagnostic Mechanics

Autovacuum starvation occurs when:
1. Dead tuple counts exceed table maintenance thresholds, BUT
2. All `autovacuum_max_workers` are occupied with long-running maintenance jobs, OR
3. Active `autovacuum` workers are repeatedly canceled due to long-running user transactions taking exclusive locks or exceeding `deadlock_timeout`.

### 5.2 Starvation & Worker Contention Query

```sql
WITH worker_stats AS (
  SELECT 
    count(*) AS active_workers,
    current_setting('autovacuum_max_workers')::int AS max_workers
  FROM pg_stat_activity 
  WHERE query ~* '^autovacuum:'
),
starved_candidates AS (
  SELECT 
    schemaname,
    relname,
    n_live_tup,
    n_dead_tup,
    ROUND((n_dead_tup::numeric / NULLIF(n_live_tup + n_dead_tup, 0)) * 100, 2) AS dead_tuple_pct,
    last_vacuum,
    last_autovacuum,
    vacuum_count,
    autovacuum_count
  FROM pg_stat_user_tables
  WHERE n_dead_tup > 10000 
    AND (n_dead_tup::numeric / NULLIF(n_live_tup + n_dead_tup, 0)) > 0.20
)
SELECT 
  sc.*,
  ws.active_workers,
  ws.max_workers,
  (ws.active_workers >= ws.max_workers) AS is_worker_saturated
FROM starved_candidates sc, worker_stats ws
ORDER BY sc.n_dead_tup DESC;
```

### 5.3 Schema & Event Tracking

```typescript
// packages/db/src/schema/vacuum-health.ts
import { pgTable, uuid, timestamp, integer, boolean, text } from 'drizzle-orm/pg-core';
import { monitored_databases } from './organizations';

export const autovacuum_starvation_events = pgTable('autovacuum_starvation_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  databaseId: uuid('database_id')
    .references(() => monitored_databases.id, { onDelete: 'cascade' })
    .notNull(),
  tableName: text('table_name').notNull(),
  deadTuples: integer('dead_tuples').notNull(),
  deadTupleRatio: integer('dead_tuple_ratio').notNull(),
  activeWorkers: integer('active_workers').notNull(),
  maxWorkers: integer('max_workers').notNull(),
  isWorkerSaturated: boolean('is_worker_saturated').notNull(),
  suggestedAction: text('suggested_action').notNull(),
  capturedAt: timestamp('captured_at', { withTimezone: true }).defaultNow().notNull(),
});
```

---

## 6. Interactive Remote Remediation (Kill Action)

### 6.1 End-to-End Chatops Lifecycle

```
┌──────────────────────────────────────────────────────────┐
│ Collector Alerting Engine                                │
│ (Detects blocking chain waiting > 30s)                   │
└────────────────────────────┬─────────────────────────────┘
                             │ 1. POST webhook with interactive payload
                             ▼
┌──────────────────────────────────────────────────────────┐
│ Slack Channel #ops-db-alerts                             │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ 🔴 Critical: Session 8419 blocking 4 queries         │ │
│ │ Query: UPDATE orders SET status = 'HOLD' WHERE...    │ │
│ │ [ ⚡ Terminate Blocker PID 8419 ]                    │ │
│ └──────────────────────────────────────────────────────┘ │
└────────────────────────────┬─────────────────────────────┘
                             │ 2. Admin clicks "Terminate Blocker"
                             ▼
┌──────────────────────────────────────────────────────────┐
│ POST /api/webhooks/remediation/kill-session              │
│ ├─ Validate Slack HMAC signature (X-Slack-Signature)     │
│ ├─ Check Slack user mapping & admin authorization        │
│ ├─ Decrypt connection string                             │
│ ├─ Execute: SELECT pg_terminate_backend(8419);           │
│ └─ Respond & update Slack card to "Terminated by @alex"  │
└──────────────────────────────────────────────────────────┘
```

### 6.2 Fastify Remediation Endpoint

```typescript
// apps/collector/src/routes/remediation.ts
import { FastifyInstance } from 'fastify';
import { db } from '@pgvitals/db';
import { monitored_databases } from '@pgvitals/db/schema';
import { eq, and } from 'drizzle-orm';
import { decrypt } from '../lib/encryption';
import postgres from 'postgres';

export async function remediationRoutes(fastify: FastifyInstance) {
  fastify.post(
    '/api/databases/:id/sessions/:pid/terminate',
    { preHandler: [fastify.requireAuth] },
    async (req, reply) => {
      const { id: dbId, pid } = req.params as { id: string; pid: string };
      const targetPid = parseInt(pid, 10);

      if (isNaN(targetPid)) {
        return reply.status(400).send({ error: 'Invalid PID parameter' });
      }

      if (req.auth?.role !== 'owner' && req.auth?.role !== 'admin') {
        return reply.status(403).send({ error: 'Forbidden: Requires admin or owner privileges' });
      }

      const [monitoredDb] = await db
        .select()
        .from(monitored_databases)
        .where(
          and(
            eq(monitored_databases.id, dbId),
            eq(monitored_databases.organization_id, req.auth.orgId)
          )
        )
        .limit(1);

      if (!monitoredDb) {
        return reply.status(404).send({ error: 'Database instance not found' });
      }

      const rawConnStr = decrypt(monitoredDb.connection_string_encrypted);
      const sql = postgres(rawConnStr, { max: 1, connect_timeout: 5 });

      try {
        const result = await sql`
          SELECT pg_terminate_backend(${targetPid}) AS terminated;
        `;
        const wasTerminated = result[0]?.terminated ?? false;

        return reply.send({
          success: wasTerminated,
          pid: targetPid,
          message: wasTerminated
            ? `Successfully terminated PostgreSQL backend PID ${targetPid}.`
            : `Could not terminate PID ${targetPid}. Process may have already exited.`,
        });
      } catch (err: any) {
        return reply.status(500).send({ error: `Query execution failed: ${err.message}` });
      } finally {
        await sql.end();
      }
    }
  );
}
```

### 6.3 Slack Block Kit & Microsoft Teams Payloads

#### Slack Interactive Block Template
```json
{
  "blocks": [
    {
      "type": "header",
      "text": {
        "type": "plain_text",
        "text": "🔴 Critical: Blocking Chain Exceeded 30s Threshold"
      }
    },
    {
      "type": "section",
      "fields": [
        { "type": "mrkdwn", "text": "*Database:*
production-primary" },
        { "type": "mrkdwn", "text": "*Root Blocker PID:*
`4912`" },
        { "type": "mrkdwn", "text": "*Blocked Sessions:*
`3 waiting`" },
        { "type": "mrkdwn", "text": "*Duration:*
42s" }
      ]
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*Blocker Query Snippet:*
```sql
UPDATE user_accounts SET locked = true WHERE id = $1
```"
      }
    },
    {
      "type": "actions",
      "elements": [
        {
          "type": "button",
          "text": {
            "type": "plain_text",
            "text": "⚡ Terminate Blocker (PID 4912)"
          },
          "style": "danger",
          "action_id": "pgvitals_terminate_session",
          "value": "{\"dbId\":\"db-uuid\",\"pid\":4912}",
          "confirm": {
            "title": { "type": "plain_text", "text": "Confirm Session Kill" },
            "text": {
              "type": "plain_text",
              "text": "Are you sure you want to terminate backend PID 4912? Active transactions in that session will be aborted and rolled back."
            },
            "confirm": { "type": "plain_text", "text": "Terminate Immediately" },
            "deny": { "type": "plain_text", "text": "Cancel" }
          }
        },
        {
          "type": "button",
          "text": {
            "type": "plain_text",
            "text": "🔍 View Live Tree in PG Vitals"
          },
          "url": "https://app.pgvitals.io/databases/db-uuid?tab=sessions&filter=blocked"
        }
      ]
    }
  ]
}
```

---

## 7. API Route Summary & OpenAPI Reference

| Method | Endpoint | Auth Required | Description |
|---|---|---|---|
| `GET` | `/api/databases/:id/queries/percentiles` | `Bearer JWT` | Returns estimated P50, P95, P99, and variance metrics for top queries. |
| `GET` | `/api/databases/:id/io-diagnostics` | `Bearer JWT` | Returns block read/write metrics, I/O wait percentages, and `track_io_timing` status. |
| `GET` | `/api/databases/:id/autovacuum/starvation` | `Bearer JWT` | Returns worker pool saturation status and starved table dead tuple metrics. |
| `POST` | `/api/databases/:id/sessions/:pid/terminate` | `Bearer JWT (Admin+)` | Terminates a rogue blocking or idle session on the target database. |
| `POST` | `/api/webhooks/slack/interactions` | `Slack HMAC` | Receives and validates Slack interactive button actions for session termination. |

---

*End of Specification — PG Vitals v0.5.0*
