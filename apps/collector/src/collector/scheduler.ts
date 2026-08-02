import { Queue, Worker } from "bullmq";
import type { FastifyBaseLogger } from "fastify";
import IORedis from "ioredis";
import { db, monitoredDatabases } from "@pgvitals/db";
import { eq } from "drizzle-orm";
import { config } from "../config.js";
import { collectSnapshot } from "./connection-collector.js";
import { evaluateRules } from "./rules-engine.js";
import { evaluateAlerts } from "../alerting/engine.js";
import { purgeOldData } from "./retention.js";
import { collectQueryStats } from "./query-stats-collector.js";
import { analyzeIndexes } from "./index-advisor.js";
import { collectVacuumHealth } from "./vacuum-health-collector.js";
import { analyzeQuerySuggestions } from "./query-suggestions.js";
import { collectReplicationLag } from "./replication-collector.js";
import { collectLogInsights } from "./log-insights-collector.js";

const QUEUE_NAME = "pgvitals-collect";
const QUERY_STATS_QUEUE_NAME = "pgvitals-query-stats";
const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

let queue: Queue | null = null;
let queryStatsQueue: Queue | null = null;
let worker: Worker | null = null;
let queryStatsWorker: Worker | null = null;
let redisConnection: IORedis | null = null;
let retentionTimer: ReturnType<typeof setInterval> | null = null;

interface CollectJobData {
  monitoredDbId: string;
  dbName: string;
}

/**
 * Creates the shared Redis connection for BullMQ.
 */
function getRedisConnection(): IORedis {
  if (!redisConnection) {
    redisConnection = new IORedis(config.redisUrl, {
      maxRetriesPerRequest: null,
    });
  }
  return redisConnection;
}

/**
 * Starts the collection scheduler:
 * 1. Fetches all active monitored databases
 * 2. Creates a repeatable BullMQ job for each
 * 3. Starts a worker to process collection jobs
 */
export async function startScheduler(log: FastifyBaseLogger): Promise<void> {
  const connection = getRedisConnection();

  queue = new Queue(QUEUE_NAME, { connection });

  // Remove any stale repeatable jobs from previous runs
  const existingRepeatables = await queue.getRepeatableJobs();
  for (const job of existingRepeatables) {
    await queue.removeRepeatableByKey(job.key);
  }

  // Fetch all active monitored databases
  const activeDbs = await db
    .select({
      id: monitoredDatabases.id,
      name: monitoredDatabases.name,
    })
    .from(monitoredDatabases)
    .where(eq(monitoredDatabases.isActive, "true"));

  log.info(
    { count: activeDbs.length },
    "Scheduling collection for active databases"
  );

  // Create a repeatable job for each database
  for (const mdb of activeDbs) {
    await queue.add(
      `collect:${mdb.id}`,
      { monitoredDbId: mdb.id, dbName: mdb.name } satisfies CollectJobData,
      {
        repeat: {
          every: config.pollingIntervalMs,
        },
        jobId: `collect:${mdb.id}`,
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 100 },
      }
    );

    log.info(
      { monitoredDbId: mdb.id, name: mdb.name, intervalMs: config.pollingIntervalMs },
      "Scheduled collection job"
    );
  }

  // Create query stats queue and schedule jobs (5-min interval)
  queryStatsQueue = new Queue(QUERY_STATS_QUEUE_NAME, { connection });

  const existingQueryRepeatables = await queryStatsQueue.getRepeatableJobs();
  for (const job of existingQueryRepeatables) {
    await queryStatsQueue.removeRepeatableByKey(job.key);
  }

  for (const mdb of activeDbs) {
    await queryStatsQueue.add(
      `query-stats:${mdb.id}`,
      { monitoredDbId: mdb.id, dbName: mdb.name } satisfies CollectJobData,
      {
        repeat: {
          every: config.queryStatsIntervalMs,
        },
        jobId: `query-stats:${mdb.id}`,
        removeOnComplete: { count: 20 },
        removeOnFail: { count: 50 },
      }
    );

    log.info(
      { monitoredDbId: mdb.id, name: mdb.name, intervalMs: config.queryStatsIntervalMs },
      "Scheduled query stats job"
    );
  }

  // Start the worker
  worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const data = job.data as CollectJobData;
      const jobLog = log.child({ monitoredDbId: data.monitoredDbId, jobId: job.id });

      try {
        jobLog.info("Starting collection");
        const result = await collectSnapshot(data.monitoredDbId, jobLog);

        jobLog.info("Running rules engine");
        const hints = await evaluateRules(result, jobLog);

        jobLog.info("Running alerting engine");
        await evaluateAlerts(result, hints, jobLog);

        jobLog.info(
          { hintsGenerated: hints.length },
          "Collection job completed"
        );
      } catch (err) {
        jobLog.error({ err }, "Collection job failed");
        throw err;
      }
    },
    {
      connection,
      concurrency: 5,
    }
  );

  worker.on("failed", (job, err) => {
    log.error(
      { jobId: job?.id, err: err.message },
      "Worker: job failed"
    );
  });

  worker.on("error", (err) => {
    log.error({ err: err.message }, "Worker error");
  });

  // Start the query stats worker
  queryStatsWorker = new Worker(
    QUERY_STATS_QUEUE_NAME,
    async (job) => {
      const data = job.data as CollectJobData;
      const jobLog = log.child({ monitoredDbId: data.monitoredDbId, jobId: job.id });

      try {
        await collectQueryStats(data.monitoredDbId, jobLog);
        await analyzeIndexes(data.monitoredDbId, jobLog);
        await collectVacuumHealth(data.monitoredDbId, jobLog);
        await analyzeQuerySuggestions(data.monitoredDbId, jobLog);
        await collectReplicationLag(data.monitoredDbId, jobLog);
        await collectLogInsights(data.monitoredDbId, jobLog);
      } catch (err) {
        jobLog.error({ err }, "Query stats collection job failed");
        throw err;
      }
    },
    {
      connection,
      concurrency: 3,
    }
  );

  queryStatsWorker.on("failed", (job, err) => {
    log.error(
      { jobId: job?.id, err: err.message },
      "Query stats worker: job failed"
    );
  });

  queryStatsWorker.on("error", (err) => {
    log.error({ err: err.message }, "Query stats worker error");
  });

  log.info("Scheduler started");

  // Run data retention purge on startup, then daily
  purgeOldData(log).catch((err) =>
    log.error({ err }, "Initial retention purge failed")
  );
  retentionTimer = setInterval(() => {
    purgeOldData(log).catch((err) =>
      log.error({ err }, "Scheduled retention purge failed")
    );
  }, RETENTION_INTERVAL_MS);
  log.info("Data retention job scheduled (every 24h, 30-day window)");
}

