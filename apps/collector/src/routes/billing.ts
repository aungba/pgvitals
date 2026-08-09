import type { FastifyInstance } from "fastify";
import Stripe from "stripe";
import { db, organizations, monitoredDatabases } from "@pgvitals/db";
import { eq } from "drizzle-orm";
import { config } from "../config.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";

/* ===================================================================
   Billing Routes — Stripe checkout, portal, webhooks
   =================================================================== */

function getStripe(): Stripe | null {
  if (!config.stripeSecretKey) return null;
  return new Stripe(config.stripeSecretKey);
}

export default async function billingRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/billing/status — Current subscription status.
   */
  app.get(
    "/api/billing/status",
    { preHandler: [authMiddleware, requireRole('owner')] },
    async (request, reply) => {
      try {
        const { orgId, planTier } = request.auth;

        const [org] = await db
          .select({
            planTier: organizations.planTier,
            stripeCustomerId: organizations.stripeCustomerId,
            stripeSubscriptionId: organizations.stripeSubscriptionId,
          })
          .from(organizations)
          .where(eq(organizations.id, orgId))
          .limit(1);

        return reply.send({
          planTier: org?.planTier ?? "free",
          hasStripeCustomer: !!org?.stripeCustomerId,
          hasSubscription: !!org?.stripeSubscriptionId,
        });
      } catch (err) {
        request.log.error({ err }, "Failed to get billing status");
        return reply.status(500).send({ error: "Failed to get billing status" });
      }
    }
  );

  /**
   * POST /api/billing/checkout — Create a Stripe Checkout session.
   */
  app.post<{ Body: { priceId: string; successUrl: string; cancelUrl: string } }>(
    "/api/billing/checkout",
    { preHandler: [authMiddleware, requireRole('owner')] },
    async (request, reply) => {
      const stripe = getStripe();
      if (!stripe) {
        return reply.status(503).send({ error: "Stripe is not configured" });
      }

      try {
        const { orgId } = request.auth;
        const { priceId, successUrl, cancelUrl } = request.body;

        if (!priceId || !successUrl || !cancelUrl) {
          return reply.status(400).send({ error: "priceId, successUrl, and cancelUrl are required" });
        }

        // Get or create Stripe customer
        const [org] = await db
          .select()
          .from(organizations)
          .where(eq(organizations.id, orgId))
          .limit(1);

        if (!org) {
          return reply.status(404).send({ error: "Organization not found" });
        }

        let customerId = org.stripeCustomerId;

        if (!customerId) {
          const customer = await stripe.customers.create({
            name: org.name,
            metadata: { orgId: org.id },
          });
          customerId = customer.id;

          await db
            .update(organizations)
            .set({ stripeCustomerId: customerId })
            .where(eq(organizations.id, orgId));
        }

        // Per-database billing: quantity = number of monitored databases
        // New subscribers get quantity = current DBs + 1 (the one they'll add next)
        const existingDbs = await db
          .select({ id: monitoredDatabases.id })
          .from(monitoredDatabases)
          .where(eq(monitoredDatabases.orgId, orgId));
        const dbQuantity = Math.max(existingDbs.length, 1);

        const session = await stripe.checkout.sessions.create({
          customer: customerId,
          mode: "subscription",
          line_items: [{ price: priceId, quantity: dbQuantity }],
          success_url: successUrl,
          cancel_url: cancelUrl,
          metadata: { orgId: org.id },
        });

        return reply.send({ url: session.url });
      } catch (err) {
        request.log.error({ err }, "Failed to create checkout session");
        return reply.status(500).send({ error: "Failed to create checkout session" });
      }
    }
  );

  /**
   * POST /api/billing/portal — Create a Stripe Customer Portal session.
   */
  app.post<{ Body: { returnUrl: string } }>(
    "/api/billing/portal",
    { preHandler: [authMiddleware, requireRole('owner')] },
    async (request, reply) => {
      const stripe = getStripe();
      if (!stripe) {
        return reply.status(503).send({ error: "Stripe is not configured" });
      }

      try {
        const { orgId } = request.auth;
        const { returnUrl } = request.body;

        const [org] = await db
          .select({ stripeCustomerId: organizations.stripeCustomerId })
          .from(organizations)
          .where(eq(organizations.id, orgId))
          .limit(1);

        if (!org?.stripeCustomerId) {
          return reply.status(400).send({ error: "No billing account found. Subscribe to a plan first." });
        }

        const session = await stripe.billingPortal.sessions.create({
          customer: org.stripeCustomerId,
          return_url: returnUrl || "/",
        });

        return reply.send({ url: session.url });
      } catch (err) {
        request.log.error({ err }, "Failed to create portal session");
        return reply.status(500).send({ error: "Failed to create portal session" });
      }
    }
  );

  /**
   * POST /api/billing/webhook — Stripe webhook handler.
   * NOT authenticated via Clerk — verified via Stripe signature.
   */
  app.post(
    "/api/billing/webhook",
    {
      config: { rawBody: true },
    },
    async (request, reply) => {
      const stripe = getStripe();
      if (!stripe || !config.stripeWebhookSecret) {
        return reply.status(503).send({ error: "Stripe webhooks not configured" });
      }

      try {
        const sig = request.headers["stripe-signature"] as string;
        const rawBody = (request as unknown as { rawBody: string }).rawBody || JSON.stringify(request.body);

        let event: Stripe.Event;
        try {
          event = stripe.webhooks.constructEvent(rawBody, sig, config.stripeWebhookSecret);
        } catch (err) {
          request.log.warn({ err }, "Stripe webhook signature verification failed");
          return reply.status(400).send({ error: "Invalid signature" });
        }

        request.log.info({ type: event.type }, "Stripe webhook received");

        switch (event.type) {
          case "checkout.session.completed": {
            const session = event.data.object as Stripe.Checkout.Session;
            const orgId = session.metadata?.orgId;
            const subscriptionId = session.subscription as string;

            if (orgId && subscriptionId) {
              // Determine plan tier from the price
              const subscription = await stripe.subscriptions.retrieve(subscriptionId);
              const priceId = subscription.items.data[0]?.price?.id;
              const planTier = priceId === config.stripeTeamPriceId ? "team" : "pro";

              await db
                .update(organizations)
                .set({
                  stripeSubscriptionId: subscriptionId,
                  planTier,
                })
                .where(eq(organizations.id, orgId));

              request.log.info({ orgId, planTier, subscriptionId }, "Subscription activated");
            }
            break;
          }

          case "customer.subscription.updated": {
            const subscription = event.data.object as Stripe.Subscription;
            const customerId = subscription.customer as string;
            const priceId = subscription.items.data[0]?.price?.id;
            const planTier = priceId === config.stripeTeamPriceId ? "team" : "pro";

            const [org] = await db
              .select({ id: organizations.id })
              .from(organizations)
              .where(eq(organizations.stripeCustomerId, customerId))
              .limit(1);

            if (org) {
              await db
                .update(organizations)
                .set({ planTier })
                .where(eq(organizations.id, org.id));

              request.log.info({ orgId: org.id, planTier }, "Subscription updated");
            }
            break;
          }

          case "customer.subscription.deleted": {
            const subscription = event.data.object as Stripe.Subscription;
            const customerId = subscription.customer as string;

            const [org] = await db
              .select({ id: organizations.id })
              .from(organizations)
              .where(eq(organizations.stripeCustomerId, customerId))
              .limit(1);

            if (org) {
              await db
                .update(organizations)
                .set({
                  planTier: "free",
                  stripeSubscriptionId: null,
                })
                .where(eq(organizations.id, org.id));

              request.log.info({ orgId: org.id }, "Subscription cancelled, downgraded to free");
            }
            break;
          }

          default:
            request.log.debug({ type: event.type }, "Unhandled Stripe event");
        }

        return reply.send({ received: true });
      } catch (err) {
        request.log.error({ err }, "Stripe webhook handler failed");
        return reply.status(500).send({ error: "Webhook handler failed" });
      }
    }
  );
}

