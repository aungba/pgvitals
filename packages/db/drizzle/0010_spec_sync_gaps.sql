-- Add new alert types for replication lag and monitoring failure
ALTER TYPE "alert_type" ADD VALUE IF NOT EXISTS 'replication_lag';
ALTER TYPE "alert_type" ADD VALUE IF NOT EXISTS 'monitoring_failure';

-- Add bloat estimation columns to table_bloat_stats
ALTER TABLE "table_bloat_stats" ADD COLUMN IF NOT EXISTS "estimated_bloat_bytes" bigint;
ALTER TABLE "table_bloat_stats" ADD COLUMN IF NOT EXISTS "estimated_bloat_pct" double precision;
