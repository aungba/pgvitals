import type { FastifyInstance } from "fastify";
import databaseRoutes from "./databases.js";
import monitoringRoutes from "./monitoring.js";
import alertRoutes from "./alerts.js";
import queryRoutes from "./queries.js";
import indexRoutes from "./indexes.js";
import healthRoutes from "./health.js";
import billingRoutes from "./billing.js";
import replicationRoutes from "./replication.js";
import logInsightRoutes from "./log-insights.js";
import orgRoutes from "./org.js";
import schemaEventRoutes from "./schema-events.js";
import poolerRoutes from "./pooler.js";

/**
 * Fastify plugin that registers all API route handlers.
 */
export default async function routes(app: FastifyInstance): Promise<void> {
  await app.register(databaseRoutes);
  await app.register(monitoringRoutes);
  await app.register(alertRoutes);
  await app.register(queryRoutes);
  await app.register(indexRoutes);
  await app.register(healthRoutes);
  await app.register(billingRoutes);
  await app.register(replicationRoutes);
  await app.register(logInsightRoutes);
  await app.register(orgRoutes);
  await app.register(schemaEventRoutes);
  await app.register(poolerRoutes);
}
