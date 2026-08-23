-- Migration: 0014_dba_features_phase1.sql
-- Phase 1: Replication Slot WAL retention monitoring & Invalid/Redundant Index detection enums

-- 1. Extend alert_type enum
ALTER TYPE "alert_type" ADD VALUE IF NOT EXISTS 'wal_retention_risk';
ALTER TYPE "alert_type" ADD VALUE IF NOT EXISTS 'replication_slot_stalled';
ALTER TYPE "alert_type" ADD VALUE IF NOT EXISTS 'invalid_indexes';

-- 2. Extend recommendation_type enum
ALTER TYPE "recommendation_type" ADD VALUE IF NOT EXISTS 'invalid';
ALTER TYPE "recommendation_type" ADD VALUE IF NOT EXISTS 'redundant';
ALTER TYPE "recommendation_type" ADD VALUE IF NOT EXISTS 'bloat';

-- 3. Create replication_slot_snapshots table
CREATE TABLE IF NOT EXISTS "replication_slot_snapshots" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "monitored_db_id" uuid NOT NULL REFERENCES "monitored_databases"("id") ON DELETE CASCADE,
  "captured_at" timestamp with time zone DEFAULT now() NOT NULL,
  "slot_name" varchar(255) NOT NULL,
  "plugin" varchar(128),
  "slot_type" varchar(64) NOT NULL,
  "active" boolean NOT NULL,
  "wal_status" varchar(64),
  "retained_bytes" bigint DEFAULT 0 NOT NULL,
  "restart_lsn" varchar(64),
  "confirmed_flush_lsn" varchar(64),
  "temporary" boolean DEFAULT false NOT NULL,
  "conflicting" boolean DEFAULT false NOT NULL,
  "inactive_duration_seconds" double precision,
  CONSTRAINT "replication_slot_snapshots_pkey" PRIMARY KEY ("id", "captured_at")
);

CREATE INDEX IF NOT EXISTS "idx_repl_slot_db_time" ON "replication_slot_snapshots" ("monitored_db_id", "captured_at" DESC);
