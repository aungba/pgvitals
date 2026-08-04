import { pgTable, uuid, text, timestamp, integer, doublePrecision, primaryKey } from "drizzle-orm/pg-core";
import { monitoredDatabases } from "./organizations.js";

/* ===================================================================
   Pooler Snapshots — PgBouncer pool metrics
   Spec §2.12, Phase 9
   =================================================================== */

export const poolerSnapshots = pgTable(
  "pooler_snapshots",
  {
    id: uuid("id").defaultRandom().notNull(),
    monitoredDbId: text("monitored_db_id")
      .notNull()
      .references(() => monitoredDatabases.id, { onDelete: "cascade" }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    poolName: text("pool_name").notNull(),
    clActive: integer("cl_active").default(0).notNull(),
    clWaiting: integer("cl_waiting").default(0).notNull(),
    svActive: integer("sv_active").default(0).notNull(),
    svIdle: integer("sv_idle").default(0).notNull(),
    avgWaitTimeMs: doublePrecision("avg_wait_time_ms"),
    totalWaitTimeMs: doublePrecision("total_wait_time_ms"),
  },
  (table) => [primaryKey({ columns: [table.id, table.capturedAt] })]
);
