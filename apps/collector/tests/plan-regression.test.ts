import { describe, it, expect } from "vitest";
import {
  analyzePlanRegression,
  detectPlanFlags,
} from "../src/collector/plan-regression-collector.js";

describe("Plan Regression Detection Engine", () => {
  it("detects index scan to seq scan degradation as critical", () => {
    const oldPlan = {
      topNodeType: "Index Scan",
      planShapeHash: "abc12345",
      estimatedCost: 12.5,
      planFlags: {},
    };

    const newPlan = {
      topNodeType: "Seq Scan",
      planShapeHash: "def67890",
      estimatedCost: 450.0,
      planFlags: {
        seq_scan_large_table: true,
        seq_scan_table: "users",
        seq_scan_rows: 50000,
      },
    };

    const result = analyzePlanRegression(oldPlan, newPlan);
    expect(result).not.toBeNull();
    expect(result?.isRegression).toBe(true);
    expect(result?.severity).toBe("critical");
    expect(result?.summary).toContain("Index scan dropped");
    expect(result?.remediationSql).toBe("ANALYZE users;");
  });

  it("detects hash join to nested loop degradation", () => {
    const oldPlan = {
      topNodeType: "Hash Join",
      planShapeHash: "hashjoin1",
      estimatedCost: 80.0,
      planFlags: {},
    };

    const newPlan = {
      topNodeType: "Nested Loop",
      planShapeHash: "nestedloop1",
      estimatedCost: 180.0,
      planFlags: {
        nested_loop_high_rows: true,
        nested_loop_rows: 25000,
      },
    };

    const result = analyzePlanRegression(oldPlan, newPlan);
    expect(result).not.toBeNull();
    expect(result?.isRegression).toBe(true);
    expect(result?.severity).toBe("warning");
    expect(result?.summary).toContain("Nested Loop");
  });

  it("detects significant cost surges (>= 30%) even with similar top node", () => {
    const oldPlan = {
      topNodeType: "Seq Scan",
      planShapeHash: "seqscan1",
      estimatedCost: 100.0,
      planFlags: {},
    };

    const newPlan = {
      topNodeType: "Seq Scan",
      planShapeHash: "seqscan2",
      estimatedCost: 240.0, // +140%
      planFlags: {},
    };

    const result = analyzePlanRegression(oldPlan, newPlan);
    expect(result).not.toBeNull();
    expect(result?.isRegression).toBe(true);
    expect(result?.severity).toBe("critical");
    expect(result?.summary).toContain("+140%");
  });

  it("returns null for stable plans", () => {
    const oldPlan = {
      topNodeType: "Index Scan",
      planShapeHash: "stablehash",
      estimatedCost: 15.0,
      planFlags: {},
    };

    const newPlan = {
      topNodeType: "Index Scan",
      planShapeHash: "stablehash",
      estimatedCost: 15.2,
      planFlags: {},
    };

    const result = analyzePlanRegression(oldPlan, newPlan);
    expect(result).toBeNull();
  });
});

describe("detectPlanFlags", () => {
  it("flags large table sequential scans", () => {
    const rootNode = {
      "Node Type": "Seq Scan",
      "Plan Rows": 15000,
      "Relation Name": "orders",
    };

    const flags = detectPlanFlags(rootNode);
    expect(flags.seq_scan_large_table).toBe(true);
    expect(flags.seq_scan_table).toBe("orders");
    expect(flags.seq_scan_rows).toBe(15000);
  });

  it("flags unindexed filters in sequential scans", () => {
    const rootNode = {
      "Node Type": "Seq Scan",
      "Plan Rows": 2000,
      "Relation Name": "audit_logs",
      "Filter": "(created_at > '2026-01-01'::timestamp)",
    };

    const flags = detectPlanFlags(rootNode);
    expect(flags.unindexed_filter).toBe(true);
  });
});
