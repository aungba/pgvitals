import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";

export const planTierEnum = pgEnum("plan_tier", ["free", "pro", "team"]);

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  planTier: planTierEnum("plan_tier").default("free").notNull(),
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
  isActive: varchar("is_active", { length: 5 }).default("true").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
