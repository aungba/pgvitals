-- Migration: Spec 5 Features
-- Percentile tracking, I/O timing diagnostics, and Autovacuum Starvation Sentinel

-- 1. query_stats extensions
ALTER TABLE query_stats ADD COLUMN IF NOT EXISTS stddev_exec_time DOUBLE PRECISION;
ALTER TABLE query_stats ADD COLUMN IF NOT EXISTS p95_exec_time DOUBLE PRECISION;
ALTER TABLE query_stats ADD COLUMN IF NOT EXISTS p99_exec_time DOUBLE PRECISION;
ALTER TABLE query_stats ADD COLUMN IF NOT EXISTS variance_ratio DOUBLE PRECISION;
ALTER TABLE query_stats ADD COLUMN IF NOT EXISTS blk_read_time DOUBLE PRECISION;
ALTER TABLE query_stats ADD COLUMN IF NOT EXISTS blk_write_time DOUBLE PRECISION;
ALTER TABLE query_stats ADD COLUMN IF NOT EXISTS io_time_percentage DOUBLE PRECISION;

-- 2. autovacuum_starvation_events table
CREATE TABLE IF NOT EXISTS autovacuum_starvation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  monitored_db_id UUID NOT NULL REFERENCES monitored_databases(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  dead_tuples BIGINT NOT NULL,
  dead_tuple_ratio DOUBLE PRECISION NOT NULL,
  active_workers INTEGER NOT NULL,
  max_workers INTEGER NOT NULL,
  is_worker_saturated BOOLEAN NOT NULL,
  suggested_action TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_autovacuum_starvation_db_time ON autovacuum_starvation_events (monitored_db_id, captured_at DESC);
