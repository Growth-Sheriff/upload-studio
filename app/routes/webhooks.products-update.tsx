import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "~/lib/prisma.server";
import { syncTwinPrices } from "~/lib/compatibilityTwin.server";
import { authenticate } from "~/shopify.server";


export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  // The shared authenticator verifies HMAC and binds the verified shop to this
  // request before any scoped product/audit query. A header alone is not scope.
  const { shop: shopDomain, payload: product } = await authenticate.webhook(request);

  try {
    console.log(`[Webhook] Product updated: ${product.id} for shop: ${shopDomain}`);


    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
    });

    if (!shop) {
      console.log(`[Webhook] Shop not found: ${shopDomain}`);
      return json({ success: true });
    }


    const productConfig = await prisma.productConfig.findFirst({
      where: {
        shopId: shop.id,
        productId: { in: [String(product.id), `gid://shopify/Product/${product.id}`] },
      },
    });

    if (productConfig) {

      await prisma.auditLog.create({
        data: {
          shopId: shop.id,
          action: "product_updated",
          resourceType: "product",
          resourceId: String(product.id),
          metadata: {
            title: product.title,
            status: product.status,
            updatedAt: product.updated_at,
          },
        },
      });

      console.log(`[Webhook] Logged product update for ${product.id}`);
    }

    // Compatibility-mode auto sync: when the PAGE product changes and it has
    // a cart twin with auto-sync on, mirror variant prices onto the twin.
    // Twin rows carry builderConfig.compatibilityTwinOf and are skipped here,
    // which also breaks the update->sync->update loop (our own bulk update
    // fires this webhook again for the twin, not for the page product).
    try {
      const pageGid = `gid://shopify/Product/${product.id}`;
      const pageConfig = await prisma.productConfig.findFirst({
        where: { shopId: shop.id, productId: pageGid },
        select: { builderConfig: true },
      });
      const builderConfig = (pageConfig?.builderConfig as Record<string, unknown> | null) || {};
      const twinGid = typeof builderConfig.cartProductId === "string" ? builderConfig.cartProductId : null;
      const isTwinItself = Boolean(builderConfig.compatibilityTwinOf);
      const autoSync = builderConfig.cartAutoSync !== false;

      if (twinGid && !isTwinItself && autoSync) {
        const updated = await syncTwinPrices(
          { shopDomain, accessToken: shop.accessToken },
          pageGid,
          twinGid
        );
        if (updated > 0) {
          console.log(`[Webhook] Compatibility twin price sync: ${updated} variant(s) for ${product.id}`);
          await prisma.auditLog.create({
            data: {
              shopId: shop.id,
              action: "compatibility_twin_synced",
              resourceType: "product",
              resourceId: String(product.id),
              metadata: { twinGid, variantsUpdated: updated },
            },
          });
        }
      }
    } catch (syncError) {
      // Sync is a convenience layer; never fail the webhook over it.
      console.warn("[Webhook] Compatibility twin sync failed (non-fatal):", syncError);
    }

    return json({ success: true });
  } catch (error) {
    console.error("[Webhook] Error processing products/update:", error);
    return json({ error: "Processing failed" }, { status: 500 });
  }
}

