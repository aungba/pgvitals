import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  integer,
  doublePrecision,
  text,
  primaryKey,
  pgEnum,
} from "drizzle-orm/pg-core";
import { monitoredDatabases } from "./organizations.js";

/* ===================================================================
   Log Insights Schema — Phase 8
   =================================================================== */

export const logSeverityEnum = pgEnum("log_severity", [
  "error",
  "warning",
  "info",
]);

/**
 * Log insight snapshots — aggregated error/warning metrics from pg_stat_database
 * plus parsed error signatures. Converted to TimescaleDB hypertable.
 */
export const logInsights = pgTable(
  "log_insights",
  {
    id: uuid("id").defaultRandom().notNull(),
    monitoredDbId: uuid("monitored_db_id")
      .references(() => monitoredDatabases.id, { onDelete: "cascade" })
      .notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    severity: logSeverityEnum("severity").notNull(),
    errorType: varchar("error_type", { length: 255 }).notNull(),
    errorMessage: text("error_message").notNull(),
    errorCount: integer("error_count").default(1).notNull(),
    sampleQuery: text("sample_query"),
    databaseName: varchar("database_name", { length: 255 }),
    userName: varchar("user_name", { length: 255 }),
  },
  (table) => [primaryKey({ columns: [table.id, table.capturedAt] })]
);

/**
 * Database error stats — aggregate counters from pg_stat_database.
 * Tracks deltas between collection runs.
 */
export const dbErrorStats = pgTable(
  "db_error_stats",
  {
    id: uuid("id").defaultRandom().notNull(),
    monitoredDbId: uuid("monitored_db_id")
      .references(() => monitoredDatabases.id, { onDelete: "cascade" })
      .notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    deadlocksCount: integer("deadlocks_count").default(0).notNull(),
    conflictsCount: integer("conflicts_count").default(0).notNull(),
    rollbacksCount: integer("rollbacks_count").default(0).notNull(),
    tempFilesCount: integer("temp_files_count").default(0).notNull(),
    tempFilesBytes: doublePrecision("temp_files_bytes").default(0).notNull(),
    checkpointWarnings: integer("checkpoint_warnings").default(0).notNull(),
  },
  (table) => [primaryKey({ columns: [table.id, table.capturedAt] })]
);
