import "dotenv/config";

export interface Config {
  databaseUrl: string;
  redisUrl: string;
  collectorPort: number;
  pollingIntervalMs: number;
  queryStatsIntervalMs: number;
  encryptionKey: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config: Config = {
  databaseUrl: requireEnv("DATABASE_URL"),
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  collectorPort: parseInt(process.env.COLLECTOR_PORT ?? "3001", 10),
  pollingIntervalMs: parseInt(process.env.POLLING_INTERVAL_MS ?? "10000", 10),
  queryStatsIntervalMs: parseInt(process.env.QUERY_STATS_INTERVAL_MS ?? "300000", 10),
  encryptionKey: requireEnv("ENCRYPTION_KEY"),
};

