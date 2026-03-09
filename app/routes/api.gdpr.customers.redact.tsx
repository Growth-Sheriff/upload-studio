import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import prisma from "~/lib/prisma.server";

// GDPR: Customer redact
// POST /api/gdpr/customers/redact
export async function action({ request }: ActionFunctionArgs) {
  // Verify Shopify webhook HMAC signature
  const { shop, topic, payload } = await authenticate.webhook(request);
  
  console.log(`[GDPR] ${topic} for shop: ${shop}`);

  try {
    const { customer } = payload as { customer?: { id: number } };

    if (!customer?.id) {
      console.log("[GDPR] No customer ID in request");
      return json({ ok: true });
    }

    const shopRecord = await prisma.shop.findUnique({
      where: { shopDomain: shop },
    });

    if (shopRecord) {
      // Anonymize customer data in uploads
      const result = await prisma.upload.updateMany({
        where: {
          shopId: shopRecord.id,
          customerId: String(customer.id),
        },
        data: {
          customerId: "REDACTED",
          customerEmail: null,
        },
      });

      // Anonymize customer data in visitor records
      const visitorResult = await prisma.visitor.updateMany({
        where: {
          shopId: shopRecord.id,
          shopifyCustomerId: `gid://shopify/Customer/${customer.id}`,
        },
        data: {
          shopifyCustomerId: null,
          customerEmail: null,
        },
      });

      console.log(`[GDPR] Redacted ${result.count} uploads and ${visitorResult.count} visitors for customer ${customer.id} in shop ${shop}`);
      
      // Create audit log
      await prisma.auditLog.create({
        data: {
          shopId: shopRecord.id,
          action: "gdpr_customer_redact",
          entityType: "customer",
          entityId: String(customer.id),
          changes: { redactedUploads: result.count, redactedVisitors: visitorResult.count },
        },
      });
    } else {
      console.log(`[GDPR] Shop ${shop} not found, nothing to redact`);
    }

    return json({ ok: true });
  } catch (error) {
    console.error("[GDPR] Error processing customer redact:", error);
    return json({ ok: true }); // Still return 200 to acknowledge
  }
}

