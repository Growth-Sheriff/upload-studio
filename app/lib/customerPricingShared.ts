// Client-safe pieces of the customer pricing model: types, defaults and pure
// helpers the admin UI needs in the browser. Everything that touches settings
// or the database lives in customerPricingModel.server.ts.

export type CustomerPricingModel = 'off' | 'status_rates' | 'volume_tiers' | 'both'
export type CustomerPricingPriority = 'status_first' | 'volume_first'
export type MeasurementBasis = 'full_page' | 'artwork_bounds'
export type SheetSelection = 'block_default' | 'lowest_total_cost' | 'smallest_fitting_sheet'
export type VolumeCheckoutMode = 'custom_checkout' | 'standard_cart'
export type VolumeBillingBasis = 'measured_length' | 'variant_length'
export type PricingSource = 'none' | 'status_rates' | 'volume_tiers'

export const CUSTOMER_PRICING_MODELS: CustomerPricingModel[] = ['off', 'status_rates', 'volume_tiers', 'both']

/** Legacy tenants whose behaviour predates the model setting. Used only to
 *  derive defaults when `customerPricing.model` is absent. */
export const ALPHA_PRINT_SHOP_DOMAINS = ['da49fd-8.myshopify.com', 'alphaprintcenter.myshopify.com']

export function isAlphaPrintShop(shopDomain: string | null | undefined): boolean {
  return ALPHA_PRINT_SHOP_DOMAINS.includes(String(shopDomain || '').trim().toLowerCase())
}

export interface VolumeTier {
  min_qty: number
  max_qty: number | null
  price_per_sqin: number
  price_per_inch: number
  label: string
  popular?: boolean
}

export const DEFAULT_VOLUME_TIERS: VolumeTier[] = [
  { min_qty: 1, max_qty: 249, price_per_sqin: 0.28, price_per_inch: 0.28, label: '1+ inches' },
  { min_qty: 250, max_qty: 499, price_per_sqin: 0.22, price_per_inch: 0.22, label: '250+ inches', popular: true },
  { min_qty: 500, max_qty: null, price_per_sqin: 0.2, price_per_inch: 0.2, label: '500+ inches' },
]

export function isCustomerPricingModel(value: unknown): value is CustomerPricingModel {
  return CUSTOMER_PRICING_MODELS.includes(value as CustomerPricingModel)
}

export function pickVolumeTier(tiers: VolumeTier[], billableInches: number): VolumeTier | null {
  if (!tiers.length) return null
  const basis = Math.max(0, Number(billableInches) || 0)
  const match = tiers.find((tier) => basis >= tier.min_qty && (tier.max_qty == null || basis <= tier.max_qty))
  return match || tiers[0]
}

export interface CustomerPricingTemplate {
  key: string
  model: Exclude<CustomerPricingModel, 'off'>
  title: string
  description: string
  statuses?: Array<{ key: string; label: string; type: 'business' | 'vip'; pricePerInch: number }>
  tiers?: VolumeTier[]
}

export const CUSTOMER_PRICING_TEMPLATES: CustomerPricingTemplate[] = [
  {
    key: 'wholesale_flat',
    model: 'status_rates',
    title: 'Wholesale flat rate',
    description: 'One Business status with a flat per-inch price on the sheet length. Good for print shops that quote resellers a fixed rate.',
    statuses: [{ key: 'business', label: 'Wholesale', type: 'business', pricePerInch: 0.25 }],
  },
  {
    key: 'business_vip',
    model: 'status_rates',
    title: 'Business + VIP',
    description: 'Business pays the rate on the matched sheet length; VIP pays only the exact measured length of the file.',
    statuses: [
      { key: 'business', label: 'Business', type: 'business', pricePerInch: 0.25 },
      { key: 'vip', label: 'VIP', type: 'vip', pricePerInch: 0.2 },
    ],
  },
  {
    key: 'returning_three_tier',
    model: 'volume_tiers',
    title: 'Returning customer 3 tiers',
    description: 'Listed customers pay less per inch as the order grows: 1+, 250+ and 500+ inches.',
    tiers: DEFAULT_VOLUME_TIERS,
  },
]
