import type { FastifyBaseLogger } from "fastify";
import { db, rootCauseHints, snapshots } from "@pgvitals/db";
import { eq, desc, lt } from "drizzle-orm";
import type {
  CollectionResult,
  SessionRow,
  BlockingPair,
} from "./connection-collector.js";

/** A generated hint ready for insertion */
export interface GeneratedHint {
  ruleType: string;
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  metadata: Record<string, unknown>;
}

// --- Thresholds ---
const IDLE_IN_TXN_THRESHOLD_SECONDS = 300;
const CONNECTION_HOG_PERCENT = 0.7;
const BLOCKING_CHAIN_THRESHOLD_SECONDS = 30;
const CONNECTION_EXHAUSTION_PERCENT = 0.8;
const CONNECTION_SPIKE_PERCENT = 0.5; // 50% increase = spike
const CONNECTION_SPIKE_MIN_CONNS = 10; // ignore spikes when count is very low

/**
 * Evaluates heuristic rules against a snapshot and writes any generated hints
 * to the root_cause_hints table.
 */
export async function evaluateRules(
  result: CollectionResult,
  log: FastifyBaseLogger
): Promise<GeneratedHint[]> {
  const hints: GeneratedHint[] = [];

  hints.push(...checkIdleInTransactionLong(result.sessions));
  hints.push(
    ...checkConnectionHog(result.sessions, result.aggregates.maxConnections)
  );
  hints.push(...checkBlockingChainLong(result.sessions, result.blockingPairs));
  hints.push(
    ...checkConnectionExhaustion(
      result.aggregates.connectionCount,
      result.aggregates.maxConnections,
      result.sessions
    )
  );

  // Connection spike needs the previous snapshot
  const spikeHints = await checkConnectionSpike(
    result.monitoredDbId,
    result.aggregates.connectionCount,
    result.snapshotId
  );
  hints.push(...spikeHints);

  // Check for high-frequency concurrent lock storms
  hints.push(...checkMicroQueryLockStorm(result.sessions));

  if (hints.length > 0) {
    const rows = hints.map((h) => ({
      snapshotId: result.snapshotId,
      monitoredDbId: result.monitoredDbId,
      ruleType: h.ruleType,
      severity: h.severity,
      title: h.title,
      description: h.description,
      metadata: h.metadata,
    }));

    await db.insert(rootCauseHints).values(rows);

    log.info(
      { monitoredDbId: result.monitoredDbId, hintCount: hints.length },
      "Root cause hints generated"
    );
  }

  return hints;
}

/**
 * Rule 1: idle_in_transaction_long
 * Sessions in 'idle in transaction' state > 300 seconds.
 */
function checkIdleInTransactionLong(sessions: SessionRow[]): GeneratedHint[] {
  const hints: GeneratedHint[] = [];

  for (const s of sessions) {
    if (
      s.state === "idle in transaction" &&
      s.state_duration_seconds != null &&
      s.state_duration_seconds > IDLE_IN_TXN_THRESHOLD_SECONDS
    ) {
      const appName = s.application_name || "Unknown application";
      hints.push({
        ruleType: "idle_in_transaction_long",
        severity: "warning",
        title: `Long idle-in-transaction session (PID ${s.pid})`,
        description: `${appName} opened a transaction and never committed/rolled back. Check for missing COMMIT/ROLLBACK or an exception path that skips cleanup. Duration: ${s.state_duration_seconds}s.`,
        metadata: {
          pid: s.pid,
          application_name: s.application_name,
          duration_seconds: s.state_duration_seconds,
          query_text: s.query_text,
        },
      });
    }
  }

  return hints;
}

/**
 * Rule 2: connection_hog
 * Single application_name using > 70% of max_connections.
 */
