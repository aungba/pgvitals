import { pgTable, uuid, text, timestamp, jsonb, bigint, doublePrecision, primaryKey } from "drizzle-orm/pg-core";
import { monitoredDatabases } from "./organizations.js";

/* ===================================================================
   Query Plan Snapshots — tracks EXPLAIN plan shapes over time
   Spec §2.10, Phase 9
   =================================================================== */

export const queryPlanSnapshots = pgTable(
  "query_plan_snapshots",
  {
    id: uuid("id").defaultRandom().notNull(),
    monitoredDbId: text("monitored_db_id")
      .notNull()
      .references(() => monitoredDatabases.id, { onDelete: "cascade" }),
    queryid: bigint("queryid", { mode: "number" }).notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    planJson: jsonb("plan_json"), // raw EXPLAIN output
    planShapeHash: text("plan_shape_hash").notNull(), // normalized hash of plan node types
    estimatedCost: doublePrecision("estimated_cost"),
    topNodeType: text("top_node_type"), // e.g. "Seq Scan", "Index Scan", "Hash Join"
    planFlags: jsonb("plan_flags"), // flags like seq_scan_large_table, nested_loop_high_rows
  },
  (table) => [primaryKey({ columns: [table.id, table.capturedAt] })]
);
