import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  boolean,
  text,
  jsonb,
  pgEnum,
} from "drizzle-orm/pg-core";
import { monitoredDatabases } from "./organizations.js";

/* ===================================================================
   Index Advisor Schema — Phase 5
   =================================================================== */

export const recommendationTypeEnum = pgEnum("recommendation_type", [
  "unused",
  "missing",
]);

/**
 * Index recommendations — unused index detection + missing index suggestions.
 */
export const indexRecommendations = pgTable("index_recommendations", {
  id: uuid("id").defaultRandom().primaryKey(),
  monitoredDbId: uuid("monitored_db_id")
    .references(() => monitoredDatabases.id, { onDelete: "cascade" })
    .notNull(),
  tableName: varchar("table_name", { length: 255 }).notNull(),
  indexName: varchar("index_name", { length: 255 }),
  recommendationType: recommendationTypeEnum("recommendation_type").notNull(),
  suggestedDdl: text("suggested_ddl"),
  reason: text("reason").notNull(),
  impact: varchar("impact", { length: 64 }).default("medium").notNull(),
  metadata: jsonb("metadata").default({}).notNull(),
  detectedAt: timestamp("detected_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  dismissed: boolean("dismissed").default(false).notNull(),
  dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
});
