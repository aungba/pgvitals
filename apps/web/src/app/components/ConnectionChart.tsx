"use client";

import React, { useState, useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from "recharts";
import type { Snapshot } from "../lib/api";
import { useChartColors } from "../lib/useChartColors";

/* ===================================================================
   ConnectionChart — Stacked area chart with Timeframe Controls
   =================================================================== */

export type Timeframe = "15m" | "1h" | "6h" | "24h" | "7d" | "all";

interface SchemaEventMarker {
  eventType: string;
  objectName: string;
  detectedAt: string;
}

export interface ConnectionChartProps {
  snapshots: Snapshot[];
  schemaEvents?: SchemaEventMarker[];
  selectedTimestamp?: string | null;
  onSelectTimestamp?: (timestamp: string | null) => void;
  timeframe?: Timeframe;
  onTimeframeChange?: (tf: Timeframe) => void;
}

interface ChartDataPoint {
  time: string;
  timestamp: number;
  rawTimestamp: string;
  active: number;
  idle: number;
  idleInTxn: number;
  idleInTxnAborted: number;
  total: number;
}

function formatTime(ts: string | number, tf?: Timeframe): string {
  const d = new Date(ts);
  if (tf === "7d" || tf === "all") {
    return (
      d.toLocaleDateString([], { month: "short", day: "numeric" }) +
      " " +
      d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
    );
  }
  if (tf === "24h") {
    return (
      d.toLocaleDateString([], { month: "numeric", day: "numeric" }) +
      " " +
      d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
    );
  }
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function ConnectionChart({
  snapshots,
  schemaEvents,
  selectedTimestamp,
  onSelectTimestamp,
  timeframe: propTimeframe,
  onTimeframeChange,
}: ConnectionChartProps) {
  const colors = useChartColors();
  const [internalTimeframe, setInternalTimeframe] = useState<Timeframe>("1h");
  const activeTimeframe = propTimeframe ?? internalTimeframe;

  const handleTimeframeSelect = (tf: Timeframe) => {
    if (onTimeframeChange) {
      onTimeframeChange(tf);
    } else {
      setInternalTimeframe(tf);
    }
  };

  const filteredSnapshots = useMemo(() => {
    if (!snapshots.length) return [];
    if (activeTimeframe === "all") return snapshots;

    const now = Date.now();
    let cutoffMs = 15 * 60 * 1000; // 15m
    if (activeTimeframe === "1h") cutoffMs = 60 * 60 * 1000;
    if (activeTimeframe === "6h") cutoffMs = 6 * 60 * 60 * 1000;
    if (activeTimeframe === "24h") cutoffMs = 24 * 60 * 60 * 1000;
    if (activeTimeframe === "7d") cutoffMs = 7 * 24 * 60 * 60 * 1000;

    const cutoff = now - cutoffMs;
    const filtered = snapshots.filter((s) => new Date(s.timestamp).getTime() >= cutoff);
    return filtered.length >= 2 ? filtered : snapshots;
  }, [snapshots, activeTimeframe]);

  const historySpanInfo = useMemo(() => {
    if (!filteredSnapshots.length || filteredSnapshots.length < 2) return null;
    const sorted = [...filteredSnapshots].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    const spanMs =
      new Date(sorted[sorted.length - 1].timestamp).getTime() -
      new Date(sorted[0].timestamp).getTime();
    const spanMins = Math.round(spanMs / (60 * 1000));

    const expectedMinsMap: Record<Timeframe, number> = {
      "15m": 12,
      "1h": 45,
      "6h": 5 * 60,
      "24h": 20 * 60,
      "7d": 6 * 24 * 60,
      all: 0,
    };

    if (activeTimeframe !== "all" && spanMins < expectedMinsMap[activeTimeframe]) {
      if (spanMins < 60) {
        return `Showing ~${Math.max(1, spanMins)}m of available history`;
      }
      const spanHours = (spanMins / 60).toFixed(1);
      return `Showing ~${spanHours}h of available history`;
    }
    return null;
  }, [filteredSnapshots, activeTimeframe]);

  if (!snapshots.length) {
    return (
      <div
        className="glass-card-static"
        style={{
          padding: "var(--space-2xl)",
          textAlign: "center",
          color: "var(--text-muted)",
        }}
      >
        <div style={{ fontSize: "2rem", marginBottom: 8, opacity: 0.5 }}>📊</div>
        <div>No snapshot data yet. Waiting for data collection…</div>
      </div>
    );
  }

  const data: ChartDataPoint[] = filteredSnapshots
    .slice()
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .map((s) => ({
      time: formatTime(s.timestamp, activeTimeframe),
      timestamp: new Date(s.timestamp).getTime(),
      rawTimestamp: s.timestamp,
      active: s.activeCount,
      idle: s.idleCount,
      idleInTxn: s.idleInTxnCount,
      idleInTxnAborted: s.idleInTxnAbortedCount,
      total: s.connectionCount,
    }));

  function CustomTooltip({
    active,
    payload,
    label,
  }: {
    active?: boolean;
    payload?: Array<{ name: string; value: number; color: string; payload?: ChartDataPoint }>;
    label?: string;
  }) {
    if (!active || !payload) return null;

    return (
      <div
        style={{
          background: "var(--tooltip-bg)",
          border: "1px solid var(--tooltip-border)",
          borderRadius: 10,
          padding: "12px 16px",
          backdropFilter: "blur(12px)",
          boxShadow: "var(--shadow-lg)",
        }}
      >
        <div
          style={{
            fontSize: "0.75rem",
            color: colors.textMuted,
            marginBottom: 8,
            fontFamily: "var(--font-mono)",
          }}
        >
          {payload[0]?.payload?.rawTimestamp
            ? new Date(payload[0].payload.rawTimestamp).toLocaleString([], {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false,
              })
            : label}
        </div>
        {payload.map((entry, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 4,
              fontSize: "0.8rem",
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: entry.color,
                flexShrink: 0,
              }}
            />
            <span style={{ color: colors.textSecondary, minWidth: 120 }}>{entry.name}</span>
            <span
              style={{
                color: colors.textPrimary,
                fontWeight: 600,
                fontFamily: "var(--font-mono)",
              }}
            >
              {entry.value}
            </span>
          </div>
        ))}
      </div>
    );
  }

  // Selected timestamp label for ReferenceLine
  const selectedTimeLabel = useMemo(() => {
    if (!selectedTimestamp) return null;
    const match = data.find((d) => d.rawTimestamp === selectedTimestamp);
    return match ? match.time : formatTime(selectedTimestamp, activeTimeframe);
  }, [selectedTimestamp, data, activeTimeframe]);

  return (
    <div className="glass-card-static" style={{ padding: "var(--space-lg)", overflow: "hidden" }}>
      {/* Header with Timeframe Selector and Inspection Hint */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-md)", flexWrap: "wrap", gap: "var(--space-sm)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)", fontWeight: 500 }}>
            Active vs. Idle connection distribution
          </span>
          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", background: "var(--surface-alt)", padding: "2px 8px", borderRadius: "var(--radius-full)" }}>
            👆 Click chart to time-travel
          </span>
          {historySpanInfo && (
            <span
              style={{
                fontSize: "0.75rem",
                color: "var(--brand, #3b82f6)",
                background: "rgba(59, 130, 246, 0.1)",
                border: "1px solid rgba(59, 130, 246, 0.2)",
                padding: "2px 8px",
                borderRadius: "var(--radius-full)",
              }}
            >
              ℹ️ {historySpanInfo}
            </span>
          )}
        </div>
        <div className="timeframe-toggle">
          {(["15m", "1h", "6h", "24h", "7d", "all"] as Timeframe[]).map((tf) => (
            <button
              key={tf}
              className="timeframe-btn"
              data-active={activeTimeframe === tf}
              onClick={() => handleTimeframeSelect(tf)}
            >
              {tf.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div style={{ width: "100%", height: 300, cursor: "crosshair" }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
            onClick={(e) => {
              if (e && e.activePayload && e.activePayload[0]) {
                const pt = e.activePayload[0].payload as ChartDataPoint;
                if (pt?.rawTimestamp) {
                  onSelectTimestamp?.(pt.rawTimestamp);
                }
              }
            }}
          >
            <defs>
              <linearGradient id="activeGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colors.healthy} stopOpacity={0.4} />
                <stop offset="100%" stopColor={colors.healthy} stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="idleGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colors.idle} stopOpacity={0.3} />
                <stop offset="100%" stopColor={colors.idle} stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="idleTxnGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colors.warning} stopOpacity={0.3} />
                <stop offset="100%" stopColor={colors.warning} stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="idleTxnAbortGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colors.critical} stopOpacity={0.3} />
                <stop offset="100%" stopColor={colors.critical} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={colors.border} strokeOpacity={0.5} vertical={false} />
            <XAxis
              dataKey="time"
              stroke={colors.border}
              tick={{ fill: colors.textMuted, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={40}
            />
            <YAxis
              stroke={colors.border}
              tick={{ fill: colors.textMuted, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: "var(--brand)", strokeWidth: 1.5, strokeDasharray: "2 2" }} />
            <Legend
              iconType="circle"
              wrapperStyle={{
                fontSize: "0.75rem",
                color: colors.textSecondary,
                paddingTop: 8,
              }}
            />
            <Area
              type="monotone"
              dataKey="active"
              name="Active"
              stackId="1"
              stroke={colors.healthy}
              fill="url(#activeGrad)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0, fill: colors.healthy }}
            />
            <Area
              type="monotone"
              dataKey="idle"
              name="Idle"
              stackId="1"
              stroke={colors.idle}
              fill="url(#idleGrad)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0, fill: colors.idle }}
            />
            <Area
              type="monotone"
              dataKey="idleInTxn"
              name="Idle in Txn"
              stackId="1"
              stroke={colors.warning}
              fill="url(#idleTxnGrad)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0, fill: colors.warning }}
            />
            <Area
              type="monotone"
              dataKey="idleInTxnAborted"
              name="Idle in Txn (Aborted)"
              stackId="1"
              stroke={colors.critical}
              fill="url(#idleTxnAbortGrad)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0, fill: colors.critical }}
            />

            {/* Selected Historical Replay Cursor */}
            {selectedTimeLabel && (
              <ReferenceLine
                x={selectedTimeLabel}
                stroke="var(--brand)"
                strokeWidth={2}
                strokeDasharray="3 3"
                label={{
                  value: "📍 Time-Travel Snapshot",
                  position: "top",
                  fill: "var(--brand)",
                  fontSize: 11,
                  fontWeight: 700,
                }}
              />
            )}

            {/* Schema change markers */}
            {schemaEvents &&
              schemaEvents.length > 0 &&
              filteredSnapshots.length > 0 &&
              (() => {
                const startTs = new Date(filteredSnapshots[0].timestamp).getTime();
                const endTs = new Date(filteredSnapshots[filteredSnapshots.length - 1].timestamp).getTime();
                return schemaEvents
                  .filter((ev) => {
                    const ts = new Date(ev.detectedAt).getTime();
                    return ts >= startTs && ts <= endTs;
                  })
                  .map((ev, i) => {
                    const ts = new Date(ev.detectedAt);
                    const timeLabel = ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
                    const eventLabel = ev.eventType.replace(/_/g, " ");
                    return (
                      <ReferenceLine
                        key={`schema-${i}`}
                        x={timeLabel}
                        stroke="#A78BFA"
                        strokeDasharray="4 4"
                        strokeWidth={2}
                        label={{
                          value: `📐 ${eventLabel}`,
                          position: "top",
                          fill: "#A78BFA",
                          fontSize: 10,
                          fontWeight: 600,
                        }}
                      />
                    );
                  });
              })()}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
