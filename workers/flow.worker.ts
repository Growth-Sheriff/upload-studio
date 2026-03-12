/**
 * Flow Trigger Worker
 * 
 * Processes pending Shopify Flow triggers from the database.
 * Runs as a cron job every 30 seconds to pick up and send pending triggers.
 * 
 * Flow triggers are used to notify Shopify Flow about events:
 * - upload_received: New upload submitted
 * - upload_approved: Upload approved
 * - upload_rejected: Upload rejected
 * - preflight_warning: Preflight check has warnings
 * - preflight_error: Preflight check failed
 * - export_completed: Export job finished
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const MAX_RETRIES = 3;
const BATCH_SIZE = 10;

interface FlowTriggerRecord {
  id: string;
  shopId: string;
  eventType: string;
  resourceId: string;
  payload: any;
  status: string;
  attempts: number;
  error: string | null;
  createdAt: Date;
  sentAt: Date | null;
  shop: {
    shopDomain: string;
    accessToken: string;
  };
}

/**
 * Send a single flow trigger to Shopify
 */
async function sendFlowTrigger(trigger: FlowTriggerRecord): Promise<boolean> {
  try {
    console.log(`[Flow] Sending ${trigger.eventType} for ${trigger.resourceId}`);

    const response = await fetch(
      `https://${trigger.shop.shopDomain}/admin/api/2025-10/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": trigger.shop.accessToken,
        },
        body: JSON.stringify({
          query: `
            mutation flowTriggerReceive($handle: String!, $payload: JSON!) {
              flowTriggerReceive(handle: $handle, payload: $payload) {
                userErrors {
                  field
                  message
                }
              }
            }
          `,
          variables: {
            handle: `${process.env.FLOW_HANDLE_PREFIX || 'upload-studio'}/${trigger.eventType}`,
            payload: trigger.payload,
          },
        }),
      }
    );

    const result = await response.json();

    if (result.errors || result.data?.flowTriggerReceive?.userErrors?.length) {
      const errorMsg =
        result.errors?.[0]?.message ||
        result.data?.flowTriggerReceive?.userErrors?.[0]?.message ||
        "Unknown Shopify Flow error";
      throw new Error(errorMsg);
    }

    // Mark as sent
    await prisma.flowTrigger.updateMany({
      where: { id: trigger.id, shopId: trigger.shopId },
      data: {
        status: "sent",
        sentAt: new Date(),
        error: null,
      },
    });

    console.log(`[Flow] ✓ Sent ${trigger.eventType} successfully`);
    return true;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const attempts = trigger.attempts + 1;

    await prisma.flowTrigger.updateMany({
      where: { id: trigger.id, shopId: trigger.shopId },
      data: {
        status: attempts >= MAX_RETRIES ? "failed" : "pending",
        attempts,
        error: errorMessage,
      },
    });

    console.error(`[Flow] ✗ Failed ${trigger.eventType}: ${errorMessage} (attempt ${attempts}/${MAX_RETRIES})`);
    return false;
  }
}

/**
 * Process all pending flow triggers
 */
async function processPendingTriggers(): Promise<{ sent: number; failed: number }> {
  const results = { sent: 0, failed: 0 };

  // Get pending triggers (oldest first, limited batch)
  const pendingTriggers = await prisma.flowTrigger.findMany({
    where: {
      status: "pending",
      attempts: { lt: MAX_RETRIES },
    },
    include: {
      shop: {
        select: {
          shopDomain: true,
          accessToken: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
  });

  if (pendingTriggers.length === 0) {
    return results;
  }

  console.log(`[Flow] Processing ${pendingTriggers.length} pending triggers...`);

  for (const trigger of pendingTriggers) {
    const success = await sendFlowTrigger(trigger as FlowTriggerRecord);
    if (success) {
      results.sent++;
    } else {
      results.failed++;
    }

    // Small delay between requests to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return results;
}

/**
 * Cleanup old sent/failed triggers (older than 7 days)
 */
async function cleanupOldTriggers(): Promise<number> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const result = await prisma.flowTrigger.deleteMany({
    where: {
      status: { in: ["sent", "failed"] },
      createdAt: { lt: sevenDaysAgo },
    },
  });

  if (result.count > 0) {
    console.log(`[Flow] Cleaned up ${result.count} old triggers`);
  }

  return result.count;
}

/**
 * Get trigger statistics
 */
async function getStats(): Promise<{ pending: number; sent: number; failed: number }> {
  const stats = await prisma.flowTrigger.groupBy({
    by: ["status"],
    _count: true,
  });

  const result = { pending: 0, sent: 0, failed: 0 };
  for (const stat of stats) {
    if (stat.status === "pending") result.pending = stat._count;
    else if (stat.status === "sent") result.sent = stat._count;
    else if (stat.status === "failed") result.failed = stat._count;
  }

  return result;
}

/**
 * Main worker loop
 */
async function main() {
  console.log("[Flow Worker] Starting...");

  // Initial stats
  const initialStats = await getStats();
  console.log(`[Flow Worker] Initial stats: ${initialStats.pending} pending, ${initialStats.sent} sent, ${initialStats.failed} failed`);

  // Cleanup old triggers on startup
  await cleanupOldTriggers();

  // Run loop
  const INTERVAL_MS = 30000; // 30 seconds

  const runCycle = async () => {
    try {
      const results = await processPendingTriggers();
      if (results.sent > 0 || results.failed > 0) {
        console.log(`[Flow Worker] Cycle complete: ${results.sent} sent, ${results.failed} failed`);
      }
    } catch (error) {
      console.error("[Flow Worker] Cycle error:", error);
    }
  };

  // Run immediately
  await runCycle();

  // Then run on interval
  setInterval(runCycle, INTERVAL_MS);

  // Cleanup every hour
  setInterval(cleanupOldTriggers, 60 * 60 * 1000);

  console.log(`[Flow Worker] Running, processing every ${INTERVAL_MS / 1000}s`);
}

// Handle graceful shutdown
process.on("SIGTERM", async () => {
  console.log("[Flow Worker] Shutting down...");
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("[Flow Worker] Interrupted, shutting down...");
  await prisma.$disconnect();
  process.exit(0);
});

// Start
main().catch((error) => {
  console.error("[Flow Worker] Fatal error:", error);
  process.exit(1);
});
