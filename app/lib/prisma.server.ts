import { PrismaClient } from "@prisma/client";

declare global {
  var __prisma: PrismaClient | undefined;
}





export class TenantIsolationError extends Error {
  constructor(model: string, action: string) {
    super(`Tenant isolation violation: Query to ${model} without shopId scope (action: ${action})`);
    this.name = "TenantIsolationError";
  }
}



const STRICT_MODE = process.env.STRICT_TENANT_GUARD === "true";


function createPrismaClient() {
  const client = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });


  client.$use(async (params, next) => {

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


    const relationScopedModels = [
      "UploadItem", // scoped via upload relation
    ];

    if (directScopedModels.includes(params.model ?? "")) {

      if (["findMany", "findFirst", "findUnique", "count", "aggregate", "groupBy"].includes(params.action)) {
        const where = params.args?.where;




        const hasShopScope =
          where?.shopId ||
          where?.shop_id ||
          where?.shopId_productId?.shopId ||
          where?.shopId_fileKey?.shopId;

        if (!hasShopScope) {
          const message = `[TENANT GUARD] Query to ${params.model} without shopId scope - action: ${params.action}`;
          console.warn(message);



          if (STRICT_MODE) {
            throw new TenantIsolationError(params.model ?? "Unknown", params.action);
          }
        }
      }


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


    if (relationScopedModels.includes(params.model ?? "")) {
      if (["findMany", "findFirst", "count", "aggregate", "groupBy"].includes(params.action)) {
        const where = params.args?.where;

        const hasRelationScope =
          where?.upload?.shopId ||
          where?.uploadId ||
          where?.id;

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


export const prisma = globalThis.__prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = prisma;
}

export default prisma;

