import { EventEmitter } from "node:events";

export interface LiveSessionPayload {
  snapshotId: string;
  timestamp: Date | string;
  sessions: Array<{
    pid: number;
    usename: string | null;
    applicationName?: string | null;
    clientAddr?: string | null;
    state: string | null;
    stateDurationSeconds: number | null;
    queryText: string | null;
    queryStart: Date | string | null;
    waitEventType: string | null;
    waitEvent: string | null;
    blockingPid: number | null;
  }>;
}

class SessionBroadcaster {
  private emitter = new EventEmitter();
  private cache = new Map<string, { payload: LiveSessionPayload; cachedAt: number }>();
  private readonly ttlMs = 60_000; // 60s cache TTL

  constructor() {
    // Increase max listeners for high concurrent SSE clients
    this.emitter.setMaxListeners(500);
  }

  /**
   * Publishes new session data for a monitored database to all active SSE subscribers.
   */
  public publish(monitoredDbId: string, payload: LiveSessionPayload): void {
    this.cache.set(monitoredDbId, {
      payload,
      cachedAt: Date.now(),
    });
    this.emitter.emit(`sessions:${monitoredDbId}`, payload);
  }

  /**
   * Subscribes to live session updates for a monitored database.
   * Returns an unsubscribe callback.
   */
  public subscribe(
    monitoredDbId: string,
    listener: (data: LiveSessionPayload) => void
  ): () => void {
    const eventName = `sessions:${monitoredDbId}`;
    this.emitter.on(eventName, listener);
    return () => {
      this.emitter.off(eventName, listener);
    };
  }

  /**
   * Retrieves the most recently cached session snapshot if not expired.
   */
  public getLatest(monitoredDbId: string): LiveSessionPayload | null {
    const entry = this.cache.get(monitoredDbId);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > this.ttlMs) {
      this.cache.delete(monitoredDbId);
      return null;
    }
    return entry.payload;
  }

  /**
   * Clears cached payloads.
   */
  public clear(monitoredDbId?: string): void {
    if (monitoredDbId) {
      this.cache.delete(monitoredDbId);
    } else {
      this.cache.clear();
    }
  }
}

export const sessionBroadcaster = new SessionBroadcaster();
