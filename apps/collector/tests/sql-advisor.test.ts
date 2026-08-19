import { describe, it, expect } from "vitest";
import { analyzeSqlAdvice } from "../src/collector/sql-advisor";

describe("SQL-Aware Index & Query Advisor", () => {
  it("generates partial covering index for multi-column point-lookup with NULL filters", () => {
    const sql = `SELECT t2, t3, t6 FROM "tnt031" WHERE t2 = $1 AND t3 = $2 AND t6 is not NULL and t7 is NULL`;
    const advice = analyzeSqlAdvice(sql, 28_680_504, 4.6, 18.5);

    expect(advice.tableName).toBe("tnt031");
    expect(advice.equalityColumns).toEqual(["t2", "t3"]);
    expect(advice.partialConditions).toEqual(["t6 IS NOT NULL", "t7 IS NULL"]);
    expect(advice.projectionColumns).toEqual(["t2", "t3", "t6"]);
    expect(advice.recommendedIndexDdl).toBe(
      `CREATE INDEX CONCURRENTLY idx_tnt031_t2_t3_opt ON "tnt031" (t2, t3) INCLUDE (t6) WHERE t6 IS NOT NULL AND t7 IS NULL;`
    );
    expect(advice.totalTimeHours).toBe(36.6);
    expect(advice.estimatedSavingsHours).toBeGreaterThanOrEqual(36.0);
    expect(advice.estimatedSavingsPct).toBeGreaterThanOrEqual(98);
  });

  it("generates composite index for standard WHERE equality filters", () => {
    const sql = `SELECT id, name, email FROM users WHERE org_id = $1 AND role = $2 AND status = 'active'`;
    const advice = analyzeSqlAdvice(sql, 50_000, 2.5);

    expect(advice.tableName).toBe("users");
    expect(advice.equalityColumns).toEqual(["org_id", "role", "status"]);
    expect(advice.recommendedIndexDdl).toBe(
      `CREATE INDEX CONCURRENTLY idx_users_org_id_role_opt ON "users" (org_id, role, status) INCLUDE (id, name, email);`
    );
  });

  it("handles queries without where clause safely", () => {
    const sql = `SELECT count(*) FROM orders`;
    const advice = analyzeSqlAdvice(sql, 100, 50.0);

    expect(advice.tableName).toBe("orders");
    expect(advice.equalityColumns).toEqual([]);
    expect(advice.recommendedIndexDdl).toBeNull();
  });
});
