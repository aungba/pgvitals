import { describe, it, expect, beforeEach } from "vitest";
import { sessionBroadcaster } from "../src/lib/session-broadcaster.js";

describe("SessionBroadcaster", () => {
  const dbId = "00000000-0000-0000-0000-000000000001";

  beforeEach(() => {
    sessionBroadcaster.clear();
  });

  it("publishes session payload to active subscribers", () => {
    let received: unknown = null;

    const unsubscribe = sessionBroadcaster.subscribe(dbId, (payload) => {
      received = payload;
    });

    const mockPayload = {
      snapshotId: "snap-123",
      timestamp: new Date().toISOString(),
      sessions: [
        {
          pid: 101,
          usename: "postgres",
          state: "active",
          stateDurationSeconds: 5,
          queryText: "SELECT 1",
          queryStart: new Date().toISOString(),
          waitEventType: null,
          waitEvent: null,
          blockingPid: null,
        },
      ],
    };

    sessionBroadcaster.publish(dbId, mockPayload);

    expect(received).toEqual(mockPayload);
    unsubscribe();
  });

  it("caches the latest payload for immediate client hydration", () => {
    const mockPayload = {
      snapshotId: "snap-456",
      timestamp: new Date().toISOString(),
      sessions: [],
    };

    sessionBroadcaster.publish(dbId, mockPayload);

    const latest = sessionBroadcaster.getLatest(dbId);
    expect(latest).toEqual(mockPayload);
  });

  it("stops sending updates after unsubscribe", () => {
    let callCount = 0;

    const unsubscribe = sessionBroadcaster.subscribe(dbId, () => {
      callCount++;
    });

    sessionBroadcaster.publish(dbId, {
      snapshotId: "snap-1",
      timestamp: new Date().toISOString(),
      sessions: [],
    });
    expect(callCount).toBe(1);

    unsubscribe();

    sessionBroadcaster.publish(dbId, {
      snapshotId: "snap-2",
      timestamp: new Date().toISOString(),
      sessions: [],
    });
    expect(callCount).toBe(1);
  });
});
