ALTER TABLE "query_stats" ADD COLUMN IF NOT EXISTS "temp_blks_written" bigint DEFAULT 0 NOT NULL;

CREATE TABLE IF NOT EXISTS "query_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monitored_db_id" uuid NOT NULL REFERENCES "monitored_databases"("id") ON DELETE CASCADE,
	"queryid" bigint NOT NULL,
	"suggestion_type" varchar(50) NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text NOT NULL,
	"severity" varchar(20) DEFAULT 'info' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dismissed" boolean DEFAULT false NOT NULL
);
