import type { FastifyBaseLogger } from "fastify";
import { db, replicationSlotSnapshots, monitoredDatabases } from "@pgvitals/db";
import { eq } from "drizzle-orm";
import { decrypt } from "../lib/encryption.js";
import { safeQuery } from "../lib/safe-query.js";
import { config } from "../config.js";
import type { GeneratedHint } from "./rules-engine.js";

/* ===================================================================
   Replication Slot Collector & WAL Retention Sentinel — Phase 1
   
   Monitors pg_replication_slots to prevent WAL accumulation disk-full
   catastrophes caused by inactive physical replicas or stalled logical CDC slots.
   =================================================================== */

export interface ReplicationSlotRow {
  slot_name: string;
  plugin: string | null;
  slot_type: string;
  active: boolean | string;
  wal_status: string | null;
  retained_bytes: string | number;
  restart_lsn: string | null;
  confirmed_flush_lsn: string | null;
  temporary: boolean | string | null;
  conflicting: boolean | string | null;
}

/**
 * Query pg_replication_slots on the primary database.
 * Computes byte lag using pg_wal_lsn_diff vs current WAL location.
 */
const REPLICATION_SLOTS_QUERY = `
SELECT
  slot_name,
  plugin,
  slot_type,
  active,
  (to_jsonb(r)->>'wal_status') AS wal_status,
  COALESCE(
    pg_wal_lsn_diff(
      CASE WHEN pg_is_in_recovery() THEN pg_last_wal_replay_lsn() ELSE pg_current_wal_lsn() END,
      restart_lsn
    ),
    0
  )::text AS retained_bytes,
  restart_lsn::text,
  confirmed_flush_lsn::text,
  (to_jsonb(r)->>'temporary')::boolean AS temporary,
  (to_jsonb(r)->>'conflicting')::boolean AS conflicting
FROM pg_replication_slots r
ORDER BY retained_bytes DESC
`;

/** Thresholds for replication slot alerting */
const WAL_RETENTION_WARNING_BYTES = 250 * 1024 * 1024; // 250 MB
const WAL_RETENTION_CRITICAL_BYTES = 1000 * 1024 * 1024; // 1 GB

/** Format bytes into human-readable string */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Collects replication slots for a monitored database.
 * Returns root-cause hints for inactive or WAL-retaining slots.
 */
export async function collectReplicationSlots(
  monitoredDbId: string,
  log: FastifyBaseLogger
): Promise<GeneratedHint[]> {
  const hints: GeneratedHint[] = [];

  const [monitoredDb] = await db
    .select()
    .from(monitoredDatabases)
    .where(eq(monitoredDatabases.id, monitoredDbId))
    .limit(1);

  if (!monitoredDb) {
    log.warn({ monitoredDbId }, "DB not found for replication slot collection");
    return hints;
  }

  const connectionString = decrypt(
    monitoredDb.connectionStringEncrypted,
    config.encryptionKey
  );

  try {
    const rows = await safeQuery<ReplicationSlotRow[]>(
      connectionString,
      REPLICATION_SLOTS_QUERY,
      { timeoutMs: 10000 }
    );

    if (rows.length === 0) {
      log.debug({ monitoredDbId }, "No replication slots found");
      return hints;
    }

    const now = new Date();

    const snapshotRows = rows.map((r) => {
      const retainedBytes = typeof r.retained_bytes === "number"
        ? r.retained_bytes
        : parseInt(r.retained_bytes, 10) || 0;
      const isActive = r.active === true || r.active === "true" || r.active === "t";
      const isTemporary = r.temporary === true || r.temporary === "true" || r.temporary === "t";
      const isConflicting = r.conflicting === true || r.conflicting === "true" || r.conflicting === "t";

      return {
        monitoredDbId,
        capturedAt: now,
        slotName: r.slot_name,
        plugin: r.plugin,
        slotType: r.slot_type,
        active: isActive,
        walStatus: r.wal_status,
        retainedBytes,
        restartLsn: r.restart_lsn,
        confirmedFlushLsn: r.confirmed_flush_lsn,
        temporary: isTemporary,
        conflicting: isConflicting,
        inactiveDurationSeconds: isActive ? 0 : null,
      };
    });

    await db.insert(replicationSlotSnapshots).values(snapshotRows);

    log.info(
      { monitoredDbId, slotCount: snapshotRows.length },
      "Replication slot stats collected"
    );

    // Analyze replication slots for risk of WAL retention / disk full
    for (const slot of snapshotRows) {
      const { slotName, active, retainedBytes, walStatus, slotType } = slot;

      // 1. Critical: WAL retention risk
      if (retainedBytes >= WAL_RETENTION_CRITICAL_BYTES || walStatus === "unreserved" || walStatus === "lost") {
        const readableSize = formatBytes(retainedBytes);
        hints.push({
          ruleType: "wal_retention_risk",
          severity: "critical",
          title: `Critical WAL retention on slot: ${slotName} (${readableSize})`,
          description: `Replication slot "${slotName}" (${slotType}) is holding ${readableSize} of WAL on the primary database (status: ${walStatus || "normal"}). Inactive or slow slots will prevent PostgreSQL from recycling WAL files until the disk runs out of space. If this replica or consumer is abandoned, drop the slot via: SELECT pg_drop_replication_slot('${slotName}');`,
          metadata: {
            slot_name: slotName,
            slot_type: slotType,
            retained_bytes: retainedBytes,
            wal_status: walStatus,
            active,
            suggested_remediation: `SELECT pg_drop_replication_slot('${slotName}');`,
          },
        });
      } else if (retainedBytes >= WAL_RETENTION_WARNING_BYTES) {
        const readableSize = formatBytes(retainedBytes);
        hints.push({
          ruleType: "wal_retention_risk",
          severity: "warning",
          title: `Elevated WAL retention on slot: ${slotName} (${readableSize})`,
          description: `Replication slot "${slotName}" is holding ${readableSize} of WAL files on disk. Monitor its progress to ensure the subscriber is not stalling.`,
          metadata: {
            slot_name: slotName,
            slot_type: slotType,
            retained_bytes: retainedBytes,
            wal_status: walStatus,
            active,
          },
        });
      }

      // 2. Inactive replication slot warning
      if (!active) {
        hints.push({
          ruleType: "replication_slot_stalled",
          severity: retainedBytes > WAL_RETENTION_WARNING_BYTES ? "critical" : "warning",
          title: `Inactive replication slot: ${slotName}`,
          description: `Replication slot "${slotName}" (${slotType}) is currently INACTIVE. Any WAL generated will continue to accumulate on the primary until this consumer reconnects or the slot is dropped.`,
          metadata: {
            slot_name: slotName,
            slot_type: slotType,
            retained_bytes: retainedBytes,
            active: false,
            suggested_remediation: `SELECT pg_drop_replication_slot('${slotName}');`,
          },
        });
      }
    }
  } catch (err) {
    log.debug(
      { err, monitoredDbId },
      "Failed to query pg_replication_slots (database might be a replica without slot permissions)"
    );
  }

  return hints;
}
