




import Redis, { type RedisOptions } from "ioredis";

let connection: Redis | null = null;

export function getRedisConnection(): Redis {
  if (!connection) {
    const url = process.env.REDIS_URL || "redis://localhost:6379/5";
    const opts: RedisOptions = {
      maxRetriesPerRequest: null,
      lazyConnect: false,
    };

    if (url.startsWith("rediss://")) {
      opts.tls = { rejectUnauthorized: false };
    }

    connection = new Redis(url, opts);

    connection.on("error", (err) => {
      console.error("[us-mockup:redis] Error:", err.message);
    });

    connection.on("connect", () => {
      console.log("[us-mockup:redis] Connected");
    });
  }
  return connection;
}
