import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { config } from "./config.js";
import routes from "./routes/index.js";
import { startScheduler, stopScheduler } from "./collector/scheduler.js";

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    transport:
      process.env.NODE_ENV !== "production"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
  },
});

// --- Plugins ---
await app.register(cors, {
  origin: (origin, cb) => {
    // Allow non-browser / server-to-server requests (no origin header)
    if (!origin) {
      return cb(null, true);
    }
    // Allow any origin during non-production local development
    if (process.env.NODE_ENV !== "production") {
      return cb(null, true);
    }
    // Validate against configured allowed origins in production
    if (config.allowedOrigins.includes(origin)) {
      return cb(null, true);
    }
    return cb(new Error(`Origin "${origin}" not allowed by CORS policy`), false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
});

await app.register(swagger, {
  openapi: {
    info: {
      title: "PG Vitals API",
      description: "PostgreSQL monitoring, diagnostics and alerting API",
      version: "1.0.0",
    },
    servers: [
      {
        url: `http://localhost:${config.collectorPort}`,
        description: "Local Collector",
      },
    ],
  },
});

await app.register(swaggerUi, {
  routePrefix: "/documentation",
  uiConfig: {
    docExpansion: "list",
    deepLinking: true,
  },
});

// --- Routes ---
await app.register(routes);

// --- Health check ---
app.get("/health", async () => ({
  status: "ok",
  uptime: process.uptime(),
  timestamp: new Date().toISOString(),
}));

// --- Graceful shutdown ---
const shutdown = async (signal: string) => {
  app.log.info({ signal }, "Received shutdown signal");

  try {
    await stopScheduler(app.log);
    await app.close();
    app.log.info("Server shut down gracefully");
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, "Error during shutdown");
    process.exit(1);
  }
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// --- Start ---
try {
  // Start BullMQ scheduler for all monitored databases
  await startScheduler(app.log);

  // Start Fastify server
  await app.listen({ port: config.collectorPort, host: "0.0.0.0" });
  app.log.info(
    `PG Vitals Collector running on http://0.0.0.0:${config.collectorPort}`
  );
} catch (err) {
  app.log.fatal({ err }, "Failed to start server");
  process.exit(1);
}
