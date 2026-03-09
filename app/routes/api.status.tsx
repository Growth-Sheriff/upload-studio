/**
 * API Status Endpoint
 * GET /api/status - App-wide status with queue and storage health
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "~/lib/prisma.server";
import Redis from "ioredis";
import { Queue } from "bullmq";

export async function loader({ request }: LoaderFunctionArgs) {
  const startTime = Date.now();

  // Check components health
  const checks = await Promise.allSettled([
    checkDatabase(),
    checkRedis(),
    checkQueues(),
  ]);

  const [dbResult, redisResult, queuesResult] = checks;

  const dbHealth = dbResult.status === "fulfilled" ? dbResult.value : { status: "error", error: String(dbResult.reason) };
  const redisHealth = redisResult.status === "fulfilled" ? redisResult.value : { status: "error", error: String(redisResult.reason) };
  const queuesHealth = queuesResult.status === "fulfilled" ? queuesResult.value : { status: "error", error: String(queuesResult.reason) };

  const allHealthy = 
    dbHealth.status === "ok" && 
    redisHealth.status === "ok" && 
    queuesHealth.status === "ok";

  const responseTime = Date.now() - startTime;

  return json({
    status: allHealthy ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    responseTimeMs: responseTime,
    version: process.env.APP_VERSION || "1.0.0",
    environment: process.env.NODE_ENV || "development",
    components: {
      database: dbHealth,
      redis: redisHealth,
      queues: queuesHealth,
    },
  }, {
    status: allHealthy ? 200 : 503,
    headers: {
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}

async function checkDatabase() {
  try {
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const latency = Date.now() - start;

    return {
      status: "ok",
      latencyMs: latency,
    };
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkRedis() {
  let redis: Redis | null = null;
  try {
    const start = Date.now();
    redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
      connectTimeout: 5000,
      maxRetriesPerRequest: 1,
    });

    await redis.ping();
    const latency = Date.now() - start;

    // Get some info
    const info = await redis.info("memory");
    const usedMemory = info.match(/used_memory_human:(\S+)/)?.[1] || "unknown";

    await redis.quit();

    return {
      status: "ok",
      latencyMs: latency,
      stats: {
        memoryUsed: usedMemory,
      },
    };
  } catch (error) {
    if (redis) await redis.quit().catch(() => {});
    return {
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkQueues() {
  let redis: Redis | null = null;
  try {
    redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
      maxRetriesPerRequest: null,
    });

    const preflightQueue = new Queue("preflight", { connection: redis });
    const exportQueue = new Queue("export", { connection: redis });

    const [preflightCounts, exportCounts] = await Promise.all([
      preflightQueue.getJobCounts("waiting", "active", "completed", "failed"),
      exportQueue.getJobCounts("waiting", "active", "completed", "failed"),
    ]);

    await Promise.all([
      preflightQueue.close(),
      exportQueue.close(),
    ]);

    await redis.quit();

    return {
      status: "ok",
      preflight: preflightCounts,
      export: exportCounts,
    };
  } catch (error) {
    if (redis) await redis.quit().catch(() => {});
    return {
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
