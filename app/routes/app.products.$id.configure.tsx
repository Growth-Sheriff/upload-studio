




import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useActionData, Form, useNavigation, useNavigate } from "@remix-run/react";
import {
  Page, Layout, Card, Text, BlockStack, InlineStack,
  TextField, Select, Button, Banner, FormLayout, Divider, Box,
  Checkbox, Badge, Icon, EmptyState, Modal, ChoiceList, RadioButton, Thumbnail, InlineGrid
} from "@shopify/polaris";
import { DeleteIcon, PlusIcon, AlertCircleIcon, CheckCircleIcon, SearchIcon } from "@shopify/polaris-icons";
import { useState, useCallback } from "react";
import { authenticate } from "~/shopify.server";
import prisma from "~/lib/prisma.server";
import { z } from "zod";
import {
  countForeignLineSignals,
  createTwin,
  getTwinStatus,
  syncTwinPrices,
  type TwinStatus,
} from "~/lib/compatibilityTwin.server";
import {
  ALPHA_PRO_DISCOUNT_TIERS,
} from "~/lib/alphaProDiscounts";
import { applyAlphaProBuilderDefaults } from "~/lib/alphaProDiscounts.server";
import { isVolumeProgramProduct, isVolumeTiersEnabled } from "~/lib/customerPricingModel.server";


const ExtraQuestionSchema = z.object({
  id: z.string().min(1).max(100),
  type: z.enum(["text", "select", "checkbox", "textarea"]),
  label: z.string().min(1).max(500).transform(sanitizeHtml),
  options: z.array(z.string().max(500).transform(sanitizeHtml)).optional(),
  required: z.boolean().optional(),
  placeholder: z.string().max(500).transform(sanitizeHtml).optional(),
});

const ExtraQuestionsArraySchema = z.array(ExtraQuestionSchema).max(20);


const TshirtConfigSchema = z.object({
  tshirtProductId: z.string().nullable(),
  tshirtProductHandle: z.string().nullable(),
  tshirtProductTitle: z.string().max(500).nullable().transform((val) => val ? sanitizeHtml(val) : null),
  colorVariantOption: z.string().max(100),
  sizeVariantOption: z.string().max(100),
  colorValues: z.array(z.string().max(100)),
  sizeValues: z.array(z.string().max(100)),
  priceAddon: z.number().min(0).max(10000),
  positions: z.array(z.string().max(50)),
}).nullable();


function sanitizeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;')
    .replace(/`/g, '&#x60;')
    .replace(/=/g, '&#x3D;');
}


type QuestionType = "text" | "select" | "checkbox" | "textarea";

interface ExtraQuestion {
  id: string;
  type: QuestionType;
  label: string;
  options?: string[];
  required?: boolean;
  placeholder?: string;
}

interface TshirtConfig {
  tshirtProductId: string | null;
  tshirtProductHandle: string | null;
  tshirtProductTitle: string | null;
  colorVariantOption: string;
  sizeVariantOption: string;
  colorValues: string[];
  sizeValues: string[];
  priceAddon: number;
  positions: string[];
}

interface BuilderConfig {
  pricingMode: "area" | "sheet";
  sheetOptionName: string | null;
  widthOptionName: string | null;
  heightOptionName: string | null;
  modalOptionNames: string[];
  artboardMarginIn: number;
  imageMarginIn: number;
  maxWidthIn: number;
  maxHeightIn: number;
  minWidthIn: number;
  minHeightIn: number;
  colorProfile: string;
  maxFileSizeMb: number;
  supportedFormats: string[];
  volumeDiscountTierUnit?: "quantity" | "linear_inches";
  volumeDiscountTiers: Array<{
    min_qty: number;
    max_qty: number | null;
    price_per_sqin: number;
    price_per_inch?: number;
    label?: string;
    popular?: boolean;
  }>;
  alphaProDiscount?: Record<string, unknown> | null;
}

const DEFAULT_BUILDER_CONFIG: BuilderConfig = {
  pricingMode: "area",
  sheetOptionName: null,
  widthOptionName: null,
  heightOptionName: null,
  modalOptionNames: [],
  artboardMarginIn: 0.125,
  imageMarginIn: 0.125,
  maxWidthIn: 22.5,
  maxHeightIn: 35.75,
  minWidthIn: 1,
  minHeightIn: 1,
  colorProfile: "CMYK",
  maxFileSizeMb: 500,
  supportedFormats: ["PNG", "JPG", "JPEG", "SVG", "PSD", "AI", "EPS", "PDF"],
  volumeDiscountTierUnit: "quantity",
  volumeDiscountTiers: [
    { min_qty: 1, max_qty: 9, price_per_sqin: 0.06 },
    { min_qty: 10, max_qty: 49, price_per_sqin: 0.054 },
    { min_qty: 50, max_qty: 99, price_per_sqin: 0.051 },
    { min_qty: 100, max_qty: null, price_per_sqin: 0.0492 },
  ],
};

const VolumeDiscountTierSchema = z.object({
  min_qty: z.number(),
  max_qty: z.number().nullable(),
  price_per_sqin: z.number(),
  price_per_inch: z.number().optional(),
  label: z.string().max(100).optional(),
  popular: z.boolean().optional(),
});

const BuilderConfigSchema = z.object({
  pricingMode: z.enum(["area", "sheet"]).default("area"),
  sheetOptionName: z.string().max(100).nullable().optional(),
  widthOptionName: z.string().max(100).nullable().optional(),
  heightOptionName: z.string().max(100).nullable().optional(),
  modalOptionNames: z.array(z.string().max(100)).max(10).default([]),
  artboardMarginIn: z.number().min(0.125).max(5).default(0.125),
  imageMarginIn: z.number().min(0.125).max(5).default(0.125),
  maxWidthIn: z.number().min(0.1).max(999).default(DEFAULT_BUILDER_CONFIG.maxWidthIn),
  maxHeightIn: z.number().min(0.1).max(999).default(DEFAULT_BUILDER_CONFIG.maxHeightIn),
  minWidthIn: z.number().min(0.1).max(999).default(DEFAULT_BUILDER_CONFIG.minWidthIn),
  minHeightIn: z.number().min(0.1).max(999).default(DEFAULT_BUILDER_CONFIG.minHeightIn),
  cartProductHandle: z.string().max(200).nullable().optional(),
  colorProfile: z.string().max(50).default(DEFAULT_BUILDER_CONFIG.colorProfile),
  maxFileSizeMb: z.number().min(1).max(10240).default(DEFAULT_BUILDER_CONFIG.maxFileSizeMb),
  supportedFormats: z.array(z.string().max(20)).max(20).default(DEFAULT_BUILDER_CONFIG.supportedFormats),
  volumeDiscountTierUnit: z.enum(["quantity", "linear_inches"]).optional().default("quantity"),
  volumeDiscountTiers: z.array(VolumeDiscountTierSchema).default(DEFAULT_BUILDER_CONFIG.volumeDiscountTiers),
  alphaProDiscount: z.record(z.unknown()).nullable().optional(),
});


const PRODUCT_QUERY = `
  query getProduct($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      status
      featuredImage {
        url
        altText
      }
      options {
        id
        name
        values
      }
      variants(first: 100) {
        edges {
          node {
            id
            title
            price
            selectedOptions {
              name
              value
            }
          }
        }
      }
    }
  }
