import type { Shop } from '@prisma/client';
import prisma from '~/lib/prisma.server';
import {
  buildAutoChargeIdempotencyKey,
  buildOrderFeeDescription,
  getOutstandingFeeSelection,
} from '~/lib/billing.server';
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

/**
 * Errors that say nothing about the merchant's card: our own API key, Stripe or
 * PayPal being unreachable, rate limits, server errors. These must never count
 * as a failed attempt and must never forget the saved card (on 2026-07-20 an
 * expired Stripe key wiped every tenant's card after three "attempts").
 */
function isInfrastructureError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('api key') ||
    lower.includes('invalid_client') ||
    lower.includes('authentication_error') ||
    lower.includes('unauthorized') ||
    lower.includes('rate limit') ||
    lower.includes('rate_limit') ||
    lower.includes('econnre') ||
    lower.includes('etimedout') ||
    lower.includes('enotfound') ||
    lower.includes('fetch failed') ||
    lower.includes('socket hang up') ||
    lower.includes('api_connection_error') ||
    lower.includes('api_error') ||
    /\b5\d\d\b/.test(lower) ||
    lower.includes('bad gateway') ||
    lower.includes('service unavailable')
  );
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

  // Another run already holds this shop's fees (a parallel scheduler tick, the
  // 6-hour worker, a retry): never charge while a claim exists.
  const inFlight = await prisma.$queryRaw<Array<{ n: number; oldest: Date | null }>>`
    select count(*)::int as n, min(updated_at) as oldest from commissions
    where shop_id = ${shop.id} and status = 'charging'`;
  if (inFlight[0]?.n) {
    const oldest = inFlight[0].oldest ? new Date(inFlight[0].oldest) : null;
    const stale = oldest ? Date.now() - oldest.getTime() > 30 * 60 * 1000 : false;
    if (stale) {
      // A run stopped between claiming and settling. The payment may or may
      // not exist, so a person must check Stripe/PayPal before releasing.
      console.error(
        `[AutoCharge] ${shop.shopDomain}: ${inFlight[0].n} fee rows stuck in 'charging' since ${oldest?.toISOString()}; manual review needed`
      );
      await prisma.auditLog.create({
        data: {
          shopId: shop.id,
          action: 'auto_charge_stale_claim',
          resourceType: 'auto_charge',
          resourceId: 'charging',
          metadata: { rows: inFlight[0].n, oldest: oldest?.toISOString() ?? null },
        },
      });
    }
    return { status: 'skipped', reason: stale ? 'stale_claim_needs_review' : 'charge_in_progress' };
  }

  const { totalAmount: pendingPreview } = await getOutstandingFeeSelection(shop.id);
  if (pendingPreview < AUTO_CHARGE_THRESHOLD) {
    return { status: 'below_threshold', amount: pendingPreview.toFixed(2) };
  }

  // Atomic claim. Under concurrent runs Postgres lets exactly one UPDATE move
  // each pending row to 'charging'; every other run re-checks the row, finds it
  // no longer pending and gets nothing back. Only the claimed rows are charged.
  const claimRef = `claim_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const claimedRows = await prisma.$queryRaw<Array<{ order_id: string; commission_amount: unknown }>>`
    update commissions set status = 'charging', payment_ref = ${claimRef}, updated_at = now()
    where shop_id = ${shop.id} and status = 'pending'
    returning order_id, commission_amount`;
  const pendingOrderIds = claimedRows.map((row) => String(row.order_id));
  const feeAmounts = claimedRows.map((row) => Number(row.commission_amount));
  const pendingAmount = feeAmounts.reduce((sum, amount) => sum + amount, 0);
  const releaseClaim = () => prisma.$executeRaw`
    update commissions set status = 'pending', payment_ref = null, updated_at = now()
    where shop_id = ${shop.id} and status = 'charging' and payment_ref = ${claimRef}`;

  if (pendingOrderIds.length === 0) {
    return { status: 'skipped', reason: 'claimed_by_another_run' };
  }
  if (pendingAmount < AUTO_CHARGE_THRESHOLD) {
    await releaseClaim();
    return { status: 'below_threshold', amount: pendingAmount.toFixed(2) };
  }

  const totalAmount = (Math.round(pendingAmount * 100) / 100).toFixed(2);
  const description = buildOrderFeeDescription(feeAmounts);
  const idempotencyKey = buildAutoChargeIdempotencyKey(shop.shopDomain, pendingOrderIds, totalAmount);

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
        claimRef,
        idempotencyKey,
      },
    },
  });

  // Set once the provider has taken the money; from then on the claim must
  // never be released, even if settling the rows fails.
  let chargedCaptureId: string | null = null;

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
        shop.stripeEmail,
        idempotencyKey
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
        idempotencyKey
      );
      if (capture.status !== 'COMPLETED') {
        throw new Error(`Capture status: ${capture.status}`);
      }
      captureId =
        capture.purchase_units?.[0]?.payments?.captures?.[0]?.id || capture.id;
      provider = 'paypal';
    }

    chargedCaptureId = captureId;

    // Settle exactly the rows this run claimed.
    await prisma.$executeRaw`
      update commissions
      set status = 'paid', paid_at = now(), payment_ref = ${captureId}, payment_provider = ${provider}, updated_at = now()
      where shop_id = ${shop.id} and status = 'charging' and payment_ref = ${claimRef}`;

    await prisma.auditLog.update({
      where: { id: auditEntry.id },
      data: {
        action: 'auto_charge_completed',
        resourceId: captureId,
        metadata: {
          captureId,
          amount: totalAmount,
          orderCount: pendingOrderIds.length,
          orderIds: pendingOrderIds,
          provider,
          claimRef,
          idempotencyKey,
        },
      },
    });

    await clearBillingState(shop.id, currentSettings);
    console.log(`[AutoCharge] ✅ ${shop.shopDomain}: $${totalAmount} via ${provider} (${captureId})`);

    return { status: 'charged', amount: totalAmount, captureId, provider };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[AutoCharge] ❌ ${shop.shopDomain}: ${errMsg}`);

    if (chargedCaptureId) {
      // Money was taken but the rows could not be settled. Keep them in
      // 'charging' (blocks any further charge) and leave it to manual review.
      await prisma.auditLog
        .create({
          data: {
            shopId: shop.id,
            action: 'auto_charge_settle_failed',
            resourceType: 'auto_charge',
            resourceId: chargedCaptureId,
            metadata: { claimRef, error: errMsg, orderIds: pendingOrderIds, amount: totalAmount },
          },
        })
        .catch(() => undefined);
      return { status: 'skipped', reason: 'charged_but_settle_failed' };
    }

    // Nothing was charged: give the rows back so the next run can bill them.
    await releaseClaim().catch((releaseError: unknown) =>
      console.error(`[AutoCharge] ${shop.shopDomain}: failed to release claim ${claimRef}:`, releaseError)
    );

    const attemptNumber = state.retryCount || 0;

    if (isInfrastructureError(errMsg)) {
      // Not the merchant's fault: keep the card, keep the attempt counter,
      // try again on the next worker run.
      await prisma.auditLog.create({
        data: {
          shopId: shop.id,
          action: 'auto_charge_failed_infrastructure',
          resourceType: 'auto_charge',
          resourceId: 'error',
          metadata: { error: errMsg, attempt: attemptNumber, keptVault: true },
        },
      });
      await setBillingState(shop.id, currentSettings, {
        retryCount: attemptNumber,
        lastError: errMsg,
        lastErrorAt: new Date().toISOString(),
      });
      return { status: 'retry_scheduled', nextRetryAt: new Date(Date.now() + 6 * 60 * 60 * 1000), attemptNumber, reason: errMsg };
    }

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
