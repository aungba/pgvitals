import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import crypto from "crypto";
import { db, monitoredDatabases } from "@pgvitals/db";
import { eq, and } from "drizzle-orm";
import { decrypt } from "../lib/encryption.js";
import { safeQuery } from "../lib/safe-query.js";
import { config } from "../config.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";

/* ===================================================================
   Interactive Remote Remediation Routes — Spec §6 & §7
   =================================================================== */

/**
 * Verifies that the given database belongs to the caller's organization.
 */
async function verifyDbOwnership(dbId: string, orgId: string): Promise<boolean> {
  const [mdb] = await db
    .select({ id: monitoredDatabases.id })
    .from(monitoredDatabases)
    .where(and(eq(monitoredDatabases.id, dbId), eq(monitoredDatabases.orgId, orgId)))
    .limit(1);
  return !!mdb;
}

/**
 * Validates Slack webhook request HMAC-SHA256 signature.
 */
function verifySlackSignature(
  signingSecret: string,
  timestamp: string | undefined,
  rawBody: string,
  signature: string | undefined
): boolean {
  if (!signingSecret || !timestamp || !signature) {
    return false;
  }

  // Prevent replay attacks (older than 5 minutes)
  const currentTime = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTime - parseInt(timestamp, 10)) > 300) {
    return false;
  }

  const sigBaseString = `v0:${timestamp}:${rawBody}`;
  const hmac = crypto
    .createHmac("sha256", signingSecret)
    .update(sigBaseString, "utf8")
    .digest("hex");
  const computedSignature = `v0=${hmac}`;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(computedSignature, "utf8"),
      Buffer.from(signature, "utf8")
    );
  } catch {
    return false;
  }
}

export default async function remediationRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /api/databases/:id/sessions/:pid/terminate
   * Terminates a rogue blocking or idle session on the target database.
   * Spec §6.2 & §7
   */
  fastify.post<{
    Params: { id: string; pid: string };
  }>(
    "/api/databases/:id/sessions/:pid/terminate",
    { preHandler: [authMiddleware, requireRole("owner", "admin")] },
    async (request: FastifyRequest<{ Params: { id: string; pid: string } }>, reply: FastifyReply) => {
      const { id: dbId, pid } = request.params;
      const targetPid = parseInt(pid, 10);

      if (isNaN(targetPid) || targetPid <= 0) {
        return reply.status(400).send({ error: "Invalid PID parameter" });
      }

      if (!(await verifyDbOwnership(dbId, request.auth.orgId))) {
        return reply.status(404).send({ error: "Database instance not found or permission denied" });
      }

      const [monitoredDb] = await db
        .select()
        .from(monitoredDatabases)
        .where(
          and(
            eq(monitoredDatabases.id, dbId),
            eq(monitoredDatabases.orgId, request.auth.orgId)
          )
        )
        .limit(1);

      if (!monitoredDb) {
        return reply.status(404).send({ error: "Database instance not found" });
      }

      const rawConnStr = decrypt(
        monitoredDb.connectionStringEncrypted,
        config.encryptionKey
      );

      try {
        const result = await safeQuery<Array<{ terminated: boolean }>>(
          rawConnStr,
          `SELECT pg_terminate_backend(${targetPid}) AS terminated`,
          { timeoutMs: 10000 }
        );

        const wasTerminated = result[0]?.terminated ?? false;

        request.log.info(
          { dbId, pid: targetPid, wasTerminated, userId: request.auth.userId },
          "Session termination executed"
        );

        return reply.send({
          success: wasTerminated,
          pid: targetPid,
          message: wasTerminated
            ? `Successfully terminated PostgreSQL backend PID ${targetPid}.`
            : `Could not terminate PID ${targetPid}. Process may have already exited.`,
        });
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        request.log.error({ err, dbId, pid: targetPid }, "Failed to terminate session");
        return reply.status(500).send({ error: `Query execution failed: ${errorMsg}` });
      }
    }
  );

  /**
   * POST /api/webhooks/slack/interactions
   * Receives and validates Slack interactive button actions for session termination.
   * Spec §6.1 & §7
   */
  fastify.post(
    "/api/webhooks/slack/interactions",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;
      const slackSignature = request.headers["x-slack-signature"] as string | undefined;
      const slackTimestamp = request.headers["x-slack-request-timestamp"] as string | undefined;

      // In production, enforce signature validation if secret is set
      if (slackSigningSecret) {
        const rawBody =
          typeof request.body === "string"
            ? request.body
            : JSON.stringify(request.body);

        const isValid = verifySlackSignature(
          slackSigningSecret,
          slackTimestamp,
          rawBody,
          slackSignature
        );

        if (!isValid) {
          request.log.warn("Slack interaction signature validation failed");
          return reply.status(401).send({ error: "Invalid Slack signature" });
        }
      }

      // Parse payload from Slack form or JSON
      let payload: any = request.body;
      if (typeof payload === "object" && payload?.payload) {
        try {
          payload = JSON.parse(payload.payload);
        } catch {
          // ignore parse error
        }
      } else if (typeof payload === "string") {
        try {
          payload = JSON.parse(payload);
        } catch {
          // ignore parse error
        }
      }

      const actions = payload?.actions ?? [];
      const user = payload?.user?.username || payload?.user?.name || "Slack User";

      for (const action of actions) {
        if (action.action_id === "pgvitals_terminate_session") {
          let parsedValue: { dbId: string; pid: number };
          try {
            parsedValue =
              typeof action.value === "string"
                ? JSON.parse(action.value)
                : action.value;
          } catch {
            return reply.status(400).send({ error: "Invalid action value payload" });
          }

          const { dbId, pid } = parsedValue;
          const targetPid = parseInt(String(pid), 10);

          if (!dbId || isNaN(targetPid)) {
            return reply.status(400).send({ error: "Missing dbId or pid in action payload" });
          }

          // Lookup monitored database
          const [monitoredDb] = await db
            .select()
            .from(monitoredDatabases)
            .where(eq(monitoredDatabases.id, dbId))
            .limit(1);

          if (!monitoredDb) {
            return reply.send({
              response_type: "ephemeral",
              replace_original: false,
              text: `⚠️ Database not found for session termination.`,
            });
          }

          const rawConnStr = decrypt(
            monitoredDb.connectionStringEncrypted,
            config.encryptionKey
          );

          try {
            const result = await safeQuery<Array<{ terminated: boolean }>>(
              rawConnStr,
              `SELECT pg_terminate_backend(${targetPid}) AS terminated`,
              { timeoutMs: 10000 }
            );

            const wasTerminated = result[0]?.terminated ?? false;

            return reply.send({
              response_type: "in_channel",
              replace_original: true,
              text: wasTerminated
                ? `✅ Blocker PID \`${targetPid}\` was successfully terminated by @${user}.`
                : `⚠️ Backend PID \`${targetPid}\` could not be terminated (session may have already exited).`,
            });
          } catch (err: unknown) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            return reply.send({
              response_type: "ephemeral",
              replace_original: false,
              text: `❌ Failed to terminate PID \`${targetPid}\`: ${errorMsg}`,
            });
          }
        }
      }

      return reply.send({ ok: true });
    }
  );
}