`;




const ALL_PRODUCTS_QUERY = `
  query getAllProducts($cursor: String) {
    products(first: 100, after: $cursor, sortKey: TITLE) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          handle
          options {
            name
            values
          }
          variantsCount {
            count
          }
        }
      }
    }
  }
`;


async function fetchAllProductsWithPagination(admin: any): Promise<any[]> {
  const products: any[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;
  const MAX_PRODUCTS = 500;

  while (hasNextPage && products.length < MAX_PRODUCTS) {
    const response: any = await admin.graphql(ALL_PRODUCTS_QUERY, {
      variables: { cursor },
    });
    const data: any = await response.json();

    const edges: any[] = data.data?.products?.edges || [];
    const pageInfo: { hasNextPage?: boolean; endCursor?: string } = data.data?.products?.pageInfo || {};

    for (const edge of edges) {
      if (products.length >= MAX_PRODUCTS) break;

      const p = edge.node;
      const colorOpt = p.options?.find((o: any) =>
        o.name.toLowerCase().includes("color") || o.name.toLowerCase().includes("renk")
      );
      const sizeOpt = p.options?.find((o: any) =>
        o.name.toLowerCase().includes("size") || o.name.toLowerCase().includes("beden")
      );

      products.push({
        id: p.id,
        title: p.title,
        handle: p.handle,
        hasColorVariant: !!colorOpt,
        hasSizeVariant: !!sizeOpt,
        colorValues: colorOpt?.values || [],
        sizeValues: sizeOpt?.values || [],

        variantCount: p.variantsCount?.count || 0,
      });
    }

    hasNextPage = pageInfo.hasNextPage === true;
    cursor = pageInfo.endCursor || null;
  }

  return products;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const productId = params.id;

  if (!productId) {
    throw new Response("Product ID required", { status: 400 });
  }


  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
  });

  if (!shop) {
    throw new Response("Shop not found", { status: 404 });
  }


  const productGid = productId.startsWith("gid://")
    ? productId
    : `gid://shopify/Product/${productId}`;

  const response = await admin.graphql(PRODUCT_QUERY, {
    variables: { id: productGid },
  });

  const { data } = await response.json();
  const product = data?.product;

  if (!product) {
    throw new Response("Product not found", { status: 404 });
  }


  const allProducts = await fetchAllProductsWithPagination(admin);


  const config = await prisma.productConfig.findUnique({
    where: {
      shopId_productId: {
        shopId: shop.id,
        productId: productGid,
      },
    },
  }) as any;


  const colorOption = product.options?.find((o: any) =>
    o.name.toLowerCase().includes("color") || o.name.toLowerCase().includes("renk")
  );
  const sizeOption = product.options?.find((o: any) =>
    o.name.toLowerCase().includes("size") || o.name.toLowerCase().includes("beden")
  );

  // Compatibility mode state: is a cart twin wired up, is it healthy, and is
  // there evidence of a second app selling this product (generic signal —
  // never names any vendor).
  const storedBuilderConfig = (config?.builderConfig as Record<string, unknown> | null) || {};
  const twinGid =
    typeof storedBuilderConfig.cartProductId === "string" ? storedBuilderConfig.cartProductId : null;
  let twinStatus: TwinStatus | null = null;
  if (twinGid) {
    try {
      twinStatus = await getTwinStatus(
        { shopDomain, accessToken: shop.accessToken },
        productGid,
        twinGid
      );
    } catch (twinErr) {
      console.warn("[Configure] Twin status lookup failed:", twinErr);
    }
  }
  let conflictSignals = 0;
  try {
    conflictSignals = await countForeignLineSignals(shop.id, productId);
  } catch (_) {}

  const compat = {
    enabled: Boolean(twinGid),
    twinGid,
    twinHandle:
      typeof storedBuilderConfig.cartProductHandle === "string"
        ? storedBuilderConfig.cartProductHandle
        : null,
    autoSync: storedBuilderConfig.cartAutoSync !== false,
    twin: twinStatus,
    conflictSignals,
  };

  const alphaProDiscountProduct =
    isVolumeTiersEnabled(shopDomain, shop.settings) && isVolumeProgramProduct(shopDomain, shop.settings, product.id);
  const existingBuilderConfig = config
    ? {
        ...DEFAULT_BUILDER_CONFIG,
        ...((config.builderConfig as BuilderConfig | null) || {}),
        artboardMarginIn: Math.max(
          0.125,
          Number((config.builderConfig as BuilderConfig | null)?.artboardMarginIn ?? DEFAULT_BUILDER_CONFIG.artboardMarginIn)
        ),
        imageMarginIn: Math.max(
          0.125,
          Number((config.builderConfig as BuilderConfig | null)?.imageMarginIn ?? DEFAULT_BUILDER_CONFIG.imageMarginIn)
        ),
      }
    : DEFAULT_BUILDER_CONFIG;
  const builderConfigForResponse = applyAlphaProBuilderDefaults(
    shopDomain,
    product.id,
    existingBuilderConfig as unknown as Record<string, unknown>,
    shop.settings
  ) as unknown as BuilderConfig;

  return json({
    shop: { domain: shopDomain },
    compat,
    alphaProDiscountProduct,
    product: {
      id: product.id,
      title: product.title,
      handle: product.handle,
      status: product.status,
      image: product.featuredImage?.url,
      options: product.options || [],
      hasColorVariant: !!colorOption,
      hasSizeVariant: !!sizeOption,
      colorOptionName: colorOption?.name || null,
      sizeOptionName: sizeOption?.name || null,
      colorValues: colorOption?.values || [],
      sizeValues: sizeOption?.values || [],
    },
    allProducts,
    config: config ? {
      mode: config.mode || "dtf",
      uploadEnabled: config.uploadEnabled ?? true,
      extraQuestions: (config.extraQuestions as ExtraQuestion[]) || [],
      tshirtEnabled: config.tshirtEnabled ?? false,
      tshirtConfig: (config.tshirtConfig as TshirtConfig) || null,
      builderConfig: builderConfigForResponse,
    } : {
      mode: "dtf",
      uploadEnabled: true,
      extraQuestions: [] as ExtraQuestion[],
      tshirtEnabled: false,
      tshirtConfig: null as TshirtConfig | null,
      builderConfig: builderConfigForResponse,
    },
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const productId = params.id;

  if (!productId) {
    return json({ error: "Product ID required" }, { status: 400 });
  }

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
  });

  if (!shop) {
    return json({ error: "Shop not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const action = formData.get("_action");

  const productGid = productId.startsWith("gid://")
    ? productId
    : `gid://shopify/Product/${productId}`;

  // ── Compatibility mode (cart twin) intents ─────────────────────────────
  const adminShop = { id: shop.id, shopDomain, accessToken: shop.accessToken };

  if (action === "compat-enable" || action === "compat-recreate") {
    try {
      const twin = await createTwin(adminShop, productGid);
      return json({
        success: true,
        message: `Compatibility mode enabled. Cart lines now use "${twin.title}" (${twin.handle}).`,
      });
    } catch (error) {
      console.error("[Configure] compat-enable failed:", error);
      return json(
        { error: error instanceof Error ? error.message : "Could not enable compatibility mode" },
        { status: 500 }
      );
    }
  }

  if (action === "compat-disable") {
    const existing = await prisma.productConfig.findUnique({
      where: { shopId_productId: { shopId: shop.id, productId: productGid } },
    });
    if (existing) {
      const builderConfig = { ...((existing.builderConfig as Record<string, unknown> | null) || {}) };
      delete builderConfig.cartProductHandle;
      delete builderConfig.cartProductId;
      delete builderConfig.cartAutoSync;
      await prisma.productConfig.update({
        where: { shopId_productId: { shopId: shop.id, productId: productGid } },
        data: { builderConfig: builderConfig as any },
      });
    }
    return json({
      success: true,
      message: "Compatibility mode disabled. The duplicate product stays in your store; delete it manually if you no longer need it.",
    });
  }

  if (action === "compat-sync") {
    const existing = await prisma.productConfig.findUnique({
      where: { shopId_productId: { shopId: shop.id, productId: productGid } },
    });
    const builderConfig = (existing?.builderConfig as Record<string, unknown> | null) || {};
    const twinGid = typeof builderConfig.cartProductId === "string" ? builderConfig.cartProductId : null;
    if (!twinGid) {
      return json({ error: "Compatibility mode is not enabled" }, { status: 400 });
    }
    try {
      const updated = await syncTwinPrices(adminShop, productGid, twinGid);
      return json({
        success: true,
        message: updated > 0 ? `Prices synced (${updated} variant${updated === 1 ? "" : "s"} updated).` : "Prices already in sync.",
      });
    } catch (error) {
      console.error("[Configure] compat-sync failed:", error);
      return json(
        { error: error instanceof Error ? error.message : "Price sync failed" },
        { status: 500 }
      );
    }
  }

  if (action === "compat-autosync") {
    const autoSync = formData.get("autoSync") === "true";
    const existing = await prisma.productConfig.findUnique({
      where: { shopId_productId: { shopId: shop.id, productId: productGid } },
    });
    if (existing) {
      const builderConfig = { ...((existing.builderConfig as Record<string, unknown> | null) || {}) };
      builderConfig.cartAutoSync = autoSync;
      await prisma.productConfig.update({
        where: { shopId_productId: { shopId: shop.id, productId: productGid } },
        data: { builderConfig: builderConfig as any },
      });
    }
    return json({ success: true, message: autoSync ? "Automatic price sync enabled." : "Automatic price sync disabled." });
  }

  if (action === "save") {
    const mode = formData.get("mode") as string || "dtf";
    const uploadEnabled = formData.get("uploadEnabled") === "true";
    const tshirtEnabled = formData.get("tshirtEnabled") === "true";
    const extraQuestionsJson = formData.get("extraQuestions") as string;
    const tshirtConfigJson = formData.get("tshirtConfig") as string;
    const builderConfigJson = formData.get("builderConfig") as string;

    let extraQuestions: ExtraQuestion[] = [];
    let tshirtConfig: TshirtConfig | null = null;
    let builderConfig: BuilderConfig = DEFAULT_BUILDER_CONFIG;


    try {
      if (extraQuestionsJson) {
        const parsed = JSON.parse(extraQuestionsJson);
        const validationResult = ExtraQuestionsArraySchema.safeParse(parsed);
        if (!validationResult.success) {
          console.error("[ADM-003] ExtraQuestions validation failed:", validationResult.error.errors);
          return json({
            error: "Invalid extra questions format: " + validationResult.error.errors[0]?.message
          }, { status: 400 });
        }
        extraQuestions = validationResult.data;
      }
      if (tshirtConfigJson) {
        const parsed = JSON.parse(tshirtConfigJson);
        const validationResult = TshirtConfigSchema.safeParse(parsed);
        if (!validationResult.success) {
          console.error("[ADM-003] TshirtConfig validation failed:", validationResult.error.errors);
          return json({
            error: "Invalid T-Shirt config format: " + validationResult.error.errors[0]?.message
          }, { status: 400 });
        }
        tshirtConfig = validationResult.data;
      }
      if (builderConfigJson) {
        const parsed = JSON.parse(builderConfigJson);
        const validationResult = BuilderConfigSchema.safeParse(parsed);
        if (!validationResult.success) {
          console.error("[ADM-003] BuilderConfig validation failed:", validationResult.error.errors);
          return json({
            error: "Invalid DTF sheet pricing configuration: " + validationResult.error.errors[0]?.message
          }, { status: 400 });
        }
        builderConfig = {
          ...DEFAULT_BUILDER_CONFIG,
          ...validationResult.data,
          artboardMarginIn: Math.max(0.125, validationResult.data.artboardMarginIn ?? DEFAULT_BUILDER_CONFIG.artboardMarginIn),
          imageMarginIn: Math.max(0.125, validationResult.data.imageMarginIn ?? DEFAULT_BUILDER_CONFIG.imageMarginIn),
          sheetOptionName: validationResult.data.sheetOptionName || null,
          widthOptionName: validationResult.data.widthOptionName || null,
          heightOptionName: validationResult.data.heightOptionName || null,
          modalOptionNames: Array.isArray(validationResult.data.modalOptionNames)
            ? validationResult.data.modalOptionNames.filter((name) => {
                return name !== validationResult.data.sheetOptionName &&
                  name !== validationResult.data.widthOptionName &&
                  name !== validationResult.data.heightOptionName;
              })
            : [],
        };
      }
    } catch (e) {
      console.error("[ADM-003] JSON parse error:", e);
      return json({ error: "Invalid JSON data" }, { status: 400 });
    }

    builderConfig = applyAlphaProBuilderDefaults(
      shopDomain,
      productGid,
      builderConfig as unknown as Record<string, unknown>,
      shop.settings
    ) as unknown as BuilderConfig;

    // Compatibility-mode keys are server-managed (set only via the compat-*
    // intents); never let a stale client form clear or tamper with them.
    const existingForCompat = await prisma.productConfig.findUnique({
      where: { shopId_productId: { shopId: shop.id, productId: productGid } },
      select: { builderConfig: true },
    });
    const storedCompat = (existingForCompat?.builderConfig as Record<string, unknown> | null) || {};
    for (const key of ["cartProductHandle", "cartProductId", "cartAutoSync"]) {
      if (storedCompat[key] !== undefined) {
        (builderConfig as unknown as Record<string, unknown>)[key] = storedCompat[key];
      } else {
        delete (builderConfig as unknown as Record<string, unknown>)[key];
      }
    }


    const updateData = {
      mode,
      enabled: uploadEnabled,
      uploadEnabled,
      extraQuestions: extraQuestions as any,
      tshirtEnabled,
      tshirtConfig: tshirtConfig as any,
      builderConfig: builderConfig as any,
      updatedAt: new Date(),
    };

    const createData = {
      shopId: shop.id,
      productId: productGid,
      mode,
      enabled: uploadEnabled,
      uploadEnabled,
      extraQuestions: extraQuestions as any,
      tshirtEnabled,
      tshirtConfig: tshirtConfig as any,
      builderConfig: builderConfig as any,
    };

    await (prisma.productConfig as any).upsert({
      where: {
        shopId_productId: {
          shopId: shop.id,
          productId: productGid,
        },
      },
      update: updateData,
      create: createData,
    });

    return json({ success: true, message: "Configuration saved!" });
  }

  return json({ error: "Invalid action" }, { status: 400 });
}

export default function ProductConfigurePage() {
  const { shop, product, allProducts, config, compat, alphaProDiscountProduct } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as { success?: boolean; message?: string; error?: string } | null;
  const navigation = useNavigation();
  const navigate = useNavigate();
  const isLoading = navigation.state === "submitting";


  const [mode, setMode] = useState(config.mode);
  const [uploadEnabled, setUploadEnabled] = useState(config.uploadEnabled);
  const [tshirtEnabled, setTshirtEnabled] = useState(config.tshirtEnabled);
  const [extraQuestions, setExtraQuestions] = useState<ExtraQuestion[]>(config.extraQuestions || []);
  const [tshirtConfig, setTshirtConfig] = useState<TshirtConfig>(
    config.tshirtConfig || {
      tshirtProductId: null,
      tshirtProductHandle: null,
      tshirtProductTitle: null,
      colorVariantOption: "Color",
      sizeVariantOption: "Size",
      colorValues: [],
      sizeValues: [],
      priceAddon: 15.00,
      positions: ["front", "back"],
    }
  );
  const [builderConfig, setBuilderConfig] = useState<BuilderConfig>({
    ...DEFAULT_BUILDER_CONFIG,
    ...(config.builderConfig || {}),
    artboardMarginIn: Math.max(0.125, Number(config.builderConfig?.artboardMarginIn ?? DEFAULT_BUILDER_CONFIG.artboardMarginIn)),
    imageMarginIn: Math.max(0.125, Number(config.builderConfig?.imageMarginIn ?? DEFAULT_BUILDER_CONFIG.imageMarginIn)),
  });

  const setAlphaProTier = useCallback((
    index: number,
    field: "min_qty" | "max_qty" | "price_per_sqin" | "label" | "popular",
    value: string | boolean
  ) => {
    setBuilderConfig((prev) => {
      const tiers = (prev.volumeDiscountTiers?.length ? prev.volumeDiscountTiers : ALPHA_PRO_DISCOUNT_TIERS)
        .map((tier) => ({ ...tier }));
      const currentTier = tiers[index];
      if (!currentTier) return prev;

      if (field === "popular") {
        currentTier.popular = Boolean(value);
      } else if (field === "label") {
        currentTier.label = String(value || "").trim();
      } else {
        const numeric = Number(String(value).replace(",", "."));
        if (field === "max_qty" && String(value).trim() === "") {
          currentTier.max_qty = null;
        } else if (Number.isFinite(numeric) && numeric >= 0) {
          if (field === "price_per_sqin") {
            currentTier.price_per_sqin = numeric;
            currentTier.price_per_inch = numeric;
          } else if (field === "min_qty") {
            currentTier.min_qty = Math.floor(numeric);
          } else if (field === "max_qty") {
            currentTier.max_qty = Math.floor(numeric);
          }
        }
      }

      return {
        ...prev,
        volumeDiscountTierUnit: "linear_inches",
        volumeDiscountTiers: tiers,
        alphaProDiscount: {
          ...(prev.alphaProDiscount || {}),
          enabled: true,
          unit: "linear_inches",
          unitLabel: "billable inches",
        },
      };
    });
  }, []);

  const resetAlphaProTiers = useCallback(() => {
    setBuilderConfig((prev) => ({
      ...prev,
      volumeDiscountTierUnit: "linear_inches",
      volumeDiscountTiers: ALPHA_PRO_DISCOUNT_TIERS.map((tier) => ({ ...tier })),
      alphaProDiscount: {
        ...(prev.alphaProDiscount || {}),
        enabled: true,
        unit: "linear_inches",
        unitLabel: "billable inches",
      },
    }));
  }, []);


  const [showQuestionModal, setShowQuestionModal] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<ExtraQuestion | null>(null);
  const [newQuestionType, setNewQuestionType] = useState<QuestionType>("text");
  const [newQuestionLabel, setNewQuestionLabel] = useState("");
  const [newQuestionOptions, setNewQuestionOptions] = useState("");
  const [newQuestionRequired, setNewQuestionRequired] = useState(false);


  const handleSaveQuestion = useCallback(() => {
    const questionId = editingQuestion?.id || `q_${Date.now()}`;
    const question: ExtraQuestion = {
      id: questionId,
      type: newQuestionType,
      label: newQuestionLabel,
      required: newQuestionRequired,
    };

    if (newQuestionType === "select" && newQuestionOptions) {
      question.options = newQuestionOptions.split(",").map(o => o.trim()).filter(Boolean);
    }

    if (editingQuestion) {
      setExtraQuestions(prev => prev.map(q => q.id === questionId ? question : q));
    } else {
      setExtraQuestions(prev => [...prev, question]);
    }

    setShowQuestionModal(false);
    resetQuestionForm();
  }, [editingQuestion, newQuestionType, newQuestionLabel, newQuestionOptions, newQuestionRequired]);

  const resetQuestionForm = () => {
    setEditingQuestion(null);
    setNewQuestionType("text");
    setNewQuestionLabel("");
    setNewQuestionOptions("");
    setNewQuestionRequired(false);
  };

  const handleEditQuestion = (question: ExtraQuestion) => {
    setEditingQuestion(question);
    setNewQuestionType(question.type);
    setNewQuestionLabel(question.label);
    setNewQuestionOptions(question.options?.join(", ") || "");
    setNewQuestionRequired(question.required || false);
    setShowQuestionModal(true);
  };

  const handleDeleteQuestion = (id: string) => {
    setExtraQuestions(prev => prev.filter(q => q.id !== id));
  };

  return (
    <Page
      backAction={{ content: "Products", onAction: () => navigate("/app/products") }}
      title={`Configure: ${product.title}`}
      subtitle={`Product ID: ${product.id.split("/").pop()}`}
      primaryAction={{
        content: "Save Configuration",
        loading: isLoading,
        onAction: () => {
          const form = document.getElementById("config-form") as HTMLFormElement;
          form?.requestSubmit();
        },
      }}
    >
      <Layout>

        {actionData?.success && (
          <Layout.Section>
            <Banner tone="success" title="Configuration saved successfully!" />
          </Layout.Section>
        )}
        {actionData?.error && (
          <Layout.Section>
            <Banner tone="critical" title={actionData.error} />
          </Layout.Section>
        )}


        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="400" align="start">
                {product.image && (
                  <img
                    src={product.image}
                    alt={product.title}
                    style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 8 }}
                  />
                )}
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">{product.title}</Text>
                  <Text as="p" tone="subdued">Handle: {product.handle}</Text>
                  <Badge tone={product.status === "ACTIVE" ? "success" : "warning"}>
                    {product.status}
                  </Badge>
                </BlockStack>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Form method="post" id="config-form">
          <input type="hidden" name="_action" value="save" />
          <input type="hidden" name="mode" value={mode} />
          <input type="hidden" name="uploadEnabled" value={uploadEnabled.toString()} />
          <input type="hidden" name="tshirtEnabled" value={tshirtEnabled.toString()} />
          <input type="hidden" name="extraQuestions" value={JSON.stringify(extraQuestions)} />
          <input type="hidden" name="tshirtConfig" value={JSON.stringify(tshirtConfig)} />
          <input type="hidden" name="builderConfig" value={JSON.stringify(builderConfig)} />


          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Upload on this product</Text>
                <Checkbox
                  label="Customers can upload a design on this product page"
                  helpText="Keep this on. Turn it off only to hide the upload block on this product without removing it from the theme."
                  checked={uploadEnabled}
                  onChange={setUploadEnabled}
                />
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">How the customer is charged</Text>
                <Text as="p">
                  This setting is for the <strong>Variant Gang Sheet Upload</strong> block. It decides which
                  Shopify variant (sheet size) goes to the cart after the customer uploads a file.
                </Text>
                <BlockStack gap="150">
                  <Text as="p">
                    <strong>Sheet pricing (recommended):</strong> the customer drops a file → the app measures it
                    (for example 10" × 8") → it picks the smallest sheet variant that fits (for example 22"x12") →
                    that variant and price go to the cart. If the customer asks for 5 copies, the app nests them
                    and adds as many sheets as needed. Your variants must be named with their size, like
                    <strong> 22x12</strong>, <strong>22"x24"</strong>, <strong>22 x 36</strong>.
                  </Text>
                  <Text as="p">
                    <strong>Area pricing (old products):</strong> the price is not taken from variants; the old
                    per-area rule stays. Use only for products that were already set up this way.
                  </Text>
                </BlockStack>

                <Select
                  label="Pricing"
                  options={[
                    { label: "Sheet pricing from variants (recommended)", value: "sheet" },
                    { label: "Area pricing (old products only)", value: "area" },
                  ]}
                  value={builderConfig.pricingMode}
                  onChange={(value) => {
                    setBuilderConfig((prev) => ({
                      ...prev,
                      pricingMode: value as BuilderConfig["pricingMode"],
                    }));
                  }}
                  helpText="Sheet pricing needs size-named variants. The fields below are only for products whose size is split into two options or has extra options like material."
                />

                <FormLayout>
                  <Select
                    label="Sheet Size Option"
                    options={[
                      { label: "Auto Detect", value: "" },
                      ...product.options.map((option: any) => ({
                        label: option.name,
                        value: option.name,
                      })),
                    ]}
                    value={builderConfig.sheetOptionName || ""}
                    onChange={(value) => {
                      setBuilderConfig((prev) => ({
                        ...prev,
                        sheetOptionName: value || null,
                        modalOptionNames: prev.modalOptionNames.filter((name) => name !== value),
                      }));
                    }}
                    helpText='Choose the Shopify option that contains values like "22x24", "22x36", "22x48".'
                  />

                  <FormLayout.Group>
                    <Select
                      label="Width Option"
                      options={[
                        { label: "Auto Detect", value: "" },
                        ...product.options.map((option: any) => ({
                          label: option.name,
                          value: option.name,
                        })),
                      ]}
                      value={builderConfig.widthOptionName || ""}
                      onChange={(value) => {
                        setBuilderConfig((prev) => ({
                          ...prev,
                          widthOptionName: value || null,
                          modalOptionNames: prev.modalOptionNames.filter((name) => name !== value),
                        }));
                      }}
                      helpText='Use for split-size products where width and height are separate Shopify options.'
                    />
                    <Select
                      label="Height Option"
                      options={[
                        { label: "Auto Detect", value: "" },
                        ...product.options.map((option: any) => ({
                          label: option.name,
                          value: option.name,
                        })),
                      ]}
                      value={builderConfig.heightOptionName || ""}
                      onChange={(value) => {
                        setBuilderConfig((prev) => ({
                          ...prev,
                          heightOptionName: value || null,
                          modalOptionNames: prev.modalOptionNames.filter((name) => name !== value),
                        }));
                      }}
                      helpText='Use for split-size products like "Transfer Width" + "Transfer Height".'
                    />
                  </FormLayout.Group>

                  <ChoiceList
                    title="Modal Options"
                    allowMultiple
                    choices={product.options
                      .filter((option: any) =>
                        option.name !== builderConfig.sheetOptionName &&
                        option.name !== builderConfig.widthOptionName &&
                        option.name !== builderConfig.heightOptionName
                      )
                      .map((option: any) => ({
                        label: option.name,
                        value: option.name,
                      }))}
                    selected={builderConfig.modalOptionNames}
                    onChange={(selected) => {
                      setBuilderConfig((prev) => ({
                        ...prev,
                        modalOptionNames: selected,
                      }));
                    }}
                  />
                </FormLayout>

                <Banner tone={builderConfig.pricingMode === "sheet" ? "success" : "warning"}>
                  <p>
                    {builderConfig.pricingMode === "sheet"
                      ? "Sheet pricing is on: uploads are measured and the matching sheet variant is added to the cart at your variant price."
                      : "Area pricing is on: variants are ignored for this product. Switch to sheet pricing unless this is an old product that must keep its area rule."}
                  </p>
                </Banner>
              </BlockStack>
            </Card>
          </Layout.Section>

          {alphaProDiscountProduct && (
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <Text as="h2" variant="headingMd">Volume tiers for this product</Text>
                      <Text as="p" tone="subdued">
                        Per-inch prices by order size for customers in your volume program. Thresholds are billable gang-sheet inches, not cart copies. The program itself (customers, products) lives under Products → Customer Special Pricing.
                      </Text>
                    </BlockStack>
                    <Button onClick={resetAlphaProTiers}>Reset to program defaults</Button>
                  </InlineStack>

                  <Banner tone="success">
                    <p>
                      Storefront pricing will use the measured sheet length × requested copies to choose the active tier.
                      Current unit: <strong>billable inches</strong>.
                    </p>
                  </Banner>

                  <InlineStack gap="300" blockAlign="center">
                    <Badge tone="success">Volume program product</Badge>
                    <Badge tone="info">Tiers by billable inches</Badge>
                  </InlineStack>

                  <BlockStack gap="300">
                    {(builderConfig.volumeDiscountTiers?.length
                      ? builderConfig.volumeDiscountTiers
                      : ALPHA_PRO_DISCOUNT_TIERS
                    ).map((tier, index) => (
                      <Box
                        key={`alpha-tier-${index}`}
                        padding="300"
                        borderWidth="025"
                        borderColor="border"
                        borderRadius="200"
                      >
                        <InlineGrid columns={{ xs: 1, md: "1fr 1fr 1fr 1fr auto" }} gap="300">
                          <TextField
                            label="Min inches"
                            autoComplete="off"
                            type="number"
                            value={String(tier.min_qty ?? "")}
                            onChange={(value) => setAlphaProTier(index, "min_qty", value)}
                          />
                          <TextField
                            label="Max inches"
                            autoComplete="off"
                            type="number"
                            value={tier.max_qty == null ? "" : String(tier.max_qty)}
                            placeholder="No limit"
                            onChange={(value) => setAlphaProTier(index, "max_qty", value)}
                          />
                          <TextField
                            label="Price / inch"
                            autoComplete="off"
                            type="text"
                            inputMode="decimal"
                            prefix="$"
                            value={String(tier.price_per_inch ?? tier.price_per_sqin ?? "")}
                            onChange={(value) => setAlphaProTier(index, "price_per_sqin", value)}
                          />
                          <TextField
                            label="Customer label"
                            autoComplete="off"
                            value={String(tier.label || "")}
                            onChange={(value) => setAlphaProTier(index, "label", value)}
                          />
                          <Checkbox
                            label="Popular"
                            checked={Boolean(tier.popular)}
                            onChange={(value) => setAlphaProTier(index, "popular", value)}
                          />
                        </InlineGrid>
                      </Box>
                    ))}
                  </BlockStack>
                </BlockStack>
              </Card>
            </Layout.Section>
          )}


          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">❓ Extra Questions</Text>
                  <Button
                    icon={PlusIcon}
                    onClick={() => {
                      resetQuestionForm();
                      setShowQuestionModal(true);
                    }}
                  >
                    Add Question
                  </Button>
                </InlineStack>

                <Text as="p" tone="subdued">
                  Add custom questions for customers to answer when uploading their design
                </Text>

                {extraQuestions.length === 0 ? (
                  <Box padding="400" background="bg-surface-secondary" borderRadius="200">
                    <Text as="p" tone="subdued" alignment="center">
                      No extra questions configured. Click "Add Question" to create one.
                    </Text>
                  </Box>
                ) : (
                  <BlockStack gap="300">
                    {extraQuestions.map((q, index) => (
                      <Box key={q.id} padding="300" background="bg-surface-secondary" borderRadius="200">
                        <InlineStack align="space-between">
                          <BlockStack gap="100">
                            <InlineStack gap="200">
                              <Badge>{q.type}</Badge>
                              {q.required && <Badge tone="attention">Required</Badge>}
                            </InlineStack>
                            <Text as="p" fontWeight="semibold">{q.label}</Text>
                            {q.options && (
                              <Text as="p" tone="subdued">
                                Options: {q.options.join(", ")}
                              </Text>
                            )}
                          </BlockStack>
                          <InlineStack gap="200">
                            <Button size="slim" onClick={() => handleEditQuestion(q)}>Edit</Button>
                            <Button size="slim" tone="critical" onClick={() => handleDeleteQuestion(q.id)}>
                              Delete
                            </Button>
                          </InlineStack>
                        </InlineStack>
                      </Box>
                    ))}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>


          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">👕 T-Shirt Add-on</Text>

                <Checkbox
                  label='Show "I want this on a T-Shirt too!" button'
                  helpText="Allows customers to add their design to a T-Shirt in addition to the DTF transfer"
                  checked={tshirtEnabled}
                  onChange={setTshirtEnabled}
                />

                {tshirtEnabled && (
                  <>
                    <Divider />


                    <BlockStack gap="300">
                      <Text as="h3" variant="headingSm">🎯 Select T-Shirt Product</Text>
                      <Text as="p" tone="subdued">
                        Choose the T-Shirt product that will be added to cart when customer clicks "I want this on a T-Shirt too!"
                      </Text>

                      <Select
                        label="T-Shirt Product"
                        options={[
                          { label: '-- Select a product --', value: '' },
                          ...allProducts.map((p: any) => ({
                            label: `${p.title} ${!p.hasColorVariant || !p.hasSizeVariant ? '⚠️' : '✅'}`,
                            value: p.id,
                          }))
                        ]}
                        value={tshirtConfig.tshirtProductId || ''}
                        onChange={(selectedId) => {
                          const selectedProduct = allProducts.find((p: any) => p.id === selectedId);
                          if (selectedProduct) {
                            setTshirtConfig(prev => ({
                              ...prev,
                              tshirtProductId: selectedProduct.id,
                              tshirtProductHandle: selectedProduct.handle,
                              tshirtProductTitle: selectedProduct.title,
                              colorValues: selectedProduct.colorValues || [],
                              sizeValues: selectedProduct.sizeValues || [],
                            }));
                          } else {
                            setTshirtConfig(prev => ({
                              ...prev,
                              tshirtProductId: null,
                              tshirtProductHandle: null,
                              tshirtProductTitle: null,
                              colorValues: [],
                              sizeValues: [],
                            }));
                          }
                        }}
                        helpText="Products with ✅ have Color and Size variants. Products with ⚠️ are missing variants."
                      />

                      {tshirtConfig.tshirtProductId && (
                        <Banner tone="success">
                          <p>✅ Selected: <strong>{tshirtConfig.tshirtProductTitle}</strong></p>
                        </Banner>
                      )}
                    </BlockStack>


                    {tshirtConfig.tshirtProductId && (
                      <>
                        <Divider />

                        <BlockStack gap="300">
                          <Text as="h3" variant="headingSm">Variant Status</Text>

                          <InlineStack gap="400">
                            <Box>
                              <InlineStack gap="200">
                                <Icon source={tshirtConfig.colorValues?.length > 0 ? CheckCircleIcon : AlertCircleIcon} />
                                <Text as="span">
                                  Color Variants: {tshirtConfig.colorValues?.length > 0 ? (
                                    <Badge tone="success">{`${tshirtConfig.colorValues.length} colors`}</Badge>
                                  ) : (
                                    <Badge tone="critical">Not found</Badge>
                                  )}
                                </Text>
                              </InlineStack>
                            </Box>

                            <Box>
                              <InlineStack gap="200">
                                <Icon source={tshirtConfig.sizeValues?.length > 0 ? CheckCircleIcon : AlertCircleIcon} />
                                <Text as="span">
                                  Size Variants: {tshirtConfig.sizeValues?.length > 0 ? (
                                    <Badge tone="success">{`${tshirtConfig.sizeValues.length} sizes`}</Badge>
                                  ) : (
                                    <Badge tone="critical">Not found</Badge>
                                  )}
                                </Text>
                              </InlineStack>
                            </Box>
                          </InlineStack>

                          {(!tshirtConfig.colorValues?.length || !tshirtConfig.sizeValues?.length) && (
                            <Banner tone="critical">
                              <p>
                                ❌ The selected product is missing required variants.
                                T-Shirt product must have both Color and Size options.
                                Please add variants in Shopify Admin → Products → {tshirtConfig.tshirtProductTitle} → Variants
                              </p>
                            </Banner>
                          )}

                          {tshirtConfig.colorValues?.length > 0 && tshirtConfig.sizeValues?.length > 0 && (
                            <>

                              {(() => {
                                const selectedProduct = allProducts.find((p: any) => p.id === tshirtConfig.tshirtProductId);
                                const expectedVariants = (tshirtConfig.colorValues?.length || 0) * (tshirtConfig.sizeValues?.length || 0);
                                const actualVariants = selectedProduct?.variantCount || 0;
                                const hasAllVariants = actualVariants >= expectedVariants;

                                return (
                                  <Banner tone={hasAllVariants ? "success" : "warning"}>
                                    <p>
                                      {hasAllVariants ? '✅' : '⚠️'} Product configured! Colors: {tshirtConfig.colorValues.join(', ')} | Sizes: {tshirtConfig.sizeValues.join(', ')}
                                      <br />
                                      <Text as="span" tone="subdued">
                                        Actual variants: {actualVariants} / Expected: {expectedVariants}
                                        {!hasAllVariants && ' - Not all color/size combinations have variants!'}
                                      </Text>
                                    </p>
                                  </Banner>
                                );
                              })()}
                            </>
                          )}
                        </BlockStack>
                      </>
                    )}

                    <Divider />


                    <FormLayout>
                      <FormLayout.Group>
                        <TextField
                          label="Color Option Name"
                          value={tshirtConfig.colorVariantOption}
                          onChange={(val) => setTshirtConfig(prev => ({ ...prev, colorVariantOption: val }))}
                          helpText="The Shopify option name for T-Shirt color"
                          autoComplete="off"
                        />
                        <TextField
                          label="Size Option Name"
                          value={tshirtConfig.sizeVariantOption}
                          onChange={(val) => setTshirtConfig(prev => ({ ...prev, sizeVariantOption: val }))}
                          helpText="The Shopify option name for T-Shirt size"
                          autoComplete="off"
                        />
                      </FormLayout.Group>

                      <TextField
                        label="Additional Price"
                        type="number"
                        value={tshirtConfig.priceAddon.toString()}
                        onChange={(val) => setTshirtConfig(prev => ({ ...prev, priceAddon: parseFloat(val) || 0 }))}
                        prefix="$"
                        helpText="Extra charge for adding T-Shirt to the order"
                        autoComplete="off"
                      />

                      <ChoiceList
                        title="Available Print Positions"
                        allowMultiple
                        choices={[
                          { label: "Front", value: "front" },
                          { label: "Back", value: "back" },
                          { label: "Left Sleeve", value: "left_sleeve" },
                          { label: "Right Sleeve", value: "right_sleeve" },
                        ]}
                        selected={tshirtConfig.positions}
                        onChange={(selected) => setTshirtConfig(prev => ({ ...prev, positions: selected }))}
                      />
                    </FormLayout>
                  </>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Form>


        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">🧩 Checkout Compatibility Mode</Text>
                {compat.enabled ? (
                  compat.twin?.exists ? (
                    <Badge tone={compat.twin.pricesInSync ? "success" : "attention"}>
                      {compat.twin.pricesInSync ? "Active · Prices in sync" : "Active · Price mismatch"}
                    </Badge>
                  ) : (
                    <Badge tone="critical">Cart product missing</Badge>
                  )
                ) : (
                  <Badge>Off</Badge>
                )}
              </InlineStack>

              <Text as="p" tone="subdued">
                Use this when a second app also runs on this product page. Cart lines are placed on a
                hidden duplicate of this product, so the other app&apos;s checkout rules never flag orders
                created by this upload widget. Customers see the same name and prices.
              </Text>

              {!compat.enabled && compat.conflictSignals > 0 && (
                <Banner tone="warning" title="Another app is selling this product">
                  <p>
                    We detected {compat.conflictSignals} recent order line{compat.conflictSignals === 1 ? "" : "s"} on this
                    product placed by a different app. If both apps stay on the same page, enable
                    compatibility mode so its checkout validation does not warn your customers.
                  </p>
                </Banner>
              )}

              {compat.enabled && compat.twin && !compat.twin.exists && (
                <Banner tone="critical" title="The cart product was deleted">
                  <p>
                    Orders still work — cart lines fall back to this product — but the other
                    app&apos;s checkout warning may be showing again. Recreate the cart product to fix it.
                  </p>
                </Banner>
              )}

              {compat.enabled && compat.twin?.exists && (
                <BlockStack gap="200">
                  <InlineStack gap="300" blockAlign="center">
                    <Text as="p">
                      Cart product: <strong>{compat.twin.title}</strong>
                    </Text>
                    <Badge tone="info">{`${compat.twin.matchedVariants}/${compat.twin.totalPageVariants} variants matched`}</Badge>
                  </InlineStack>
                  {!compat.twin.pricesInSync && (
                    <Banner tone="warning">
                      <p>
                        Prices differ between this product and its cart product. Customers are charged the
                        cart product&apos;s price — sync now, or leave automatic sync on to prevent this.
                      </p>
                    </Banner>
                  )}
                  <Form method="post" id="compat-autosync-form">
                    <input type="hidden" name="_action" value="compat-autosync" />
                    <input type="hidden" name="autoSync" value={compat.autoSync ? "false" : "true"} />
                    <Checkbox
                      label="Keep prices in sync automatically"
                      helpText="When this product's prices change, the cart product is updated to match."
                      checked={compat.autoSync}
                      onChange={() => {
                        (document.getElementById("compat-autosync-form") as HTMLFormElement | null)?.requestSubmit();
                      }}
                    />
                  </Form>
                </BlockStack>
              )}

              <InlineStack gap="300">
                {!compat.enabled && (
                  <Form method="post">
                    <input type="hidden" name="_action" value="compat-enable" />
                    <Button submit variant="primary">Enable compatibility mode</Button>
                  </Form>
                )}
                {compat.enabled && compat.twin && !compat.twin.exists && (
                  <Form method="post">
                    <input type="hidden" name="_action" value="compat-recreate" />
                    <Button submit variant="primary">Recreate cart product</Button>
                  </Form>
                )}
                {compat.enabled && compat.twin?.exists && !compat.twin.pricesInSync && (
                  <Form method="post">
                    <input type="hidden" name="_action" value="compat-sync" />
                    <Button submit>Sync prices now</Button>
                  </Form>
                )}
                {compat.enabled && (
                  <Form method="post">
                    <input type="hidden" name="_action" value="compat-disable" />
                    <Button submit variant="plain" tone="critical">Disable</Button>
                  </Form>
                )}
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

      </Layout>


      <Modal
        open={showQuestionModal}
        onClose={() => setShowQuestionModal(false)}
        title={editingQuestion ? "Edit Question" : "Add Question"}
        primaryAction={{
          content: "Save",
          onAction: handleSaveQuestion,
          disabled: !newQuestionLabel,
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setShowQuestionModal(false) },
        ]}
      >
        <Modal.Section>
          <FormLayout>
            <Select
              label="Question Type"
              options={[
                { label: "Text Input", value: "text" },
                { label: "Dropdown Select", value: "select" },
                { label: "Checkbox", value: "checkbox" },
                { label: "Text Area", value: "textarea" },
              ]}
              value={newQuestionType}
              onChange={(val) => setNewQuestionType(val as QuestionType)}
            />

            <TextField
              label="Question Label"
              value={newQuestionLabel}
              onChange={setNewQuestionLabel}
              placeholder="e.g., Print Direction"
              autoComplete="off"
            />

            {newQuestionType === "select" && (
              <TextField
                label="Options (comma-separated)"
                value={newQuestionOptions}
                onChange={setNewQuestionOptions}
                placeholder="e.g., Left, Center, Right"
                helpText="Enter options separated by commas"
                autoComplete="off"
              />
            )}

            <Checkbox
              label="Required field"
              checked={newQuestionRequired}
              onChange={setNewQuestionRequired}
            />
          </FormLayout>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
