CREATE TYPE "public"."recommendation_type" AS ENUM('unused', 'missing');--> statement-breakpoint
CREATE TABLE "index_recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monitored_db_id" uuid NOT NULL,
	"table_name" varchar(255) NOT NULL,
	"index_name" varchar(255),
	"recommendation_type" "recommendation_type" NOT NULL,
	"suggested_ddl" text,
	"reason" text NOT NULL,
	"impact" varchar(64) DEFAULT 'medium' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dismissed" boolean DEFAULT false NOT NULL,
	"dismissed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "index_recommendations" ADD CONSTRAINT "index_recommendations_monitored_db_id_monitored_databases_id_fk" FOREIGN KEY ("monitored_db_id") REFERENCES "public"."monitored_databases"("id") ON DELETE cascade ON UPDATE no action;