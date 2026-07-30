import type { FastifyInstance } from "fastify";
import databaseRoutes from "./databases.js";
import monitoringRoutes from "./monitoring.js";
import alertRoutes from "./alerts.js";
import queryRoutes from "./queries.js";
import indexRoutes from "./indexes.js";
import healthRoutes from "./health.js";

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
}
