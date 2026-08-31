import { describe, it, expect } from "vitest";
import {
  isUtilityStatement,
  extractParameterInfo,
  applyUserParameters,
  substituteQueryParameters,
  extractNodeTypes,
  hashPlanShape,
  detectPlanFlags,
  parsePlanWarnings,
  type PlanNode,
} from "../src/lib/explain-executor.js";

describe("Explain Executor Library", () => {
  describe("isUtilityStatement", () => {
    it("identifies non-explainable utility statements", () => {
      expect(isUtilityStatement("SET search_path TO public")).toBe(true);
      expect(isUtilityStatement("RESET ALL")).toBe(true);
      expect(isUtilityStatement("COMMIT")).toBe(true);
      expect(isUtilityStatement("BEGIN")).toBe(true);
      expect(isUtilityStatement("ROLLBACK")).toBe(true);
      expect(isUtilityStatement("VACUUM FULL users")).toBe(true);
      expect(isUtilityStatement("ANALYZE orders")).toBe(true);
      expect(isUtilityStatement("CREATE INDEX idx_test ON tbl(id)")).toBe(true);
    });

    it("identifies explainable queries", () => {
      expect(isUtilityStatement("SELECT * FROM users WHERE id = $1")).toBe(false);
      expect(isUtilityStatement("INSERT INTO orders (id, total) VALUES ($1, $2)")).toBe(false);
      expect(isUtilityStatement("UPDATE accounts SET balance = $1 WHERE id = $2")).toBe(false);
      expect(isUtilityStatement("DELETE FROM sessions WHERE expired_at < $1")).toBe(false);
    });
  });

  describe("extractParameterInfo", () => {
    it("extracts parameter count and markers accurately", () => {
      const info = extractParameterInfo("SELECT * FROM users WHERE id = $1 AND org_id = $2 AND status = $1");
      expect(info.hasParameters).toBe(true);
      expect(info.maxParamIndex).toBe(2);
      expect(info.paramMatches).toContain("$1");
      expect(info.paramMatches).toContain("$2");
    });

    it("handles queries without parameters", () => {
      const info = extractParameterInfo("SELECT count(*) FROM users");
      expect(info.hasParameters).toBe(false);
      expect(info.maxParamIndex).toBe(0);
      expect(info.paramMatches).toHaveLength(0);
    });
  });

  describe("applyUserParameters", () => {
    it("replaces parameters with user supplied values", () => {
      const query = "SELECT * FROM users WHERE id = $1 AND org_id = $2";
      const result = applyUserParameters(query, { "$1": "42", "$2": "'org_abc'" });
      expect(result).toBe("SELECT * FROM users WHERE id = 42 AND org_id = 'org_abc'");
    });

    it("safely handles multi-digit parameter numbers without collision", () => {
      const query = "SELECT * FROM tbl WHERE a = $10 AND b = $1";
      const result = applyUserParameters(query, { "$10": "'ten'", "$1": "'one'" });
      expect(result).toBe("SELECT * FROM tbl WHERE a = 'ten' AND b = 'one'");
    });
  });

  describe("substituteQueryParameters", () => {
    it("replaces LIMIT and OFFSET parameters safely", () => {
      const query = "SELECT * FROM users WHERE tenant_id = $1 ORDER BY id LIMIT $2 OFFSET $3";
      const substituted = substituteQueryParameters(query, "string");
      expect(substituted).toContain("LIMIT 100");
      expect(substituted).toContain("OFFSET 0");
      expect(substituted).not.toContain("$2");
      expect(substituted).not.toContain("$3");
    });

    it("replaces type-casted parameters with valid literals", () => {
      const query = "SELECT * FROM logs WHERE id = $1::uuid AND created_at > $2::timestamptz AND count > $3::int";
      const substituted = substituteQueryParameters(query, "string");
      expect(substituted).toContain("'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid");
      expect(substituted).toContain("NOW()::timestamptz");
      expect(substituted).toContain("1::int");
    });

    it("supports various fallback defaults", () => {
      const query = "SELECT * FROM users WHERE id = $1";
      expect(substituteQueryParameters(query, "string")).toBe("SELECT * FROM users WHERE id = '1'");
      expect(substituteQueryParameters(query, "number")).toBe("SELECT * FROM users WHERE id = 1");
      expect(substituteQueryParameters(query, "null")).toBe("SELECT * FROM users WHERE id = NULL");
      expect(substituteQueryParameters(query, "default")).toBe("SELECT * FROM users WHERE id = DEFAULT");
    });
  });

  describe("extractNodeTypes & hashPlanShape", () => {
    it("extracts DFS node types and hashes plan shape", () => {
      const plan: PlanNode = {
        "Node Type": "Limit",
        Plans: [
          {
            "Node Type": "Nested Loop",
            Plans: [
              { "Node Type": "Index Scan" },
              { "Node Type": "Seq Scan" },
            ],
          },
        ],
      };

      const nodeTypes = extractNodeTypes(plan);
      expect(nodeTypes).toEqual(["Limit", "Nested Loop", "Index Scan", "Seq Scan"]);

      const hash = hashPlanShape(nodeTypes);
      expect(hash).toHaveLength(16);
    });
  });

  describe("detectPlanFlags", () => {
    it("detects large table seq scan and nested loop flags", () => {
      const plan: PlanNode = {
        "Node Type": "Nested Loop",
        "Plan Rows": 12000,
        Plans: [
          {
            "Node Type": "Seq Scan",
            "Plan Rows": 15000,
            "Relation Name": "large_orders",
            "Filter": "(status = 'pending')",
          },
        ],
      };

      const flags = detectPlanFlags(plan);
      expect(flags.nested_loop_high_rows).toBe(true);
      expect(flags.seq_scan_large_table).toBe(true);
      expect(flags.seq_scan_table).toBe("large_orders");
      expect(flags.unindexed_filter).toBe(true);
    });
  });

  describe("parsePlanWarnings", () => {
    it("generates actionable warnings for risky plan patterns", () => {
      const plan = [
        {
          Plan: {
            "Node Type": "Seq Scan",
            "Plan Rows": 50000,
            "Relation Name": "events",
            "Shared Hit Blocks": 10,
            "Shared Read Blocks": 500,
            "Sort Method": "external merge Disk",
          },
        },
      ];

      const warnings = parsePlanWarnings(plan);
      expect(warnings.some((w) => w.type === "seq_scan_large_table")).toBe(true);
      expect(warnings.some((w) => w.type === "high_cache_miss")).toBe(true);
      expect(warnings.some((w) => w.type === "sort_disk_spill")).toBe(true);
    });
  });
});
