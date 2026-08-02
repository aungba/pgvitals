ALTER TABLE "table_bloat_stats" ADD COLUMN IF NOT EXISTS "cache_hit_ratio" double precision;
ALTER TABLE "table_bloat_stats" ADD COLUMN IF NOT EXISTS "idx_cache_hit_ratio" double precision;

CREATE TABLE IF NOT EXISTS "table_size_history" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"monitored_db_id" uuid NOT NULL REFERENCES "monitored_databases"("id") ON DELETE CASCADE,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"table_name" varchar(255) NOT NULL,
	"schema_name" varchar(128) DEFAULT 'public' NOT NULL,
	"table_size_bytes" bigint DEFAULT 0 NOT NULL,
	"index_size_bytes" bigint DEFAULT 0 NOT NULL,
	"total_size_bytes" bigint DEFAULT 0 NOT NULL,
	"growth_rate_bytes_per_day" double precision,
	"projected_days_to_disk_limit" integer,
	CONSTRAINT "table_size_history_pkey" PRIMARY KEY("id","captured_at")
);
