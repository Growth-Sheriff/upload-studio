/** Navigation hints only. These values never authenticate a request or select tenant data. */
export function recoveryShopDomain(value: unknown): string | null {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(value)
    ? value.toLowerCase() : null
}

export function recoveryAppPath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/app'
  const url = new URL(value, 'https://app.invalid')
  // Never carry an old id_token, host or arbitrary query into a new authentication flow.
  return url.origin === 'https://app.invalid' && /^\/app(?:\/|$)/.test(url.pathname) ? url.pathname : '/app'
}

/** Shopify's embedded billing return URL, built without trusting an incoming host parameter. */
export function shopifyAdminReopenUrl(shop: unknown, apiKey: unknown, returnTo: unknown = '/app'): string | null {
  const domain = recoveryShopDomain(shop)
  if (!domain || typeof apiKey !== 'string' || !/^[a-f0-9]{32}$/i.test(apiKey)) return null
  return `https://admin.shopify.com/store/${domain.replace('.myshopify.com', '')}/apps/${apiKey}${recoveryAppPath(returnTo)}`
}

export function isMissingAdminTokenXHR(request: Request): boolean {
  return !request.headers.get('Authorization')?.trim()
    && request.headers.get('X-Requested-With')?.toLowerCase() === 'xmlhttprequest'
}
