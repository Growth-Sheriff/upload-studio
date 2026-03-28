/**
 * Billing & Commission Configuration
 *
 * Simple commission-based model (no plan tiers):
 * - Default: $0.10 per order (dtf, classic, quick, 3d_designer)
 * - Builder mode: $0.50 per order
 *
 * All features unlocked for all shops.
 */

import prisma from "~/lib/prisma.server";

// ===== COMMISSION CONFIGURATION =====
export const COMMISSION_RATES = {
  default: 0.10,
  builder: 0.50,
} as const;

// Universal file size limit (10GB)
export const MAX_FILE_SIZE_MB = 10240;

/**
 * Get commission rate for a given upload mode
 */
export function getCommissionRate(mode: string): number {
  if (mode === "builder") return COMMISSION_RATES.builder;
  return COMMISSION_RATES.default;
}

function buildOrderFeeDescription(
  feeAmounts: number[],
  monthKey?: string | null
): string {
  const defaultCount = feeAmounts.filter(
    (amount) => Math.abs(amount - COMMISSION_RATES.default) < 0.0001
  ).length;
  const builderCount = feeAmounts.filter(
    (amount) => Math.abs(amount - COMMISSION_RATES.builder) < 0.0001
  ).length;
  const customCount = feeAmounts.length - defaultCount - builderCount;

  const parts: string[] = [];
  if (defaultCount > 0) {
    parts.push(`${defaultCount} standard orders @ $${COMMISSION_RATES.default.toFixed(2)}`);
  }
  if (builderCount > 0) {
    parts.push(`${builderCount} builder orders @ $${COMMISSION_RATES.builder.toFixed(2)}`);
  }
  if (customCount > 0) {
    parts.push(`${customCount} custom-fee orders`);
  }

  const appName = process.env.APP_NAME || "Upload Studio";
  const prefix = monthKey ? `${appName} order fees (${monthKey})` : `${appName} order fees`;
  return `${prefix}: ${parts.join(", ")}`;
}

export async function getOutstandingFeeSelection(
  shopId: string,
  requestedOrderIds?: string[] | null,
  monthKey?: string | null
): Promise<{
  orderIds: string[];
  feeByOrderId: Map<string, number>;
  totalAmount: number;
  description: string;
}> {
  const pendingCommissions = await prisma.commission.findMany({
    where: {
      shopId,
      status: "pending",
      ...(requestedOrderIds?.length ? { orderId: { in: requestedOrderIds } } : {}),
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
  const totalAmount = feeAmounts.reduce((sum, amount) => sum + amount, 0);
  const description = buildOrderFeeDescription(feeAmounts, monthKey);

  return {
    orderIds,
    feeByOrderId,
    totalAmount,
    description,
  };
}

/**
 * Calculate pending commissions for a set of order IDs.
 * Returns total amount and per-order rates based on upload mode.
 */
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

  // Get modes for all pending orders via their uploads
  const orderLinks = await prisma.orderLink.findMany({
    where: { orderId: { in: pendingOrderIds }, shopId },
    select: { orderId: true, upload: { select: { mode: true } } },
  });

  const orderRates = new Map<string, number>();
  for (const orderId of pendingOrderIds) {
    const links = orderLinks.filter((ol) => ol.orderId === orderId);
    let rate: number = COMMISSION_RATES.default;
    for (const link of links) {
      const mode = link.upload?.mode || "dtf";
      rate = Math.max(rate, getCommissionRate(mode));
    }
    orderRates.set(orderId, rate);
  }

  const totalAmount = Array.from(orderRates.values()).reduce((sum, r) => sum + r, 0);

  // Build description
  const builderCount = Array.from(orderRates.values()).filter(
    (r) => r === COMMISSION_RATES.builder
  ).length;
  const defaultCount = pendingOrderIds.length - builderCount;
  const parts: string[] = [];
  if (defaultCount > 0) parts.push(`${defaultCount} orders @ $${COMMISSION_RATES.default}`);
  if (builderCount > 0) parts.push(`${builderCount} builder orders @ $${COMMISSION_RATES.builder}`);

  const appName = process.env.APP_NAME || "Upload Studio";
  const prefix = monthKey ? `${appName} commission (${monthKey})` : `${appName} commission`;
  const description = `${prefix}: ${parts.join(", ")}`;

  return { totalAmount, orderRates, description };
}

/**
 * Check if upload is allowed (simplified — no plan restrictions)
 */
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

  // Check billing active
  if (shop.billingStatus !== "active") {
    return {
      allowed: false,
      error: "Billing is not active. Please update your payment method.",
    };
  }

  // Check file size (universal limit)
  if (fileSizeMB > MAX_FILE_SIZE_MB) {
    return {
      allowed: false,
      error: `File size (${fileSizeMB.toFixed(1)}MB) exceeds the maximum limit (${MAX_FILE_SIZE_MB}MB).`,
    };
  }

  return { allowed: true };
}

