import type { FastifyBaseLogger } from "fastify";

/* ===================================================================
   Slack Notification Service — sends alert messages via webhook
   =================================================================== */

export interface AlertPayload {
  alertType: string;
  severity: "warning" | "critical";
  databaseName: string;
  environment: string;
  rootCauseHint: string;
  details: Record<string, unknown>;
  dashboardUrl?: string;
  firedAt: string;
}

/**
 * Sends an alert notification to a Slack incoming webhook.
 * Uses Block Kit formatting for rich, color-coded messages.
 */
export async function sendSlackAlert(
  webhookUrl: string,
  alert: AlertPayload,
  log: FastifyBaseLogger
): Promise<void> {
  const severityEmoji = alert.severity === "critical" ? "🔴" : "🟡";
  const severityLabel = alert.severity.toUpperCase();
  const color = alert.severity === "critical" ? "#EF4444" : "#F59E0B";

  const alertTypeName = formatAlertType(alert.alertType);
  const timestamp = new Date(alert.firedAt).toLocaleString();

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${severityEmoji} *${severityLabel}: ${alertTypeName}*\n*Database:* ${alert.databaseName} (${alert.environment})`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `📋 *Root Cause:*\n${alert.rootCauseHint}`,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `⏱️ Detected at ${timestamp}`,
        },
      ],
    },
  ];

  // Add dashboard link button if URL is available
  if (alert.dashboardUrl) {
    blocks.push({
      type: "actions" as "section",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "View Dashboard",
          },
          url: alert.dashboardUrl,
          style: "primary",
        },
      ] as unknown as Array<{ type: "mrkdwn"; text: string }>,
    });
  }

  const payload = {
    attachments: [
      {
        color,
        blocks,
      },
    ],
  };

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      log.error(
        { status: response.status, body: text, alertType: alert.alertType },
        "Slack webhook delivery failed"
      );
    } else {
      log.info(
        { alertType: alert.alertType, database: alert.databaseName },
        "Slack alert sent"
      );
    }
  } catch (err) {
    log.error(
      { err, alertType: alert.alertType },
      "Slack webhook request failed"
    );
  }
}

/**
 * Sends a test notification to verify a Slack webhook URL.
 */
export async function sendTestNotification(
  webhookUrl: string,
  databaseName: string,
  log: FastifyBaseLogger
): Promise<{ success: boolean; error?: string }> {
  const testPayload: AlertPayload = {
    alertType: "connection_exhaustion",
    severity: "warning",
    databaseName,
    environment: "test",
    rootCauseHint:
      "This is a test notification from PG Vitals. If you see this, your Slack integration is working correctly! 🎉",
    details: { test: true },
    firedAt: new Date().toISOString(),
  };

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attachments: [
          {
            color: "#6366F1",
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `🧪 *PG Vitals — Test Notification*\n*Database:* ${testPayload.databaseName}\n\n✅ ${testPayload.rootCauseHint}`,
                },
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      log.error({ status: response.status, body: text }, "Test notification failed");
      return { success: false, error: `Slack returned ${response.status}: ${text}` };
    }

    log.info("Test Slack notification sent successfully");
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    log.error({ err }, "Test notification request failed");
    return { success: false, error: message };
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
