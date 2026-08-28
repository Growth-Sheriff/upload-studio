import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "~/lib/prisma.server";
import { reconcileOrder, verifyShopifyWebhookHmac } from "~/lib/orderReconciler.server";

// Thin adapter: verify -> parse -> reconcile. cancelled_at in the payload
// drives the archived transition (archived/shipped stay protected) inside
// the convergent reconciler.

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

    console.log(`[Webhook] Order cancelled: ${orderId} from ${shopDomain}`);

    const shop = await prisma.shop.findUnique({ where: { shopDomain } });
    if (!shop) {
      console.warn(`[Webhook] Shop not found: ${shopDomain}`);
      return json({ received: true });
    }

    const summary = await reconcileOrder(shop, payload, "orders/cancelled");

    await prisma.auditLog.create({
      data: {
        shopId: shop.id,
        action: "order_cancelled",
        resourceType: "order",
        resourceId: orderId,
        metadata: {
          affectedUploads: summary.affectedUploadIds,
          cancelReason: payload.cancel_reason || "unknown",
        },
      },
    });

    return json({ received: true, processed: summary.affectedUploadIds.length });
  } catch (error) {
    console.error("[Webhook] Error processing orders/cancelled:", error);
    return json({ error: "Processing failed" }, { status: 500 });
  }
}
