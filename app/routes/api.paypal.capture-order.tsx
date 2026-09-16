





import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import {
  capturePayPalOrder,
  getCompletedPayPalCaptureDetails,
  getPayPalCheckoutOrderDetails,
  getPayPalOrder,
  isPayPalConfigured,
} from '~/lib/paypal.server';
import prisma from '~/lib/prisma.server';
import { authenticate } from '~/shopify.server';
import {
  amountStringToCents,
  HostedCheckoutReservationError,
  parseHostedCheckoutReservation,
  settleHostedCheckoutReservation,
} from '~/lib/hostedCheckoutReservation.server';

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

  const body = await request.json();
  const paypalOrderId =
    typeof body.paypalOrderId === 'string' ? body.paypalOrderId.trim() : '';

  if (!paypalOrderId) {
    return json({ error: 'PayPal order ID is required' }, { status: 400 });
  }

  try {
    // Retrieve and authenticate the PayPal order before capturing it. The old
    // flow captured any submitted order ID first and only looked for a local
    // audit row afterwards.
    const existingOrder = await getPayPalOrder(paypalOrderId);
    const orderDetails = getPayPalCheckoutOrderDetails(existingOrder);
    if (orderDetails.shopReference !== shopDomain) {
      throw new HostedCheckoutReservationError(
        'This PayPal order does not belong to the authenticated shop.',
        'invalid_reservation'
      );
    }

    const auditLog = await prisma.auditLog.findUnique({
      where: { id: orderDetails.customId },
    });
    if (!auditLog || auditLog.shopId !== shop.id) {
      throw new HostedCheckoutReservationError(
        'Could not resolve this PayPal order to a fee reservation for the authenticated shop.',
        'invalid_reservation'
      );
    }

    const snapshot = parseHostedCheckoutReservation(auditLog.metadata);
    if (
      !snapshot ||
      snapshot.provider !== 'paypal' ||
      snapshot.reservationRef !== orderDetails.customId
    ) {
      throw new HostedCheckoutReservationError(
        'This PayPal order predates atomic fee reservations or has invalid reservation metadata.',
        'invalid_reservation'
      );
    }

    const orderAmountCents = amountStringToCents(orderDetails.amount);
    if (
      orderAmountCents !== snapshot.totalCents ||
      orderDetails.currency.toUpperCase() !== snapshot.currency
    ) {
      throw new HostedCheckoutReservationError(
        'The PayPal order amount or currency does not match the reserved fee rows.',
        'payment_mismatch'
      );
    }

    let capture = existingOrder;
    if (capture.status !== 'COMPLETED') {
      if (capture.status !== 'APPROVED') {
        return json(
          { error: `Payment is not ready to capture. Status: ${capture.status}` },
          { status: 400 }
        );
      }
      capture = await capturePayPalOrder(paypalOrderId);
    }

    const captureDetails = getCompletedPayPalCaptureDetails(capture);
    const captureId = captureDetails.captureId;
    const captureAmount = captureDetails.amount;
    const payerEmail = capture.payer?.email_address || 'unknown';
    const payerId = capture.payer?.payer_id || '';

    const settlement = await settleHostedCheckoutReservation({
      shopId: shop.id,
      snapshot,
      provider: 'paypal',
      captureRef: captureId,
      providerSessionId: paypalOrderId,
      providerAmountCents: amountStringToCents(captureAmount),
      providerCurrency: captureDetails.currency,
      source: 'capture_route',
      extraMetadata: {
        paypalOrderId,
        payerEmail,
      },
    });


    const captureRaw = capture as unknown as Record<string, unknown>;
    const paymentSource = captureRaw.payment_source as Record<string, unknown> | undefined;
    const paypalSource = paymentSource?.paypal as Record<string, unknown> | undefined;
    const vaultAttributes = paypalSource?.attributes as Record<string, unknown> | undefined;
    const vaultData = vaultAttributes?.vault as { id?: string; status?: string } | undefined;

    if (vaultData?.id && vaultData?.status === 'VAULTED') {

      await prisma.shop.update({
        where: { id: shop.id },
        data: {
          paypalVaultId: vaultData.id,
          paypalPayerId: payerId,
          paypalPayerEmail: payerEmail,
          paypalAutoCharge: true,
          paypalVaultedAt: new Date(),
        },
      });
      console.log(`[PayPal] Vault saved for ${shopDomain}: vault=${vaultData.id}, payer=${payerId}`);
    }

    console.log(
      `[PayPal] Payment captured for ${shopDomain}: $${captureAmount} (${settlement.markedCount} orders) - Capture: ${captureId}`
    );

    return json({
      success: true,
      captureId,
      amount: captureAmount,
      markedCount: settlement.markedCount,
      alreadyProcessed: settlement.alreadyProcessed,
      payerEmail,
    });
  } catch (error) {
    console.error('[PayPal] Capture error:', error);


    await prisma.auditLog.create({
      data: {
        shopId: shop.id,
        action: 'paypal_payment_failed',
        resourceType: 'paypal_capture',
        resourceId: paypalOrderId,
        metadata: {
          paypalOrderId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      },
    });

    return json(
      { error: error instanceof Error ? error.message : 'PayPal capture failed' },
      { status: 500 }
    );
  }
}
