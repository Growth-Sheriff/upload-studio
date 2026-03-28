/**
 * Stripe Webhook Handler
 *
 * Receives Stripe webhook events for:
 * - checkout.session.completed - Payment successful via Checkout
 * - payment_intent.succeeded - Payment intent succeeded (auto-charge)
 * - payment_intent.payment_failed - Payment failed
 * - charge.refunded - Payment refunded
 *
 * This is a backup mechanism. The primary flow is:
 * 1. Merchant clicks "Pay with Stripe" → checkout → confirm-payment
 * 2. This webhook catches edge cases and auto-charge confirmations
 *
 * NO Shopify auth needed - this is called by Stripe servers
 */
import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { verifyWebhookEvent } from '~/lib/stripe.server';
import type Stripe from 'stripe';
import prisma from '~/lib/prisma.server';
import { applySuccessfulStripeCheckout } from '~/lib/stripeCheckout.server';

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }

  const body = await request.text();

  let event;
  try {
    event = verifyWebhookEvent(body, signature);
  } catch (err) {
    console.error('[Stripe Webhook] Signature verification failed:', err);
    return json({ error: 'Invalid signature' }, { status: 401 });
  }

  console.log(`[Stripe Webhook] Received: ${event.type} (${event.id})`);

  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session, event.id);
      break;

    case 'payment_intent.succeeded':
      await handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent, event.id);
      break;

    case 'payment_intent.payment_failed':
      await handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent, event.id);
      break;

    case 'charge.refunded':
      await handleChargeRefunded(event.data.object as Stripe.Charge, event.id);
      break;

    default:
      console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
  }

  // Always return 200 to Stripe
  return json({ received: true });
}

/**
 * Handle checkout.session.completed
 * This is the backup for the confirm-payment endpoint
 */
async function handleCheckoutCompleted(session: Stripe.Checkout.Session, eventId: string): Promise<void> {
  if (!session.id) {
    console.log('[Stripe Webhook] Missing checkout session ID');
    return;
  }

  try {
    const result = await applySuccessfulStripeCheckout(session.id, 'webhook', eventId);
    console.log(
      `[Stripe Webhook] Checkout completed for ${result.shopDomain}: ${result.markedCount} orders marked paid`
    );
  } catch (error) {
    console.error('[Stripe Webhook] checkout.session.completed processing failed:', error);
  }
}

/**
 * Handle payment_intent.succeeded (auto-charge confirmations)
 */
async function handlePaymentIntentSucceeded(paymentIntent: Stripe.PaymentIntent, eventId: string): Promise<void> {
  const piId = paymentIntent.id;
  const shopDomain = paymentIntent.metadata?.shopDomain;

  if (!piId || !shopDomain) return;

  // Check if already processed
  const existing = await prisma.commission.findFirst({
    where: { paymentRef: piId },
  });

  if (existing) {
    console.log(`[Stripe Webhook] PaymentIntent ${piId} already processed`);
    return;
  }

  // Find shop and log
  const shop = await prisma.shop.findUnique({ where: { shopDomain } });
  if (!shop) return;

  await prisma.auditLog.create({
    data: {
      shopId: shop.id,
      action: 'stripe_webhook_payment_succeeded',
      resourceType: 'stripe_webhook',
      resourceId: piId,
      metadata: {
        eventId,
        paymentIntentId: piId,
        amount: paymentIntent.amount,
        type: paymentIntent.metadata?.type,
      },
    },
  });

  console.log(`[Stripe Webhook] PaymentIntent ${piId} succeeded for ${shopDomain}`);
}

/**
 * Handle payment_intent.payment_failed
 */
async function handlePaymentIntentFailed(paymentIntent: Stripe.PaymentIntent, eventId: string): Promise<void> {
  const piId = paymentIntent.id;
  const shopDomain = paymentIntent.metadata?.shopDomain;

  console.error(`[Stripe Webhook] Payment FAILED: ${piId} for ${shopDomain}`);

  if (!shopDomain) return;

  const shop = await prisma.shop.findUnique({ where: { shopDomain } });
  if (!shop) return;

  await prisma.auditLog.create({
    data: {
      shopId: shop.id,
      action: 'stripe_webhook_payment_failed',
      resourceType: 'stripe_webhook',
      resourceId: piId || eventId,
      metadata: {
        eventId,
        paymentIntentId: piId,
        error: paymentIntent.last_payment_error?.message,
      },
    },
  });
}

/**
 * Handle charge.refunded
 */
async function handleChargeRefunded(charge: Stripe.Charge, eventId: string): Promise<void> {
  const paymentIntentId = typeof charge.payment_intent === 'string'
    ? charge.payment_intent
    : charge.payment_intent?.id || null;
  console.warn(`[Stripe Webhook] Charge REFUNDED: ${charge.id}, PI: ${paymentIntentId}`);

  if (!paymentIntentId) return;

  // Revert commissions to pending
  const affectedCommissions = await prisma.commission.findMany({
    where: { paymentRef: paymentIntentId },
  });

  if (affectedCommissions.length === 0) return;

  // Verify all affected commissions belong to the same shop (tenant isolation)
  const shopId = affectedCommissions[0].shopId;
  const allSameShop = affectedCommissions.every((c) => c.shopId === shopId);
  if (!allSameShop) {
    console.error('[Stripe Webhook] Refund: Cross-tenant commission detected! Aborting.');
    return;
  }

  await prisma.commission.updateMany({
    where: {
      paymentRef: paymentIntentId,
      shopId: shopId,
    },
    data: {
      status: 'pending',
      paidAt: null,
      paymentRef: null,
      paymentProvider: null,
    },
  });

  await prisma.auditLog.create({
    data: {
      shopId: shopId,
      action: 'stripe_webhook_charge_refunded',
      resourceType: 'stripe_webhook',
      resourceId: charge.id || eventId,
      metadata: {
        eventId,
        chargeId: charge.id,
        paymentIntentId,
        revertedCount: affectedCommissions.length,
      },
    },
  });

  console.log(
    `[Stripe Webhook] Refund: ${affectedCommissions.length} commissions reverted to pending`
  );
}
