





import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { createPayPalOrder, createPayPalOrderWithVault, isPayPalConfigured } from '~/lib/paypal.server';
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

  if (!isPayPalConfigured()) {
    return json({ error: 'PayPal is not configured' }, { status: 500 });
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

  let reservation: HostedCheckoutReservation;
  try {
    reservation = await reserveFeesForHostedCheckout({
      shopId: shop.id,
      provider: 'paypal',
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

    const hasVault = Boolean(shop.paypalVaultId);
    let order;

    if (hasVault) {

      order = await createPayPalOrder(
        totalAmount,
        shopDomain,
        reservation.description,
        reservation.reservationRef
      );
    } else {
      // Never fall back to a second request shape after a failed provider
      // call. A timeout can mean the vaulted order exists; creating a normal
      // order with a different idempotency key would produce two payable
      // sessions for the same reservation.
      order = await createPayPalOrderWithVault(
        totalAmount,
        shopDomain,
        reservation.description,
        reservation.reservationRef
      );
    }


    const approvalLink = order.links.find((link) => link.rel === 'approve');

    if (!approvalLink) {
      // PayPal did create an identifiable order. Persist that identity before
      // quarantining the reservation so support/reconciliation can retrieve
      // provider state even though the merchant cannot continue from this
      // response.
      await markHostedCheckoutSessionCreated({
        reservationRef: reservation.reservationRef,
        provider: 'paypal',
        providerSessionId: order.id,
        checkoutUrl: null,
      });
      console.error('[PayPal] No approval link in response:', {
        orderId: order.id,
        status: order.status,
      });
      throw new Error('PayPal did not return an approval URL');
    }



    await markHostedCheckoutSessionCreated({
      reservationRef: reservation.reservationRef,
      provider: 'paypal',
      providerSessionId: order.id,
      checkoutUrl: approvalLink.href,
    });

    console.log(
      `[PayPal] Order ${order.id} created for ${shopDomain}: $${totalAmount} (${reservation.orderIds.length} orders)`
    );

    return json({
      success: true,
      paypalOrderId: order.id,
      approvalUrl: approvalLink.href,
      amount: totalAmount,
      orderCount: reservation.orderIds.length,
    });
  } catch (error) {
    console.error('[PayPal] Create order error:', error);
    // A timeout after the request left this process cannot prove that PayPal
    // did not create the idempotent order. Never return these rows to the
    // auto-charge pool without provider reconciliation.
    await markHostedCheckoutCreationUnknown({
      reservationRef: reservation.reservationRef,
      provider: 'paypal',
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
    return json(
      {
        error:
          'PayPal order creation could not be confirmed. The selected fees remain reserved and will not be auto-charged; refresh billing before trying again.',
      },
      { status: 500 }
    );
  }
}
