"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  getDatabase,
  getAlerts,
  getAlertRules,
  createAlertRule,
  updateAlertRule,
  testAlertNotification,
  submitAlertFeedback,
} from "../../../lib/api";
import type { Database, Alert, AlertRule } from "../../../lib/api";
import AlertHistory from "../../../components/AlertHistory";

/* ===================================================================
   Alert Management Page — configure rules + view alert history
   =================================================================== */

const ALERT_TYPES = [
  {
    type: "idle_in_transaction",
    name: "Idle in Transaction",
    description:
      "Alert when a session stays in 'idle in transaction' state beyond the threshold duration.",
    unit: "seconds",
    defaultThreshold: 300,
  },
  {
    type: "connection_hog",
    name: "Connection Hog",
    description:
      "Alert when a single application consumes more than the threshold percentage of max connections.",
    unit: "percent",
    defaultThreshold: 70,
  },
  {
    type: "blocking_chain",
    name: "Blocking Chain",
    description:
      "Alert when a query is blocked by another transaction for longer than the threshold duration.",
    unit: "seconds",
    defaultThreshold: 30,
  },
  {
    type: "connection_exhaustion",
    name: "Connection Exhaustion",
    description:
      "Alert when total connections exceed the threshold percentage of max_connections.",
    unit: "percent",
    defaultThreshold: 80,
  },
  {
    type: "connection_spike",
    name: "Connection Spike",
    description:
      "Alert when connection count suddenly increases by more than the threshold percentage from the previous snapshot.",
    unit: "percent",
    defaultThreshold: 50,
  },
];

