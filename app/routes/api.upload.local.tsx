import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { saveLocalFile } from "~/lib/storage.server";
import { handleCorsOptions, corsJson } from "~/lib/cors.server";

// POST /api/upload/local
// Handles local file uploads when R2/S3 is not configured
export async function action({ request }: ActionFunctionArgs) {
  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return handleCorsOptions(request);
  }

  if (request.method !== "POST") {
    return corsJson({ error: "Method not allowed" }, request, { status: 405 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const key = formData.get("key") as string;

    if (!file || !key) {
      return corsJson({ error: "Missing file or key" }, request, { status: 400 });
    }

    // Validate storage key format to prevent path traversal
    // Expected format: shopDomain/uploadId/itemId/filename
    if (key.includes('..') || key.startsWith('/') || key.startsWith('\\')) {
      return corsJson({ error: "Invalid storage key" }, request, { status: 400 });
    }

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Save to local storage
    const filePath = await saveLocalFile(key, buffer);

    return corsJson({
      success: true,
      key,
      path: filePath,
    }, request);
  } catch (error) {
    console.error("[LocalUpload] Error:", error);
    return corsJson({ error: "Upload failed" }, request, { status: 500 });
  }
}

// OPTIONS handler for CORS
export async function loader({ request }: ActionFunctionArgs) {
  if (request.method === "OPTIONS") {
    return handleCorsOptions(request);
  }
  return corsJson({ error: "Method not allowed" }, request, { status: 405 });
}
