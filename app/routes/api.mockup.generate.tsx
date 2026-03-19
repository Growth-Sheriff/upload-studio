/**
 * Mockup Generation API
 * ======================
 * POST /api/mockup/generate
 * 
 * Enqueues a mockup generation job to the us-mockup-queue.
 * The worker (running on gsb-render-worker-1 as a separate service)
 * picks this up and processes it.
 * 
 * Request body:
 * {
 *   uploadId: string,
 *   artworkUrl: string,      // CDN URL
 *   artworkKey: string,      // R2 storage key
 *   garmentTypes?: string[], // defaults to all 6
 *   garmentColor?: string,   // hex color
 * }
 * 
 * Response:
 * { jobId: string, status: "queued" }
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { handleCorsOptions, corsJson } from "~/lib/cors.server";
import Redis from "ioredis";
import { Queue } from "bullmq";

// Lazy-init Redis connection for mockup queue (DB index 5)
let mockupRedis: Redis | null = null;
let mockupQueue: Queue | null = null;

function getMockupQueue(): Queue {
  if (!mockupQueue) {
    const redisUrl = process.env.MOCKUP_REDIS_URL || process.env.REDIS_URL || "redis://localhost:6379/5";
    
    mockupRedis = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      lazyConnect: false,
    });

    mockupQueue = new Queue("us-mockup-queue", {
      connection: mockupRedis as any,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: { count: 200 },
        removeOnFail: false,
      },
    });
  }
  return mockupQueue;
}

const ALL_GARMENT_TYPES = ["tshirt", "hoodie", "polo", "hat", "totebag", "apron"];

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === "OPTIONS") {
    return handleCorsOptions(request);
  }

  if (request.method !== "POST") {
    return corsJson({ error: "Method not allowed" }, request, { status: 405 });
  }

  try {
    const body = await request.json();
    const { uploadId, artworkUrl, artworkKey, garmentTypes, garmentColor } = body;

    if (!uploadId || (!artworkUrl && !artworkKey)) {
      return corsJson(
        { error: "Missing uploadId and artworkUrl/artworkKey" },
        request,
        { status: 400 }
      );
    }

    // Extract shop domain from request
    const url = new URL(request.url);
    const shopDomain = url.searchParams.get("shop") || body.shopDomain || "unknown";

    // Build callback URL — worker will POST results back here
    const apiBase = `${url.protocol}//${url.host}`;
    const callbackUrl = `${apiBase}/api/mockup/callback`;

    const queue = getMockupQueue();

    const job = await queue.add(
      "generate-mockup",
      {
        uploadId,
        shopDomain,
        artworkUrl: artworkUrl || "",
        artworkKey: artworkKey || "",
        garmentTypes: garmentTypes || ALL_GARMENT_TYPES,
        garmentColor: garmentColor || undefined,
        callbackUrl,
      },
      {
        jobId: `mockup-${uploadId}-${Date.now()}`,
      }
    );

    console.log(`[Mockup API] Job enqueued: ${job.id} for upload ${uploadId}`);

    return corsJson({
      jobId: job.id,
      status: "queued",
      garmentTypes: garmentTypes || ALL_GARMENT_TYPES,
    }, request);
  } catch (error) {
    console.error("[Mockup API] Error:", error);
    return corsJson(
      { error: "Failed to enqueue mockup generation" },
      request,
      { status: 500 }
    );
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method === "OPTIONS") {
    return handleCorsOptions(request);
  }
  return corsJson(
    { method: "POST", description: "Enqueue mockup generation job" },
    request
  );
}
