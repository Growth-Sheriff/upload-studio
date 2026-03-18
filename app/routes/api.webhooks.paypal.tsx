/**
 * PayPal Webhook Handler
 *
 * Receives PayPal webhook events for:
 * - PAYMENT.CAPTURE.COMPLETED - Payment successful
 * - PAYMENT.CAPTURE.DENIED - Payment denied
 * - PAYMENT.CAPTURE.REFUNDED - Payment refunded
 *
 * This is a backup mechanism. The primary flow is:
 * 1. Merchant clicks "Pay with PayPal" → create-order → approve → capture-order
 * 2. This webhook catches edge cases (e.g., delayed captures)
 *
 * NO Shopify auth needed - this is called by PayPal servers
 */
import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { verifyWebhookSignature } from '~/lib/paypal.server';
import type { PayPalWebhookEvent } from '~/lib/paypal.server';
import prisma from '~/lib/prisma.server';

const PAYPAL_WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID || '';

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  const body = await request.text();

  // Verify webhook signature (skip if no webhook ID configured)
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
      await handleCaptureCompleted(event);
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

  // Always return 200 to PayPal
  return json({ received: true });
}

/**
 * Handle PAYMENT.CAPTURE.COMPLETED
 * Marks commissions as paid if not already processed by capture-order endpoint
 */
async function handleCaptureCompleted(event: PayPalWebhookEvent): Promise<void> {
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

  // Check if this capture was already processed
  const existingCommission = await prisma.commission.findFirst({
    where: { paymentRef: captureId },
  });

  if (existingCommission) {
    console.log(`[PayPal Webhook] Capture ${captureId} already processed - skipping`);
    return;
  }

  // Try to find the PayPal order from audit logs to get the order IDs
  // The capture-order endpoint should have already handled this,
  // but this is a safety net
  // Scope by resourceId (captureId) to avoid cross-tenant audit log leakage
  const auditLog = await prisma.auditLog.findFirst({
    where: {
      action: { in: ['paypal_order_created', 'paypal_payment_captured'] },
      metadata: {
        path: ['captureId'],
        equals: captureId,
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  // If no captureId match, try by recent order for this specific capture
  const resolvedAuditLog = auditLog || await prisma.auditLog.findFirst({
    where: {
      action: 'paypal_payment_captured',
      resourceId: captureId,
    },
    orderBy: { createdAt: 'desc' },
  });

  // Log the webhook event for manual review if needed
  const shopForAudit = resolvedAuditLog
    ? await prisma.shop.findUnique({ where: { id: resolvedAuditLog.shopId } })
    : null;

  if (shopForAudit) {
    await prisma.auditLog.create({
      data: {
        shopId: shopForAudit.id,
        action: 'paypal_webhook_capture_completed',
        resourceType: 'paypal_webhook',
        resourceId: captureId,
        metadata: {
          eventId: event.id,
          captureId,
          amount,
          payerEmail,
          alreadyProcessed: !!existingCommission,
        },
      },
    });
  }

  console.log(
    `[PayPal Webhook] Capture ${captureId} logged. Check if capture-order already processed.`
  );
}

/**
 * Handle PAYMENT.CAPTURE.DENIED
 * Log the denial for review
 */
async function handleCaptureDenied(event: PayPalWebhookEvent): Promise<void> {
  const captureId = event.resource?.id;
  console.error(`[PayPal Webhook] Payment DENIED: ${captureId}`);

  // Find related shop from audit logs scoped to this capture
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

/**
 * Handle PAYMENT.CAPTURE.REFUNDED
 * If a payment is refunded, revert commission status to pending
 */
async function handleCaptureRefunded(event: PayPalWebhookEvent): Promise<void> {
  const captureId = event.resource?.id;
  console.warn(`[PayPal Webhook] Payment REFUNDED: ${captureId}`);

  if (!captureId) return;

  // Find commissions BEFORE reverting to capture shopId for audit log
  const commissionsToRevert = await prisma.commission.findMany({
    where: { paymentRef: captureId },
    select: { shopId: true },
    take: 1,
  })

  // Find commissions paid with this capture ID and revert to pending
  const affected = await prisma.commission.updateMany({
    where: { paymentRef: captureId },
    data: {
      status: 'pending',
      paidAt: null,
      paymentRef: null,
    },
  });

  console.log(
    `[PayPal Webhook] Reverted ${affected.count} commissions from capture ${captureId} to pending`
  );

  // Audit log using shopId from the commissions found before revert
  if (affected.count > 0 && commissionsToRevert.length > 0) {
    await prisma.auditLog.create({
      data: {
        shopId: commissionsToRevert[0].shopId,
        action: 'paypal_webhook_capture_refunded',
        resourceType: 'paypal_webhook',
        resourceId: captureId,
        metadata: {
          eventId: event.id,
          captureId,
          revertedCount: affected.count,
        },
      },
    });
  }
}
