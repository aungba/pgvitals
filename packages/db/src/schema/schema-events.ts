import { pgTable, uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { monitoredDatabases } from "./organizations.js";

/* ===================================================================
   Schema Events — tracks DDL changes detected via schema diffing
   Spec §2.13, Phase 8
   =================================================================== */

export const schemaEvents = pgTable("schema_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  monitoredDbId: text("monitored_db_id")
    .notNull()
    .references(() => monitoredDatabases.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(), // create_table, drop_table, create_index, drop_index, alter_table, add_column, drop_column
  objectName: text("object_name").notNull(), // e.g. "public.users" or "public.users_email_idx"
  detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
  details: jsonb("details"), // extra info like column name, data type, etc.
});

/**
 * Stores periodic schema snapshots for diffing.
 * Each row captures the full table/index structure at a point in time.
 */
export const schemaSnapshots = pgTable("schema_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  monitoredDbId: text("monitored_db_id")
    .notNull()
    .references(() => monitoredDatabases.id, { onDelete: "cascade" }),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  tablesJson: jsonb("tables_json").notNull(), // [{schema, table_name, columns: [{name, type, nullable}]}]
  indexesJson: jsonb("indexes_json").notNull(), // [{schema, table_name, index_name, columns, is_unique}]
});
