"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useApiToken } from "../../lib/useApiToken";

/* ===================================================================
   Billing Settings — plan management and Stripe integration
   =================================================================== */

import { BillingStatus, getBillingStatus } from "../../lib/api";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

const PLANS = [
  {
    tier: "free" as const,
    name: "Free Forever",
    price: "$0",
    period: "forever",
    description: "Essential Postgres vitals for 1 database",
    features: [
      "1 database monitored",
      "Live connection gauge & session inspector",
      "24-hour metric retention",
      "Basic vacuum & table health overview",
    ],
    notIncluded: [
      "Multi-database capacity (2+ DBs)",
      "Multi-channel alerting (Slack, PagerDuty, Email)",
      "Index advisor & HypoPG simulation",
      "EXPLAIN plan diff visualizer & regression engine",
      "30-day historical trend rollups",
    ],
  },
  {
    tier: "pro" as const,
    name: "Pro",
    price: "$39",
    period: "/mo (up to 5 databases)",
    description: "Complete DBA Sentinel suite for development & production fleets",
    badge: "Most Popular",
    features: [
      "Up to 5 databases monitored",
      "Full DBA Sentinel suite (Deadlocks, XID, Bloat)",
      "HypoPG hypothetical index simulation",
      "Plan regression & side-by-side EXPLAIN visualizer",
      "Multi-channel alerts & 1-click Slack ChatOps",
      "30-day continuous metric rollups",
      "Tail latencies (P95/P99) & storage I/O diagnostics",
    ],
    notIncluded: [],
  },
  {
    tier: "team" as const,
    name: "Team",
    price: "$99",
    period: "/mo (unlimited databases)",
    description: "For scaling engineering organizations and multi-dev teams",
    features: [
      "Unlimited databases monitored",
      "Everything in Pro",
      "Unlimited team members & RBAC",
      "90-day continuous metric rollups",
      "Priority engineering support",
    ],
    notIncluded: [],
  },
];

