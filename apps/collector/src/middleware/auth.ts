import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { db, organizations, users } from "@pgvitals/db";
import { eq } from "drizzle-orm";
import { config } from "../config.js";

// Extend Fastify request type
declare module "fastify" {
  interface FastifyRequest {
    auth: {
      userId: string;
      orgId: string;
      clerkUserId: string;
      clerkOrgId: string | null;
      planTier: "free" | "pro" | "team";
      effectivePlanTier: "free" | "pro" | "team";
      isTrialActive: boolean;
      trialDaysRemaining: number | null;
      trialEndsAt: string | null;
      role: "owner" | "admin" | "member";
    };
  }
}

/**
 * Computes effective plan and trial status based on org planTier and trialEndsAt.
 */
export function computeEffectivePlan(org: {
  planTier: "free" | "pro" | "team";
  trialEndsAt?: Date | null;
}): {
  effectivePlanTier: "free" | "pro" | "team";
  isTrialActive: boolean;
  trialDaysRemaining: number | null;
  trialEndsAt: string | null;
} {
  const trialEnds = org.trialEndsAt ? new Date(org.trialEndsAt) : null;
  const isTrialActive =
    org.planTier === "free" &&
    trialEnds !== null &&
    trialEnds.getTime() > Date.now();

  const trialDaysRemaining =
    isTrialActive && trialEnds
      ? Math.max(0, Math.ceil((trialEnds.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
      : null;

  const effectivePlanTier: "free" | "pro" | "team" = isTrialActive ? "pro" : org.planTier;

  return {
    effectivePlanTier,
    isTrialActive,
    trialDaysRemaining,
    trialEndsAt: trialEnds ? trialEnds.toISOString() : null,
  };
}

/**
 * Returns true if Clerk auth is configured (env vars are set).
 */
export function isAuthEnabled(): boolean {
  return !!config.clerkSecretKey;
}

/**
 * Fastify preHandler hook that verifies Clerk JWT tokens.
 * If Clerk is not configured (dev mode), falls back to the first org.
 */
export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Dev mode fallback — if Clerk is not configured, use first org
  if (!isAuthEnabled()) {
    const [org] = await db
      .select({
        id: organizations.id,
        planTier: organizations.planTier,
        trialEndsAt: organizations.trialEndsAt,
      })
      .from(organizations)
      .limit(1);

    if (!org) {
      return reply.status(503).send({ error: "No organization found. Please seed the database." });
    }

    const [user] = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.orgId, org.id))
      .limit(1);

    const trialInfo = computeEffectivePlan(org);

    request.auth = {
      userId: user?.id ?? "dev-user",
      orgId: org.id,
      clerkUserId: "dev-user",
      clerkOrgId: null,
      planTier: org.planTier,
      effectivePlanTier: trialInfo.effectivePlanTier,
      isTrialActive: trialInfo.isTrialActive,
      trialDaysRemaining: trialInfo.trialDaysRemaining,
      trialEndsAt: trialInfo.trialEndsAt,
      role: user?.role ?? "owner",
    };
    return;
  }

  // Production mode — verify Clerk JWT
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return reply.status(401).send({ error: "Missing or invalid Authorization header" });
  }

  const token = authHeader.substring(7);

  try {
    const { verifyToken } = await import("@clerk/backend");
    const payload = await verifyToken(token, {
      secretKey: config.clerkSecretKey,
    });

    const clerkUserId = payload.sub;
    const clerkOrgId = (payload as Record<string, unknown>).org_id as string | undefined;

    // Sync user and org to our database
    const authData = await syncUserAndOrg(
      clerkUserId,
      clerkOrgId ?? null,
      request
    );

    request.auth = {
      userId: authData.userId,
      orgId: authData.orgId,
      clerkUserId,
      clerkOrgId: clerkOrgId ?? null,
      planTier: authData.planTier,
      effectivePlanTier: authData.effectivePlanTier,
      isTrialActive: authData.isTrialActive,
      trialDaysRemaining: authData.trialDaysRemaining,
      trialEndsAt: authData.trialEndsAt,
      role: authData.role,
    };
  } catch (err) {
    request.log.warn({ err }, "JWT verification failed");
    return reply.status(401).send({ error: "Invalid or expired token" });
  }
}

