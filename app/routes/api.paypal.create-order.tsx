/**
 * PayPal Create Order API
 *
 * Called from billing page when merchant clicks "Pay with PayPal"
 * Creates a PayPal order and returns the approval URL
 */
import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { createPayPalOrder, createPayPalOrderWithVault, isPayPalConfigured } from '~/lib/paypal.server';
import prisma from '~/lib/prisma.server';
import { authenticate } from '~/shopify.server';

const COMMISSION_PER_ORDER = 0.1;

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

  // Get all pending (unpaid) order IDs for this shop
  const orderLinks = await prisma.orderLink.findMany({
    where: { shopId: shop.id },
    select: { orderId: true },
  });

  const allOrderIds = [...new Set(orderLinks.map((ol) => ol.orderId))];

  // Get already paid order IDs
  const paidCommissions = await prisma.commission.findMany({
    where: {
      shopId: shop.id,
      status: 'paid',
    },
    select: { orderId: true },
  });

  const paidOrderIds = new Set(paidCommissions.map((c) => c.orderId));

  let pendingOrderIds: string[];
  if (requestedOrderIds) {
    // Per-month payment: only pay the requested orders that are actually pending
    const allOrderSet = new Set(allOrderIds);
    pendingOrderIds = requestedOrderIds.filter(
      (id) => allOrderSet.has(id) && !paidOrderIds.has(id)
    );
  } else {
    // Default: pay all pending
    pendingOrderIds = allOrderIds.filter((id) => !paidOrderIds.has(id));
  }

  if (pendingOrderIds.length === 0) {
    return json({ error: 'No pending commissions to pay' }, { status: 400 });
  }

  const totalAmount = (pendingOrderIds.length * COMMISSION_PER_ORDER).toFixed(2);
  const appName = process.env.APP_NAME || 'Upload Studio';
  const description = monthKey
    ? `${appName} commission (${monthKey}): ${pendingOrderIds.length} orders @ $${COMMISSION_PER_ORDER}/order`
    : `${appName} commission: ${pendingOrderIds.length} orders @ $${COMMISSION_PER_ORDER}/order`;

  try {
    // First, save order IDs to audit log and get the reference ID
    const auditEntry = await prisma.auditLog.create({
      data: {
        shopId: shop.id,
        action: 'paypal_order_pending',
        resourceType: 'paypal_order',
        resourceId: 'pending',
        metadata: {
          orderIds: pendingOrderIds,
          amount: totalAmount,
          orderCount: pendingOrderIds.length,
        },
      },
    });

    // Use audit log ID as custom_id (short, unique reference)
    // If shop doesn't have a PayPal vault yet, create order WITH vault to save payment method
    const hasVault = Boolean(shop.paypalVaultId);
    let order;

    if (hasVault) {
      // Already vaulted - normal order
      order = await createPayPalOrder(
        totalAmount,
        shopDomain,
        description,
        auditEntry.id
      );
    } else {
      // No vault yet - try with vault first, fallback to normal if vault not enabled
      try {
        order = await createPayPalOrderWithVault(
          totalAmount,
          shopDomain,
          description,
          auditEntry.id
        );
      } catch (vaultError) {
        console.warn('[PayPal] Vault not available, falling back to normal order:', vaultError);
        order = await createPayPalOrder(
          totalAmount,
          shopDomain,
          description,
          auditEntry.id
        );
      }
    }

    // Find the approval URL
    const approvalLink = order.links.find((link) => link.rel === 'approve');

    if (!approvalLink) {
      console.error('[PayPal] No approval link in response:', order);
      return json({ error: 'PayPal did not return an approval URL' }, { status: 500 });
    }

    // Store the PayPal order ID with pending order IDs for later capture
    // Update the audit log entry with the PayPal order ID
    await prisma.auditLog.update({
      where: { id: auditEntry.id },
      data: {
        action: 'paypal_order_created',
        resourceId: order.id,
        metadata: {
          paypalOrderId: order.id,
          auditRefId: auditEntry.id,
          orderIds: pendingOrderIds,
          amount: totalAmount,
          orderCount: pendingOrderIds.length,
          status: order.status,
        },
      },
    });

    console.log(
      `[PayPal] Order ${order.id} created for ${shopDomain}: $${totalAmount} (${pendingOrderIds.length} orders)`
    );

    return json({
      success: true,
      paypalOrderId: order.id,
      approvalUrl: approvalLink.href,
      amount: totalAmount,
      orderCount: pendingOrderIds.length,
    });
  } catch (error) {
    console.error('[PayPal] Create order error:', error);
    return json(
      { error: error instanceof Error ? error.message : 'PayPal order creation failed' },
      { status: 500 }
    );
  }
}
