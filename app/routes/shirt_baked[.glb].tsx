import type { LoaderFunctionArgs } from "@remix-run/node";
import { readFile, access } from "fs/promises";
import { constants } from "fs";
import { join } from "path";



export async function loader({ request }: LoaderFunctionArgs) {
  const filePath = join(process.cwd(), "public", "shirt_baked.glb");

  try {
    await access(filePath, constants.R_OK);
  } catch {
    console.error("[Model] File not found:", filePath);
    return new Response("Model not found", { status: 404 });
  }

  try {
    const fileBuffer = await readFile(filePath);

    return new Response(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": "model/gltf-binary",
        "Content-Length": fileBuffer.length.toString(),
        "Cache-Control": "public, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    console.error("[Model] Error reading file:", error);
    return new Response("Error loading model", { status: 500 });
  }
}

