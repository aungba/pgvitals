"use client";

import React from "react";
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
   ConnectionChart — Stacked area chart for connection states over time
   =================================================================== */

interface SchemaEventMarker {
  eventType: string;
  objectName: string;
  detectedAt: string;
}

interface ConnectionChartProps {
  snapshots: Snapshot[];
  schemaEvents?: SchemaEventMarker[];
}

interface ChartDataPoint {
  time: string;
  timestamp: number;
  active: number;
  idle: number;
  idleInTxn: number;
  idleInTxnAborted: number;
  total: number;
}

function formatTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function ConnectionChart({ snapshots, schemaEvents }: ConnectionChartProps) {
  const colors = useChartColors();

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
        <div style={{ fontSize: "2rem", marginBottom: 8, opacity: 0.5 }}>
          📊
        </div>
        <div>No snapshot data yet. Waiting for data collection…</div>
      </div>
    );
  }

  const data: ChartDataPoint[] = snapshots
    .slice()
    .sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    )
    .map((s) => ({
      time: formatTime(s.timestamp),
      timestamp: new Date(s.timestamp).getTime(),
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
    payload?: Array<{ name: string; value: number; color: string }>;
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
          {label}
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
            <span style={{ color: colors.textSecondary, minWidth: 120 }}>
              {entry.name}
            </span>
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

  return (
    <div
      className="glass-card-static"
      style={{ padding: "var(--space-lg)", overflow: "hidden" }}
    >
      <div style={{ width: "100%", height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
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
              <linearGradient
                id="idleTxnAbortGrad"
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={colors.critical} stopOpacity={0.3} />
                <stop offset="100%" stopColor={colors.critical} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={colors.border}
              strokeOpacity={0.5}
              vertical={false}
            />
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
            <Tooltip
              content={<CustomTooltip />}
              cursor={{
                stroke: colors.border,
                strokeWidth: 1,
              }}
            />
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
            {/* Schema change markers */}
            {schemaEvents && schemaEvents.length > 0 && snapshots.length > 0 && (() => {
              // Build a time range from snapshots to filter relevant markers
              const startTs = new Date(snapshots[0].timestamp).getTime();
              const endTs = new Date(snapshots[snapshots.length - 1].timestamp).getTime();
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
