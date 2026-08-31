ALTER TABLE "organizations" ADD COLUMN "trial_started_at" timestamp with time zone;
ALTER TABLE "organizations" ADD COLUMN "trial_ends_at" timestamp with time zone;
ALTER TABLE "organizations" ADD COLUMN "has_used_trial" boolean DEFAULT false NOT NULL;
