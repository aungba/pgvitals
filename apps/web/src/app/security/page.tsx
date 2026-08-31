"use client";

import React from "react";
import Link from "next/link";
import PublicNav from "../components/PublicNav";
import PublicFooter from "../components/PublicFooter";

export default function SecurityPage() {
  return (
    <div className="landing-root">
      <div className="landing-glow-blob landing-glow-1" />
      <div className="landing-glow-blob landing-glow-2" />

      <PublicNav />

      <main className="landing-container" style={{ padding: "120px 24px 80px", maxWidth: 960 }}>
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <div className="landing-hero-badge" style={{ margin: "0 auto 12px" }}>
            <span>🛡️ Enterprise Security</span>
          </div>
          <h1 style={{ fontSize: "2.8rem", fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 16 }}>
            Security & Data Protection
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "1.15rem", maxWidth: 640, margin: "0 auto" }}>
            Learn how PG Vitals protects your database credentials, isolates organizations, and guarantees zero customer row access.
          </p>
        </div>

        <div style={{ display: "grid", gap: 24, marginBottom: 48 }}>
          {[
            {
              icon: "🔒",
              title: "AES-256-GCM Envelope Encryption",
              desc: "All monitored database connection strings and passwords are encrypted at rest using AES-256-GCM with unique initialization vectors (IVs) and authentication tags. We support pluggable KMS providers including AWS KMS, GCP KMS, and HashiCorp Vault.",
            },
            {
              icon: "👁️",
              title: "Zero Customer Data Access",
              desc: "PG Vitals connects via a dedicated read-only role (pg_read_all_stats) that only has access to Postgres internal diagnostic catalogs (pg_stat_activity, pg_stat_statements, pg_locks). We never read, select, or replicate customer table data.",
            },
            {
              icon: "🛡️",
              title: "Strict Query Sanitization & PII Redaction",
              desc: "Before any query text is saved to our metric hypertables, our sanitization engine strips all inline SQL comments (-- token, /* secret */), nested JSON objects, and array literals to prevent credential leakage.",
            },
            {
              icon: "⚡",
              title: "Statement Timeout Safeguards",
              desc: "Every metric collection transaction automatically enforces SET statement_timeout = 3000 (3 seconds) and SET default_transaction_read_only = on, ensuring monitoring queries never cause lock contention on your production instance.",
            },
            {
              icon: "🏢",
              title: "Multi-Tenant Isolation",
              desc: "All database instances, metric snapshots, alerts, and incident logs are strictly partitioned by organization ID (orgId) with database-level constraints and Clerk token verification.",
            },
            {
              icon: "🔐",
              title: "Slack ChatOps Verification",
              desc: "Remote remediation commands (such as terminating blocker sessions) require admin/owner privileges and are validated against Slack's HMAC-SHA256 signature verification protocol.",
            },
          ].map((item, idx) => (
            <div
              key={idx}
              className="glass-card"
              style={{
                padding: "24px 28px",
                borderRadius: 14,
                display: "flex",
                gap: 20,
                alignItems: "flex-start",
              }}
            >
              <div
                style={{
                  fontSize: "1.8rem",
                  lineHeight: 1,
                  padding: 12,
                  borderRadius: 10,
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                }}
              >
                {item.icon}
              </div>
              <div>
                <h3 style={{ fontSize: "1.15rem", fontWeight: 700, marginBottom: 6, color: "var(--text-primary)" }}>
                  {item.title}
                </h3>
                <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem", lineHeight: 1.6, margin: 0 }}>
                  {item.desc}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
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
          <h3 style={{ fontSize: "1.4rem", fontWeight: 700, marginBottom: 8 }}>Have security questions or need a SOC 2 report?</h3>
          <p style={{ color: "var(--text-secondary)", marginBottom: 20, fontSize: "0.95rem" }}>
            Our security and compliance team is available to assist with your vendor assessment.
          </p>
          <a href="mailto:security@pgvitals.dev" className="btn-primary" style={{ padding: "10px 24px", textDecoration: "none", display: "inline-block" }}>
            Contact Security Team
          </a>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
