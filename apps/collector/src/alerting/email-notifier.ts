import type { FastifyBaseLogger } from "fastify";
import nodemailer from "nodemailer";
import type { AlertPayload } from "./notifier.js";

/* ===================================================================
   Email Notification Service — sends alert emails via SMTP
   =================================================================== */

export interface EmailConfig {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  useTls: boolean;
  fromAddress: string;
  toAddresses: string[];
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

function formatDetails(details: Record<string, unknown>): string {
  return Object.entries(details)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px;color:#6B7280;font-size:13px;border-bottom:1px solid #F3F4F6">${k}</td><td style="padding:6px 12px;font-size:13px;font-weight:500;border-bottom:1px solid #F3F4F6">${String(v)}</td></tr>`
    )
    .join("");
}

function buildEmailHtml(
  alert: AlertPayload,
  headerColor: string,
  headerTitle: string,
  bodyContent: string,
): string {
  const timestamp = new Date(alert.firedAt).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F9FAFB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:600px;margin:24px auto;background:#FFFFFF;border-radius:12px;overflow:hidden;border:1px solid #E5E7EB">
  <!-- Header -->
  <div style="background:${headerColor};padding:20px 24px;color:#FFFFFF">
    <div style="font-size:18px;font-weight:700">${headerTitle}</div>
    <div style="font-size:13px;opacity:0.9;margin-top:4px">${alert.databaseName} · ${alert.environment}</div>
  </div>
  <!-- Body -->
  <div style="padding:24px">
    ${bodyContent}
    <!-- Footer -->
    <div style="margin-top:24px;padding-top:16px;border-top:1px solid #F3F4F6;font-size:12px;color:#9CA3AF">
      Detected at ${timestamp} · Sent by <strong>PG Vitals</strong>
    </div>
  </div>
</div>
</body>
</html>`;
}

/**
 * Sends an alert notification email via SMTP.
 */
export async function sendEmailAlert(
  config: EmailConfig,
  alert: AlertPayload,
  log: FastifyBaseLogger
): Promise<void> {
  const severityEmoji = alert.severity === "critical" ? "🔴" : "🟡";
  const severityLabel = alert.severity.toUpperCase();
  const headerColor = alert.severity === "critical" ? "#EF4444" : "#F59E0B";
  const alertTypeName = formatAlertType(alert.alertType);

  const subject = `[PG Vitals] ${severityEmoji} ${severityLabel}: ${alertTypeName} — ${alert.databaseName}`;

  const detailsRows = formatDetails(alert.details);
  const dashboardButton = alert.dashboardUrl
    ? `<div style="margin-top:20px"><a href="${alert.dashboardUrl}" style="display:inline-block;padding:10px 20px;background:#6366F1;color:#FFFFFF;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px">View Dashboard →</a></div>`
    : "";

  const bodyContent = `
    <!-- Root Cause -->
    <div style="background:#FEF3C7;border-left:3px solid ${headerColor};padding:12px 16px;border-radius:6px;margin-bottom:20px">
      <div style="font-size:12px;font-weight:600;color:#92400E;text-transform:uppercase;margin-bottom:4px">Root Cause</div>
      <div style="font-size:14px;color:#1F2937;line-height:1.5">${alert.rootCauseHint}</div>
    </div>
    ${detailsRows ? `
    <!-- Details -->
    <table style="width:100%;border-collapse:collapse;border:1px solid #F3F4F6;border-radius:6px;overflow:hidden">
      <thead><tr><th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#9CA3AF;background:#F9FAFB;border-bottom:1px solid #E5E7EB">Metric</th><th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#9CA3AF;background:#F9FAFB;border-bottom:1px solid #E5E7EB">Value</th></tr></thead>
      <tbody>${detailsRows}</tbody>
    </table>` : ""}
    ${dashboardButton}`;

  const html = buildEmailHtml(alert, headerColor, `${severityEmoji} ${severityLabel}: ${alertTypeName}`, bodyContent);

  try {
    const transport = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.useTls && config.smtpPort === 465,
      auth: config.smtpUser
        ? { user: config.smtpUser, pass: config.smtpPass }
        : undefined,
      tls: config.useTls ? { rejectUnauthorized: false } : undefined,
    });

    await transport.sendMail({
      from: config.fromAddress || config.smtpUser,
      to: config.toAddresses.join(", "),
      subject,
      html,
    });

    log.info(
      { alertType: alert.alertType, database: alert.databaseName, recipients: config.toAddresses.length },
      "Email alert sent"
    );
  } catch (err) {
    log.error(
      { err, alertType: alert.alertType },
      "Email alert delivery failed"
    );
  }
}

/**
 * Sends a test email to verify SMTP configuration.
 */
export async function sendTestEmailNotification(
  config: EmailConfig,
  databaseName: string,
  log: FastifyBaseLogger
): Promise<{ success: boolean; error?: string }> {
  const now = new Date().toISOString();

  const bodyContent = `
    <div style="font-size:15px;color:#1F2937;line-height:1.6">
      ✅ This is a test notification from <strong>PG Vitals</strong>.
      If you see this, your email integration is working correctly! 🎉
    </div>
    <div style="margin-top:16px;padding:12px 16px;background:#F0FDF4;border-radius:6px;border-left:3px solid #22C55E">
      <div style="font-size:13px;color:#15803D"><strong>Database:</strong> ${databaseName}</div>
      <div style="font-size:13px;color:#15803D;margin-top:2px"><strong>SMTP Host:</strong> ${config.smtpHost}:${config.smtpPort}</div>
      <div style="font-size:13px;color:#15803D;margin-top:2px"><strong>Recipients:</strong> ${config.toAddresses.join(", ")}</div>
    </div>`;

  const html = buildEmailHtml(
    {
      alertType: "test",
      severity: "warning",
      databaseName,
      environment: "test",
      rootCauseHint: "",
      details: {},
      firedAt: now,
    },
    "#6366F1",
    "🧪 PG Vitals — Test Notification",
    bodyContent
  );

  try {
    const transport = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.useTls && config.smtpPort === 465,
      auth: config.smtpUser
        ? { user: config.smtpUser, pass: config.smtpPass }
        : undefined,
      tls: config.useTls ? { rejectUnauthorized: false } : undefined,
    });

    await transport.sendMail({
      from: config.fromAddress || config.smtpUser,
      to: config.toAddresses.join(", "),
      subject: `[PG Vitals] 🧪 Test Notification — ${databaseName}`,
      html,
    });

    log.info("Test email notification sent successfully");
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    log.error({ err }, "Test email notification failed");
    return { success: false, error: message };
  }
}
