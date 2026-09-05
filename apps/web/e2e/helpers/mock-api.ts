import type { Page } from "@playwright/test";

export const MOCK_DB_ID = "00000000-0000-0000-0000-000000000001";

export async function setupApiMocks(page: Page) {
  page.on("console", (msg) => console.log("BROWSER CONSOLE:", msg.text()));
  page.on("request", (req) => console.log("REQUEST:", req.method(), req.url()));
  page.on("response", (res) => console.log("RESPONSE:", res.status(), res.url()));

  await page.route(/.*\/api\/.*/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;

    // 1. GET /api/databases (exact match)
    if (path === "/api/databases" && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          databases: [
            {
              id: MOCK_DB_ID,
              name: "production-primary",
              connectionString: "postgresql://***:***@localhost:5432/production",
              environment: "production",
              isActive: true,
              createdAt: "2026-01-01T00:00:00Z",
              updatedAt: "2026-01-01T00:00:00Z",
            },
          ],
        }),
      });
    }

    // 2. GET /api/databases/:id/overview
    if (path === `/api/databases/${MOCK_DB_ID}/overview`) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          database: { id: MOCK_DB_ID, name: "production-primary" },
          snapshot: {
            id: "snap-1",
            databaseId: MOCK_DB_ID,
            connectionCount: 42,
            activeCount: 8,
            idleCount: 30,
            idleInTxnCount: 2,
            idleInTxnAbortedCount: 0,
            maxConnections: 100,
            timestamp: new Date().toISOString(),
          },
          utilization: {
            percent: 42,
            connectionCount: 42,
            maxConnections: 100,
          },
          health: {
            cacheHitRatio: 99.4,
            dbSizeBytes: 10737418240,
            tempFileBytes: 0,
            numBackends: 42,
            xactCommit: 154200,
            xactRollback: 12,
            deadlocksCount: 0,
            capturedAt: new Date().toISOString(),
          },
        }),
      });
    }

    // 3. GET /api/databases/:id/query-stats/status
    if (path === `/api/databases/${MOCK_DB_ID}/query-stats/status`) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          available: true,
          version: "1.10",
        }),
      });
    }

    // 4. GET /api/databases/:id/query-suggestions
    if (path === `/api/databases/${MOCK_DB_ID}/query-suggestions`) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          suggestions: [],
        }),
      });
    }

    // 5. POST /api/databases/:id/queries/ai-optimize
    if (path === `/api/databases/${MOCK_DB_ID}/queries/ai-optimize` && method === "POST") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          summary: "Query performs an unindexed sequential scan on orders table.",
          bottlenecks: [
            {
              title: "Sequential Scan on `orders`",
              severity: "critical",
              explanation: "No index covers the customer_id predicate, forcing 500,000 row inspections.",
              suggestion: "Add a B-Tree index on orders(customer_id, created_at).",
            },
            {
              title: "Wildcard Projection (`SELECT *`)",
              severity: "warning",
              explanation: "Retrieves all columns, preventing index-only scan optimization.",
              suggestion: "Specify only needed columns.",
            },
          ],
          rewrittenSql: `-- PG Vitals Optimized Query\nSELECT id, total_amount, created_at\nFROM orders\nWHERE customer_id = $1\nORDER BY created_at DESC\nLIMIT 20;`,
          recommendedIndexes: [
            {
              tableName: "orders",
              indexDdl: "CREATE INDEX CONCURRENTLY idx_orders_customer_created ON orders (customer_id, created_at DESC);",
              reason: "Enables index-only scan and eliminates Sort node.",
            },
          ],
          estimatedSpeedup: "15x - 40x speedup",
          provider: "heuristic",
        }),
      });
    }

    // 6. GET /api/databases/:id/queries/:queryid/explains
    if (path.includes(`/api/databases/${MOCK_DB_ID}/queries/`) && path.endsWith("/explains")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          explains: [],
        }),
      });
    }

    // 7. GET /api/databases/:id/queries/:queryid (single query detail)
    const singleQueryMatch = path.match(new RegExp(`/api/databases/${MOCK_DB_ID}/queries/(\\d+)`));
    if (singleQueryMatch) {
      const qid = parseInt(singleQueryMatch[1], 10);
      const q = {
        id: "q-1",
        queryid: qid,
        queryText: "SELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 20",
        calls: 15400,
        totalTimeMs: 462000,
        meanTimeMs: 30.0,
        maxTimeMs: 250.0,
        minTimeMs: 1.2,
        rowsReturned: 308000,
        rowsPerCall: 20,
        sharedBlksHit: 95000,
        sharedBlksRead: 4500,
        tempBlksWritten: 0,
        pctOfTotalTime: 38.5,
      };
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          query: q,
          timeSeries: [q],
        }),
      });
    }

    // 8. GET /api/databases/:id/queries
    if (path === `/api/databases/${MOCK_DB_ID}/queries`) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          queries: [
            {
              id: "q-1",
              queryid: 123456789,
              queryText: "SELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 20",
              calls: 15400,
              totalTimeMs: 462000,
              meanTimeMs: 30.0,
              maxTimeMs: 250.0,
              minTimeMs: 1.2,
              rowsReturned: 308000,
              rowsPerCall: 20,
              sharedBlksHit: 95000,
              sharedBlksRead: 4500,
              tempBlksWritten: 0,
              pctOfTotalTime: 38.5,
            },
            {
              id: "q-2",
              queryid: 987654321,
              queryText: "SELECT id, email, status FROM users WHERE status = 'active' AND last_login < $1",
              calls: 4200,
              totalTimeMs: 126000,
              meanTimeMs: 12.0,
              maxTimeMs: 95.0,
              minTimeMs: 0.8,
              rowsReturned: 42000,
              rowsPerCall: 10,
              sharedBlksHit: 40000,
              sharedBlksRead: 1200,
              tempBlksWritten: 0,
              pctOfTotalTime: 18.2,
            },
          ],
          latestCapturedAt: new Date().toISOString(),
          totalQueries: 2,
          monitoredDbId: MOCK_DB_ID,
        }),
      });
    }

    // 9. GET /api/databases/:id/guc-advice
    if (path === `/api/databases/${MOCK_DB_ID}/guc-advice`) {
      const ramGb = Number(url.searchParams.get("totalRamGb")) || 8;
      const is32Gb = ramGb >= 32;

      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          databaseId: MOCK_DB_ID,
          databaseName: "production-primary",
          report: {
            profile: {
              totalRamGb: ramGb,
              cpuCores: 4,
              diskType: "ssd",
              workloadType: "web",
              maxConnections: 100,
            },
            summary: {
              totalEvaluated: 18,
              optimalCount: 12,
              warningCount: 4,
              criticalCount: 2,
              restartRequiredCount: 3,
            },
            recommendations: [
              {
                name: "shared_buffers",
                category: "memory",
                currentValue: "16384",
                currentValueFormatted: "128MB",
                recommendedValue: is32Gb ? "8GB" : "2GB",
                recommendedValueFormatted: is32Gb ? "8GB" : "2GB",
                status: "critical",
                restartRequired: true,
                context: "postmaster",
                unit: "8kB",
                reason: "Default 128MB shared_buffers is critically undersized for production workloads.",
              },
              {
                name: "work_mem",
                category: "memory",
                currentValue: "4096",
                currentValueFormatted: "4MB",
                recommendedValue: is32Gb ? "64MB" : "16MB",
                recommendedValueFormatted: is32Gb ? "64MB" : "16MB",
                status: "warning",
                restartRequired: false,
                context: "user",
                unit: "kB",
                reason: "Sized to allow in-memory sorts without spilling to temp disk files.",
              },
              {
                name: "random_page_cost",
                category: "storage",
                currentValue: "4.0",
                currentValueFormatted: "4.0",
                recommendedValue: "1.1",
                recommendedValueFormatted: "1.1",
                status: "warning",
                restartRequired: false,
                context: "user",
                unit: null,
                reason: "SSD storage has near-equal random vs sequential access times.",
              },
              {
                name: "track_io_timing",
                category: "diagnostics",
                currentValue: "off",
                currentValueFormatted: "off",
                recommendedValue: "on",
                recommendedValueFormatted: "on",
                status: "warning",
                restartRequired: false,
                context: "sighup",
                unit: null,
                reason: "Essential for detecting I/O stalls in pg_stat_statements.",
              },
            ],
            alterSystemSql: `-- PG Vitals Automated GUC Recommendations\nALTER SYSTEM SET shared_buffers = '${is32Gb ? "8GB" : "2GB"}';\nALTER SYSTEM SET work_mem = '${is32Gb ? "64MB" : "16MB"}';\nALTER SYSTEM SET random_page_cost = '1.1';\nALTER SYSTEM SET track_io_timing = 'on';\nSELECT pg_reload_conf();`,
            postgresqlConfSnippet: `# PG Vitals Configuration Snippet\nshared_buffers = '${is32Gb ? "8GB" : "2GB"}'\nwork_mem = '${is32Gb ? "64MB" : "16MB"}'\nrandom_page_cost = '1.1'\ntrack_io_timing = 'on'`,
          },
        }),
      });
    }

    // 10. GET /api/databases/:id (single database lookup)
    if (path === `/api/databases/${MOCK_DB_ID}` && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          database: {
            id: MOCK_DB_ID,
            name: "production-primary",
            connectionString: "postgresql://***:***@localhost:5432/production",
            environment: "production",
            isActive: true,
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
        }),
      });
    }

    // 11. Billing status
    if (path === "/api/billing/status") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          planTier: "pro",
          effectivePlanTier: "pro",
          isTrialActive: false,
          trialDaysRemaining: null,
          trialEndsAt: null,
          hasStripeCustomer: true,
          hasSubscription: true,
          currentDbCount: 1,
          maxDatabases: 5,
        }),
      });
    }

    // 12. GET /api/databases/:id/alerts/active
    if (path.includes("/alerts/active")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ alerts: [] }),
      });
    }

    // 13. GET /api/databases/:id/hints
    if (path.includes("/hints")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ hints: [], total: 0 }),
      });
    }

    // 14. GET /api/databases/:id/sessions
    if (path.includes("/sessions")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ snapshotId: null, snapshotTimestamp: null, sessions: [] }),
      });
    }

    // 15. GET /api/databases/:id/snapshots
    if (path.includes("/snapshots")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ snapshots: [] }),
      });
    }

    // 16. GET /api/databases/:id/schema-events
    if (path.includes("/schema-events")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ events: [] }),
      });
    }

    // Default fallback
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({}),
    });
  });
}
