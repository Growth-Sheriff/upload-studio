













import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import {
  getCompletedPayPalCaptureDetails,
  getPayPalCheckoutOrderDetails,
  getPayPalOrder,
  getPayPalRefundCaptureId,
  verifyWebhookSignature,
} from '~/lib/paypal.server';
import type { PayPalWebhookEvent } from '~/lib/paypal.server';
import prisma from '~/lib/prisma.server';
import {
  amountStringToCents,
  parseHostedCheckoutReservation,
  settleHostedCheckoutReservation,
} from '~/lib/hostedCheckoutReservation.server';

const PAYPAL_WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID || '';

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  const body = await request.text();


  let signatureVerified = false;
  if (PAYPAL_WEBHOOK_ID) {
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    const isValid = await verifyWebhookSignature(PAYPAL_WEBHOOK_ID, headers, body);
    if (!isValid) {
      console.error('[PayPal Webhook] Signature verification failed');
      return json({ error: 'Invalid signature' }, { status: 401 });
    }
    signatureVerified = true;
  } else {
    console.warn('[PayPal Webhook] No PAYPAL_WEBHOOK_ID set - skipping signature verification');
  }

  let event: PayPalWebhookEvent;
  try {
    event = JSON.parse(body);
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }

  console.log(`[PayPal Webhook] Received: ${event.event_type} (${event.id})`);

  switch (event.event_type) {
    case 'PAYMENT.CAPTURE.COMPLETED':
      await handleCaptureCompleted(event, signatureVerified);
      break;

    case 'PAYMENT.CAPTURE.DENIED':
      await handleCaptureDenied(event);
      break;

    case 'PAYMENT.CAPTURE.REFUNDED':
      await handleCaptureRefunded(event);
      break;

    default:
      console.log(`[PayPal Webhook] Unhandled event type: ${event.event_type}`);
  }


  return json({ received: true });
}





async function handleCaptureCompleted(
  event: PayPalWebhookEvent,
  signatureVerified: boolean
): Promise<void> {
  const captureId = event.resource?.id;
  const amount = event.resource?.amount?.value;
  const payerEmail = event.resource?.payer?.email_address;

  if (!captureId) {
    console.error('[PayPal Webhook] No capture ID in event');
    return;
  }

  console.log(
    `[PayPal Webhook] Capture completed: ${captureId}, amount: $${amount}, payer: ${payerEmail}`
  );

  // Never let an unsigned callback change financial rows. Deployments without
  // PAYPAL_WEBHOOK_ID can still settle through the authenticated capture
  // route, but webhook delivery remains observational only.
  if (!signatureVerified) {
    console.warn(
      `[PayPal Webhook] Capture ${captureId} not settled because webhook signature verification is disabled.`
    );
    return;
  }


  const paypalOrderId = event.resource?.supplementary_data?.related_ids?.order_id;
  if (!paypalOrderId) {
    throw new Error(`PayPal capture ${captureId} is missing its related order ID.`);
  }

  const order = await getPayPalOrder(paypalOrderId);
  const orderDetails = getPayPalCheckoutOrderDetails(order);
  const completedCapture = getCompletedPayPalCaptureDetails(order);
  if (completedCapture.captureId !== captureId) {
    throw new Error(
      `PayPal webhook capture ${captureId} does not match order capture ${completedCapture.captureId}.`
    );
  }
  if (
    amountStringToCents(String(amount || '')) !==
      amountStringToCents(completedCapture.amount) ||
    String(event.resource?.amount?.currency_code || '').toUpperCase() !==
      completedCapture.currency.toUpperCase()
  ) {
    throw new Error(`PayPal webhook amount does not match order ${paypalOrderId}.`);
  }

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: orderDetails.shopReference },
    select: { id: true },
  });
  if (!shop) throw new Error(`No tenant owns PayPal order ${paypalOrderId}.`);

  const auditLog = await prisma.auditLog.findUnique({
    where: { id: orderDetails.customId },
  });
  if (!auditLog || auditLog.shopId !== shop.id) {
    throw new Error(`PayPal order ${paypalOrderId} has no matching tenant reservation.`);
  }
  const snapshot = parseHostedCheckoutReservation(auditLog.metadata);
  if (
    !snapshot ||
    snapshot.provider !== 'paypal' ||
    snapshot.reservationRef !== orderDetails.customId
  ) {
    throw new Error(`PayPal order ${paypalOrderId} has invalid reservation metadata.`);
  }

  const settlement = await settleHostedCheckoutReservation({
    shopId: shop.id,
    snapshot,
    provider: 'paypal',
    captureRef: captureId,
    providerSessionId: paypalOrderId,
    providerAmountCents: amountStringToCents(completedCapture.amount),
    providerCurrency: completedCapture.currency,
    source: 'webhook',
    eventId: event.id,
    extraMetadata: { payerEmail: payerEmail || null },
  });

  console.log(
    `[PayPal Webhook] Capture ${captureId} settled ${settlement.markedCount} reserved fee rows (replay=${settlement.alreadyProcessed}).`
  );
}





async function handleCaptureDenied(event: PayPalWebhookEvent): Promise<void> {
  const captureId = event.resource?.id;
  console.error(`[PayPal Webhook] Payment DENIED: ${captureId}`);


  const auditLog = await prisma.auditLog.findFirst({
    where: {
      action: { in: ['paypal_order_created', 'paypal_payment_captured'] },
      resourceId: captureId || undefined,
    },
    orderBy: { createdAt: 'desc' },
  });

  if (auditLog) {
    await prisma.auditLog.create({
      data: {
        shopId: auditLog.shopId,
        action: 'paypal_webhook_capture_denied',
        resourceType: 'paypal_webhook',
        resourceId: captureId || event.id,
        metadata: {
          eventId: event.id,
          captureId,
          resource: event.resource,
        },
      },
    });
  }
}





async function handleCaptureRefunded(event: PayPalWebhookEvent): Promise<void> {
  const refundId = event.resource?.id;
  const captureId = getPayPalRefundCaptureId(event);
  console.warn(`[PayPal Webhook] Payment REFUNDED: refund=${refundId}, capture=${captureId}`);

  if (!captureId) return;


  const settledCommissions = await prisma.commission.findMany({
    where: { paymentRef: captureId },
    select: { id: true, shopId: true },
  })

  if (settledCommissions.length > 0) {
    const shopId = settledCommissions[0].shopId
    if (!settledCommissions.every((commission) => commission.shopId === shopId)) {
      console.error('[PayPal Webhook] Refund: cross-tenant commission detected, aborting')
      return
    }
    const alreadyRecorded = await prisma.auditLog.findFirst({
      where: {
        shopId,
        action: 'paypal_webhook_refund_review_required',
        resourceId: event.id,
      },
      select: { id: true },
    })
    if (alreadyRecorded) return

    // Keep paid rows immutable. A PayPal refund may be partial and does not by
    // itself decide whether the underlying app fee is still owed.
    await prisma.auditLog.create({
      data: {
        shopId,
        action: 'paypal_webhook_refund_review_required',
        resourceType: 'paypal_webhook',
        resourceId: event.id,
        metadata: {
          eventId: event.id,
          refundId,
          captureId,
          affectedCount: settledCommissions.length,
          refundStatus: event.resource?.status || null,
          refundAmount: event.resource?.amount || null,
        },
      },
    });
    console.log(
      `[PayPal Webhook] Refund recorded for review: ${settledCommissions.length} settled commissions left unchanged`
    );
  }
}
