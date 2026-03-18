/**
 * Billing Enforcement v2.0
 *
 * Two-tier plan structure:
 * - Starter: $9/mo, 20 free orders, $0.05/extra order
 * - Pro: $19/mo, 30 free orders, $0.06/extra order, unlimited features
 *
 * Usage-based billing model with Shopify Billing API
 */

import prisma from "~/lib/prisma.server";

// ===== PLAN CONFIGURATIONS =====
export const PLAN_LIMITS = {
  starter: {
    monthlyPrice: 9,
    freeOrdersPerMonth: 20,
    extraOrderPrice: 0.05,
    maxFileSizeMB: 1024,
    modes: ["classic", "quick", "dtf", "builder"],
    features: {
      "3d_designer": false,
      "quick_upload": true,
      "analytics": true,
      "export": true,
      "team": false,
      "api": false,
      "whiteLabel": false,
      "flow": false,
      "priority_support": false,
    },
    description: "Perfect for small shops getting started",
  },
  pro: {
    monthlyPrice: 19,
    freeOrdersPerMonth: 30,
    extraOrderPrice: 0.06,
    maxFileSizeMB: 1453,
    modes: ["3d_designer", "classic", "quick", "dtf", "builder"],
    features: {
      "3d_designer": true,
      "quick_upload": true,
      "analytics": true,
      "export": true,
      "team": true,
      "api": true,
      "whiteLabel": true,
      "flow": true,
      "priority_support": true,
    },
    description: "For growing businesses with unlimited needs",
  },
  // v4.5.0: Enterprise plan with 10GB file support and no limits
  enterprise: {
    monthlyPrice: 0, // Custom billing
    freeOrdersPerMonth: 999999, // Unlimited
    extraOrderPrice: 0,
    maxFileSizeMB: 10240, // 10GB - no limits
    modes: ["3d_designer", "classic", "quick", "dtf", "builder"],
    features: {
      "3d_designer": true,
      "quick_upload": true,
      "analytics": true,
      "export": true,
      "team": true,
      "api": true,
      "whiteLabel": true,
      "flow": true,
      "priority_support": true,
    },
    description: "Enterprise - unlimited everything",
  },
} as const;

export type PlanName = keyof typeof PLAN_LIMITS;
export type FeatureName = keyof typeof PLAN_LIMITS.starter.features;

// ===== INTERFACES =====
interface OrderUsage {
  currentOrders: number;
  freeOrdersLimit: number;
  extraOrders: number;
  extraOrdersCost: number;
  estimatedBill: number;
  percentage: number;
  isOverFreeLimit: boolean;
}

interface BillingStatus {
  plan: PlanName;
  billingStatus: string;
  isActive: boolean;
  usage: OrderUsage;
  canUseMode: (mode: string) => boolean;
  hasFeature: (feature: FeatureName) => boolean;
  maxFileSizeMB: number;
  monthlyPrice: number;
}

/**
 * Get current month's order count (orders with custom uploads)
 */
async function getMonthlyOrderCount(shopId: string): Promise<number> {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  // Count orders that have uploads attached (custom orders)
  const count = await prisma.upload.count({
    where: {
      shopId,
      createdAt: { gte: startOfMonth },
      status: { in: ["completed", "processing", "ready"] },
      orderId: { not: null }, // Only count uploads attached to orders
    },
  });

  return count;
}

/**
 * Get billing status for a shop
 */
export async function getBillingStatus(shopId: string): Promise<BillingStatus> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { plan: true, billingStatus: true },
  });

  if (!shop) {
    throw new Error("Shop not found");
  }

  // Default to starter if plan not set or invalid
  const plan = (shop.plan as PlanName) in PLAN_LIMITS 
    ? (shop.plan as PlanName) 
    : "starter";
  const planConfig = PLAN_LIMITS[plan];

  const currentOrders = await getMonthlyOrderCount(shopId);
  const freeOrdersLimit = planConfig.freeOrdersPerMonth;
  const extraOrders = Math.max(0, currentOrders - freeOrdersLimit);
  const extraOrdersCost = extraOrders * planConfig.extraOrderPrice;
  const estimatedBill = planConfig.monthlyPrice + extraOrdersCost;
  const percentage = Math.round((currentOrders / freeOrdersLimit) * 100);
  const isOverFreeLimit = currentOrders > freeOrdersLimit;

  return {
    plan,
    billingStatus: shop.billingStatus,
    isActive: shop.billingStatus === "active",
    usage: {
      currentOrders,
      freeOrdersLimit,
      extraOrders,
      extraOrdersCost,
      estimatedBill,
      percentage,
      isOverFreeLimit,
    },
    canUseMode: (mode: string) => planConfig.modes.includes(mode as any),
    hasFeature: (feature: FeatureName) => planConfig.features[feature],
    maxFileSizeMB: planConfig.maxFileSizeMB,
    monthlyPrice: planConfig.monthlyPrice,
  };
}

/**
 * Check if upload is allowed
 */
