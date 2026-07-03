












import type { LoaderFunctionArgs } from "@remix-run/node";
import { handleCorsOptions, getCorsHeaders } from "~/lib/cors.server";
import prisma from "~/lib/prisma.server";


const DEFAULT_COLORS = [
  { id: "white", name: "White", hex: "#FFFFFF", available: true },
  { id: "black", name: "Black", hex: "#1A1A1A", available: true },
  { id: "navy", name: "Navy", hex: "#1E3A5F", available: true },
  { id: "red", name: "Red", hex: "#DC2626", available: true },
  { id: "blue", name: "Royal Blue", hex: "#4169E1", available: true },
  { id: "gray", name: "Heather Gray", hex: "#9CA3AF", available: true },
  { id: "green", name: "Forest Green", hex: "#228B22", available: true },
  { id: "pink", name: "Pink", hex: "#EC4899", available: true },
  { id: "yellow", name: "Yellow", hex: "#EAB308", available: true },
  { id: "orange", name: "Orange", hex: "#F97316", available: true },
  { id: "purple", name: "Purple", hex: "#A855F7", available: true },
  { id: "maroon", name: "Maroon", hex: "#7F1D1D", available: true },
  { id: "teal", name: "Teal", hex: "#14B8A6", available: true },
  { id: "brown", name: "Brown", hex: "#92400E", available: true },
  { id: "charcoal", name: "Charcoal", hex: "#36454F", available: true },
  { id: "cream", name: "Cream", hex: "#FFFDD0", available: true },
];


function cachedCorsJson<T>(data: T, request: Request, options: { status?: number; maxAge?: number } = {}) {
  const corsHeaders = getCorsHeaders(request);
  const headers = new Headers();

  for (const [key, value] of Object.entries(corsHeaders)) {
    if (value) headers.set(key, value);
  }


  const maxAge = options.maxAge ?? 300;
  headers.set('Cache-Control', `public, max-age=${maxAge}, s-maxage=${maxAge}`);
  headers.set('Content-Type', 'application/json');

  return new Response(JSON.stringify(data), {
    status: options.status || 200,
    headers,
  });
}

export async function loader({ request }: LoaderFunctionArgs) {

  if (request.method === "OPTIONS") {
    return handleCorsOptions(request);
  }

  const url = new URL(request.url);
  const shopDomain = url.searchParams.get("shop");


  if (!shopDomain) {
    return cachedCorsJson({
      colors: DEFAULT_COLORS,
      source: "default"
    }, request);
  }

  try {

    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: {
        id: true,
        settings: true,
      }
    });

    if (!shop) {

      return cachedCorsJson({
        colors: DEFAULT_COLORS,
        source: "default"
      }, request);
    }


    const settings = shop.settings as Record<string, unknown> | null;
    const customColors = settings?.tshirtColors as typeof DEFAULT_COLORS | undefined;

    if (customColors && Array.isArray(customColors) && customColors.length > 0) {
      return cachedCorsJson({
        colors: customColors,
        source: "custom"
      }, request);
    }


    return cachedCorsJson({
      colors: DEFAULT_COLORS,
      source: "default"
    }, request);

  } catch (error) {
    console.error("[T-Shirt Colors API] Error:", error);


    return cachedCorsJson({
      colors: DEFAULT_COLORS,
      source: "default",
      error: "Failed to load custom colors"
    }, request);
  }
}
