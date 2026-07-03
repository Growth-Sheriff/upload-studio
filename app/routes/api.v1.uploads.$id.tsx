






import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticateApiRequest, requireApiPermission } from "~/lib/api.server";
import prisma from "~/lib/prisma.server";


export async function loader({ request, params }: LoaderFunctionArgs) {
  const { id } = params;


  const authResult = await authenticateApiRequest(request);
  if (authResult instanceof Response) {
    return authResult;
  }
  const ctx = authResult;


  const permError = requireApiPermission(ctx, "uploads:read");
  if (permError) return permError;


  const upload = await prisma.upload.findFirst({
    where: { id, shopId: ctx.shopId },
    include: {
      items: true,
      ordersLink: {
        select: { orderId: true, lineItemId: true },
      },
    },
  });

  if (!upload) {
    return json({ error: "Upload not found", code: "NOT_FOUND" }, { status: 404 });
  }

  return json({
    data: {
      id: upload.id,
      mode: upload.mode,
      status: upload.status,
      productId: upload.productId,
      variantId: upload.variantId,
      orderId: upload.orderId,
      customerId: upload.customerId,
      customerEmail: upload.customerEmail,
      preflightSummary: upload.preflightSummary,
      items: upload.items.map(i => ({
        id: i.id,
        location: i.location,
        storageKey: i.storageKey,
        previewKey: i.previewKey,
        thumbnailKey: i.thumbnailKey,
        originalName: i.originalName,
        mimeType: i.mimeType,
        fileSize: i.fileSize,
        transform: i.transform,
        preflightStatus: i.preflightStatus,
        preflightResult: i.preflightResult,
        createdAt: i.createdAt.toISOString(),
      })),
      orders: upload.ordersLink.map(o => ({
        orderId: o.orderId,
        lineItemId: o.lineItemId,
      })),
      createdAt: upload.createdAt.toISOString(),
      updatedAt: upload.updatedAt.toISOString(),
      approvedAt: upload.approvedAt?.toISOString(),
      rejectedAt: upload.rejectedAt?.toISOString(),
    },
  });
}


export async function action({ request, params }: ActionFunctionArgs) {
  const { id } = params;
  const url = new URL(request.url);
  const actionType = url.pathname.endsWith("/approve") ? "approve" :
                     url.pathname.endsWith("/reject") ? "reject" : null;

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  if (!actionType) {
    return json({ error: "Invalid action" }, { status: 400 });
  }


  const authResult = await authenticateApiRequest(request);
  if (authResult instanceof Response) {
    return authResult;
  }
  const ctx = authResult;


  const permError = requireApiPermission(ctx, "uploads:write");
  if (permError) return permError;


  const upload = await prisma.upload.findFirst({
    where: { id, shopId: ctx.shopId },
  });

  if (!upload) {
    return json({ error: "Upload not found", code: "NOT_FOUND" }, { status: 404 });
  }


  let body: { notes?: string; reason?: string } = {};
  try {
    body = await request.json();
  } catch {

  }


  const updateData: any = {};

  if (actionType === "approve") {
    updateData.status = "approved";
    updateData.approvedAt = new Date();
  } else {
    updateData.status = "rejected";
    updateData.rejectedAt = new Date();
  }



  await prisma.upload.update({
    where: {
      id,
      shopId: ctx.shopId,
    },
    data: updateData,
  });


  await prisma.auditLog.create({
    data: {
      shopId: ctx.shopId,
      action: `api_${actionType}`,
      resourceType: "upload",
      resourceId: id,
      metadata: {
        apiKeyId: ctx.apiKeyId,
        notes: body.notes,
        reason: body.reason,
      },
    },
  });


  await prisma.flowTrigger.create({
    data: {
      shopId: ctx.shopId,
      eventType: `upload_${actionType}d`,
      resourceId: id!, // id is validated earlier via upload lookup
      payload: {
        uploadId: id,
        status: updateData.status,
        timestamp: new Date().toISOString(),
      },
    },
  });

  return json({
    success: true,
    data: {
      id,
      status: updateData.status,
      [actionType === "approve" ? "approvedAt" : "rejectedAt"]: new Date().toISOString(),
    },
  });
}

