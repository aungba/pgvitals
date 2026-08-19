import type { FastifyBaseLogger } from "fastify";
import { db, queryStats, querySuggestions } from "@pgvitals/db";
import { eq, and, gte, lt, desc } from "drizzle-orm";
import { analyzeSqlAdvice } from "./sql-advisor.js";
import { evaluateIoStall } from "./rules/io-stall-rule.js";

/* ===================================================================
   Query Suggestions Engine — Phase C
   Analyzes query_stats to surface N+1 patterns, cache misses,
   temp spills, and performance regressions.
   =================================================================== */

interface SuggestionCandidate {
  queryid: number;
  queryText: string;
  suggestionType: string;
  title: string;
  description: string;
  severity: "info" | "warning" | "critical";
  metadata: Record<string, unknown>;
}

/**
 * Analyzes the latest query stats for a database and generates suggestions.
 * Called after collectQueryStats() in the query-stats worker.
 */
export async function analyzeQuerySuggestions(
  monitoredDbId: string,
  log: FastifyBaseLogger
): Promise<void> {
  // 1. Get the latest captured_at timestamp
  const [latestCapture] = await db
    .select({ capturedAt: queryStats.capturedAt })
    .from(queryStats)
    .where(eq(queryStats.monitoredDbId, monitoredDbId))
    .orderBy(desc(queryStats.capturedAt))
    .limit(1);

  if (!latestCapture) {
    log.debug({ monitoredDbId }, "No query stats for suggestions analysis");
    return;
  }

  // 2. Get the latest query stats
  const latestStats = await db
    .select()
    .from(queryStats)
    .where(
      and(
        eq(queryStats.monitoredDbId, monitoredDbId),
        eq(queryStats.capturedAt, latestCapture.capturedAt)
      )
    );

  if (latestStats.length === 0) return;

  const suggestions: SuggestionCandidate[] = [];

  // 3. Find the previous snapshot to calculate call velocity (calls/sec)
  const previousCaptures = await db
    .select({ capturedAt: queryStats.capturedAt })
    .from(queryStats)
    .where(
      and(
        eq(queryStats.monitoredDbId, monitoredDbId),
        lt(queryStats.capturedAt, latestCapture.capturedAt)
      )
    )
    .orderBy(desc(queryStats.capturedAt))
    .limit(1);

  const prevCapture = previousCaptures[0];
  const prevStatsMap = new Map<number, (typeof latestStats)[0]>();
  let deltaSeconds = 300; // default 5 minutes if no previous timestamp

  if (prevCapture) {
    deltaSeconds = Math.max(
      1,
      (new Date(latestCapture.capturedAt).getTime() - new Date(prevCapture.capturedAt).getTime()) / 1000
    );
    const prevStats = await db
      .select()
      .from(queryStats)
      .where(
        and(
          eq(queryStats.monitoredDbId, monitoredDbId),
          eq(queryStats.capturedAt, prevCapture.capturedAt)
        )
      );
    for (const p of prevStats) {
      prevStatsMap.set(p.queryid, p);
    }
  }

  // 4. Run suggestion rules
  for (const stat of latestStats) {
    const prev = prevStatsMap.get(stat.queryid);
    const deltaCalls = prev ? Math.max(0, stat.calls - prev.calls) : stat.calls;
    const callsPerSec = deltaCalls / deltaSeconds;
    const isWriteOrLock = /^\s*(UPDATE|DELETE|INSERT|SELECT\s+[\s\S]*\s+FOR\s+(UPDATE|SHARE|KEY\s+SHARE|NO\s+KEY\s+UPDATE)|LOCK)/i.test(stat.queryText);
    const sqlAdvice = analyzeSqlAdvice(stat.queryText, stat.calls, stat.meanTimeMs, stat.pctOfTotalTime);

    // Rule 1: Micro-Query Lock Storm & High-Frequency CPU Contention
    // Catches fast queries (<150ms) with high call velocity that dominate database CPU (>20% total workload)
    if (
      (callsPerSec >= 15 || stat.calls > 1500) &&
      stat.meanTimeMs < 150 &&
      stat.pctOfTotalTime >= 20
    ) {
      const isCritical = stat.pctOfTotalTime >= 40 || callsPerSec >= 50;
      const rateLabel = callsPerSec >= 1 ? `${Math.round(callsPerSec * 10) / 10}/sec` : `${stat.calls.toLocaleString()} calls`;

      let desc = isWriteOrLock
        ? `This query runs at ~${rateLabel} with an individual avg of ${stat.meanTimeMs.toFixed(1)}ms, but consumes ${stat.pctOfTotalTime.toFixed(1)}% of total database compute time (${sqlAdvice.totalTimeHours}h DB time). High concurrency on write/locking operations causes severe lock arbitration and CPU usage.`
        : `This query runs at ~${rateLabel} with an individual avg of ${stat.meanTimeMs.toFixed(1)}ms, but consumes ${stat.pctOfTotalTime.toFixed(1)}% of total database compute time (${sqlAdvice.totalTimeHours}h DB time). High execution volume is saturating CPU capacity.`;

      if (sqlAdvice.recommendedIndexDdl) {
        desc += ` Creating a partial/covering index can enable Index-Only Scans (~0.05ms) saving up to ${sqlAdvice.estimatedSavingsHours}h of CPU time (${sqlAdvice.estimatedSavingsPct}% reduction).`;
      } else {
        desc += isWriteOrLock
          ? ` Consider batching updates (e.g. bulk UPDATE with VALUES) or reducing concurrent worker pool size.`
          : ` Consider application-level caching, batching queries, or connection pool throttling.`;
      }

      suggestions.push({
        queryid: stat.queryid,
        queryText: stat.queryText,
        suggestionType: "micro_query_lock_storm",
        title: isWriteOrLock
          ? "High-frequency write/lock contention storm"
          : "High-frequency micro-query CPU storm",
        description: desc,
        severity: isCritical ? "critical" : "warning",
        metadata: {
          calls: stat.calls,
          deltaCalls,
          callsPerSecond: Math.round(callsPerSec * 10) / 10,
          meanTimeMs: stat.meanTimeMs,
          pctOfTotalTime: stat.pctOfTotalTime,
          isWriteOrLock,
          queryText: stat.queryText.slice(0, 250),
          recommendedIndexDdl: sqlAdvice.recommendedIndexDdl,
          tableName: sqlAdvice.tableName,
          estimatedSavingsHours: sqlAdvice.estimatedSavingsHours,
          estimatedSavingsPct: sqlAdvice.estimatedSavingsPct,
          totalTimeHours: sqlAdvice.totalTimeHours,
        },
      });
    }

    // Rule 2: High-Frequency Micro-Queries / N+1 / Unbatched Writes
    if (stat.calls > 500 && stat.meanTimeMs < 15 && stat.pctOfTotalTime < 20) {
      const trimmed = stat.queryText.trim();
      const isInsert = /^\s*INSERT\s+INTO/i.test(trimmed);
      const isUpdate = /^\s*UPDATE\s+/i.test(trimmed);
      const isDelete = /^\s*DELETE\s+FROM/i.test(trimmed);

      let title = "Possible N+1 query pattern";
      let desc = `This query runs ${stat.calls.toLocaleString()}x with ${stat.meanTimeMs.toFixed(1)}ms average — possible N+1 read pattern. Consider batching with WHERE id = ANY(...) / IN (...) or a JOIN.`;
      let suggestionType = "n_plus_one";

      if (isInsert) {
        suggestionType = "unbatched_insert";
        const table = sqlAdvice.tableName ? ` into "${sqlAdvice.tableName}"` : "";
        title = `High-frequency single-row INSERTs${table}`;
        desc = `This query executes ${stat.calls.toLocaleString()}x taking ${stat.meanTimeMs.toFixed(1)}ms per insert. Executing millions of single-row INSERTs incurs heavy network roundtrip and WAL commit overhead. Consider batching rows into multi-row INSERT statements (e.g. INSERT INTO ... VALUES (...), (...)), using bulk COPY, or wrapping rows in a single transaction block.`;
      } else if (isUpdate) {
        suggestionType = "unbatched_update";
        const table = sqlAdvice.tableName ? ` on "${sqlAdvice.tableName}"` : "";
        title = `High-frequency single-row UPDATEs${table}`;
        desc = `This query executes ${stat.calls.toLocaleString()}x with ${stat.meanTimeMs.toFixed(1)}ms average. Consider batching updates with UPDATE ... FROM (VALUES (...)), WHERE id = ANY(...), or grouping operations in a single transaction.`;
      } else if (isDelete) {
        suggestionType = "unbatched_delete";
        const table = sqlAdvice.tableName ? ` on "${sqlAdvice.tableName}"` : "";
        title = `High-frequency single-row DELETEs${table}`;
        desc = `This query executes ${stat.calls.toLocaleString()}x with ${stat.meanTimeMs.toFixed(1)}ms average. Consider batching deletions with WHERE id = ANY(...) or deleting in chunks.`;
      } else if (sqlAdvice.recommendedIndexDdl && sqlAdvice.totalTimeHours >= 0.5) {
        title = sqlAdvice.tableName
          ? `Heavy point-lookup workload on "${sqlAdvice.tableName}" (${sqlAdvice.totalTimeHours}h DB time)`
          : `High-frequency point-lookup workload (${sqlAdvice.totalTimeHours}h DB time)`;
        desc = `This query executes ${stat.calls.toLocaleString()}x taking ${stat.meanTimeMs.toFixed(1)}ms per call (${sqlAdvice.totalTimeHours}h total CPU time). Creating a tailored index can enable Index-Only Scans (~0.05ms) saving up to ${sqlAdvice.estimatedSavingsHours}h of CPU time (${sqlAdvice.estimatedSavingsPct}% reduction). Alternatively, batch multiple lookups in application code.`;
      }

      suggestions.push({
        queryid: stat.queryid,
        queryText: stat.queryText,
        suggestionType,
        title,
        description: desc,
        severity: stat.calls > 5000 || sqlAdvice.totalTimeHours > 5 ? "critical" : "warning",
        metadata: {
          calls: stat.calls,
          meanTimeMs: stat.meanTimeMs,
          queryText: stat.queryText.slice(0, 250),
          recommendedIndexDdl: sqlAdvice.recommendedIndexDdl,
          tableName: sqlAdvice.tableName,
          estimatedSavingsHours: sqlAdvice.estimatedSavingsHours,
          estimatedSavingsPct: sqlAdvice.estimatedSavingsPct,
          totalTimeHours: sqlAdvice.totalTimeHours,
        },
      });
    }

    // Rule 3: Cache Miss Detection — more disk reads than cache hits
    const totalBlks = stat.sharedBlksHit + stat.sharedBlksRead;
    if (totalBlks > 100 && stat.sharedBlksRead > stat.sharedBlksHit) {
      const hitRatio = totalBlks > 0
        ? Math.round((stat.sharedBlksHit / totalBlks) * 100)
        : 0;
      suggestions.push({
        queryid: stat.queryid,
        queryText: stat.queryText,
        suggestionType: "cache_miss",
        title: "High disk read ratio",
        description: `This query has a ${hitRatio}% cache hit ratio — it reads mostly from disk, not cache. Consider an index, or review shared_buffers sizing.`,
        severity: hitRatio < 50 ? "critical" : "warning",
        metadata: {
          sharedBlksHit: stat.sharedBlksHit,
          sharedBlksRead: stat.sharedBlksRead,
          cacheHitRatio: hitRatio,
          queryText: stat.queryText.slice(0, 200),
        },
      });
    }

    // Rule 4: Temp Spill Detection — query spilling to disk
    if (stat.tempBlksWritten > 0) {
      suggestions.push({
        queryid: stat.queryid,
        queryText: stat.queryText,
        suggestionType: "temp_spill",
        title: "Disk spill detected",
        description: `This query is spilling to disk for sorts/hashes (${stat.tempBlksWritten.toLocaleString()} temp blocks written). Consider raising work_mem or reducing result set size.`,
        severity: stat.tempBlksWritten > 10000 ? "critical" : "warning",
        metadata: { tempBlksWritten: stat.tempBlksWritten, queryText: stat.queryText.slice(0, 200) },
      });
    }

    // Rule 5: I/O Timing Stall Detection (Spec §4.3)
    if (stat.ioTimePercentage != null && stat.ioTimePercentage > 0) {
      const ioStall = evaluateIoStall({
        queryid: stat.queryid,
        total_exec_time: stat.totalTimeMs,
        blk_read_time: stat.blkReadTime ?? 0,
        blk_write_time: stat.blkWriteTime ?? 0,
        io_time_percentage: stat.ioTimePercentage,
      });
      if (ioStall) {
        suggestions.push({
          queryid: stat.queryid,
          queryText: stat.queryText,
          suggestionType: "io_stall",
          title: ioStall.title,
          description: `${ioStall.message} ${ioStall.actionableFix}`,
          severity: ioStall.severity,
          metadata: ioStall.metadata,
        });
      }
    }
  }

  // Rule 4: Week-over-week Regression — compare mean_time from 7 days ago
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const eightDaysAgo = new Date();
  eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);

  for (const stat of latestStats) {
    try {
      // Find a snapshot from approximately 7 days ago
      const [oldStat] = await db
        .select()
        .from(queryStats)
        .where(
          and(
            eq(queryStats.monitoredDbId, monitoredDbId),
            eq(queryStats.queryid, stat.queryid),
            gte(queryStats.capturedAt, eightDaysAgo)
          )
        )
        .orderBy(queryStats.capturedAt)
        .limit(1);

      if (oldStat && oldStat.meanTimeMs > 0) {
        const pctChange = ((stat.meanTimeMs - oldStat.meanTimeMs) / oldStat.meanTimeMs) * 100;
        if (pctChange > 30) {
          suggestions.push({
            queryid: stat.queryid,
            queryText: stat.queryText,
            suggestionType: "regression",
            title: "Performance regression detected",
            description: `This query has slowed ${Math.round(pctChange)}% over 7 days (${oldStat.meanTimeMs.toFixed(1)}ms → ${stat.meanTimeMs.toFixed(1)}ms). Check table growth, missing VACUUM, or a recent schema change.`,
            severity: pctChange > 100 ? "critical" : "warning",
            metadata: {
              currentMeanMs: stat.meanTimeMs,
              previousMeanMs: oldStat.meanTimeMs,
              pctChange: Math.round(pctChange),
              queryText: stat.queryText.slice(0, 200),
            },
          });
        }
      }
    } catch {
      // Skip regression check if comparison fails
    }
  }

  // 4. Clear previous non-dismissed suggestions for this DB
  if (suggestions.length > 0) {
    await db
      .delete(querySuggestions)
      .where(
        and(
          eq(querySuggestions.monitoredDbId, monitoredDbId),
          eq(querySuggestions.dismissed, false)
        )
      );

    // 5. Insert new suggestions
    const now = new Date();
    await db.insert(querySuggestions).values(
      suggestions.map((s) => ({
        monitoredDbId,
        queryid: s.queryid,
        suggestionType: s.suggestionType,
        title: s.title,
        description: s.description,
        severity: s.severity,
        metadata: s.metadata,
        detectedAt: now,
      }))
    );

    log.info(
      { monitoredDbId, count: suggestions.length },
      "Query suggestions generated"
    );
  }
}
