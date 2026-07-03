














import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const MAX_RETRIES = 3;
const BATCH_SIZE = 10;
const FLOW_DISABLED_REASON = "Shopify Flow trigger dispatch disabled for this deployment";
const FLOW_TRIGGER_HANDLES: Record<string, string> = {
  upload_received: "upload-received",
  upload_approved: "upload-approved",
  upload_rejected: "upload-rejected",
  preflight_warning: "preflight-warning",
  preflight_error: "preflight-error",
  export_completed: "export-completed",
};

function isShopifyFlowTriggersEnabled(): boolean {
  const value = process.env.SHOPIFY_FLOW_TRIGGERS_ENABLED?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function isInvalidHandleError(errorMessage: string): boolean {
  return /invalid handle/i.test(errorMessage);
}

function getFlowTriggerHandle(eventType: string): string {
  const mappedHandle = FLOW_TRIGGER_HANDLES[eventType];
  if (mappedHandle) {
    return mappedHandle;
  }

  const normalizedHandle = eventType
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!normalizedHandle) {
    throw new Error(`Invalid Flow event type: ${eventType}`);
  }

  return normalizedHandle;
}

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




async function sendFlowTrigger(trigger: FlowTriggerRecord): Promise<boolean> {
  try {
    const handle = getFlowTriggerHandle(trigger.eventType);
    console.log(`[Flow] Sending ${trigger.eventType} (${handle}) for ${trigger.resourceId}`);

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
            handle,
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
    const invalidHandle = isInvalidHandleError(errorMessage);

    await prisma.flowTrigger.updateMany({
      where: { id: trigger.id, shopId: trigger.shopId },
      data: {
        status: invalidHandle ? "skipped" : attempts >= MAX_RETRIES ? "failed" : "pending",
        attempts,
        error: errorMessage,
      },
    });

    if (invalidHandle) {
      const skipped = await prisma.flowTrigger.updateMany({
        where: {
          shopId: trigger.shopId,
          eventType: trigger.eventType,
          status: "pending",
        },
        data: {
          status: "skipped",
          error: `${errorMessage}\n${FLOW_DISABLED_REASON}`,
        },
      });

      if (skipped.count > 0) {
        console.error(`[Flow] Skipped ${skipped.count} queued ${trigger.eventType} triggers after invalid handle response`);
      }
    }

    console.error(`[Flow] ✗ Failed ${trigger.eventType}: ${errorMessage} (attempt ${attempts}/${MAX_RETRIES})`);
    return false;
  }
}

async function skipPendingTriggers(reason: string): Promise<number> {
  const result = await prisma.flowTrigger.updateMany({
    where: { status: "pending" },
    data: {
      status: "skipped",
      error: reason,
    },
  });

  return result.count;
}




async function processPendingTriggers(): Promise<{ sent: number; failed: number }> {
  const results = { sent: 0, failed: 0 };

  if (!isShopifyFlowTriggersEnabled()) {
    const skipped = await skipPendingTriggers(FLOW_DISABLED_REASON);
    if (skipped > 0) {
      console.log(`[Flow] Skipped ${skipped} pending triggers: ${FLOW_DISABLED_REASON}`);
    }
    return results;
  }


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


    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return results;
}




async function cleanupOldTriggers(): Promise<number> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const result = await prisma.flowTrigger.deleteMany({
    where: {
      status: { in: ["sent", "failed", "skipped"] },
      createdAt: { lt: sevenDaysAgo },
    },
  });

  if (result.count > 0) {
    console.log(`[Flow] Cleaned up ${result.count} old triggers`);
  }

  return result.count;
}




async function getStats(): Promise<{ pending: number; sent: number; failed: number; skipped: number }> {
  const stats = await prisma.flowTrigger.groupBy({
    by: ["status"],
    _count: true,
  });

  const result = { pending: 0, sent: 0, failed: 0, skipped: 0 };
  for (const stat of stats) {
    if (stat.status === "pending") result.pending = stat._count;
    else if (stat.status === "sent") result.sent = stat._count;
    else if (stat.status === "failed") result.failed = stat._count;
    else if (stat.status === "skipped") result.skipped = stat._count;
  }

  return result;
}




async function main() {
  console.log("[Flow Worker] Starting...");


  const initialStats = await getStats();
  console.log(`[Flow Worker] Initial stats: ${initialStats.pending} pending, ${initialStats.sent} sent, ${initialStats.failed} failed, ${initialStats.skipped} skipped`);


  await cleanupOldTriggers();


  const INTERVAL_MS = 30000;

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


  await runCycle();


  setInterval(runCycle, INTERVAL_MS);


  setInterval(cleanupOldTriggers, 60 * 60 * 1000);

  console.log(`[Flow Worker] Running, processing every ${INTERVAL_MS / 1000}s`);
}


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


main().catch((error) => {
  console.error("[Flow Worker] Fatal error:", error);
  process.exit(1);
});
