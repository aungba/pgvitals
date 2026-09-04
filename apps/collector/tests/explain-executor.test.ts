import { describe, it, expect } from "vitest";
import {
  isUtilityStatement,
  isDmlStatement,
  isQueryTruncated,
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

  describe("isDmlStatement", () => {
    it("identifies DML modification queries", () => {
      expect(isDmlStatement("INSERT INTO users (name) VALUES ($1)")).toBe(true);
      expect(isDmlStatement("UPDATE accounts SET balance = 100 WHERE id = 1")).toBe(true);
      expect(isDmlStatement("UPDATE users u SET balance = 100 WHERE u.id = 1")).toBe(true);
      expect(isDmlStatement("UPDATE ONLY users SET balance = 100 WHERE id = 1")).toBe(true);
      expect(isDmlStatement("UPDATE users AS u SET balance = 100 WHERE u.id = 1")).toBe(true);
      expect(isDmlStatement("DELETE FROM sessions WHERE expired_at < now()")).toBe(true);
      expect(isDmlStatement("DELETE FROM ONLY sessions WHERE expired_at < now()")).toBe(true);
      expect(isDmlStatement("MERGE INTO target USING source ON target.id = source.id WHEN MATCHED THEN UPDATE SET v = source.v")).toBe(true);
      expect(isDmlStatement("/* comment */ UPDATE tbl SET val = 1")).toBe(true);
      expect(isDmlStatement("WITH moved AS (DELETE FROM old_orders RETURNING *) SELECT * FROM moved")).toBe(true);
    });

    it("identifies non-DML queries", () => {
      expect(isDmlStatement("SELECT * FROM users WHERE id = 1")).toBe(false);
      expect(isDmlStatement("SELECT \"update\", \"set\" FROM logs")).toBe(false);
      expect(isDmlStatement("WITH cte AS (SELECT id FROM users) SELECT * FROM cte")).toBe(false);
    });
  });

  describe("isQueryTruncated", () => {
    it("detects queries with unclosed parentheses", () => {
      expect(isQueryTruncated("SELECT * FROM users WHERE id IN (1, 2, 3")).toBe(true);
      expect(isQueryTruncated("SELECT COALESCE((SELECT name FROM roles WHERE id = 1")).toBe(true);
    });

    it("detects queries with unclosed string literals", () => {
      expect(isQueryTruncated("SELECT * FROM users WHERE name = 'John Doe")).toBe(true);
    });

    it("detects queries with unclosed block comments", () => {
      expect(isQueryTruncated("SELECT * FROM users WHERE id = 1 /* unfinished comment")).toBe(true);
    });

    it("detects queries ending with trailing punctuation or keywords", () => {
      expect(isQueryTruncated("SELECT id, name,")).toBe(true);
      expect(isQueryTruncated("INSERT INTO users VALUES (1, 'a'), (")).toBe(true);
      expect(isQueryTruncated("SELECT * FROM users WHERE")).toBe(true);
      expect(isQueryTruncated("SELECT * FROM users WHERE id = 1 AND")).toBe(true);
      expect(isQueryTruncated("SELECT * FROM users JOIN roles ON")).toBe(true);
      expect(isQueryTruncated("SELECT * FROM users WHERE id = 1 +")).toBe(true);
      expect(isQueryTruncated("SELECT col FROM users WHERE CASE")).toBe(true);
      expect(isQueryTruncated("SELECT col FROM users WHERE CASE WHEN a = 1 THEN")).toBe(true);
      expect(
        isQueryTruncated(`
          SELECT tnt025.syskey,
                 CASE WHEN a = 1 THEN 'ok' END AS aging,
                 CASE
        `)
      ).toBe(true);
    });

    it("does not false-positive on comments with parentheses or apostrophes", () => {
      const queryWithParenInComment = `
        SELECT * FROM users
        -- filter (only active accounts
        WHERE id = 1;
      `;
      expect(isQueryTruncated(queryWithParenInComment)).toBe(false);

      const queryWithApostropheInComment = `
        SELECT * FROM users
        -- don't delete anything
        WHERE id = 1;
      `;
      expect(isQueryTruncated(queryWithApostropheInComment)).toBe(false);

      const queryWithBlockComment = `
        SELECT * FROM users /* (special note) */ WHERE id = 1
      `;
      expect(isQueryTruncated(queryWithBlockComment)).toBe(false);
    });

    it("returns false for complete, valid queries", () => {
      expect(isQueryTruncated("SELECT * FROM users WHERE id = 1")).toBe(false);
      expect(isQueryTruncated("SELECT * FROM users WHERE id = 1;")).toBe(false);
      expect(isQueryTruncated("SELECT * FROM users WHERE id IN (1, 2, 3)")).toBe(false);
      expect(isQueryTruncated("SELECT * FROM users WHERE name = 'O''Reilly'")).toBe(false);
      expect(isQueryTruncated("WITH cte AS (SELECT 1 AS n) SELECT * FROM cte")).toBe(false);
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

    it("replaces context-sensitive clauses like AT TIME ZONE, EXTRACT, ON, array indexing, and TO_CHAR", () => {
      const query = `
        SELECT
          t.created_at AT TIME ZONE $1 AS tz_date,
          EXTRACT($2 FROM t.created_at) AS hr,
          t.matrix[$3] AS first_val,
          TO_CHAR(t.created_at, $4) AS formatted
        FROM table_a t
        JOIN table_b ON $5
        WHERE t.id = $6
      `;
      const substituted = substituteQueryParameters(query, "number");
      expect(substituted).toContain("AT TIME ZONE 'UTC'");
      expect(substituted).toContain("EXTRACT(epoch FROM t.created_at)");
      expect(substituted).toContain("t.matrix[1]");
      expect(substituted).toContain("TO_CHAR(t.created_at, 'YYYY-MM-DD')");
      expect(substituted).toContain("JOIN table_b ON true");
      expect(substituted).toContain("WHERE t.id = 1");
    });

    it("handles complex nested TO_CHAR and parenthesized ON conditions", () => {
      const query = `
        SELECT TO_CHAR(COALESCE(t.created_at, NOW()), $1) AS formatted
        FROM table_a t
        JOIN table_b ON ($2)
      `;
      const substituted = substituteQueryParameters(query, "string");
      expect(substituted).toContain("TO_CHAR(COALESCE(t.created_at, NOW()), 'YYYY-MM-DD')");
      expect(substituted).toContain("JOIN table_b ON (true)");
    });

    it("replaces INTERVAL parameters with valid interval literals", () => {
      const query = "SELECT now() + INTERVAL $1 + 10 * INTERVAL $2";
      const substituted = substituteQueryParameters(query, "null");
      expect(substituted).toContain("INTERVAL '1 second'");
      expect(substituted).not.toContain("INTERVAL NULL");
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
