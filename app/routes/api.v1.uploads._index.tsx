




import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticateApiRequest, requireApiPermission } from "~/lib/api.server";
import prisma from "~/lib/prisma.server";


export async function loader({ request }: LoaderFunctionArgs) {

  const authResult = await authenticateApiRequest(request);
  if (authResult instanceof Response) {
    return authResult;
  }
  const ctx = authResult;


  const permError = requireApiPermission(ctx, "uploads:read");
  if (permError) return permError;


  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const mode = url.searchParams.get("mode");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);
  const offset = parseInt(url.searchParams.get("offset") || "0");
  const sortBy = url.searchParams.get("sortBy") || "createdAt";
  const sortOrder = url.searchParams.get("sortOrder") === "asc" ? "asc" : "desc";


  const where: any = { shopId: ctx.shopId };
  if (status) where.status = status;
  if (mode) where.mode = mode;


  const [uploads, total] = await Promise.all([
    prisma.upload.findMany({
      where,
      include: {
        items: {
          select: {
            id: true,
            location: true,
            preflightStatus: true,
            thumbnailKey: true,
            originalName: true,
          },
        },
      },
      orderBy: { [sortBy]: sortOrder },
      skip: offset,
      take: limit,
    }),
    prisma.upload.count({ where }),
  ]);

  return json({
    data: uploads.map(u => ({
      id: u.id,
      mode: u.mode,
      status: u.status,
      productId: u.productId,
      variantId: u.variantId,
      orderId: u.orderId,
      customerId: u.customerId,
      customerEmail: u.customerEmail,
      items: u.items.map(i => ({
        id: i.id,
        location: i.location,
        preflightStatus: i.preflightStatus,
        originalName: i.originalName,
      })),
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
      approvedAt: u.approvedAt?.toISOString(),
      rejectedAt: u.rejectedAt?.toISOString(),
    })),
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    },
  });
}

