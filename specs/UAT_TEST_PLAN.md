# PG Vitals — UAT Test Plan

> **Version:** 1.0 | **Date:** 2026-08-05
> **Environment:** UAT (pre-production)
> **Tester:** _______________

---

## 1. UAT Environment Setup

### 1.1 Test Accounts & Organizations

Create these test entities before starting:

| # | Organization | Plan | Owner Email | Purpose |
|---|-------------|------|-------------|---------|
| 1 | **Acme Corp** | `pro` | `admin@acme-test.com` | Primary testing — full feature access |
| 2 | **StartupX** | `free` | `dev@startupx-test.com` | Free tier — verify retention limits + feature gating |
| 3 | **BigTeam Inc** | `team` | `lead@bigteam-test.com` | Team tier — multi-member + 90-day retention |

### 1.2 Test Team Members (BigTeam Inc)

| # | Email | Role | Purpose |
|---|-------|------|---------|
| 1 | `lead@bigteam-test.com` | `owner` | Full access — can manage members, billing |
| 2 | `alice@bigteam-test.com` | `admin` | Admin access — can manage databases, alerts |
| 3 | `bob@bigteam-test.com` | `member` | Read-only access — can view dashboards |

### 1.3 Test Databases to Monitor

| # | DB Name | Environment | Connection | Purpose |
|---|---------|------------|------------|---------|
| 1 | **UAT-Primary** | `production` | Local TimescaleDB (self-monitoring) | Main test target |
| 2 | **UAT-Staging** | `staging` | Same DB, different name | Multi-env testing |
| 3 | **Fake-DB** | `production` | Invalid connection string | Error handling test |

### 1.4 Seed the UAT Data

Run this SQL after `pnpm db:migrate` to create the test accounts:

```bash
# Option 1: Use the built-in seed (creates 1 org + 1 user + 1 DB)
pnpm db:seed

# Option 2: Create the full UAT dataset via API after starting the app
# (see Section 2 — TC-001 through TC-003)
```

---

## 2. Test Cases

### Legend

| Status | Meaning |
|--------|---------|
| ⬜ | Not tested |
| ✅ | Passed |
| ❌ | Failed |
| ⚠️ | Passed with issues |

---

### Module 1: Database Registration & Management

| ID | Test Case | Steps | Expected Result | Status | Notes |
|----|-----------|-------|----------------|--------|-------|
| TC-001 | Register a valid database | 1. Go to `/databases/new`<br>2. Enter name: "UAT-Primary"<br>3. Paste valid connection string<br>4. Select environment: production<br>5. Click "Add Database" | Database card appears on dashboard, collector starts polling within 10s | ⬜ | |
| TC-002 | Register with invalid connection | 1. Go to `/databases/new`<br>2. Enter invalid connection string<br>3. Submit | Error message shown, database NOT created | ⬜ | |
| TC-003 | Register second database | 1. Add "UAT-Staging" with staging environment | Both databases show on dashboard with different environment badges | ⬜ | |
| TC-004 | Delete a database | 1. Delete "Fake-DB"<br>2. Confirm deletion | Database removed from dashboard, all associated data purged | ⬜ | |
| TC-005 | Connection string encryption | 1. Register a DB<br>2. Query `monitored_databases` table directly | `connection_string_encrypted` is in `iv:authTag:ciphertext` format, NOT plaintext | ⬜ | |

---

### Module 2: Dashboard & Real-Time Monitoring

| ID | Test Case | Steps | Expected Result | Status | Notes |
|----|-----------|-------|----------------|--------|-------|
| TC-010 | Dashboard loads | 1. Open `/` | All registered databases shown as cards with connection gauges | ⬜ | |
| TC-011 | Connection gauge updates | 1. Open dashboard<br>2. Wait 10-20 seconds | Gauge percentage updates, connection count refreshes | ⬜ | |
| TC-012 | Database detail page | 1. Click a database card | Detail page shows: overview stats, connection chart, sessions table, hints | ⬜ | |
| TC-013 | Connection chart renders | 1. Open database detail<br>2. Check chart area | Recharts area chart with connection time series, smooth rendering | ⬜ | |
| TC-014 | Sessions table populated | 1. Open database detail<br>2. Scroll to sessions | Sessions table shows PID, user, app, state, duration, query | ⬜ | |
| TC-015 | Sessions table sorting | 1. Click column headers | Rows re-sort by clicked column | ⬜ | |
| TC-016 | Sessions table filtering | 1. Use filter dropdowns (state, app) | Table filters correctly | ⬜ | |
| TC-017 | Session groups view | 1. Switch to "Group by" tab<br>2. Select app/user/state | Sessions grouped correctly with counts | ⬜ | |
| TC-018 | Schema change markers | 1. Make a DDL change on monitored DB<br>2. Wait for next daily collection<br>3. Check connection chart | ReferenceLine markers appear on chart at schema change times | ⬜ | |

