import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "~/lib/prisma.server";
import Redis from "ioredis";

export async function loader({ request }: LoaderFunctionArgs) {
  const checks: Record<string, { status: string; latency?: number }> = {};
  const startTime = Date.now();


  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { status: "ok", latency: Date.now() - dbStart };
  } catch (error) {
    checks.database = { status: "error" };
  }


  try {
    const redisStart = Date.now();
    const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
    });
    await redis.ping();
    await redis.quit();
    checks.redis = { status: "ok", latency: Date.now() - redisStart };
  } catch (error) {
    checks.redis = { status: "error" };
  }

  const allHealthy = Object.values(checks).every((c) => c.status === "ok");

  return json(
    {
      status: allHealthy ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      totalLatency: Date.now() - startTime,
      checks,
    },
    { status: allHealthy ? 200 : 503 }
  );
}

