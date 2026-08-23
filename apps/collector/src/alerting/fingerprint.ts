import type { GeneratedHint } from "../collector/rules-engine.js";
import { alertTypeEnum } from "@pgvitals/db";

export type AlertType = (typeof alertTypeEnum.enumValues)[number];

/* ===================================================================
   Alert Fingerprinting — generates unique IDs for deduplication
   =================================================================== */

/**
 * Maps a rule-engine hint to an alert type name matching the DB enum.
 */
export function hintToAlertType(
  ruleType: string
): AlertType | null {
  const map: Record<string, AlertType> = {
    idle_in_transaction_long: "idle_in_transaction",
    connection_hog: "connection_hog",
    blocking_chain_long: "blocking_chain",
    connection_exhaustion: "connection_exhaustion",
    connection_spike: "connection_spike",
    replication_lag: "replication_lag",
    replication_not_streaming: "replication_lag",
    monitoring_failure: "monitoring_failure",
    pool_exhaustion: "pool_exhaustion",
    plan_regression: "monitoring_failure", // Plan regressions alert as monitoring_failure type
    wal_retention_risk: "wal_retention_risk",
    replication_slot_stalled: "replication_slot_stalled",
    invalid_indexes: "invalid_indexes",
    lock_queue_storm: "lock_queue_storm",
    checkpoint_sync_stall: "checkpoint_sync_stall",
  };
  return map[ruleType] ?? null;
}

/**
 * Generates a fingerprint string for alert deduplication.
 * Alerts with the same fingerprint within a cooldown window are suppressed.
 */
export function generateFingerprint(
  monitoredDbId: string,
  hint: GeneratedHint
): string {
  const meta = hint.metadata;

  switch (hint.ruleType) {
    case "idle_in_transaction_long":
      return `idle_in_txn:${monitoredDbId}:${meta.pid}`;

    case "connection_hog":
      return `conn_hog:${monitoredDbId}:${meta.application_name}`;

    case "blocking_chain_long":
      return `block_chain:${monitoredDbId}:${meta.blocked_pid}:${meta.blocking_pid}`;

    case "connection_exhaustion":
      return `conn_exhaust:${monitoredDbId}`;

    case "connection_spike":
      return `conn_spike:${monitoredDbId}`;

    case "replication_lag":
    case "replication_not_streaming":
      return `repl_lag:${monitoredDbId}:${meta.replica_name ?? "unknown"}`;

    case "monitoring_failure":
      return `monitor_fail:${monitoredDbId}`;

    case "pool_exhaustion":
      return `pool_exhaust:${monitoredDbId}:${meta.pool_name ?? "unknown"}`;

    case "plan_regression":
      return `plan_regress:${monitoredDbId}:${meta.queryid ?? "unknown"}`;

    case "wal_retention_risk":
      return `wal_retention:${monitoredDbId}:${meta.slot_name ?? "unknown"}`;

    case "replication_slot_stalled":
      return `slot_stalled:${monitoredDbId}:${meta.slot_name ?? "unknown"}`;

    case "invalid_indexes":
      return `invalid_idx:${monitoredDbId}:${meta.index_name ?? "unknown"}`;

    case "lock_queue_storm":
      return `lock_storm:${monitoredDbId}:${meta.root_pid ?? "unknown"}`;

    case "checkpoint_sync_stall":
      return `checkpoint_sync:${monitoredDbId}`;

    default:
      return `unknown:${monitoredDbId}:${hint.ruleType}`;
  }
}
