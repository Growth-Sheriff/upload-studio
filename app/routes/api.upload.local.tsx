import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { saveLocalFile } from "~/lib/storage.server";
import { handleCorsOptions, corsJson } from "~/lib/cors.server";



export async function action({ request }: ActionFunctionArgs) {

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



    if (key.includes('..') || key.startsWith('/') || key.startsWith('\\')) {
      return corsJson({ error: "Invalid storage key" }, request, { status: 400 });
    }


    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);


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


export async function loader({ request }: ActionFunctionArgs) {
  if (request.method === "OPTIONS") {
    return handleCorsOptions(request);
  }
  return corsJson({ error: "Method not allowed" }, request, { status: 405 });
}
