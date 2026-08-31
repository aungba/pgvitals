import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  pgEnum,
  boolean,
} from "drizzle-orm/pg-core";

export const planTierEnum = pgEnum("plan_tier", ["free", "pro", "team"]);

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  planTier: planTierEnum("plan_tier").default("free").notNull(),
  clerkOrgId: varchar("clerk_org_id", { length: 255 }).unique(),
  stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
  stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
  trialStartedAt: timestamp("trial_started_at", { withTimezone: true }),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  hasUsedTrial: boolean("has_used_trial").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const userRoleEnum = pgEnum("user_role", ["owner", "admin", "member"]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  clerkUserId: varchar("clerk_user_id", { length: 255 }).unique(),
  role: userRoleEnum("role").default("member").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const environmentEnum = pgEnum("environment", [
  "production",
  "staging",
  "development",
]);

export const monitoredDatabases = pgTable("monitored_databases", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  connectionStringEncrypted: varchar("connection_string_encrypted", {
    length: 2048,
  }).notNull(),
  environment: environmentEnum("environment").default("production").notNull(),
  pgbouncerConnectionStringEncrypted: varchar("pgbouncer_connection_string_encrypted", {
    length: 2048,
  }),
  isActive: varchar("is_active", { length: 5 }).default("true").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
