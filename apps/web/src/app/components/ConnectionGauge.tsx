"use client";

import React, { useEffect, useRef, useState } from "react";

/* ===================================================================
   ConnectionGauge — Animated circular SVG gauge
   =================================================================== */

interface ConnectionGaugeProps {
  current: number;
  max: number;
  size?: number;
  strokeWidth?: number;
  showLabel?: boolean;
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

  return (
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
              fontSize: size > 140 ? "2rem" : "1.4rem",
              fontWeight: 700,
              color: color,
              fontFamily: "var(--font-mono)",
              lineHeight: 1.1,
            }}
          >
            {percentage}%
          </div>
          <div
            style={{
              fontSize: size > 140 ? "0.8rem" : "0.7rem",
              color: "var(--text-muted)",
              marginTop: 4,
              fontFamily: "var(--font-mono)",
            }}
          >
            {current} / {max}
          </div>
        </div>
      )}
    </div>
  );
}
