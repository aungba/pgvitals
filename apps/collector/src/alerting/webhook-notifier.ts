import type { FastifyBaseLogger } from "fastify";
import type { AlertPayload } from "./notifier.js";
import * as crypto from "crypto";

/* ===================================================================
   Additional Alert Notifiers — PagerDuty, Microsoft Teams, Webhook
   Spec §2.2 — "Channels (later): PagerDuty, generic webhook, Teams"
   =================================================================== */

/* ---------- Generic Webhook ---------- */

/**
 * Sends an alert to a generic webhook endpoint.
 * Includes HMAC-SHA256 signature header if a shared secret is provided.
 * Retries once on 5xx.
 */
export async function sendWebhookAlert(
  webhookUrl: string,
  alert: AlertPayload,
  log: FastifyBaseLogger,
  secret?: string
): Promise<void> {
  const body = JSON.stringify({
    alert_type: alert.alertType,
    severity: alert.severity,
    database: alert.databaseName,
    environment: alert.environment,
    detected_at: alert.firedAt,
    details: alert.details,
    root_cause_hint: alert.rootCauseHint,
    dashboard_link: alert.dashboardUrl ?? null,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "PgVitals-Alert/1.0",
  };

  if (secret) {
    const signature = crypto
      .createHmac("sha256", secret)
      .update(body)
      .digest("hex");
    headers["X-PgVitals-Signature"] = `sha256=${signature}`;
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        log.info(
          { alertType: alert.alertType, database: alert.databaseName },
          "Webhook alert sent"
        );
        return;
      }

      if (response.status >= 500 && attempt === 0) {
        log.warn(
          { status: response.status, attempt },
          "Webhook returned 5xx, retrying once"
        );
        continue;
      }

      const text = await response.text();
      log.error(
        { status: response.status, body: text, alertType: alert.alertType },
        "Webhook delivery failed"
      );
      return;
    } catch (err) {
      if (attempt === 0) {
        log.warn({ err, attempt }, "Webhook request failed, retrying once");
        continue;
      }
      log.error(
        { err, alertType: alert.alertType },
        "Webhook request failed after retry"
      );
    }
  }
}

/* ---------- PagerDuty Events API v2 ---------- */

/**
 * Sends an alert to PagerDuty via the Events API v2.
 * https://developer.pagerduty.com/docs/events-api-v2/trigger-events/
 */
export async function sendPagerDutyAlert(
  routingKey: string,
  alert: AlertPayload,
  log: FastifyBaseLogger
): Promise<void> {
  const severityMap: Record<string, string> = {
    critical: "critical",
    warning: "warning",
  };

  const payload = {
    routing_key: routingKey,
    event_action: "trigger",
    payload: {
      summary: `[${alert.severity.toUpperCase()}] ${formatAlertType(alert.alertType)} on ${alert.databaseName}`,
      severity: severityMap[alert.severity] ?? "warning",
      source: "pgvitals",
      component: alert.databaseName,
      group: alert.environment,
      custom_details: {
        ...alert.details,
        root_cause_hint: alert.rootCauseHint,
        dashboard_url: alert.dashboardUrl,
        fired_at: alert.firedAt,
      },
    },
    links: alert.dashboardUrl
      ? [{ href: alert.dashboardUrl, text: "View in PgVitals" }]
      : [],
  };

  try {
    const response = await fetch(
      "https://events.pagerduty.com/v2/enqueue",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      log.error(
        { status: response.status, body: text, alertType: alert.alertType },
        "PagerDuty delivery failed"
      );
    } else {
      log.info(
        { alertType: alert.alertType, database: alert.databaseName },
        "PagerDuty alert sent"
      );
    }
  } catch (err) {
    log.error(
      { err, alertType: alert.alertType },
      "PagerDuty request failed"
    );
  }
}

/* ---------- Microsoft Teams (Adaptive Cards) ---------- */

/**
 * Sends an alert to Microsoft Teams via an Incoming Webhook.
 * Uses the Adaptive Card format (messageCard schema).
 */
export async function sendTeamsAlert(
  webhookUrl: string,
  alert: AlertPayload,
  log: FastifyBaseLogger
): Promise<void> {
  const color = alert.severity === "critical" ? "attention" : "warning";
  const severityEmoji = alert.severity === "critical" ? "🔴" : "🟡";
  const timestamp = new Date(alert.firedAt).toLocaleString();

  const card = {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body: [
            {
              type: "TextBlock",
              text: `${severityEmoji} **${alert.severity.toUpperCase()}: ${formatAlertType(alert.alertType)}**`,
              size: "Large",
              weight: "Bolder",
              color,
            },
            {
              type: "FactSet",
              facts: [
                { title: "Database", value: `${alert.databaseName} (${alert.environment})` },
                { title: "Detected At", value: timestamp },
              ],
            },
            {
              type: "TextBlock",
              text: `📋 **Root Cause:** ${alert.rootCauseHint}`,
              wrap: true,
            },
          ],
          actions: alert.dashboardUrl
            ? [
                {
                  type: "Action.OpenUrl",
                  title: "View Dashboard",
                  url: alert.dashboardUrl,
                },
              ]
            : [],
        },
      },
    ],
  };

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(card),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const text = await response.text();
      log.error(
        { status: response.status, body: text, alertType: alert.alertType },
        "Teams webhook delivery failed"
      );
    } else {
      log.info(
        { alertType: alert.alertType, database: alert.databaseName },
        "Teams alert sent"
      );
    }
  } catch (err) {
    log.error(
      { err, alertType: alert.alertType },
      "Teams webhook request failed"
    );
  }
}

function formatAlertType(type: string): string {
  const names: Record<string, string> = {
    idle_in_transaction: "Idle in Transaction",
    connection_hog: "Connection Hog",
    blocking_chain: "Blocking Chain",
    connection_exhaustion: "Connection Exhaustion",
    connection_spike: "Connection Spike",
    replication_lag: "Replication Lag",
    monitoring_failure: "Monitoring Failure",
    pool_exhaustion: "Pool Exhaustion",
  };
  return names[type] ?? type;
}
