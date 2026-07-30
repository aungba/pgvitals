import type { GeneratedHint } from "../collector/rules-engine.js";

/* ===================================================================
   Alert Fingerprinting — generates unique IDs for deduplication
   =================================================================== */

/**
 * Maps a rule-engine hint to an alert type name matching the DB enum.
 */
export function hintToAlertType(
  ruleType: string
): "idle_in_transaction" | "connection_hog" | "blocking_chain" | "connection_exhaustion" | "connection_spike" | null {
  const map: Record<string, "idle_in_transaction" | "connection_hog" | "blocking_chain" | "connection_exhaustion" | "connection_spike"> = {
    idle_in_transaction_long: "idle_in_transaction",
    connection_hog: "connection_hog",
    blocking_chain_long: "blocking_chain",
    connection_exhaustion: "connection_exhaustion",
    connection_spike: "connection_spike",
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

    default:
      return `unknown:${monitoredDbId}:${hint.ruleType}`;
  }
}
