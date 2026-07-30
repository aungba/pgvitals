"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import {
  getDatabase,
  getAlerts,
  getAlertRules,
  createAlertRule,
  updateAlertRule,
  testAlertNotification,
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
  const [ruleStates, setRuleStates] = useState<
    Record<
      string,
      { threshold: number; cooldown: number; enabled: boolean }
    >
  >({});

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
      const channels = webhookUrl
        ? { slack: { webhookUrl } }
        : {};

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

  const handleTest = async () => {
    if (!webhookUrl) return;
    setTestStatus(null);
    try {
      await testAlertNotification(id, webhookUrl);
      setTestStatus({ type: "success", message: "Test notification sent!" });
    } catch {
      setTestStatus({
        type: "error",
        message: "Failed to send test notification",
      });
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
          <a
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
          </a>
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
            onClick={handleTest}
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
      <AlertHistory alerts={alertList} />
    </div>
  );
}
