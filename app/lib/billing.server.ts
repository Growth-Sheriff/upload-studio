import prisma from "~/lib/prisma.server";

// Single commercial model (2026-09): no plans, no upload limits. Every order
// served by this app is billed 4% of the app's own line items (net of line
// discounts); orders the app did not serve are never billed.
export const COMMISSION_PERCENT = 0.04;
export const COMMISSION_RATES = {
  default: COMMISSION_PERCENT,
  builder: COMMISSION_PERCENT,
} as const;

// Technical ceiling only (multipart handles it); not a plan limit.
export const MAX_FILE_SIZE_MB = 10240;

export function getCommissionRate(_mode: string): number {
  return COMMISSION_PERCENT;
}

/** 4% of the served amount, rounded to cents. */
export function calculateCommissionAmount(servedAmount: number): number {
  const base = Number.isFinite(servedAmount) && servedAmount > 0 ? servedAmount : 0;
  return Math.round(base * COMMISSION_PERCENT * 100) / 100;
}

function buildOrderFeeDescription(
  feeAmounts: number[],
  monthKey?: string | null
): string {
  const appName = process.env.APP_NAME || "Upload Studio";
  // Shown to the merchant on Stripe/PayPal checkout and receipts: plain "order fees".
  const prefix = monthKey ? `${appName} order fees (${monthKey})` : `${appName} order fees`;
  const total = feeAmounts.reduce((sum, amount) => sum + amount, 0);
  return `${prefix}: ${feeAmounts.length} order${feeAmounts.length === 1 ? "" : "s"} ($${total.toFixed(2)})`;
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
  const totalAmount = amounts.reduce((sum, r) => sum + r, 0);
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

