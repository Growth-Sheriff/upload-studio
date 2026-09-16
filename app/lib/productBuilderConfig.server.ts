const MARGIN_KEYS = ['artboardMarginIn', 'imageMarginIn'] as const

/**
 * The product editor has never exposed margin controls. Existing rows that
 * predate those keys therefore mean zero implicit margin, not the defaults
 * used when a genuinely new product configuration is created.
 */
export function preserveStoredProductMargins(
  nextConfig: Record<string, unknown>,
  storedConfig: Record<string, unknown> | null,
  configExists: boolean
): Record<string, unknown> {
  if (!configExists) return nextConfig

  const next = { ...nextConfig }
  for (const key of MARGIN_KEYS) {
    const stored = Number(storedConfig?.[key])
    next[key] = Number.isFinite(stored) && stored >= 0 ? stored : 0
  }
  return next
}
