import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import prisma from "~/lib/prisma.server";


export async function action({ request }: ActionFunctionArgs) {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`[Webhook] ${topic} for shop: ${shop}`);

  try {

    const existingShop = await prisma.shop.findUnique({
      where: { shopDomain: shop },
    });

    if (existingShop) {

      await prisma.shop.delete({
        where: { shopDomain: shop },
      });
      console.log(`[Webhook] Cleaned up data for shop: ${shop}`);
    } else {
      console.log(`[Webhook] Shop ${shop} not found in database, nothing to clean up`);
    }
  } catch (error) {
    console.error(`[Webhook] Error cleaning up shop ${shop}:`, error);
  }

  return json({ success: true });
}

