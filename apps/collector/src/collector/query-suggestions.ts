import type { FastifyBaseLogger } from "fastify";
import { db, queryStats, querySuggestions } from "@pgvitals/db";
import { eq, and, gte, desc } from "drizzle-orm";

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

  // 3. Run suggestion rules
  for (const stat of latestStats) {
    // Rule 1: N+1 Detection — high call count with low mean time
    if (stat.calls > 500 && stat.meanTimeMs < 10) {
      suggestions.push({
        queryid: stat.queryid,
        queryText: stat.queryText,
        suggestionType: "n_plus_one",
        title: "Possible N+1 query pattern",
        description: `This query runs ${stat.calls.toLocaleString()}x with ${stat.meanTimeMs.toFixed(1)}ms average — possible N+1 pattern. Consider batching with IN (...) or a JOIN.`,
        severity: stat.calls > 5000 ? "critical" : "warning",
        metadata: { calls: stat.calls, meanTimeMs: stat.meanTimeMs, queryText: stat.queryText.slice(0, 200) },
      });
    }

    // Rule 2: Cache Miss Detection — more disk reads than cache hits
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

    // Rule 3: Temp Spill Detection — query spilling to disk
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
            description: `This query has slowed ${Math.round(pctChange)}% over 7 days (${stat.meanTimeMs.toFixed(1)}ms → ${oldStat.meanTimeMs.toFixed(1)}ms). Check table growth, missing VACUUM, or a recent schema change.`,
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
