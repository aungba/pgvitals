import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  jsonb,
  boolean,
  pgEnum,
} from "drizzle-orm/pg-core";
import { monitoredDatabases } from "./organizations.js";

/* ===================================================================
   Alerting Schema — Phase 2
   =================================================================== */

export const alertTypeEnum = pgEnum("alert_type", [
  "idle_in_transaction",
  "connection_hog",
  "blocking_chain",
  "connection_exhaustion",
  "connection_spike",
  "replication_lag",
  "monitoring_failure",
  "pool_exhaustion",
  "wal_retention_risk",
  "replication_slot_stalled",
  "invalid_indexes",
  "lock_queue_storm",
  "checkpoint_sync_stall",
]);

export const alertSeverityEnum = pgEnum("alert_severity", [
  "warning",
  "critical",
]);

/**
 * Alerts — fired alert instances.
 * Each row represents one specific alert occurrence.
 */
export const alerts = pgTable("alerts", {
  id: uuid("id").defaultRandom().primaryKey(),
  monitoredDbId: uuid("monitored_db_id")
    .references(() => monitoredDatabases.id, { onDelete: "cascade" })
    .notNull(),
  alertType: alertTypeEnum("alert_type").notNull(),
  severity: alertSeverityEnum("severity").notNull(),
  fingerprint: varchar("fingerprint", { length: 512 }).notNull(),
  details: jsonb("details"),
  rootCauseHint: varchar("root_cause_hint", { length: 2048 }),
  firedAt: timestamp("fired_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  lastNotifiedAt: timestamp("last_notified_at", { withTimezone: true }),
  feedback: varchar("feedback", { length: 10 }),
  feedbackAt: timestamp("feedback_at", { withTimezone: true }),
});

/**
 * Alert Rules — per-database alert configuration.
 * Defines thresholds, cooldowns, and notification channels.
 */
export const alertRules = pgTable("alert_rules", {
  id: uuid("id").defaultRandom().primaryKey(),
  monitoredDbId: uuid("monitored_db_id")
    .references(() => monitoredDatabases.id, { onDelete: "cascade" })
    .notNull(),
  alertType: alertTypeEnum("alert_type").notNull(),
  thresholdValue: integer("threshold_value").notNull(),
  cooldownMinutes: integer("cooldown_minutes").default(15).notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  channels: jsonb("channels").default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
