/**
 * Stripe Confirm Payment API
 *
 * Called after merchant returns from Stripe Checkout.
 * Verifies the session, saves the payment method for auto-charge,
 * and marks commissions as paid.
 */
import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { retrieveCheckoutSession, getOrCreateCustomer, isStripeConfigured } from '~/lib/stripe.server';
import prisma from '~/lib/prisma.server';
import { authenticate } from '~/shopify.server';

const COMMISSION_PER_ORDER = 0.1;

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

  const body = await request.json();
  const { sessionId } = body;

  if (!sessionId) {
    return json({ error: 'Stripe session ID is required' }, { status: 400 });
  }

  try {
    // Retrieve and verify the checkout session
    const capture = await retrieveCheckoutSession(sessionId);

    if (capture.status !== 'succeeded') {
      console.error('[Stripe] Payment not succeeded:', capture.status);
      return json(
        { error: `Payment not completed. Status: ${capture.status}` },
        { status: 400 }
      );
    }

    // Save Stripe customer/payment method for future auto-charges
    if (capture.paymentMethodId) {
      let customerId = capture.customerId;

      // If no customer was created during checkout, create one now
      if (!customerId) {
        customerId = await getOrCreateCustomer(shopDomain, capture.customerEmail);
      }

      await prisma.shop.update({
        where: { id: shop.id },
        data: {
          stripeCustomerId: customerId,
          stripePaymentMethodId: capture.paymentMethodId,
          stripeAutoCharge: true,
          stripeEmail: capture.customerEmail,
          stripeSetupAt: new Date(),
        },
      });

      console.log(
        `[Stripe] Payment method saved for ${shopDomain}: customer=${customerId}, pm=${capture.paymentMethodId}`
      );
    }

    // Find audit log with pending order IDs
    const auditLog = await prisma.auditLog.findFirst({
      where: {
        shopId: shop.id,
        action: 'stripe_checkout_created',
        resourceId: sessionId,
      },
      orderBy: { createdAt: 'desc' },
    });

    let pendingOrderIds: string[] = [];

    if (auditLog && auditLog.metadata) {
      const metadata = auditLog.metadata as { orderIds?: string[] };
      pendingOrderIds = metadata.orderIds || [];
    }

    // Fallback: get all pending order IDs if audit log not found
    if (pendingOrderIds.length === 0) {
      const orderLinks = await prisma.orderLink.findMany({
        where: { shopId: shop.id },
        select: { orderId: true },
      });

      const allOrderIds = [...new Set(orderLinks.map((ol) => ol.orderId))];

      const paidCommissions = await prisma.commission.findMany({
        where: { shopId: shop.id, status: 'paid' },
        select: { orderId: true },
      });

      const paidSet = new Set(paidCommissions.map((c) => c.orderId));
      pendingOrderIds = allOrderIds.filter((id) => !paidSet.has(id));
    }

    // Mark all pending commissions as paid
    let markedCount = 0;
    for (const orderId of pendingOrderIds) {
      await prisma.commission.upsert({
        where: {
          commission_shop_order: {
            shopId: shop.id,
            orderId: orderId,
          },
        },
        create: {
          shopId: shop.id,
          orderId: orderId,
          orderNumber: `#${orderId.slice(-6)}`,
          orderTotal: 0,
          orderCurrency: 'USD',
          commissionRate: 0,
          commissionAmount: COMMISSION_PER_ORDER,
          status: 'paid',
          paidAt: new Date(),
          paymentRef: capture.paymentIntentId,
          paymentProvider: 'stripe',
        },
        update: {
          status: 'paid',
          paidAt: new Date(),
          paymentRef: capture.paymentIntentId,
          paymentProvider: 'stripe',
        },
      });
      markedCount++;
    }

    // Audit log
    await prisma.auditLog.create({
      data: {
        shopId: shop.id,
        action: 'stripe_payment_captured',
        resourceType: 'stripe_payment',
        resourceId: capture.paymentIntentId,
        metadata: {
          sessionId,
          paymentIntentId: capture.paymentIntentId,
          amount: capture.amount,
          customerEmail: capture.customerEmail,
          customerId: capture.customerId,
          markedCount,
          orderIds: pendingOrderIds,
        },
      },
    });

    console.log(
      `[Stripe] Payment ${capture.paymentIntentId} captured for ${shopDomain}: ${markedCount} orders marked paid`
    );

    return json({
      success: true,
      paymentIntentId: capture.paymentIntentId,
      markedCount,
      amount: capture.amount / 100,
    });
  } catch (error) {
    console.error('[Stripe] Confirm payment error:', error);
    return json(
      { error: error instanceof Error ? error.message : 'Stripe payment confirmation failed' },
      { status: 500 }
    );
  }
}
