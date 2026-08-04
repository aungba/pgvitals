import type { FastifyBaseLogger } from "fastify";
import { db, schemaEvents, schemaSnapshots, monitoredDatabases } from "@pgvitals/db";
import { eq, desc } from "drizzle-orm";
import { decrypt } from "../lib/encryption.js";
import { safeQuery } from "../lib/safe-query.js";
import { config } from "../config.js";

/* ===================================================================
   Schema Diff Collector — detects DDL changes via periodic diffing
   Spec §2.13, Phase 8
   =================================================================== */

interface TableInfo {
  table_schema: string;
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
}

interface IndexInfo {
  schemaname: string;
  tablename: string;
  indexname: string;
  indexdef: string;
}

const TABLES_QUERY = `
SELECT table_schema, table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema NOT IN ('pg_catalog', 'information_schema', '_timescaledb_internal')
  AND table_name NOT LIKE '_hyper_%'
ORDER BY table_schema, table_name, ordinal_position
`;

const INDEXES_QUERY = `
SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname NOT IN ('pg_catalog', 'information_schema', '_timescaledb_internal')
  AND tablename NOT LIKE '_hyper_%'
ORDER BY schemaname, tablename, indexname
`;

interface TableSnapshot {
  schema: string;
  tableName: string;
  columns: Array<{ name: string; type: string; nullable: boolean }>;
}

interface IndexSnapshot {
  schema: string;
  tableName: string;
  indexName: string;
  definition: string;
  isUnique: boolean;
}

/**
 * Collects a schema snapshot and diffs it against the previous one.
 * Generates schema_events for any detected changes.
 */
export async function collectSchemaDiff(
  monitoredDbId: string,
  log: FastifyBaseLogger
): Promise<void> {
  const [monitoredDb] = await db
    .select()
    .from(monitoredDatabases)
    .where(eq(monitoredDatabases.id, monitoredDbId))
    .limit(1);

  if (!monitoredDb) {
    log.warn({ monitoredDbId }, "DB not found for schema diff collection");
    return;
  }

  const connectionString = decrypt(
    monitoredDb.connectionStringEncrypted,
    config.encryptionKey
  );

  try {
    // Fetch current schema state
    const tableRows = await safeQuery<TableInfo[]>(connectionString, TABLES_QUERY, { timeoutMs: 15000 });
    const indexRows = await safeQuery<IndexInfo[]>(connectionString, INDEXES_QUERY, { timeoutMs: 15000 });

    // Build structured snapshot
    const tablesMap = new Map<string, TableSnapshot>();
    for (const row of tableRows) {
      const key = `${row.table_schema}.${row.table_name}`;
      if (!tablesMap.has(key)) {
        tablesMap.set(key, {
          schema: row.table_schema,
          tableName: row.table_name,
          columns: [],
        });
      }
      tablesMap.get(key)!.columns.push({
        name: row.column_name,
        type: row.data_type,
        nullable: row.is_nullable === "YES",
      });
    }
    const currentTables = Array.from(tablesMap.values());

    const currentIndexes: IndexSnapshot[] = indexRows.map((r) => ({
      schema: r.schemaname,
      tableName: r.tablename,
      indexName: r.indexname,
      definition: r.indexdef,
      isUnique: r.indexdef.includes("UNIQUE"),
    }));

    // Get previous snapshot
    const [prevSnapshot] = await db
      .select()
      .from(schemaSnapshots)
      .where(eq(schemaSnapshots.monitoredDbId, monitoredDbId))
      .orderBy(desc(schemaSnapshots.capturedAt))
      .limit(1);

    const now = new Date();

    // Store current snapshot
    await db.insert(schemaSnapshots).values({
      monitoredDbId,
      capturedAt: now,
      tablesJson: currentTables,
      indexesJson: currentIndexes,
    });

    // If no previous snapshot, nothing to diff
    if (!prevSnapshot) {
      log.info({ monitoredDbId }, "First schema snapshot captured (no diff)");
      return;
    }

    // Diff tables
    const prevTables = (prevSnapshot.tablesJson as TableSnapshot[]) || [];
    const prevIndexes = (prevSnapshot.indexesJson as IndexSnapshot[]) || [];

    const events: Array<{
      monitoredDbId: string;
      eventType: string;
      objectName: string;
      detectedAt: Date;
      details: Record<string, unknown> | null;
    }> = [];

    // Detect table additions/removals
    const prevTableNames = new Set(prevTables.map((t) => `${t.schema}.${t.tableName}`));
    const currTableNames = new Set(currentTables.map((t) => `${t.schema}.${t.tableName}`));

    for (const name of currTableNames) {
      if (!prevTableNames.has(name)) {
        events.push({
          monitoredDbId,
          eventType: "create_table",
          objectName: name,
          detectedAt: now,
          details: null,
        });
      }
    }

    for (const name of prevTableNames) {
      if (!currTableNames.has(name)) {
        events.push({
          monitoredDbId,
          eventType: "drop_table",
          objectName: name,
          detectedAt: now,
          details: null,
        });
      }
    }

    // Detect column additions/removals (for tables that exist in both)
    const prevTableMap = new Map(prevTables.map((t) => [`${t.schema}.${t.tableName}`, t]));
    for (const curr of currentTables) {
      const key = `${curr.schema}.${curr.tableName}`;
      const prev = prevTableMap.get(key);
      if (!prev) continue;

      const prevColNames = new Set(prev.columns.map((c) => c.name));
      const currColNames = new Set(curr.columns.map((c) => c.name));

      for (const col of curr.columns) {
        if (!prevColNames.has(col.name)) {
          events.push({
            monitoredDbId,
            eventType: "add_column",
            objectName: `${key}.${col.name}`,
            detectedAt: now,
            details: { columnName: col.name, dataType: col.type, nullable: col.nullable },
          });
        }
      }

      for (const col of prev.columns) {
        if (!currColNames.has(col.name)) {
          events.push({
            monitoredDbId,
            eventType: "drop_column",
            objectName: `${key}.${col.name}`,
            detectedAt: now,
            details: { columnName: col.name },
          });
        }
      }
    }

    // Detect index additions/removals
    const prevIdxNames = new Set(prevIndexes.map((i) => `${i.schema}.${i.indexName}`));
    const currIdxNames = new Set(currentIndexes.map((i) => `${i.schema}.${i.indexName}`));

    for (const idx of currentIndexes) {
      const key = `${idx.schema}.${idx.indexName}`;
      if (!prevIdxNames.has(key)) {
        events.push({
          monitoredDbId,
          eventType: "create_index",
          objectName: key,
          detectedAt: now,
          details: { tableName: idx.tableName, definition: idx.definition, isUnique: idx.isUnique },
        });
      }
    }

    for (const idx of prevIndexes) {
      const key = `${idx.schema}.${idx.indexName}`;
      if (!currIdxNames.has(key)) {
        events.push({
          monitoredDbId,
          eventType: "drop_index",
          objectName: key,
          detectedAt: now,
          details: { tableName: idx.tableName },
        });
      }
    }

    if (events.length > 0) {
      await db.insert(schemaEvents).values(events);
      log.info({ monitoredDbId, eventCount: events.length }, "Schema changes detected");
    } else {
      log.debug({ monitoredDbId }, "No schema changes detected");
    }
  } catch (err) {
    log.warn({ err, monitoredDbId }, "Failed to collect schema diff");
  }
}
