import { getVolumeProgramProducts, normalizeVolumeProgram, resolveCustomerPricingModelState } from './customerPricingModel.server'
import { validateVolumeLookbackMonths, volumeLookbackStart } from './customerPricingShared'

type RetentionPolicy = { kind: 'unlink'; before: Date | null } | { kind: 'defer'; reason: 'invalid_lookback_months' }

/** All eligible products share the one visible shop-wide window. Other
 * account rates/manual assignments do not consume paid-sheet history. */
export function paidVolumeLinkRetentionPolicy(shopDomain: string, settings: unknown, now: Date): RetentionPolicy {
  const rawMonths = (settings as any)?.alphaProDiscount?.autoEligibility?.months
  if (rawMonths != null) {
    try { validateVolumeLookbackMonths(rawMonths) } catch { return { kind: 'defer', reason: 'invalid_lookback_months' } }
  }
  const model = resolveCustomerPricingModelState(shopDomain, settings)
  const program = normalizeVolumeProgram(settings, shopDomain)
  const active = model.volumeTiersEnabled && program.enabled && program.autoEligibility.enabled &&
    program.tiers.length > 0 && getVolumeProgramProducts(shopDomain, settings).length > 0
  return { kind: 'unlink', before: active ? volumeLookbackStart(program.autoEligibility.months, now.getTime()) : null }
}
