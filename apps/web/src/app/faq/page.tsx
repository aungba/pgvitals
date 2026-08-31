"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import PublicNav from "../components/PublicNav";
import PublicFooter from "../components/PublicFooter";

interface FAQItem {
  q: string;
  a: string;
  category: "general" | "performance" | "security" | "compatibility" | "alerts" | "troubleshooting";
}

export default function FAQPage() {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [openItems, setOpenItems] = useState<Record<number, boolean>>({ 0: true, 1: true });

  const faqs: FAQItem[] = [
    {
      category: "general",
      q: "What is PG Vitals?",
      a: "PG Vitals is a real-time PostgreSQL performance telemetry, root-cause diagnostic, and optimization platform. It combines live connection tracking, lock tree analysis, query latency percentiles (P95/P99), automated index recommendations with HypoPG simulation, and Slack ChatOps remediation into a unified developer dashboard.",
    },
    {
      category: "general",
      q: "How does PG Vitals differ from pgAdmin or general APMs like Datadog?",
      a: "Unlike manual query tools (pgAdmin), PG Vitals continuously watches your database with 7 heuristic sentinel rules. Unlike general APMs (Datadog/New Relic) that only track high-level CPU/RAM, PG Vitals inspects deep PostgreSQL internals: circular lock waits, B-Tree index bloat, XID wraparound headroom, HOT update efficiency, and fsync checkpoint stalls, auto-generating non-blocking zero-downtime CONCURRENTLY DDL.",
    },
    {
      category: "performance",
      q: "What is the performance overhead on my monitored PostgreSQL instance?",
      a: "Extremely low — less than 0.5% CPU overhead. Diagnostic queries execute with `SET default_transaction_read_only = on` and strict 3-second statement timeouts. The collector caches connections in an LRU pool with 3-minute idle eviction, limiting connections to 3–5 slots. In addition, real-time dashboard updates utilize an in-memory Server-Sent Events (SSE) broadcast hub, so having multiple browser tabs open generates zero extra load on your database.",
    },
    {
      category: "performance",
      q: "How frequently does PG Vitals poll the database?",
      a: "By default, active connections and lock chains are polled every 10 seconds (configurable via `POLLING_INTERVAL_MS`). Query statistics (`pg_stat_statements`) are collected every 5 minutes. VACUUM health and table bloat metrics are calculated periodically in the background or refreshed on-demand.",
    },
    {
      category: "security",
      q: "Does PG Vitals read or store my customer table rows?",
      a: "Never. PG Vitals only queries PostgreSQL system catalog and statistics views (`pg_stat_activity`, `pg_stat_statements`, `pg_locks`, `pg_stat_user_tables`). It has zero access to private table contents.",
    },
    {
      category: "security",
      q: "How are database connection strings and passwords protected?",
      a: "All connection strings are encrypted at rest using AES-256-GCM authenticated envelope encryption (`v1:iv:authTag:ciphertext`). Keys are managed via secure environment variables or pluggable KMS providers (AWS KMS, GCP KMS, HashiCorp Vault). Furthermore, SQL sanitization strips comments, JSON payloads, and sensitive literals before storing query text.",
    },
    {
      category: "compatibility",
      q: "Which PostgreSQL versions are supported?",
      a: "PG Vitals supports PostgreSQL 10 through 18+. Version-specific features (such as `pg_stat_wal` in PG 14+, WAL LSN functions, and predefined roles) are adaptively detected and handled by the collector engine.",
    },
    {
      category: "compatibility",
      q: "Which cloud providers and hosting platforms can I monitor?",
      a: "Any standard PostgreSQL endpoint works, including AWS RDS, AWS Aurora, Google Cloud SQL, AlloyDB, Azure Database for PostgreSQL, Supabase, Neon Serverless, Timescale Cloud, Railway, and self-hosted Linux/Docker instances.",
    },
    {
      category: "compatibility",
      q: "Is `pg_stat_statements` required?",
      a: "While basic connection counts and lock trees work without it, `pg_stat_statements` is strongly recommended for query performance tracking, P95/P99 latency variance, and index recommendations. It can be enabled with `CREATE EXTENSION IF NOT EXISTS pg_stat_statements;`.",
    },
    {
      category: "alerts",
      q: "What notification channels are supported for alerts?",
      a: "PG Vitals integrates with Slack (rich Block Kit cards), PagerDuty (Events API v2), Microsoft Teams (Adaptive Cards), Email (SMTP HTML reports), and Custom Webhooks with HMAC-SHA256 request signatures.",
    },
    {
      category: "alerts",
      q: "How does Slack ChatOps remote remediation work?",
      a: "When a critical lock storm or long-running blocker is detected, PG Vitals sends an interactive alert card to Slack. An authorized engineer can click '⚡ Terminate Blocker'. PG Vitals verifies the Slack HMAC signature and safely calls `pg_terminate_backend(pid)` to unblock production transactions.",
    },
    {
      category: "troubleshooting",
      q: "Why do I see 'No Query Plan Available' for certain queries?",
      a: "Query plan capture runs an `EXPLAIN` on the parameterized query. If the query references temporary tables, depends on uncommitted transactions, or contains statements not supported by `EXPLAIN`, the plan visualizer safely falls back to tabular metadata.",
    },
    {
      category: "troubleshooting",
      q: "How do I fix `ECONNREFUSED` when starting the local dev environment?",
      a: "Make sure TimescaleDB and Redis are running via `docker compose up -d`. Verify their health with `docker compose ps`.",
    },
  ];

  const categories = [
    { id: "all", label: "All Questions" },
    { id: "general", label: "General" },
    { id: "performance", label: "Performance & Overhead" },
    { id: "security", label: "Security & Privacy" },
    { id: "compatibility", label: "Compatibility & Clouds" },
    { id: "alerts", label: "Alerts & ChatOps" },
    { id: "troubleshooting", label: "Troubleshooting" },
  ];

  const filteredFaqs = useMemo(() => {
    return faqs.filter((faq) => {
      const matchesCat = activeCategory === "all" || faq.category === activeCategory;
      const matchesSearch =
        !search ||
        faq.q.toLowerCase().includes(search.toLowerCase()) ||
        faq.a.toLowerCase().includes(search.toLowerCase());
      return matchesCat && matchesSearch;
    });
  }, [faqs, activeCategory, search]);

  const toggleItem = (idx: number) => {
    setOpenItems((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  return (
    <div className="landing-root">
      <div className="landing-glow-blob landing-glow-1" />
      <div className="landing-glow-blob landing-glow-2" />

      <PublicNav />

      <main className="landing-container" style={{ padding: "120px 24px 80px", maxWidth: 960 }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div className="landing-hero-badge" style={{ margin: "0 auto 16px" }}>
            <span>❓ Frequently Asked Questions</span>
          </div>
          <h1 style={{ fontSize: "2.8rem", fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 16 }}>
            Got Questions? We’ve Got Answers.
          </h1>
          <p style={{ fontSize: "1.15rem", color: "var(--text-secondary)", maxWidth: 600, margin: "0 auto" }}>
            Everything you need to know about PG Vitals architecture, database overhead, security guarantees, and query diagnostics.
          </p>
        </div>

        {/* Search Bar */}
        <div style={{ position: "relative", maxWidth: 640, margin: "0 auto 32px" }}>
          <input
            type="text"
            placeholder="Search questions (e.g. overhead, security, RDS, Slack)..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: "100%",
              padding: "14px 20px 14px 44px",
              borderRadius: 12,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
              fontSize: "1rem",
              outline: "none",
              boxShadow: "0 4px 20px rgba(0,0,0,0.05)",
            }}
          />
          <span style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", opacity: 0.5 }}>
            🔍
          </span>
          {search && (
            <button
              onClick={() => setSearch("")}
              style={{
                position: "absolute",
                right: 14,
                top: "50%",
                transform: "translateY(-50%)",
                background: "transparent",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
              }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Category Pills */}
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            justifyContent: "center",
            marginBottom: 40,
          }}
        >
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`filter-chip ${activeCategory === cat.id ? "active" : ""}`}
              style={{
                padding: "8px 16px",
                borderRadius: 20,
                fontSize: "0.85rem",
                cursor: "pointer",
              }}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* FAQ Accordion List */}
        <div style={{ display: "grid", gap: 16, marginBottom: 56 }}>
          {filteredFaqs.length === 0 ? (
            <div className="glass-card" style={{ textAlign: "center", padding: "48px 24px", borderRadius: 16 }}>
              <span style={{ fontSize: "2rem", display: "block", marginBottom: 12 }}>🔎</span>
              <h3 style={{ fontSize: "1.2rem", fontWeight: 600, marginBottom: 8 }}>No matching questions found</h3>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
                Try searching for another term or clear your filter.
              </p>
            </div>
          ) : (
            filteredFaqs.map((faq, idx) => {
              const isOpen = !!openItems[idx];
              return (
                <div
                  key={idx}
                  className="glass-card"
                  onClick={() => toggleItem(idx)}
                  style={{
                    padding: "20px 24px",
                    borderRadius: 14,
                    cursor: "pointer",
                    transition: "border-color var(--transition-fast)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
                    <h3 style={{ fontSize: "1.08rem", fontWeight: 600, margin: 0, color: "var(--text-primary)" }}>
                      {faq.q}
                    </h3>
                    <span
                      style={{
                        fontSize: "1.2rem",
                        fontWeight: 700,
                        color: "var(--brand)",
                        width: 24,
                        textAlign: "center",
                      }}
                    >
                      {isOpen ? "−" : "+"}
                    </span>
                  </div>
                  {isOpen && (
                    <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
                      <p style={{ color: "var(--text-secondary)", lineHeight: 1.65, fontSize: "0.95rem", margin: 0 }}>
                        {faq.a}
                      </p>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Still Have Questions CTA */}
        <div
          className="glass-card"
          style={{
            textAlign: "center",
            padding: "40px 24px",
            borderRadius: 16,
            background: "var(--surface-alt)",
            border: "1px solid var(--border)",
          }}
        >
          <h3 style={{ fontSize: "1.4rem", fontWeight: 700, marginBottom: 8 }}>Still have questions?</h3>
          <p style={{ color: "var(--text-secondary)", marginBottom: 20, fontSize: "0.95rem" }}>
            Check out our detailed user manual or reach out to our engineering team.
          </p>
          <div style={{ display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap" }}>
            <Link href="/docs" className="btn-primary" style={{ padding: "10px 22px" }}>
              Explore Full Docs
            </Link>
            <Link href="/quickstart" className="btn-secondary" style={{ padding: "10px 22px" }}>
              View Quickstart Guide
            </Link>
          </div>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
