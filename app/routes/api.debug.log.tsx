import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import fs from "fs/promises";
import path from "path";


const rateLimits = new Map<string, { count: number; resetTime: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const limit = rateLimits.get(ip);

  if (!limit || now > limit.resetTime) {
    rateLimits.set(ip, { count: 1, resetTime: now + 60000 });
    return true;
  }

  if (limit.count >= 100) {
    return false;
  }

  limit.count++;
  return true;
}


export async function action({ request }: ActionFunctionArgs) {

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  try {

    const ip = request.headers.get("x-forwarded-for") ||
               request.headers.get("x-real-ip") ||
               "unknown";

    if (!checkRateLimit(ip)) {
      return json({ error: "Rate limit exceeded" }, { status: 429, headers });
    }

    const body = await request.json();
    const { logs, userAgent, url, timestamp } = body;

    if (!logs || !Array.isArray(logs)) {
      return json({ error: "Invalid logs" }, { status: 400, headers });
    }


    const logEntry = {
      timestamp: timestamp || new Date().toISOString(),
      ip,
      userAgent: userAgent?.substring(0, 200),
      url: url?.substring(0, 500),
      logs: logs.slice(0, 50).map((log: any) => ({
        level: log.level || "log",
        message: typeof log.message === "string" ? log.message.substring(0, 2000) : JSON.stringify(log.message).substring(0, 2000),
        time: log.time
      }))
    };


    const logDir = process.env.LOG_DIR || "/var/log/upload-lift";
    const logFile = path.join(logDir, "client.log");


    await fs.mkdir(logDir, { recursive: true }).catch(() => {});


    const logLine = JSON.stringify(logEntry) + "\n";
    await fs.appendFile(logFile, logLine).catch(console.error);


    console.log(`[ClientLog] ${ip} | ${logs.length} entries | ${url}`);
    logs.forEach((log: any) => {
      console.log(`  [${log.level?.toUpperCase() || 'LOG'}] ${log.message}`);
    });

    return json({ ok: true, received: logs.length }, { headers });
  } catch (error) {
    console.error("[Debug Log] Error:", error);
    return json({ error: "Internal error" }, { status: 500, headers });
  }
}


export async function loader() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
