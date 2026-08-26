"use client";

import React, { useEffect, useRef, useState } from "react";

/* ===================================================================
   ConnectionGauge — Animated circular SVG gauge with state breakdown
   =================================================================== */

export interface ConnectionBreakdown {
  active: number;
  idle: number;
  idleInTxn: number;
  idleInTxnAborted?: number;
  waiting?: number;
}

export interface ConnectionGaugeProps {
  current: number;
  max: number;
  size?: number;
  strokeWidth?: number;
  showLabel?: boolean;
  breakdown?: ConnectionBreakdown;
  showBreakdown?: boolean;
}

function getColor(pct: number): string {
  if (pct < 0.6) return "var(--signal-healthy)";
  if (pct < 0.8) return "var(--signal-warning)";
  return "var(--signal-critical)";
}

function getGlow(pct: number): string {
  if (pct < 0.6) return "var(--signal-healthy-dim)";
  if (pct < 0.8) return "var(--signal-warning-dim)";
  return "var(--signal-critical-dim)";
}

export default function ConnectionGauge({
  current,
  max,
  size = 160,
  strokeWidth = 10,
  showLabel = true,
  breakdown,
  showBreakdown = false,
}: ConnectionGaugeProps) {
  const [animatedPct, setAnimatedPct] = useState(0);
  const prevPct = useRef(0);
  const animRef = useRef<number>(0);

  const pct = max > 0 ? Math.min(current / max, 1) : 0;

  useEffect(() => {
    const start = prevPct.current;
    const end = pct;
    const duration = 600;
    const startTime = performance.now();

    function animate(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setAnimatedPct(start + (end - start) * eased);

      if (progress < 1) {
        animRef.current = requestAnimationFrame(animate);
      }
    }

    animRef.current = requestAnimationFrame(animate);
    prevPct.current = end;

    return () => cancelAnimationFrame(animRef.current);
  }, [pct]);

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const arc = circumference * 0.75; // 270-degree arc
  const offset = arc - arc * animatedPct;
  const color = getColor(pct);
  const glow = getGlow(pct);
  const percentage = Math.round(pct * 100);

  // Breakdown calculations
  const active = breakdown?.active ?? 0;
  const idle = breakdown?.idle ?? 0;
  const idleInTxn = breakdown?.idleInTxn ?? 0;
  const idleInTxnAborted = breakdown?.idleInTxnAborted ?? 0;
  const available = Math.max(0, max - current);

  const totalOpen = current > 0 ? current : 1;
  const activePct = current > 0 ? (active / totalOpen) * 100 : 0;
  const idleInTxnPct = current > 0 ? (idleInTxn / totalOpen) * 100 : 0;
  const idlePct = current > 0 ? (idle / totalOpen) * 100 : 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        width: "100%",
      }}
    >
      {/* Radial Gauge */}
      <div
        style={{
          position: "relative",
          width: size,
          height: size,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          style={{ transform: "rotate(135deg)" }}
        >
          {/* Background arc */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--border)"
            strokeWidth={strokeWidth}
            strokeDasharray={`${arc} ${circumference}`}
            strokeLinecap="round"
          />
          {/* Glow arc (blur effect) */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={glow}
            strokeWidth={strokeWidth + 4}
            strokeDasharray={`${arc} ${circumference}`}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ filter: "blur(6px)" }}
          />
          {/* Value arc */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeDasharray={`${arc} ${circumference}`}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{
              transition: "stroke 0.3s ease",
            }}
          />
        </svg>
        {showLabel && (
          <div
            style={{
              position: "absolute",
              textAlign: "center",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -45%)",
            }}
          >
            <div
              style={{
                fontSize: size > 140 ? "1.85rem" : "1.3rem",
                fontWeight: 700,
                color: color,
                fontFamily: "var(--font-mono)",
                lineHeight: 1.1,
              }}
            >
              {percentage === 0 && current > 0 ? "<1%" : `${percentage}%`}
            </div>
            <div
              style={{
                fontSize: size > 140 ? "0.78rem" : "0.7rem",
                color: "var(--text-muted)",
                marginTop: 4,
                fontFamily: "var(--font-mono)",
              }}
            >
              {current.toLocaleString()} / {max.toLocaleString()}
            </div>
          </div>
        )}
      </div>

      {/* Breakdown Section (Stacked Distribution Bar & Legend) */}
      {showBreakdown && breakdown && (
        <div
          style={{
            width: "100%",
            marginTop: "var(--space-md)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-sm)",
          }}
        >
          {/* Composition Header & Stacked Progress Bar */}
          <div style={{ width: "100%" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: "0.72rem",
                color: "var(--text-muted)",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                marginBottom: 6,
              }}
            >
              <span>Pool Composition</span>
              <span style={{ fontFamily: "var(--font-mono)" }}>{current} open</span>
            </div>

            {/* Horizontal Distribution Bar */}
            <div
              style={{
                width: "100%",
                height: 8,
                borderRadius: 4,
                background: "var(--surface-alt)",
                border: "1px solid var(--border)",
                display: "flex",
                overflow: "hidden",
              }}
            >
              {current === 0 ? (
                <div style={{ width: "100%", height: "100%", background: "var(--border)" }} />
              ) : (
                <>
                  {active > 0 && (
                    <div
                      title={`Active: ${active} (${activePct.toFixed(1)}%)`}
                      style={{
                        width: `${activePct}%`,
                        height: "100%",
                        background: "var(--signal-healthy)",
                        transition: "width 0.4s ease",
                      }}
                    />
                  )}
                  {idleInTxn > 0 && (
                    <div
                      title={`Idle in Txn: ${idleInTxn} (${idleInTxnPct.toFixed(1)}%)`}
                      style={{
                        width: `${idleInTxnPct}%`,
                        height: "100%",
                        background: idleInTxnAborted > 0 ? "var(--signal-critical)" : "var(--signal-warning)",
                        transition: "width 0.4s ease",
                      }}
                    />
                  )}
                  {idle > 0 && (
                    <div
                      title={`Idle: ${idle} (${idlePct.toFixed(1)}%)`}
                      style={{
                        width: `${idlePct}%`,
                        height: "100%",
                        background: "var(--signal-idle)",
                        transition: "width 0.4s ease",
                      }}
                    />
                  )}
                </>
              )}
            </div>
          </div>

          {/* Detailed State List */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              marginTop: 4,
              fontSize: "0.8rem",
            }}
          >
            {/* Active */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "4px 8px",
                borderRadius: "var(--radius-sm)",
                background: active > 0 ? "var(--signal-healthy-dim)" : "transparent",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "var(--signal-healthy)",
                    display: "inline-block",
                  }}
                />
                <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>Active</span>
              </div>
              <div style={{ fontFamily: "var(--font-mono)", display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{active}</span>
                <span style={{ color: "var(--text-muted)", fontSize: "0.72rem" }}>
                  ({activePct.toFixed(0)}%)
                </span>
              </div>
            </div>

            {/* Idle in Transaction */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "4px 8px",
                borderRadius: "var(--radius-sm)",
                background: idleInTxn > 0 ? "var(--signal-warning-dim)" : "transparent",
                border: idleInTxn > 0 ? "1px solid rgba(245, 158, 11, 0.25)" : "1px solid transparent",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: idleInTxnAborted > 0 ? "var(--signal-critical)" : "var(--signal-warning)",
                    display: "inline-block",
                  }}
                />
                <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>Idle in Txn</span>
              </div>
              <div style={{ fontFamily: "var(--font-mono)", display: "flex", gap: 6, alignItems: "center" }}>
                <span
                  style={{
                    fontWeight: 600,
                    color: idleInTxn > 0 ? "var(--signal-warning)" : "var(--text-primary)",
                  }}
                >
                  {idleInTxn}
                </span>
                <span style={{ color: "var(--text-muted)", fontSize: "0.72rem" }}>
                  ({idleInTxnPct.toFixed(0)}%)
                </span>
              </div>
            </div>

            {/* Idle */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "4px 8px",
                borderRadius: "var(--radius-sm)",
                background: "transparent",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "var(--signal-idle)",
                    display: "inline-block",
                  }}
                />
                <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>Idle</span>
              </div>
              <div style={{ fontFamily: "var(--font-mono)", display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{idle}</span>
                <span style={{ color: "var(--text-muted)", fontSize: "0.72rem" }}>
                  ({idlePct.toFixed(0)}%)
                </span>
              </div>
            </div>

            {/* Available Headroom */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "4px 8px",
                borderTop: "1px dashed var(--border)",
                marginTop: 2,
                paddingTop: 6,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    border: "1.5px solid var(--text-muted)",
                    display: "inline-block",
                  }}
                />
                <span style={{ color: "var(--text-secondary)", fontSize: "0.76rem" }}>Available</span>
              </div>
              <div style={{ fontFamily: "var(--font-mono)", display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ fontWeight: 500, color: "var(--text-muted)", fontSize: "0.76rem" }}>
                  {available.toLocaleString()} slots
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
