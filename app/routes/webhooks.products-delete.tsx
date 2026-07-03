import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import crypto from "crypto";
import prisma from "~/lib/prisma.server";


function verifyWebhookSignature(body: string, hmac: string, secret: string): boolean {
  const hash = crypto
    .createHmac("sha256", secret)
    .update(body, "utf8")
    .digest("base64");

  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(hmac));
}


export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const hmac = request.headers.get("X-Shopify-Hmac-Sha256");
  const shopDomain = request.headers.get("X-Shopify-Shop-Domain");

  if (!hmac || !shopDomain) {
    return json({ error: "Missing headers" }, { status: 400 });
  }

  const body = await request.text();
  const secret = process.env.SHOPIFY_API_SECRET || "";

  if (!verifyWebhookSignature(body, hmac, secret)) {
    return json({ error: "Invalid signature" }, { status: 401 });
  }

  try {
    const product = JSON.parse(body);
    console.log(`[Webhook] Product deleted: ${product.id} for shop: ${shopDomain}`);


    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
    });

    if (!shop) {
      console.log(`[Webhook] Shop not found: ${shopDomain}`);
      return json({ success: true });
    }


    const deleted = await prisma.productConfig.deleteMany({
      where: {
        shopId: shop.id,
        productId: String(product.id),
      },
    });

    if (deleted.count > 0) {

      await prisma.auditLog.create({
        data: {
          shopId: shop.id,
          action: "product_deleted",
          resourceType: "product",
          resourceId: String(product.id),
          metadata: {
            deletedAt: new Date().toISOString(),
          },
        },
      });

      console.log(`[Webhook] Deleted config for product ${product.id}`);
    }

    return json({ success: true, configsDeleted: deleted.count });
  } catch (error) {
    console.error("[Webhook] Error processing products/delete:", error);
    return json({ error: "Processing failed" }, { status: 500 });
  }
}

