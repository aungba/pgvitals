import { describe, it, expect } from "vitest";

/* ===================================================================
   Tests: Micro-Query Lock Contention & CPU Storm Rules
   =================================================================== */

interface QueryStat {
  queryid: number;
  queryText: string;
  calls: number;
  meanTimeMs: number;
  pctOfTotalTime: number;
}

interface SessionRow {
  pid: number;
  usename: string | null;
  application_name: string | null;
  client_addr: string | null;
  state: string | null;
  state_duration_seconds: number | null;
  query_text: string | null;
  wait_event_type: string | null;
  wait_event: string | null;
}

function detectMicroQueryStorm(
  stat: QueryStat,
  prevCalls: number | undefined,
  deltaSeconds: number = 300
) {
  const deltaCalls = prevCalls !== undefined ? Math.max(0, stat.calls - prevCalls) : stat.calls;
  const callsPerSec = deltaCalls / deltaSeconds;
  const isWriteOrLock = /^\s*(UPDATE|DELETE|INSERT|SELECT\s+[\s\S]*\s+FOR\s+(UPDATE|SHARE|KEY\s+SHARE|NO\s+KEY\s+UPDATE)|LOCK)/i.test(
    stat.queryText
  );

  const isStorm =
    (callsPerSec >= 15 || stat.calls > 1500) &&
    stat.meanTimeMs < 150 &&
    stat.pctOfTotalTime >= 20;

  return {
    isStorm,
    callsPerSec,
    isWriteOrLock,
    severity: stat.pctOfTotalTime >= 40 || callsPerSec >= 50 ? "critical" : "warning",
  };
}

function detectConcurrentLockSessions(sessions: SessionRow[]) {
  const writeLockSessions = sessions.filter(
    (s) =>
      s.state === "active" &&
      s.query_text &&
      /^\s*(UPDATE|DELETE|INSERT|SELECT\s+[\s\S]*\s+FOR\s+(UPDATE|SHARE|KEY\s+SHARE|NO\s+KEY\s+UPDATE)|LOCK)/i.test(
        s.query_text
      )
  );

  const queryGroups = new Map<string, SessionRow[]>();
  for (const s of writeLockSessions) {
    const key = (s.query_text || "").slice(0, 60).trim();
    if (!queryGroups.has(key)) queryGroups.set(key, []);
    queryGroups.get(key)!.push(s);
  }

  const detected: Array<{ querySnippet: string; count: number; lockWaiting: number; severity: string }> = [];

  for (const [querySnippet, sessList] of queryGroups) {
    if (sessList.length >= 3) {
      const lockWaiting = sessList.filter(
        (s) => s.wait_event_type === "Lock" || s.wait_event_type === "LWLock"
      ).length;
      detected.push({
        querySnippet,
        count: sessList.length,
        lockWaiting,
        severity: lockWaiting > 0 || sessList.length >= 5 ? "critical" : "warning",
      });
    }
  }

  return detected;
}

describe("Micro-Query Lock Storm Detection", () => {
  it("should detect high-frequency fast write query consuming high % of database CPU", () => {
    const stat: QueryStat = {
      queryid: 1001,
      queryText: "UPDATE accounts SET balance = balance + $1 WHERE id = $2",
      calls: 15000,
      meanTimeMs: 4.2, // individually fast (4.2ms)
      pctOfTotalTime: 45.0, // 45% of total database compute time!
    };

    const result = detectMicroQueryStorm(stat, 3000, 300); // 12,000 calls in 300s = 40 calls/sec
    expect(result.isStorm).toBe(true);
    expect(result.isWriteOrLock).toBe(true);
    expect(result.severity).toBe("critical");
    expect(result.callsPerSec).toBe(40);
  });

  it("should not flag normal slow reporting queries as micro-query storm", () => {
    const stat: QueryStat = {
      queryid: 1002,
      queryText: "SELECT * FROM orders WHERE created_at > now() - interval '30 days'",
      calls: 2,
      meanTimeMs: 12000.0, // 12 seconds per call
      pctOfTotalTime: 35.0,
    };

    const result = detectMicroQueryStorm(stat, 0, 300);
    expect(result.isStorm).toBe(false); // Not a micro-query storm (meanTimeMs is high, calls is low)
  });

  it("should detect concurrent active sessions clashing on write/lock queries", () => {
    const sessions: SessionRow[] = [
      {
        pid: 101,
        usename: "app_user",
        application_name: "order_worker",
        client_addr: "10.0.1.5",
        state: "active",
        state_duration_seconds: 0.8,
        query_text: "UPDATE inventory SET stock = stock - 1 WHERE item_id = 42",
        wait_event_type: "Lock",
        wait_event: "transactionid",
      },
      {
        pid: 102,
        usename: "app_user",
        application_name: "order_worker",
        client_addr: "10.0.1.6",
        state: "active",
        state_duration_seconds: 0.5,
        query_text: "UPDATE inventory SET stock = stock - 1 WHERE item_id = 42",
        wait_event_type: "Lock",
        wait_event: "transactionid",
      },
      {
        pid: 103,
        usename: "app_user",
        application_name: "order_worker",
        client_addr: "10.0.1.7",
        state: "active",
        state_duration_seconds: 0.2,
        query_text: "UPDATE inventory SET stock = stock - 1 WHERE item_id = 42",
        wait_event_type: null,
        wait_event: null,
      },
    ];

    const detected = detectConcurrentLockSessions(sessions);
    expect(detected).toHaveLength(1);
    expect(detected[0].count).toBe(3);
    expect(detected[0].lockWaiting).toBe(2);
    expect(detected[0].severity).toBe("critical");
  });
});
