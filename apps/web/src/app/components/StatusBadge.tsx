"use client";

import React from "react";

/* ===================================================================
   StatusBadge — Reusable colored badge for states & environments
   =================================================================== */

type Variant =
  | "active"
  | "idle"
  | "idle in transaction"
  | "idle in transaction (aborted)"
  | "production"
  | "staging"
  | "development"
  | "warning"
  | "critical"
  | "healthy"
  | "disabled"
  | "fastpath function call";

const variantStyles: Record<
  string,
  { bg: string; color: string; border: string }
> = {
  active: {
    bg: "var(--signal-healthy-dim)",
    color: "var(--signal-healthy)",
    border: "color-mix(in srgb, var(--signal-healthy) 25%, transparent)",
  },
  idle: {
    bg: "var(--signal-idle-dim)",
    color: "var(--signal-idle)",
    border: "color-mix(in srgb, var(--signal-idle) 25%, transparent)",
  },
  "idle in transaction": {
    bg: "var(--signal-warning-dim)",
    color: "var(--signal-warning)",
    border: "color-mix(in srgb, var(--signal-warning) 25%, transparent)",
  },
  "idle in transaction (aborted)": {
    bg: "var(--signal-critical-dim)",
    color: "var(--signal-critical)",
    border: "color-mix(in srgb, var(--signal-critical) 25%, transparent)",
  },
  production: {
    bg: "var(--signal-critical-dim)",
    color: "var(--signal-critical)",
    border: "color-mix(in srgb, var(--signal-critical) 25%, transparent)",
  },
  staging: {
    bg: "var(--signal-warning-dim)",
    color: "var(--signal-warning)",
    border: "color-mix(in srgb, var(--signal-warning) 25%, transparent)",
  },
  development: {
    bg: "var(--signal-healthy-dim)",
    color: "var(--signal-healthy)",
    border: "color-mix(in srgb, var(--signal-healthy) 25%, transparent)",
  },
  warning: {
    bg: "var(--signal-warning-dim)",
    color: "var(--signal-warning)",
    border: "color-mix(in srgb, var(--signal-warning) 25%, transparent)",
  },
  critical: {
    bg: "var(--signal-critical-dim)",
    color: "var(--signal-critical)",
    border: "color-mix(in srgb, var(--signal-critical) 25%, transparent)",
  },
  healthy: {
    bg: "var(--signal-healthy-dim)",
    color: "var(--signal-healthy)",
    border: "color-mix(in srgb, var(--signal-healthy) 25%, transparent)",
  },
  disabled: {
    bg: "var(--surface-alt)",
    color: "var(--text-muted)",
    border: "var(--border)",
  },
  "fastpath function call": {
    bg: "var(--brand-dim)",
    color: "var(--brand)",
    border: "color-mix(in srgb, var(--brand) 25%, transparent)",
  },
};

const defaultStyle = {
  bg: "var(--surface-alt)",
  color: "var(--text-secondary)",
  border: "var(--border)",
};

interface StatusBadgeProps {
  variant: Variant | string;
  label?: string;
  size?: "sm" | "md";
  dot?: boolean;
}

export default function StatusBadge({
  variant,
  label,
  size = "sm",
  dot = false,
}: StatusBadgeProps) {
  const key = variant.toLowerCase();
  const style = variantStyles[key] || defaultStyle;
  const displayLabel = label || variant;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: size === "sm" ? "2px 10px" : "4px 14px",
        fontSize: size === "sm" ? "0.75rem" : "0.8rem",
        fontWeight: 500,
        lineHeight: 1.5,
        borderRadius: "9999px",
        background: style.bg,
        color: style.color,
        border: `1px solid ${style.border}`,
        whiteSpace: "nowrap",
        textTransform: "capitalize",
        letterSpacing: "0.01em",
      }}
    >
      {dot && (
        <span
          style={{
            width: size === "sm" ? 6 : 7,
            height: size === "sm" ? 6 : 7,
            borderRadius: "50%",
            background: style.color,
            flexShrink: 0,
          }}
        />
      )}
      {displayLabel}
    </span>
  );
}
