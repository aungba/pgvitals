import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  integer,
  doublePrecision,
  bigint,
  jsonb,
  primaryKey,
} from "drizzle-orm/pg-core";
import { monitoredDatabases } from "./organizations.js";

/* ===================================================================
   VACUUM & Bloat Advisor Schema — Phase 6
   =================================================================== */

/**
 * Table bloat stats — per-table vacuum and bloat metrics from pg_stat_user_tables.
 * Snapshot-based: stores a set of stats per collection run.
 */
export const tableBloatStats = pgTable(
  "table_bloat_stats",
  {
    id: uuid("id").defaultRandom().notNull(),
    monitoredDbId: uuid("monitored_db_id")
      .references(() => monitoredDatabases.id, { onDelete: "cascade" })
      .notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    tableName: varchar("table_name", { length: 255 }).notNull(),
    schemaName: varchar("schema_name", { length: 128 }).default("public").notNull(),
    nLiveTup: bigint("n_live_tup", { mode: "number" }).default(0).notNull(),
    nDeadTup: bigint("n_dead_tup", { mode: "number" }).default(0).notNull(),
    deadTupRatio: doublePrecision("dead_tup_ratio").default(0).notNull(),
    tableSizeBytes: bigint("table_size_bytes", { mode: "number" }).default(0).notNull(),
    totalSizeBytes: bigint("total_size_bytes", { mode: "number" }).default(0).notNull(),
    lastVacuum: timestamp("last_vacuum", { withTimezone: true }),
    lastAutovacuum: timestamp("last_autovacuum", { withTimezone: true }),
    lastAnalyze: timestamp("last_analyze", { withTimezone: true }),
    lastAutoanalyze: timestamp("last_autoanalyze", { withTimezone: true }),
    vacuumCount: integer("vacuum_count").default(0).notNull(),
    autovacuumCount: integer("autovacuum_count").default(0).notNull(),
    seqScan: bigint("seq_scan", { mode: "number" }).default(0).notNull(),
    idxScan: bigint("idx_scan", { mode: "number" }).default(0).notNull(),
  },
  (table) => [primaryKey({ columns: [table.id, table.capturedAt] })]
);

/**
 * Database health snapshots — cluster-wide metrics (WAL, checkpoints, cache).
 */
export const dbHealthSnapshots = pgTable("db_health_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  monitoredDbId: uuid("monitored_db_id")
    .references(() => monitoredDatabases.id, { onDelete: "cascade" })
    .notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  cacheHitRatio: doublePrecision("cache_hit_ratio"),
  checkpointsRequested: integer("checkpoints_requested"),
  checkpointsTimed: integer("checkpoints_timed"),
  buffersCheckpoint: bigint("buffers_checkpoint", { mode: "number" }),
  buffersBackend: bigint("buffers_backend", { mode: "number" }),
  dbSizeBytes: bigint("db_size_bytes", { mode: "number" }),
  numBackends: integer("num_backends"),
  xactCommit: bigint("xact_commit", { mode: "number" }),
  xactRollback: bigint("xact_rollback", { mode: "number" }),
  conflictsCount: integer("conflicts_count"),
  deadlocksCount: integer("deadlocks_count"),
  tempFileBytes: bigint("temp_file_bytes", { mode: "number" }),
  metrics: jsonb("metrics").default({}).notNull(),
});
