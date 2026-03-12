/**
 * Upload Studio - Visitor Tracking Module
 * Cross-session visitor identification and attribution tracking
 *
 * @version 1.0.0
 * @module ul-visitor
 *
 * ⚠️ ADDITIVE ONLY - Does NOT modify existing upload/cart flows
 */

;(function () {
  'use strict'

  // Prevent multiple initializations
  if (window.ULVisitor) return

  // ═══════════════════════════════════════════════════════════════════════════
  // CONFIGURATION
  // ═══════════════════════════════════════════════════════════════════════════

  const CONFIG = {
    API_BASE: '/apps/customizer/api/v1',
    STORAGE_KEYS: {
      VISITOR_ID: 'ul_visitor_id',
      SESSION_ID: 'ul_session_id',
      LOCAL_ID: 'ul_local_id',
      SESSION_TOKEN: 'ul_session_token',
      FINGERPRINT: 'ul_fingerprint',
      CONSENT: 'ul_consent',
      FIRST_TOUCH: 'ul_first_touch',
    },
    SESSION_TIMEOUT: 30 * 60 * 1000, // 30 minutes
    DEBUG: false,
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITY FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  function log(...args) {
    if (CONFIG.DEBUG) {
      console.log('[ULVisitor]', ...args)
    }
  }

  function generateUUID() {
    if (crypto.randomUUID) {
      return crypto.randomUUID()
    }
    // Fallback for older browsers
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0
      const v = c === 'x' ? r : (r & 0x3) | 0x8
      return v.toString(16)
    })
  }

  function getShopDomain() {
    return (
      window.Shopify?.shop ||
      document.querySelector('[data-shop-domain]')?.dataset.shopDomain ||
      document.querySelector('meta[name="shopify-shop"]')?.content ||
      null
    )
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STORAGE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  const Storage = {
    get(key) {
      try {
        return localStorage.getItem(key)
      } catch (e) {
        log('Storage get error:', e)
        return null
      }
    },

    set(key, value) {
      try {
        localStorage.setItem(key, value)
        return true
      } catch (e) {
        log('Storage set error:', e)
        return false
      }
    },

    getJSON(key) {
      try {
        const value = localStorage.getItem(key)
        return value ? JSON.parse(value) : null
      } catch (e) {
        return null
      }
    },

    setJSON(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value))
        return true
      } catch (e) {
        return false
      }
    },

    getSession(key) {
      try {
        return sessionStorage.getItem(key)
      } catch (e) {
        return null
      }
    },

    setSession(key, value) {
      try {
        sessionStorage.setItem(key, value)
        return true
      } catch (e) {
        return false
      }
    },
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ATTRIBUTION TRACKING
  // ═══════════════════════════════════════════════════════════════════════════

  const Attribution = {
    /**
     * Extract UTM parameters from current URL
     */
    getUtmParams() {
      const params = new URLSearchParams(window.location.search)
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
    },

    /**
     * Get referrer information
     */
    getReferrer() {
      const referrer = document.referrer || null
      let referrerDomain = null

      if (referrer) {
        try {
          referrerDomain = new URL(referrer).hostname.replace(/^www\./, '')
        } catch (e) {
          // Invalid URL
        }
      }

      return { referrer, referrerDomain }
    },

    /**
     * Get full attribution data
     */
    getData() {
      const utm = this.getUtmParams()
      const ref = this.getReferrer()

      return {
        ...utm,
        referrer: ref.referrer,
        landingPage: window.location.href,
      }
    },

    /**
     * Save first-touch attribution (only on first visit)
     */
    saveFirstTouch() {
      const existing = Storage.getJSON(CONFIG.STORAGE_KEYS.FIRST_TOUCH)
      if (existing) return existing

      const data = {
        ...this.getData(),
        timestamp: Date.now(),
      }

      Storage.setJSON(CONFIG.STORAGE_KEYS.FIRST_TOUCH, data)
      return data
    },
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DEVICE INFO
  // ═══════════════════════════════════════════════════════════════════════════

  const Device = {
    getInfo() {
      const ua = navigator.userAgent

      return {
        deviceType: this.getDeviceType(),
        browser: this.getBrowser(ua),
        browserVersion: this.getBrowserVersion(ua),
        os: this.getOS(ua),
        osVersion: this.getOSVersion(ua),
        screenResolution: `${screen.width}x${screen.height}`,
        language: navigator.language || navigator.userLanguage,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }
    },

    getDeviceType() {
      const ua = navigator.userAgent
      if (/tablet|ipad|playbook|silk/i.test(ua)) return 'tablet'
      if (/mobile|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua)) return 'mobile'
      return 'desktop'
    },

    getBrowser(ua) {
      if (ua.includes('Firefox')) return 'Firefox'
      if (ua.includes('SamsungBrowser')) return 'Samsung'
      if (ua.includes('Opera') || ua.includes('OPR')) return 'Opera'
      if (ua.includes('Edge')) return 'Edge'
      if (ua.includes('Chrome')) return 'Chrome'
      if (ua.includes('Safari')) return 'Safari'
      if (ua.includes('MSIE') || ua.includes('Trident')) return 'IE'
      return 'Unknown'
    },

    getBrowserVersion(ua) {
      const match = ua.match(/(firefox|chrome|safari|opera|edge|msie|rv:)[\s/:]?([\d.]+)/i)
      return match ? match[2] : null
    },

    getOS(ua) {
      if (ua.includes('Windows')) return 'Windows'
      if (ua.includes('Mac OS')) return 'macOS'
      if (ua.includes('Linux')) return 'Linux'
      if (ua.includes('Android')) return 'Android'
      if (ua.includes('iOS') || ua.includes('iPhone') || ua.includes('iPad')) return 'iOS'
      return 'Unknown'
    },

    getOSVersion(ua) {
      let match
      if ((match = ua.match(/Windows NT ([\d.]+)/))) return match[1]
      if ((match = ua.match(/Mac OS X ([\d_]+)/))) return match[1].replace(/_/g, '.')
      if ((match = ua.match(/Android ([\d.]+)/))) return match[1]
      if ((match = ua.match(/OS ([\d_]+) like Mac OS X/))) return match[1].replace(/_/g, '.')
      return null
    },
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SIMPLE FINGERPRINT (No external library)
  // ═══════════════════════════════════════════════════════════════════════════

  const Fingerprint = {
    /**
     * Generate a simple fingerprint hash
     * Not as accurate as FingerprintJS Pro, but privacy-friendly
     */
    async generate() {
      // Check stored fingerprint first
      const stored = Storage.get(CONFIG.STORAGE_KEYS.FINGERPRINT)
      if (stored) return stored

      const components = [
        navigator.userAgent,
        navigator.language,
        screen.width + 'x' + screen.height,
        screen.colorDepth,
        new Date().getTimezoneOffset(),
        navigator.hardwareConcurrency || 'unknown',
        navigator.deviceMemory || 'unknown',
        this.getCanvasFingerprint(),
      ]

      const fingerprint = await this.hash(components.join('|'))
      Storage.set(CONFIG.STORAGE_KEYS.FINGERPRINT, fingerprint)

      return fingerprint
    },

    getCanvasFingerprint() {
      try {
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        if (!ctx) return 'no-canvas'

        ctx.textBaseline = 'top'
        ctx.font = '14px Arial'
        ctx.fillText('UL fingerprint', 2, 2)
        ctx.fillStyle = '#f60'
        ctx.fillRect(100, 1, 62, 20)

        return canvas.toDataURL().slice(-50)
      } catch (e) {
        return 'canvas-error'
      }
    },

    async hash(str) {
      if (crypto.subtle) {
        const encoder = new TextEncoder()
        const data = encoder.encode(str)
        const hashBuffer = await crypto.subtle.digest('SHA-256', data)
        const hashArray = Array.from(new Uint8Array(hashBuffer))
        return hashArray
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
          .slice(0, 32)
      }
      // Fallback: simple hash
      let hash = 0
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i)
        hash = (hash << 5) - hash + char
        hash = hash & hash
      }
      return Math.abs(hash).toString(16).padStart(8, '0')
    },
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SESSION MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  const Session = {
    /**
     * Get or create session token
     */
    getToken() {
      let token = Storage.getSession(CONFIG.STORAGE_KEYS.SESSION_TOKEN)

      if (!token) {
        token = generateUUID()
        Storage.setSession(CONFIG.STORAGE_KEYS.SESSION_TOKEN, token)
      }

      return token
    },

    /**
     * Get localStorage ID (persistent across sessions)
     */
    getLocalId() {
      let localId = Storage.get(CONFIG.STORAGE_KEYS.LOCAL_ID)

      if (!localId) {
        localId = generateUUID()
        Storage.set(CONFIG.STORAGE_KEYS.LOCAL_ID, localId)
      }

      return localId
    },
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN VISITOR MODULE
  // ═══════════════════════════════════════════════════════════════════════════

  const ULVisitor = {
    // State
    visitorId: null,
    sessionId: null,
    initialized: false,

    /**
     * Initialize visitor tracking
     */
    async init() {
      if (this.initialized) return

      const shopDomain = getShopDomain()
      if (!shopDomain) {
        log('Shop domain not found, skipping init')
        return
      }

      log('Initializing visitor tracking for:', shopDomain)

      try {
        // Get identity components
        const localStorageId = Session.getLocalId()
        const sessionToken = Session.getToken()
        const fingerprint = await Fingerprint.generate()
        const device = Device.getInfo()
        const attribution = Attribution.getData()

        // Save first-touch attribution
        Attribution.saveFirstTouch()

        // Send to API
        const response = await fetch(`${CONFIG.API_BASE}/visitors`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shopDomain,
            identity: {
              localStorageId,
              sessionToken,
              fingerprint,
            },
            device,
            attribution,
          }),
        })

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`)
        }

        const data = await response.json()

        if (data.success) {
          this.visitorId = data.visitorId
          this.sessionId = data.sessionId

          // Store IDs locally
          Storage.set(CONFIG.STORAGE_KEYS.VISITOR_ID, data.visitorId)
          Storage.setSession(CONFIG.STORAGE_KEYS.SESSION_ID, data.sessionId)

          log('Visitor identified:', {
            visitorId: this.visitorId,
            sessionId: this.sessionId,
            isNewVisitor: data.isNewVisitor,
            isNewSession: data.isNewSession,
          })

          // Dispatch event for other modules
          window.dispatchEvent(
            new CustomEvent('ul:visitor:identified', {
              detail: {
                visitorId: this.visitorId,
                sessionId: this.sessionId,
                isNewVisitor: data.isNewVisitor,
                isNewSession: data.isNewSession,
              },
            })
          )
        }

        this.initialized = true
      } catch (error) {
        log('Init error:', error)
        // Don't break the page on error - visitor tracking is non-critical
      }
    },

    /**
     * Get current visitor ID
     */
    getVisitorId() {
      return this.visitorId || Storage.get(CONFIG.STORAGE_KEYS.VISITOR_ID)
    },

    /**
     * Get current session ID
     */
    getSessionId() {
      return this.sessionId || Storage.getSession(CONFIG.STORAGE_KEYS.SESSION_ID)
    },

    /**
     * Track page view
     */
    async trackPageView() {
      const sessionId = this.getSessionId()
      const shopDomain = getShopDomain()

      if (!sessionId || !shopDomain) return

      try {
        await fetch(`${CONFIG.API_BASE}/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shopDomain,
            sessionId,
            action: 'page_view',
          }),
        })
      } catch (e) {
        log('Page view tracking error:', e)
      }
    },

    /**
     * Track add to cart event
     */
    async trackAddToCart() {
      const sessionId = this.getSessionId()
      const shopDomain = getShopDomain()

      if (!sessionId || !shopDomain) return

      try {
        await fetch(`${CONFIG.API_BASE}/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shopDomain,
            sessionId,
            action: 'add_to_cart',
          }),
        })
        log('Add to cart tracked')
      } catch (e) {
        log('Add to cart tracking error:', e)
      }
    },

    /**
     * Link upload to visitor
     */
    async linkUpload(uploadId) {
      const sessionId = this.getSessionId()
      const visitorId = this.getVisitorId()
      const shopDomain = getShopDomain()

      if (!sessionId || !uploadId || !shopDomain) return

      try {
        await fetch(`${CONFIG.API_BASE}/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shopDomain,
            sessionId,
            visitorId,
            action: 'link_upload',
            uploadId,
          }),
        })
        log('Upload linked:', uploadId)
      } catch (e) {
        log('Upload link error:', e)
      }
    },

    /**
     * Get first-touch attribution data
     */
    getFirstTouchAttribution() {
      return Storage.getJSON(CONFIG.STORAGE_KEYS.FIRST_TOUCH)
    },

    /**
     * Get current session attribution
     */
    getCurrentAttribution() {
      return Attribution.getData()
    },

    /**
     * Check if visitor gave consent
     */
    hasConsent() {
      return Storage.get(CONFIG.STORAGE_KEYS.CONSENT) === 'true'
    },

    /**
     * Set consent status
     */
    setConsent(given) {
      Storage.set(CONFIG.STORAGE_KEYS.CONSENT, given ? 'true' : 'false')
      log('Consent set:', given)
    },

    /**
     * Enable debug mode
     */
    debug(enabled = true) {
      CONFIG.DEBUG = enabled
      log('Debug mode:', enabled ? 'ON' : 'OFF')
    },
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTO-INITIALIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ULVisitor.init())
  } else {
    ULVisitor.init()
  }

  // Listen for upload complete events (from dtf-uploader.js)
  window.addEventListener('ul:upload:complete', (e) => {
    if (e.detail?.uploadId) {
      ULVisitor.linkUpload(e.detail.uploadId)
    }
  })

  // Listen for add to cart events
  window.addEventListener('ul:cart:add', () => {
    ULVisitor.trackAddToCart()
  })

  // Expose globally
  window.ULVisitor = ULVisitor

  log('ULVisitor module loaded')
})()
