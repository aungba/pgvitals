"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getDatabase, getSchemaEvents } from "../../../lib/api";
import type { Database, SchemaEvent } from "../../../lib/api";

/* ===================================================================
   Schema Events Page — Phase 8
   Timeline of DDL changes detected via schema diffing
   =================================================================== */

const EVENT_TYPE_CONFIG: Record<string, { emoji: string; label: string; color: string }> = {
  create_table: { emoji: "🟢", label: "Table Created", color: "var(--signal-healthy)" },
  drop_table: { emoji: "🔴", label: "Table Dropped", color: "var(--signal-critical)" },
  create_index: { emoji: "🟢", label: "Index Created", color: "var(--signal-healthy)" },
  drop_index: { emoji: "🔴", label: "Index Dropped", color: "var(--signal-critical)" },
  add_column: { emoji: "🔵", label: "Column Added", color: "var(--brand)" },
  drop_column: { emoji: "🟠", label: "Column Dropped", color: "var(--signal-warning)" },
  alter_table: { emoji: "🟡", label: "Table Altered", color: "var(--signal-warning)" },
};

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function SchemaEventsPage() {
  const params = useParams();
  const id = params.id as string;

  const [database, setDatabase] = useState<Database | null>(null);
  const [events, setEvents] = useState<SchemaEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  const fetchData = useCallback(async () => {
    try {
      const [db, data] = await Promise.all([
        getDatabase(id),
        getSchemaEvents(id),
      ]);
      setDatabase(db);
      setEvents(data.events);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    const interval = setInterval(fetchData, 60_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const filteredEvents = filter === "all"
    ? events
    : events.filter((e) => e.eventType === filter);

  // Group events by date
  const groupedByDate = filteredEvents.reduce<Record<string, SchemaEvent[]>>((acc, evt) => {
    const dateKey = new Date(evt.detectedAt).toLocaleDateString("en-US", {
      weekday: "short", month: "short", day: "numeric",
    });
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(evt);
    return acc;
  }, {});

  const eventTypes = [...new Set(events.map((e) => e.eventType))];

  if (loading) {
    return (
      <div className="animate-fade-in">
        <div className="skeleton" style={{ width: 300, height: 32, marginBottom: 16 }} />
        <div className="skeleton" style={{ height: 400, borderRadius: "var(--radius-lg)" }} />
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="detail-header">
        <div className="detail-header-left">
          <Link
            href={`/databases/${id}`}
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 36, height: 36, borderRadius: "var(--radius-md)",
              background: "var(--surface-alt)", border: "1px solid var(--border)",
              color: "var(--text-secondary)", fontSize: "1rem",
              transition: "all var(--transition-fast)", flexShrink: 0,
            }}
            title="Back to database"
          >
            ←
          </Link>
          <div>
            <h1>Schema Changes — {database?.name}</h1>
            <p className="text-secondary" style={{ fontSize: "0.9rem" }}>
              DDL changes detected via periodic schema diffing
            </p>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        gap: "var(--space-md)", marginBottom: "var(--space-xl)",
      }}>
        <div className="glass-card-static" style={{ padding: "var(--space-lg)", textAlign: "center" }}>
          <div style={{ fontSize: "2rem", fontWeight: 700, color: "var(--brand)" }}>
            {events.length}
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>Total Changes</div>
        </div>
        <div className="glass-card-static" style={{ padding: "var(--space-lg)", textAlign: "center" }}>
          <div style={{ fontSize: "2rem", fontWeight: 700, color: "var(--signal-healthy)" }}>
            {events.filter((e) => e.eventType.startsWith("create")).length}
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>Created</div>
        </div>
        <div className="glass-card-static" style={{ padding: "var(--space-lg)", textAlign: "center" }}>
          <div style={{ fontSize: "2rem", fontWeight: 700, color: "var(--signal-critical)" }}>
            {events.filter((e) => e.eventType.startsWith("drop")).length}
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>Dropped</div>
        </div>
        <div className="glass-card-static" style={{ padding: "var(--space-lg)", textAlign: "center" }}>
          <div style={{ fontSize: "2rem", fontWeight: 700, color: "var(--brand)" }}>
            {events.filter((e) => e.eventType === "add_column").length}
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>Columns Added</div>
        </div>
      </div>

      {/* Filter */}
      <div style={{ display: "flex", gap: "var(--space-sm)", marginBottom: "var(--space-lg)", flexWrap: "wrap" }}>
        <button
          onClick={() => setFilter("all")}
          className={filter === "all" ? "btn-primary" : "btn-secondary"}
          style={{ padding: "6px 14px", fontSize: "0.8rem", borderRadius: "var(--radius-md)" }}
        >
          All ({events.length})
        </button>
        {eventTypes.map((type) => {
          const cfg = EVENT_TYPE_CONFIG[type] || { emoji: "•", label: type, color: "var(--text-secondary)" };
          const count = events.filter((e) => e.eventType === type).length;
          return (
            <button
              key={type}
              onClick={() => setFilter(type)}
              className={filter === type ? "btn-primary" : "btn-secondary"}
              style={{ padding: "6px 14px", fontSize: "0.8rem", borderRadius: "var(--radius-md)" }}
            >
              {cfg.emoji} {cfg.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Timeline */}
      {filteredEvents.length === 0 ? (
        <div className="glass-card-static" style={{
          padding: "var(--space-2xl)", textAlign: "center", color: "var(--text-muted)",
        }}>
          <div style={{ fontSize: "2.5rem", marginBottom: "var(--space-md)" }}>📐</div>
          <p style={{ fontSize: "1.1rem", fontWeight: 500 }}>No schema changes detected yet</p>
          <p style={{ fontSize: "0.85rem", marginTop: "var(--space-sm)" }}>
            Changes will appear here after the next schema diff cycle (runs daily)
          </p>
        </div>
      ) : (
        <div className="glass-card-static" style={{ padding: "var(--space-lg)" }}>
          {Object.entries(groupedByDate).map(([date, dayEvents]) => (
            <div key={date} style={{ marginBottom: "var(--space-xl)" }}>
              <div style={{
                fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)",
                textTransform: "uppercase", letterSpacing: "0.05em",
                marginBottom: "var(--space-md)", paddingBottom: "var(--space-xs)",
                borderBottom: "1px solid var(--border)",
              }}>
                {date}
              </div>
              {dayEvents.map((evt) => {
                const cfg = EVENT_TYPE_CONFIG[evt.eventType] || { emoji: "•", label: evt.eventType, color: "var(--text-secondary)" };
                return (
                  <div
                    key={evt.id}
                    style={{
                      display: "flex", alignItems: "flex-start", gap: "var(--space-md)",
                      padding: "var(--space-md) 0",
                      borderBottom: "1px solid var(--border-light, var(--border))",
                    }}
                  >
                    {/* Timeline dot */}
                    <div style={{
                      width: 10, height: 10, borderRadius: "50%", marginTop: 6,
                      background: cfg.color, flexShrink: 0,
                      boxShadow: `0 0 8px ${cfg.color}40`,
                    }} />
                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                        <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                          {cfg.emoji} {cfg.label}
                        </span>
                        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", flexShrink: 0 }}>
                          {formatRelativeTime(evt.detectedAt)}
                        </span>
                      </div>
                      <code style={{
                        display: "block", fontSize: "0.8rem", color: "var(--brand)",
                        fontFamily: "var(--font-mono)", marginTop: 2,
                        wordBreak: "break-all",
                      }}>
                        {evt.objectName}
                      </code>
                      {evt.details && (
                        <div style={{
                          marginTop: "var(--space-xs)", fontSize: "0.75rem",
                          color: "var(--text-muted)", display: "flex", gap: "var(--space-md)",
                        }}>
                          {Object.entries(evt.details).map(([k, v]) => (
                            <span key={k}>
                              <strong>{k}:</strong> {String(v)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
