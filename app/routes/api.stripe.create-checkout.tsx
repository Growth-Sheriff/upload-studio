/**
 * Stripe Create Checkout Session API
 *
 * Called from billing page when merchant clicks "Pay with Stripe"
 * Creates a Stripe Checkout Session and returns the checkout URL
 */
import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { createCheckoutSession, isStripeConfigured } from '~/lib/stripe.server';
import prisma from '~/lib/prisma.server';
import { authenticate } from '~/shopify.server';
import { getOutstandingFeeSelection } from '~/lib/billing.server';

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  if (!isStripeConfigured()) {
    return json({ error: 'Stripe is not configured' }, { status: 500 });
  }

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
  });

  if (!shop) {
    return json({ error: 'Shop not found' }, { status: 404 });
  }

  // Check if request body contains specific orderIds (per-month payment)
  let requestedOrderIds: string[] | null = null;
  let monthKey: string | null = null;
  try {
    const body = await request.json();
    if (body.orderIds && Array.isArray(body.orderIds) && body.orderIds.length > 0) {
      requestedOrderIds = body.orderIds;
    }
    if (body.monthKey) {
      monthKey = body.monthKey;
    }
  } catch {
    // No body or invalid JSON — pay all pending (default behavior)
  }

  const {
    orderIds: pendingOrderIds,
    totalAmount: total,
    description,
  } = await getOutstandingFeeSelection(shop.id, requestedOrderIds, monthKey);

  if (pendingOrderIds.length === 0) {
    return json({ error: 'No outstanding order fees to pay' }, { status: 400 });
  }

  const totalAmount = total.toFixed(2);

  try {
    // Create audit entry for reference
    const auditEntry = await prisma.auditLog.create({
      data: {
        shopId: shop.id,
        action: 'stripe_checkout_pending',
        resourceType: 'stripe_checkout',
        resourceId: 'pending',
        metadata: {
          orderIds: pendingOrderIds,
          amount: totalAmount,
          orderCount: pendingOrderIds.length,
        },
      },
    });

    const hasExistingPaymentMethod = Boolean(shop.stripePaymentMethodId);

    const result = await createCheckoutSession(
      totalAmount,
      shopDomain,
      description,
      auditEntry.id,
      hasExistingPaymentMethod
    );

    // Update audit log with session ID
    await prisma.auditLog.update({
      where: { id: auditEntry.id },
      data: {
        action: 'stripe_checkout_created',
        resourceId: result.sessionId,
        metadata: {
          sessionId: result.sessionId,
          auditRefId: auditEntry.id,
          orderIds: pendingOrderIds,
          amount: totalAmount,
          orderCount: pendingOrderIds.length,
        },
      },
    });

    console.log(
      `[Stripe] Checkout ${result.sessionId} created for ${shopDomain}: $${totalAmount} (${pendingOrderIds.length} orders)`
    );

    return json({
      success: true,
      sessionId: result.sessionId,
      checkoutUrl: result.checkoutUrl,
      amount: totalAmount,
      orderCount: pendingOrderIds.length,
    });
  } catch (error) {
    console.error('[Stripe] Create checkout error:', error);
    return json(
      { error: error instanceof Error ? error.message : 'Stripe checkout creation failed' },
      { status: 500 }
    );
  }
}