function checkConnectionHog(
  sessions: SessionRow[],
  maxConnections: number
): GeneratedHint[] {
  const hints: GeneratedHint[] = [];
  const appCounts = new Map<string, number>();

  for (const s of sessions) {
    const app = s.application_name || "unknown";
    appCounts.set(app, (appCounts.get(app) ?? 0) + 1);
  }

  const threshold = Math.floor(maxConnections * CONNECTION_HOG_PERCENT);

  for (const [app, count] of appCounts) {
    if (count > threshold) {
      hints.push({
        ruleType: "connection_hog",
        severity: "warning",
        title: `Connection hog: ${app}`,
        description: `${app} is consuming most of your connection budget (${count}/${maxConnections}). Check pool size configuration.`,
        metadata: {
          application_name: app,
          connection_count: count,
          max_connections: maxConnections,
          percent: Math.round((count / maxConnections) * 100),
        },
      });
    }
  }

  return hints;
}

/**
 * Rule 3: blocking_chain_long
 * Blocking chains where the blocked session has been waiting > 30 seconds.
 */
function checkBlockingChainLong(
  sessions: SessionRow[],
  blockingPairs: BlockingPair[]
): GeneratedHint[] {
  const hints: GeneratedHint[] = [];

  if (blockingPairs.length === 0) return hints;

  // Build a lookup by PID
  const sessionByPid = new Map<number, SessionRow>();
  for (const s of sessions) {
    sessionByPid.set(s.pid, s);
  }

  for (const pair of blockingPairs) {
    const blockedSession = sessionByPid.get(pair.blocked_pid);
    if (!blockedSession) continue;

    const duration = blockedSession.state_duration_seconds ?? 0;
    if (duration > BLOCKING_CHAIN_THRESHOLD_SECONDS) {
      const queryPreview =
        blockedSession.query_text?.substring(0, 100) ?? "unknown query";
      hints.push({
        ruleType: "blocking_chain_long",
        severity: "critical",
        title: `Long blocking chain (PID ${pair.blocked_pid} blocked by ${pair.blocking_pid})`,
        description: `Query "${queryPreview}" has been blocked by PID ${pair.blocking_pid} for ${duration}s. Consider whether the blocking transaction can be shortened or run at a lower isolation level.`,
        metadata: {
          blocked_pid: pair.blocked_pid,
          blocking_pid: pair.blocking_pid,
          duration_seconds: duration,
          blocked_query: blockedSession.query_text,
        },
      });
    }
  }

  return hints;
}

/**
 * Rule 4: connection_exhaustion
 * Total connections > 80% of max_connections.
 */
function checkConnectionExhaustion(
  connectionCount: number,
  maxConnections: number,
  sessions: SessionRow[]
): GeneratedHint[] {
  const hints: GeneratedHint[] = [];

  if (connectionCount > maxConnections * CONNECTION_EXHAUSTION_PERCENT) {
    // Check if a connection pooler is detected
    const poolerApps = ["pgbouncer", "pgpool", "odyssey", "supavisor"];
    const hasPooler = sessions.some((s) =>
      poolerApps.some((p) =>
        s.application_name?.toLowerCase().includes(p)
      )
    );

    const poolerNote = hasPooler
      ? ""
      : " No connection pooler was detected. Consider adding one.";

    hints.push({
      ruleType: "connection_exhaustion",
      severity: "critical",
      title: "Connection limit approaching",
      description: `You're nearing your connection limit (${connectionCount}/${maxConnections}, ${Math.round((connectionCount / maxConnections) * 100)}%).${poolerNote}`,
      metadata: {
        connection_count: connectionCount,
        max_connections: maxConnections,
        percent: Math.round((connectionCount / maxConnections) * 100),
        pooler_detected: hasPooler,
      },
    });
  }

  return hints;
}

/**
 * Rule 5: connection_spike
 * Sudden spike in connection count — >50% increase from previous snapshot,
 * with a minimum of 10 connections to avoid noise at low counts.
 */