/**
 * Syncs a Clerk user/org to our database tables.
 * Creates records if they don't exist yet (first login).
 */
async function syncUserAndOrg(
  clerkUserId: string,
  clerkOrgId: string | null,
  request: FastifyRequest
): Promise<{
  userId: string;
  orgId: string;
  planTier: "free" | "pro" | "team";
  effectivePlanTier: "free" | "pro" | "team";
  isTrialActive: boolean;
  trialDaysRemaining: number | null;
  trialEndsAt: string | null;
  role: "owner" | "admin" | "member";
}> {
  // 1. Find or create organization
  let org;

  if (clerkOrgId) {
    // Look up by Clerk org ID
    [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.clerkOrgId, clerkOrgId))
      .limit(1);

    if (!org) {
      const trialStart = new Date();
      const trialEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      // Create new org for this Clerk organization with 14-day trial
      [org] = await db
        .insert(organizations)
        .values({
          name: "My Organization",
          clerkOrgId,
          planTier: "free",
          trialStartedAt: trialStart,
          trialEndsAt: trialEnd,
          hasUsedTrial: true,
        })
        .returning();
      request.log.info({ orgId: org.id, clerkOrgId }, "Created new organization from Clerk with 14-day trial");
    }
  } else {
    // No org in JWT — find or create a personal org for this user
    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.clerkUserId, clerkUserId))
      .limit(1);

    if (existingUser) {
      [org] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, existingUser.orgId))
        .limit(1);
    }

    if (!org) {
      const trialStart = new Date();
      const trialEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      // Create personal org with 14-day trial
      [org] = await db
        .insert(organizations)
        .values({
          name: "Personal",
          planTier: "free",
          trialStartedAt: trialStart,
          trialEndsAt: trialEnd,
          hasUsedTrial: true,
        })
        .returning();
      request.log.info({ orgId: org.id }, "Created personal organization with 14-day trial");
    }
  }

  // 2. Find or create user
  let [user] = await db
    .select()
    .from(users)
    .where(eq(users.clerkUserId, clerkUserId))
    .limit(1);

  if (!user) {
    [user] = await db
      .insert(users)
      .values({
        orgId: org.id,
        email: `${clerkUserId}@clerk.user`,
        clerkUserId,
        role: "owner",
      })
      .returning();
    request.log.info({ userId: user.id, clerkUserId }, "Created new user from Clerk");
  }

  const trialInfo = computeEffectivePlan(org);

  return {
    userId: user.id,
    orgId: org.id,
    planTier: org.planTier,
    effectivePlanTier: trialInfo.effectivePlanTier,
    isTrialActive: trialInfo.isTrialActive,
    trialDaysRemaining: trialInfo.trialDaysRemaining,
    trialEndsAt: trialInfo.trialEndsAt,
    role: user.role,
  };
}

/**
 * Creates a preHandler that checks if the user has one of the required roles.
 * Must be used AFTER authMiddleware (depends on request.auth.role).
 *
 * Usage:
 *   { preHandler: [authMiddleware, requireRole('owner')] }           // owner only
 *   { preHandler: [authMiddleware, requireRole('owner', 'admin')] }  // owner or admin
 */
export function requireRole(...allowedRoles: Array<"owner" | "admin" | "member">) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!allowedRoles.includes(request.auth.role)) {
      return reply.status(403).send({
        error: `This action requires ${allowedRoles.join(" or ")} role.`,
        code: "INSUFFICIENT_ROLE",
        currentRole: request.auth.role,
        requiredRoles: allowedRoles,
      });
    }
  };
}
