const SHOPIFY_PRODUCT_GID_PATTERN = /^gid:\/\/shopify\/Product\/([1-9]\d*)$/
const SHOPIFY_PRODUCT_LEGACY_ID_PATTERN = /^[1-9]\d*$/

function trimmedProductId(value: unknown): string | null {
  if (value == null) return null
  const normalized = String(value).trim()
  return normalized || null
}

/** Return the canonical Shopify Product GID for a numeric or GID product id. */
export function canonicalShopifyProductId(value: unknown): string | null {
  const raw = trimmedProductId(value)
  if (!raw) return null

  const gidMatch = raw.match(SHOPIFY_PRODUCT_GID_PATTERN)
  if (gidMatch) return `gid://shopify/Product/${gidMatch[1]}`
  if (SHOPIFY_PRODUCT_LEGACY_ID_PATTERN.test(raw)) {
    return `gid://shopify/Product/${raw}`
  }
  return null
}

/**
 * Every spelling that may exist in ProductConfig for one Shopify product.
 * Canonical GID is deliberately first so callers have one stable preference.
 */
export function shopifyProductIdCandidates(value: unknown): string[] {
  const raw = trimmedProductId(value)
  if (!raw) return []

  const canonical = canonicalShopifyProductId(raw)
  if (!canonical) return [raw]
  const legacy = canonical.slice(canonical.lastIndexOf('/') + 1)
  return [canonical, legacy]
}

export function shopifyProductIdsEqual(left: unknown, right: unknown): boolean {
  const leftRaw = trimmedProductId(left)
  const rightRaw = trimmedProductId(right)
  if (!leftRaw || !rightRaw) return false

  const leftCanonical = canonicalShopifyProductId(leftRaw)
  const rightCanonical = canonicalShopifyProductId(rightRaw)
  if (leftCanonical || rightCanonical) {
    return Boolean(leftCanonical && rightCanonical && leftCanonical === rightCanonical)
  }
  return leftRaw === rightRaw
}

export function equivalentProductConfigRows<T extends { productId: string }>(
  rows: readonly T[],
  productId: unknown
): T[] {
  return rows.filter((row) => shopifyProductIdsEqual(row.productId, productId))
}

/**
 * Choose deterministically when legacy numeric and canonical-GID rows coexist.
 * Prisma's findFirst has no stable preference without an explicit order.
 */
export function selectPreferredProductConfig<T extends { productId: string }>(
  rows: readonly T[],
  productId: unknown
): T | null {
  const canonical = canonicalShopifyProductId(productId)
  const matches = equivalentProductConfigRows(rows, productId)
  if (!matches.length) return null

  return [...matches].sort((left, right) => {
    const leftIsCanonical = canonical != null && left.productId === canonical
    const rightIsCanonical = canonical != null && right.productId === canonical
    if (leftIsCanonical !== rightIsCanonical) return leftIsCanonical ? -1 : 1
    return left.productId.localeCompare(right.productId)
  })[0]
}

function stableSerialize(value: unknown): string {
  if (value == null || typeof value !== 'object') {
    return JSON.stringify(value) ?? String(value)
  }
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`

  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
    .join(',')}}`
}

export function productConfigPayloadsConflict<T>(
  rows: readonly T[],
  payload: (row: T) => unknown
): boolean {
  if (rows.length < 2) return false
  const expected = stableSerialize(payload(rows[0]))
  return rows.slice(1).some((row) => stableSerialize(payload(row)) !== expected)
}
