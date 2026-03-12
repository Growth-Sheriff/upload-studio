/**
 * Upload Studio - Consent Management Module
 * GDPR/CCPA compliant consent banner for visitor tracking
 *
 * @version 1.0.0
 * @module ul-consent
 *
 * ⚠️ ADDITIVE ONLY - Does NOT modify existing upload/cart flows
 *
 * Usage:
 * 1. Include this script in your theme
 * 2. Customize the banner text via data attributes or ULConsent.config()
 * 3. The banner will auto-show if consent hasn't been given
 *
 * Events:
 * - ul:consent:given - Fired when user accepts tracking
 * - ul:consent:denied - Fired when user declines tracking
 * - ul:consent:changed - Fired on any consent change
 */

;(function () {
  'use strict'

  // Prevent multiple initializations
  if (window.ULConsent) return

  // ═══════════════════════════════════════════════════════════════════════════
  // CONFIGURATION
  // ═══════════════════════════════════════════════════════════════════════════

  const DEFAULT_CONFIG = {
    // Storage key
    storageKey: 'ul_consent',
    storageTimestampKey: 'ul_consent_timestamp',

    // Banner settings
    position: 'bottom', // 'bottom' | 'top'
    showOnLoad: true,
    autoHideDelay: 0, // 0 = don't auto-hide

    // Consent expiry (days) - re-ask after this period
    expiryDays: 365,

    // Text content (can be overridden)
    text: {
      title: 'We value your privacy',
      message:
        'We use cookies and similar technologies to improve your experience, analyze traffic, and personalize content. By clicking "Accept", you consent to our use of these technologies.',
      acceptButton: 'Accept',
      declineButton: 'Decline',
      learnMoreLink: '/pages/privacy-policy',
      learnMoreText: 'Learn more',
    },

    // Styling
    theme: {
      backgroundColor: '#ffffff',
      textColor: '#1a1a1a',
      borderColor: '#e5e5e5',
      acceptButtonBg: '#2563eb',
      acceptButtonColor: '#ffffff',
      declineButtonBg: 'transparent',
      declineButtonColor: '#6b7280',
      linkColor: '#2563eb',
      shadowColor: 'rgba(0,0,0,0.1)',
    },

    // Callbacks
    onAccept: null,
    onDecline: null,
    onChange: null,
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STORAGE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  const Storage = {
    get(key) {
      try {
        return localStorage.getItem(key)
      } catch (e) {
        return null
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value)
        return true
      } catch (e) {
        return false
      }
    },
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN CONSENT MODULE
  // ═══════════════════════════════════════════════════════════════════════════

  const ULConsent = {
    config: { ...DEFAULT_CONFIG },
    bannerElement: null,
    initialized: false,

    /**
     * Configure the consent module
     * @param {object} options - Configuration options
     */
    configure(options = {}) {
      // Deep merge for nested objects
      this.config = {
        ...this.config,
        ...options,
        text: { ...this.config.text, ...(options.text || {}) },
        theme: { ...this.config.theme, ...(options.theme || {}) },
      }
      return this
    },

    /**
     * Initialize the consent module
     */
    init() {
      if (this.initialized) return this

      // Check if consent already given and not expired
      const consentStatus = this.getConsentStatus()

      if (consentStatus === null && this.config.showOnLoad) {
        // No consent recorded, show banner
        this.showBanner()
      }

      this.initialized = true
      return this
    },

    /**
     * Get current consent status
     * @returns {boolean|null} - true if accepted, false if declined, null if not set
     */
    getConsentStatus() {
      const consent = Storage.get(this.config.storageKey)
      const timestamp = Storage.get(this.config.storageTimestampKey)

      if (consent === null) return null

      // Check expiry
      if (timestamp) {
        const expiryMs = this.config.expiryDays * 24 * 60 * 60 * 1000
        const consentDate = parseInt(timestamp, 10)
        if (Date.now() - consentDate > expiryMs) {
          // Consent expired, clear and return null
          this.clearConsent()
          return null
        }
      }

      return consent === 'true'
    },

    /**
     * Check if user has given consent
     * @returns {boolean}
     */
    hasConsent() {
      return this.getConsentStatus() === true
    },

    /**
     * Set consent status
     * @param {boolean} given - Whether consent was given
     */
    setConsent(given) {
      const status = given ? 'true' : 'false'
      Storage.set(this.config.storageKey, status)
      Storage.set(this.config.storageTimestampKey, Date.now().toString())

      // Also sync with ULVisitor if available
      if (window.ULVisitor?.setConsent) {
        window.ULVisitor.setConsent(given)
      }

      // Fire events
      const eventDetail = { consent: given, timestamp: Date.now() }

      window.dispatchEvent(new CustomEvent('ul:consent:changed', { detail: eventDetail }))

      if (given) {
        window.dispatchEvent(new CustomEvent('ul:consent:given', { detail: eventDetail }))
        if (typeof this.config.onAccept === 'function') {
          this.config.onAccept(eventDetail)
        }
      } else {
        window.dispatchEvent(new CustomEvent('ul:consent:denied', { detail: eventDetail }))
        if (typeof this.config.onDecline === 'function') {
          this.config.onDecline(eventDetail)
        }
      }

      if (typeof this.config.onChange === 'function') {
        this.config.onChange(eventDetail)
      }

      return this
    },

    /**
     * Accept consent
     */
    accept() {
      this.setConsent(true)
      this.hideBanner()
      return this
    },

    /**
     * Decline consent
     */
    decline() {
      this.setConsent(false)
      this.hideBanner()
      return this
    },

    /**
     * Clear consent (for re-asking)
     */
    clearConsent() {
      try {
        localStorage.removeItem(this.config.storageKey)
        localStorage.removeItem(this.config.storageTimestampKey)
      } catch (e) {
        // Ignore
      }
      return this
    },

    /**
     * Show the consent banner
     */
    showBanner() {
      if (this.bannerElement) return this

      this.bannerElement = this.createBannerElement()
      document.body.appendChild(this.bannerElement)

      // Animate in
      requestAnimationFrame(() => {
        this.bannerElement.style.transform = 'translateY(0)'
        this.bannerElement.style.opacity = '1'
      })

      return this
    },

    /**
     * Hide the consent banner
     */
    hideBanner() {
      if (!this.bannerElement) return this

      this.bannerElement.style.transform =
        this.config.position === 'bottom' ? 'translateY(100%)' : 'translateY(-100%)'
      this.bannerElement.style.opacity = '0'

      setTimeout(() => {
        if (this.bannerElement && this.bannerElement.parentNode) {
          this.bannerElement.parentNode.removeChild(this.bannerElement)
        }
        this.bannerElement = null
      }, 300)

      return this
    },

    /**
     * Create the banner DOM element
     */
    createBannerElement() {
      const { text, theme, position } = this.config

      const banner = document.createElement('div')
      banner.id = 'ul-consent-banner'
      banner.setAttribute('role', 'dialog')
      banner.setAttribute('aria-labelledby', 'ul-consent-title')
      banner.setAttribute('aria-describedby', 'ul-consent-message')

      const positionStyles =
        position === 'bottom'
          ? 'bottom: 0; transform: translateY(100%);'
          : 'top: 0; transform: translateY(-100%);'

      banner.innerHTML = `
        <style>
          #ul-consent-banner {
            position: fixed;
            left: 0;
            right: 0;
            ${positionStyles}
            z-index: 999999;
            background: ${theme.backgroundColor};
            border-${position === 'bottom' ? 'top' : 'bottom'}: 1px solid ${theme.borderColor};
            box-shadow: 0 ${position === 'bottom' ? '-4px' : '4px'} 20px ${theme.shadowColor};
            padding: 16px 24px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            transition: transform 0.3s ease, opacity 0.3s ease;
            opacity: 0;
          }

          #ul-consent-banner * {
            box-sizing: border-box;
          }

          .ul-consent-container {
            max-width: 1200px;
            margin: 0 auto;
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 16px;
          }

          .ul-consent-content {
            flex: 1;
            min-width: 300px;
          }

          .ul-consent-title {
            margin: 0 0 4px 0;
            font-size: 16px;
            font-weight: 600;
            color: ${theme.textColor};
          }

          .ul-consent-message {
            margin: 0;
            font-size: 14px;
            color: ${theme.textColor};
            opacity: 0.85;
            line-height: 1.5;
          }

          .ul-consent-link {
            color: ${theme.linkColor};
            text-decoration: none;
          }

          .ul-consent-link:hover {
            text-decoration: underline;
          }

          .ul-consent-buttons {
            display: flex;
            gap: 12px;
            flex-shrink: 0;
          }

          .ul-consent-btn {
            padding: 10px 24px;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s ease;
            border: none;
          }

          .ul-consent-btn-accept {
            background: ${theme.acceptButtonBg};
            color: ${theme.acceptButtonColor};
          }

          .ul-consent-btn-accept:hover {
            filter: brightness(1.1);
          }

          .ul-consent-btn-decline {
            background: ${theme.declineButtonBg};
            color: ${theme.declineButtonColor};
            border: 1px solid ${theme.borderColor};
          }

          .ul-consent-btn-decline:hover {
            background: ${theme.borderColor};
          }

          @media (max-width: 600px) {
            #ul-consent-banner {
              padding: 12px 16px;
            }

            .ul-consent-container {
              flex-direction: column;
              align-items: stretch;
            }

            .ul-consent-content {
              min-width: 100%;
            }

            .ul-consent-buttons {
              justify-content: stretch;
            }

            .ul-consent-btn {
              flex: 1;
              text-align: center;
            }
          }
        </style>

        <div class="ul-consent-container">
          <div class="ul-consent-content">
            <h3 class="ul-consent-title" id="ul-consent-title">${text.title}</h3>
            <p class="ul-consent-message" id="ul-consent-message">
              ${text.message}
              ${text.learnMoreLink ? `<a href="${text.learnMoreLink}" class="ul-consent-link" target="_blank">${text.learnMoreText}</a>` : ''}
            </p>
          </div>
          <div class="ul-consent-buttons">
            <button class="ul-consent-btn ul-consent-btn-decline" type="button">${text.declineButton}</button>
            <button class="ul-consent-btn ul-consent-btn-accept" type="button">${text.acceptButton}</button>
          </div>
        </div>
      `

      // Bind events
      const acceptBtn = banner.querySelector('.ul-consent-btn-accept')
      const declineBtn = banner.querySelector('.ul-consent-btn-decline')

      acceptBtn.addEventListener('click', () => this.accept())
      declineBtn.addEventListener('click', () => this.decline())

      return banner
    },
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTO-INITIALIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  // Don't auto-show if ULVisitor already has consent recorded
  if (window.ULVisitor?.hasConsent?.()) {
    ULConsent.config.showOnLoad = false
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ULConsent.init())
  } else {
    // Small delay to let ULVisitor initialize first
    setTimeout(() => ULConsent.init(), 100)
  }

  // Expose globally
  window.ULConsent = ULConsent

  console.log('[ULConsent] Module loaded')
})()
