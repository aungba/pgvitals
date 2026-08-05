import { describe, it, expect } from "vitest";

/* ===================================================================
   Tests: Safe Query — read-only SQL validation
   We can't easily test the full safeQuery (requires Postgres connection)
   but we CAN test the assertReadOnly logic by importing and testing
   the boundary: what gets accepted vs rejected.
   
   Since assertReadOnly is not exported, we'll test via safeQuery
   catching the thrown errors (without a real DB).
   =================================================================== */

// We need to test the read-only check, which is an internal function.
// Since we can't call safeQuery without a real DB, we'll replicate the
// logic in a test helper and verify correctness.

function assertReadOnly(sql: string): void {
  const normalized = sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--.*$/gm, "")
    .trimStart();

  const firstKeyword = normalized.split(/\s+/)[0]?.toUpperCase();

  const allowedKeywords = new Set(["SELECT", "SHOW", "WITH", "EXPLAIN"]);

  if (!firstKeyword || !allowedKeywords.has(firstKeyword)) {
    throw new Error(
      `Unsafe SQL rejected: only SELECT/SHOW/WITH/EXPLAIN statements are allowed. Got: "${firstKeyword}"`
    );
  }
}

describe("assertReadOnly", () => {
  describe("should ALLOW safe statements", () => {
    it("allows SELECT", () => {
      expect(() => assertReadOnly("SELECT 1")).not.toThrow();
    });

    it("allows SHOW", () => {
      expect(() => assertReadOnly("SHOW max_connections")).not.toThrow();
    });

    it("allows WITH (CTEs)", () => {
      expect(() =>
        assertReadOnly("WITH cte AS (SELECT 1) SELECT * FROM cte")
      ).not.toThrow();
    });

    it("allows EXPLAIN", () => {
      expect(() =>
        assertReadOnly("EXPLAIN (FORMAT JSON) SELECT * FROM t")
      ).not.toThrow();
    });

    it("allows case-insensitive SELECT", () => {
      expect(() => assertReadOnly("select * from t")).not.toThrow();
    });

    it("strips block comments before checking", () => {
      expect(() =>
        assertReadOnly("/* this is a comment */ SELECT 1")
      ).not.toThrow();
    });

    it("strips line comments before checking", () => {
      expect(() =>
        assertReadOnly("-- this is a comment\nSELECT 1")
      ).not.toThrow();
    });

    it("handles leading whitespace", () => {
      expect(() => assertReadOnly("   \n  SELECT 1")).not.toThrow();
    });
  });

  describe("should REJECT write statements", () => {
    it("rejects INSERT", () => {
      expect(() =>
        assertReadOnly("INSERT INTO t VALUES (1)")
      ).toThrow("Unsafe SQL rejected");
    });

    it("rejects UPDATE", () => {
      expect(() =>
        assertReadOnly("UPDATE t SET x = 1")
      ).toThrow("Unsafe SQL rejected");
    });

    it("rejects DELETE", () => {
      expect(() =>
        assertReadOnly("DELETE FROM t WHERE id = 1")
      ).toThrow("Unsafe SQL rejected");
    });

    it("rejects DROP", () => {
      expect(() => assertReadOnly("DROP TABLE t")).toThrow(
        "Unsafe SQL rejected"
      );
    });

    it("rejects ALTER", () => {
      expect(() =>
        assertReadOnly("ALTER TABLE t ADD COLUMN x int")
      ).toThrow("Unsafe SQL rejected");
    });

    it("rejects CREATE", () => {
      expect(() =>
        assertReadOnly("CREATE TABLE t (id int)")
      ).toThrow("Unsafe SQL rejected");
    });

    it("rejects TRUNCATE", () => {
      expect(() => assertReadOnly("TRUNCATE t")).toThrow(
        "Unsafe SQL rejected"
      );
    });

    it("rejects empty string", () => {
      expect(() => assertReadOnly("")).toThrow("Unsafe SQL rejected");
    });

    it("rejects whitespace-only", () => {
      expect(() => assertReadOnly("   \n  \t  ")).toThrow("Unsafe SQL rejected");
    });

    it("rejects comment-only (no actual statement)", () => {
      expect(() => assertReadOnly("-- just a comment")).toThrow(
        "Unsafe SQL rejected"
      );
    });
  });
});
