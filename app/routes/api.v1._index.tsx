/**
 * Public API v1 - Info Endpoint
 * GET /api/v1 - API info
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

export async function loader({ request }: LoaderFunctionArgs) {
  return json({
    name: `${process.env.APP_NAME || 'Upload Studio'} Pro API`,
    version: "v1",
    documentation: `https://docs.${process.env.APP_DOMAIN || 'uploadstudio.app.techifyboost.com'}/api`,
    endpoints: [
      { path: "/api/v1/uploads", methods: ["GET"] },
      { path: "/api/v1/uploads/:id", methods: ["GET"] },
      { path: "/api/v1/uploads/:id/approve", methods: ["POST"] },
      { path: "/api/v1/uploads/:id/reject", methods: ["POST"] },
      { path: "/api/v1/exports", methods: ["GET", "POST"] },
      { path: "/api/v1/exports/:id", methods: ["GET"] },
      { path: "/api/v1/analytics", methods: ["GET"] },
    ],
  });
}

