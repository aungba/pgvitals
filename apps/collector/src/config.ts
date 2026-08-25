import "dotenv/config";

export interface Config {
  databaseUrl: string;
  redisUrl: string;
  collectorPort: number;
  pollingIntervalMs: number;
  queryStatsIntervalMs: number;
  encryptionKey: string;
  clerkSecretKey: string;
  clerkPublishableKey: string;
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  stripeProPriceId: string;
  stripeTeamPriceId: string;
  dashboardBaseUrl: string;
  allowedOrigins: string[];
}

const parseAllowedOrigins = (): string[] => {
  const envOrigins = process.env.ALLOWED_ORIGINS;
  if (envOrigins) {
    return envOrigins.split(",").map((s) => s.trim()).filter(Boolean);
  }
  const dashboardUrl = process.env.DASHBOARD_BASE_URL ?? "http://localhost:3000";
  return [dashboardUrl, "http://localhost:3000", "http://127.0.0.1:3000"];
};

export const config: Config = {
  databaseUrl: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/pgvitals",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  collectorPort: parseInt(process.env.COLLECTOR_PORT ?? "3001", 10),
  pollingIntervalMs: parseInt(process.env.POLLING_INTERVAL_MS ?? "10000", 10),
  queryStatsIntervalMs: parseInt(process.env.QUERY_STATS_INTERVAL_MS ?? "300000", 10),
  encryptionKey: process.env.ENCRYPTION_KEY ?? "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  clerkSecretKey: process.env.CLERK_SECRET_KEY ?? "",
  clerkPublishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "",
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  stripeProPriceId: process.env.STRIPE_PRO_PRICE_ID ?? "",
  stripeTeamPriceId: process.env.STRIPE_TEAM_PRICE_ID ?? "",
  dashboardBaseUrl: process.env.DASHBOARD_BASE_URL ?? "http://localhost:3000",
  allowedOrigins: parseAllowedOrigins(),
};


