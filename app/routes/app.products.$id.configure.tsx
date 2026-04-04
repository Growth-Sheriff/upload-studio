/**
 * Product Configure Page
 * Merchant configures upload widget, extra questions, and T-Shirt options per product
 */

import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useActionData, Form, useNavigation, useNavigate } from "@remix-run/react";
import {
  Page, Layout, Card, Text, BlockStack, InlineStack,
  TextField, Select, Button, Banner, FormLayout, Divider, Box,
  Checkbox, Badge, Icon, EmptyState, Modal, ChoiceList, RadioButton, Thumbnail
} from "@shopify/polaris";
import { DeleteIcon, PlusIcon, AlertCircleIcon, CheckCircleIcon, SearchIcon } from "@shopify/polaris-icons";
import { useState, useCallback } from "react";
import { authenticate } from "~/shopify.server";
import prisma from "~/lib/prisma.server";
import { z } from "zod";

// FAZ 1 - ADM-003: Zod schema for ExtraQuestion validation
const ExtraQuestionSchema = z.object({
  id: z.string().min(1).max(100),
  type: z.enum(["text", "select", "checkbox", "textarea"]),
  label: z.string().min(1).max(500).transform(sanitizeHtml),
  options: z.array(z.string().max(500).transform(sanitizeHtml)).optional(),
  required: z.boolean().optional(),
  placeholder: z.string().max(500).transform(sanitizeHtml).optional(),
});

const ExtraQuestionsArraySchema = z.array(ExtraQuestionSchema).max(20);

// FAZ 1 - ADM-003: TshirtConfig validation schema
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

// FAZ 1 - ADM-003: HTML sanitization function (XSS prevention)
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

// Extra Question Types
type QuestionType = "text" | "select" | "checkbox" | "textarea";

interface ExtraQuestion {
  id: string;
  type: QuestionType;
  label: string;
  options?: string[]; // For select type
  required?: boolean;
  placeholder?: string;
}

interface TshirtConfig {
  tshirtProductId: string | null;      // Selected T-Shirt product GID
  tshirtProductHandle: string | null;  // Selected T-Shirt product handle
  tshirtProductTitle: string | null;   // Selected T-Shirt product title
  colorVariantOption: string;
  sizeVariantOption: string;
  colorValues: string[];               // Available colors from T-Shirt product
  sizeValues: string[];                // Available sizes from T-Shirt product
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
  volumeDiscountTiers: Array<{
    min_qty: number;
    max_qty: number | null;
    price_per_sqin: number;
  }>;
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
  colorProfile: z.string().max(50).default(DEFAULT_BUILDER_CONFIG.colorProfile),
  maxFileSizeMb: z.number().min(1).max(10240).default(DEFAULT_BUILDER_CONFIG.maxFileSizeMb),
  supportedFormats: z.array(z.string().max(20)).max(20).default(DEFAULT_BUILDER_CONFIG.supportedFormats),
  volumeDiscountTiers: z.array(VolumeDiscountTierSchema).default(DEFAULT_BUILDER_CONFIG.volumeDiscountTiers),
});

// Fetch product details from Shopify
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

// Fetch all products for T-Shirt dropdown
// FAZ 1 - ADM-001: Updated to use pagination for 500+ products
// FAZ 3 - ADM-002: Added variantsCount for variant count display
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

