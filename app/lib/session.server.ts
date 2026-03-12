import { createCookieSessionStorage } from "@remix-run/node";

// Session storage for Shopify OAuth
export const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: "ul_session",
    httpOnly: true,
    path: "/",
    sameSite: "none",
    secrets: [process.env.SESSION_SECRET || "upload-studio-secret-key"],
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  },
});

export const { getSession, commitSession, destroySession } = sessionStorage;

// Helper to get shop from session
export async function getShopFromSession(request: Request) {
  const session = await getSession(request.headers.get("Cookie"));
  return session.get("shop") as string | undefined;
}

// Helper to get access token from session
export async function getAccessTokenFromSession(request: Request) {
  const session = await getSession(request.headers.get("Cookie"));
  return session.get("accessToken") as string | undefined;
}

