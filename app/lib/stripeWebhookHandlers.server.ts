import type Stripe from 'stripe';
import prisma from '~/lib/prisma.server';
import { applySuccessfulStripeCheckout } from '~/lib/stripeCheckout.server';

export type HandlerResult = { matched: boolean; detail?: string };

export async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
  eventId: string
): Promise<HandlerResult> {
  if (!session.id) return { matched: false, detail: 'missing_session_id' };

  const shopDomain = session.metadata?.shopDomain;
  if (shopDomain) {
    const shop = await prisma.shop.findUnique({ where: { shopDomain }, select: { id: true } });
    if (!shop) return { matched: false, detail: 'shop_not_in_tenant' };
  }

  try {
    const result = await applySuccessfulStripeCheckout(session.id, 'webhook', eventId);
    console.log(
      `[Stripe Webhook] checkout.session.completed for ${result.shopDomain}: ${result.markedCount} orders marked paid`
    );
    return { matched: true, detail: `marked=${result.markedCount}` };
  } catch (err) {
    if (err instanceof Error && /shop not found/i.test(err.message)) {
      return { matched: false, detail: 'shop_not_in_tenant' };
    }
    throw err;
  }
}

export async function handlePaymentIntentSucceeded(
  paymentIntent: Stripe.PaymentIntent,
  eventId: string
): Promise<HandlerResult> {
  const piId = paymentIntent.id;
  const shopDomain = paymentIntent.metadata?.shopDomain;
  if (!piId || !shopDomain) return { matched: false, detail: 'no_pi_or_shop' };

  const shop = await prisma.shop.findUnique({ where: { shopDomain }, select: { id: true } });
  if (!shop) return { matched: false, detail: 'shop_not_in_tenant' };

  const existing = await prisma.commission.findFirst({
    where: { paymentRef: piId },
    select: { id: true },
  });
  if (existing) return { matched: true, detail: 'already_processed' };

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
  return { matched: true, detail: 'audit_logged' };
}

export async function handlePaymentIntentFailed(
  paymentIntent: Stripe.PaymentIntent,
  eventId: string
): Promise<HandlerResult> {
  const piId = paymentIntent.id;
  const shopDomain = paymentIntent.metadata?.shopDomain;
  if (!shopDomain) return { matched: false, detail: 'no_shop' };

  const shop = await prisma.shop.findUnique({ where: { shopDomain }, select: { id: true } });
  if (!shop) return { matched: false, detail: 'shop_not_in_tenant' };

  console.error(`[Stripe Webhook] Payment FAILED: ${piId} for ${shopDomain}`);
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
  return { matched: true };
}

export async function handleChargeRefunded(
  charge: Stripe.Charge,
  eventId: string
): Promise<HandlerResult> {
  const paymentIntentId =
    typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : charge.payment_intent?.id || null;
  if (!paymentIntentId) return { matched: false, detail: 'no_payment_intent' };

  const affected = await prisma.commission.findMany({
    where: { paymentRef: paymentIntentId },
    select: { id: true, shopId: true },
  });
  if (affected.length === 0) return { matched: false, detail: 'no_commission_in_tenant' };

  const shopId = affected[0].shopId;
  if (!affected.every((c) => c.shopId === shopId)) {
    console.error('[Stripe Webhook] Refund: cross-tenant commission detected, aborting');
    return { matched: false, detail: 'cross_tenant_abort' };
  }

  await prisma.commission.updateMany({
    where: { paymentRef: paymentIntentId, shopId },
    data: { status: 'pending', paidAt: null, paymentRef: null, paymentProvider: null },
  });
  await prisma.auditLog.create({
    data: {
      shopId,
      action: 'stripe_webhook_charge_refunded',
      resourceType: 'stripe_webhook',
      resourceId: charge.id || eventId,
      metadata: {
        eventId,
        chargeId: charge.id,
        paymentIntentId,
        revertedCount: affected.length,
      },
    },
  });
  console.log(
    `[Stripe Webhook] Refund processed: ${affected.length} commissions reverted to pending`
  );
  return { matched: true, detail: `reverted=${affected.length}` };
}

export async function dispatchEvent(event: Stripe.Event): Promise<HandlerResult> {
  switch (event.type) {
    case 'checkout.session.completed':
      return handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session, event.id);
    case 'payment_intent.succeeded':
      return handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent, event.id);
    case 'payment_intent.payment_failed':
      return handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent, event.id);
    case 'charge.refunded':
      return handleChargeRefunded(event.data.object as Stripe.Charge, event.id);
    default:
      return { matched: false, detail: `unhandled_type=${event.type}` };
  }
}
