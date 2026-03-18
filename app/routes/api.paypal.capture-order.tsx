/**
 * PayPal Capture Order API
 *
 * Called after merchant approves payment on PayPal
 * Captures the payment and marks commissions as paid
 */
import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { capturePayPalOrder, isPayPalConfigured } from '~/lib/paypal.server';
import prisma from '~/lib/prisma.server';
import { authenticate } from '~/shopify.server';
import { calculatePendingCommissions } from '~/lib/billing.server';

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
  const { paypalOrderId } = body;

  if (!paypalOrderId) {
    return json({ error: 'PayPal order ID is required' }, { status: 400 });
  }

  try {
    // Capture the payment
    const capture = await capturePayPalOrder(paypalOrderId);

    if (capture.status !== 'COMPLETED') {
      console.error('[PayPal] Capture not completed:', capture.status);
      return json(
        { error: `Payment not completed. Status: ${capture.status}` },
        { status: 400 }
      );
    }

    // Get the capture transaction ID (this is the real payment reference)
    const captureId =
      capture.purchase_units?.[0]?.payments?.captures?.[0]?.id || paypalOrderId;
    const captureAmount =
      capture.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value || '0';
    const payerEmail = capture.payer?.email_address || 'unknown';
    const payerId = capture.payer?.payer_id || '';

    // ── Save PayPal vault token if present (for future auto-charges) ──
    // The vault token is returned in the capture response when vault was requested
    const captureRaw = capture as unknown as Record<string, unknown>;
    const paymentSource = captureRaw.payment_source as Record<string, unknown> | undefined;
    const paypalSource = paymentSource?.paypal as Record<string, unknown> | undefined;
    const vaultAttributes = paypalSource?.attributes as Record<string, unknown> | undefined;
    const vaultData = vaultAttributes?.vault as { id?: string; status?: string } | undefined;

    if (vaultData?.id && vaultData?.status === 'VAULTED') {
      // Save vault token to shop for future auto-charges
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

    // Find the audit log with pending order IDs for this PayPal order
    const auditLog = await prisma.auditLog.findFirst({
      where: {
        shopId: shop.id,
        action: 'paypal_order_created',
        resourceId: paypalOrderId,
      },
      orderBy: { createdAt: 'desc' },
    });

    let pendingOrderIds: string[] = [];

    if (auditLog && auditLog.metadata) {
      const metadata = auditLog.metadata as { orderIds?: string[] };
      pendingOrderIds = metadata.orderIds || [];
    }

    // If we couldn't find order IDs from audit log, get all pending ones
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
    const { orderRates } = await calculatePendingCommissions(shop.id, pendingOrderIds);
    let markedCount = 0;
    for (const orderId of pendingOrderIds) {
      const rate = orderRates.get(orderId) || 0.10;
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
          commissionAmount: rate,
          status: 'paid',
          paidAt: new Date(),
          paymentRef: captureId,
          paymentProvider: 'paypal',
        },
        update: {
          status: 'paid',
          paidAt: new Date(),
          paymentRef: captureId,
          paymentProvider: 'paypal',
        },
      });
      markedCount++;
    }

    // Audit log for successful payment
    await prisma.auditLog.create({
      data: {
        shopId: shop.id,
        action: 'paypal_payment_captured',
        resourceType: 'paypal_capture',
        resourceId: captureId,
        metadata: {
          paypalOrderId,
          captureId,
          amount: captureAmount,
          payerEmail,
          orderIds: pendingOrderIds,
          markedCount,
        },
      },
    });

    console.log(
      `[PayPal] Payment captured for ${shopDomain}: $${captureAmount} (${markedCount} orders) - Capture: ${captureId}`
    );

    return json({
      success: true,
      captureId,
      amount: captureAmount,
      markedCount,
      payerEmail,
    });
  } catch (error) {
    console.error('[PayPal] Capture error:', error);

    // Audit log for failed capture
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
