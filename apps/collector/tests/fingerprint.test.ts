import { describe, it, expect } from "vitest";
import { hintToAlertType, generateFingerprint } from "../src/alerting/fingerprint.js";
import type { GeneratedHint } from "../src/collector/rules-engine.js";

/* ===================================================================
   Tests: Alert Fingerprinting + Alert Type Mapping
   =================================================================== */

describe("hintToAlertType", () => {
  it("should map idle_in_transaction_long → idle_in_transaction", () => {
    expect(hintToAlertType("idle_in_transaction_long")).toBe("idle_in_transaction");
  });

  it("should map connection_hog → connection_hog", () => {
    expect(hintToAlertType("connection_hog")).toBe("connection_hog");
  });

  it("should map blocking_chain_long → blocking_chain", () => {
    expect(hintToAlertType("blocking_chain_long")).toBe("blocking_chain");
  });

  it("should map connection_exhaustion → connection_exhaustion", () => {
    expect(hintToAlertType("connection_exhaustion")).toBe("connection_exhaustion");
  });

  it("should map connection_spike → connection_spike", () => {
    expect(hintToAlertType("connection_spike")).toBe("connection_spike");
  });

  it("should map replication_lag → replication_lag", () => {
    expect(hintToAlertType("replication_lag")).toBe("replication_lag");
  });

  it("should map replication_not_streaming → replication_lag", () => {
    expect(hintToAlertType("replication_not_streaming")).toBe("replication_lag");
  });

  it("should map monitoring_failure → monitoring_failure", () => {
    expect(hintToAlertType("monitoring_failure")).toBe("monitoring_failure");
  });

  it("should map pool_exhaustion → pool_exhaustion", () => {
    expect(hintToAlertType("pool_exhaustion")).toBe("pool_exhaustion");
  });

  it("should map plan_regression → monitoring_failure", () => {
    expect(hintToAlertType("plan_regression")).toBe("monitoring_failure");
  });

  it("should return null for unknown rule types", () => {
    expect(hintToAlertType("unknown_rule")).toBeNull();
    expect(hintToAlertType("")).toBeNull();
    expect(hintToAlertType("nonexistent")).toBeNull();
  });
});

describe("generateFingerprint", () => {
  const dbId = "db-123";

  function makeHint(ruleType: string, metadata: Record<string, unknown>): GeneratedHint {
    return {
      ruleType,
      severity: "warning",
      title: "test",
      description: "test desc",
      metadata,
    };
  }

  it("should generate idle_in_txn fingerprint with PID", () => {
    const hint = makeHint("idle_in_transaction_long", { pid: 42 });
    expect(generateFingerprint(dbId, hint)).toBe("idle_in_txn:db-123:42");
  });

  it("should generate connection_hog fingerprint with app name", () => {
    const hint = makeHint("connection_hog", { application_name: "rails" });
    expect(generateFingerprint(dbId, hint)).toBe("conn_hog:db-123:rails");
  });

  it("should generate blocking_chain fingerprint with PIDs", () => {
    const hint = makeHint("blocking_chain_long", {
      blocked_pid: 10,
      blocking_pid: 20,
    });
    expect(generateFingerprint(dbId, hint)).toBe("block_chain:db-123:10:20");
  });

  it("should generate connection_exhaustion fingerprint (db-level)", () => {
    const hint = makeHint("connection_exhaustion", {});
    expect(generateFingerprint(dbId, hint)).toBe("conn_exhaust:db-123");
  });

  it("should generate connection_spike fingerprint (db-level)", () => {
    const hint = makeHint("connection_spike", {});
    expect(generateFingerprint(dbId, hint)).toBe("conn_spike:db-123");
  });

  it("should generate replication_lag fingerprint with replica name", () => {
    const hint = makeHint("replication_lag", { replica_name: "replica-1" });
    expect(generateFingerprint(dbId, hint)).toBe("repl_lag:db-123:replica-1");
  });

  it("should handle missing replica_name with 'unknown'", () => {
    const hint = makeHint("replication_lag", {});
    expect(generateFingerprint(dbId, hint)).toBe("repl_lag:db-123:unknown");
  });

  it("should generate pool_exhaustion fingerprint with pool name", () => {
    const hint = makeHint("pool_exhaustion", { pool_name: "myapp" });
    expect(generateFingerprint(dbId, hint)).toBe("pool_exhaust:db-123:myapp");
  });

  it("should generate plan_regression fingerprint with queryid", () => {
    const hint = makeHint("plan_regression", { queryid: 12345 });
    expect(generateFingerprint(dbId, hint)).toBe("plan_regress:db-123:12345");
  });

  it("should generate 'unknown' fingerprint for unrecognized rule types", () => {
    const hint = makeHint("totally_new_rule", {});
    expect(generateFingerprint(dbId, hint)).toBe("unknown:db-123:totally_new_rule");
  });

  it("should produce different fingerprints for different databases", () => {
    const hint = makeHint("connection_exhaustion", {});
    const fp1 = generateFingerprint("db-1", hint);
    const fp2 = generateFingerprint("db-2", hint);
    expect(fp1).not.toBe(fp2);
  });

  it("should produce different fingerprints for different PIDs", () => {
    const hint1 = makeHint("idle_in_transaction_long", { pid: 1 });
    const hint2 = makeHint("idle_in_transaction_long", { pid: 2 });
    expect(generateFingerprint(dbId, hint1)).not.toBe(
      generateFingerprint(dbId, hint2)
    );
  });
});
