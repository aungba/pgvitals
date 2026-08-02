import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

async function runMigrations() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  console.log("🔄 Running Drizzle migrations...");
  const sql = postgres(connectionString, { max: 1 });
  const db = drizzle(sql);

  await migrate(db, { migrationsFolder: "./drizzle" });

  console.log("✅ Drizzle migrations complete.");

  // Run TimescaleDB hypertable setup
  console.log("🔄 Setting up TimescaleDB hypertables...");

  await sql`CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE`;

  // Convert snapshots to hypertable (idempotent check)
  const snapshotHypertable = await sql`
    SELECT * FROM timescaledb_information.hypertables 
    WHERE hypertable_name = 'snapshots'
  `;
  if (snapshotHypertable.length === 0) {
    await sql`SELECT create_hypertable('snapshots', by_range('timestamp'))`;
    console.log("  ✅ snapshots hypertable created");
  } else {
    console.log("  ⏭️  snapshots hypertable already exists");
  }

  // Convert sessions_snapshot to hypertable
  const sessionsHypertable = await sql`
    SELECT * FROM timescaledb_information.hypertables 
    WHERE hypertable_name = 'sessions_snapshot'
  `;
  if (sessionsHypertable.length === 0) {
    await sql`SELECT create_hypertable('sessions_snapshot', by_range('timestamp'))`;
    console.log("  ✅ sessions_snapshot hypertable created");
  } else {
    console.log("  ⏭️  sessions_snapshot hypertable already exists");
  }

  // Convert query_stats to hypertable
  const queryStatsHypertable = await sql`
    SELECT * FROM timescaledb_information.hypertables 
    WHERE hypertable_name = 'query_stats'
  `;
  if (queryStatsHypertable.length === 0) {
    // Only create if the table exists (migration may not have run yet)
    const tableExists = await sql`
      SELECT 1 FROM information_schema.tables 
      WHERE table_name = 'query_stats'
    `;
    if (tableExists.length > 0) {
      await sql`SELECT create_hypertable('query_stats', by_range('captured_at'))`;
      console.log("  ✅ query_stats hypertable created");
    } else {
      console.log("  ⏭️  query_stats table not yet created");
    }
  } else {
    console.log("  ⏭️  query_stats hypertable already exists");
  }

  // Convert table_bloat_stats to hypertable
  const bloatHypertable = await sql`
    SELECT * FROM timescaledb_information.hypertables 
    WHERE hypertable_name = 'table_bloat_stats'
  `;
  if (bloatHypertable.length === 0) {
    const tableExists = await sql`
      SELECT 1 FROM information_schema.tables 
      WHERE table_name = 'table_bloat_stats'
    `;
    if (tableExists.length > 0) {
      await sql`SELECT create_hypertable('table_bloat_stats', by_range('captured_at'))`;
      console.log("  ✅ table_bloat_stats hypertable created");
    } else {
      console.log("  ⏭️  table_bloat_stats table not yet created");
    }
  } else {
    console.log("  ⏭️  table_bloat_stats hypertable already exists");
  }

  // Convert table_size_history to hypertable
  const sizeHistoryHypertable = await sql`
    SELECT * FROM timescaledb_information.hypertables 
    WHERE hypertable_name = 'table_size_history'
  `;
  if (sizeHistoryHypertable.length === 0) {
    const tableExists = await sql`
      SELECT 1 FROM information_schema.tables 
      WHERE table_name = 'table_size_history'
    `;
    if (tableExists.length > 0) {
      await sql`SELECT create_hypertable('table_size_history', by_range('captured_at'))`;
      console.log("  ✅ table_size_history hypertable created");
    } else {
      console.log("  ⏭️  table_size_history table not yet created");
    }
  } else {
    console.log("  ⏭️  table_size_history hypertable already exists");
  }

  console.log("✅ TimescaleDB setup complete.");

  await sql.end();
  process.exit(0);
}

runMigrations().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
