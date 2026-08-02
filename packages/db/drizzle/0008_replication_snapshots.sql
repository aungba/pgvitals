-- Replication Lag Monitor — Phase 7
-- Creates replication_snapshots table for tracking per-replica lag metrics

CREATE TABLE IF NOT EXISTS "replication_snapshots" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "monitored_db_id" uuid NOT NULL REFERENCES "monitored_databases"("id") ON DELETE CASCADE,
  "captured_at" timestamp with time zone DEFAULT now() NOT NULL,
  "replica_name" varchar(255) NOT NULL,
  "client_addr" varchar(255),
  "replication_state" varchar(50) NOT NULL,
  "sent_lsn" varchar(64),
  "write_lsn" varchar(64),
  "flush_lsn" varchar(64),
  "replay_lsn" varchar(64),
  "byte_lag" bigint DEFAULT 0 NOT NULL,
  "time_lag_seconds" double precision,
  "write_lag_ms" double precision,
  "flush_lag_ms" double precision,
  "replay_lag_ms" double precision,
  CONSTRAINT "replication_snapshots_pkey" PRIMARY KEY("id", "captured_at")
);

-- Convert to TimescaleDB hypertable for efficient time-range queries
SELECT create_hypertable(
  'replication_snapshots',
  'captured_at',
  if_not_exists => TRUE,
  migrate_data => TRUE
);

-- Index for fast lookup by database + time
CREATE INDEX IF NOT EXISTS "idx_replication_snapshots_db_time"
  ON "replication_snapshots" ("monitored_db_id", "captured_at" DESC);
