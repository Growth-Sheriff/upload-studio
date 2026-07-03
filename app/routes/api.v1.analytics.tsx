




import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "~/lib/prisma.server";
import { rateLimitGuard, getIdentifier } from "~/lib/rateLimit.server";
import { createHash } from "crypto";


function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}


async function authenticateRequest(request: Request) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const apiKey = authHeader.slice(7);
  const keyHash = hashApiKey(apiKey);

  const keyRecord = await prisma.apiKey.findFirst({
    where: {
      keyHash,
      status: "active",
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
  });

  if (!keyRecord) return null;


  await prisma.apiKey.update({
    where: { id: keyRecord.id },
    data: { lastUsedAt: new Date(), usageCount: { increment: 1 } },
  });


  const shop = await prisma.shop.findUnique({
    where: { id: keyRecord.shopId },
  });

  return shop;
}


export async function loader({ request }: LoaderFunctionArgs) {

  const identifier = getIdentifier(request, "shop");
  const rateLimitResponse = await rateLimitGuard(identifier, "adminApi");
  if (rateLimitResponse) return rateLimitResponse;

  const shop = await authenticateRequest(request);
  if (!shop) {
    return json({ error: "Unauthorized. Please provide valid API key." }, { status: 401 });
  }

  const url = new URL(request.url);
  const period = url.searchParams.get("period") || "30d";


  let startDate: Date;
  const now = new Date();
  switch (period) {
    case "7d":
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case "30d":
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case "90d":
      startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      break;
    case "all":
      startDate = new Date(0);
      break;
    default:
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }


  const [
    totalUploads,
    uploadsByStatus,
    uploadsByMode,
    recentUploads,
    orderLinksCount,
    storageUsed,
  ] = await Promise.all([

    prisma.upload.count({
      where: {
        shopId: shop.id,
        createdAt: { gte: startDate },
      },
    }),


    prisma.upload.groupBy({
      by: ["status"],
      where: {
        shopId: shop.id,
        createdAt: { gte: startDate },
      },
      _count: true,
    }),


    prisma.upload.groupBy({
      by: ["mode"],
      where: {
        shopId: shop.id,
        createdAt: { gte: startDate },
      },
      _count: true,
    }),


    prisma.upload.findMany({
      where: { shopId: shop.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        status: true,
        mode: true,
        createdAt: true,
      },
    }),


    prisma.orderLink.count({
      where: {
        shopId: shop.id,
        createdAt: { gte: startDate },
      },
    }),


    prisma.uploadItem.aggregate({
      where: {
        upload: {
          shopId: shop.id,
        },
      },
      _sum: {
        fileSize: true,
      },
    }),
  ]);


  const statusCounts: Record<string, number> = {};
  for (const item of uploadsByStatus) {
    statusCounts[item.status] = item._count;
  }

  const modeCounts: Record<string, number> = {};
  for (const item of uploadsByMode) {
    modeCounts[item.mode || "unknown"] = item._count;
  }


  const completedUploads = statusCounts["completed"] || statusCounts["approved"] || 0;
  const conversionRate = totalUploads > 0 && completedUploads > 0
    ? ((orderLinksCount / completedUploads) * 100).toFixed(2)
    : "0";

  return json({
    period,
    startDate: startDate.toISOString(),
    endDate: now.toISOString(),
    uploads: {
      total: totalUploads,
      byStatus: statusCounts,
      byMode: modeCounts,
      recent: recentUploads,
    },
    orders: {
      linkedCount: orderLinksCount,
    },
    storage: {
      usedBytes: storageUsed._sum.fileSize || 0,
      usedMB: Math.round((storageUsed._sum.fileSize || 0) / (1024 * 1024) * 100) / 100,
    },
    metrics: {
      conversionRate: parseFloat(conversionRate) || 0,
    },
  });
}
