











import type { LoaderFunctionArgs } from "@remix-run/node";
import { handleCorsOptions, getCorsHeaders } from "~/lib/cors.server";
import prisma from "~/lib/prisma.server";
import { getPricingPolicy } from "~/lib/customerPricingModel.server";
import {
  applyAlphaProBuilderDefaults,
  buildAlphaProCustomerOffer,
} from "~/lib/alphaProDiscounts.server";


function cachedCorsJson<T>(data: T, request: Request, options: { status?: number } = {}) {
  const corsHeaders = getCorsHeaders(request);
  const headers = new Headers();

  for (const [key, value] of Object.entries(corsHeaders)) {
    if (value) headers.set(key, value);
  }

  const requestUrl = new URL(request.url);
  const hasCustomerContext =
    requestUrl.searchParams.has('customerId') ||
    requestUrl.searchParams.has('customerEmail') ||
    requestUrl.searchParams.has('customerName') ||
    requestUrl.searchParams.has('logged_in_customer_id');

  headers.set(
    'Cache-Control',
    hasCustomerContext ? 'private, no-store, max-age=0' : 'public, max-age=300, s-maxage=300'
  );
  headers.set('Content-Type', 'application/json');

  return new Response(JSON.stringify(data), {
    status: options.status || 200,
    headers,
  });
}

export async function loader({ request, params }: LoaderFunctionArgs) {

  if (request.method === "OPTIONS") {
    return handleCorsOptions(request);
  }

  const productId = params.id;
  if (!productId) {
    return cachedCorsJson({ error: "Product ID required" }, request, { status: 400 });
  }


  const url = new URL(request.url);
  const shopDomain = url.searchParams.get("shop");
  const customerId = url.searchParams.get("customerId");
  const customerEmail = url.searchParams.get("customerEmail");
  const customerName = url.searchParams.get("customerName");

  if (!shopDomain) {
    return cachedCorsJson({ error: "Shop domain required" }, request, { status: 400 });
  }

  try {
    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
    });

    if (!shop) {
      return cachedCorsJson({ error: "Shop not found" }, request, { status: 404 });
    }

    // Sheet policy (roll width, margins) is a merchant setting with per-shop
    // defaults; nothing here depends on the shop domain any more.
    const policy = getPricingPolicy(shopDomain, shop.settings);
    const shopMaxWidthLimit = policy.maxSheetWidthIn;
    const defaultArtboardMarginIn = policy.artboardMarginIn;
    const defaultImageMarginIn = policy.imageMarginIn;


    const productGid = productId.startsWith("gid://")
      ? productId
      : `gid://shopify/Product/${productId}`;


    const config = await prisma.productConfig.findFirst({
      where: {
        shopId: shop.id,
        OR: [
          { productId },
          { productId: productGid },
        ],
      },
    });


    if (!config) {
      const builderConfig = applyAlphaProBuilderDefaults(shopDomain, productGid, {
        pricingMode: "area",
        sheetOptionName: null,
        widthOptionName: null,
        heightOptionName: null,
        modalOptionNames: [],
        artboardMarginIn: defaultArtboardMarginIn,
        imageMarginIn: defaultImageMarginIn,
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
      }, shop.settings);
      const customerOffer = buildAlphaProCustomerOffer({
        shopDomain,
        productId: productGid,
        settings: shop.settings,
        customerId,
        customerEmail,
        customerName,
      });

      return cachedCorsJson({
        productId: productGid,
        uploadEnabled: true,
        extraQuestions: [],
        tshirtEnabled: false,
        tshirtConfig: null,

        builderConfig: customerOffer ? { ...builderConfig, customerOffer } : builderConfig,
      }, request);
    }


    const builderConfig = (config.builderConfig as Record<string, any>) || {};


    const builderConfigResponse = applyAlphaProBuilderDefaults(shopDomain, productGid, {
      pricingMode: builderConfig.pricingMode === "sheet" ? "sheet" : "area",
      sheetOptionName: builderConfig.sheetOptionName ?? null,
      widthOptionName: builderConfig.widthOptionName ?? null,
      heightOptionName: builderConfig.heightOptionName ?? null,
      modalOptionNames: Array.isArray(builderConfig.modalOptionNames) ? builderConfig.modalOptionNames : [],
      artboardMarginIn: Math.max(defaultArtboardMarginIn, Number(builderConfig.artboardMarginIn ?? defaultArtboardMarginIn)),
      imageMarginIn: Math.max(defaultImageMarginIn, Number(builderConfig.imageMarginIn ?? defaultImageMarginIn)),
      maxWidthIn: Math.max(Number(builderConfig.maxWidthIn ?? 0) || 0, shopMaxWidthLimit),
      maxHeightIn: builderConfig.maxHeightIn ?? 35.75,
      minWidthIn: builderConfig.minWidthIn ?? 1,
      minHeightIn: builderConfig.minHeightIn ?? 1,
      colorProfile: builderConfig.colorProfile ?? "CMYK",
      maxFileSizeMb: builderConfig.maxFileSizeMb ?? 500,
      supportedFormats: builderConfig.supportedFormats ?? ["PNG","JPG","JPEG","SVG","PSD","AI","EPS","PDF"],
      // Twin-product override: cart lines resolve variants from this handle
      // so a second gang-sheet app that owns the PAGE product never sees our
      // lines at checkout (its "no gang sheet uploaded" rule is scoped to
      // its own registered product ids).
      cartProductHandle: builderConfig.cartProductHandle ?? null,
      volumeDiscountTiers: builderConfig.volumeDiscountTiers ?? [
        { min_qty: 1, max_qty: 9, price_per_sqin: 0.06 },
        { min_qty: 10, max_qty: 49, price_per_sqin: 0.054 },
        { min_qty: 50, max_qty: 99, price_per_sqin: 0.051 },
        { min_qty: 100, max_qty: null, price_per_sqin: 0.0492 }
      ]
    }, shop.settings);
    const customerOffer = buildAlphaProCustomerOffer({
      shopDomain,
      productId: productGid,
      settings: shop.settings,
      customerId,
      customerEmail,
      customerName,
    });

    return cachedCorsJson({
      productId: productGid,
      uploadEnabled: config.uploadEnabled,
      extraQuestions: config.extraQuestions || [],
      tshirtEnabled: config.tshirtEnabled,
      tshirtConfig: config.tshirtConfig || null,
      builderConfig: customerOffer ? { ...builderConfigResponse, customerOffer } : builderConfigResponse,
    }, request);

  } catch (error) {
    console.error("[Product Config API] Error:", error);
    return cachedCorsJson({ error: "Failed to fetch config" }, request, { status: 500 });
  }
}
