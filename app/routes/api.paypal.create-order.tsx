





import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { createPayPalOrder, createPayPalOrderWithVault, isPayPalConfigured } from '~/lib/paypal.server';
import prisma from '~/lib/prisma.server';
import { authenticate } from '~/shopify.server';
import { getOutstandingFeeSelection } from '~/lib/billing.server';

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

  const {
    orderIds: pendingOrderIds,
    totalAmount: total,
    description,
  } = await getOutstandingFeeSelection(shop.id, requestedOrderIds, monthKey);

  if (pendingOrderIds.length === 0) {
    return json({ error: 'No outstanding order fees to pay' }, { status: 400 });
  }

  const totalAmount = total.toFixed(2);

  try {

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



    const hasVault = Boolean(shop.paypalVaultId);
    let order;

    if (hasVault) {

      order = await createPayPalOrder(
        totalAmount,
        shopDomain,
        description,
        auditEntry.id
      );
    } else {

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


    const approvalLink = order.links.find((link) => link.rel === 'approve');

    if (!approvalLink) {
      console.error('[PayPal] No approval link in response:', order);
      return json({ error: 'PayPal did not return an approval URL' }, { status: 500 });
    }



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
