









const geoCache = new Map<string, { data: GeoInfo; timestamp: number }>()
const CACHE_TTL = 5 * 60 * 1000

export interface GeoInfo {
  country: string | null
  region: string | null
  city: string | null
  timezone: string | null
  ip: string | null
}





export function extractGeoFromHeaders(request: Request): GeoInfo {
  const headers = request.headers

  return {

    country: headers.get('cf-ipcountry') || headers.get('x-country-code') || null,

    region: headers.get('cf-region') || headers.get('x-region') || null,

    city: headers.get('cf-ipcity') || headers.get('x-city') || null,

    timezone: headers.get('cf-timezone') || headers.get('x-timezone') || null,


    ip:
      headers.get('cf-connecting-ip') ||
      headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      headers.get('x-real-ip') ||
      null,
  }
}





export async function getGeoWithFallback(request: Request): Promise<GeoInfo> {

  const headerGeo = extractGeoFromHeaders(request)


  if (headerGeo.country) {
    return headerGeo
  }


  const ip = headerGeo.ip
  if (
    !ip ||
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip.startsWith('192.168.') ||
    ip.startsWith('10.')
  ) {

    return headerGeo
  }


  const cached = geoCache.get(ip)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data
  }


  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 2000)

    const response = await fetch(
      `http://ip-api.com/json/${ip}?fields=status,country,countryCode,regionName,city,timezone`,
      { signal: controller.signal }
    )
    clearTimeout(timeoutId)

    if (response.ok) {
      const data = await response.json()

      if (data.status === 'success') {
        const geoInfo: GeoInfo = {
          country: data.countryCode || null, // ISO 3166-1 alpha-2 (US, TR, DE)
          region: data.regionName || null,
          city: data.city || null,
          timezone: data.timezone || null,
          ip,
        }


        geoCache.set(ip, { data: geoInfo, timestamp: Date.now() })


        if (geoCache.size > 1000) {
          const now = Date.now()
          for (const [key, val] of geoCache.entries()) {
            if (now - val.timestamp > CACHE_TTL) {
              geoCache.delete(key)
            }
          }
        }

        return geoInfo
      }
    }
  } catch (error) {

    console.warn(
      '[Geo] IP lookup failed:',
      error instanceof Error ? error.message : 'Unknown error'
    )
  }


  return headerGeo
}




export function classifyReferrerType(referrerDomain: string | null): string {
  if (!referrerDomain) return 'direct'

  const domain = referrerDomain.toLowerCase()


  const searchEngines = [
    'google',
    'bing',
    'yahoo',
    'duckduckgo',
    'baidu',
    'yandex',
    'ecosia',
    'ask',
    'aol',
  ]
  if (searchEngines.some((se) => domain.includes(se))) {
    return 'organic_search'
  }


  const socialMedia = [
    'facebook',
    'instagram',
    'twitter',
    'x.com',
    'linkedin',
    'pinterest',
    'tiktok',
    'snapchat',
    'reddit',
    'youtube',
    'whatsapp',
    'telegram',
    'discord',
  ]
  if (socialMedia.some((sm) => domain.includes(sm))) {
    return 'social'
  }


  const emailProviders = [
    'mail.google',
    'outlook',
    'yahoo.com/mail',
    'mail.yahoo',
    'protonmail',
    'zoho',
    'icloud',
    'aol.com/mail',
  ]
  if (emailProviders.some((ep) => domain.includes(ep))) {
    return 'email'
  }


  return 'referral'
}




export function parseReferrer(referrer: string | null): {
  referrer: string | null
  referrerDomain: string | null
} {
  if (!referrer) {
    return { referrer: null, referrerDomain: null }
  }

  try {
    const url = new URL(referrer)
    return {
      referrer,
      referrerDomain: url.hostname.replace(/^www\./, ''),
    }
  } catch {
    return { referrer, referrerDomain: null }
  }
}




export function extractUtmParams(url: string | URL): {
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  utmTerm: string | null
  utmContent: string | null
  gclid: string | null
  fbclid: string | null
  msclkid: string | null
  ttclid: string | null
} {
  try {
    const urlObj = typeof url === 'string' ? new URL(url) : url
    const params = urlObj.searchParams

    return {
      utmSource: params.get('utm_source'),
      utmMedium: params.get('utm_medium'),
      utmCampaign: params.get('utm_campaign'),
      utmTerm: params.get('utm_term'),
      utmContent: params.get('utm_content'),
      gclid: params.get('gclid'),
      fbclid: params.get('fbclid'),
      msclkid: params.get('msclkid'),
      ttclid: params.get('ttclid'),
    }
  } catch {
    return {
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmTerm: null,
      utmContent: null,
      gclid: null,
      fbclid: null,
      msclkid: null,
      ttclid: null,
    }
  }
}




export function determineReferrerType(
  referrerDomain: string | null,
  utmMedium: string | null,
  gclid: string | null,
  fbclid: string | null,
  msclkid: string | null,
  ttclid: string | null
): string {

  if (gclid) return 'paid_search'
  if (fbclid) return 'paid_social'
  if (msclkid) return 'paid_search'
  if (ttclid) return 'paid_social'


  if (utmMedium) {
    const medium = utmMedium.toLowerCase()
    if (medium === 'cpc' || medium === 'ppc' || medium === 'paid') {
      return 'paid_search'
    }
    if (medium === 'email' || medium === 'newsletter') {
      return 'email'
    }
    if (medium === 'social' || medium === 'sm') {
      return 'social'
    }
    if (medium === 'organic') {
      return 'organic_search'
    }
    if (medium === 'referral' || medium === 'affiliate') {
      return 'referral'
    }
  }


  return classifyReferrerType(referrerDomain)
}
