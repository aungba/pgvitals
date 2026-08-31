"use client";

import React from "react";
import Link from "next/link";
import PublicNav from "../components/PublicNav";
import PublicFooter from "../components/PublicFooter";

export default function TermsPage() {
  return (
    <div className="landing-root">
      <div className="landing-glow-blob landing-glow-1" />
      <div className="landing-glow-blob landing-glow-2" />

      <PublicNav />

      <main className="landing-container" style={{ padding: "120px 24px 80px", maxWidth: 960 }}>
        {/* Header */}
        <div style={{ marginBottom: 40, textAlign: "center" }}>
          <div className="landing-hero-badge" style={{ margin: "0 auto 12px" }}>
            <span>Legal Agreement</span>
          </div>
          <h1 style={{ fontSize: "2.8rem", fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 12 }}>
            Terms of Service
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
          <h2 style={{ color: "var(--text-primary)", fontSize: "1.35rem", marginTop: 0, borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
            1. Agreement to Terms
          </h2>
          <p>
            These Terms of Service ("Terms") constitute a legally binding agreement between you or the entity you represent ("Customer," "you," or "your") and PG Vitals ("PG Vitals," "we," "us," or "our"). By accessing, subscribing to, or using the PG Vitals platform, web dashboard, or APIs, you agree to be bound by these Terms.
          </p>

          <h2 style={{ color: "var(--text-primary)", fontSize: "1.35rem", marginTop: 32, borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
            2. Description of the Service
          </h2>
          <p>
            PG Vitals is a software-as-a-service (SaaS) observability platform providing real-time PostgreSQL connection telemetry, lock contention detection, query execution analytics, automated index advisories with HypoPG simulation, vacuum health sentinels, and incident alerting.
          </p>

          <h2 style={{ color: "var(--text-primary)", fontSize: "1.35rem", marginTop: 32, borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
            3. Customer Database Access & Responsibilities
          </h2>
          <ul>
            <li><strong>Least-Privilege Role Provisioning:</strong> You agree to configure database monitoring credentials using dedicated, read-only PostgreSQL roles (e.g. <code>pg_read_all_stats</code>) in accordance with our setup guides.</li>
            <li><strong>Network Security:</strong> You are solely responsible for configuring firewall rules, VPC peering, and security groups permitting connection between your PostgreSQL instances and the PG Vitals collector.</li>
            <li><strong>Credentials & Secret Management:</strong> You represent that you have full authorization to provide database connection strings to the Service.</li>
          </ul>

          <h2 style={{ color: "var(--text-primary)", fontSize: "1.35rem", marginTop: 32, borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
            4. Remote Remediation & ChatOps Disclaimer
          </h2>
          <div
            style={{
              padding: "16px 20px",
              borderRadius: 10,
              background: "rgba(245, 158, 11, 0.08)",
              border: "1px solid rgba(245, 158, 11, 0.3)",
              marginBottom: 16,
              color: "var(--text-primary)",
            }}
          >
            <strong>⚠️ Operator Responsibility:</strong> PG Vitals offers interactive session cancellation features (e.g. <code>pg_terminate_backend</code> via Slack ChatOps or the dashboard). You acknowledge that issuing termination commands aborts database transactions immediately. PG Vitals is not liable for data rollbacks, client connection drops, or interrupted business transactions resulting from your authorized termination actions.
          </div>

          <h2 style={{ color: "var(--text-primary)", fontSize: "1.35rem", marginTop: 32, borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
            5. Subscriptions, Billing & Cancellations
          </h2>
          <ul>
            <li><strong>Plan Tiers:</strong> Free, Pro ($39/mo or $31/mo annual), and Team ($149/mo or $119/mo annual) tiers are subject to database count, team seat, and telemetry retention limits.</li>
            <li><strong>Billing Cycle:</strong> Paid subscriptions are billed in advance on a recurring monthly or annual basis via Stripe.</li>
            <li><strong>Cancellation:</strong> You may cancel your subscription at any time via the Settings & Billing page. Cancellation takes effect at the end of the current billing cycle.</li>
            <li><strong>Refunds:</strong> We provide a 14-day money-back guarantee on initial Pro and Team plan upgrades upon written request.</li>
          </ul>

          <h2 style={{ color: "var(--text-primary)", fontSize: "1.35rem", marginTop: 32, borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
            6. Service Level & Uptime
          </h2>
          <p>
            We strive to maintain a 99.9% uptime target for the PG Vitals platform. Scheduled maintenance windows with prior notification are excluded from uptime calculations.
          </p>

          <h2 style={{ color: "var(--text-primary)", fontSize: "1.35rem", marginTop: 32, borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
            7. Limitation of Liability
          </h2>
          <p>
            To the maximum extent permitted by applicable law, in no event shall PG Vitals, its directors, employees, or partners be liable for any indirect, incidental, special, consequential, or punitive damages, including loss of profits, data, or business interruption.
          </p>
          <p>
            Our total aggregate liability under these Terms shall not exceed the amounts paid by you to PG Vitals in the twelve (12) months preceding the incident.
          </p>

          <h2 style={{ color: "var(--text-primary)", fontSize: "1.35rem", marginTop: 32, borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
            8. Governing Law & Dispute Resolution
          </h2>
          <p>
            These Terms shall be governed by and construed in accordance with the laws of the State of Delaware, United States, without regard to its conflict of law provisions.
          </p>

          <h2 style={{ color: "var(--text-primary)", fontSize: "1.35rem", marginTop: 32, borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
            9. Contact & Legal Inquiries
          </h2>
          <p>
            For legal inquiries, notices, or questions regarding these Terms, contact:
          </p>
          <div style={{ padding: "16px 20px", background: "var(--surface)", borderRadius: 10, border: "1px solid var(--border)" }}>
            <strong>PG Vitals Legal Department</strong><br />
            Email: <a href="mailto:legal@pgvitals.dev" style={{ color: "var(--brand)" }}>legal@pgvitals.dev</a><br />
            Website: <a href="https://pgvitals.dev" style={{ color: "var(--brand)" }}>https://pgvitals.dev</a>
          </div>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
