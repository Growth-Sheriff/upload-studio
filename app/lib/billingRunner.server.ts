import type { Shop } from '@prisma/client';
import prisma from '~/lib/prisma.server';
import { getOutstandingFeeSelection } from '~/lib/billing.server';
import { chargeWithSavedMethod, isStripeConfigured } from '~/lib/stripe.server';
import { chargeWithVault, isPayPalConfigured } from '~/lib/paypal.server';
import {
  HARD_DECLINE_STRIPE_CODES,
  MAX_RETRY_ATTEMPTS,
  RETRY_BACKOFF_DAYS,
} from '~/lib/billingQueues';
import {
  sendChargeFinalFailureEmail,
  sendChargeRetryEmail,
} from '~/lib/billingNotifications.server';

export const AUTO_CHARGE_THRESHOLD = Number(process.env.AUTO_CHARGE_THRESHOLD || '49.99');

type ChargeOutcome =
  | { status: 'charged'; amount: string; captureId: string; provider: 'stripe' | 'paypal' }
  | { status: 'below_threshold'; amount: string }
  | { status: 'skipped'; reason: string }
  | { status: 'retry_scheduled'; nextRetryAt: Date; attemptNumber: number; reason: string }
  | { status: 'failed_final'; reason: string; vaultDisabled: boolean };

interface BillingState {
  retryCount?: number;
  retryNextAt?: string; // ISO
  lastError?: string;
  lastErrorAt?: string;
  lastSuccessAt?: string;
}

function getBillingState(shop: Pick<Shop, 'settings'>): BillingState {
  const s = (shop.settings as Record<string, any>) || {};
  return (s.billing as BillingState) || {};
}

async function setBillingState(shopId: string, current: Record<string, any>, patch: BillingState) {
  const merged = { ...current, billing: { ...(current.billing || {}), ...patch } };
  await prisma.shop.update({ where: { id: shopId }, data: { settings: merged } });
}

async function clearBillingState(shopId: string, current: Record<string, any>) {
  const merged = { ...current };
  delete merged.billing;
  merged.billing = { lastSuccessAt: new Date().toISOString() };
  await prisma.shop.update({ where: { id: shopId }, data: { settings: merged } });
}

function isHardDecline(message: string): boolean {
  const lower = message.toLowerCase();
  for (const code of HARD_DECLINE_STRIPE_CODES) {
    if (lower.includes(code)) return true;
  }
  if (lower.includes('no such paymentmethod')) return true;
  if (lower.includes('invalid_vault_id') || lower.includes('vault_not_found')) return true;
  if (lower.includes('payer_action_required')) return true;
  return false;
}

