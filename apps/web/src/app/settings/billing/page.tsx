"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useApiToken } from "../../lib/useApiToken";

/* ===================================================================
   Billing Settings — plan management and Stripe integration
   =================================================================== */

interface BillingStatus {
  planTier: "free" | "pro" | "team";
  hasStripeCustomer: boolean;
  hasSubscription: boolean;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

const PLANS = [
  {
    tier: "free" as const,
    name: "Free",
    price: "$0",
    period: "",
    features: [
      "1 database",
      "Connection monitoring",
      "24-hour retention",
    ],
    notIncluded: [
      "Alerting",
      "Query performance",
      "Index advisor",
      "Vacuum advisor",
    ],
  },
  {
    tier: "pro" as const,
    name: "Pro",
    price: "$39",
    period: "/mo per database",
    features: [
      "Unlimited databases",
      "Full monitoring",
      "Alerting (Slack & email)",
      "30-day retention",
      "Index advisor",
      "Vacuum advisor",
      "Query performance",
    ],
    notIncluded: [],
  },
  {
    tier: "team" as const,
    name: "Team",
    price: "$99",
    period: "/mo per database",
    features: [
      "Everything in Pro",
      "90-day retention",
      "Log insights",
      "Multiple environments",
      "Priority support",
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

  return (
    <div>
      <div className="page-header">
        <h1>Billing</h1>
        <p>Manage your subscription and plan</p>
      </div>

      {/* Current Plan Banner */}
      <div className="glass-card animate-fade-in-up" style={{ padding: "var(--space-lg)", marginBottom: "var(--space-lg)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <span style={{ color: "var(--text-secondary)", fontSize: 14 }}>Current Plan</span>
            <h2 style={{ margin: "4px 0 0", color: "var(--brand)" }}>
              {currentTier.charAt(0).toUpperCase() + currentTier.slice(1)}
            </h2>
          </div>
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

      {/* Plan Cards */}
      <div className="billing-plans-grid">
        {PLANS.map((plan) => {
          const isCurrent = plan.tier === currentTier;
          const isUpgrade =
            (currentTier === "free" && (plan.tier === "pro" || plan.tier === "team")) ||
            (currentTier === "pro" && plan.tier === "team");

          return (
            <div
              key={plan.tier}
              className={`glass-card billing-plan-card ${isCurrent ? "billing-plan-current" : ""}`}
            >
              <div className="billing-plan-header">
                <h3>{plan.name}</h3>
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
                ) : isUpgrade ? (
                  <button
                    className="btn-primary"
                    onClick={() => handleUpgrade(plan.tier as "pro" | "team")}
                    disabled={actionLoading}
                  >
                    {actionLoading ? "Redirecting..." : `Upgrade to ${plan.name}`}
                  </button>
                ) : (
                  <button className="btn-secondary" disabled>
                    —
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
