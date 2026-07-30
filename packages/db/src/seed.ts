import "dotenv/config";
import crypto from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { organizations, users, monitoredDatabases } from "./schema/index.js";

/**
 * Seed script for local development.
 * Creates a default org, user, and a monitored database pointing
 * to the local TimescaleDB itself (dog-fooding).
 */
async function seed() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  const sql = postgres(connectionString, { max: 1 });
  const db = drizzle(sql);

  console.log("🌱 Seeding database...");

  // Create default organization
  const [org] = await db
    .insert(organizations)
    .values({
      name: "PG Vitals Dev Team",
      planTier: "pro",
    })
    .returning();
  console.log(`  ✅ Organization: ${org.name} (${org.id})`);

  // Create default user
  const [user] = await db
    .insert(users)
    .values({
      orgId: org.id,
      email: "dev@pgvitals.dev",
      role: "owner",
    })
    .returning();
  console.log(`  ✅ User: ${user.email} (${user.id})`);

  // Encrypt connection string for the local DB (simple AES-256-GCM)
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error("ENCRYPTION_KEY environment variable is required");
  }

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    Buffer.from(encryptionKey, "hex"),
    iv
  );
  let encrypted = cipher.update(connectionString, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  const encryptedConnectionString = `${iv.toString("hex")}:${authTag}:${encrypted}`;

  // Create monitored database pointing to local TimescaleDB
  const [monitoredDb] = await db
    .insert(monitoredDatabases)
    .values({
      orgId: org.id,
      name: "Local Dev Database",
      connectionStringEncrypted: encryptedConnectionString,
      environment: "development",
    })
    .returning();
  console.log(`  ✅ Monitored DB: ${monitoredDb.name} (${monitoredDb.id})`);

  console.log("\n✅ Seeding complete!");
  console.log(`\n📋 Summary:`);
  console.log(`   Org ID:          ${org.id}`);
  console.log(`   User ID:         ${user.id}`);
  console.log(`   Monitored DB ID: ${monitoredDb.id}`);

  await sql.end();
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Seeding failed:", err);
  process.exit(1);
});
