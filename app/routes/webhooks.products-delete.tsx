import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "~/lib/prisma.server";
import { authenticate } from "~/shopify.server";


export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const { shop: shopDomain, payload: product } = await authenticate.webhook(request);

  try {
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
        productId: { in: [String(product.id), `gid://shopify/Product/${product.id}`] },
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

