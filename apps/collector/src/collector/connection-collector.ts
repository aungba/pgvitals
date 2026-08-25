import type { FastifyBaseLogger } from "fastify";
import { db, snapshots, sessionsSnapshot, monitoredDatabases } from "@pgvitals/db";
import { eq } from "drizzle-orm";
import { decrypt } from "../lib/encryption.js";
import { safeQuery } from "../lib/safe-query.js";
import { redactQueryLiterals } from "../lib/redact-query.js";
import { sessionBroadcaster } from "../lib/session-broadcaster.js";
import { config } from "../config.js";

/** Raw row from pg_stat_activity */
export interface SessionRow {
  pid: number;
  usename: string | null;
  application_name: string | null;
  client_addr: string | null;
  state: string | null;
  state_duration_seconds: number | null;
  query_text: string | null;
  query_start: string | null;
  wait_event_type: string | null;
  wait_event: string | null;
}

/** Blocking chain pair */
export interface BlockingPair {
  blocked_pid: number;
  blocking_pid: number;
}

/** Aggregate connection metrics */
export interface ConnectionAggregates {
  connectionCount: number;
  activeCount: number;
  idleCount: number;
  idleInTxnCount: number;
  idleInTxnAbortedCount: number;
  maxConnections: number;
}

/** Full snapshot result returned for downstream processing */
export interface CollectionResult {
  snapshotId: string;
  monitoredDbId: string;
  sessions: SessionRow[];
  blockingPairs: BlockingPair[];
  aggregates: ConnectionAggregates;
}

const PG_STAT_ACTIVITY_QUERY = `
SELECT
  pid,
  usename,
  application_name,
  client_addr::text,
  state,
  EXTRACT(EPOCH FROM (now() - state_change))::int AS state_duration_seconds,
  LEFT(query, 500) AS query_text,
  query_start::text,
  wait_event_type,
  wait_event
FROM pg_stat_activity
WHERE datname = current_database()
  AND pid <> pg_backend_pid()
`;

const BLOCKING_CHAINS_QUERY = `
SELECT
  blocked.pid AS blocked_pid,
  blocker.pid AS blocking_pid
FROM pg_locks blocked
JOIN pg_locks blocker
  ON blocker.locktype = blocked.locktype
  AND blocker.database IS NOT DISTINCT FROM blocked.database
  AND blocker.relation IS NOT DISTINCT FROM blocked.relation
  AND blocker.page IS NOT DISTINCT FROM blocked.page
  AND blocker.tuple IS NOT DISTINCT FROM blocked.tuple
  AND blocker.virtualxid IS NOT DISTINCT FROM blocked.virtualxid
  AND blocker.transactionid IS NOT DISTINCT FROM blocked.transactionid
  AND blocker.classid IS NOT DISTINCT FROM blocked.classid
  AND blocker.objid IS NOT DISTINCT FROM blocked.objid
  AND blocker.objsubid IS NOT DISTINCT FROM blocked.objsubid
  AND blocker.pid <> blocked.pid
JOIN pg_stat_activity ba ON ba.pid = blocker.pid
WHERE NOT blocked.granted
  AND blocker.granted
`;

const MAX_CONNECTIONS_QUERY = `SHOW max_connections`;

/**
 * Collects a snapshot of connection and session data from a monitored database.
 */