// FAZ 1 - ADM-001: Helper function to fetch all products with pagination (max 500)
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
        // FAZ 3 - ADM-002: Add variant count
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

  // Get shop
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
  });

  if (!shop) {
    throw new Response("Shop not found", { status: 404 });
  }

  // Fetch product from Shopify
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

  // Fetch all products for T-Shirt dropdown using pagination (FAZ 1 - ADM-001)
  const allProducts = await fetchAllProductsWithPagination(admin);

  // Get existing config - using raw query to access all fields
  const config = await prisma.productConfig.findUnique({
    where: {
      shopId_productId: {
        shopId: shop.id,
        productId: productGid,
      },
    },
  }) as any; // Type assertion to access new fields

  // Check for color/size variants
  const colorOption = product.options?.find((o: any) => 
    o.name.toLowerCase().includes("color") || o.name.toLowerCase().includes("renk")
  );
  const sizeOption = product.options?.find((o: any) => 
    o.name.toLowerCase().includes("size") || o.name.toLowerCase().includes("beden")
  );

  return json({
    shop: { domain: shopDomain },
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
      builderConfig: {
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
      },
    } : {
      mode: "dtf",
      uploadEnabled: true,
      extraQuestions: [] as ExtraQuestion[],
      tshirtEnabled: false,
      tshirtConfig: null as TshirtConfig | null,
      builderConfig: DEFAULT_BUILDER_CONFIG,
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

    // FAZ 1 - ADM-003: Validate and sanitize input with Zod
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

    // Upsert config - using raw object to bypass type checking for new fields
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
  const { shop, product, allProducts, config } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as { success?: boolean; message?: string; error?: string } | null;
  const navigation = useNavigation();
  const navigate = useNavigate();
  const isLoading = navigation.state === "submitting";

  // Form state
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

  // Question modal state
  const [showQuestionModal, setShowQuestionModal] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<ExtraQuestion | null>(null);
  const [newQuestionType, setNewQuestionType] = useState<QuestionType>("text");
  const [newQuestionLabel, setNewQuestionLabel] = useState("");
  const [newQuestionOptions, setNewQuestionOptions] = useState("");
  const [newQuestionRequired, setNewQuestionRequired] = useState(false);

  // Add/Edit question
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
        {/* Success/Error Banner */}
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

        {/* Product Info */}
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

          {/* Mode Selection */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">🎨 Upload Mode</Text>
                <Text as="p" tone="subdued">
                  Select the upload mode for this product. Each mode has different features and customer experience.
                </Text>
                
                <BlockStack gap="200">
                  <RadioButton
                    label="DTF Transfer"
                    helpText="Customers upload their design for DTF (Direct to Film) transfer printing. Includes optional T-Shirt add-on."
                    checked={mode === "dtf"}
                    id="mode-dtf"
                    name="mode-radio"
                    onChange={() => setMode("dtf")}
                  />
                  <RadioButton
                    label="Mode 2 (Coming Soon)"
                    helpText="Second mode will be available soon."
                    checked={mode === "mode2"}
                    id="mode-mode2"
                    name="mode-radio"
                    disabled
                    onChange={() => {}}
                  />
                </BlockStack>

                <Divider />

                <Checkbox
                  label="Enable upload widget for this product"
                  helpText="When enabled, customers can upload their designs on the product page"
                  checked={uploadEnabled}
                  onChange={setUploadEnabled}
                />
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">DTF Sheet Pricing</Text>
                <Text as="p" tone="subdued">
                  Keep existing products on legacy area pricing, or enable sheet-based pricing for products
                  that should calculate required sheet count from product variants.
                </Text>

                <Select
                  label="Pricing Mode"
                  options={[
                    { label: "Legacy Area Pricing (safe default)", value: "area" },
                    { label: "Sheet Pricing from Variants", value: "sheet" },
                  ]}
                  value={builderConfig.pricingMode}
                  onChange={(value) => {
                    setBuilderConfig((prev) => ({
                      ...prev,
                      pricingMode: value as BuilderConfig["pricingMode"],
                    }));
                  }}
                  helpText="Default remains area pricing so existing tenant flows do not change until you enable sheet pricing per product."
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

                <Banner tone={builderConfig.pricingMode === "sheet" ? "success" : "info"}>
                  <p>
                    {builderConfig.pricingMode === "sheet"
                      ? "Sheet pricing is enabled for this product. Storefront will resolve exact Shopify variants from sheet size plus modal selections."
                      : "Legacy area pricing stays active for this product. This preserves existing storefront behavior."}
                  </p>
                </Banner>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Extra Questions */}
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

          {/* T-Shirt Option */}
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
                    
                    {/* T-Shirt Product Selection */}
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

                    {/* Variant Status */}
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
                              {/* FAZ 3 - ADM-002: Show variant count vs option combinations */}
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

                    {/* T-Shirt Config */}
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

        {/* Snippet Instructions */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">🔧 Theme Integration</Text>
              
              <Banner tone="info">
                <p><strong>Important:</strong> Theme App Extension blocks must be added via Theme Editor, not code.</p>
              </Banner>
              
              <Text as="h3" variant="headingSm">How to Add the Upload Widget:</Text>
              
              <BlockStack gap="200">
                <Text as="p">
                  <strong>Step 1:</strong> Go to your Shopify Admin → Online Store → Themes → Customize
                </Text>
                <Text as="p">
                  <strong>Step 2:</strong> Navigate to a Product page template
                </Text>
                <Text as="p">
                  <strong>Step 3:</strong> Click "Add block" or "Add section"
                </Text>
                <Text as="p">
                  <strong>Step 4:</strong> Look under "Apps" section → Select "<strong>UL DTF Transfer</strong>"
                </Text>
                <Text as="p">
                  <strong>Step 5:</strong> Position the block where you want it and Save
                </Text>
              </BlockStack>
              
              <Divider />
              
              <Box padding="200" background="bg-surface-secondary" borderRadius="100">
                <Text as="p" tone="subdued">
                  ⚠️ Note: The old method using render tags does NOT work with Theme App Extensions. 
                  You must use the Theme Editor to add app blocks.
                </Text>
              </Box>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      {/* Question Modal */}
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
