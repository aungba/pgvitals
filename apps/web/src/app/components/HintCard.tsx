"use client";

import React, { useState } from "react";
import Link from "next/link";
import type { Hint } from "../lib/api";

/* ===================================================================
   HintCard — Action-Oriented card for root-cause hints (Option 1)
   =================================================================== */

interface HintCardProps {
  hint: Hint;
  index: number;
  databaseId?: string;
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

/** Extracts an SQL query string from metadata or description if present */
function extractSqlQuery(hint: Hint): string | null {
  const meta = hint.metadata || {};
  if (typeof meta.query_snippet === "string" && meta.query_snippet.trim()) {
    return meta.query_snippet.trim();
  }
  if (typeof meta.query_text === "string" && meta.query_text.trim()) {
    return meta.query_text.trim();
  }
  if (typeof meta.blocked_query === "string" && meta.blocked_query.trim()) {
    return meta.blocked_query.trim();
  }
  if (typeof meta.root_query === "string" && meta.root_query.trim()) {
    return meta.root_query.trim();
  }

  // Regex fallback to extract quoted SQL from description
  const match = hint.description.match(/"((?:INSERT|UPDATE|SELECT|DELETE|ALTER|DROP|TRUNCATE|CREATE|LOCK)[\s\S]*?)"/i);
  if (match && match[1]) {
    return match[1].replace(/…$/, "");
  }

  return null;
}

/** Extracts an actionable SQL fix/remediation command */
function extractSqlFix(hint: Hint): string | null {
  const meta = hint.metadata || {};
  if (typeof meta.suggested_remediation === "string" && meta.suggested_remediation.trim()) {
    return meta.suggested_remediation.trim();
  }

  // Check for pg_terminate_backend in description or metadata
  const termMatch = hint.description.match(/(SELECT\s+pg_terminate_backend\(\d+\);?)/i);
  if (termMatch && termMatch[1]) {
    return termMatch[1];
  }

  if (typeof meta.blocking_pid === "number" || typeof meta.root_pid === "number") {
    const pid = meta.blocking_pid ?? meta.root_pid;
    return `SELECT pg_terminate_backend(${pid});`;
  }

  return null;
}

export default function HintCard({ hint, index, databaseId }: HintCardProps) {
  const isCritical = hint.severity === "critical";
  const [copiedFix, setCopiedFix] = useState(false);
  const [copiedQuery, setCopiedQuery] = useState(false);

  const query = extractSqlQuery(hint);
  const sqlFix = extractSqlFix(hint);

  const borderColor = isCritical
    ? "var(--signal-critical)"
    : "var(--signal-warning)";
  const badgeBg = isCritical
    ? "var(--signal-critical-dim)"
    : "var(--signal-warning-dim)";
  const badgeColor = isCritical
    ? "var(--signal-critical)"
    : "var(--signal-warning)";

  const handleCopyFix = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!sqlFix) return;
    navigator.clipboard.writeText(sqlFix);
    setCopiedFix(true);
    setTimeout(() => setCopiedFix(false), 2000);
  };

  const handleCopyQuery = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!query) return;
    navigator.clipboard.writeText(query);
    setCopiedQuery(true);
    setTimeout(() => setCopiedQuery(false), 2000);
  };

  const inspectHref = databaseId
    ? `/databases/${databaseId}/hints?rule=${hint.ruleType}`
    : "#";

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderLeft: `4px solid ${borderColor}`,
        borderRadius: "var(--radius-md)",
        padding: "var(--space-md) var(--space-lg)",
        backdropFilter: "blur(8px)",
        boxShadow: "var(--shadow-sm)",
        animation: `slideInRight 400ms ease-out ${index * 80}ms both`,
        transition: "all var(--transition-base)",
        position: "relative",
      }}
    >
      {/* Top Header Row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "var(--space-xs)",
          gap: "var(--space-sm)",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              backgroundColor: borderColor,
              boxShadow: isCritical ? "0 0 6px rgba(239, 68, 68, 0.4)" : "none",
            }}
          />
          <span
            style={{
              fontSize: "0.68rem",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: badgeColor,
              background: badgeBg,
              padding: "2px 8px",
              borderRadius: "9999px",
            }}
          >
            {hint.severity}
          </span>
          <span
            style={{
              fontSize: "0.74rem",
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {formatRuleType(hint.ruleType)}
          </span>
        </div>

        <span
          style={{
            fontSize: "0.72rem",
            color: "var(--text-muted)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {timeAgo(hint.detectedAt)}
        </span>
      </div>

      {/* Incident Title */}
      <div
        style={{
          fontSize: "0.95rem",
          fontWeight: 600,
          color: "var(--text-primary)",
          marginBottom: 8,
          lineHeight: 1.35,
        }}
      >
        {hint.title}
      </div>

      {/* Monospace Query Box (if present) */}
      {query && (
        <div
          style={{
            background: "var(--surface-alt)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            padding: "8px 12px",
            marginBottom: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <code
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.76rem",
              color: "var(--text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
            }}
            title={query}
          >
            {query}
          </code>
          <button
            type="button"
            onClick={handleCopyQuery}
            style={{
              background: "transparent",
              border: "none",
              color: copiedQuery ? "var(--signal-healthy)" : "var(--text-muted)",
              cursor: "pointer",
              fontSize: "0.72rem",
              padding: "2px 6px",
              borderRadius: 4,
              display: "flex",
              alignItems: "center",
              gap: 4,
              flexShrink: 0,
            }}
            title="Copy SQL Query"
          >
            {copiedQuery ? "✓ Copied" : "Copy SQL"}
          </button>
        </div>
      )}

      {/* Plain-English Explanation */}
      <div
        style={{
          fontSize: "0.82rem",
          color: "var(--text-secondary)",
          lineHeight: 1.5,
          marginBottom: "var(--space-md)",
        }}
      >
        {hint.description}
      </div>

      {/* Action Footer */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: "var(--space-sm)",
          paddingTop: 4,
        }}
      >
        {sqlFix && (
          <button
            type="button"
            onClick={handleCopyFix}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: "0.76rem",
              fontWeight: 500,
              padding: "5px 12px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: copiedFix ? "var(--signal-healthy)" : "var(--text-primary)",
              cursor: "pointer",
              transition: "all var(--transition-fast)",
            }}
          >
            {copiedFix ? "✓ Copied Fix SQL" : "📋 Copy SQL Fix"}
          </button>
        )}

        {databaseId && (
          <Link
            href={inspectHref}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: "0.76rem",
              fontWeight: 500,
              padding: "5px 12px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--brand)",
              background: "var(--brand-dim)",
              color: "var(--brand)",
              textDecoration: "none",
              transition: "all var(--transition-fast)",
            }}
          >
            Inspect Trace →
          </Link>
        )}
      </div>
    </div>
  );
}

