// Multi-source upload<->order line matching.
//
// A cart line can prove which upload it belongs to through several carriers,
// listed here from most to least direct. Third-party cart apps are known to
// rewrite line properties, so the visible identity/file URLs and the cart
// token act as redundant carriers of the same truth (the uploadId). This is
// carrier redundancy for one source of truth (the DB Upload row), not
// multiple sources of truth.
//
//   1. `_ul_upload_id` hidden property (legacy + transition carrier)
//   2. `Design Identity` URL property -> /i/<uploadId>
//   3. `Design File` URL property     -> storage path contains /<uploadId>/
//   4. order.cart_token               -> Upload.cartToken column (server-side)
//
// Sources 1-3 are extracted here as pure functions so they can be unit
// tested; source 4 needs the DB and lives in the orders webhook.

export type LineItemProperty = { name: string; value: unknown }

export type UploadMatch = {
  uploadId: string
  source: 'property' | 'identity_url' | 'file_url'
}

export const IDENTITY_PROPERTY = 'Design Identity'
export const FILE_PROPERTY = 'Design File'
export const LEGACY_ID_PROPERTY = '_ul_upload_id'
// dtf-upload.js sheet-pricing lines historically wrote `_upload_id` instead
// of `_ul_upload_id`; the webhook never read it, so those orders fell through
// to ghost uploads. Honor it as an additional legacy carrier.
const LEGACY_ID_PROPERTIES = [LEGACY_ID_PROPERTY, '_upload_id']

// cuid()/cuid2 ids: lowercase alphanumeric, generously bounded.
const UPLOAD_ID_PATTERN = /^[a-z0-9]{16,40}$/

function isPlausibleUploadId(value: unknown): value is string {
  return typeof value === 'string' && UPLOAD_ID_PATTERN.test(value)
}

/** Shopify /cart.js serves the newer cart tokens with a `?key=...` suffix
 *  that order.cart_token does not carry; normalize both sides to the bare
 *  token so bind-time and webhook-time values always compare equal. */
export function normalizeCartToken(raw: unknown): string {
  return String(raw || '').trim().split('?')[0]
}

/** Parse an identity page URL such as https://app.example.com/i/<uploadId>
 *  or /apps/customizer/i/<uploadId>(.json). Returns null when not matching. */
export function extractUploadIdFromIdentityUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null
  const match = url.match(/\/i\/([a-z0-9]{16,40})(?:\.json)?(?:[?#]|$)/)
  return match ? match[1] : null
}

/** Parse a storage/download URL whose path contains the upload id as a
 *  dedicated segment: .../<shop>/<env>/<uploadId>/<itemId>/<file>. The
 *  uploadId segment is recognized by shape, scanning left to right so the
 *  upload id (which precedes the item id) wins. */
export function extractUploadIdFromFileUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url.includes('/')) return null
  let path = url
  try {
    if (/^https?:\/\//.test(url)) path = new URL(url).pathname
  } catch {
    return null
  }
  const segments = path.split('/').map((s) => {
    try {
      return decodeURIComponent(s)
    } catch {
      return s
    }
  })
  // Expect .../<uploadId>/<itemId>/<filename>; both ids are cuid-shaped, so
  // require the trailing filename segment and take the first of the pair.
  for (let i = 0; i < segments.length - 2; i++) {
    if (isPlausibleUploadId(segments[i]) && isPlausibleUploadId(segments[i + 1])) {
      return segments[i]
    }
  }
  return null
}

// Signatures observed in DripApps' storefront bundle (gang-sheet-edit.js):
// it writes `_Print Ready File` / `_Print Ready` / `_Admin Edit` keys and
// identifies its own cart lines by property values containing
// `dripappsserver.`. Lines carrying these marks belong to that app — they
// must not produce ghost uploads or commissions on shared products.
const FOREIGN_APP_PROPERTY_NAMES = new Set([
  '_Print Ready File',
  '_Print Ready',
  '_Admin Edit',
])
const FOREIGN_APP_VALUE_MARKER = 'dripappsserver.'

/** True when a line item demonstrably belongs to another gang-sheet app. */
export function isForeignAppLine(lineItem: {
  properties?: LineItemProperty[] | Record<string, unknown> | null
}): boolean {
  for (const { name, value } of normalizeProperties(lineItem)) {
    if (FOREIGN_APP_PROPERTY_NAMES.has(name)) return true
    if (typeof value === 'string' && value.includes(FOREIGN_APP_VALUE_MARKER)) return true
  }
  return false
}

/** Parse every upload id from a VIP/measured-checkout order note of the form
 *  "Custom pricing checkout for upload <id1>, <id2>". The old single-id
 *  regex silently dropped all but the first upload on multi-item orders. */
export function extractVipUploadIdsFromOrderNote(note: unknown): string[] {
  const match = String(note || '').match(
    /(?:VIP|Custom pricing) checkout for upload ([a-z0-9 ,_-]+)/i
  )
  if (!match) return []
  return match[1]
    .split(/[,\s]+/)
    .map((token) => token.trim())
    .filter((token) => UPLOAD_ID_PATTERN.test(token))
}

function normalizeProperties(lineItem: {
  properties?: LineItemProperty[] | Record<string, unknown> | null
}): Array<{ name: string; value: unknown }> {
  const raw = lineItem?.properties
  if (Array.isArray(raw)) {
    return raw.filter((p) => p && typeof p.name === 'string')
  }
  if (raw && typeof raw === 'object') {
    return Object.entries(raw).map(([name, value]) => ({ name, value }))
  }
  return []
}

/** Resolve the uploadId carried by one order line item, trying each carrier
 *  in order of directness. Returns null when the line has no upload. */
export function matchUploadFromLineItem(lineItem: {
  properties?: LineItemProperty[] | Record<string, unknown> | null
}): UploadMatch | null {
  const properties = normalizeProperties(lineItem)
  const byName = new Map(properties.map((p) => [p.name, p.value]))

  for (const propertyName of LEGACY_ID_PROPERTIES) {
    const legacy = byName.get(propertyName)
    if (isPlausibleUploadId(legacy)) {
      return { uploadId: legacy, source: 'property' }
    }
  }

  const identityId = extractUploadIdFromIdentityUrl(byName.get(IDENTITY_PROPERTY))
  if (identityId) {
    return { uploadId: identityId, source: 'identity_url' }
  }

  const fileId = extractUploadIdFromFileUrl(byName.get(FILE_PROPERTY))
  if (fileId) {
    return { uploadId: fileId, source: 'file_url' }
  }

  // Last resort: scan every property value for an identity URL, so a renamed
  // property key still resolves as long as the URL value survived.
  for (const { value } of properties) {
    const scanned = extractUploadIdFromIdentityUrl(value)
    if (scanned) return { uploadId: scanned, source: 'identity_url' }
  }

  return null
}