async function checkConnectionSpike(
  monitoredDbId: string,
  currentCount: number,
  currentSnapshotId: string
): Promise<GeneratedHint[]> {
  const hints: GeneratedHint[] = [];

  if (currentCount < CONNECTION_SPIKE_MIN_CONNS) return hints;

  // Fetch the most recent previous snapshot for this database
  const [prevSnapshot] = await db
    .select({ connectionCount: snapshots.connectionCount })
    .from(snapshots)
    .where(
      eq(snapshots.monitoredDbId, monitoredDbId)
    )
    .orderBy(desc(snapshots.timestamp))
    .limit(2); // current + previous; we skip the first if it's the current one

  // We need at least 2 snapshots to compare. The query returns newest first.
  // Since the current snapshot was just inserted, let's get the one before it.
  const allRecent = await db
    .select({ id: snapshots.id, connectionCount: snapshots.connectionCount })
    .from(snapshots)
    .where(eq(snapshots.monitoredDbId, monitoredDbId))
    .orderBy(desc(snapshots.timestamp))
    .limit(2);

  if (allRecent.length < 2) return hints;

  // allRecent[0] is the current snapshot, allRecent[1] is the previous
  const previousCount = allRecent[1].connectionCount;

  if (previousCount <= 0) return hints;

  const increasePercent = (currentCount - previousCount) / previousCount;

  if (increasePercent >= CONNECTION_SPIKE_PERCENT) {
    const pctDisplay = Math.round(increasePercent * 100);
    hints.push({
      ruleType: "connection_spike",
      severity: "warning",
      title: `Connection spike detected (+${pctDisplay}%)`,
      description: `Connection count jumped from ${previousCount} to ${currentCount} (+${pctDisplay}%) in the last polling interval. This could indicate a deployment, traffic burst, or connection leak.`,
      metadata: {
        previous_count: previousCount,
        current_count: currentCount,
        increase_percent: pctDisplay,
      },
    });
  }

  return hints;
}

/**
 * Rule 6: micro_query_lock_storm
 * Detects multiple concurrent active sessions executing write/locking operations or contending on locks.
 */
function checkMicroQueryLockStorm(sessions: SessionRow[]): GeneratedHint[] {
  const hints: GeneratedHint[] = [];
  const writeLockSessions = sessions.filter(
    (s) =>
      s.state === "active" &&
      s.query_text &&
      /^\s*(UPDATE|DELETE|INSERT|SELECT\s+[\s\S]*\s+FOR\s+(UPDATE|SHARE|KEY\s+SHARE|NO\s+KEY\s+UPDATE)|LOCK)/i.test(
        s.query_text
      )
  );

  if (writeLockSessions.length < 3) return hints;

  // Group by query pattern snippet
  const queryGroups = new Map<string, SessionRow[]>();
  for (const s of writeLockSessions) {
    const key = (s.query_text || "").slice(0, 60).trim();
    if (!queryGroups.has(key)) queryGroups.set(key, []);
    queryGroups.get(key)!.push(s);
  }

  for (const [querySnippet, sessList] of queryGroups) {
    if (sessList.length >= 3) {
      const lockWaiting = sessList.filter(
        (s) => s.wait_event_type === "Lock" || s.wait_event_type === "LWLock"
      ).length;
      const apps = Array.from(
        new Set(sessList.map((s) => s.application_name || "unknown app"))
      ).join(", ");

      hints.push({
        ruleType: "micro_query_lock_storm",
        severity: lockWaiting > 0 || sessList.length >= 5 ? "critical" : "warning",
        title: `Concurrent lock contention storm (${sessList.length} active sessions)`,
        description: `${sessList.length} concurrent sessions from [${apps}] are executing "${querySnippet}…"${
          lockWaiting > 0 ? ` with ${lockWaiting} sessions stalled on lock wait events` : ""
        }. High concurrency on hot rows causes CPU spinlocks, lock queuing, and high CPU spikes. Consider batching writes or throttling worker concurrency.`,
        metadata: {
          concurrent_sessions: sessList.length,
          lock_waiting_sessions: lockWaiting,
          applications: apps,
          query_snippet: querySnippet,
          pids: sessList.map((s) => s.pid),
        },
      });
    }
  }

  return hints;
}

