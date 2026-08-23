-- Migration: 0015_dba_features_phase2_4.sql
-- Phases 2–4: Lock Queue Storm Alerting, WAL Velocity, Checkpoint Sync/Write, Archiving & HOT Update Stats

-- 1. Extend alert_type enum
ALTER TYPE "alert_type" ADD VALUE IF NOT EXISTS 'lock_queue_storm';
ALTER TYPE "alert_type" ADD VALUE IF NOT EXISTS 'checkpoint_sync_stall';

-- 2. Add HOT update metrics to table_bloat_stats
ALTER TABLE "table_bloat_stats" ADD COLUMN IF NOT EXISTS "n_hot_upd" bigint;
ALTER TABLE "table_bloat_stats" ADD COLUMN IF NOT EXISTS "n_upd" bigint;
ALTER TABLE "table_bloat_stats" ADD COLUMN IF NOT EXISTS "hot_update_ratio" double precision;

-- 3. Add WAL, checkpoint sync/write times, and archiving metrics to db_health_snapshots
ALTER TABLE "db_health_snapshots" ADD COLUMN IF NOT EXISTS "checkpoint_write_time" double precision;
ALTER TABLE "db_health_snapshots" ADD COLUMN IF NOT EXISTS "checkpoint_sync_time" double precision;
ALTER TABLE "db_health_snapshots" ADD COLUMN IF NOT EXISTS "wal_velocity_mb_per_min" double precision;
ALTER TABLE "db_health_snapshots" ADD COLUMN IF NOT EXISTS "archived_wal_count" bigint;
ALTER TABLE "db_health_snapshots" ADD COLUMN IF NOT EXISTS "failed_wal_count" bigint;
ALTER TABLE "db_health_snapshots" ADD COLUMN IF NOT EXISTS "last_archived_wal" varchar(64);
ALTER TABLE "db_health_snapshots" ADD COLUMN IF NOT EXISTS "last_failed_wal" varchar(64);
