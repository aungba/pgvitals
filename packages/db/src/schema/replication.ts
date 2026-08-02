import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  bigint,
  doublePrecision,
  primaryKey,
} from "drizzle-orm/pg-core";
import { monitoredDatabases } from "./organizations.js";

/* ===================================================================
   Replication Lag Monitor Schema — Phase 7
   =================================================================== */

/**
 * Replication snapshots — per-replica lag metrics from pg_stat_replication.
 * Snapshot-based: stores a set of stats per collection run.
 * Will be converted to a TimescaleDB hypertable via migration SQL.
 */
export const replicationSnapshots = pgTable(
  "replication_snapshots",
  {
    id: uuid("id").defaultRandom().notNull(),
    monitoredDbId: uuid("monitored_db_id")
      .references(() => monitoredDatabases.id, { onDelete: "cascade" })
      .notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    replicaName: varchar("replica_name", { length: 255 }).notNull(),
    clientAddr: varchar("client_addr", { length: 255 }),
    replicationState: varchar("replication_state", { length: 50 }).notNull(),
    sentLsn: varchar("sent_lsn", { length: 64 }),
    writeLsn: varchar("write_lsn", { length: 64 }),
    flushLsn: varchar("flush_lsn", { length: 64 }),
    replayLsn: varchar("replay_lsn", { length: 64 }),
    byteLag: bigint("byte_lag", { mode: "number" }).default(0).notNull(),
    timeLagSeconds: doublePrecision("time_lag_seconds"),
    writeLagMs: doublePrecision("write_lag_ms"),
    flushLagMs: doublePrecision("flush_lag_ms"),
    replayLagMs: doublePrecision("replay_lag_ms"),
  },
  (table) => [primaryKey({ columns: [table.id, table.capturedAt] })]
);
