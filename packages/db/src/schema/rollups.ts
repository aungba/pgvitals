import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  doublePrecision,
  bigint,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import { monitoredDatabases } from "./organizations.js";

/**
 * Metric rollups table — stores pre-aggregated time-series rollups
 * (5m, 1h, 1d) for fast dashboard visualization across long time ranges.
 */
export const metricRollups = pgTable(
  "metric_rollups",
  {
    id: uuid("id").defaultRandom().notNull(),
    monitoredDbId: uuid("monitored_db_id")
      .references(() => monitoredDatabases.id, { onDelete: "cascade" })
      .notNull(),
    resolution: varchar("resolution", { length: 16 }).notNull(), // '5m' | '1h' | '1d'
    bucket: timestamp("bucket", { withTimezone: true }).notNull(),
    activeConnectionsAvg: doublePrecision("active_connections_avg"),
    activeConnectionsMax: integer("active_connections_max"),
    connectionCountAvg: doublePrecision("connection_count_avg"),
    connectionCountMax: integer("connection_count_max"),
    idleInTxnMax: integer("idle_in_txn_max"),
    avgQueryTimeMs: doublePrecision("avg_query_time_ms"),
    maxQueryTimeMs: doublePrecision("max_query_time_ms"),
    totalCalls: bigint("total_calls", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id, table.bucket] }),
    index("idx_metric_rollups_db_res_bucket").on(
      table.monitoredDbId,
      table.resolution,
      table.bucket
    ),
  ]
);
