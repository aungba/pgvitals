DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'connection_spike' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'alert_type')) THEN ALTER TYPE "public"."alert_type" ADD VALUE 'connection_spike'; END IF; END $$;--> statement-breakpoint
CREATE TABLE "explain_captures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monitored_db_id" uuid NOT NULL,
	"queryid" bigint NOT NULL,
	"query_text" text NOT NULL,
	"plan_json" jsonb NOT NULL,
	"plan_text" text,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "query_stats" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"monitored_db_id" uuid NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"queryid" bigint NOT NULL,
	"query_text" varchar(2000) NOT NULL,
	"calls" integer NOT NULL,
	"total_time_ms" double precision NOT NULL,
	"mean_time_ms" double precision NOT NULL,
	"max_time_ms" double precision NOT NULL,
	"min_time_ms" double precision NOT NULL,
	"rows_returned" bigint NOT NULL,
	"shared_blks_hit" bigint DEFAULT 0 NOT NULL,
	"shared_blks_read" bigint DEFAULT 0 NOT NULL,
	"pct_of_total_time" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "query_stats_id_captured_at_pk" PRIMARY KEY("id","captured_at")
);
--> statement-breakpoint
ALTER TABLE "explain_captures" ADD CONSTRAINT "explain_captures_monitored_db_id_monitored_databases_id_fk" FOREIGN KEY ("monitored_db_id") REFERENCES "public"."monitored_databases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "query_stats" ADD CONSTRAINT "query_stats_monitored_db_id_monitored_databases_id_fk" FOREIGN KEY ("monitored_db_id") REFERENCES "public"."monitored_databases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_query_stats_dbid_queryid" ON "query_stats" USING btree ("monitored_db_id","queryid");