---

### Module 3: Root-Cause Hints

| ID | Test Case | Steps | Expected Result | Status | Notes |
|----|-----------|-------|----------------|--------|-------|
| TC-020 | Idle-in-transaction hint | 1. Open a psql session: `BEGIN;` then wait 6+ minutes<br>2. Check database detail page | HintCard appears: "idle_in_transaction_long" with severity warning | ⬜ | |
| TC-021 | Connection exhaustion hint | 1. Open connections > 80% of max_connections<br>2. Wait for next poll | HintCard: "connection_exhaustion" with severity critical | ⬜ | Difficult to trigger on dev; may need to lower max_connections |
| TC-022 | Blocking chain hint | 1. Create two sessions with lock conflict<br>2. Hold for 30+ seconds | HintCard: "blocking_chain_long" with blocker/blocked PIDs | ⬜ | |
| TC-023 | Hint card display | 1. Trigger any hint<br>2. Check UI | Card shows: severity badge, title, description, timestamp | ⬜ | |

---

### Module 4: Alerting System

| ID | Test Case | Steps | Expected Result | Status | Notes |
|----|-----------|-------|----------------|--------|-------|
| TC-030 | View alert rules page | 1. Navigate to `/databases/[id]/alerts` | Alert rules configuration form loads | ⬜ | |
| TC-031 | Create alert rule | 1. Enable "Connection Exhaustion" rule<br>2. Set threshold: 80%<br>3. Set cooldown: 5 minutes<br>4. Save | Rule saved, appears in rules list | ⬜ | |
| TC-032 | Test Slack notification | 1. Enter Slack webhook URL<br>2. Click "Test Notification" | Slack message received with test alert format | ⬜ | Requires real Slack webhook |
| TC-033 | Test Email notification | 1. Configure SMTP settings<br>2. Enter recipient email<br>3. Click "Test Email" | Email received with HTML template, severity colors | ⬜ | Requires SMTP server |
| TC-034 | Configure PagerDuty | 1. Enter PagerDuty routing key<br>2. Save | Config saved, visible in channel settings | ⬜ | |
| TC-035 | Configure Teams webhook | 1. Enter Teams webhook URL<br>2. Save | Config saved, visible in channel settings | ⬜ | |
| TC-036 | Configure generic webhook | 1. Enter webhook URL + optional secret<br>2. Save | Config saved, visible in channel settings | ⬜ | |
| TC-037 | Alert fires on threshold breach | 1. Create rule with low threshold<br>2. Wait for condition to match | Alert appears in AlertHistory with severity, type, description | ⬜ | |
| TC-038 | Alert deduplication | 1. Trigger same condition twice within cooldown | Only ONE alert created (not duplicate) | ⬜ | |
| TC-039 | Alert resolves | 1. Trigger alert<br>2. Fix the condition<br>3. Wait for next poll | Alert status changes to "resolved" with resolved_at timestamp | ⬜ | |
| TC-040 | Alert feedback | 1. Find an alert in AlertHistory<br>2. Click thumbs up 👍<br>3. Click thumbs down 👎 on another | Feedback saved, UI updates optimistically | ⬜ | |

---

### Module 5: Query Performance

| ID | Test Case | Steps | Expected Result | Status | Notes |
|----|-----------|-------|----------------|--------|-------|
| TC-050 | Query stats page loads | 1. Navigate to `/databases/[id]/queries` | Query table loads with top queries | ⬜ | Requires `pg_stat_statements` extension |
| TC-051 | Query sorting | 1. Click "Total Time", "Calls", "Mean Time" | Table re-sorts correctly | ⬜ | |
| TC-052 | Query trend badges | 1. Wait for 2+ collection cycles<br>2. Check query rows | ↑/↓ trend badges show week-over-week changes | ⬜ | |
| TC-053 | EXPLAIN capture | 1. Click "Explain" on a query<br>2. Wait for result | EXPLAIN plan displayed with formatted JSON, warnings flagged | ⬜ | |
| TC-054 | Query redaction | 1. Run queries with literal values (e.g., `WHERE name = 'John'`)<br>2. Check stored query text | Literals replaced with `$1`, `$N` — no PII visible | ⬜ | |
| TC-055 | Query suggestions panel | 1. Check queries page for suggestions panel | Suggestions show with severity, collapsed by default, expandable | ⬜ | |

---

