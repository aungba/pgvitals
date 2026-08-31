import type { FastifyRequest, FastifyReply } from "fastify";
import { db, monitoredDatabases } from "@pgvitals/db";
import { eq } from "drizzle-orm";

/* ===================================================================
   Plan Limits — enforces feature gates based on subscription tier
   =================================================================== */

export interface PlanLimits {
  maxDatabases: number;
  alertingEnabled: boolean;
  queryPerformanceEnabled: boolean;
  indexAdvisorEnabled: boolean;
  vacuumAdvisorEnabled: boolean;
  replicationEnabled: boolean;
  logInsightsEnabled: boolean;
  retentionDays: number;
}

const PLAN_LIMITS: Record<string, PlanLimits> = {
  free: {
    maxDatabases: 1,
    alertingEnabled: false,
    queryPerformanceEnabled: false,
    indexAdvisorEnabled: false,
    vacuumAdvisorEnabled: false,
    replicationEnabled: false,
    logInsightsEnabled: false,
    retentionDays: 1,
  },
  pro: {
    maxDatabases: 5,
    alertingEnabled: true,
    queryPerformanceEnabled: true,
    indexAdvisorEnabled: true,
    vacuumAdvisorEnabled: true,
    replicationEnabled: true,
    logInsightsEnabled: true,
    retentionDays: 30,
  },
  team: {
    maxDatabases: Infinity,
    alertingEnabled: true,
    queryPerformanceEnabled: true,
    indexAdvisorEnabled: true,
    vacuumAdvisorEnabled: true,
    replicationEnabled: true,
    logInsightsEnabled: true,
    retentionDays: 90,
  },
};

/**
 * Returns the plan limits for the authenticated user's organization.
 */
export function getLimits(planTier: string, isTrialActive: boolean = false): PlanLimits {
  if (isTrialActive) {
    return {
      ...PLAN_LIMITS.pro,
      maxDatabases: 2, // Free trial is capped at 2 databases for server performance
    };
  }
  return PLAN_LIMITS[planTier] ?? PLAN_LIMITS.free;
}

/**
 * Fastify preHandler that checks if the user can add more databases.
 */
export async function checkDatabaseLimit(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const { orgId, planTier, isTrialActive } = request.auth;
  const limits = getLimits(planTier, isTrialActive);

  const existing = await db
    .select({ id: monitoredDatabases.id })
    .from(monitoredDatabases)
    .where(eq(monitoredDatabases.orgId, orgId));

  if (existing.length >= limits.maxDatabases) {
    const planLabel = isTrialActive ? "Free Trial" : `${planTier.charAt(0).toUpperCase() + planTier.slice(1)} plan`;
    return reply.status(403).send({
      error: `Your ${planLabel} allows up to ${limits.maxDatabases} database(s). Upgrade to Pro to monitor up to 5 databases.`,
      code: "PLAN_LIMIT_EXCEEDED",
      currentCount: existing.length,
      limit: limits.maxDatabases,
    });
  }
}

/**
 * Creates a preHandler that checks if a specific feature is enabled for the plan.
 */
export function requireFeature(feature: keyof Omit<PlanLimits, "maxDatabases" | "retentionDays">) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const limits = getLimits(request.auth.planTier, request.auth.isTrialActive);
    if (!limits[feature]) {
      return reply.status(403).send({
        error: `This feature requires a Pro or Team plan.`,
        code: "FEATURE_NOT_AVAILABLE",
        feature,
        currentPlan: request.auth.effectivePlanTier,
      });
    }
  };
}
