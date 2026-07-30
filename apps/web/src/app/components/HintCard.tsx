"use client";

import React from "react";
import type { Hint } from "../lib/api";

/* ===================================================================
   HintCard — Glassmorphic card for root-cause hints
   =================================================================== */

interface HintCardProps {
  hint: Hint;
  index: number;
}

function formatRuleType(ruleType: string): string {
  return ruleType
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / 1000,
  );
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function HintCard({ hint, index }: HintCardProps) {
  const isCritical = hint.severity === "critical";

  const borderColor = isCritical
    ? "var(--signal-critical)"
    : "var(--signal-warning)";
  const bgColor = isCritical
    ? "var(--signal-critical-dim)"
    : "var(--signal-warning-dim)";
  const iconColor = isCritical
    ? "var(--signal-critical)"
    : "var(--signal-warning)";
  const icon = isCritical ? "🔴" : "🟡";

  return (
    <div
      style={{
        background: bgColor,
        border: "1px solid var(--border)",
        borderLeft: `3px solid ${borderColor}`,
        borderRadius: "var(--radius-md)",
        padding: "var(--space-md) var(--space-lg)",
        backdropFilter: "blur(8px)",
        animation: `slideInRight 400ms ease-out ${index * 80}ms both`,
        transition: "all var(--transition-base)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "var(--space-md)",
        }}
      >
        <div style={{ fontSize: "1.1rem", marginTop: 2, flexShrink: 0 }}>
          {icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-sm)",
              marginBottom: 4,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontSize: "0.65rem",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: iconColor,
                background: isCritical
                  ? "var(--signal-critical-dim)"
                  : "var(--signal-warning-dim)",
                padding: "1px 8px",
                borderRadius: "9999px",
              }}
            >
              {hint.severity}
            </span>
            <span
              style={{
                fontSize: "0.7rem",
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono)",
              }}
            >
              {formatRuleType(hint.ruleType)}
            </span>
          </div>
          <div
            style={{
              fontSize: "0.9rem",
              fontWeight: 600,
              color: "var(--text-primary)",
              marginBottom: 4,
            }}
          >
            {hint.title}
          </div>
          <div
            style={{
              fontSize: "0.8rem",
              color: "var(--text-secondary)",
              lineHeight: 1.5,
              marginBottom: 6,
            }}
          >
            {hint.description}
          </div>
          <div
            style={{
              fontSize: "0.7rem",
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {timeAgo(hint.detectedAt)}
          </div>
        </div>
      </div>
    </div>
  );
}
