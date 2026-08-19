"use client";

import React from "react";
import Link from "next/link";

/* ===================================================================
   StatsCard — Compact stat display with label, value, optional trend
   =================================================================== */

interface StatsCardProps {
  label: string;
  value: number | string;
  icon: string;
  color?: string;
  subtitle?: string;
  href?: string;
}

export default function StatsCard({
  label,
  value,
  icon,
  color = "var(--brand)",
  subtitle,
  href,
}: StatsCardProps) {
  const card = (
    <div
      className="glass-card"
      style={{
        padding: "var(--space-md) var(--space-lg)",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-md)",
        transition: "all var(--transition-base)",
        cursor: href ? "pointer" : "default",
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: "var(--radius-md)",
          background: `color-mix(in srgb, ${color} 12%, transparent)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "1.25rem",
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: "0.75rem",
            fontWeight: 500,
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            marginBottom: 2,
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontSize: "1.5rem",
            fontWeight: 700,
            color: color,
            lineHeight: 1.2,
            fontFamily: "var(--font-mono)",
          }}
        >
          {value}
        </div>
        {subtitle && (
          <div
            style={{
              fontSize: "0.75rem",
              color: "var(--text-muted)",
              marginTop: 2,
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} style={{ textDecoration: "none", color: "inherit", display: "block" }}>
        {card}
      </Link>
    );
  }

  return card;
}
