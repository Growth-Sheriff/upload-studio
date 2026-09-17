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
    const schemaStart = Date.now();
    const requiredColumns = [
      "commissions.collectible_at",
      "commissions.eligibility_source",
      "commissions.attributable_captured_amount",
      "commissions.shopify_financial_status",
      "commissions.shopify_refund_status",
      "commissions.shopify_cancelled_at",
      "commissions.shopify_observed_at",
      "commissions.review_required_at",
      "commissions.review_reason",
      "uploads.quantity_semantics",
    ];
    const rows = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name IN ('commissions', 'uploads')
    `;
    const present = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));
    const missing = requiredColumns.filter((column) => !present.has(column));
    checks.schema = {
      status: missing.length === 0 ? "ok" : "error",
      latency: Date.now() - schemaStart,
    };
  } catch (error) {
    checks.schema = { status: "error" };
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

