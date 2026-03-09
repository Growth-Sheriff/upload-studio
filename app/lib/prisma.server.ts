import { PrismaClient } from "@prisma/client";

declare global {
  var __prisma: PrismaClient | undefined;
}

/**
 * Tenant Isolation Error - thrown when query lacks shop scope
 * This provides hard enforcement of tenant isolation rules
 */
export class TenantIsolationError extends Error {
  constructor(model: string, action: string) {
    super(`Tenant isolation violation: Query to ${model} without shopId scope (action: ${action})`);
    this.name = "TenantIsolationError";
  }
}

// Strict mode - when enabled, unscoped queries throw instead of warn
// Enable with STRICT_TENANT_GUARD=true in production for maximum security
const STRICT_MODE = process.env.STRICT_TENANT_GUARD === "true";

// Tenant-scoped Prisma client with shop_id guard middleware
function createPrismaClient() {
  const client = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

  // Tenant guard middleware - ensures all queries are shop-scoped
  client.$use(async (params, next) => {
    // Models that require direct shop_id scope (top-level models)
    const directScopedModels = [
      "ProductConfig",
      "AssetSet",
      "Upload",
      "OrderLink",
      "ExportJob",
      "AuditLog",
      "TeamMember",
      "ApiKey",
      "WhiteLabelConfig",
      "FlowTrigger",
      "Visitor",
      "VisitorSession",
      "Commission",
    ];

    // Models that can be scoped through relation (e.g., UploadItem via upload.shopId)
    const relationScopedModels = [
      "UploadItem", // scoped via upload relation
    ];

    if (directScopedModels.includes(params.model ?? "")) {
      // For read operations, ensure shop_id is in where clause
      if (["findMany", "findFirst", "findUnique", "count", "aggregate", "groupBy"].includes(params.action)) {
        const where = params.args?.where;
        // Check for shopId in different locations:
        // - Direct: where.shopId
        // - Composite key: where.shopId_productId.shopId (ProductConfig)
        // - Composite key: where.shopId_fileKey.shopId (Upload)
        const hasShopScope = 
          where?.shopId || 
          where?.shop_id || 
          where?.shopId_productId?.shopId ||
          where?.shopId_fileKey?.shopId;
        
        if (!hasShopScope) {
          const message = `[TENANT GUARD] Query to ${params.model} without shopId scope - action: ${params.action}`;
          console.warn(message);
          
          // Strict mode: throw error instead of just warning
          // This provides hard enforcement in production
          if (STRICT_MODE) {
            throw new TenantIsolationError(params.model ?? "Unknown", params.action);
          }
        }
      }

      // For batch write operations, ensure shop_id is in where clause
      if (["updateMany", "deleteMany"].includes(params.action)) {
        const where = params.args?.where;
        const hasShopScope = where?.shopId || where?.shop_id;
        
        if (!hasShopScope) {
          const message = `[TENANT GUARD] Batch write to ${params.model} without shopId scope - action: ${params.action}`;
          console.warn(message);
          
          if (STRICT_MODE) {
            throw new TenantIsolationError(params.model ?? "Unknown", params.action);
          }
        }
      }

      // For create operations, ensure data includes shopId
      if (params.action === "create") {
        const data = params.args?.data;
        const hasShopScope = data?.shopId || data?.shop_id;
        
        if (!hasShopScope) {
          const message = `[TENANT GUARD] Create on ${params.model} without shopId - action: ${params.action}`;
          console.warn(message);
          
          if (STRICT_MODE) {
            throw new TenantIsolationError(params.model ?? "Unknown", params.action);
          }
        }
      }
    }

    // For relation-scoped models, check for relation-based scope
    if (relationScopedModels.includes(params.model ?? "")) {
      if (["findMany", "findFirst", "count", "aggregate", "groupBy"].includes(params.action)) {
        const where = params.args?.where;
        // Check for relation-based scope (e.g., upload: { shopId: ... })
        const hasRelationScope = 
          where?.upload?.shopId || 
          where?.uploadId ||
          where?.id; // Direct ID access is OK (already scoped by caller)
        
        if (!hasRelationScope) {
          const message = `[TENANT GUARD] Query to ${params.model} without relation scope - action: ${params.action}`;
          console.warn(message);
          
          if (STRICT_MODE) {
            throw new TenantIsolationError(params.model ?? "Unknown", params.action);
          }
        }
      }
    }

    return next(params);
  });

  return client;
}

// Singleton pattern for Prisma client
export const prisma = globalThis.__prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = prisma;
}

export default prisma;