export default function AlertsPage() {
  const params = useParams();
  const id = params.id as string;

  const [database, setDatabase] = useState<Database | null>(null);
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [alertList, setAlertList] = useState<Alert[]>([]);
  const [filter, setFilter] = useState<"all" | "active" | "resolved">("all");
  const [loading, setLoading] = useState(true);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [useTls, setUseTls] = useState(true);
  const [fromAddress, setFromAddress] = useState("");
  const [toAddresses, setToAddresses] = useState("");
  const [ruleStates, setRuleStates] = useState<
    Record<
      string,
      { threshold: number; cooldown: number; enabled: boolean }
    >
  >({});
  const [pagerdutyKey, setPagerdutyKey] = useState("");
  const [teamsWebhookUrl, setTeamsWebhookUrl] = useState("");
  const [genericWebhookUrl, setGenericWebhookUrl] = useState("");
  const [genericWebhookSecret, setGenericWebhookSecret] = useState("");

  const fetchData = useCallback(async () => {
    try {
      const [db, rls, als] = await Promise.all([
        getDatabase(id),
        getAlertRules(id),
        getAlerts(id, filter),
      ]);
      setDatabase(db);
      setRules(rls);
      setAlertList(als);

      // Extract webhook URL from first rule that has one
      const withSlack = rls.find((r) => r.channels?.slack?.webhookUrl);
      if (withSlack?.channels?.slack?.webhookUrl) {
        setWebhookUrl(withSlack.channels.slack.webhookUrl);
      }

      // Extract email config from first rule that has one
      const withEmail = rls.find((r) => r.channels?.email?.smtpHost);
      if (withEmail?.channels?.email) {
        setEmailEnabled(true);
        setSmtpHost(withEmail.channels.email.smtpHost);
        setSmtpPort(withEmail.channels.email.smtpPort);
        setSmtpUser(withEmail.channels.email.smtpUser);
        setSmtpPass(withEmail.channels.email.smtpPass);
        setUseTls(withEmail.channels.email.useTls);
        setFromAddress(withEmail.channels.email.fromAddress);
        setToAddresses(withEmail.channels.email.toAddresses.join(", "));
      }

      // Initialize rule states
      const states: typeof ruleStates = {};
      for (const at of ALERT_TYPES) {
        const existing = rls.find((r) => r.alertType === at.type);
        states[at.type] = {
          threshold: existing?.thresholdValue ?? at.defaultThreshold,
          cooldown: existing?.cooldownMinutes ?? 15,
          enabled: existing?.enabled ?? true,
        };
      }
      setRuleStates(states);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [id, filter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh alerts
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const als = await getAlerts(id, filter);
        setAlertList(als);
      } catch {
        // ignore
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, [id, filter]);

  const handleSaveRule = async (alertType: string) => {
    const state = ruleStates[alertType];
    if (!state) return;

    setSaving(alertType);
    try {
      const existing = rules.find((r) => r.alertType === alertType);
      const channels: Record<string, unknown> = {};
      if (webhookUrl) {
        channels.slack = { webhookUrl };
      }
      if (emailEnabled && smtpHost && toAddresses) {
        channels.email = {
          smtpHost,
          smtpPort,
          smtpUser,
          smtpPass,
          useTls,
          fromAddress,
          toAddresses: toAddresses.split(",").map((s: string) => s.trim()).filter(Boolean),
        };
      }
      if (pagerdutyKey) {
        channels.pagerduty = { routingKey: pagerdutyKey };
      }
      if (teamsWebhookUrl) {
        channels.teams = { webhookUrl: teamsWebhookUrl };
      }
      if (genericWebhookUrl) {
        channels.webhook = { url: genericWebhookUrl, secret: genericWebhookSecret || undefined };
      }

      if (existing) {
        await updateAlertRule(id, existing.id, {
          thresholdValue: state.threshold,
          cooldownMinutes: state.cooldown,
          enabled: state.enabled,
          channels,
        });
      } else {
        await createAlertRule(id, {
          alertType,
          thresholdValue: state.threshold,
          cooldownMinutes: state.cooldown,
          enabled: state.enabled,
          channels,
        });
      }
      await fetchData();
    } catch {
      // ignore
    } finally {
      setSaving(null);
    }
  };

  const handleTestSlack = async () => {
    if (!webhookUrl) return;
    setTestStatus(null);
    try {
      await testAlertNotification(id, { webhookUrl });
      setTestStatus({ type: "success", message: "Slack test sent!" });
    } catch {
      setTestStatus({ type: "error", message: "Failed to send Slack test" });
    }
    setTimeout(() => setTestStatus(null), 4000);
  };

  const handleTestEmail = async () => {
    if (!smtpHost || !toAddresses) return;
    setTestStatus(null);
    try {
      await testAlertNotification(id, {
        emailConfig: {
          smtpHost, smtpPort, smtpUser, smtpPass, useTls, fromAddress,
          toAddresses: toAddresses.split(",").map((s: string) => s.trim()).filter(Boolean),
        },
      });
      setTestStatus({ type: "success", message: "Email test sent!" });
    } catch {
      setTestStatus({ type: "error", message: "Failed to send email test" });
    }
    setTimeout(() => setTestStatus(null), 4000);
  };

  const updateRuleState = (
    alertType: string,
    field: "threshold" | "cooldown" | "enabled",
    value: number | boolean
  ) => {
    setRuleStates((prev) => ({
      ...prev,
      [alertType]: { ...prev[alertType], [field]: value },
    }));
  };

  if (loading) {
    return (
      <div className="animate-fade-in">
        <div className="skeleton" style={{ width: 300, height: 32, marginBottom: 16 }} />
        <div className="skeleton" style={{ width: 160, height: 18, marginBottom: 40 }} />
        <div className="skeleton" style={{ height: 400, borderRadius: "var(--radius-lg)" }} />
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="detail-header">
        <div className="detail-header-left">
          <Link
            href={`/databases/${id}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 36,
              height: 36,
              borderRadius: "var(--radius-md)",
              background: "var(--surface-alt)",
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
              fontSize: "1rem",
              transition: "all var(--transition-fast)",
              flexShrink: 0,
            }}
            title="Back to database"
          >
            ←
          </Link>
          <div>
            <h1>Alerts — {database?.name}</h1>
            <p className="text-secondary" style={{ fontSize: "0.9rem" }}>
              Configure alert rules and notification channels
            </p>
          </div>
        </div>
      </div>

      {/* Slack Webhook Config */}
      <div className="section-title">Notification Channel</div>
      <div
        className="glass-card-static"
        style={{
          padding: "var(--space-lg)",
          marginBottom: "var(--space-xl)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: "var(--space-md)",
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: 1, minWidth: 280 }}>
            <label className="form-label">Slack Webhook URL</label>
            <input
              type="url"
              className="form-input"
              placeholder="https://hooks.slack.com/services/..."
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
            />
          </div>
          <button
            className="btn-secondary"
            onClick={handleTestSlack}
            disabled={!webhookUrl}
            style={{ height: 44 }}
          >
            🧪 Test
          </button>
        </div>
        {testStatus && (
          <div
            className={`alert ${
              testStatus.type === "success" ? "alert-success" : "alert-error"
            }`}
            style={{ marginTop: "var(--space-md)", marginBottom: 0 }}
          >
            <span>{testStatus.type === "success" ? "✅" : "⚠️"}</span>
            <span>{testStatus.message}</span>
          </div>
        )}
      </div>

      {/* Email SMTP Config */}
      <div className="section-title" style={{ marginTop: "var(--space-lg)" }}>Email Notifications</div>
      <div
        className="glass-card-static"
        style={{
          padding: "var(--space-lg)",
          marginBottom: "var(--space-xl)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-md)", marginBottom: "var(--space-md)" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={emailEnabled}
              onChange={(e) => setEmailEnabled(e.target.checked)}
              style={{ width: 18, height: 18, accentColor: "var(--brand)" }}
            />
            <span style={{ fontWeight: 500 }}>Enable Email Alerts</span>
          </label>
        </div>
        {emailEnabled && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-md)" }}>
            <div>
              <label className="form-label">SMTP Host</label>
              <input
                type="text"
                className="form-input"
                placeholder="smtp.gmail.com"
                value={smtpHost}
                onChange={(e) => setSmtpHost(e.target.value)}
              />
            </div>
            <div>
              <label className="form-label">SMTP Port</label>
              <input
                type="number"
                className="form-input"
                placeholder="587"
                value={smtpPort}
                onChange={(e) => setSmtpPort(parseInt(e.target.value, 10) || 587)}
              />
            </div>
            <div>
              <label className="form-label">Username</label>
              <input
                type="text"
                className="form-input"
                placeholder="alerts@yourcompany.com"
                value={smtpUser}
                onChange={(e) => setSmtpUser(e.target.value)}
              />
            </div>
            <div>
              <label className="form-label">Password</label>
              <input
                type="password"
                className="form-input"
                placeholder="••••••••"
                value={smtpPass}
                onChange={(e) => setSmtpPass(e.target.value)}
              />
            </div>
            <div>
              <label className="form-label">From Address</label>
              <input
                type="email"
                className="form-input"
                placeholder="alerts@yourcompany.com"
                value={fromAddress}
                onChange={(e) => setFromAddress(e.target.value)}
              />
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 12 }}>
                <input
                  type="checkbox"
                  checked={useTls}
                  onChange={(e) => setUseTls(e.target.checked)}
                  style={{ width: 18, height: 18, accentColor: "var(--brand)" }}
                />
                <span style={{ fontSize: "0.9rem" }}>Use TLS</span>
              </label>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="form-label">Recipients (comma-separated)</label>
              <input
                type="text"
                className="form-input"
                placeholder="dba@company.com, team@company.com"
                value={toAddresses}
                onChange={(e) => setToAddresses(e.target.value)}
              />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <button
                className="btn-secondary"
                onClick={handleTestEmail}
                disabled={!smtpHost || !toAddresses}
                style={{ height: 44 }}
              >
                📧 Send Test Email
              </button>
            </div>
          </div>
        )}
        {testStatus && (
          <div
            className={`alert ${
              testStatus.type === "success" ? "alert-success" : "alert-error"
            }`}
            style={{ marginTop: "var(--space-md)", marginBottom: 0 }}
          >
            <span>{testStatus.type === "success" ? "✅" : "⚠️"}</span>
            <span>{testStatus.message}</span>
          </div>
        )}
      </div>

      {/* Additional Channels */}
      <div className="section-title">Additional Channels</div>
      <div className="glass-card-static" style={{ padding: "var(--space-lg)", marginBottom: "var(--space-xl)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "var(--space-lg)" }}>
          {/* PagerDuty */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: "1.1rem" }}>🔔</span>
              <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>PagerDuty</span>
            </div>
            <div className="form-group">
              <label className="form-label">Routing Key</label>
              <input
                type="text"
                className="form-input"
                placeholder="PagerDuty Events API v2 routing key"
                value={pagerdutyKey}
                onChange={(e) => setPagerdutyKey(e.target.value)}
              />
            </div>
          </div>

          {/* Microsoft Teams */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: "1.1rem" }}>💬</span>
              <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>Microsoft Teams</span>
            </div>
            <div className="form-group">
              <label className="form-label">Webhook URL</label>
              <input
                type="url"
                className="form-input"
                placeholder="https://outlook.office.com/webhook/..."
                value={teamsWebhookUrl}
                onChange={(e) => setTeamsWebhookUrl(e.target.value)}
              />
            </div>
          </div>

          {/* Generic Webhook */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: "1.1rem" }}>🔗</span>
              <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>Generic Webhook</span>
            </div>
            <div className="form-group" style={{ marginBottom: 8 }}>
              <label className="form-label">Webhook URL</label>
              <input
                type="url"
                className="form-input"
                placeholder="https://your-service.com/webhook"
                value={genericWebhookUrl}
                onChange={(e) => setGenericWebhookUrl(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Signing Secret (optional)</label>
              <input
                type="password"
                className="form-input"
                placeholder="HMAC-SHA256 shared secret"
                value={genericWebhookSecret}
                onChange={(e) => setGenericWebhookSecret(e.target.value)}
              />
            </div>
          </div>
        </div>
        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "var(--space-md)" }}>
          Channel settings are saved when you save any alert rule above.
        </div>
      </div>

      {/* Alert Rules */}
      <div className="section-title">Alert Rules</div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          gap: "var(--space-md)",
          marginBottom: "var(--space-xl)",
        }}
        className="stagger-children"
      >
        {ALERT_TYPES.map((at) => {
          const state = ruleStates[at.type];
          if (!state) return null;
          const isSaving = saving === at.type;

          return (
            <div key={at.type} className="glass-card-static alert-rule-card">
              {/* Header */}
              <div className="alert-rule-card-header">
                <div>
                  <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>
                    {at.name}
                  </div>
                  <div
                    style={{
                      fontSize: "0.8rem",
                      color: "var(--text-muted)",
                      marginTop: 4,
                    }}
                  >
                    {at.description}
                  </div>
                </div>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={state.enabled}
                    onChange={(e) =>
                      updateRuleState(at.type, "enabled", e.target.checked)
                    }
                  />
                  <span className="toggle-slider" />
                </label>
              </div>

              {/* Inputs */}
              <div className="alert-rule-card-body">
                <div className="form-group" style={{ marginBottom: "var(--space-sm)" }}>
                  <label className="form-label">
                    Threshold ({at.unit === "seconds" ? "seconds" : "%"})
                  </label>
                  <input
                    type="number"
                    className="form-input"
                    value={state.threshold}
                    onChange={(e) =>
                      updateRuleState(
                        at.type,
                        "threshold",
                        parseInt(e.target.value, 10) || 0
                      )
                    }
                    min={0}
                    style={{ height: 38 }}
                  />
                </div>
                <div className="form-group" style={{ marginBottom: "var(--space-sm)" }}>
                  <label className="form-label">Cooldown (minutes)</label>
                  <input
                    type="number"
                    className="form-input"
                    value={state.cooldown}
                    onChange={(e) =>
                      updateRuleState(
                        at.type,
                        "cooldown",
                        parseInt(e.target.value, 10) || 0
                      )
                    }
                    min={1}
                    style={{ height: 38 }}
                  />
                </div>
              </div>

              {/* Save */}
              <div style={{ padding: "0 var(--space-lg) var(--space-lg)" }}>
                <button
                  className="btn-primary"
                  onClick={() => handleSaveRule(at.type)}
                  disabled={isSaving}
                  style={{
                    width: "100%",
                    height: 38,
                    fontSize: "0.85rem",
                    minWidth: 0,
                  }}
                >
                  {isSaving ? "Saving…" : "Save Rule"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Alert History */}
      <div className="section-title">
        Alert History
        <div className="tab-bar" style={{ display: "inline-flex", marginLeft: "var(--space-md)" }}>
          {(["all", "active", "resolved"] as const).map((f) => (
            <button
              key={f}
              className={`tab-button ${filter === f ? "active" : ""}`}
              onClick={() => setFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <AlertHistory
        alerts={alertList}
        onFeedback={async (alertId, feedback) => {
          try {
            await submitAlertFeedback(alertId, feedback);
            // Optimistic update
            setAlertList((prev) =>
              prev.map((a) =>
                a.id === alertId
                  ? { ...a, feedback, feedbackAt: new Date().toISOString() }
                  : a
              )
            );
          } catch {
            // Silently fail — feedback is non-critical
          }
        }}
      />
    </div>
  );
}
