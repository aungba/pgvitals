CREATE TYPE "public"."environment" AS ENUM('production', 'staging', 'development');--> statement-breakpoint
CREATE TYPE "public"."plan_tier" AS ENUM('free', 'pro', 'team');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TABLE "monitored_databases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"connection_string_encrypted" varchar(2048) NOT NULL,
	"environment" "environment" DEFAULT 'production' NOT NULL,
	"is_active" varchar(5) DEFAULT 'true' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"plan_tier" "plan_tier" DEFAULT 'free' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "root_cause_hints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"monitored_db_id" uuid NOT NULL,
	"rule_type" varchar(128) NOT NULL,
	"severity" varchar(32) NOT NULL,
	"title" varchar(512) NOT NULL,
	"description" varchar(2048) NOT NULL,
	"metadata" jsonb,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions_snapshot" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"monitored_db_id" uuid NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"pid" integer NOT NULL,
	"usename" varchar(255),
	"application_name" varchar(255),
	"client_addr" varchar(255),
	"state" varchar(64),
	"state_duration_seconds" integer,
	"query_text" varchar(500),
	"query_start" timestamp with time zone,
	"wait_event_type" varchar(64),
	"wait_event" varchar(64),
	"blocking_pid" integer,
	CONSTRAINT "sessions_snapshot_id_timestamp_pk" PRIMARY KEY("id","timestamp")
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"monitored_db_id" uuid NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"connection_count" integer NOT NULL,
	"active_count" integer NOT NULL,
	"idle_count" integer NOT NULL,
	"idle_in_txn_count" integer NOT NULL,
	"idle_in_txn_aborted_count" integer DEFAULT 0 NOT NULL,
	"max_connections" integer NOT NULL,
	"raw_payload" jsonb,
	CONSTRAINT "snapshots_id_timestamp_pk" PRIMARY KEY("id","timestamp")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" varchar(255) NOT NULL,
	"role" "user_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "monitored_databases" ADD CONSTRAINT "monitored_databases_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "root_cause_hints" ADD CONSTRAINT "root_cause_hints_monitored_db_id_monitored_databases_id_fk" FOREIGN KEY ("monitored_db_id") REFERENCES "public"."monitored_databases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions_snapshot" ADD CONSTRAINT "sessions_snapshot_monitored_db_id_monitored_databases_id_fk" FOREIGN KEY ("monitored_db_id") REFERENCES "public"."monitored_databases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_monitored_db_id_monitored_databases_id_fk" FOREIGN KEY ("monitored_db_id") REFERENCES "public"."monitored_databases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;