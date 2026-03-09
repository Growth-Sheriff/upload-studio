/**
 * Custom Cart Add API
 * ===================
 * FAZ 5: API Endpoints
 * 
 * POST /api/cart/add-custom
 * 
 * Adds a customized item to the Shopify cart via Storefront API.
 * Handles both DTF-only and T-Shirt customizations.
 * 
 * Request Body:
 * {
 *   productId: string,
 *   variantId: string,
 *   quantity: number,
 *   customizations: {
 *     type: 'dtf' | 'tshirt',
 *     uploadId: string,
 *     thumbnailUrl?: string,
 *     locations?: string[],
 *     color?: string,
 *     size?: string,
 *     extraAnswers?: object
 *   }
 * }
 * 
 * Response: { success: boolean, cartItem: object, error?: string }
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { handleCorsOptions, getCorsHeaders } from "~/lib/cors.server";
import prisma from "~/lib/prisma.server";

// Helper to create CORS JSON response
function corsJson<T>(data: T, request: Request, options: { status?: number } = {}) {
  const corsHeaders = getCorsHeaders(request);
  const headers = new Headers();
  
  for (const [key, value] of Object.entries(corsHeaders)) {
    if (value) headers.set(key, value);
  }
  
  headers.set('Content-Type', 'application/json');
  
  return new Response(JSON.stringify(data), {
    status: options.status || 200,
    headers,
  });
}

// Loader for OPTIONS preflight
export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method === "OPTIONS") {
    return handleCorsOptions(request);
  }
  
  return corsJson({
    error: "Use POST method to add items to cart",
    methods: ["POST"]
  }, request, { status: 405 });
}

// Action for POST
export async function action({ request }: ActionFunctionArgs) {
  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return handleCorsOptions(request);
  }

  if (request.method !== "POST") {
    return corsJson({ error: "Method not allowed" }, request, { status: 405 });
  }

  try {
    const body = await request.json();
    const { 
      shopDomain,
      productId, 
      variantId, 
      quantity = 1, 
      customizations 
    } = body;

    // Validate required fields
    if (!shopDomain) {
      return corsJson({ 
        success: false, 
        error: "Shop domain is required" 
      }, request, { status: 400 });
    }

    if (!variantId) {
      return corsJson({ 
        success: false, 
        error: "Variant ID is required" 
      }, request, { status: 400 });
    }

    if (!customizations?.uploadId) {
      return corsJson({ 
        success: false, 
        error: "Upload ID is required" 
      }, request, { status: 400 });
    }

    // Validate upload exists and belongs to this shop
    const upload = await prisma.upload.findFirst({
      where: { 
        id: customizations.uploadId,
        shop: { shopDomain }
      },
      select: {
        id: true,
        status: true,
        items: {
          take: 1,
          select: {
            id: true,
            thumbnailKey: true
          }
        }
      }
    });

    if (!upload) {
      return corsJson({ 
        success: false, 
        error: "Upload not found" 
      }, request, { status: 404 });
    }

    // Get URLs from first item (if available)
    const firstItem = upload.items[0];
    const thumbnailUrl = firstItem?.thumbnailKey || customizations.thumbnailUrl || '';

    // Build line item properties
    // Hidden keys (for internal tracking)
    const properties: Record<string, string> = {
      '_ul_upload_id': upload.id,
      '_ul_thumbnail': thumbnailUrl,
    };
    
    // Visible keys (shown in checkout)
    properties['Design Type'] = (customizations.type || 'dtf').toUpperCase() + ' Transfer';

    // Add t-shirt specific properties
    if (customizations.type === 'tshirt') {
      properties['_ul_is_tshirt'] = 'true';
      
      if (customizations.color) {
        properties['_ul_tshirt_color'] = customizations.color;
        properties['T-Shirt Color'] = customizations.color;
      }
      
      if (customizations.size) {
        properties['_ul_tshirt_size'] = customizations.size;
        properties['T-Shirt Size'] = customizations.size;
      }
      
      if (customizations.locations && Array.isArray(customizations.locations)) {
        properties['_ul_locations'] = customizations.locations.join(',');
        properties['Print Locations'] = customizations.locations.join(', ');
        
        // Add individual location data (hidden - internal use)
        for (const location of customizations.locations) {
          const locData = customizations.locationSettings?.[location];
          if (locData) {
            properties[`_ul_loc_${location}_scale`] = String(locData.scale || 100);
            properties[`_ul_loc_${location}_x`] = String(locData.positionX || 0);
            properties[`_ul_loc_${location}_y`] = String(locData.positionY || 0);
          }
        }
      }
    }

    // Add extra answers
    if (customizations.extraAnswers && typeof customizations.extraAnswers === 'object') {
      for (const [key, value] of Object.entries(customizations.extraAnswers)) {
        if (value && !key.startsWith('_')) {
          properties[key] = String(value);
        }
      }
    }

    // Add special instructions
    if (customizations.specialInstructions) {
      properties['Special Instructions'] = customizations.specialInstructions;
    }

    // Log the cart addition for analytics (non-blocking)
    console.log('[Cart Add]', {
      shopDomain,
      uploadId: upload.id,
      variantId,
      quantity,
      type: customizations.type || 'dtf',
      locations: customizations.locations || []
    });

    // Return cart item data for frontend to add via AJAX
    // The actual cart addition happens on the frontend via /cart/add.js
    return corsJson({
      success: true,
      cartItem: {
        variantId: variantId,
        quantity: quantity,
        properties: properties
      },
      message: "Cart item prepared successfully"
    }, request);

  } catch (error) {
    console.error("[Cart Add API] Error:", error);
    
    return corsJson({
      success: false,
      error: error instanceof Error ? error.message : "Failed to prepare cart item"
    }, request, { status: 500 });
  }
}
