









import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfter?: number;
}



export const RATE_LIMITS = {
  uploadIntent: {
    windowMs: 60 * 1000,
    maxRequests: 10000,
    keyPrefix: "rl:upload:",
  },
  preflight: {
    windowMs: 60 * 1000,
    maxRequests: 10000,
    keyPrefix: "rl:preflight:",
  },
  adminApi: {
    windowMs: 60 * 1000,
    maxRequests: 10000,
    keyPrefix: "rl:admin:",
  },
  storageTest: {
    windowMs: 60 * 1000,
    maxRequests: 10000,
    keyPrefix: "rl:storage:",
  },
} as const;




export async function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const key = `${config.keyPrefix}${identifier}`;
  const now = Date.now();
  const windowStart = now - config.windowMs;

  try {

    const pipeline = redis.pipeline();


    pipeline.zremrangebyscore(key, 0, windowStart);


    pipeline.zcard(key);


    pipeline.zadd(key, now, `${now}-${Math.random()}`);


    pipeline.pexpire(key, config.windowMs);

    const results = await pipeline.exec();

    if (!results) {

      return { allowed: true, remaining: config.maxRequests - 1, resetAt: now + config.windowMs };
    }

    const currentCount = (results[1][1] as number) || 0;
    const remaining = Math.max(0, config.maxRequests - currentCount - 1);
    const resetAt = now + config.windowMs;

    if (currentCount >= config.maxRequests) {

      const oldestEntry = await redis.zrange(key, 0, 0, "WITHSCORES");
      const oldestTime = oldestEntry.length > 1 ? parseInt(oldestEntry[1]) : now;
      const retryAfter = Math.ceil((oldestTime + config.windowMs - now) / 1000);

      return {
        allowed: false,
        remaining: 0,
        resetAt,
        retryAfter: Math.max(1, retryAfter),
      };
    }

    return {
      allowed: true,
      remaining,
      resetAt,
    };
  } catch (error) {
    console.error("[Rate Limit] Redis error:", error);

    return { allowed: true, remaining: config.maxRequests - 1, resetAt: now + config.windowMs };
  }
}





export async function rateLimitGuard(
  identifier: string,
  limitType: keyof typeof RATE_LIMITS
): Promise<Response | null> {
  const config = RATE_LIMITS[limitType];
  const result = await checkRateLimit(identifier, config);

  if (!result.allowed) {
    return new Response(
      JSON.stringify({
        error: "Rate limit exceeded",
        retryAfter: result.retryAfter,
        message: `Too many requests. Please try again in ${result.retryAfter} seconds.`,
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(result.retryAfter),
          "X-RateLimit-Limit": String(config.maxRequests),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
        },
      }
    );
  }

  return null;
}




export function addRateLimitHeaders(
  headers: Headers,
  remaining: number,
  limit: number,
  resetAt: number
): void {
  headers.set("X-RateLimit-Limit", String(limit));
  headers.set("X-RateLimit-Remaining", String(remaining));
  headers.set("X-RateLimit-Reset", String(Math.ceil(resetAt / 1000)));
}




export function getIdentifier(request: Request, type: "customer" | "shop"): string {
  if (type === "customer") {

    const ip = request.headers.get("x-forwarded-for")?.split(",")[0] ||
               request.headers.get("x-real-ip") ||
               "unknown";
    const ua = request.headers.get("user-agent") || "";
    return `${ip}:${hashString(ua).slice(0, 8)}`;
  }


  return "shop";
}

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

