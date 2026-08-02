-- Log Insights & Error Stats — Phase 8

CREATE TYPE "log_severity" AS ENUM ('error', 'warning', 'info');

CREATE TABLE IF NOT EXISTS "log_insights" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "monitored_db_id" uuid NOT NULL REFERENCES "monitored_databases"("id") ON DELETE CASCADE,
  "captured_at" timestamp with time zone DEFAULT now() NOT NULL,
  "severity" "log_severity" NOT NULL,
  "error_type" varchar(255) NOT NULL,
  "error_message" text NOT NULL,
  "error_count" integer DEFAULT 1 NOT NULL,
  "sample_query" text,
  "database_name" varchar(255),
  "user_name" varchar(255),
  CONSTRAINT "log_insights_pkey" PRIMARY KEY("id", "captured_at")
);

CREATE TABLE IF NOT EXISTS "db_error_stats" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "monitored_db_id" uuid NOT NULL REFERENCES "monitored_databases"("id") ON DELETE CASCADE,
  "captured_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deadlocks_count" integer DEFAULT 0 NOT NULL,
  "conflicts_count" integer DEFAULT 0 NOT NULL,
  "rollbacks_count" integer DEFAULT 0 NOT NULL,
  "temp_files_count" integer DEFAULT 0 NOT NULL,
  "temp_files_bytes" double precision DEFAULT 0 NOT NULL,
  "checkpoint_warnings" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "db_error_stats_pkey" PRIMARY KEY("id", "captured_at")
);

-- Convert to TimescaleDB hypertables
SELECT create_hypertable('log_insights', 'captured_at', if_not_exists => TRUE, migrate_data => TRUE);
SELECT create_hypertable('db_error_stats', 'captured_at', if_not_exists => TRUE, migrate_data => TRUE);

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_log_insights_db_time"
  ON "log_insights" ("monitored_db_id", "captured_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_db_error_stats_db_time"
  ON "db_error_stats" ("monitored_db_id", "captured_at" DESC);
