/**
 * ═══════════════════════════════════════════════════════════
 * Upload Studio — Mockup Generation Worker
 * ═══════════════════════════════════════════════════════════
 * 
 * GSB Engine'den tamamen izole çalışır.
 * Aynı VM'de ayrı systemd service olarak deploy edilir.
 * 
 * İş akışı:
 *   1. Upload Studio API → Redis queue'ya job atar
 *   2. Bu worker queue'yu dinler
 *   3. PSD/template'i R2'den çeker
 *   4. Sharp ile design'ı print area'ya composite eder
 *   5. Sonucu R2'ye yükler
 *   6. Upload Studio DB'yi günceller (metafield/mockup URL)
 * 
 * Kullanım:
 *   NODE_ENV=production tsx src/index.ts
 */

import "dotenv/config";
import sharp from "sharp";
import { MockupWorker } from "./mockup-worker.js";
import { getRedisConnection } from "./redis.js";

// Sharp optimizasyonları (GSB'den bağımsız)
sharp.cache(false);
sharp.concurrency(2);

const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || "2", 10);

async function bootstrap() {
  console.log("═══════════════════════════════════════════════════════");
  console.log(" Upload Studio — Mockup Worker (Isolated)");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`[us-mockup] PID: ${process.pid}`);
  console.log(`[us-mockup] Concurrency: ${CONCURRENCY}`);
  console.log(`[us-mockup] Queue: ${process.env.QUEUE_NAME || "us-mockup-queue"}`);
  console.log(`[us-mockup] Redis: ${process.env.REDIS_URL?.replace(/\/\/.*@/, "//***@") || "localhost"}`);
  console.log(`[us-mockup] Sharp cache: disabled, concurrency: 2`);
  console.log("");

  // Verify Redis connection
  const redis = getRedisConnection();
  await redis.ping();
  console.log("[us-mockup] ✅ Redis connected");

  // Start worker
  const worker = new MockupWorker(CONCURRENCY);
  await worker.start();
  console.log("[us-mockup] ✅ MockupWorker started");
  console.log("[us-mockup] 🚀 Waiting for jobs...");
  console.log("");

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[us-mockup] ${signal} received. Shutting down...`);
    await worker.stop();
    await redis.quit();
    console.log("[us-mockup] Shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  process.on("unhandledRejection", (reason) => {
    console.error("[us-mockup] Unhandled rejection:", reason);
  });

  process.on("uncaughtException", (err) => {
    console.error("[us-mockup] Uncaught exception:", err);
  });
}

bootstrap().catch((err) => {
  console.error("[us-mockup] Fatal error:", err);
  process.exit(1);
});
