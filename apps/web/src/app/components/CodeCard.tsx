"use client";

import React, { useState } from "react";

interface CodeCardProps {
  code: string;
  language?: string;
  title?: string;
}

export default function CodeCard({ code, language = "sql", title }: CodeCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Fast client-side syntax highlighter for SQL and Shell commands
  const highlightSyntax = (raw: string, lang: string) => {
    const lines = raw.split("\n");

    return lines.map((line, lineIdx) => {
      // 1. Comments
      if (line.trim().startsWith("--") || line.trim().startsWith("#")) {
        return (
          <div key={lineIdx} style={{ color: "#64748B", fontStyle: "italic" }}>
            {line || " "}
          </div>
        );
      }

      if (lang === "sql") {
        // Regex tokenization for SQL
        const tokens = line.split(
          /('(?:''|[^'])*'|\b(?:CREATE|USER|WITH|PASSWORD|CONNECTION|LIMIT|GRANT|ON|DATABASE|TO|EXTENSION|IF|NOT|EXISTS|SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|VALUES|SET|ALTER|ROLE|TABLE|SCHEMA|INDEX|CONCURRENTLY|INCLUDE|REINDEX|VACUUM|VERBOSE|ANALYZE|DEFAULT|PRIVILEGES|ORDER|BY|AND|OR|AS|JOIN|LEFT|RIGHT|INNER|GROUP|HAVING|IN|ANY|ALL|IS|NULL|TRUE|FALSE|CASCADE)\b|\b(?:pg_read_all_stats|pg_read_all_data|pg_terminate_backend|pg_stat_statements|hypopg|pg_stat_activity|pg_locks|pg_stat_user_tables|public)\b|\b\d+\b)/gi
        );

        return (
          <div key={lineIdx}>
            {tokens.map((token, tokIdx) => {
              if (!token) return null;

              // String literals: 'password'
              if (token.startsWith("'") && token.endsWith("'")) {
                return (
                  <span key={tokIdx} style={{ color: "#34D399" }}>
                    {token}
                  </span>
                );
              }

              // Numbers: 5, 14, 100
              if (/^\d+$/.test(token)) {
                return (
                  <span key={tokIdx} style={{ color: "#F472B6" }}>
                    {token}
                  </span>
                );
              }

              // Built-in PostgreSQL functions/roles
              if (
                /^(?:pg_read_all_stats|pg_read_all_data|pg_terminate_backend|pg_stat_statements|hypopg|pg_stat_activity|pg_locks|pg_stat_user_tables|public)$/i.test(
                  token
                )
              ) {
                return (
                  <span key={tokIdx} style={{ color: "#FBBF24", fontWeight: 500 }}>
                    {token}
                  </span>
                );
              }

              // SQL Keywords
              if (
                /^(?:CREATE|USER|WITH|PASSWORD|CONNECTION|LIMIT|GRANT|ON|DATABASE|TO|EXTENSION|IF|NOT|EXISTS|SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|VALUES|SET|ALTER|ROLE|TABLE|SCHEMA|INDEX|CONCURRENTLY|INCLUDE|REINDEX|VACUUM|VERBOSE|ANALYZE|DEFAULT|PRIVILEGES|ORDER|BY|AND|OR|AS|JOIN|LEFT|RIGHT|INNER|GROUP|HAVING|IN|ANY|ALL|IS|NULL|TRUE|FALSE|CASCADE)$/i.test(
                  token
                )
              ) {
                return (
                  <span key={tokIdx} style={{ color: "#38BDF8", fontWeight: 600 }}>
                    {token.toUpperCase()}
                  </span>
                );
              }

              // Standard identifiers and symbols
              return <span key={tokIdx}>{token}</span>;
            })}
          </div>
        );
      }

      // Shell / URI
      return <div key={lineIdx}>{line || " "}</div>;
    });
  };

  return (
    <div className="docs-code-card">
      <div className="docs-code-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="docs-code-dots">
            <span />
            <span />
            <span />
          </div>
          {title && <span style={{ color: "#94A3B8", fontWeight: 500 }}>{title}</span>}
        </div>

        <button onClick={handleCopy} className="docs-copy-btn" title="Copy to clipboard">
          {copied ? (
            <>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span style={{ color: "#10B981" }}>Copied</span>
            </>
          ) : (
            <>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      <pre className="docs-code-content">
        <code>{highlightSyntax(code, language)}</code>
      </pre>
    </div>
  );
}
