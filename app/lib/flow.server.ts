/**
 * Shopify Flow Triggers
 *
 * Events:
 * - upload_received: New upload submitted
 * - upload_approved: Upload approved
 * - upload_rejected: Upload rejected
 * - preflight_warning: Preflight check has warnings
 * - preflight_error: Preflight check failed
 * - export_completed: Export job finished
 */

import prisma from "~/lib/prisma.server";

// Flow event types
export const FLOW_EVENTS = {
  UPLOAD_RECEIVED: "upload_received",
  UPLOAD_APPROVED: "upload_approved",
  UPLOAD_REJECTED: "upload_rejected",
  PREFLIGHT_WARNING: "preflight_warning",
  PREFLIGHT_ERROR: "preflight_error",
  EXPORT_COMPLETED: "export_completed",
} as const;

export type FlowEventType = typeof FLOW_EVENTS[keyof typeof FLOW_EVENTS];

// Event payload types
interface BasePayload {
  timestamp: string;
  shopDomain: string;
}

interface UploadPayload extends BasePayload {
  uploadId: string;
  mode: string;
  productId?: string;
  variantId?: string;
  customerId?: string;
  customerEmail?: string;
  itemCount: number;
  locations: string[];
}

interface PreflightPayload extends BasePayload {
  uploadId: string;
  itemId: string;
  location: string;
  status: string;
  checks: Array<{
    name: string;
    status: string;
    message?: string;
  }>;
}

interface ExportPayload extends BasePayload {
  exportId: string;
  uploadCount: number;
  downloadUrl?: string;
  status: string;
}

type FlowPayload = UploadPayload | PreflightPayload | ExportPayload;

/**
 * Queue a Flow trigger for processing
 */
export async function queueFlowTrigger(
  shopId: string,
  eventType: FlowEventType,
  resourceId: string,
  payload: FlowPayload
): Promise<void> {
  try {
    await prisma.flowTrigger.create({
      data: {
        shopId,
        eventType,
        resourceId,
        payload,
        status: "pending",
      },
    });

    console.log(`[Flow] Queued ${eventType} for shop ${shopId}`);
  } catch (error) {
    console.error("[Flow] Failed to queue trigger:", error);
  }
}

/**
 * Send Flow trigger to Shopify
 * Called by a worker or cron job
 */
export async function sendFlowTrigger(triggerId: string, shopId?: string): Promise<boolean> {
  const whereClause = shopId
    ? { id: triggerId, shopId }
    : { id: triggerId };

  const trigger = await prisma.flowTrigger.findFirst({
    where: whereClause,
    include: {
      shop: {
        select: { shopDomain: true, accessToken: true },
      },
    },
  });

  if (!trigger) {
    console.error("[Flow] Trigger not found:", triggerId);
    return false;
  }

  try {
    // Shopify Flow trigger API call
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
      throw new Error(
        result.errors?.[0]?.message ||
        result.data?.flowTriggerReceive?.userErrors?.[0]?.message ||
        "Unknown error"
      );
    }

    // Mark as sent
    await prisma.flowTrigger.updateMany({
      where: { id: triggerId, shopId: trigger.shopId },
      data: {
        status: "sent",
        sentAt: new Date(),
      },
    });

    console.log(`[Flow] Sent ${trigger.eventType} successfully`);
    return true;

  } catch (error) {
    const attempts = trigger.attempts + 1;
    const maxAttempts = 3;

    await prisma.flowTrigger.updateMany({
      where: { id: triggerId, shopId: trigger.shopId },
      data: {
        status: attempts >= maxAttempts ? "failed" : "pending",
        attempts,
        error: String(error),
      },
    });

    console.error(`[Flow] Failed to send ${trigger.eventType}:`, error);
    return false;
  }
}

/**
 * Helper: Trigger upload received event
 */
export async function triggerUploadReceived(
  shopId: string,
  shopDomain: string,
  upload: {
    id: string;
    mode: string;
    productId?: string | null;
    variantId?: string | null;
    customerId?: string | null;
    customerEmail?: string | null;
    items: Array<{ location: string }>;
  }
): Promise<void> {
  await queueFlowTrigger(shopId, FLOW_EVENTS.UPLOAD_RECEIVED, upload.id, {
    timestamp: new Date().toISOString(),
    shopDomain,
    uploadId: upload.id,
    mode: upload.mode,
    productId: upload.productId || undefined,
    variantId: upload.variantId || undefined,
    customerId: upload.customerId || undefined,
    customerEmail: upload.customerEmail || undefined,
    itemCount: upload.items.length,
    locations: upload.items.map(i => i.location),
  });
}

/**
 * Helper: Trigger preflight warning/error event
 */
export async function triggerPreflightResult(
  shopId: string,
  shopDomain: string,
  uploadId: string,
  item: {
    id: string;
    location: string;
    preflightStatus: string;
    preflightResult: any;
  }
): Promise<void> {
  if (item.preflightStatus === "ok") return;

  const eventType = item.preflightStatus === "error"
    ? FLOW_EVENTS.PREFLIGHT_ERROR
    : FLOW_EVENTS.PREFLIGHT_WARNING;

  await queueFlowTrigger(shopId, eventType, item.id, {
    timestamp: new Date().toISOString(),
    shopDomain,
    uploadId,
    itemId: item.id,
    location: item.location,
    status: item.preflightStatus,
    checks: item.preflightResult?.checks || [],
  });
}

/**
 * Helper: Trigger export completed event
 */
export async function triggerExportCompleted(
  shopId: string,
  shopDomain: string,
  exportJob: {
    id: string;
    uploadIds: string[];
    status: string;
    downloadUrl?: string | null;
  }
): Promise<void> {
  await queueFlowTrigger(shopId, FLOW_EVENTS.EXPORT_COMPLETED, exportJob.id, {
    timestamp: new Date().toISOString(),
    shopDomain,
    exportId: exportJob.id,
    uploadCount: exportJob.uploadIds.length,
    downloadUrl: exportJob.downloadUrl || undefined,
    status: exportJob.status,
  });
}

