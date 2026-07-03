






















import type { ActionFunctionArgs } from "@remix-run/node";
import { corsJson } from "~/lib/cors.server";
import { prisma } from "~/lib/prisma.server";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return corsJson({ error: "Method not allowed" }, request, { status: 405 });
  }

  try {
    const body = await request.json();
    const { uploadId, shopDomain, status, mockups } = body;

    if (!uploadId) {
      return corsJson({ error: "Missing uploadId" }, request, { status: 400 });
    }

    console.log(
      `[Mockup Callback] Received: upload=${uploadId}, shop=${shopDomain}, status=${status}, mockups=${mockups?.length || 0}`
    );

    if (status === "completed" && mockups && mockups.length > 0) {

      const upload = await prisma.upload.findFirst({
        where: { id: uploadId },
      });

      if (upload) {

        const existingSummary = (upload.preflightSummary as Record<string, any>) || {};

        await prisma.upload.update({
          where: { id: uploadId },
          data: {
            preflightSummary: {
              ...existingSummary,
              mockups: mockups.map((m: any) => ({
                garmentType: m.garmentType,
                url: m.url,
                key: m.key,
                width: m.width,
                height: m.height,
              })),
              mockupGeneratedAt: new Date().toISOString(),
            },
          },
        });

        console.log(
          `[Mockup Callback] Updated upload ${uploadId} with ${mockups.length} mockups`
        );
      } else {
        console.warn(`[Mockup Callback] Upload ${uploadId} not found`);
      }
    }

    return corsJson({ received: true }, request);
  } catch (error) {
    console.error("[Mockup Callback] Error:", error);
    return corsJson({ error: "Callback processing failed" }, request, { status: 500 });
  }
}
