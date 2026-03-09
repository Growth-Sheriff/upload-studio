import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "~/lib/prisma.server";
import crypto from "crypto";

// POST /webhooks/orders-fulfilled
// Shopify webhook for order fulfillment
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  // Verify HMAC
  const hmacHeader = request.headers.get("x-shopify-hmac-sha256");
  const shopDomain = request.headers.get("x-shopify-shop-domain");

  if (!hmacHeader || !shopDomain) {
    return json({ error: "Missing headers" }, { status: 401 });
  }

  const body = await request.text();
  const secret = process.env.SHOPIFY_API_SECRET || "";
  const hmac = crypto.createHmac("sha256", secret).update(body).digest("base64");

  if (hmac !== hmacHeader) {
    console.error("[Webhook] HMAC verification failed");
    return json({ error: "Invalid HMAC" }, { status: 401 });
  }

  try {
    const payload = JSON.parse(body);
    const orderId = String(payload.id);

    console.log(`[Webhook] Order fulfilled: ${orderId} from ${shopDomain}`);

    // Find shop
    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
    });

    if (!shop) {
      console.warn(`[Webhook] Shop not found: ${shopDomain}`);
      return json({ received: true });
    }

    // Find related uploads via OrderLink
    const orderLinks = await prisma.orderLink.findMany({
      where: { shopId: shop.id, orderId },
      include: { upload: true },
    });

    // Update upload statuses to shipped
    for (const link of orderLinks) {
      if (link.upload && link.upload.status === "printed") {
        await prisma.upload.updateMany({
          where: { id: link.uploadId, shopId: shop.id },
          data: { status: "shipped" },
        });

        console.log(`[Webhook] Upload ${link.uploadId} marked as shipped`);
      }
    }

    // Audit log
    await prisma.auditLog.create({
      data: {
        shopId: shop.id,
        action: "order_fulfilled",
        resourceType: "order",
        resourceId: orderId,
        metadata: {
          affectedUploads: orderLinks.map(l => l.uploadId),
          fulfillmentStatus: payload.fulfillment_status || "fulfilled",
          trackingNumbers: payload.fulfillments?.map((f: any) => f.tracking_number).filter(Boolean) || [],
        },
      },
    });

    return json({ received: true, processed: orderLinks.length });
  } catch (error) {
    console.error("[Webhook] Error processing orders/fulfilled:", error);
    return json({ error: "Processing failed" }, { status: 500 });
  }
}

