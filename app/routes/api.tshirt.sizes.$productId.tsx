/**
 * T-Shirt Sizes API
 * =================
 * FAZ 5: API Endpoints
 * 
 * GET /api/tshirt/sizes/:productId?shop=xxx.myshopify.com
 * 
 * Returns available sizes for a specific t-shirt product.
 * Fetches from Shopify product variants.
 * 
 * Response: { sizes: [{ id, name, variantId, price, available }] }
 */

import type { LoaderFunctionArgs } from "@remix-run/node";
import { handleCorsOptions, getCorsHeaders } from "~/lib/cors.server";
import prisma from "~/lib/prisma.server";

// Default sizes when no product specified
const DEFAULT_SIZES = [
  { id: "xs", name: "XS", variantId: null, price: 0, priceModifier: 0, available: true },
  { id: "s", name: "S", variantId: null, price: 0, priceModifier: 0, available: true },
  { id: "m", name: "M", variantId: null, price: 0, priceModifier: 0, available: true },
  { id: "l", name: "L", variantId: null, price: 2, priceModifier: 2, available: true },
  { id: "xl", name: "XL", variantId: null, price: 2, priceModifier: 2, available: true },
  { id: "2xl", name: "2XL", variantId: null, price: 5, priceModifier: 5, available: true },
  { id: "3xl", name: "3XL", variantId: null, price: 5, priceModifier: 5, available: true },
];

// Size price modifiers (larger sizes cost more)
const SIZE_PRICE_MODIFIERS: Record<string, number> = {
  'xs': 0, 'XS': 0,
  's': 0, 'S': 0,
  'm': 0, 'M': 0,
  'l': 2, 'L': 2,
  'xl': 2, 'XL': 2,
  '2xl': 5, '2XL': 5, 'XXL': 5,
  '3xl': 5, '3XL': 5, 'XXXL': 5,
  '4xl': 8, '4XL': 8,
  '5xl': 8, '5XL': 8,
};

// Helper to create cached CORS JSON response
function cachedCorsJson<T>(data: T, request: Request, options: { status?: number; maxAge?: number } = {}) {
  const corsHeaders = getCorsHeaders(request);
  const headers = new Headers();
  
  for (const [key, value] of Object.entries(corsHeaders)) {
    if (value) headers.set(key, value);
  }
  
  // Cache for specified time (default 2 minutes for inventory)
  const maxAge = options.maxAge ?? 120;
  headers.set('Cache-Control', `public, max-age=${maxAge}, s-maxage=${maxAge}`);
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

  const productId = params.productId;
  const url = new URL(request.url);
  const shopDomain = url.searchParams.get("shop");

  // If no product specified, return default sizes
  if (!productId) {
    return cachedCorsJson({
      sizes: DEFAULT_SIZES,
      source: "default"
    }, request);
  }

  // If no shop specified, return defaults
  if (!shopDomain) {
    return cachedCorsJson({
      sizes: DEFAULT_SIZES,
      source: "default"
    }, request);
  }

  try {
    // Find shop with access token
    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: {
        id: true,
        accessToken: true
      }
    });

    if (!shop || !shop.accessToken) {
      return cachedCorsJson({
        sizes: DEFAULT_SIZES,
        source: "default",
        error: "Shop or access token not found"
      }, request);
    }

    // Normalize product ID
    const productGid = productId.startsWith("gid://")
      ? productId
      : `gid://shopify/Product/${productId}`;

    // Verify product is configured for customization in this shop
    const productConfig = await prisma.productConfig.findFirst({
      where: { shopId: shop.id, productId: productGid },
      select: { id: true },
    });

    if (!productConfig) {
      return cachedCorsJson({
        sizes: DEFAULT_SIZES,
        source: "default",
      }, request);
    }

    // Fetch product variants from Shopify
    const response = await fetch(
      `https://${shopDomain}/admin/api/2025-10/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": shop.accessToken,
        },
        body: JSON.stringify({
          query: `
            query GetProductSizes($id: ID!) {
              product(id: $id) {
                id
                title
                variants(first: 100) {
                  edges {
                    node {
                      id
                      title
                      price
                      availableForSale
                      inventoryQuantity
                      selectedOptions {
                        name
                        value
                      }
                    }
                  }
                }
                options {
                  name
                  values
                }
              }
            }
          `,
          variables: { id: productGid }
        })
      }
    );

    if (!response.ok) {
      throw new Error(`Shopify API error: ${response.status}`);
    }

    const data = await response.json();

    if (data.errors) {
      console.error("[T-Shirt Sizes API] GraphQL errors:", data.errors);
      throw new Error("GraphQL error");
    }

    const product = data.data?.product;
    if (!product) {
      return cachedCorsJson({
        sizes: DEFAULT_SIZES,
        source: "default",
        error: "Product not found"
      }, request);
    }

    // Extract sizes from variants
    const sizesMap = new Map<string, {
      id: string;
      name: string;
      variantId: string;
      price: number;
      priceModifier: number;
      available: boolean;
    }>();

    for (const edge of product.variants.edges) {
      const variant = edge.node;
      
      // Find size option
      const sizeOption = variant.selectedOptions.find(
        (opt: { name: string; value: string }) => 
          opt.name.toLowerCase() === 'size'
      );

      if (sizeOption) {
        const sizeName = sizeOption.value;
        const sizeId = sizeName.toLowerCase().replace(/\s+/g, '');
        
        // Only add if not already in map (first variant wins)
        if (!sizesMap.has(sizeId)) {
          sizesMap.set(sizeId, {
            id: sizeId,
            name: sizeName,
            variantId: variant.id,
            price: parseFloat(variant.price),
            priceModifier: SIZE_PRICE_MODIFIERS[sizeName] ?? 0,
            available: variant.availableForSale && (variant.inventoryQuantity ?? 1) > 0
          });
        }
      }
    }

    // Convert to sorted array
    const sizeOrder = ['xs', 's', 'm', 'l', 'xl', '2xl', '3xl', '4xl', '5xl'];
    const sizes = Array.from(sizesMap.values()).sort((a, b) => {
      const aIdx = sizeOrder.indexOf(a.id);
      const bIdx = sizeOrder.indexOf(b.id);
      return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
    });

    return cachedCorsJson({
      productId: productGid,
      productTitle: product.title,
      sizes,
      source: "shopify"
    }, request);

  } catch (error) {
    console.error("[T-Shirt Sizes API] Error:", error);
    
    return cachedCorsJson({
      sizes: DEFAULT_SIZES,
      source: "default",
      error: "Failed to fetch sizes"
    }, request);
  }
}