/**
 * Adds a new monitored database to the collection schedule.
 * Call this when a database is registered via the API.
 */
export async function scheduleDatabase(
  monitoredDbId: string,
  dbName: string,
  log: FastifyBaseLogger
): Promise<void> {
  if (!queue) {
    log.warn("Queue not initialized, skipping schedule");
    return;
  }

  await queue.add(
    `collect:${monitoredDbId}`,
    { monitoredDbId, dbName } satisfies CollectJobData,
    {
      repeat: {
        every: config.pollingIntervalMs,
      },
      jobId: `collect:${monitoredDbId}`,
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 100 },
    }
  );

  log.info(
    { monitoredDbId, dbName, intervalMs: config.pollingIntervalMs },
    "Added database to collection schedule"
  );

  // Also schedule query stats
  if (queryStatsQueue) {
    await queryStatsQueue.add(
      `query-stats:${monitoredDbId}`,
      { monitoredDbId, dbName } satisfies CollectJobData,
      {
        repeat: {
          every: config.queryStatsIntervalMs,
        },
        jobId: `query-stats:${monitoredDbId}`,
        removeOnComplete: { count: 20 },
        removeOnFail: { count: 50 },
      }
    );
  }
}

/**
 * Removes a monitored database from the collection schedule.
 * Call this when a database is deleted via the API.
 */
export async function unscheduleDatabase(
  monitoredDbId: string,
  log: FastifyBaseLogger
): Promise<void> {
  if (!queue) {
    log.warn("Queue not initialized, skipping unschedule");
    return;
  }

  // Remove repeatable job by key
  const repeatables = await queue.getRepeatableJobs();
  for (const job of repeatables) {
    if (job.name === `collect:${monitoredDbId}`) {
      await queue.removeRepeatableByKey(job.key);
      log.info({ monitoredDbId }, "Removed repeatable job from schedule");
    }
  }

  // Also remove query stats job
  if (queryStatsQueue) {
    const queryRepeatables = await queryStatsQueue.getRepeatableJobs();
    for (const job of queryRepeatables) {
      if (job.name === `query-stats:${monitoredDbId}`) {
        await queryStatsQueue.removeRepeatableByKey(job.key);
        log.info({ monitoredDbId }, "Removed query stats job from schedule");
      }
    }
  }
}

/**
 * Gracefully shuts down the scheduler, worker, and Redis connection.
 */
export async function stopScheduler(log: FastifyBaseLogger): Promise<void> {
  log.info("Stopping scheduler...");

  if (worker) {
    await worker.close();
    worker = null;
  }

  if (queryStatsWorker) {
    await queryStatsWorker.close();
    queryStatsWorker = null;
  }

  if (queue) {
    await queue.close();
    queue = null;
  }

  if (queryStatsQueue) {
    await queryStatsQueue.close();
    queryStatsQueue = null;
  }

  if (redisConnection) {
    await redisConnection.quit();
    redisConnection = null;
  }

  if (retentionTimer) {
    clearInterval(retentionTimer);
    retentionTimer = null;
  }

  log.info("Scheduler stopped");
}
