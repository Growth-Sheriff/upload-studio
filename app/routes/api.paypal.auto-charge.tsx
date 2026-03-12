/**
 * Auto-Charge API (PayPal + Stripe)
 *
 * Checks all shops with saved payment methods (PayPal vault OR Stripe).
 * If pending commission >= $49.99 threshold, charges automatically.
 *
 * Called by:
 * - Cron worker (commission.worker.ts) - daily
 * - Or manually via POST with secret header
 */
import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { chargeWithVault, isPayPalConfigured } from '~/lib/paypal.server';
import { chargeWithSavedMethod, isStripeConfigured } from '~/lib/stripe.server';
import prisma from '~/lib/prisma.server';

const COMMISSION_PER_ORDER = 0.1;
const AUTO_CHARGE_THRESHOLD = 49.99;
const CRON_SECRET = process.env.CRON_SECRET;

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  // Auth: require CRON_SECRET env var — no fallback
  if (!CRON_SECRET) {
    console.error('[PayPal Auto-Charge] CRON_SECRET env variable is not set');
    return json({ error: 'Server misconfiguration' }, { status: 500 });
  }

  const authHeader = request.headers.get('x-cron-secret');
  if (authHeader !== CRON_SECRET) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isPayPalConfigured() && !isStripeConfigured()) {
    return json({ error: 'No payment provider configured' }, { status: 500 });
  }

  // Find all shops with auto-charge enabled (PayPal vault OR Stripe saved method)
  const vaultedShops = await prisma.shop.findMany({
    where: {
      OR: [
        { paypalVaultId: { not: null }, paypalAutoCharge: true },
        { stripePaymentMethodId: { not: null }, stripeAutoCharge: true },
      ],
    },
    select: {
      id: true,
      shopDomain: true,
      paypalVaultId: true,
      paypalPayerId: true,
      paypalPayerEmail: true,
      stripeCustomerId: true,
      stripePaymentMethodId: true,
      stripeEmail: true,
    },
  });

  if (vaultedShops.length === 0) {
    return json({ success: true, message: 'No vaulted shops found', charged: 0 });
  }

  const results: Array<{
    shop: string;
    status: 'charged' | 'below_threshold' | 'error';
    amount?: string;
    error?: string;
  }> = [];

  for (const shop of vaultedShops) {
    try {
      // Get all unique orders for this shop
      const orderLinks = await prisma.orderLink.findMany({
        where: { shopId: shop.id },
        select: { orderId: true },
      });

      const allOrderIds = [...new Set(orderLinks.map((ol) => ol.orderId))];

      // Get already paid orders
      const paidCommissions = await prisma.commission.findMany({
        where: { shopId: shop.id, status: 'paid' },
        select: { orderId: true },
      });

      const paidSet = new Set(paidCommissions.map((c) => c.orderId));
      const pendingOrderIds = allOrderIds.filter((id) => !paidSet.has(id));
      const pendingAmount = pendingOrderIds.length * COMMISSION_PER_ORDER;

      // Check threshold
      if (pendingAmount < AUTO_CHARGE_THRESHOLD) {
        results.push({
          shop: shop.shopDomain,
          status: 'below_threshold',
          amount: pendingAmount.toFixed(2),
        });
        continue;
      }

      console.log(
        `[AutoCharge] ${shop.shopDomain}: $${pendingAmount.toFixed(2)} pending (${pendingOrderIds.length} orders) - charging...`
      );

      // Create audit entry for reference
      const auditEntry = await prisma.auditLog.create({
        data: {
          shopId: shop.id,
          action: 'auto_charge_initiated',
          resourceType: 'auto_charge',
          resourceId: 'pending',
          metadata: {
            orderIds: pendingOrderIds,
            amount: pendingAmount.toFixed(2),
            orderCount: pendingOrderIds.length,
            vaultId: shop.paypalVaultId,
            stripeCustomerId: shop.stripeCustomerId,
            threshold: AUTO_CHARGE_THRESHOLD,
          },
        },
      });

      const totalAmount = pendingAmount.toFixed(2);
      const description = `Upload Lift auto-charge: ${pendingOrderIds.length} orders @ $${COMMISSION_PER_ORDER}/order`;

      let captureId: string;
      let provider: 'paypal' | 'stripe';

      // Prefer Stripe if configured, fall back to PayPal
      if (shop.stripeCustomerId && shop.stripePaymentMethodId && isStripeConfigured()) {
        // Charge via Stripe saved payment method
        const result = await chargeWithSavedMethod(
          shop.stripeCustomerId,
          shop.stripePaymentMethodId,
          totalAmount,
          shop.shopDomain,
          description
        );
        captureId = result.paymentIntentId;
        provider = 'stripe';
      } else if (shop.paypalVaultId && isPayPalConfigured()) {
        // Charge via PayPal vault
        const capture = await chargeWithVault(
          shop.paypalVaultId,
          shop.paypalPayerId || '',
          totalAmount,
          shop.shopDomain,
          description,
          auditEntry.id
        );

        if (capture.status !== 'COMPLETED') {
          throw new Error(`Capture status: ${capture.status}`);
        }

        captureId = capture.purchase_units?.[0]?.payments?.captures?.[0]?.id || capture.id;
        provider = 'paypal';
      } else {
        throw new Error('No valid payment method available');
      }

      // Mark all pending commissions as paid
      for (const orderId of pendingOrderIds) {
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
            commissionAmount: COMMISSION_PER_ORDER,
            status: 'paid',
            paidAt: new Date(),
            paymentRef: captureId,
            paymentProvider: provider,
          },
          update: {
            status: 'paid',
            paidAt: new Date(),
            paymentRef: captureId,
            paymentProvider: provider,
          },
        });
      }

      // Update audit log
      await prisma.auditLog.update({
        where: { id: auditEntry.id },
        data: {
          action: 'auto_charge_completed',
          resourceId: captureId,
          metadata: {
            captureId,
            amount: totalAmount,
            orderCount: pendingOrderIds.length,
            provider,
            payerEmail: provider === 'stripe' ? shop.stripeEmail : shop.paypalPayerEmail,
          },
        },
      });

      console.log(
        `[AutoCharge] ✅ ${shop.shopDomain}: $${totalAmount} charged (${pendingOrderIds.length} orders) - Capture: ${captureId}`
      );

      results.push({
        shop: shop.shopDomain,
        status: 'charged',
        amount: totalAmount,
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[AutoCharge] ❌ ${shop.shopDomain}: ${errMsg}`);

      // Audit log for failure
      await prisma.auditLog.create({
        data: {
          shopId: shop.id,
          action: 'auto_charge_failed',
          resourceType: 'auto_charge',
          resourceId: 'error',
          metadata: {
            error: errMsg,
            shopDomain: shop.shopDomain,
          },
        },
      });

      // If PayPal vault is invalid/expired, disable auto-charge
      if (
        errMsg.includes('INVALID_VAULT_ID') ||
        errMsg.includes('VAULT_NOT_FOUND') ||
        errMsg.includes('PAYER_ACTION_REQUIRED')
      ) {
        await prisma.shop.update({
          where: { id: shop.id },
          data: {
            paypalAutoCharge: false,
            paypalVaultId: null,
          },
        });
        console.log(`[AutoCharge] Vault disabled for ${shop.shopDomain} (invalid/expired)`);
      }

      // If Stripe payment method is invalid, disable Stripe auto-charge
      if (
        errMsg.includes('payment_method_not_available') ||
        errMsg.includes('card_declined') ||
        errMsg.includes('No such PaymentMethod')
      ) {
        await prisma.shop.update({
          where: { id: shop.id },
          data: {
            stripeAutoCharge: false,
            stripePaymentMethodId: null,
          },
        });
        console.log(`[AutoCharge] Stripe disabled for ${shop.shopDomain} (invalid card)`);
      }

      results.push({
        shop: shop.shopDomain,
        status: 'error',
        error: errMsg,
      });
    }
  }

  const chargedCount = results.filter((r) => r.status === 'charged').length;
  console.log(
    `[AutoCharge] Done: ${chargedCount}/${vaultedShops.length} shops charged`
  );

  return json({
    success: true,
    total: vaultedShops.length,
    charged: chargedCount,
    results,
  });
}
