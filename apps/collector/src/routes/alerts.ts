import type { FastifyInstance } from "fastify";
import { db, alerts, alertRules, monitoredDatabases } from "@pgvitals/db";
import { eq, and, isNull, desc } from "drizzle-orm";
import { sendTestNotification } from "../alerting/notifier.js";

/* ===================================================================
   Alert Routes — CRUD for alerts and alert rules
   =================================================================== */

export default async function alertRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/databases/:id/alerts — List alerts for a database.
   * Query: ?status=active|resolved|all (default: all) &limit=50
   */
  app.get<{ Params: { id: string }; Querystring: { status?: string; limit?: string } }>(
    "/api/databases/:id/alerts",
    async (request, reply) => {
      try {
        const { id } = request.params;
        const status = request.query.status ?? "all";
        const limit = Math.min(parseInt(request.query.limit ?? "50", 10), 200);

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
    async (request, reply) => {
      try {
        const { id } = request.params;

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
    async (request, reply) => {
      try {
        const { id } = request.params;

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
  }>("/api/databases/:id/alert-rules", async (request, reply) => {
    try {
      const { id } = request.params;
      const { alertType, thresholdValue, cooldownMinutes, enabled, channels } =
        request.body;

      if (!alertType || thresholdValue == null) {
        return reply
          .status(400)
          .send({ error: "alertType and thresholdValue are required" });
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
  });

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
  }>("/api/databases/:id/alert-rules/:ruleId", async (request, reply) => {
    try {
      const { ruleId } = request.params;
      const { thresholdValue, cooldownMinutes, enabled, channels } =
        request.body;

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
  });

  /**
   * DELETE /api/databases/:id/alert-rules/:ruleId — Delete a rule.
   */
  app.delete<{ Params: { id: string; ruleId: string } }>(
    "/api/databases/:id/alert-rules/:ruleId",
    async (request, reply) => {
      try {
        const { ruleId } = request.params;

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
  app.post<{ Params: { id: string }; Body: { webhookUrl: string } }>(
    "/api/databases/:id/alert-rules/test",
    async (request, reply) => {
      try {
        const { id } = request.params;
        const { webhookUrl } = request.body;

        if (!webhookUrl) {
          return reply.status(400).send({ error: "webhookUrl is required" });
        }

        // Fetch database name for the test message
        const [monitoredDb] = await db
          .select({ name: monitoredDatabases.name })
          .from(monitoredDatabases)
          .where(eq(monitoredDatabases.id, id))
          .limit(1);

        const dbName = monitoredDb?.name ?? "Unknown Database";

        const result = await sendTestNotification(webhookUrl, dbName, request.log);

        if (result.success) {
          return reply.send({ success: true });
        } else {
          return reply.status(400).send({ success: false, error: result.error });
        }
      } catch (err) {
        request.log.error({ err }, "Failed to send test notification");
        return reply.status(500).send({ error: "Failed to send test notification" });
      }
    }
  );
}
