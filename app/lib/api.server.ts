






import { json } from "@remix-run/node";
import prisma from "~/lib/prisma.server";
import crypto from "crypto";
import { checkRateLimit } from "~/lib/rateLimit.server";

export interface ApiContext {
  shopId: string;
  shopDomain: string;
  apiKeyId: string;
  permissions: string[];
}




export async function authenticateApiRequest(request: Request): Promise<ApiContext | Response> {
  const authHeader = request.headers.get("Authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return json(
      { error: "Missing or invalid Authorization header", code: "UNAUTHORIZED" },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } }
    );
  }

  const token = authHeader.slice(7);

  if (!token.startsWith("ulp_")) {
    return json(
      { error: "Invalid API key format", code: "INVALID_KEY" },
      { status: 401 }
    );
  }


  const keyHash = crypto.createHash("sha256").update(token).digest("hex");

  const apiKey = await prisma.apiKey.findFirst({
    where: {
      keyHash,
      status: "active",
    },
    include: {
      shop: {
        select: { id: true, shopDomain: true, plan: true, billingStatus: true },
      },
    },
  });

  if (!apiKey) {
    return json(
      { error: "Invalid or revoked API key", code: "INVALID_KEY" },
      { status: 401 }
    );
  }


  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
    return json(
      { error: "API key has expired", code: "EXPIRED_KEY" },
      { status: 401 }
    );
  }


  if (apiKey.shop.billingStatus !== "active") {
    return json(
      { error: "Shop billing is not active", code: "BILLING_INACTIVE" },
      { status: 402 }
    );
  }


  if (apiKey.shop.plan !== "enterprise") {
    return json(
      { error: "API access requires Enterprise plan", code: "PLAN_REQUIRED" },
      { status: 403 }
    );
  }


  const rateLimitResult = await checkRateLimit(`api:${apiKey.id}`, {
    windowMs: 60 * 1000,
    maxRequests: apiKey.rateLimit,
    keyPrefix: "rl:api:",
  });

  if (!rateLimitResult.allowed) {
    return json(
      {
        error: "Rate limit exceeded",
        code: "RATE_LIMITED",
        retryAfter: rateLimitResult.retryAfter,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimitResult.retryAfter),
          "X-RateLimit-Limit": String(apiKey.rateLimit),
          "X-RateLimit-Remaining": "0",
        },
      }
    );
  }


  await prisma.apiKey.update({
    where: { id: apiKey.id },
    data: {
      lastUsedAt: new Date(),
      usageCount: { increment: 1 },
    },
  });

  return {
    shopId: apiKey.shop.id,
    shopDomain: apiKey.shop.shopDomain,
    apiKeyId: apiKey.id,
    permissions: apiKey.permissions,
  };
}




export function hasApiPermission(ctx: ApiContext, permission: string): boolean {
  return ctx.permissions.includes(permission);
}




export function requireApiPermission(ctx: ApiContext, permission: string): Response | null {
  if (!hasApiPermission(ctx, permission)) {
    return json(
      {
        error: "Insufficient permissions",
        code: "FORBIDDEN",
        required: permission,
      },
      { status: 403 }
    );
  }
  return null;
}









export function verifyResourceOwnership(
  resourceShopId: string | undefined,
  ctx: ApiContext
): Response | null {
  if (!resourceShopId) {
    console.error(`[OWNERSHIP] Resource missing shopId - potential data integrity issue`);
    return json(
      { error: "Resource not found", code: "NOT_FOUND" },
      { status: 404 }
    );
  }

  if (resourceShopId !== ctx.shopId) {

    console.error(
      `[OWNERSHIP VIOLATION] Shop ${ctx.shopId} attempted to access resource belonging to shop ${resourceShopId}`
    );


    return json(
      { error: "Resource not found", code: "NOT_FOUND" },
      { status: 404 }
    );
  }

  return null;
}




export async function createSecurityAuditLog(
  shopId: string,
  action: string,
  details: Record<string, unknown>
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        shopId,
        action: `security:${action}`,
        resourceType: "security",
        metadata: {
          ...details,
          timestamp: new Date().toISOString(),
        },
      },
    });
  } catch (error) {
    console.error(`[AUDIT] Failed to create security audit log:`, error);
  }
}

