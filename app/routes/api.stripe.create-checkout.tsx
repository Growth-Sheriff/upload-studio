





import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { createCheckoutSession, getOrCreateCustomer, isStripeConfigured } from '~/lib/stripe.server';
import prisma from '~/lib/prisma.server';
import { authenticate } from '~/shopify.server';
import {
  HostedCheckoutReservationError,
  markHostedCheckoutCreationUnknown,
  markHostedCheckoutSessionCreated,
  reserveFeesForHostedCheckout,
} from '~/lib/hostedCheckoutReservation.server';
import type { HostedCheckoutReservation } from '~/lib/hostedCheckoutReservation.server';

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

  }

  const hasExistingPaymentMethod = Boolean(shop.stripePaymentMethodId);

  // Resolve the Stripe customer before reserving fee rows. This step cannot
  // collect money, and doing it first keeps a customer API outage from
  // needlessly quarantining fees.
  let stripeCustomerId = shop.stripeCustomerId || null;
  if (!stripeCustomerId) {
    try {
      stripeCustomerId = await getOrCreateCustomer(shopDomain, shop.stripeEmail);
      await prisma.shop.update({ where: { id: shop.id }, data: { stripeCustomerId } });
    } catch (customerError) {
      console.warn('[Stripe] customer ensure failed, falling back to email session:', customerError);
      stripeCustomerId = null;
    }
  }

  let reservation: HostedCheckoutReservation;
  try {
    reservation = await reserveFeesForHostedCheckout({
      shopId: shop.id,
      provider: 'stripe',
      requestedOrderIds,
      monthKey,
    });
  } catch (error) {
    if (error instanceof HostedCheckoutReservationError) {
      const status = error.code === 'no_outstanding_fees' ? 400 : 409;
      return json({ error: error.message, code: error.code }, { status });
    }
    throw error;
  }

  const totalAmount = reservation.totalAmount.toFixed(2);

  try {

    const result = await createCheckoutSession(
      totalAmount,
      shopDomain,
      reservation.description,
      reservation.reservationRef,
      hasExistingPaymentMethod,
      shop.stripeEmail,
      stripeCustomerId
    );

    await markHostedCheckoutSessionCreated({
      reservationRef: reservation.reservationRef,
      provider: 'stripe',
      providerSessionId: result.sessionId,
      checkoutUrl: result.checkoutUrl,
    });

    console.log(
      `[Stripe] Checkout ${result.sessionId} created for ${shopDomain}: $${totalAmount} (${reservation.orderIds.length} orders)`
    );

    return json({
      success: true,
      sessionId: result.sessionId,
      checkoutUrl: result.checkoutUrl,
      amount: totalAmount,
      orderCount: reservation.orderIds.length,
    });
  } catch (error) {
    console.error('[Stripe] Create checkout error:', error);
    // Once the provider request starts, a timeout cannot prove that Stripe did
    // not create the idempotent session. Keep these rows out of auto-charge.
    await markHostedCheckoutCreationUnknown({
      reservationRef: reservation.reservationRef,
      provider: 'stripe',
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
    return json(
      {
        error:
          'Stripe checkout creation could not be confirmed. The selected fees remain reserved and will not be auto-charged; refresh billing before trying again.',
      },
      { status: 500 }
    );
  }
}
