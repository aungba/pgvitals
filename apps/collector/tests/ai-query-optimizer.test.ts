import { describe, it, expect } from "vitest";
import {
  analyzeQueryHeuristically,
  optimizeQueryWithAi,
} from "../src/collector/ai-query-optimizer.js";
import type { PlanNode } from "../src/lib/explain-executor.js";

describe("AI Query Explainer & Rewriter", () => {
  it("detects SELECT * wildcard projection", () => {
    const sql = "SELECT * FROM orders WHERE status = 'pending'";
    const result = analyzeQueryHeuristically(sql);

    expect(result.bottlenecks.some((b) => b.title.includes("Wildcard Projection"))).toBe(true);
    expect(result.provider).toBe("heuristic");
  });

  it("detects non-sargable function wrap on date/timestamp columns", () => {
    const sql = "SELECT id, total FROM orders WHERE DATE(created_at) = '2026-03-01'";
    const result = analyzeQueryHeuristically(sql);

    const nonSargable = result.bottlenecks.find((b) => b.title.includes("Non-Sargable Function"));
    expect(nonSargable).toBeDefined();
    expect(nonSargable?.severity).toBe("critical");
    expect(result.estimatedSpeedup).toContain("speedup");
  });

  it("detects NOT IN subqueries and rewrites them using NOT EXISTS", () => {
    const sql = "SELECT id FROM users WHERE id NOT IN (SELECT user_id FROM orders WHERE total > 100)";
    const result = analyzeQueryHeuristically(sql);

    const notInIssue = result.bottlenecks.find((b) => b.title.includes("NOT IN"));
    expect(notInIssue).toBeDefined();
    expect(result.rewrittenSql).toContain("NOT EXISTS");
  });

  it("detects Sequential Scans and External Sort Spills from plan JSON", () => {
    const planJson: PlanNode[] = [
      {
        "Node Type": "Sort",
        "Total Cost": 4500.5,
        "Sort Method": "external merge Disk: 15360kB",
        Plans: [
          {
            "Node Type": "Seq Scan",
            "Relation Name": "audit_logs",
            "Total Cost": 3200.0,
            "Plan Rows": 150000,
          },
        ],
      },
    ];

    const sql = "SELECT * FROM audit_logs ORDER BY event_timestamp DESC";
    const result = analyzeQueryHeuristically(sql, planJson, 240, 1500);

    expect(result.bottlenecks.some((b) => b.title.includes("Sequential Scan on `audit_logs`"))).toBe(true);
    expect(result.bottlenecks.some((b) => b.title.includes("External Disk Sort Spill"))).toBe(true);
  });

  it("generates recommended index DDL for WHERE filter predicates", () => {
    const sql = "SELECT id, user_id, amount FROM transactions WHERE account_id = $1 AND status = $2";
    const result = analyzeQueryHeuristically(sql);

    expect(result.recommendedIndexes.length).toBeGreaterThanOrEqual(1);
    expect(result.recommendedIndexes[0].indexDdl).toContain("CREATE INDEX CONCURRENTLY");
    expect(result.recommendedIndexes[0].indexDdl).toContain("account_id");
  });

  it("optimizeQueryWithAi runs successfully in offline / heuristic mode", async () => {
    const res = await optimizeQueryWithAi({
      queryText: "SELECT * FROM products WHERE category_id = 5 ORDER BY price ASC",
      meanLatencyMs: 85,
      calls: 320,
    });

    expect(res.summary).toBeDefined();
    expect(res.rewrittenSql).toBeDefined();
    expect(res.provider).toBe("heuristic");
  });
});