export async function runShopAutoCharge(shopId: string): Promise<ChargeOutcome> {
  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop) return { status: 'skipped', reason: 'shop_not_found' };

  const state = getBillingState(shop);
  const currentSettings = (shop.settings as Record<string, any>) || {};

  // Skip if scheduled retry is in the future
  if (state.retryNextAt) {
    const next = new Date(state.retryNextAt);
    if (!isNaN(next.getTime()) && next.getTime() > Date.now()) {
      return { status: 'skipped', reason: `retry_scheduled_for_${next.toISOString()}` };
    }
  }

  const hasStripe =
    !!(shop.stripeCustomerId && shop.stripePaymentMethodId && shop.stripeAutoCharge && isStripeConfigured());
  const hasPaypal = !!(shop.paypalVaultId && shop.paypalAutoCharge && isPayPalConfigured());
  if (!hasStripe && !hasPaypal) return { status: 'skipped', reason: 'no_vault_or_disabled' };

  const {
    orderIds: pendingOrderIds,
    totalAmount: pendingAmount,
    feeByOrderId,
    description,
  } = await getOutstandingFeeSelection(shop.id);

  if (pendingAmount < AUTO_CHARGE_THRESHOLD) {
    return { status: 'below_threshold', amount: pendingAmount.toFixed(2) };
  }
  if (pendingOrderIds.length === 0) {
    return { status: 'skipped', reason: 'no_pending_orders' };
  }

  const totalAmount = pendingAmount.toFixed(2);

  const auditEntry = await prisma.auditLog.create({
    data: {
      shopId: shop.id,
      action: 'auto_charge_initiated',
      resourceType: 'auto_charge',
      resourceId: 'pending',
      metadata: {
        orderIds: pendingOrderIds,
        amount: totalAmount,
        orderCount: pendingOrderIds.length,
        threshold: AUTO_CHARGE_THRESHOLD,
        attempt: (state.retryCount || 0) + 1,
      },
    },
  });

  try {
    let captureId: string;
    let provider: 'stripe' | 'paypal';

    if (hasStripe) {
      const result = await chargeWithSavedMethod(
        shop.stripeCustomerId!,
        shop.stripePaymentMethodId!,
        totalAmount,
        shop.shopDomain,
        description,
        shop.stripeEmail
      );
      captureId = result.paymentIntentId;
      provider = 'stripe';
    } else {
      const capture = await chargeWithVault(
        shop.paypalVaultId!,
        shop.paypalPayerId || '',
        totalAmount,
        shop.shopDomain,
        description,
        auditEntry.id
      );
      if (capture.status !== 'COMPLETED') {
        throw new Error(`Capture status: ${capture.status}`);
      }
      captureId =
        capture.purchase_units?.[0]?.payments?.captures?.[0]?.id || capture.id;
      provider = 'paypal';
    }

    for (const orderId of pendingOrderIds) {
      const rate = feeByOrderId.get(orderId) || 0.1;
      await prisma.commission.upsert({
        where: { commission_shop_order: { shopId: shop.id, orderId } },
        create: {
          shopId: shop.id,
          orderId,
          orderNumber: `#${orderId.slice(-6)}`,
          orderTotal: 0,
          orderCurrency: 'USD',
          commissionRate: 0,
          commissionAmount: rate,
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
        },
      },
    });

    await clearBillingState(shop.id, currentSettings);
    console.log(`[AutoCharge] ✅ ${shop.shopDomain}: $${totalAmount} via ${provider} (${captureId})`);

    return { status: 'charged', amount: totalAmount, captureId, provider };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[AutoCharge] ❌ ${shop.shopDomain}: ${errMsg}`);

    const attemptNumber = state.retryCount || 0;
    const hardDecline = isHardDecline(errMsg);
    const exhausted = attemptNumber + 1 >= MAX_RETRY_ATTEMPTS;
    const shouldGiveUp = hardDecline || exhausted;

    await prisma.auditLog.create({
      data: {
        shopId: shop.id,
        action: shouldGiveUp ? 'auto_charge_failed_final' : 'auto_charge_failed_retry',
        resourceType: 'auto_charge',
        resourceId: 'error',
        metadata: {
          error: errMsg,
          attempt: attemptNumber + 1,
          maxAttempts: MAX_RETRY_ATTEMPTS,
          hardDecline,
          exhausted,
        },
      },
    });

    if (shouldGiveUp) {
      // Disable vault to prevent further wasted attempts
      const updates: Record<string, any> = {};
      if (shop.stripePaymentMethodId) {
        updates.stripeAutoCharge = false;
        updates.stripePaymentMethodId = null;
      }
      if (shop.paypalVaultId) {
        updates.paypalAutoCharge = false;
        updates.paypalVaultId = null;
      }
      if (Object.keys(updates).length > 0) {
        await prisma.shop.update({ where: { id: shop.id }, data: updates });
      }
      await setBillingState(shop.id, currentSettings, {
        retryCount: 0,
        retryNextAt: undefined,
        lastError: errMsg,
        lastErrorAt: new Date().toISOString(),
      });
      if (shop.stripeEmail) {
        await sendChargeFinalFailureEmail({
          shopDomain: shop.shopDomain,
          to: shop.stripeEmail,
          amount: totalAmount,
          attemptNumber: attemptNumber + 1,
          maxAttempts: MAX_RETRY_ATTEMPTS,
          reason: errMsg,
          willDisableVault: true,
        });
      }
      return { status: 'failed_final', reason: errMsg, vaultDisabled: true };
    }

    // Retryable: schedule next attempt
    const backoffDays = RETRY_BACKOFF_DAYS[attemptNumber] ?? RETRY_BACKOFF_DAYS[RETRY_BACKOFF_DAYS.length - 1];
    const nextRetryAt = new Date(Date.now() + backoffDays * 24 * 60 * 60 * 1000);
    await setBillingState(shop.id, currentSettings, {
      retryCount: attemptNumber + 1,
      retryNextAt: nextRetryAt.toISOString(),
      lastError: errMsg,
      lastErrorAt: new Date().toISOString(),
    });

    if (shop.stripeEmail) {
      await sendChargeRetryEmail({
        shopDomain: shop.shopDomain,
        to: shop.stripeEmail,
        amount: totalAmount,
        attemptNumber,
        maxAttempts: MAX_RETRY_ATTEMPTS,
        nextRetryAt,
        reason: errMsg,
        willDisableVault: false,
      });
    }
    return { status: 'retry_scheduled', nextRetryAt, attemptNumber: attemptNumber + 1, reason: errMsg };
  }
}

export async function runTenantAutoCharge() {
  const shops = await prisma.shop.findMany({
    where: {
      OR: [
        { paypalVaultId: { not: null }, paypalAutoCharge: true },
        { stripePaymentMethodId: { not: null }, stripeAutoCharge: true },
      ],
    },
    select: { id: true, shopDomain: true },
  });

  const results: Array<{ shop: string; outcome: ChargeOutcome }> = [];
  for (const s of shops) {
    try {
      const outcome = await runShopAutoCharge(s.id);
      results.push({ shop: s.shopDomain, outcome });
    } catch (err) {
      console.error(`[AutoCharge] uncaught for ${s.shopDomain}:`, err);
      results.push({
        shop: s.shopDomain,
        outcome: { status: 'failed_final', reason: String(err), vaultDisabled: false },
      });
    }
  }
  return { total: shops.length, results };
}
