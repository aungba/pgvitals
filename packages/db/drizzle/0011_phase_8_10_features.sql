-- Migration: Phase 8-10 new feature modules
-- Schema & Migration Change Markers (§2.13)
-- Query Plan Regression Detection (§2.10)
-- PgBouncer Awareness (§2.12)

-- 1. Schema events table (§2.13)
CREATE TABLE IF NOT EXISTS schema_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  monitored_db_id UUID NOT NULL REFERENCES monitored_databases(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  object_name TEXT NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  details JSONB
);

CREATE INDEX IF NOT EXISTS idx_schema_events_db_time
  ON schema_events (monitored_db_id, detected_at DESC);

-- 2. Schema snapshots table (§2.13)
CREATE TABLE IF NOT EXISTS schema_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  monitored_db_id UUID NOT NULL REFERENCES monitored_databases(id) ON DELETE CASCADE,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  tables_json JSONB NOT NULL,
  indexes_json JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_schema_snapshots_db_time
  ON schema_snapshots (monitored_db_id, captured_at DESC);

-- 3. Query plan snapshots hypertable (§2.10)
CREATE TABLE IF NOT EXISTS query_plan_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  monitored_db_id UUID NOT NULL REFERENCES monitored_databases(id) ON DELETE CASCADE,
  queryid BIGINT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  plan_json JSONB,
  plan_shape_hash TEXT NOT NULL,
  estimated_cost DOUBLE PRECISION,
  top_node_type TEXT,
  plan_flags JSONB,
  PRIMARY KEY (id, captured_at)
);

SELECT create_hypertable('query_plan_snapshots', 'captured_at', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_query_plans_db_query_time
  ON query_plan_snapshots (monitored_db_id, queryid, captured_at DESC);

-- 4. Pooler snapshots hypertable (§2.12)
CREATE TABLE IF NOT EXISTS pooler_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  monitored_db_id UUID NOT NULL REFERENCES monitored_databases(id) ON DELETE CASCADE,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  pool_name TEXT NOT NULL,
  cl_active INTEGER NOT NULL DEFAULT 0,
  cl_waiting INTEGER NOT NULL DEFAULT 0,
  sv_active INTEGER NOT NULL DEFAULT 0,
  sv_idle INTEGER NOT NULL DEFAULT 0,
  avg_wait_time_ms DOUBLE PRECISION,
  total_wait_time_ms DOUBLE PRECISION,
  PRIMARY KEY (id, captured_at)
);

SELECT create_hypertable('pooler_snapshots', 'captured_at', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_pooler_snapshots_db_time
  ON pooler_snapshots (monitored_db_id, captured_at DESC);

-- 5. Add pgbouncer connection string to monitored_databases
ALTER TABLE monitored_databases
  ADD COLUMN IF NOT EXISTS pgbouncer_connection_string_encrypted VARCHAR(2048);

-- 6. Add pool_exhaustion to alert_type enum
ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'pool_exhaustion';