/**
 * Sync the Stripe subscription quantity with the actual number of
 * monitored databases. Call this after adding or removing a database.
 *
 * Per-database billing: $39/mo (Pro) or $99/mo (Team) per database.
 */
export async function syncSubscriptionQuantity(
  orgId: string,
  log?: { info: (...args: unknown[]) => void; error: (...args: unknown[]) => void }
): Promise<void> {
  const stripe = getStripe();
  if (!stripe) return;

  try {
    const [org] = await db
      .select({
        stripeSubscriptionId: organizations.stripeSubscriptionId,
        planTier: organizations.planTier,
      })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    if (!org?.stripeSubscriptionId || org.planTier === "free") return;

    // Count current monitored databases
    const dbs = await db
      .select({ id: monitoredDatabases.id })
      .from(monitoredDatabases)
      .where(eq(monitoredDatabases.orgId, orgId));

    const newQuantity = Math.max(dbs.length, 1);

    // Get the subscription and update quantity
    const subscription = await stripe.subscriptions.retrieve(org.stripeSubscriptionId);
    const itemId = subscription.items.data[0]?.id;

    if (itemId) {
      await stripe.subscriptionItems.update(itemId, {
        quantity: newQuantity,
      });

      log?.info(
        { orgId, quantity: newQuantity, subscriptionId: org.stripeSubscriptionId },
        "Stripe subscription quantity synced with database count"
      );
    }
  } catch (err) {
    log?.error({ err, orgId }, "Failed to sync Stripe subscription quantity");
  }
}
