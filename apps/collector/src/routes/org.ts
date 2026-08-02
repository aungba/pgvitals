import type { FastifyInstance } from "fastify";
import { db, organizations, users } from "@pgvitals/db";
import { eq, and } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth.js";

/* ===================================================================
   Organization & Team Management Routes — Multi-tenancy
   =================================================================== */

export default async function orgRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/org — Get current organization details.
   */
  app.get("/api/org", { preHandler: [authMiddleware] }, async (request, reply) => {
    try {
      const [org] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, request.auth.orgId))
        .limit(1);

      if (!org) {
        return reply.status(404).send({ error: "Organization not found" });
      }

      return reply.send({
        org: {
          id: org.id,
          name: org.name,
          planTier: org.planTier,
          createdAt: org.createdAt.toISOString(),
        },
      });
    } catch (err) {
      request.log.error({ err }, "Failed to get organization");
      return reply.status(500).send({ error: "Failed to get organization" });
    }
  });

  /**
   * PUT /api/org — Update organization name.
   */
  app.put<{ Body: { name: string } }>(
    "/api/org",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      try {
        const { name } = request.body;
        if (!name?.trim()) {
          return reply.status(400).send({ error: "name is required" });
        }

        // Only owners/admins can update org
        const [user] = await db
          .select({ role: users.role })
          .from(users)
          .where(eq(users.id, request.auth.userId))
          .limit(1);

        if (!user || (user.role !== "owner" && user.role !== "admin")) {
          return reply.status(403).send({ error: "Insufficient permissions" });
        }

        const [updated] = await db
          .update(organizations)
          .set({ name: name.trim() })
          .where(eq(organizations.id, request.auth.orgId))
          .returning();

        return reply.send({
          org: {
            id: updated.id,
            name: updated.name,
            planTier: updated.planTier,
          },
        });
      } catch (err) {
        request.log.error({ err }, "Failed to update organization");
        return reply.status(500).send({ error: "Failed to update organization" });
      }
    }
  );

  /**
   * GET /api/org/members — List team members.
   */
  app.get("/api/org/members", { preHandler: [authMiddleware] }, async (request, reply) => {
    try {
      const members = await db
        .select({
          id: users.id,
          email: users.email,
          role: users.role,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.orgId, request.auth.orgId));

      return reply.send({
        members: members.map((m) => ({
          id: m.id,
          email: m.email,
          role: m.role,
          createdAt: m.createdAt.toISOString(),
        })),
      });
    } catch (err) {
      request.log.error({ err }, "Failed to list members");
      return reply.status(500).send({ error: "Failed to list members" });
    }
  });

  /**
   * POST /api/org/members — Invite a new team member.
   */
  app.post<{ Body: { email: string; role?: "admin" | "member" } }>(
    "/api/org/members",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      try {
        const { email, role = "member" } = request.body;
        if (!email?.trim()) {
          return reply.status(400).send({ error: "email is required" });
        }

        // Only owners/admins can invite
        const [currentUser] = await db
          .select({ role: users.role })
          .from(users)
          .where(eq(users.id, request.auth.userId))
          .limit(1);

        if (!currentUser || (currentUser.role !== "owner" && currentUser.role !== "admin")) {
          return reply.status(403).send({ error: "Insufficient permissions" });
        }

        // Check if user already exists in this org
        const [existing] = await db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.email, email.trim().toLowerCase()), eq(users.orgId, request.auth.orgId)))
          .limit(1);

        if (existing) {
          return reply.status(409).send({ error: "User already exists in this organization" });
        }

        const [newUser] = await db
          .insert(users)
          .values({
            orgId: request.auth.orgId,
            email: email.trim().toLowerCase(),
            role,
          })
          .returning();

        return reply.status(201).send({
          member: {
            id: newUser.id,
            email: newUser.email,
            role: newUser.role,
            createdAt: newUser.createdAt.toISOString(),
          },
        });
      } catch (err) {
        request.log.error({ err }, "Failed to invite member");
        return reply.status(500).send({ error: "Failed to invite member" });
      }
    }
  );

  /**
   * PUT /api/org/members/:memberId — Update a member's role.
   */
  app.put<{ Params: { memberId: string }; Body: { role: "admin" | "member" } }>(
    "/api/org/members/:memberId",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      try {
        const { memberId } = request.params;
        const { role } = request.body;

        if (!role || !["admin", "member"].includes(role)) {
          return reply.status(400).send({ error: "role must be 'admin' or 'member'" });
        }

        // Only owners can change roles
        const [currentUser] = await db
          .select({ role: users.role })
          .from(users)
          .where(eq(users.id, request.auth.userId))
          .limit(1);

        if (!currentUser || currentUser.role !== "owner") {
          return reply.status(403).send({ error: "Only owners can change roles" });
        }

        // Verify member belongs to this org
        const [member] = await db
          .select()
          .from(users)
          .where(and(eq(users.id, memberId), eq(users.orgId, request.auth.orgId)))
          .limit(1);

        if (!member) {
          return reply.status(404).send({ error: "Member not found" });
        }

        if (member.role === "owner") {
          return reply.status(400).send({ error: "Cannot change owner's role" });
        }

        const [updated] = await db
          .update(users)
          .set({ role })
          .where(eq(users.id, memberId))
          .returning();

        return reply.send({
          member: {
            id: updated.id,
            email: updated.email,
            role: updated.role,
          },
        });
      } catch (err) {
        request.log.error({ err }, "Failed to update member role");
        return reply.status(500).send({ error: "Failed to update member role" });
      }
    }
  );

  /**
   * DELETE /api/org/members/:memberId — Remove a team member.
   */
  app.delete<{ Params: { memberId: string } }>(
    "/api/org/members/:memberId",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      try {
        const { memberId } = request.params;

        // Only owners/admins can remove members
        const [currentUser] = await db
          .select({ role: users.role })
          .from(users)
          .where(eq(users.id, request.auth.userId))
          .limit(1);

        if (!currentUser || (currentUser.role !== "owner" && currentUser.role !== "admin")) {
          return reply.status(403).send({ error: "Insufficient permissions" });
        }

        // Can't remove yourself
        if (memberId === request.auth.userId) {
          return reply.status(400).send({ error: "Cannot remove yourself" });
        }

        // Verify member belongs to this org and isn't the owner
        const [member] = await db
          .select()
          .from(users)
          .where(and(eq(users.id, memberId), eq(users.orgId, request.auth.orgId)))
          .limit(1);

        if (!member) {
          return reply.status(404).send({ error: "Member not found" });
        }

        if (member.role === "owner") {
          return reply.status(400).send({ error: "Cannot remove the owner" });
        }

        await db.delete(users).where(eq(users.id, memberId));

        return reply.send({ success: true });
      } catch (err) {
        request.log.error({ err }, "Failed to remove member");
        return reply.status(500).send({ error: "Failed to remove member" });
      }
    }
  );
}
