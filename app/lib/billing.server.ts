import { createHash } from "node:crypto";
import prisma from "~/lib/prisma.server";

// Single commercial model (2026-09): no plans, no upload limits. Every order
// served by this app is billed 4% of the app's own line items (net of line
// discounts); orders the app did not serve are never billed.
export const COMMISSION_PERCENT = 0.04;
/** Per-order ceiling: the 4% fee never exceeds this amount (merchant rule, 2026-09-12). */
export const COMMISSION_CAP_USD = 6;
export const COMMISSION_RATES = {
  default: COMMISSION_PERCENT,
  builder: COMMISSION_PERCENT,
} as const;

// Technical ceiling only (multipart handles it); not a plan limit.
export const MAX_FILE_SIZE_MB = 10240;

export function getCommissionRate(_mode: string): number {
  return COMMISSION_PERCENT;
}

/** 4% of the served amount, rounded to cents, capped at COMMISSION_CAP_USD. */
export function calculateCommissionAmount(servedAmount: number): number {
  const base = Number.isFinite(servedAmount) && servedAmount > 0 ? servedAmount : 0;
  const raw = Math.round(base * COMMISSION_PERCENT * 100) / 100;
  return Math.min(raw, COMMISSION_CAP_USD);
}

/** Convert a persisted two-decimal money amount to integer cents. */
export function moneyToCents(amount: number): number {
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

/** Sum money without accumulating IEEE-754 drift across many fee rows. */
export function sumMoneyCents(amounts: Iterable<number>): number {
  let totalCents = 0;
  for (const amount of amounts) totalCents += moneyToCents(amount);
  return totalCents;
}

export function centsToMoney(cents: number): number {
  return cents / 100;
}

/** Providers in this app currently create USD charges only. Never reinterpret
 * an order-currency amount as USD without an explicit FX policy. */
export function isSupportedBillingCurrency(value: unknown): boolean {
  return String(value || '').trim().toUpperCase() === 'USD';
}

/** Orders the customer paid nothing for (free, 100% discounted, $0 test orders) are never billed. */
export function isZeroPaymentOrder(order: {
  total_price?: string | number | null;
  current_total_price?: string | number | null;
}): boolean {
  const total = parseFloat(String(order.current_total_price ?? order.total_price ?? '0')) || 0;
  return total <= 0;
}

/**
 * Provider idempotency key for one persisted logical charge attempt. Retries
 * of the same claim reuse the key; a confirmed failure followed by a new
 * attempt gets a new key even when the order set and amount are unchanged.
 */
export function buildAutoChargeIdempotencyKey(
  shopDomain: string,
  orderIds: string[],
  amount: string,
  attemptRef: string
): string {
  const digest = createHash("sha256")
    .update([shopDomain, attemptRef, amount, ...orderIds.map(String).sort()].join("|"))
    .digest("hex")
    .slice(0, 40);
  return `us-autocharge-${digest}`;
}

export function buildOrderFeeDescription(
  feeAmounts: number[],
  monthKey?: string | null
): string {
  const appName = process.env.APP_NAME || "Upload Studio";
  // Shown to the merchant on Stripe/PayPal checkout and receipts: plain "order fees".
  const prefix = monthKey ? `${appName} order fees (${monthKey})` : `${appName} order fees`;
  const total = centsToMoney(sumMoneyCents(feeAmounts));
  return `${prefix}: ${feeAmounts.length} order${feeAmounts.length === 1 ? "" : "s"} ($${total.toFixed(2)})`;
}

export async function getOutstandingFeeSelection(
  shopId: string,
  requestedOrderIds?: string[] | null,
  monthKey?: string | null,
  options: { orderCurrency?: string | null } = {}
): Promise<{
  orderIds: string[];
  feeByOrderId: Map<string, number>;
  totalCents: number;
  totalAmount: number;
  description: string;
}> {
  const pendingCommissions = await prisma.commission.findMany({
    where: {
      shopId,
      status: "pending",
      paymentRef: null,
      ...(requestedOrderIds?.length ? { orderId: { in: requestedOrderIds } } : {}),
      ...(options.orderCurrency
        ? { orderCurrency: { equals: options.orderCurrency, mode: 'insensitive' as const } }
        : {}),
    },
    select: {
      orderId: true,
      commissionAmount: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  const orderIds = pendingCommissions.map((commission) => commission.orderId);
  const feeByOrderId = new Map(
    pendingCommissions.map((commission) => [
      commission.orderId,
      Number(commission.commissionAmount),
    ])
  );
  const feeAmounts = pendingCommissions.map((commission) => Number(commission.commissionAmount));
  const totalCents = sumMoneyCents(feeAmounts);
  const totalAmount = centsToMoney(totalCents);
  const description = buildOrderFeeDescription(feeAmounts, monthKey);

  return {
    orderIds,
    feeByOrderId,
    totalCents,
    totalAmount,
    description,
  };
}

export async function calculatePendingCommissions(
  shopId: string,
  pendingOrderIds: string[],
  monthKey?: string | null
): Promise<{
  totalAmount: number;
  orderRates: Map<string, number>;
  description: string;
}> {
  if (pendingOrderIds.length === 0) {
    return { totalAmount: 0, orderRates: new Map(), description: "" };
  }
  const rows = await prisma.commission.findMany({
    where: { shopId, orderId: { in: pendingOrderIds } },
    select: { orderId: true, commissionAmount: true },
  });
  const orderRates = new Map<string, number>();
  for (const row of rows) orderRates.set(row.orderId, Number(row.commissionAmount));
  const amounts = Array.from(orderRates.values());
  const totalAmount = centsToMoney(sumMoneyCents(amounts));
  return { totalAmount, orderRates, description: buildOrderFeeDescription(amounts, monthKey) };
}

export async function checkUploadAllowed(
  shopId: string,
  _mode: string,
  fileSizeMB: number
): Promise<{ allowed: boolean; error?: string; warning?: string }> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { billingStatus: true },
  });

  if (!shop) {
    return { allowed: false, error: "Shop not found" };
  }


  if (shop.billingStatus !== "active") {
    return {
      allowed: false,
      error: "Billing is not active. Please update your payment method.",
    };
  }


  if (fileSizeMB > MAX_FILE_SIZE_MB) {
    return {
      allowed: false,
      error: `File size (${fileSizeMB.toFixed(1)}MB) exceeds the maximum limit (${MAX_FILE_SIZE_MB}MB).`,
    };
  }

  return { allowed: true };
}