export async function checkUploadAllowed(
  shopId: string,
  mode: string,
  fileSizeMB: number
): Promise<{ allowed: boolean; error?: string; warning?: string }> {
  const billing = await getBillingStatus(shopId);

  // Check billing active
  if (!billing.isActive) {
    return {
      allowed: false,
      error: "Billing is not active. Please update your payment method."
    };
  }

  // Check mode allowed
  if (!billing.canUseMode(mode)) {
    return {
      allowed: false,
      error: `${mode} mode requires Pro plan. Upgrade for just $10 more per month.`
    };
  }

  // Check file size
  if (fileSizeMB > billing.maxFileSizeMB) {
    return {
      allowed: false,
      error: `File size (${fileSizeMB.toFixed(1)}MB) exceeds plan limit (${billing.maxFileSizeMB}MB). Upgrade to Pro for 150MB limit.`,
    };
  }

  // Usage-based: Always allow, just show warning if over free limit
  if (billing.usage.isOverFreeLimit) {
    const { extraOrders, extraOrdersCost } = billing.usage;
    const price = billing.plan === "starter" ? "$0.05" : "$0.06";
    return {
      allowed: true,
      warning: `You have ${extraOrders} orders over your free limit (+$${extraOrdersCost.toFixed(2)} this month at ${price}/order).`,
    };
  }

  // Near limit warning (>80%)
  if (billing.usage.percentage >= 80) {
    const remaining = billing.usage.freeOrdersLimit - billing.usage.currentOrders;
    return {
      allowed: true,
      warning: `You have ${remaining} free orders remaining this month.`,
    };
  }

  return { allowed: true };
}

/**
 * Check feature access
 */
export async function checkFeatureAccess(
  shopId: string,
  feature: FeatureName
): Promise<{ allowed: boolean; error?: string }> {
  const billing = await getBillingStatus(shopId);

  if (!billing.isActive) {
    return {
      allowed: false,
      error: "Billing is not active."
    };
  }

  if (!billing.hasFeature(feature)) {
    return {
      allowed: false,
      error: `This feature requires Pro plan ($19/month).`,
    };
  }

  return { allowed: true };
}

/**
 * Calculate estimated monthly bill
 */
export async function calculateEstimatedBill(shopId: string): Promise<{
  plan: PlanName;
  basePrice: number;
  freeOrders: number;
  usedOrders: number;
  extraOrders: number;
  extraOrderPrice: number;
  extraOrdersCost: number;
  estimatedTotal: number;
}> {
  const billing = await getBillingStatus(shopId);
  const planConfig = PLAN_LIMITS[billing.plan];

  return {
    plan: billing.plan,
    basePrice: planConfig.monthlyPrice,
    freeOrders: planConfig.freeOrdersPerMonth,
    usedOrders: billing.usage.currentOrders,
    extraOrders: billing.usage.extraOrders,
    extraOrderPrice: planConfig.extraOrderPrice,
    extraOrdersCost: billing.usage.extraOrdersCost,
    estimatedTotal: billing.usage.estimatedBill,
  };
}

/**
 * Usage alert check (for dashboard banner)
 */
export async function getUsageAlerts(shopId: string): Promise<Array<{
  type: "warning" | "critical" | "info";
  message: string;
  action?: { label: string; url: string };
}>> {
  const billing = await getBillingStatus(shopId);
  const alerts: Array<{
    type: "warning" | "critical" | "info";
    message: string;
    action?: { label: string; url: string };
  }> = [];

  if (!billing.isActive) {
    alerts.push({
      type: "critical",
      message: "Your billing is inactive. Please update your payment method.",
      action: { label: "Update Payment", url: "/app/billing" },
    });
  }

  if (billing.usage.isOverFreeLimit) {
    const { extraOrders, extraOrdersCost } = billing.usage;
    alerts.push({
      type: "info",
      message: `You have ${extraOrders} orders over your free limit this month (+$${extraOrdersCost.toFixed(2)}).`,
      action: billing.plan === "starter" 
        ? { label: "Upgrade to Pro", url: "/app/billing" }
        : undefined,
    });
  } else if (billing.usage.percentage >= 80) {
    const remaining = billing.usage.freeOrdersLimit - billing.usage.currentOrders;
    alerts.push({
      type: "warning",
      message: `You have ${remaining} free orders remaining this month.`,
    });
  }

  return alerts;
}

/**
 * Get plan comparison for upgrade prompts
 */
export function getPlanComparison() {
  return {
    starter: {
      ...PLAN_LIMITS.starter,
      name: "Starter",
      highlights: [
        "20 free orders/month",
        "Then $0.05 per order",
        "DTF & Quick Upload modes",
        "50MB file uploads",
        "Analytics dashboard",
        "Export to PDF/PNG",
      ],
    },
    pro: {
      ...PLAN_LIMITS.pro,
      name: "Pro",
      highlights: [
        "30 free orders/month",
        "Then $0.06 per order",
        "3D Designer mode",
        "150MB file uploads",
        "Team collaboration",
        "API access",
        "White-label branding",
        "Priority support",
      ],
    },
  };
}

