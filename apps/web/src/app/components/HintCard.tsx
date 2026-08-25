"use client";

import React, { useState } from "react";
import Link from "next/link";
import type { Hint } from "../lib/api";

/* ===================================================================
   HintCard — Action-Oriented Root Cause Hint Card (Mockup match)
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

/** Extracts an SQL query string from metadata or description */
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

/** Formats SQL with syntax coloring for keywords */
function renderSqlCode(sql: string) {
  const keywordRegex = /\b(INSERT|INTO|VALUES|SELECT|FROM|WHERE|UPDATE|SET|DELETE|ALTER|TABLE|DROP|CREATE|TRUNCATE|LOCK|JOIN|AND|OR|FOR\s+UPDATE)\b/gi;
  
  // Format long single-line queries with readable line breaks if values exist
  let formatted = sql;
  if (!formatted.includes("\n") && formatted.toLowerCase().includes("values")) {
    formatted = formatted.replace(/\s+(values)/i, "\n$1");
  }

  const lines = formatted.split("\n");

  return (
    <div>
      {lines.map((line, lineIdx) => {
        const parts = line.split(keywordRegex);
        return (
          <div key={lineIdx} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {parts.map((part, partIdx) => {
              if (keywordRegex.test(part)) {
                return (
                  <span
                    key={partIdx}
                    style={{
                      color: "#4F46E5",
                      fontWeight: 600,
                    }}
                  >
                    {part.toUpperCase()}
                  </span>
                );
              }
              return (
                <span key={partIdx} style={{ color: "var(--text-primary)" }}>
                  {part}
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

export default function HintCard({ hint, index, databaseId }: HintCardProps) {
  const isCritical = hint.severity === "critical";
  const [copiedFix, setCopiedFix] = useState(false);

  const query = extractSqlQuery(hint);
  const sqlFix = extractSqlFix(hint);

  // Clean description if query is displayed in the code box
  let cleanDescription = hint.description;
  if (query && cleanDescription.includes(`"${query}`)) {
    cleanDescription = cleanDescription.replace(
      new RegExp(`"${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^"]*"`, "i"),
      "the above query"
    );
  }

  const handleCopyFix = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!sqlFix) return;
    navigator.clipboard.writeText(sqlFix);
    setCopiedFix(true);
    setTimeout(() => setCopiedFix(false), 2000);
  };

  const inspectHref = databaseId
    ? `/databases/${databaseId}/hints?rule=${hint.ruleType}`
    : "#";

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: "20px 24px",
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.04)",
        animation: `slideInRight 400ms ease-out ${index * 80}ms both`,
        transition: "all var(--transition-base)",
      }}
    >
      {/* Header Row: Badge + Category */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 10,
        }}
      >
        <span
          style={{
            fontSize: "0.72rem",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            color: isCritical ? "#EF4444" : "#F59E0B",
            background: isCritical
              ? "rgba(239, 68, 68, 0.12)"
              : "rgba(245, 158, 11, 0.12)",
            padding: "3px 10px",
            borderRadius: "9999px",
            display: "inline-block",
          }}
        >
          {hint.severity}
        </span>
        <span
          style={{
            fontSize: "0.82rem",
            color: "var(--text-muted)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {formatRuleType(hint.ruleType)}
        </span>
      </div>

      {/* Incident Title */}
      <div
        style={{
          fontSize: "1.05rem",
          fontWeight: 700,
          color: "var(--text-primary)",
          marginBottom: 12,
          lineHeight: 1.35,
        }}
      >
        {hint.title}
      </div>

      {/* Code Box (if SQL query exists) */}
      {query && (
        <div
          style={{
            background: "var(--surface-alt)",
            border: "1px solid var(--border)",
            borderRadius: "10px",
            padding: "12px 16px",
            marginBottom: 14,
            fontFamily: "var(--font-mono)",
            fontSize: "0.82rem",
            lineHeight: 1.6,
          }}
        >
          {renderSqlCode(query)}
        </div>
      )}

      {/* Description */}
      <div
        style={{
          fontSize: "0.86rem",
          color: "var(--text-secondary)",
          lineHeight: 1.6,
          marginBottom: 16,
        }}
      >
        {cleanDescription}
      </div>

      {/* Footer Row: Timestamp (Left) + Action Buttons (Right) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-md)",
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: "0.8rem",
            color: "var(--text-muted)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {timeAgo(hint.detectedAt)}
        </span>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {sqlFix && (
            <button
              type="button"
              onClick={handleCopyFix}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: "0.8rem",
                fontWeight: 500,
                padding: "6px 14px",
                borderRadius: "8px",
                border: "1px solid var(--border)",
                background: "var(--surface)",
                color: copiedFix ? "var(--signal-healthy)" : "var(--text-primary)",
                cursor: "pointer",
                transition: "all var(--transition-fast)",
              }}
            >
              {copiedFix ? "✓ Copied Fix" : "Copy SQL Fix"}
            </button>
          )}

          {databaseId && (
            <Link
              href={inspectHref}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: "0.8rem",
                fontWeight: 500,
                padding: "6px 16px",
                borderRadius: "8px",
                border: "none",
                background: "#2563EB",
                color: "#FFFFFF",
                textDecoration: "none",
                transition: "all var(--transition-fast)",
              }}
            >
              Inspect Trace
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}


