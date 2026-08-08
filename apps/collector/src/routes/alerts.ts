import type { FastifyInstance } from "fastify";
import { db, alerts, alertRules, monitoredDatabases } from "@pgvitals/db";
import { eq, and, isNull, desc } from "drizzle-orm";
import { sendTestNotification } from "../alerting/notifier.js";
import { sendTestEmailNotification, type EmailConfig } from "../alerting/email-notifier.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { requireFeature } from "../middleware/plan-limits.js";

/* ===================================================================
   Alert Routes — CRUD for alerts and alert rules
   =================================================================== */

/**
 * Verifies that the given database belongs to the given organization.
 */
async function verifyDbOwnership(dbId: string, orgId: string): Promise<boolean> {
  const [mdb] = await db
    .select({ id: monitoredDatabases.id })
    .from(monitoredDatabases)
    .where(and(eq(monitoredDatabases.id, dbId), eq(monitoredDatabases.orgId, orgId)))
    .limit(1);
  return !!mdb;
}

export default async function alertRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/databases/:id/alerts — List alerts for a database.
   * Query: ?status=active|resolved|all (default: all) &limit=50
   */
  app.get<{ Params: { id: string }; Querystring: { status?: string; limit?: string } }>(
    "/api/databases/:id/alerts",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const status = request.query.status ?? "all";
        const limit = Math.min(parseInt(request.query.limit ?? "50", 10), 200);

        // Verify database belongs to this org
        if (!await verifyDbOwnership(id, request.auth.orgId)) {
          return reply.status(404).send({ error: "Database not found" });
        }

        let query = db
          .select()
          .from(alerts)
          .where(
            status === "active"
              ? and(eq(alerts.monitoredDbId, id), isNull(alerts.resolvedAt))
              : status === "resolved"
                ? and(eq(alerts.monitoredDbId, id), alerts.resolvedAt !== null ? eq(alerts.monitoredDbId, id) : eq(alerts.monitoredDbId, id))
                : eq(alerts.monitoredDbId, id)
          )
          .orderBy(desc(alerts.firedAt))
          .limit(limit);

        // For "resolved" status, we need a different approach
        let results;
        if (status === "resolved") {
          results = await db
            .select()
            .from(alerts)
            .where(eq(alerts.monitoredDbId, id))
            .orderBy(desc(alerts.firedAt))
            .limit(limit);
          results = results.filter((a) => a.resolvedAt !== null);
        } else {
          results = await query;
        }

        return reply.send({ alerts: results });
      } catch (err) {
        request.log.error({ err }, "Failed to list alerts");
        return reply.status(500).send({ error: "Failed to list alerts" });
      }
    }
  );

  /**
   * GET /api/databases/:id/alerts/active — List unresolved alerts only.
   */
  app.get<{ Params: { id: string } }>(
    "/api/databases/:id/alerts/active",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      try {
        const { id } = request.params;

        // Verify database belongs to this org
        if (!await verifyDbOwnership(id, request.auth.orgId)) {
          return reply.status(404).send({ error: "Database not found" });
        }

        const activeAlerts = await db
          .select()
          .from(alerts)
          .where(
            and(eq(alerts.monitoredDbId, id), isNull(alerts.resolvedAt))
          )
          .orderBy(desc(alerts.firedAt));

        return reply.send({ alerts: activeAlerts });
      } catch (err) {
        request.log.error({ err }, "Failed to list active alerts");
        return reply.status(500).send({ error: "Failed to list active alerts" });
      }
    }
  );

  /**
   * GET /api/databases/:id/alert-rules — Get all alert rules for a database.
   */
  app.get<{ Params: { id: string } }>(
    "/api/databases/:id/alert-rules",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      try {
        const { id } = request.params;

        // Verify database belongs to this org
        if (!await verifyDbOwnership(id, request.auth.orgId)) {
          return reply.status(404).send({ error: "Database not found" });
        }

        const rules = await db
          .select()
          .from(alertRules)
          .where(eq(alertRules.monitoredDbId, id));

        return reply.send({ rules });
      } catch (err) {
        request.log.error({ err }, "Failed to list alert rules");
        return reply.status(500).send({ error: "Failed to list alert rules" });
      }
    }
  );

  /**
   * POST /api/databases/:id/alert-rules — Create or update an alert rule (upsert by alert_type).
   */
  app.post<{
    Params: { id: string };
    Body: {
      alertType: string;
      thresholdValue: number;
      cooldownMinutes?: number;
      enabled?: boolean;
      channels?: { slack?: { webhookUrl: string } };
    };
  }>(
    "/api/databases/:id/alert-rules",
    { preHandler: [authMiddleware, requireRole('owner', 'admin'), requireFeature('alertingEnabled')] },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const { alertType, thresholdValue, cooldownMinutes, enabled, channels } =
          request.body;

        if (!alertType || thresholdValue == null) {
          return reply
            .status(400)
            .send({ error: "alertType and thresholdValue are required" });
        }

        // Verify database belongs to this org
        if (!await verifyDbOwnership(id, request.auth.orgId)) {
          return reply.status(404).send({ error: "Database not found" });
        }

        // Check if rule already exists for this db + alertType
        const [existing] = await db
          .select()
          .from(alertRules)
          .where(
            and(
              eq(alertRules.monitoredDbId, id),
              eq(alertRules.alertType, alertType as typeof alertRules.alertType.enumValues[number])
            )
          )
          .limit(1);

        const now = new Date();

        if (existing) {
          // Update existing rule
          const [updated] = await db
            .update(alertRules)
            .set({
              thresholdValue,
              cooldownMinutes: cooldownMinutes ?? existing.cooldownMinutes,
              enabled: enabled ?? existing.enabled,
              channels: channels ?? existing.channels,
              updatedAt: now,
            })
            .where(eq(alertRules.id, existing.id))
            .returning();

          return reply.send({ rule: updated });
        } else {
          // Create new rule
          const [created] = await db
            .insert(alertRules)
            .values({
              monitoredDbId: id,
              alertType: alertType as typeof alertRules.alertType.enumValues[number],
              thresholdValue,
              cooldownMinutes: cooldownMinutes ?? 15,
              enabled: enabled ?? true,
              channels: channels ?? {},
            })
            .returning();

          return reply.status(201).send({ rule: created });
        }
      } catch (err) {
        request.log.error({ err }, "Failed to create/update alert rule");
        return reply.status(500).send({ error: "Failed to create/update alert rule" });
      }
    }
  );

  /**
   * PUT /api/databases/:id/alert-rules/:ruleId — Update a specific rule.
   */
  app.put<{
    Params: { id: string; ruleId: string };
    Body: {
      thresholdValue?: number;
      cooldownMinutes?: number;
      enabled?: boolean;
      channels?: { slack?: { webhookUrl: string } };
    };
  }>(
    "/api/databases/:id/alert-rules/:ruleId",
    { preHandler: [authMiddleware, requireRole('owner', 'admin'), requireFeature('alertingEnabled')] },
    async (request, reply) => {
      try {
        const { id, ruleId } = request.params;
        const { thresholdValue, cooldownMinutes, enabled, channels } =
          request.body;

        // Verify database belongs to this org
        if (!await verifyDbOwnership(id, request.auth.orgId)) {
          return reply.status(404).send({ error: "Database not found" });
        }

        const updateData: Record<string, unknown> = { updatedAt: new Date() };
        if (thresholdValue != null) updateData.thresholdValue = thresholdValue;
        if (cooldownMinutes != null) updateData.cooldownMinutes = cooldownMinutes;
        if (enabled != null) updateData.enabled = enabled;
        if (channels != null) updateData.channels = channels;

        const [updated] = await db
          .update(alertRules)
          .set(updateData)
          .where(eq(alertRules.id, ruleId))
          .returning();

        if (!updated) {
          return reply.status(404).send({ error: "Alert rule not found" });
        }

        return reply.send({ rule: updated });
      } catch (err) {
        request.log.error({ err }, "Failed to update alert rule");
        return reply.status(500).send({ error: "Failed to update alert rule" });
      }
    }
  );

  /**
   * DELETE /api/databases/:id/alert-rules/:ruleId — Delete a rule.
   */
  app.delete<{ Params: { id: string; ruleId: string } }>(
    "/api/databases/:id/alert-rules/:ruleId",
    { preHandler: [authMiddleware, requireRole('owner', 'admin'), requireFeature('alertingEnabled')] },
    async (request, reply) => {
      try {
        const { id, ruleId } = request.params;

        // Verify database belongs to this org
        if (!await verifyDbOwnership(id, request.auth.orgId)) {
          return reply.status(404).send({ error: "Database not found" });
        }

        const [deleted] = await db
          .delete(alertRules)
          .where(eq(alertRules.id, ruleId))
          .returning({ id: alertRules.id });

        if (!deleted) {
          return reply.status(404).send({ error: "Alert rule not found" });
        }

        return reply.send({ success: true });
      } catch (err) {
        request.log.error({ err }, "Failed to delete alert rule");
        return reply.status(500).send({ error: "Failed to delete alert rule" });
      }
    }
  );

  /**
   * POST /api/databases/:id/alert-rules/test — Send a test Slack notification.
   */
  app.post<{ Params: { id: string }; Body: { webhookUrl?: string; emailConfig?: EmailConfig } }>(
    "/api/databases/:id/alert-rules/test",
    { preHandler: [authMiddleware, requireFeature('alertingEnabled')] },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const { webhookUrl, emailConfig } = request.body;

        if (!webhookUrl && !emailConfig) {
          return reply.status(400).send({ error: "webhookUrl or emailConfig is required" });
        }

        // Verify database belongs to this org
        if (!await verifyDbOwnership(id, request.auth.orgId)) {
          return reply.status(404).send({ error: "Database not found" });
        }

        // Fetch database name for the test message
        const [monitoredDb] = await db
          .select({ name: monitoredDatabases.name })
          .from(monitoredDatabases)
          .where(eq(monitoredDatabases.id, id))
          .limit(1);

        const dbName = monitoredDb?.name ?? "Unknown Database";

        // Test Slack
        if (webhookUrl) {
          const result = await sendTestNotification(webhookUrl, dbName, request.log);
          if (!result.success) {
            return reply.status(400).send({ success: false, error: result.error });
          }
        }

        // Test Email
        if (emailConfig) {
          const result = await sendTestEmailNotification(emailConfig, dbName, request.log);
          if (!result.success) {
            return reply.status(400).send({ success: false, error: result.error });
          }
        }

        return reply.send({ success: true });
      } catch (err) {
        request.log.error({ err }, "Failed to send test notification");
        return reply.status(500).send({ error: "Failed to send test notification" });
      }
    }
  );

  /**
   * PATCH /api/alerts/:id/feedback — Submit feedback on an alert's usefulness
   */
  app.patch<{ Params: { id: string }; Body: { feedback: string } }>(
    "/api/alerts/:id/feedback",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const { id } = request.params;
      const { feedback } = request.body as { feedback: string };

      if (!feedback || !["useful", "not_useful"].includes(feedback)) {
        return reply.status(400).send({ error: "feedback must be 'useful' or 'not_useful'" });
      }

      try {
        const [updated] = await db
          .update(alerts)
          .set({ feedback, feedbackAt: new Date() })
          .where(eq(alerts.id, id))
          .returning({ id: alerts.id });

        if (!updated) {
          return reply.status(404).send({ error: "Alert not found" });
        }

        return reply.send({ success: true });
      } catch (err) {
        request.log.error({ err }, "Failed to update alert feedback");
        return reply.status(500).send({ error: "Failed to update feedback" });
      }
    }
  );
}
