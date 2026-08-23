import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

const connectionString =
  process.env.DATABASE_URL ||
  "postgres://postgres:postgres@localhost:5432/pgvitals";


// Query client — used for application queries
const queryClient = postgres(connectionString);

// Database instance with schema for relational queries
export const db = drizzle(queryClient, { schema });

// Export a function to create a connection for migrations (single-use)
export function createMigrationClient() {
  return postgres(connectionString!, { max: 1 });
}

// Re-export schema
export * from "./schema/index.js";
export { schema };
