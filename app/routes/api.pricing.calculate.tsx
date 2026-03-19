/**
 * Pricing Calculation API
 * =======================
 * FAZ 5: API Endpoints
 * 
 * Calculates dynamic pricing based on:
 * - DTF sheet base price
 * - T-shirt inclusion (if enabled)
 * - Print locations (per-location fees)
 * - Size modifiers
 * - Quantity discounts
 * 
 * GET  /api/pricing/calculate - Returns pricing config
 * POST /api/pricing/calculate - Calculates pricing
 */

import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { handleCorsOptions, getCorsHeaders } from "~/lib/cors.server";

// Default pricing configuration
const DEFAULT_PRICING = {
  dtfSheetBase: 12.00, // Base price for DTF sheet
  tshirtPrice: 15.00,  // T-shirt add-on price
  locationPrices: {
    front: 5.00,
    back: 5.00,
    left_sleeve: 3.00,
    right_sleeve: 3.00,
  },
  quantityDiscounts: [
    { min: 1, max: 5, discount: 0 },
    { min: 6, max: 10, discount: 0.05 }, // 5% off
    { min: 11, max: 25, discount: 0.10 }, // 10% off
    { min: 26, max: 50, discount: 0.15 }, // 15% off
    { min: 51, max: Infinity, discount: 0.20 }, // 20% off
  ],
};

interface PricingRequest {
  mode: 'dtf_only' | 'tshirt_included' | 'dtf_by_size';
  locations: string[];
  quantity: number;
  size?: string;
  shopDomain?: string;
  // DTF By Size fields
  widthIn?: number;
  heightIn?: number;
  tiers?: Array<{ min_qty: number; max_qty: number | null; price_per_sqin: number }>;
}

interface PricingResponse {
  breakdown: {
    dtfBase: number;
    tshirt: number;
    locations: { [key: string]: number };
    sizeModifier: number;
    subtotal: number;
    discount: number;
    discountPercent: number;
    total: number;
  };
  unitPrice: number;
  totalPrice: number;
  formattedTotal: string;
}

// Size price modifiers
const SIZE_MODIFIERS: Record<string, number> = {
  'xs': 0, 's': 0, 'm': 0,
  'l': 2, 'xl': 2,
  '2xl': 5, '3xl': 5,
  '4xl': 8, '5xl': 8,
};

// Helper for CORS response
function corsJson<T>(data: T, request: Request, status = 200) {
  const corsHeaders = getCorsHeaders(request);
  const headers = new Headers();
  
  for (const [key, value] of Object.entries(corsHeaders)) {
    if (value) headers.set(key, value);
  }
  headers.set('Content-Type', 'application/json');
  
  return new Response(JSON.stringify(data), { status, headers });
}

export async function loader({ request }: LoaderFunctionArgs) {
  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return handleCorsOptions(request);
  }
  
  // Return default pricing config for GET requests
  return corsJson({
    config: DEFAULT_PRICING,
    sizeModifiers: SIZE_MODIFIERS,
    message: "Use POST to calculate pricing"
  }, request);
}

export async function action({ request }: ActionFunctionArgs) {
  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return handleCorsOptions(request);
  }
  
  if (request.method !== "POST") {
    return corsJson({ error: "Method not allowed" }, request, 405);
  }

  try {
    const body: PricingRequest = await request.json();
    const { mode, locations = [], quantity = 1, size, shopDomain } = body;

    // ═══════════════════════════════════════════════════════
    // DTF BY SIZE MODE — Width × Height × Qty × $/in²
    // ═══════════════════════════════════════════════════════
    if (mode === 'dtf_by_size') {
      const { widthIn = 0, heightIn = 0, tiers = [] } = body;
      const area = widthIn * heightIn;

      // Find active tier based on quantity
      const defaultTiers = [
        { min_qty: 1, max_qty: 9, price_per_sqin: 0.06 },
        { min_qty: 10, max_qty: 49, price_per_sqin: 0.054 },
        { min_qty: 50, max_qty: 99, price_per_sqin: 0.051 },
        { min_qty: 100, max_qty: null, price_per_sqin: 0.0492 }
      ];
      const activeTiers = tiers.length > 0 ? tiers : defaultTiers;
      const activeTier = activeTiers.find(t =>
        quantity >= t.min_qty && (t.max_qty === null || quantity <= t.max_qty)
      ) || activeTiers[0];

      const pricePerSqIn = activeTier.price_per_sqin;
      const subtotal = area * pricePerSqIn;
      const total = subtotal * quantity;

      return corsJson({
        mode: 'dtf_by_size',
        breakdown: {
          widthIn,
          heightIn,
          area: Math.round(area * 100) / 100,
          pricePerSqIn,
          subtotalPerUnit: Math.round(subtotal * 100) / 100,
          quantity,
          total: Math.round(total * 100) / 100,
        },
        unitPrice: Math.round(subtotal * 100) / 100,
        totalPrice: Math.round(total * 100) / 100,
        formattedTotal: `$${(Math.round(total * 100) / 100).toFixed(2)}`,
        formula: `${area.toFixed(2)} in² × ${quantity} × $${pricePerSqIn} /in² = $${total.toFixed(2)}`,
      }, request);
    }

    // ═══════════════════════════════════════════════════════
    // EXISTING MODES — dtf_only / tshirt_included
    // ═══════════════════════════════════════════════════════
    // TODO: Load shop-specific pricing from metafields if shopDomain provided
    const pricing = DEFAULT_PRICING;

    // Calculate base prices
    let dtfBase = pricing.dtfSheetBase;
    let tshirt = 0;
    let locationsTotal = 0;
    let sizeModifier = 0;
    const locationBreakdown: { [key: string]: number } = {};

    // Add t-shirt price if mode is tshirt_included
    if (mode === 'tshirt_included') {
      tshirt = pricing.tshirtPrice;
      
      // Add location prices (first location is free, rest are charged)
      locations.forEach((location, index) => {
        if (index === 0) {
          locationBreakdown[location] = 0; // First location free
        } else {
          const locationPrice = pricing.locationPrices[location as keyof typeof pricing.locationPrices] || 5.00;
          locationBreakdown[location] = locationPrice;
          locationsTotal += locationPrice;
        }
      });
      
      // Add size modifier
      if (size) {
        sizeModifier = SIZE_MODIFIERS[size.toLowerCase()] || 0;
      }
    }

    // Calculate subtotal per unit
    const subtotalPerUnit = dtfBase + tshirt + locationsTotal + sizeModifier;
    const subtotal = subtotalPerUnit * quantity;

    // Apply quantity discount
    let discountPercent = 0;
    for (const tier of pricing.quantityDiscounts) {
      if (quantity >= tier.min && quantity <= tier.max) {
        discountPercent = tier.discount;
        break;
      }
    }

    const discount = subtotal * discountPercent;
    const total = subtotal - discount;
    const unitPrice = total / quantity;

    const response: PricingResponse = {
      breakdown: {
        dtfBase,
        tshirt,
        locations: locationBreakdown,
        sizeModifier,
        subtotal,
        discount,
        discountPercent: discountPercent * 100,
        total,
      },
      unitPrice: Math.round(unitPrice * 100) / 100,
      totalPrice: Math.round(total * 100) / 100,
      formattedTotal: `$${(Math.round(total * 100) / 100).toFixed(2)}`,
    };

    return corsJson(response, request);
  } catch (error) {
    console.error("[Pricing API] Error:", error);
    return corsJson({ error: "Invalid request" }, request, 400);
  }
}
