





import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "~/lib/prisma.server";
import { rateLimitGuard, getIdentifier } from "~/lib/rateLimit.server";
import { Queue } from "bullmq";
import Redis from "ioredis";
import { createHash } from "crypto";

const getRedisConnection = () => {
  return new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
    maxRetriesPerRequest: null,
  });
};


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
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 100);
  const status = url.searchParams.get("status");

  const where: any = { shopId: shop.id };
  if (status) {
    where.status = status;
  }

  const [exports, total] = await Promise.all([
    prisma.exportJob.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: (page - 1) * limit,
      select: {
        id: true,
        status: true,
        downloadUrl: true,
        uploadIds: true,
        createdAt: true,
        completedAt: true,
        expiresAt: true,
      },
    }),
    prisma.exportJob.count({ where }),
  ]);

  return json({
    data: exports,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
}


export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }


  const identifier = getIdentifier(request, "shop");
  const rateLimitResponse = await rateLimitGuard(identifier, "adminApi");
  if (rateLimitResponse) return rateLimitResponse;

  const shop = await authenticateRequest(request);
  if (!shop) {
    return json({ error: "Unauthorized. Please provide valid API key." }, { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { uploadIds = [] } = body;

  if (!Array.isArray(uploadIds) || uploadIds.length === 0) {
    return json({ error: "uploadIds array is required." }, { status: 400 });
  }


  const validUploads = await prisma.upload.findMany({
    where: { id: { in: uploadIds }, shopId: shop.id },
    select: { id: true },
  });
  const validIds = validUploads.map(u => u.id);

  if (validIds.length === 0) {
    return json({ error: "No valid uploads found for this shop." }, { status: 400 });
  }


  const exportRecord = await prisma.exportJob.create({
    data: {
      shopId: shop.id,
      status: "pending",
      uploadIds: validIds,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });


  try {
    const queue = new Queue("export", { connection: getRedisConnection() });
    await queue.add("process-export", {
      exportId: exportRecord.id,
      shopId: shop.id,
      uploadIds: validIds,
    });
    await queue.close();
  } catch (error) {
    console.error("[Export API] Failed to queue job:", error);

  }

  return json({
    id: exportRecord.id,
    status: "pending",
    message: "Export job created. Use GET /api/v1/exports/:id to check status.",
  }, { status: 201 });
}
