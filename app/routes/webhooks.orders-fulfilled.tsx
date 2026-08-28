import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "~/lib/prisma.server";
import { reconcileOrder, verifyShopifyWebhookHmac } from "~/lib/orderReconciler.server";

// Thin adapter: verify -> parse -> reconcile. fulfillment_status in the
// payload drives the printed -> shipped transition inside the convergent
// reconciler (only printed advances, exactly as before).

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const hmacHeader = request.headers.get("x-shopify-hmac-sha256");
  const shopDomain = request.headers.get("x-shopify-shop-domain");

  if (!hmacHeader || !shopDomain) {
    return json({ error: "Missing headers" }, { status: 401 });
  }

  const body = await request.text();
  if (!verifyShopifyWebhookHmac(body, hmacHeader, process.env.SHOPIFY_API_SECRET || "")) {
    console.error("[Webhook] HMAC verification failed");
    return json({ error: "Invalid HMAC" }, { status: 401 });
  }

  try {
    const payload = JSON.parse(body);
    const orderId = String(payload.id);

    console.log(`[Webhook] Order fulfilled: ${orderId} from ${shopDomain}`);

    const shop = await prisma.shop.findUnique({ where: { shopDomain } });
    if (!shop) {
      console.warn(`[Webhook] Shop not found: ${shopDomain}`);
      return json({ received: true });
    }

    const summary = await reconcileOrder(shop, payload, "orders/fulfilled");

    await prisma.auditLog.create({
      data: {
        shopId: shop.id,
        action: "order_fulfilled",
        resourceType: "order",
        resourceId: orderId,
        metadata: {
          affectedUploads: summary.affectedUploadIds,
          fulfillmentStatus: payload.fulfillment_status || "fulfilled",
          trackingNumbers: payload.fulfillments?.map((f: any) => f.tracking_number).filter(Boolean) || [],
        },
      },
    });

    return json({ received: true, processed: summary.affectedUploadIds.length });
  } catch (error) {
    console.error("[Webhook] Error processing orders/fulfilled:", error);
    return json({ error: "Processing failed" }, { status: 500 });
  }
}
