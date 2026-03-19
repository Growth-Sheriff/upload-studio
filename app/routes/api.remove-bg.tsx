/**
 * Remove Background API Proxy
 * ============================
 * POST /api/remove-bg
 * 
 * Proxies requests to remove.bg API.
 * API key is read from REMOVE_BG_API_KEY env variable.
 * Never exposes the API key to the client.
 */
import type { ActionFunctionArgs } from "@remix-run/node";
import { handleCorsOptions, corsJson } from "~/lib/cors.server";

export async function action({ request }: ActionFunctionArgs) {
  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return handleCorsOptions(request);
  }

  if (request.method !== "POST") {
    return corsJson({ error: "Method not allowed" }, request, { status: 405 });
  }

  const apiKey = process.env.REMOVE_BG_API_KEY;
  if (!apiKey) {
    console.error("[Remove BG] REMOVE_BG_API_KEY not set in environment");
    return corsJson({ error: "Background removal is not configured" }, request, { status: 503 });
  }

  try {
    const body = await request.json();
    const { imageUrl } = body;

    if (!imageUrl) {
      return corsJson({ error: "Missing imageUrl" }, request, { status: 400 });
    }

    // Call remove.bg API
    const response = await fetch("https://api.remove.bg/v1.0/removebg", {
      method: "POST",
      headers: {
        "X-Api-Key": apiKey,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        image_url: imageUrl,
        size: "full",
        format: "png",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Remove BG] API error:", response.status, errorText);
      return corsJson(
        { error: "Background removal failed", details: response.status },
        request,
        { status: 502 }
      );
    }

    // remove.bg returns base64 in JSON response with Accept: application/json
    const result = await response.json();

    return corsJson({
      resultUrl: result.data ? `data:image/png;base64,${result.data.result_b64}` : null,
      creditsCharged: result.data?.credits_charged || 0,
    }, request);
  } catch (error) {
    console.error("[Remove BG] Error:", error);
    return corsJson(
      { error: "Background removal failed" },
      request,
      { status: 500 }
    );
  }
}

// Loader for CORS preflight
export async function loader({ request }: ActionFunctionArgs) {
  if (request.method === "OPTIONS") {
    return handleCorsOptions(request);
  }
  return corsJson({ method: "POST", description: "Remove Background API Proxy" }, request);
}
