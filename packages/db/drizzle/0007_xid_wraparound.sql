ALTER TABLE "db_health_snapshots" ADD COLUMN IF NOT EXISTS "xid_age" bigint;
ALTER TABLE "db_health_snapshots" ADD COLUMN IF NOT EXISTS "autovacuum_freeze_max_age" bigint;
ALTER TABLE "db_health_snapshots" ADD COLUMN IF NOT EXISTS "xid_percent_used" double precision;
