ALTER TABLE "organizations" ADD COLUMN "clerk_org_id" varchar(255) UNIQUE;
ALTER TABLE "organizations" ADD COLUMN "stripe_customer_id" varchar(255);
ALTER TABLE "organizations" ADD COLUMN "stripe_subscription_id" varchar(255);
ALTER TABLE "users" ADD COLUMN "clerk_user_id" varchar(255) UNIQUE;
