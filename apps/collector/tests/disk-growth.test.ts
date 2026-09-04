import { describe, it, expect } from "vitest";

describe("disk-growth downsampling & sparkline logic", () => {
  it("formats and sorts daily downsampled history entries chronologically", () => {
    const rawDbRows = [
      {
        table_name: "orders",
        total_size_bytes: "52428800",
        captured_at: new Date("2026-09-02T23:59:00Z"),
      },
      {
        table_name: "orders",
        total_size_bytes: "53000000",
        captured_at: new Date("2026-09-03T23:59:00Z"),
      },
      {
        table_name: "users",
        total_size_bytes: "10485760",
        captured_at: new Date("2026-09-01T23:59:00Z"),
      },
      {
        table_name: "orders",
        total_size_bytes: "51000000",
        captured_at: new Date("2026-09-01T23:59:00Z"),
      },
    ];

    const history = rawDbRows.map((t) => ({
      tableName: t.table_name,
      totalSizeBytes: Number(t.total_size_bytes),
      capturedAt: new Date(t.captured_at).toISOString(),
    }));

    history.sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime());

    expect(history).toHaveLength(4);
    expect(history[0].tableName).toBe("users");
    expect(history[0].capturedAt).toBe(new Date("2026-09-01T23:59:00Z").toISOString());

    // Orders should be in ascending date order
    const ordersHistory = history.filter((h) => h.tableName === "orders");
    expect(ordersHistory.map((h) => h.totalSizeBytes)).toEqual([51000000, 52428800, 53000000]);
  });

  it("deduplicates sparkline points by calendar day and retains latest daily size", () => {
    const diskGrowthHistory = [
      { tableName: "events", totalSizeBytes: 1000, capturedAt: "2026-09-01T02:00:00Z" },
      { tableName: "events", totalSizeBytes: 1200, capturedAt: "2026-09-01T06:00:00Z" },
      { tableName: "events", totalSizeBytes: 1500, capturedAt: "2026-09-01T12:00:00Z" },
      { tableName: "events", totalSizeBytes: 2000, capturedAt: "2026-09-02T06:00:00Z" },
      { tableName: "events", totalSizeBytes: 2500, capturedAt: "2026-09-03T06:00:00Z" },
    ];

    const map = new Map<string, Array<{ time: string; size: number }>>();
    for (const entry of diskGrowthHistory) {
      if (!map.has(entry.tableName)) map.set(entry.tableName, []);
      const list = map.get(entry.tableName)!;
      const timeStr = new Date(entry.capturedAt).toLocaleDateString([], { month: "short", day: "numeric" });
      if (list.length === 0 || list[list.length - 1].time !== timeStr) {
        list.push({ time: timeStr, size: entry.totalSizeBytes });
      } else {
        list[list.length - 1].size = entry.totalSizeBytes;
      }
    }

    const eventsList = map.get("events")!;
    expect(eventsList).toHaveLength(3);
    // Sep 1 should have taken the latest size for that day (1500)
    expect(eventsList[0].size).toBe(1500);
    expect(eventsList[1].size).toBe(2000);
    expect(eventsList[2].size).toBe(2500);
  });
});
