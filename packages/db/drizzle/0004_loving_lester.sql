CREATE TABLE "db_health_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monitored_db_id" uuid NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cache_hit_ratio" double precision,
	"checkpoints_requested" integer,
	"checkpoints_timed" integer,
	"buffers_checkpoint" bigint,
	"buffers_backend" bigint,
	"db_size_bytes" bigint,
	"num_backends" integer,
	"xact_commit" bigint,
	"xact_rollback" bigint,
	"conflicts_count" integer,
	"deadlocks_count" integer,
	"temp_file_bytes" bigint,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "table_bloat_stats" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"monitored_db_id" uuid NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"table_name" varchar(255) NOT NULL,
	"schema_name" varchar(128) DEFAULT 'public' NOT NULL,
	"n_live_tup" bigint DEFAULT 0 NOT NULL,
	"n_dead_tup" bigint DEFAULT 0 NOT NULL,
	"dead_tup_ratio" double precision DEFAULT 0 NOT NULL,
	"table_size_bytes" bigint DEFAULT 0 NOT NULL,
	"total_size_bytes" bigint DEFAULT 0 NOT NULL,
	"last_vacuum" timestamp with time zone,
	"last_autovacuum" timestamp with time zone,
	"last_analyze" timestamp with time zone,
	"last_autoanalyze" timestamp with time zone,
	"vacuum_count" integer DEFAULT 0 NOT NULL,
	"autovacuum_count" integer DEFAULT 0 NOT NULL,
	"seq_scan" bigint DEFAULT 0 NOT NULL,
	"idx_scan" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "table_bloat_stats_id_captured_at_pk" PRIMARY KEY("id","captured_at")
);
--> statement-breakpoint
ALTER TABLE "db_health_snapshots" ADD CONSTRAINT "db_health_snapshots_monitored_db_id_monitored_databases_id_fk" FOREIGN KEY ("monitored_db_id") REFERENCES "public"."monitored_databases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_bloat_stats" ADD CONSTRAINT "table_bloat_stats_monitored_db_id_monitored_databases_id_fk" FOREIGN KEY ("monitored_db_id") REFERENCES "public"."monitored_databases"("id") ON DELETE cascade ON UPDATE no action;