export async function collectSnapshot(
  monitoredDbId: string,
  log: FastifyBaseLogger
): Promise<CollectionResult> {
  // 1. Fetch the monitored database record
  const [monitoredDb] = await db
    .select()
    .from(monitoredDatabases)
    .where(eq(monitoredDatabases.id, monitoredDbId))
    .limit(1);

  if (!monitoredDb) {
    throw new Error(`Monitored database not found: ${monitoredDbId}`);
  }

  // 2. Decrypt connection string
  const connectionString = decrypt(
    monitoredDb.connectionStringEncrypted,
    config.encryptionKey
  );

  log.info({ monitoredDbId, name: monitoredDb.name }, "Collecting snapshot");

  // 3. Query pg_stat_activity
  const sessions = await safeQuery<SessionRow[]>(
    connectionString,
    PG_STAT_ACTIVITY_QUERY
  );

  // 4. Query blocking chains
  let blockingPairs: BlockingPair[] = [];
  try {
    blockingPairs = await safeQuery<BlockingPair[]>(
      connectionString,
      BLOCKING_CHAINS_QUERY
    );
  } catch (err) {
    log.warn({ err, monitoredDbId }, "Failed to query blocking chains");
  }

  // 5. Query max_connections
  const maxConnResult = await safeQuery<Array<{ max_connections: string }>>(
    connectionString,
    MAX_CONNECTIONS_QUERY
  );
  const maxConnections = parseInt(maxConnResult[0]?.max_connections ?? "100", 10);

  // 6. Compute aggregates
  const aggregates = computeAggregates(sessions, maxConnections);

  // 7. Build blocking map: blocked_pid -> blocking_pid
  const blockingMap = new Map<number, number>();
  for (const pair of blockingPairs) {
    blockingMap.set(pair.blocked_pid, pair.blocking_pid);
  }

  // 8. Write snapshot to database
  const now = new Date();

  const [snapshotRow] = await db
    .insert(snapshots)
    .values({
      monitoredDbId,
      timestamp: now,
      connectionCount: aggregates.connectionCount,
      activeCount: aggregates.activeCount,
      idleCount: aggregates.idleCount,
      idleInTxnCount: aggregates.idleInTxnCount,
      idleInTxnAbortedCount: aggregates.idleInTxnAbortedCount,
      maxConnections: aggregates.maxConnections,
      rawPayload: { blockingPairs },
    })
    .returning({ id: snapshots.id });

  const snapshotId = snapshotRow.id;

  // 9. Write session snapshot rows in chunks of 250
  const sessionRows = sessions.map((s) => ({
    snapshotId,
    monitoredDbId,
    timestamp: now,
    pid: s.pid,
    usename: s.usename,
    applicationName: s.application_name,
    clientAddr: s.client_addr,
    state: s.state,
    stateDurationSeconds: s.state_duration_seconds,
    queryText: s.query_text ? redactQueryLiterals(s.query_text) : null,
    queryStart: s.query_start ? new Date(s.query_start) : null,
    waitEventType: s.wait_event_type,
    waitEvent: s.wait_event,
    blockingPid: blockingMap.get(s.pid) ?? null,
  }));

  if (sessionRows.length > 0) {
    const CHUNK_SIZE = 250;
    for (let i = 0; i < sessionRows.length; i += CHUNK_SIZE) {
      const chunk = sessionRows.slice(i, i + CHUNK_SIZE);
      await db.insert(sessionsSnapshot).values(chunk);
    }
  }

  // 10. Broadcast real-time update to active SSE clients with zero DB query overhead
  sessionBroadcaster.publish(monitoredDbId, {
    snapshotId,
    timestamp: now,
    sessions: sessionRows,
  });

  log.info(
    {
      monitoredDbId,
      snapshotId,
      connectionCount: aggregates.connectionCount,
      activeCount: aggregates.activeCount,
    },
    "Snapshot collected"
  );

  return {
    snapshotId,
    monitoredDbId,
    sessions,
    blockingPairs,
    aggregates,
  };
}

/**
 * Computes aggregate metrics from the session list.
 */
function computeAggregates(
  sessions: SessionRow[],
  maxConnections: number
): ConnectionAggregates {
  let activeCount = 0;
  let idleCount = 0;
  let idleInTxnCount = 0;
  let idleInTxnAbortedCount = 0;

  for (const s of sessions) {
    switch (s.state) {
      case "active":
        activeCount++;
        break;
      case "idle":
        idleCount++;
        break;
      case "idle in transaction":
        idleInTxnCount++;
        break;
      case "idle in transaction (aborted)":
        idleInTxnAbortedCount++;
        break;
      // Other states: fastpath function call, disabled, etc.
    }
  }

  return {
    connectionCount: sessions.length,
    activeCount,
    idleCount,
    idleInTxnCount,
    idleInTxnAbortedCount,
    maxConnections,
  };
}
