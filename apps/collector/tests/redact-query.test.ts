import { describe, it, expect } from "vitest";
import { redactQueryLiterals } from "../src/lib/redact-query.js";

/* ===================================================================
   Tests: Query Text Redaction
   Spec §10 — best-effort PII stripping from captured SQL
   =================================================================== */

describe("redactQueryLiterals", () => {
  describe("string literals", () => {
    it("should redact single-quoted strings", () => {
      const result = redactQueryLiterals("SELECT * FROM users WHERE email = 'john@example.com'");
      expect(result).not.toContain("john@example.com");
      expect(result).toContain("$1");
    });

    it("should handle escaped quotes inside strings", () => {
      const result = redactQueryLiterals("SELECT * FROM t WHERE name = 'O''Brien'");
      expect(result).not.toContain("O''Brien");
      expect(result).toContain("$1");
    });

    it("should redact multiple string literals with incrementing placeholders", () => {
      const result = redactQueryLiterals(
        "INSERT INTO t (a, b) VALUES ('hello', 'world')"
      );
      expect(result).not.toContain("hello");
      expect(result).not.toContain("world");
      expect(result).toContain("$1");
      expect(result).toContain("$2");
    });

    it("should handle empty strings", () => {
      const result = redactQueryLiterals("SELECT * FROM t WHERE val = ''");
      expect(result).toContain("$1");
    });
  });

  describe("numeric literals", () => {
    it("should redact integers", () => {
      const result = redactQueryLiterals("SELECT * FROM users WHERE id = 42");
      expect(result).not.toContain("42");
    });

    it("should redact decimals", () => {
      const result = redactQueryLiterals("SELECT * FROM products WHERE price > 19.99");
      expect(result).not.toContain("19.99");
    });

    it("should redact scientific notation", () => {
      const result = redactQueryLiterals("SELECT * FROM t WHERE val = 1.5e10");
      expect(result).not.toContain("1.5e10");
    });

    it("should NOT mangle column names with numbers (e.g. col1)", () => {
      const result = redactQueryLiterals("SELECT col1, col2 FROM table1");
      expect(result).toContain("col1");
      expect(result).toContain("col2");
      expect(result).toContain("table1");
    });
  });

  describe("UUIDs", () => {
    it("should redact UUID-like patterns", () => {
      const result = redactQueryLiterals(
        "SELECT * FROM orders WHERE id = 550e8400-e29b-41d4-a716-446655440000"
      );
      expect(result).not.toContain("550e8400-e29b-41d4-a716-446655440000");
    });
  });

  describe("hex literals", () => {
    it("should redact 0x-prefixed hex", () => {
      const result = redactQueryLiterals("SELECT * FROM t WHERE flags = 0xFF");
      expect(result).not.toContain("0xFF");
    });

    it("should redact x'...' hex strings", () => {
      const result = redactQueryLiterals("SELECT * FROM t WHERE data = x'DEADBEEF'");
      expect(result).not.toContain("DEADBEEF");
    });
  });

  describe("boolean literals", () => {
    it("should redact TRUE", () => {
      const result = redactQueryLiterals("SELECT * FROM t WHERE active = TRUE");
      expect(result).not.toMatch(/\bTRUE\b/);
    });

    it("should redact FALSE (case-insensitive)", () => {
      const result = redactQueryLiterals("SELECT * FROM t WHERE deleted = false");
      expect(result).not.toMatch(/\bfalse\b/i);
    });
  });

  describe("dollar-quoted strings", () => {
    it("should redact $$...$$ blocks", () => {
      const result = redactQueryLiterals(
        "CREATE FUNCTION f() RETURNS void AS $$BEGIN RAISE NOTICE 'hi';END$$ LANGUAGE plpgsql"
      );
      expect(result).not.toContain("BEGIN RAISE NOTICE");
    });
  });

  describe("edge cases", () => {
    it("should return empty string for empty input", () => {
      expect(redactQueryLiterals("")).toBe("");
    });

    it("should return null/undefined as-is", () => {
      expect(redactQueryLiterals(null as unknown as string)).toBeNull();
      expect(redactQueryLiterals(undefined as unknown as string)).toBeUndefined();
    });

    it("should preserve SQL structure", () => {
      const sql = "SELECT u.name FROM users u WHERE u.age > 21 AND u.email = 'test@test.com'";
      const result = redactQueryLiterals(sql);
      expect(result).toContain("SELECT u.name FROM users u WHERE u.age >");
      expect(result).toContain("AND u.email =");
    });

    it("should preserve existing $N parameter placeholders", () => {
      const sql = "SELECT * FROM users WHERE id = $1 AND name = $2";
      const result = redactQueryLiterals(sql);
      expect(result).toContain("$1");
      expect(result).toContain("$2");
    });

    it("should redact embedded JSON literals and casts", () => {
      const sql = "UPDATE configs SET data = '{\"api_key\": \"secret123\", \"port\": 5432}'::jsonb WHERE id = 1";
      const result = redactQueryLiterals(sql);
      expect(result).not.toContain("secret123");
      expect(result).not.toContain("5432");
      expect(result).toContain("::jsonb");
    });

    it("should redact sensitive credentials in SQL comments", () => {
      const sql = "SELECT 1; -- password=supersecret\nSELECT 2; /* token: abcdef123456 */";
      const result = redactQueryLiterals(sql);
      expect(result).not.toContain("supersecret");
      expect(result).not.toContain("abcdef123456");
      expect(result).toContain("[REDACTED]");
    });
  });
});
