"use client";

import React from "react";
import Link from "next/link";
import PublicNav from "../components/PublicNav";
import PublicFooter from "../components/PublicFooter";

export default function PrivacyPage() {
  return (
    <div className="landing-root">
      <div className="landing-glow-blob landing-glow-1" />
      <div className="landing-glow-blob landing-glow-2" />

      <PublicNav />

      <main className="landing-container" style={{ padding: "120px 24px 80px", maxWidth: 960 }}>
        {/* Header */}
        <div style={{ marginBottom: 40, textAlign: "center" }}>
          <div className="landing-hero-badge" style={{ margin: "0 auto 12px" }}>
            <span>Legal & Privacy</span>
          </div>
          <h1 style={{ fontSize: "2.8rem", fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 12 }}>
            Privacy Policy
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "1.05rem" }}>
            Effective Date: August 31, 2026 · Version 2.0
          </p>
        </div>

        {/* Content Card */}
        <div
          className="glass-card"
          style={{
            padding: "44px 48px",
            borderRadius: 16,
            lineHeight: 1.75,
            color: "var(--text-secondary)",
          }}
        >
          {/* Quick Notice Banner */}
          <div
            style={{
              padding: "16px 20px",
              borderRadius: 10,
              background: "rgba(59, 130, 246, 0.08)",
              border: "1px solid rgba(59, 130, 246, 0.25)",
              marginBottom: 36,
              color: "var(--text-primary)",
            }}
          >
            <strong>🔒 Summary for Engineers & DBAs:</strong> PG Vitals is designed with a strict <em>Zero Customer Row Data Access</em> architecture. We only inspect PostgreSQL internal catalog statistics views (<code>pg_stat_*</code>). We never read, copy, or store your application data or table records.
          </div>

          <h2 style={{ color: "var(--text-primary)", fontSize: "1.35rem", marginTop: 0, borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
            1. Introduction & Scope
          </h2>
          <p>
            PG Vitals ("we," "our," or "us") provides a database telemetry, performance diagnostics, and optimization platform. This Privacy Policy describes how we collect, use, store, and protect information when you visit our website (<code>pgvitals.dev</code>), register an account, or connect a PostgreSQL database for monitoring.
          </p>

          <h2 style={{ color: "var(--text-primary)", fontSize: "1.35rem", marginTop: 32, borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
            2. Information We Collect
          </h2>
          
          <h3 style={{ color: "var(--text-primary)", fontSize: "1.1rem", marginTop: 16 }}>A. Account & Profile Information</h3>
          <p>
            When you sign up or create an organization, we collect your name, email address, company/organization name, and authentication identifiers through our authentication partner, <strong>Clerk</strong>.
          </p>

          <h3 style={{ color: "var(--text-primary)", fontSize: "1.1rem", marginTop: 16 }}>B. Database Diagnostics & System Telemetry</h3>
          <p>
            When you register a monitored PostgreSQL database, our collector queries PostgreSQL system catalog statistics views. We collect:
          </p>
          <ul>
            <li><strong>Connection & Session Metadata:</strong> Active connection counts, session states (<code>active</code>, <code>idle</code>, <code>idle in transaction</code>), client application names, backend process IDs (PIDs), and lock wait trees.</li>
            <li><strong>Query Execution Statistics:</strong> Normalized query statement fingerprints from <code>pg_stat_statements</code> (e.g. <code>SELECT * FROM users WHERE id = $1</code>), call frequencies, mean/min/max latencies, and buffer cache hit rates.</li>
            <li><strong>Storage & Vacuum Health:</strong> Dead tuple counts, table/index bloat estimates, transaction ID (XID) age, and autovacuum worker activity.</li>
            <li><strong>Replication & Pooler Metrics:</strong> WAL generation velocity, replica replay lag, replication slot retention bytes, and PgBouncer connection queue metrics.</li>
          </ul>

          <h3 style={{ color: "var(--text-primary)", fontSize: "1.1rem", marginTop: 16 }}>C. Billing Information</h3>
          <p>
            Payment and subscription processing is handled directly by <strong>Stripe</strong>. PG Vitals does not collect or store full credit card numbers, CVVs, or bank account credentials on its servers.
          </p>

          <h2 style={{ color: "var(--text-primary)", fontSize: "1.35rem", marginTop: 32, borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
            3. Zero Customer Row Data Guarantee
          </h2>
          <p>
            Our collector software operates strictly with read-only permissions targeting PostgreSQL diagnostic views. We <strong>do not</strong> execute <code>SELECT</code> queries against your application tables, and we never access, extract, or store customer records, user profiles, or transactional data.
          </p>

          <h2 style={{ color: "var(--text-primary)", fontSize: "1.35rem", marginTop: 32, borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
            4. SQL Query Sanitization & PII Redaction
          </h2>
          <p>
            To protect against inadvertent exposure of sensitive data:
          </p>
          <ul>
            <li><strong>Parameterization:</strong> All query statements collected from <code>pg_stat_statements</code> replace raw literal values with parameter placeholders (<code>$1, $2, ...</code>).</li>
            <li><strong>PII Sanitizer:</strong> Our ingestion engine automatically scrubs inline SQL comments (<code>-- token=...</code>, <code>/* password */</code>), inline JSON payloads, and array literals before saving to our TimescaleDB hypertables.</li>
          </ul>

          <h2 style={{ color: "var(--text-primary)", fontSize: "1.35rem", marginTop: 32, borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
            5. Credential Encryption & Security
          </h2>
          <p>
            Database connection strings and credentials are encrypted at rest using <strong>AES-256-GCM</strong> authenticated envelope encryption (<code>v1:iv:authTag:ciphertext</code>). All network communications between your browsers, monitored databases, and our API servers are encrypted in transit using <strong>TLS 1.3 / SSL</strong>.
          </p>

          <h2 style={{ color: "var(--text-primary)", fontSize: "1.35rem", marginTop: 32, borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
            6. Sub-processors & Third-Party Service Providers
          </h2>
          <p>
            We partner with trusted third-party providers for infrastructure, authentication, and payments:
          </p>
          <div style={{ overflowX: "auto", margin: "16px 0" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                  <th style={{ padding: "8px 12px" }}>Sub-processor</th>
                  <th style={{ padding: "8px 12px" }}>Purpose</th>
                  <th style={{ padding: "8px 12px" }}>Location</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "8px 12px" }}><strong>Clerk Inc.</strong></td>
                  <td style={{ padding: "8px 12px" }}>User Authentication & Organization Management</td>
                  <td style={{ padding: "8px 12px" }}>United States</td>
                </tr>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "8px 12px" }}><strong>Stripe Inc.</strong></td>
                  <td style={{ padding: "8px 12px" }}>Payment Processing & Invoicing</td>
                  <td style={{ padding: "8px 12px" }}>United States</td>
                </tr>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "8px 12px" }}><strong>Amazon Web Services (AWS)</strong></td>
                  <td style={{ padding: "8px 12px" }}>Cloud Infrastructure & KMS Encryption</td>
                  <td style={{ padding: "8px 12px" }}>United States / Global</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h2 style={{ color: "var(--text-primary)", fontSize: "1.35rem", marginTop: 32, borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
            7. Data Retention & Deletion
          </h2>
          <p>
            Telemetry snapshots and metric rollups are retained based on your organization's plan tier:
          </p>
          <ul>
            <li><strong>Free Tier:</strong> 24 hours retention</li>
            <li><strong>Pro Tier:</strong> 30 days retention</li>
            <li><strong>Team Tier:</strong> 90 days retention</li>
          </ul>
          <p>
            When you unregister a database or delete your account, all associated encrypted connection strings, historical snapshots, and incident hints are permanently erased from our databases.
          </p>

          <h2 style={{ color: "var(--text-primary)", fontSize: "1.35rem", marginTop: 32, borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
            8. GDPR & CCPA Rights
          </h2>
          <p>
            Under the European General Data Protection Regulation (GDPR) and California Consumer Privacy Act (CCPA), you have the right to access, rectify, port, or request deletion of your personal account data. To exercise these rights, email us at <a href="mailto:privacy@pgvitals.dev" style={{ color: "var(--brand)" }}>privacy@pgvitals.dev</a>.
          </p>

          <h2 style={{ color: "var(--text-primary)", fontSize: "1.35rem", marginTop: 32, borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
            9. Contact Information
          </h2>
          <p>
            If you have questions or concerns about this Privacy Policy or our security practices, contact us at:
          </p>
          <div style={{ padding: "16px 20px", background: "var(--surface)", borderRadius: 10, border: "1px solid var(--border)" }}>
            <strong>PG Vitals Privacy & Security Team</strong><br />
            Email: <a href="mailto:privacy@pgvitals.dev" style={{ color: "var(--brand)" }}>privacy@pgvitals.dev</a><br />
            Website: <a href="https://pgvitals.dev" style={{ color: "var(--brand)" }}>https://pgvitals.dev</a>
          </div>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
