import type { Shop } from '@prisma/client';
import prisma from '~/lib/prisma.server';
import {
  buildAutoChargeIdempotencyKey,
  buildOrderFeeDescription,
  centsToMoney,
  getOutstandingFeeSelection,
  isSupportedBillingCurrency,
  moneyToCents,
  sumMoneyCents,
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
const AUTO_CHARGE_THRESHOLD_CENTS = moneyToCents(AUTO_CHARGE_THRESHOLD);

type ChargeOutcome =
  | { status: 'charged'; amount: string; captureId: string; provider: 'stripe' | 'paypal' }
  | { status: 'below_threshold'; amount: string }
  | { status: 'skipped'; reason: string }
  | { status: 'needs_review'; reason: string; claimRef: string; idempotencyKey: string }
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

async function setBillingState(
  shopId: string,
  patch: BillingState,
  options: { clearRetryNextAt?: boolean } = {}
) {
  const patchJson = JSON.stringify(patch);
  if (options.clearRetryNextAt) {
    await prisma.$executeRaw`
      update shops
      set settings_json = jsonb_set(
        coalesce(settings_json, '{}'::jsonb),
        '{billing}',
        (
          coalesce(coalesce(settings_json, '{}'::jsonb)->'billing', '{}'::jsonb)
          || ${patchJson}::jsonb
        ) - 'retryNextAt',
        true
      ), updated_at = now()
      where id = ${shopId}`;
    return;
  }

  await prisma.$executeRaw`
    update shops
    set settings_json = jsonb_set(
      coalesce(settings_json, '{}'::jsonb),
      '{billing}',
      coalesce(coalesce(settings_json, '{}'::jsonb)->'billing', '{}'::jsonb)
        || ${patchJson}::jsonb,
      true
    ), updated_at = now()
    where id = ${shopId}`;
}

async function clearBillingState(shopId: string) {
  const successJson = JSON.stringify({ lastSuccessAt: new Date().toISOString() });
  await prisma.$executeRaw`
    update shops
    set settings_json = jsonb_set(
      coalesce(settings_json, '{}'::jsonb),
      '{billing}',
      (
        coalesce(coalesce(settings_json, '{}'::jsonb)->'billing', '{}'::jsonb)
        || ${successJson}::jsonb
      ) - 'retryCount' - 'retryNextAt' - 'lastError' - 'lastErrorAt',
      true
    ), updated_at = now()
    where id = ${shopId}`;
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
  if (
    lower.includes('your card was declined') ||
    lower.includes('your card has been declined') ||
    lower.includes('the card was declined') ||
    lower.includes('your card has insufficient funds') ||
    lower.includes('your card has expired') ||
    lower.includes("your card's security code is incorrect") ||
    lower.includes('your card’s security code is incorrect')
  ) {
    return true;
  }
  if (lower.includes('no such paymentmethod')) return true;
  if (lower.includes('invalid_vault_id') || lower.includes('vault_not_found')) return true;
  if (lower.includes('payer_action_required')) return true;
  return false;
}

export function isConfirmedNotChargedProviderError(errorMessage: string): boolean {
  if (isHardDecline(errorMessage)) return true;
  return /^capture status:\s*(declined|failed)\s*$/i.test(errorMessage);
}

export function shouldQuarantineClaimAfterProviderError(
  providerRequestStarted: boolean,
  errorMessage: string
): boolean {
  return providerRequestStarted && !isConfirmedNotChargedProviderError(errorMessage);
}

export function buildFailedProviderDisableUpdates(
  provider: 'stripe' | 'paypal' | null,
  shop: Pick<Shop, 'stripePaymentMethodId' | 'paypalVaultId'>
): Record<string, boolean | null> {
  if (provider === 'stripe' && shop.stripePaymentMethodId) {
    return { stripeAutoCharge: false, stripePaymentMethodId: null };
  }
  if (provider === 'paypal' && shop.paypalVaultId) {
    return { paypalAutoCharge: false, paypalVaultId: null };
  }
  return {};
}

export async function runShopAutoCharge(shopId: string): Promise<ChargeOutcome> {
  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop) return { status: 'skipped', reason: 'shop_not_found' };

  const state = getBillingState(shop);

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

  const pendingCurrencies = await prisma.commission.findMany({
    where: { shopId: shop.id, status: 'pending', paymentRef: null },
    distinct: ['orderCurrency'],
    select: { orderCurrency: true },
  });
  const unsupportedCurrencies = pendingCurrencies
    .map((row) => row.orderCurrency)
    .filter((currency) => !isSupportedBillingCurrency(currency));
  if (unsupportedCurrencies.length) {
    console.error(
      `[AutoCharge] ${shop.shopDomain}: unsupported pending order currencies require review: ${unsupportedCurrencies.join(', ')}`
    );
    const recentCurrencyAudit = await prisma.auditLog.findFirst({
      where: {
        shopId: shop.id,
        action: 'auto_charge_currency_review_required',
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      select: { id: true },
    });
    if (!recentCurrencyAudit) {
      await prisma.auditLog.create({
        data: {
          shopId: shop.id,
          action: 'auto_charge_currency_review_required',
          resourceType: 'auto_charge',
          resourceId: 'unsupported_currency',
          metadata: { currencies: unsupportedCurrencies.sort() },
        },
      });
    }
  }

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

  const {
    totalAmount: pendingPreview,
    totalCents: pendingPreviewCents,
  } = await getOutstandingFeeSelection(shop.id, null, null, { orderCurrency: 'USD' });
  if (pendingPreviewCents < AUTO_CHARGE_THRESHOLD_CENTS) {
    return { status: 'below_threshold', amount: pendingPreview.toFixed(2) };
  }

  // Atomic claim. Under concurrent runs Postgres lets exactly one UPDATE move
  // each pending row to 'charging'; every other run re-checks the row, finds it
  // no longer pending and gets nothing back. Only the claimed rows are charged.
  const claimRef = `claim_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const claimedRows = await prisma.$queryRaw<Array<{
    order_id: string;
    commission_amount: unknown;
    order_currency: string;
  }>>`
    update commissions set status = 'charging', payment_ref = ${claimRef}, updated_at = now()
    where shop_id = ${shop.id}
      and status = 'pending'
      and payment_ref is null
      and upper(coalesce(order_currency, '')) = 'USD'
    returning order_id, commission_amount, order_currency`;
  const pendingOrderIds = claimedRows.map((row) => String(row.order_id));
  const feeAmounts = claimedRows.map((row) => Number(row.commission_amount));
  const pendingAmountCents = sumMoneyCents(feeAmounts);
  const pendingAmount = centsToMoney(pendingAmountCents);
  const releaseClaim = () => prisma.$executeRaw`
    update commissions set status = 'pending', payment_ref = null, updated_at = now()
    where shop_id = ${shop.id} and status = 'charging' and payment_ref = ${claimRef}`;

  if (pendingOrderIds.length === 0) {
    return { status: 'skipped', reason: 'claimed_by_another_run' };
  }
  if (claimedRows.some((row) => !isSupportedBillingCurrency(row.order_currency))) {
    await releaseClaim();
    await prisma.auditLog.create({
      data: {
        shopId: shop.id,
        action: 'auto_charge_claim_currency_mismatch',
        resourceType: 'auto_charge',
        resourceId: claimRef,
        metadata: { currencies: claimedRows.map((row) => row.order_currency) },
      },
    });
    return { status: 'skipped', reason: 'unsupported_order_currency' };
  }
  if (pendingAmountCents < AUTO_CHARGE_THRESHOLD_CENTS) {
    await releaseClaim();
    return { status: 'below_threshold', amount: pendingAmount.toFixed(2) };
  }

  const totalAmount = pendingAmount.toFixed(2);
  const description = buildOrderFeeDescription(feeAmounts);
  const idempotencyKey = buildAutoChargeIdempotencyKey(
    shop.shopDomain,
    pendingOrderIds,
    totalAmount,
    claimRef
  );

  let auditEntry: { id: string };
  try {
    auditEntry = await prisma.auditLog.create({
      data: {
        shopId: shop.id,
        action: 'auto_charge_initiated',
        resourceType: 'auto_charge',
        resourceId: claimRef,
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
      select: { id: true },
    });
  } catch (auditError) {
    // No provider request has started. Returning the rows to pending is safe;
    // leaving them claimed here would create a false "payment may exist" case.
    await releaseClaim().catch((releaseError: unknown) =>
      console.error(`[AutoCharge] ${shop.shopDomain}: failed to release unaudited claim ${claimRef}:`, releaseError)
    );
    throw auditError;
  }

  // Set once the provider has taken the money; from then on the claim must
  // never be released, even if settling the rows fails.
  let chargedCaptureId: string | null = null;
  // Once an external request starts, a thrown timeout/network error cannot
  // prove that no money moved. Such claims stay quarantined until reconciled
  // against the provider using the stable idempotency key.
  let providerRequestStarted = false;
  let attemptedProvider: 'stripe' | 'paypal' | null = null;

  try {
    let captureId: string;
    let provider: 'stripe' | 'paypal';

    if (hasStripe) {
      attemptedProvider = 'stripe';
      providerRequestStarted = true;
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
      attemptedProvider = 'paypal';
      const capture = await chargeWithVault(
        shop.paypalVaultId!,
        shop.paypalPayerId || '',
        totalAmount,
        shop.shopDomain,
        description,
        idempotencyKey,
        () => {
          providerRequestStarted = true;
        }
      );
      if (capture.status !== 'COMPLETED') {
        throw new Error(`Capture status: ${capture.status}`);
      }
      captureId =
        capture.purchase_units?.[0]?.payments?.captures?.[0]?.id || capture.id;
      provider = 'paypal';
    }

    chargedCaptureId = captureId;

    // Settle all claimed rows or none. Money has already moved, so a partial
    // database update would make the remaining claim impossible to reason
    // about and could hide which orders still need manual reconciliation.
    await prisma.$transaction(async (tx) => {
      const settledRowCount = await tx.$executeRaw`
        update commissions
        set status = 'paid', paid_at = now(), payment_ref = ${captureId}, payment_provider = ${provider}, updated_at = now()
        where shop_id = ${shop.id} and status = 'charging' and payment_ref = ${claimRef}`;
      if (settledRowCount !== pendingOrderIds.length) {
        throw new Error(
          `Commission settlement mismatch: claimed ${pendingOrderIds.length}, settled ${settledRowCount}`
        );
      }

      await tx.auditLog.update({
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
    });

    try {
      await clearBillingState(shop.id);
    } catch (stateError) {
      // The payment and commission settlement are already committed. Failing
      // to clear retry UI state must not mislabel the charge as unsettled.
      const stateErrorMessage = stateError instanceof Error ? stateError.message : String(stateError);
      console.error(
        `[AutoCharge] ${shop.shopDomain}: charge settled but billing state cleanup failed: ${stateErrorMessage}`
      );
      await prisma.auditLog
        .create({
          data: {
            shopId: shop.id,
            action: 'auto_charge_post_settlement_state_failed',
            resourceType: 'auto_charge',
            resourceId: captureId,
            metadata: { claimRef, error: stateErrorMessage },
          },
        })
        .catch(() => undefined);
    }
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

    if (shouldQuarantineClaimAfterProviderError(providerRequestStarted, errMsg)) {
      // A provider request may have succeeded even though its response was
      // lost. Never release these rows: a newly-arrived order would otherwise
      // change the idempotency key and charge the old rows again.
      await prisma.auditLog
        .update({
          where: { id: auditEntry.id },
          data: {
            action: 'auto_charge_outcome_unknown',
            resourceId: claimRef,
            metadata: {
              claimRef,
              idempotencyKey,
              provider: attemptedProvider,
              error: errMsg,
              orderIds: pendingOrderIds,
              amount: totalAmount,
              reviewRequired: true,
            },
          },
        })
        .catch(() => undefined);
      return {
        status: 'needs_review',
        reason: 'provider_outcome_unknown',
        claimRef,
        idempotencyKey,
      };
    }

    // No provider request started, or the provider confirmed that no payment
    // was captured. In either case this claim is safe to release.
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
      await setBillingState(shop.id, {
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
      // Disable only the method that actually failed. A Stripe decline must
      // not delete a separately vaulted PayPal method (and vice versa).
      const updates = buildFailedProviderDisableUpdates(attemptedProvider, shop);
      if (Object.keys(updates).length > 0) {
        await prisma.shop.update({ where: { id: shop.id }, data: updates });
      }
      await setBillingState(
        shop.id,
        {
          retryCount: 0,
          lastError: errMsg,
          lastErrorAt: new Date().toISOString(),
        },
        { clearRetryNextAt: true }
      );
      const notificationEmail =
        attemptedProvider === 'paypal'
          ? shop.paypalPayerEmail || shop.stripeEmail
          : shop.stripeEmail || shop.paypalPayerEmail;
      if (notificationEmail) {
        await sendChargeFinalFailureEmail({
          shopDomain: shop.shopDomain,
          to: notificationEmail,
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
    await setBillingState(shop.id, {
      retryCount: attemptNumber + 1,
      retryNextAt: nextRetryAt.toISOString(),
      lastError: errMsg,
      lastErrorAt: new Date().toISOString(),
    });

    const notificationEmail =
      attemptedProvider === 'paypal'
        ? shop.paypalPayerEmail || shop.stripeEmail
        : shop.stripeEmail || shop.paypalPayerEmail;
    if (notificationEmail) {
      await sendChargeRetryEmail({
        shopDomain: shop.shopDomain,
        to: notificationEmail,
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
