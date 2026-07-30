CREATE TYPE "public"."alert_severity" AS ENUM('warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."alert_type" AS ENUM('idle_in_transaction', 'connection_hog', 'blocking_chain', 'connection_exhaustion');--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monitored_db_id" uuid NOT NULL,
	"alert_type" "alert_type" NOT NULL,
	"threshold_value" integer NOT NULL,
	"cooldown_minutes" integer DEFAULT 15 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"channels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monitored_db_id" uuid NOT NULL,
	"alert_type" "alert_type" NOT NULL,
	"severity" "alert_severity" NOT NULL,
	"fingerprint" varchar(512) NOT NULL,
	"details" jsonb,
	"root_cause_hint" varchar(2048),
	"fired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"last_notified_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_monitored_db_id_monitored_databases_id_fk" FOREIGN KEY ("monitored_db_id") REFERENCES "public"."monitored_databases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_monitored_db_id_monitored_databases_id_fk" FOREIGN KEY ("monitored_db_id") REFERENCES "public"."monitored_databases"("id") ON DELETE cascade ON UPDATE no action;