/**
 * Product Config API - Storefront Endpoint
 * 
 * GET /api/product-config/:productId?shop=xxx.myshopify.com
 * 
 * Returns product configuration for the DTF Uploader widget:
 * - uploadEnabled: boolean
 * - extraQuestions: array of questions
 * - tshirtEnabled: boolean
 * - tshirtConfig: t-shirt addon settings
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { handleCorsOptions, getCorsHeaders } from "~/lib/cors.server";
import prisma from "~/lib/prisma.server";
import { getMaxWidthLimitForShop, isDtfPrintHouseShop } from "~/lib/customerPricing.server";

// Helper to create cached CORS JSON response
function cachedCorsJson<T>(data: T, request: Request, options: { status?: number } = {}) {
  const corsHeaders = getCorsHeaders(request);
  const headers = new Headers();
  
  for (const [key, value] of Object.entries(corsHeaders)) {
    if (value) headers.set(key, value);
  }
  
  // Cache for 5 minutes
  headers.set('Cache-Control', 'public, max-age=300, s-maxage=300');
  headers.set('Content-Type', 'application/json');
  
  return new Response(JSON.stringify(data), {
    status: options.status || 200,
    headers,
  });
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return handleCorsOptions(request);
  }

  const productId = params.id;
  if (!productId) {
    return cachedCorsJson({ error: "Product ID required" }, request, { status: 400 });
  }

  // Get shop from query param
  const url = new URL(request.url);
  const shopDomain = url.searchParams.get("shop");

  if (!shopDomain) {
    return cachedCorsJson({ error: "Shop domain required" }, request, { status: 400 });
  }

  try {
    const shopMaxWidthLimit = getMaxWidthLimitForShop(shopDomain);
    const isDtfPrintHouse = isDtfPrintHouseShop(shopDomain);

    // Find shop
    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
    });

    if (!shop) {
      return cachedCorsJson({ error: "Shop not found" }, request, { status: 404 });
    }

    // Normalize product ID to GID format
    const productGid = productId.startsWith("gid://") 
      ? productId 
      : `gid://shopify/Product/${productId}`;

    // Get product config
    const config = await prisma.productConfig.findFirst({
      where: {
        shopId: shop.id,
        OR: [
          { productId },
          { productId: productGid },
        ],
      },
    });

    // If no config exists, return defaults (upload enabled, nothing else)
    if (!config) {
      return cachedCorsJson({
        productId: productGid,
        uploadEnabled: true,
        extraQuestions: [],
        tshirtEnabled: false,
        tshirtConfig: null,
        // DTF By Size defaults
        builderConfig: {
          pricingMode: "area",
          sheetOptionName: null,
          widthOptionName: null,
          heightOptionName: null,
          modalOptionNames: [],
          artboardMarginIn: isDtfPrintHouse ? 0 : 0.125,
          imageMarginIn: isDtfPrintHouse ? 0 : 0.125,
          maxWidthIn: shopMaxWidthLimit,
          maxHeightIn: 35.75,
          minWidthIn: 1,
          minHeightIn: 1,
          colorProfile: "CMYK",
          maxFileSizeMb: 500,
          supportedFormats: ["PNG","JPG","JPEG","SVG","PSD","AI","EPS","PDF"],
          volumeDiscountTiers: [
            { min_qty: 1, max_qty: 9, price_per_sqin: 0.06 },
            { min_qty: 10, max_qty: 49, price_per_sqin: 0.054 },
            { min_qty: 50, max_qty: 99, price_per_sqin: 0.051 },
            { min_qty: 100, max_qty: null, price_per_sqin: 0.0492 }
          ]
        },
      }, request);
    }

    // Parse builderConfig from DB (JSON field)
    const builderConfig = (config.builderConfig as Record<string, any>) || {};

    // Return config with DTF By Size settings
    return cachedCorsJson({
      productId: productGid,
      uploadEnabled: config.uploadEnabled,
      extraQuestions: config.extraQuestions || [],
      tshirtEnabled: config.tshirtEnabled,
      tshirtConfig: config.tshirtConfig || null,
      builderConfig: {
        pricingMode: builderConfig.pricingMode === "sheet" ? "sheet" : "area",
        sheetOptionName: builderConfig.sheetOptionName ?? null,
        widthOptionName: builderConfig.widthOptionName ?? null,
        heightOptionName: builderConfig.heightOptionName ?? null,
        modalOptionNames: Array.isArray(builderConfig.modalOptionNames) ? builderConfig.modalOptionNames : [],
        artboardMarginIn: isDtfPrintHouse ? Math.max(0, Number(builderConfig.artboardMarginIn ?? 0)) : Math.max(0.125, Number(builderConfig.artboardMarginIn ?? 0.125)),
        imageMarginIn: isDtfPrintHouse ? Math.max(0, Number(builderConfig.imageMarginIn ?? 0)) : Math.max(0.125, Number(builderConfig.imageMarginIn ?? 0.125)),
        maxWidthIn: Math.max(Number(builderConfig.maxWidthIn ?? 0) || 0, shopMaxWidthLimit),
        maxHeightIn: builderConfig.maxHeightIn ?? 35.75,
        minWidthIn: builderConfig.minWidthIn ?? 1,
        minHeightIn: builderConfig.minHeightIn ?? 1,
        colorProfile: builderConfig.colorProfile ?? "CMYK",
        maxFileSizeMb: builderConfig.maxFileSizeMb ?? 500,
        supportedFormats: builderConfig.supportedFormats ?? ["PNG","JPG","JPEG","SVG","PSD","AI","EPS","PDF"],
        volumeDiscountTiers: builderConfig.volumeDiscountTiers ?? [
          { min_qty: 1, max_qty: 9, price_per_sqin: 0.06 },
          { min_qty: 10, max_qty: 49, price_per_sqin: 0.054 },
          { min_qty: 50, max_qty: 99, price_per_sqin: 0.051 },
          { min_qty: 100, max_qty: null, price_per_sqin: 0.0492 }
        ]
      },
    }, request);

  } catch (error) {
    console.error("[Product Config API] Error:", error);
    return cachedCorsJson({ error: "Failed to fetch config" }, request, { status: 500 });
  }
}