### Module 6: Index Advisor

| ID | Test Case | Steps | Expected Result | Status | Notes |
|----|-----------|-------|----------------|--------|-------|
| TC-060 | Index recommendations load | 1. Navigate to `/databases/[id]/indexes` | Unused and missing index cards displayed | ⬜ | |
| TC-061 | Dismiss recommendation | 1. Click "Dismiss" on a recommendation | Card moves to dismissed section, DDL hidden | ⬜ | |
| TC-062 | Restore recommendation | 1. Click "Restore" on dismissed card | Card returns to active recommendations | ⬜ | |
| TC-063 | Copy DDL | 1. Click "Copy" on a recommendation | DDL copied to clipboard | ⬜ | |
| TC-064 | Trigger fresh analysis | 1. Click "Analyze Now" | New recommendations generated, old non-dismissed ones cleared | ⬜ | |
| TC-065 | HypoPG simulation | 1. Click "Simulate" on a missing index card<br>2. Enter a test query<br>3. Submit | Shows: cost before/after, % reduction, plan comparison | ⬜ | Requires `hypopg` extension |

---

### Module 7: Vacuum & DB Health

| ID | Test Case | Steps | Expected Result | Status | Notes |
|----|-----------|-------|----------------|--------|-------|
| TC-070 | Health page loads | 1. Navigate to `/databases/[id]/health` | Table bloat stats + DB health metrics visible | ⬜ | |
| TC-071 | Table bloat stats | 1. Check bloat table | Shows: table name, live/dead tuples, dead ratio, last vacuum | ⬜ | |
| TC-072 | Cache hit ratio | 1. Check health metrics | Cache hit ratio displayed (should be > 99% on dev) | ⬜ | |
| TC-073 | TX ID wraparound | 1. Check wraparound section | Shows current XID age, warning if > 50% | ⬜ | |
| TC-074 | Disk growth forecast | 1. Check growth section | Table sizes with growth rate + days-to-limit projection | ⬜ | Needs multiple daily collections |

---

### Module 8: Additional Pages (Phases 8–10)

| ID | Test Case | Steps | Expected Result | Status | Notes |
|----|-----------|-------|----------------|--------|-------|
| TC-080 | Log insights page | 1. Navigate to `/databases/[id]/logs` | Error/warning events table with filters + summary cards | ⬜ | |
| TC-081 | Schema change page | 1. Navigate to `/databases/[id]/schema` | DDL event log with change type, object name, timestamp | ⬜ | |
| TC-082 | Plan regression page | 1. Navigate to `/databases/[id]/plans` | Plan timeline with shape hash changes + regression markers | ⬜ | |
| TC-083 | PgBouncer page | 1. Navigate to `/databases/[id]/pooler` | Pool stats dashboard (or "not configured" message) | ⬜ | Requires PgBouncer |
| TC-084 | Cost estimator page | 1. Navigate to `/databases/[id]/costs` | Monthly IO+CPU cost per query with breakdown | ⬜ | |

---

### Module 9: Onboarding Wizard

| ID | Test Case | Steps | Expected Result | Status | Notes |
|----|-----------|-------|----------------|--------|-------|
| TC-090 | Wizard loads | 1. Navigate to `/onboarding` | 7-step wizard UI with progress indicator | ⬜ | |
| TC-091 | Connection validation | 1. Enter valid connection string<br>2. Click "Validate" | Shows: PG version, DB name, max_connections | ⬜ | |
| TC-092 | Invalid connection | 1. Enter bad connection string<br>2. Click "Validate" | Error message displayed, cannot proceed | ⬜ | |
| TC-093 | Capability detection | 1. After validation, click "Detect" | Shows checkmarks for: pg_stat_statements, hypopg, pgbouncer | ⬜ | |
| TC-094 | Complete wizard | 1. Walk through all 7 steps<br>2. Finish | Database registered, redirected to dashboard | ⬜ | |

---

### Module 10: Team & Organization Management

| ID | Test Case | Steps | Expected Result | Status | Notes |
|----|-----------|-------|----------------|--------|-------|
| TC-100 | Team settings page | 1. Navigate to `/settings/team` | Org name + member list displayed | ⬜ | |
| TC-101 | Update org name | 1. Change org name<br>2. Save | Name updated in sidebar and settings | ⬜ | |
| TC-102 | Invite member | 1. Enter email + select role (admin)<br>2. Click "Invite" | Member appears in list with correct role | ⬜ | |
| TC-103 | Change member role | 1. Change Alice from admin → member | Role updated in list | ⬜ | |
| TC-104 | Remove member | 1. Remove Bob from team | Member removed from list | ⬜ | |

