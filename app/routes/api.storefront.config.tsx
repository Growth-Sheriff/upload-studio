import type { LoaderFunctionArgs } from "@remix-run/node";
import { handleCorsOptions, corsJson } from "~/lib/cors.server";
import { rateLimitGuard, getIdentifier } from "~/lib/rateLimit.server";
import prisma from "~/lib/prisma.server";
import { extractAutoSheetFromSettings } from "~/lib/autoSheet.server";
import { getMaxWidthLimitForShop, isDtfPrintHouseShop } from "~/lib/customerPricing.server";
import {
  applyAlphaProBuilderDefaults,
  buildAlphaProCustomerOffer,
} from "~/lib/alphaProDiscounts";












export async function loader({ request }: LoaderFunctionArgs) {

  if (request.method === "OPTIONS") {
    return handleCorsOptions(request);
  }


  const identifier = getIdentifier(request, "customer");
  const rateLimitResponse = await rateLimitGuard(identifier, "adminApi");
  if (rateLimitResponse) return rateLimitResponse;

  const url = new URL(request.url);
  const shopDomain = url.searchParams.get("shopDomain");
  const productId = url.searchParams.get("productId");
  const customerId = url.searchParams.get("customerId");
  const customerEmail = url.searchParams.get("customerEmail");
  const customerName = url.searchParams.get("customerName");

  if (!shopDomain) {
    return corsJson({ error: "Missing shopDomain parameter" }, request, { status: 400 });
  }


  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    include: {
      whiteLabelConfig: true,
      assetSets: {
        where: { status: "active" },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (!shop) {
    return corsJson({ error: "Shop not found" }, request, { status: 404 });
  }


  const settings = (shop.settings as Record<string, any>) || {};


  let productConfig = null;
  if (productId) {
    const normalizedProductId = productId.startsWith("gid://")
      ? productId
      : `gid://shopify/Product/${productId}`;
    productConfig = await prisma.productConfig.findFirst({
      where: {
        shopId: shop.id,
        OR: [
          { productId },
          { productId: normalizedProductId },
        ],
      },
    });
  }


  const whiteLabel = shop.whiteLabelConfig
    ? {
        enabled: shop.whiteLabelConfig.enabled,
        logoUrl: shop.whiteLabelConfig.logoUrl,
        primaryColor: shop.whiteLabelConfig.primaryColor || "#667eea",
        secondaryColor: shop.whiteLabelConfig.secondaryColor || "#764ba2",
        customCss: shop.whiteLabelConfig.customCss,
        hideBranding: shop.whiteLabelConfig.hideBranding,
      }
    : {
        enabled: false,
        logoUrl: null,
        primaryColor: "#667eea",
        secondaryColor: "#764ba2",
        customCss: null,
        hideBranding: false,
      };


  const defaultAssetSet = shop.assetSets[0];
  let assetSet = null;

  if (defaultAssetSet) {
    const schema = defaultAssetSet.schema as Record<string, any>;
    assetSet = {
      id: defaultAssetSet.id,
      name: defaultAssetSet.name,
      model: {
        type: (schema.model as any)?.type || "glb",
        source: (schema.model as any)?.source || "default_tshirt.glb",

        url: `/apps/customizer/api/asset-sets/${defaultAssetSet.id}/model`,
      },
      printLocations: (schema as any).printLocations || [
        { id: "front", name: "Front", default: true, price: 0 },
        { id: "back", name: "Back", default: false, price: 5 },
        { id: "left_sleeve", name: "Left Sleeve", default: false, price: 3 },
        { id: "right_sleeve", name: "Right Sleeve", default: false, price: 3 },
      ],
      cameraPresets: (schema as any).cameraPresets || {},
      uploadPolicy: (schema as any).uploadPolicy || {
        maxFileSizeMB: 1024, // 1GB default
        minDPI: 150,
        allowedFormats: [
          "image/png", "image/jpeg", "image/webp", "image/tiff",
          "image/vnd.adobe.photoshop", "application/pdf", "application/postscript"
        ],
      },
    };
  }


  const builderConfigRaw = productConfig
    ? (productConfig.builderConfig as Record<string, any>) || {}
    : {};
  const shopMaxWidthLimit = getMaxWidthLimitForShop(shopDomain);
  const isDtfPrintHouse = isDtfPrintHouseShop(shopDomain);

  const rawBuilderConfigResponse = productConfig
    ? {
        pricingMode: builderConfigRaw.pricingMode === "sheet" ? "sheet" : "area",
        sheetOptionName: builderConfigRaw.sheetOptionName ?? null,
        widthOptionName: builderConfigRaw.widthOptionName ?? null,
        heightOptionName: builderConfigRaw.heightOptionName ?? null,
        modalOptionNames: Array.isArray(builderConfigRaw.modalOptionNames) ? builderConfigRaw.modalOptionNames : [],
        artboardMarginIn: isDtfPrintHouse ? Math.max(0, Number(builderConfigRaw.artboardMarginIn ?? 0)) : Math.max(0.125, Number(builderConfigRaw.artboardMarginIn ?? 0.125)),
        imageMarginIn: isDtfPrintHouse ? Math.max(0, Number(builderConfigRaw.imageMarginIn ?? 0)) : Math.max(0.125, Number(builderConfigRaw.imageMarginIn ?? 0.125)),
        maxWidthIn: Math.max(Number(builderConfigRaw.maxWidthIn ?? 0) || 0, shopMaxWidthLimit),
        maxHeightIn: builderConfigRaw.maxHeightIn ?? 35.75,
        minWidthIn: builderConfigRaw.minWidthIn ?? 1,
        minHeightIn: builderConfigRaw.minHeightIn ?? 1,
        colorProfile: builderConfigRaw.colorProfile ?? "CMYK",
        maxFileSizeMb: builderConfigRaw.maxFileSizeMb ?? 500,
        supportedFormats: builderConfigRaw.supportedFormats ?? ["PNG","JPG","JPEG","SVG","PSD","AI","EPS","PDF"],
        volumeDiscountTiers: builderConfigRaw.volumeDiscountTiers ?? [
          { min_qty: 1, max_qty: 9, price_per_sqin: 0.06 },
          { min_qty: 10, max_qty: 49, price_per_sqin: 0.054 },
          { min_qty: 50, max_qty: 99, price_per_sqin: 0.051 },
          { min_qty: 100, max_qty: null, price_per_sqin: 0.0492 }
        ]
      }
    : null;
  const normalizedProductIdForAlpha = productId
    ? (productId.startsWith("gid://") ? productId : `gid://shopify/Product/${productId}`)
    : null;
  const alphaCustomerOffer = buildAlphaProCustomerOffer({
    shopDomain,
    productId: normalizedProductIdForAlpha,
    settings: shop.settings,
    customerId,
    customerEmail,
    customerName,
  });
  const builderConfigResponse = rawBuilderConfigResponse
    ? applyAlphaProBuilderDefaults(shopDomain, normalizedProductIdForAlpha, rawBuilderConfigResponse)
    : null;

  const product = productConfig
    ? {
        enabled: productConfig.enabled,
        tshirtEnabled: productConfig.tshirtEnabled,
        assetSetId: productConfig.assetSetId,
        colors: (productConfig.tshirtConfig as any)?.colors || [],
        sizes: (productConfig.tshirtConfig as any)?.sizes || [],
        extraQuestions: productConfig.extraQuestions || [],
        pricing: (productConfig.tshirtConfig as any)?.pricing || {},

        builderConfig: alphaCustomerOffer
          ? { ...builderConfigResponse, customerOffer: alphaCustomerOffer }
          : builderConfigResponse,
      }
    : null;


  const storefrontSettings = {
    autoApprove: settings.autoApprove ?? true,
    requireUpload: settings.requireUpload ?? true,
    showDpiWarning: settings.showDpiWarning ?? true,
    minDpi: settings.minDpi ?? 150,
    maxFileSizeMB: settings.maxFileSizeMB ?? 1024, // 1GB default
    allowedFormats: settings.allowedFormats || [
      "png", "jpg", "jpeg", "webp", "tiff", "tif", "psd", "svg", "pdf", "ai", "eps"
    ],
  };


  const autoSheet = extractAutoSheetFromSettings(settings);

  return corsJson({
    shop: {
      domain: shop.shopDomain,
      plan: shop.plan,
    },
    whiteLabel,
    assetSet,
    product,
    settings: storefrontSettings,
    autoSheet,
  }, request);
}
