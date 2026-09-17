function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function positiveRate(value: unknown): number {
  const normalized = typeof value === 'string' ? value.trim().replace(',', '.') : value
  const parsed = Number(normalized)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

/**
 * Reject active custom-price rules without an explicit usable rate. Inactive
 * legacy rows remain editable/auditable, and standard-variant rules do not use
 * a per-inch rate at checkout.
 */
export function customerPricingRuleValidationMessage(statuses: unknown): string | null {
  if (!Array.isArray(statuses)) return null

  for (const statusValue of statuses) {
    const status = asRecord(statusValue)
    if (status.active === false || String(status.type || '') === 'standard') continue

    const rules = Array.isArray(status.productRules) ? status.productRules : []
    for (const ruleValue of rules) {
      const rule = asRecord(ruleValue)
      if (rule.active === false || String(rule.pricingMode || '') === 'standard_variant') continue
      if (positiveRate(rule.pricePerInch) > 0) continue

      const statusLabel = String(status.label || status.key || 'Customer status').trim()
      const productLabel = String(rule.productLabel || rule.productId || 'product').trim()
      return `${statusLabel} / ${productLabel} needs a price per inch above zero.`
    }
  }

  return null
}
