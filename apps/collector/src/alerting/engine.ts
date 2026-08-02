import type { FastifyBaseLogger } from "fastify";
import { db, alerts, alertRules, monitoredDatabases } from "@pgvitals/db";
import { eq, and, isNull, desc } from "drizzle-orm";
import type { CollectionResult } from "../collector/connection-collector.js";
import type { GeneratedHint } from "../collector/rules-engine.js";
import { generateFingerprint, hintToAlertType } from "./fingerprint.js";
import { sendSlackAlert, type AlertPayload } from "./notifier.js";
import { sendEmailAlert, type EmailConfig } from "./email-notifier.js";

/* ===================================================================
   Alerting Engine — evaluates hints, deduplicates, fires alerts
   =================================================================== */

interface ChannelsConfig {
  slack?: { webhookUrl: string };
  email?: EmailConfig;
}

/**
 * Main entry point — runs after each collection cycle.
 * Evaluates generated hints against alert rules, deduplicates,
 * fires new alerts, and resolves stale ones.
 */
export async function evaluateAlerts(
  result: CollectionResult,
  hints: GeneratedHint[],
  log: FastifyBaseLogger
): Promise<void> {
  const { monitoredDbId } = result;

  // 1. Fetch enabled alert rules for this database
  const rules = await db
    .select()
    .from(alertRules)
    .where(
      and(
        eq(alertRules.monitoredDbId, monitoredDbId),
        eq(alertRules.enabled, true)
      )
    );

  if (rules.length === 0) {
    return; // No rules configured, nothing to evaluate
  }

  // Build a lookup: alertType -> rule
  const ruleMap = new Map(rules.map((r) => [r.alertType, r]));

  // Track which alert fingerprints are currently active (detected this cycle)
  const activeFingerprints = new Set<string>();

  // 2. Fetch the database record for notification context
  const [monitoredDb] = await db
    .select({ name: monitoredDatabases.name, environment: monitoredDatabases.environment })
    .from(monitoredDatabases)
    .where(eq(monitoredDatabases.id, monitoredDbId))
    .limit(1);

  if (!monitoredDb) return;

  // 3. Process each hint from the rules engine
  for (const hint of hints) {
    const alertType = hintToAlertType(hint.ruleType);
    if (!alertType) continue;

    const rule = ruleMap.get(alertType);
    if (!rule) continue;

    const fingerprint = generateFingerprint(monitoredDbId, hint);
    activeFingerprints.add(fingerprint);

    // Check for existing active alert with same fingerprint
    const [existingAlert] = await db
      .select()
      .from(alerts)
      .where(
        and(
          eq(alerts.fingerprint, fingerprint),
          eq(alerts.monitoredDbId, monitoredDbId),
          isNull(alerts.resolvedAt)
        )
      )
      .orderBy(desc(alerts.firedAt))
      .limit(1);

    const now = new Date();

    if (existingAlert) {
      // Alert already exists — check if we should re-notify
      const cooldownMs = rule.cooldownMinutes * 60_000;
      const lastNotified = existingAlert.lastNotifiedAt ?? existingAlert.firedAt;
      const timeSinceNotified = now.getTime() - new Date(lastNotified).getTime();

      if (timeSinceNotified >= cooldownMs) {
        // Cooldown elapsed — re-notify
        await db
          .update(alerts)
          .set({ lastNotifiedAt: now })
          .where(eq(alerts.id, existingAlert.id));

        await dispatchNotification(rule.channels as ChannelsConfig, {
          alertType,
          severity: hint.severity as "warning" | "critical",
          databaseName: monitoredDb.name,
          environment: monitoredDb.environment,
          rootCauseHint: hint.description,
          details: hint.metadata,
          firedAt: now.toISOString(),
        }, log);
      }
      // Otherwise within cooldown — skip
    } else {
      // New alert — insert and notify
      await db.insert(alerts).values({
        monitoredDbId,
        alertType,
        severity: hint.severity as "warning" | "critical",
        fingerprint,
        details: hint.metadata,
        rootCauseHint: hint.description,
        firedAt: now,
        lastNotifiedAt: now,
      });

      log.info(
        { monitoredDbId, alertType, fingerprint },
        "New alert fired"
      );

      await dispatchNotification(rule.channels as ChannelsConfig, {
        alertType,
        severity: hint.severity as "warning" | "critical",
        databaseName: monitoredDb.name,
        environment: monitoredDb.environment,
        rootCauseHint: hint.description,
        details: hint.metadata,
        firedAt: now.toISOString(),
      }, log);
    }
  }

  // 4. Resolve alerts that are no longer detected
  const unresolvedAlerts = await db
    .select()
    .from(alerts)
    .where(
      and(
        eq(alerts.monitoredDbId, monitoredDbId),
        isNull(alerts.resolvedAt)
      )
    );

  const now = new Date();
  for (const alert of unresolvedAlerts) {
    if (!activeFingerprints.has(alert.fingerprint)) {
      await db
        .update(alerts)
        .set({ resolvedAt: now })
        .where(eq(alerts.id, alert.id));

      log.info(
        { alertId: alert.id, fingerprint: alert.fingerprint },
        "Alert resolved"
      );
    }
  }
}

/**
 * Dispatches an alert to all configured notification channels.
 */
async function dispatchNotification(
  channels: ChannelsConfig,
  payload: AlertPayload,
  log: FastifyBaseLogger
): Promise<void> {
  // Slack
  if (channels?.slack?.webhookUrl) {
    await sendSlackAlert(channels.slack.webhookUrl, payload, log);
  }

  // Email
  if (channels?.email?.smtpHost && channels.email.toAddresses?.length > 0) {
    await sendEmailAlert(channels.email, payload, log);
  }
}