export default function BillingPage() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const { getToken, isReady } = useApiToken();

  const fetchStatus = useCallback(async () => {
    if (!isReady) return;
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/billing/status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        setStatus(await res.json());
      }
    } catch (err) {
      console.error("Failed to fetch billing status", err);
    } finally {
      setLoading(false);
    }
  }, [getToken, isReady]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleUpgrade = async (tier: "pro" | "team") => {
    setActionLoading(true);
    try {
      const token = await getToken();
      const priceId = tier === "team"
        ? process.env.NEXT_PUBLIC_STRIPE_TEAM_PRICE_ID
        : process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID;

      const res = await fetch(`${API_URL}/api/billing/checkout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          priceId,
          successUrl: `${window.location.origin}/settings/billing?success=true`,
          cancelUrl: `${window.location.origin}/settings/billing`,
        }),
      });

      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      console.error("Failed to create checkout session", err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleManageBilling = async () => {
    setActionLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/billing/portal`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          returnUrl: `${window.location.origin}/settings/billing`,
        }),
      });

      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      console.error("Failed to create portal session", err);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <h1>Billing</h1>
          <p>Manage your subscription and plan</p>
        </div>
        <div className="glass-card" style={{ padding: "var(--space-xl)" }}>
          <div className="skeleton" style={{ width: "40%", height: 24, marginBottom: 16 }} />
          <div className="skeleton" style={{ width: "60%", height: 16 }} />
        </div>
      </div>
    );
  }

  const currentTier = status?.planTier ?? "free";
  const isTrial = !!status?.isTrialActive;

  return (
    <div>
      <div className="page-header">
        <h1>Billing & Plans</h1>
        <p>Manage your subscription, database capacity, and DBA features</p>
      </div>

      {/* Trial Alert Banner if active */}
      {isTrial && (
        <div
          className="glass-card animate-fade-in-up"
          style={{
            padding: "var(--space-lg)",
            marginBottom: "var(--space-lg)",
            borderLeft: "4px solid var(--brand, #3b82f6)",
            background: "linear-gradient(90deg, rgba(59, 130, 246, 0.08) 0%, transparent 100%)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "18px" }}>⚡</span>
                <strong style={{ fontSize: "16px" }}>14-Day Free Pro Trial Active</strong>
                <span className="badge badge-primary" style={{ padding: "2px 8px", borderRadius: "12px", fontSize: "12px" }}>
                  {status.trialDaysRemaining ?? 14} days remaining
                </span>
              </div>
              <p style={{ margin: "6px 0 0", color: "var(--text-secondary)", fontSize: "14px" }}>
                You have full access to all Pro DBA sentinel features. Your trial includes capacity for <strong>up to 2 databases</strong>.
              </p>
            </div>
            <button
              className="btn-primary"
              onClick={() => handleUpgrade("pro")}
              disabled={actionLoading}
            >
              {actionLoading ? "Redirecting..." : "Upgrade to Pro ($39/mo)"}
            </button>
          </div>
        </div>
      )}

      {/* Current Plan & Capacity Card */}
      <div className="glass-card animate-fade-in-up" style={{ padding: "var(--space-lg)", marginBottom: "var(--space-lg)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
          <div>
            <span style={{ color: "var(--text-secondary)", fontSize: 14 }}>Current Plan</span>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "4px" }}>
              <h2 style={{ margin: 0, color: "var(--brand)" }}>
                {isTrial ? "Pro Trial" : currentTier.charAt(0).toUpperCase() + currentTier.slice(1)}
              </h2>
              {isTrial && (
                <span className="badge" style={{ background: "var(--brand-muted, rgba(59,130,246,0.15))", color: "var(--brand)" }}>
                  Trial Mode
                </span>
              )}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
            {status && (
              <div style={{ textAlign: "right" }}>
                <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>Database Capacity</span>
                <div style={{ fontWeight: 600, fontSize: 15, marginTop: 2 }}>
                  {status.currentDbCount} / {status.maxDatabases === Infinity ? "Unlimited" : `${status.maxDatabases} DBs`}
                </div>
              </div>
            )}

            {status?.hasSubscription && (
              <button
                className="btn-secondary"
                onClick={handleManageBilling}
                disabled={actionLoading}
              >
                Manage Billing
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Plan Cards */}
      <div className="billing-plans-grid">
        {PLANS.map((plan) => {
          const isCurrent = !isTrial && plan.tier === currentTier;
          const isUpgrade =
            (currentTier === "free" && (plan.tier === "pro" || plan.tier === "team")) ||
            (currentTier === "pro" && plan.tier === "team");

          return (
            <div
              key={plan.tier}
              className={`glass-card billing-plan-card ${isCurrent ? "billing-plan-current" : ""}`}
              style={plan.tier === "pro" ? { borderColor: "var(--brand)", position: "relative" } : {}}
            >
              {plan.tier === "pro" && (
                <div
                  style={{
                    position: "absolute",
                    top: "-10px",
                    right: "16px",
                    background: "var(--brand, #3b82f6)",
                    color: "#fff",
                    fontSize: "11px",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    padding: "2px 8px",
                    borderRadius: "999px",
                    letterSpacing: "0.05em",
                  }}
                >
                  Most Popular
                </div>
              )}

              <div className="billing-plan-header">
                <h3>{plan.name}</h3>
                <p style={{ fontSize: "13px", color: "var(--text-secondary)", margin: "4px 0 12px" }}>
                  {plan.description}
                </p>
                <div className="billing-plan-price">
                  <span className="billing-price-amount">{plan.price}</span>
                  {plan.period && (
                    <span className="billing-price-period">{plan.period}</span>
                  )}
                </div>
              </div>

              <ul className="billing-plan-features">
                {plan.features.map((f) => (
                  <li key={f} className="billing-feature-included">
                    <span className="billing-feature-icon">✓</span> {f}
                  </li>
                ))}
                {plan.notIncluded.map((f) => (
                  <li key={f} className="billing-feature-excluded">
                    <span className="billing-feature-icon">—</span> {f}
                  </li>
                ))}
              </ul>

              <div className="billing-plan-action">
                {isCurrent ? (
                  <button className="btn-secondary" disabled>
                    Current Plan
                  </button>
                ) : (
                  <button
                    className={plan.tier === "pro" ? "btn-primary" : "btn-secondary"}
                    onClick={() => handleUpgrade(plan.tier as "pro" | "team")}
                    disabled={actionLoading || plan.tier === "free"}
                  >
                    {actionLoading
                      ? "Redirecting..."
                      : plan.tier === "free"
                        ? "Included by Default"
                        : `Get ${plan.name}`}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