---

### Module 11: UI / UX / Cross-Cutting

| ID | Test Case | Steps | Expected Result | Status | Notes |
|----|-----------|-------|----------------|--------|-------|
| TC-110 | Dark mode toggle | 1. Click theme toggle (sun/moon icon) | All pages switch to dark theme, persisted on reload | ⬜ | |
| TC-111 | Light mode toggle | 1. Click theme toggle again | All pages switch to light theme | ⬜ | |
| TC-112 | Sidebar collapse | 1. Click sidebar collapse button | Sidebar collapses to icons, main content expands | ⬜ | |
| TC-113 | Sidebar expand | 1. Click expand button | Sidebar returns to full width with labels | ⬜ | |
| TC-114 | Sidebar persistence | 1. Collapse sidebar<br>2. Reload page | Sidebar remains collapsed (localStorage) | ⬜ | |
| TC-115 | Responsive layout | 1. Resize browser to mobile width | Layout adjusts, no horizontal overflow | ⬜ | |
| TC-116 | Auto-refresh | 1. Open database detail<br>2. Wait 10+ seconds | Data refreshes without manual reload | ⬜ | |
| TC-117 | Navigation between pages | 1. Click through all sidebar links | All pages load without errors | ⬜ | |
| TC-118 | 404 handling | 1. Navigate to `/databases/invalid-uuid` | Graceful error or redirect (not crash) | ⬜ | |
| TC-119 | Billing page | 1. Navigate to `/settings/billing` | Billing page loads (placeholder if Stripe not configured) | ⬜ | |

---

### Module 12: Data Retention & Security

| ID | Test Case | Steps | Expected Result | Status | Notes |
|----|-----------|-------|----------------|--------|-------|
| TC-120 | Free tier retention | 1. Set org to `free` plan<br>2. Insert data older than 1 day<br>3. Wait for retention job | Old data purged, only last 24h remains | ⬜ | |
| TC-121 | Pro tier retention | 1. Verify Pro org retains 30 days of data | Data older than 30 days purged | ⬜ | |
| TC-122 | Collector health endpoint | 1. `curl http://localhost:3001/health` | Returns `{"status":"ok"}` | ⬜ | |
| TC-123 | API error handling | 1. Send malformed requests to API | Returns proper error codes (400/404/500), no crashes | ⬜ | |

---

### Module 13: Spec 5 Extended Features (Phase 11)

| ID | Test Case | Steps | Expected Result | Status | Notes |
|----|-----------|-------|----------------|--------|-------|
| TC-124 | Query Percentiles Tracking | 1. Query `/api/databases/:id/queries/percentiles` | Returns P50, P95, P99, and variance ratio per query | ⬜ | Spec §3 |
| TC-125 | Storage I/O Diagnostics | 1. Query `/api/databases/:id/io-diagnostics` | Returns `track_io_timing` status and queries with disk stall warnings | ⬜ | Spec §4 |
| TC-126 | Autovacuum Starvation Sentinel | 1. Query `/api/databases/:id/autovacuum/starvation` | Returns worker saturation status and starved table dead tuple metrics | ⬜ | Spec §5 |
| TC-127 | Remote Session Termination API | 1. POST `/api/databases/:id/sessions/:pid/terminate` with Admin role | Executes `pg_terminate_backend` and returns termination confirmation | ⬜ | Spec §6.2 |
| TC-128 | Interactive Slack ChatOps Webhook | 1. POST `/api/webhooks/slack/interactions` with valid HMAC and session kill payload | Validates HMAC signature and terminates backend PID with card update | ⬜ | Spec §6.1 |

---

## 3. UAT Sign-Off

### Summary

| Module | Total | Passed | Failed | Blocked | Notes |
|--------|-------|--------|--------|---------|-------|
| DB Registration | 5 | | | | |
| Dashboard & Monitoring | 9 | | | | |
| Root-Cause Hints | 4 | | | | |
| Alerting | 11 | | | | |
| Query Performance | 6 | | | | |
| Index Advisor | 6 | | | | |
| Vacuum & Health | 5 | | | | |
| Phases 8–10 Pages | 5 | | | | |
| Onboarding Wizard | 5 | | | | |
| Team Management | 5 | | | | |
| UI / UX | 10 | | | | |
| Retention & Security | 4 | | | | |
| Spec 5 Extended Features (Phase 11) | 5 | | | | |
| **TOTAL** | **80** | | | | |

### Approval

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Tester | | | |
| Developer | | | |
| Product Owner | | | |

### Known Issues Found

| # | Test ID | Severity | Description | Status |
|---|---------|----------|-------------|--------|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |
