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
      role: "owner" | "admin" | "member";
    };
  }
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
      .select({ id: organizations.id, planTier: organizations.planTier })
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

    request.auth = {
      userId: user?.id ?? "dev-user",
      orgId: org.id,
      clerkUserId: "dev-user",
      clerkOrgId: null,
      planTier: org.planTier,
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
    const { userId, orgId, planTier } = await syncUserAndOrg(
      clerkUserId,
      clerkOrgId ?? null,
      request
    );

    request.auth = {
      userId,
      orgId,
      clerkUserId,
      clerkOrgId: clerkOrgId ?? null,
      planTier,
      role,
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
): Promise<{ userId: string; orgId: string; planTier: "free" | "pro" | "team"; role: "owner" | "admin" | "member" }> {
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
      // Create new org for this Clerk organization
      [org] = await db
        .insert(organizations)
        .values({
          name: "My Organization",
          clerkOrgId,
          planTier: "free",
        })
        .returning();
      request.log.info({ orgId: org.id, clerkOrgId }, "Created new organization from Clerk");
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
      // Create personal org
      [org] = await db
        .insert(organizations)
        .values({
          name: "Personal",
          planTier: "free",
        })
        .returning();
      request.log.info({ orgId: org.id }, "Created personal organization");
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

  return {
    userId: user.id,
    orgId: org.id,
    planTier: org.planTier,
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
