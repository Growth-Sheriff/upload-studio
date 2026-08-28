import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import prisma from "~/lib/prisma.server";

// APP_UNINSTALLED must NOT delete data.
//
// History: this handler used to `prisma.shop.delete(...)` immediately, which
// cascade-deleted every upload, order link, product config and pricing row
// the moment a merchant uninstalled — even an accidental uninstall followed
// by an immediate reinstall lost everything (fast-dtf-transfer, 2026-07-29).
//
// Correct model: uninstall only deactivates. Actual data deletion is the job
// of the mandatory GDPR `shop/redact` webhook, which Shopify sends ~48h after
// uninstall *unless the app was reinstalled* — exactly the grace period we
// want (see api.gdpr.shop.redact.tsx).

export async function action({ request }: ActionFunctionArgs) {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`[Webhook] ${topic} for shop: ${shop}`);

  try {
    const existingShop = await prisma.shop.findUnique({
      where: { shopDomain: shop },
    });

    if (existingShop) {
      const settings =
        existingShop.settings && typeof existingShop.settings === "object"
          ? (existingShop.settings as Record<string, unknown>)
          : {};

      await prisma.shop.update({
        where: { shopDomain: shop },
        data: {
          billingStatus: "uninstalled",
          settings: {
            ...settings,
            uninstalledAt: new Date().toISOString(),
          },
        },
      });

      await prisma.auditLog.create({
        data: {
          shopId: existingShop.id,
          action: "app_uninstalled",
          resourceType: "shop",
          resourceId: existingShop.id,
          metadata: { shopDomain: shop },
        },
      });

      console.log(
        `[Webhook] Marked shop ${shop} as uninstalled (data retained; deletion deferred to shop/redact)`
      );
    } else {
      console.log(`[Webhook] Shop ${shop} not found in database, nothing to deactivate`);
    }
  } catch (error) {
    console.error(`[Webhook] Error deactivating shop ${shop}:`, error);
  }

  return json({ success: true });
}
