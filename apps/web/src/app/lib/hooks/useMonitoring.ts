"use client";

import { useEffect, useState, useRef } from "react";
import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import {
  getOverview,
  getSnapshots,
  getRollups,
  getSessions,
  getQueries,
  subscribeLiveSessions,
  type OverviewResponse,
  type Snapshot,
  type MetricRollup,
  type Session,
  type QueryStat,
} from "../api";

export function useOverview(
  dbId: string,
  token?: string,
  options?: Partial<UseQueryOptions<OverviewResponse, Error>>
) {
  return useQuery<OverviewResponse, Error>({
    queryKey: ["overview", dbId, token],
    queryFn: () => getOverview(dbId, token),
    enabled: !!dbId,
    refetchInterval: 10_000,
    ...options,
  });
}

export function useSnapshots(
  dbId: string,
  limit = 200,
  from?: string,
  to?: string,
  token?: string,
  options?: Partial<UseQueryOptions<Snapshot[], Error>>
) {
  return useQuery<Snapshot[], Error>({
    queryKey: ["snapshots", dbId, limit, from, to, token],
    queryFn: () => getSnapshots(dbId, limit, from, to, token),
    enabled: !!dbId,
    refetchInterval: 15_000,
    ...options,
  });
}

export function useRollups(
  dbId: string,
  resolution: "5m" | "1h" | "1d" = "5m",
  hours = 24,
  token?: string,
  options?: Partial<UseQueryOptions<MetricRollup[], Error>>
) {
  return useQuery<MetricRollup[], Error>({
    queryKey: ["rollups", dbId, resolution, hours, token],
    queryFn: () => getRollups(dbId, resolution, hours, token),
    enabled: !!dbId,
    refetchInterval: 30_000,
    ...options,
  });
}

export function useSessionsQuery(
  dbId: string,
  snapshotId?: string,
  token?: string,
  options?: Partial<UseQueryOptions<{ snapshotId: string | null; snapshotTimestamp: string | null; sessions: Session[] }, Error>>
) {
  return useQuery({
    queryKey: ["sessions", dbId, snapshotId, token],
    queryFn: () => getSessions(dbId, snapshotId, token),
    enabled: !!dbId,
    refetchInterval: snapshotId ? false : 5_000,
    ...options,
  });
}

export function useQueriesList(
  dbId: string,
  sort: "total_time" | "calls" | "mean_time" | "rows" = "total_time",
  limit = 50,
  token?: string,
  options?: Partial<UseQueryOptions<{ queries: QueryStat[]; latestCapturedAt: string | null }, Error>>
) {
  return useQuery<{ queries: QueryStat[]; latestCapturedAt: string | null }, Error>({
    queryKey: ["queries", dbId, sort, limit, token],
    queryFn: () => getQueries(dbId, sort, limit, token),
    enabled: !!dbId,
    refetchInterval: 15_000,
    ...options,
  });
}

/**
 * Real-time SSE Live Sessions hook with automatic polling fallback.
 */
export function useLiveSessions(
  dbId: string,
  token?: string,
  fallbackPollingMs = 5000
) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const [timestamp, setTimestamp] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fallbackTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!dbId) return;

    let isMounted = true;

    // Start SSE stream
    const unsubscribe = subscribeLiveSessions(
      dbId,
      token,
      (data) => {
        if (!isMounted) return;
        setIsLive(true);
        setError(null);
        if (data.sessions) setSessions(data.sessions);
        if (data.snapshotId) setSnapshotId(data.snapshotId);
        if (data.timestamp) setTimestamp(data.timestamp);
      },
      () => {
        if (!isMounted) return;
        setIsLive(false);
        setError("Live streaming disconnected, falling back to polling");
      }
    );

    // Fallback polling helper if SSE fails
    const runFallbackPoll = async () => {
      if (isLive) return;
      try {
        const data = await getSessions(dbId, undefined, token);
        if (isMounted) {
          setSessions(data.sessions);
          setSnapshotId(data.snapshotId);
          setTimestamp(data.snapshotTimestamp);
        }
      } catch {
        /* ignore polling errors */
      }
    };

    fallbackTimerRef.current = setInterval(runFallbackPoll, fallbackPollingMs);

    return () => {
      isMounted = false;
      unsubscribe();
      if (fallbackTimerRef.current) {
        clearInterval(fallbackTimerRef.current);
      }
    };
  }, [dbId, token, fallbackPollingMs, isLive]);

  return { sessions, snapshotId, timestamp, isLive, error };
}
