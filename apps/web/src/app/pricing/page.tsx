"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import PublicNav from "../components/PublicNav";
import PublicFooter from "../components/PublicFooter";

export default function PricingPage() {
  const { isSignedIn } = useAuth();
  const [isAnnual, setIsAnnual] = useState(false);

  const plans = [
    {
      name: "Free Forever",
      badge: "Hobby / Starter",
      price: "$0",
      period: "forever",
      description: "Essential Postgres vitals for 1 database. Perfect for side projects and development.",
      highlight: false,
      features: [
        "1 database monitored",
        "Live connection gauge & session inspector",
        "24-hour metric retention",
        "Basic vacuum & table health overview",
        "PostgreSQL catalog health metrics",
        "Community support & documentation",
      ],
      notIncluded: [
        "Multi-database capacity (2+ DBs)",
        "Multi-channel alerting (Slack, PagerDuty, Email)",
        "Automated Index advisor & HypoPG simulation",
        "EXPLAIN plan diff visualizer & regression engine",
        "30-day continuous metric rollups",
        "Slack ChatOps 1-click remediation",
      ],
      ctaText: isSignedIn ? "Included by Default" : "Start Free (1 DB)",
      ctaHref: isSignedIn ? "/settings/billing" : "/sign-up",
      ctaPrimary: false,
    },
    {
      name: "Pro",
      badge: "Fast-Moving Startups",
      tag: "MOST POPULAR",
      price: isAnnual ? "$31" : "$39",
      period: isAnnual ? "/mo ($372 billed annually)" : "/month (up to 5 databases)",
      description: "Complete DBA Sentinel suite for development and production database fleets.",
      highlight: true,
      features: [
        "Up to 5 databases monitored",
        "Full DBA Sentinel suite (Deadlocks, XID, Bloat)",
        "HypoPG hypothetical index simulation",
        "Plan regression & side-by-side EXPLAIN visualizer",
        "Multi-channel alerts & 1-click Slack ChatOps",
        "30-day continuous metric rollups",
        "Tail latencies (P95/P99) & storage I/O diagnostics",
        "AI Query Explainer & Rewriter",
        "Up to 3 team member seats",
      ],
      notIncluded: [],
      ctaText: isSignedIn ? "Upgrade to Pro" : "Start 14-Day Free Trial",
      ctaHref: isSignedIn ? "/settings/billing" : "/sign-up",
      ctaPrimary: true,
    },
    {
      name: "Team",
      badge: "Scale & Enterprise",
      price: isAnnual ? "$79" : "$99",
      period: isAnnual ? "/mo ($948 billed annually)" : "/month (unlimited databases)",
      description: "For scaling engineering organizations and multi-dev teams managing multiple database clusters.",
      highlight: false,
      features: [
        "Unlimited databases monitored",
        "Everything in Pro included",
        "Unlimited team members & RBAC",
        "90-day continuous metric rollups",
        "Multi-environment management & tagging",
        "Custom webhook integrations",
        "Priority engineering support & SLA",
      ],
      notIncluded: [],
      ctaText: isSignedIn ? "Upgrade to Team" : "Get Started with Team",
      ctaHref: isSignedIn ? "/settings/billing" : "/sign-up",
      ctaPrimary: false,
    },
  ];

  const comparisonFeatures = [
    { name: "Monitored Databases", free: "1 DB", pro: "Up to 5 DBs", team: "Unlimited DBs" },
    { name: "Metric Retention", free: "24 Hours", pro: "30 Days", team: "90 Days" },
    { name: "Live Connection Gauge & Sessions", free: "✓", pro: "✓", team: "✓" },
    { name: "PostgreSQL Config Advisor (PGTune)", free: "✓", pro: "✓", team: "✓" },
    { name: "VACUUM & Table Health Overview", free: "Basic", pro: "Full Deep Inspection", team: "Full Deep Inspection" },
    { name: "DBA Sentinel Rules (Deadlocks, XID Wraparound)", free: "—", pro: "✓", team: "✓" },
    { name: "HypoPG Hypothetical Index Simulation", free: "—", pro: "✓", team: "✓" },
    { name: "EXPLAIN Visualizer & Regression Engine", free: "—", pro: "✓", team: "✓" },
    { name: "Multi-Channel Alerts (Slack, PagerDuty, Teams, Email)", free: "—", pro: "✓", team: "✓" },
    { name: "Slack ChatOps 1-Click Remediation", free: "—", pro: "✓", team: "✓" },
    { name: "AI Query Explainer & Rewriter", free: "—", pro: "✓", team: "✓" },
    { name: "Team Seats & RBAC", free: "1 Seat", pro: "3 Seats", team: "Unlimited" },
    { name: "Support", free: "Community Docs", pro: "Standard Email", team: "Priority Engineering" },
  ];

  const faqs = [
    {
      q: "Can I try Pro before committing to a paid plan?",
      a: "Yes! Every new account gets an automatic 14-day free Pro trial with access to all DBA Sentinel features and capacity for up to 2 databases. No credit card is required to start.",
    },
    {
      q: "Can I upgrade or downgrade anytime?",
      a: "Yes. Upgrades and downgrades take effect immediately. If you upgrade, charges are prorated for the remaining billing cycle. Downgrades take effect at the end of the current billing period via your Stripe billing portal.",
    },
    {
      q: "Are monitored databases limited by queries per second?",
      a: "No. PG Vitals does not meter or throttle your queries. Telemetry polling is lightweight (<0.5% overhead) and runs via standard read-only statistics views regardless of your database throughput.",
    },
    {
      q: "What payment methods are supported?",
      a: "All major credit cards (Visa, Mastercard, American Express) are accepted securely through Stripe. Annual invoices and wire transfers are available for Team and custom Enterprise arrangements.",
    },
  ];

  return (
    <div className="landing-root">
      <div className="landing-glow-blob landing-glow-1" />
      <div className="landing-glow-blob landing-glow-2" />

      <PublicNav />

      <main className="landing-container" style={{ padding: "44px 24px 72px", maxWidth: 1180 }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div className="landing-hero-badge" style={{ margin: "0 auto 10px" }}>
            <span>⚡ Transparent Pricing</span>
          </div>
          <h1 style={{ fontSize: "2.5rem", fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 12 }}>
            Simple, Predictable Plans
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "1.05rem", maxWidth: 640, margin: "0 auto" }}>
            Start free forever. Scale seamlessly as your PostgreSQL fleet and engineering team grow.
          </p>

          {/* Signed-in helper banner */}
          {isSignedIn && (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                marginTop: 20,
                padding: "8px 18px",
                borderRadius: 24,
                background: "rgba(59, 130, 246, 0.08)",
                border: "1px solid rgba(59, 130, 246, 0.25)",
                fontSize: 14,
                color: "var(--brand, #3b82f6)",
              }}
            >
              <span>Logged in to your organization.</span>
              <Link href="/settings/billing" style={{ fontWeight: 600, textDecoration: "underline" }}>
                Manage current subscription & database capacity →
              </Link>
            </div>
          )}

          {/* Monthly / Annual Toggle */}
          <div className="pricing-toggle-wrap" style={{ marginTop: 28 }}>
            <span className={!isAnnual ? "pricing-toggle-active" : ""}>Monthly</span>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={isAnnual}
                onChange={(e) => setIsAnnual(e.target.checked)}
              />
              <span className="toggle-slider" />
            </label>
            <span className={isAnnual ? "pricing-toggle-active" : ""}>
              Annual <span className="discount-badge">Save 20%</span>
            </span>
          </div>
        </div>

        {/* Pricing Cards Grid */}
        <div className="landing-pricing-grid" style={{ marginBottom: 64 }}>
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`glass-card landing-pricing-card ${plan.highlight ? "landing-pricing-featured" : ""}`}
              style={{ display: "flex", flexDirection: "column", position: "relative" }}
            >
              {plan.tag && (
                <div className="landing-plan-popular-tag">{plan.tag}</div>
              )}
              <div className="landing-plan-badge">{plan.badge}</div>
              <h3 className="landing-plan-title">{plan.name}</h3>
              <div className="landing-plan-price">
                <span className="price-num">{plan.price}</span>
                <span className="price-period" style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                  {plan.period}
                </span>
              </div>
              <p className="landing-plan-desc">{plan.description}</p>

              <ul className="landing-plan-features" style={{ flex: 1 }}>
                {plan.features.map((f) => (
                  <li key={f}>
                    <span className="check-icon">✓</span> {f}
                  </li>
                ))}
                {plan.notIncluded.map((f) => (
                  <li key={f}>
                    <span className="cross-icon">—</span>{" "}
                    <span className="feature-disabled">{f}</span>
                  </li>
                ))}
              </ul>

              <Link
                href={plan.ctaHref}
                className={plan.ctaPrimary ? "btn-primary landing-plan-btn" : "btn-secondary landing-plan-btn"}
                style={{ textAlign: "center", textDecoration: "none", width: "100%", marginTop: 20 }}
              >
                {plan.ctaText}
              </Link>
            </div>
          ))}
        </div>

        {/* Feature Comparison Matrix */}
        <div style={{ marginBottom: 64 }}>
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <h2 style={{ fontSize: "1.8rem", fontWeight: 700, marginBottom: 8 }}>
              Compare Plan Capabilities
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "1rem" }}>
              Every feature broken down across tiers.
            </p>
          </div>

          <div
            className="glass-card"
            style={{
              borderRadius: 14,
              overflow: "hidden",
              border: "1px solid var(--border)",
            }}
          >
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 14 }}>
                <thead>
                  <tr style={{ background: "var(--surface-alt, rgba(255, 255, 255, 0.03))", borderBottom: "1px solid var(--border)" }}>
                    <th style={{ padding: "16px 20px", fontWeight: 700, width: "40%" }}>Feature</th>
                    <th style={{ padding: "16px 20px", fontWeight: 700, width: "20%", textAlign: "center" }}>Free</th>
                    <th style={{ padding: "16px 20px", fontWeight: 700, width: "20%", textAlign: "center", color: "var(--brand, #3b82f6)" }}>Pro</th>
                    <th style={{ padding: "16px 20px", fontWeight: 700, width: "20%", textAlign: "center" }}>Team</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonFeatures.map((row, idx) => (
                    <tr
                      key={row.name}
                      style={{
                        borderBottom: idx < comparisonFeatures.length - 1 ? "1px solid var(--border)" : "none",
                      }}
                    >
                      <td style={{ padding: "14px 20px", fontWeight: 500, color: "var(--text-primary)" }}>
                        {row.name}
                      </td>
                      <td style={{ padding: "14px 20px", textAlign: "center", color: "var(--text-secondary)" }}>
                        {row.free === "✓" ? <span style={{ color: "var(--signal-healthy, #10b981)", fontWeight: 700 }}>✓</span> : row.free}
                      </td>
                      <td style={{ padding: "14px 20px", textAlign: "center", fontWeight: 600, color: "var(--text-primary)" }}>
                        {row.pro === "✓" ? <span style={{ color: "var(--signal-healthy, #10b981)", fontWeight: 700 }}>✓</span> : row.pro}
                      </td>
                      <td style={{ padding: "14px 20px", textAlign: "center", fontWeight: 600, color: "var(--text-primary)" }}>
                        {row.team === "✓" ? <span style={{ color: "var(--signal-healthy, #10b981)", fontWeight: 700 }}>✓</span> : row.team}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* FAQ Section */}
        <div style={{ maxWidth: 840, margin: "0 auto 64px" }}>
          <div style={{ textAlign: "center", marginBottom: 36 }}>
            <h2 style={{ fontSize: "1.8rem", fontWeight: 700, marginBottom: 8 }}>
              Frequently Asked Questions
            </h2>
            <p style={{ color: "var(--text-secondary)" }}>
              Have more questions? Visit our <Link href="/faq" style={{ color: "var(--brand, #3b82f6)" }}>full FAQ</Link> or contact support.
            </p>
          </div>

          <div style={{ display: "grid", gap: 16 }}>
            {faqs.map((faq, idx) => (
              <div
                key={idx}
                className="glass-card"
                style={{ padding: "20px 24px", borderRadius: 12 }}
              >
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, color: "var(--text-primary)" }}>
                  {faq.q}
                </h3>
                <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6, margin: 0 }}>
                  {faq.a}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Enterprise Callout */}
        <div
          className="glass-card"
          style={{
            padding: "40px 32px",
            borderRadius: 16,
            textAlign: "center",
            background: "linear-gradient(135deg, rgba(59, 130, 246, 0.08) 0%, rgba(139, 92, 246, 0.05) 100%)",
            border: "1px solid var(--border)",
          }}
        >
          <h2 style={{ fontSize: "1.6rem", fontWeight: 700, marginBottom: 10 }}>
            Need Dedicated VPC Collectors or Custom Retention?
          </h2>
          <p style={{ color: "var(--text-secondary)", maxWidth: 580, margin: "0 auto 24px", lineHeight: 1.5 }}>
            We support private isolated agent deployments, custom SOC2 compliance controls, and dedicated database architects for enterprise clusters.
          </p>
          <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/quickstart" className="btn-secondary" style={{ textDecoration: "none" }}>
              Explore Architecture
            </Link>
            <Link href="/security" className="btn-primary" style={{ textDecoration: "none" }}>
              Security Overview →
            </Link>
          </div>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
