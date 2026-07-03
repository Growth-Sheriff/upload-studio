











import prisma from "~/lib/prisma.server";


export const FLOW_EVENTS = {
  UPLOAD_RECEIVED: "upload_received",
  UPLOAD_APPROVED: "upload_approved",
  UPLOAD_REJECTED: "upload_rejected",
  PREFLIGHT_WARNING: "preflight_warning",
  PREFLIGHT_ERROR: "preflight_error",
  EXPORT_COMPLETED: "export_completed",
} as const;

export type FlowEventType = typeof FLOW_EVENTS[keyof typeof FLOW_EVENTS];

export const FLOW_TRIGGER_HANDLES: Record<FlowEventType, string> = {
  [FLOW_EVENTS.UPLOAD_RECEIVED]: "upload-received",
  [FLOW_EVENTS.UPLOAD_APPROVED]: "upload-approved",
  [FLOW_EVENTS.UPLOAD_REJECTED]: "upload-rejected",
  [FLOW_EVENTS.PREFLIGHT_WARNING]: "preflight-warning",
  [FLOW_EVENTS.PREFLIGHT_ERROR]: "preflight-error",
  [FLOW_EVENTS.EXPORT_COMPLETED]: "export-completed",
};

export function getFlowTriggerHandle(eventType: FlowEventType | string): string {
  const mappedHandle = FLOW_TRIGGER_HANDLES[eventType as FlowEventType];
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

export function isShopifyFlowTriggersEnabled(): boolean {
  const value = process.env.SHOPIFY_FLOW_TRIGGERS_ENABLED?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}


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




export async function queueFlowTrigger(
  shopId: string,
  eventType: FlowEventType,
  resourceId: string,
  payload: FlowPayload
): Promise<void> {
  try {
    if (!isShopifyFlowTriggersEnabled()) {
      console.log(`[Flow] Skipped queue for ${eventType}; Shopify Flow trigger dispatch is disabled`);
      return;
    }

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
    if (!isShopifyFlowTriggersEnabled()) {
      await prisma.flowTrigger.updateMany({
        where: { id: triggerId, shopId: trigger.shopId },
        data: {
          status: "skipped",
          error: "Shopify Flow trigger dispatch disabled for this deployment",
        },
      });
      return true;
    }

    const handle = getFlowTriggerHandle(trigger.eventType);


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
      throw new Error(
        result.errors?.[0]?.message ||
        result.data?.flowTriggerReceive?.userErrors?.[0]?.message ||
        "Unknown error"
      );
    }


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
