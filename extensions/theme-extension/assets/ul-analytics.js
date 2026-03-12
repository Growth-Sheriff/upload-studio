/**
 * UL Analytics v4.1.0
 * ====================
 * FAZ 8: Analytics & Tracking Module
 * 
 * Features:
 * - Centralized event tracking
 * - Event queue with batching
 * - Multiple destinations (Shopify, Webhook, GA4, Meta)
 * - Session tracking
 * - Performance metrics
 * - Error tracking integration
 * 
 * Events follow naming convention: ul_{component}_{action}
 * 
 * Usage:
 * - ULAnalytics.track('dtf_upload_started', { fileName: 'design.png' });
 * - ULAnalytics.trackTiming('upload', startTime);
 * - ULAnalytics.setUser({ shopDomain: 'store.myshopify.com' });
 */

(function() {
  'use strict';

  // ==========================================================================
  // ANALYTICS MODULE
  // ==========================================================================
  const ULAnalytics = {
    version: '4.1.0',
    
    // Configuration
    config: {
      enabled: true,
      debug: false,
      batchSize: 10,
      batchInterval: 5000, // 5 seconds
      webhookUrl: null,
      ga4Enabled: false,
      metaPixelEnabled: false,
      shopifyEnabled: true
    },
    
    // Session data
    session: {
      id: null,
      startTime: null,
      shopDomain: null,
      productId: null,
      customerId: null,
      pageUrl: null
    },
    
    // Event queue for batching
    queue: [],
    batchTimer: null,
    
    // Performance tracking
    timings: {},

    // ==========================================================================
    // INITIALIZATION
    // ==========================================================================
    
    init(options = {}) {
      // Merge options
      Object.assign(this.config, options);
      
      // Generate session ID
      this.session.id = this.generateSessionId();
      this.session.startTime = Date.now();
      this.session.pageUrl = window.location.href;
      
      // Extract shop domain from page
      this.session.shopDomain = this.extractShopDomain();
      
      // Start batch timer
      if (this.config.batchSize > 1) {
        this.startBatchTimer();
      }
      
      // Listen to ULEvents (FAZ 4 integration)
      this.bindGlobalEvents();
      
      // Track page view
      this.track('page_view', {
        url: window.location.href,
        referrer: document.referrer
      });
      
      console.log('[ULAnalytics] Initialized v4.1.0', {
        sessionId: this.session.id,
        shopDomain: this.session.shopDomain
      });
    },
    
    // ==========================================================================
    // CORE TRACKING API
    // ==========================================================================
    
    /**
     * Track an event
     * @param {string} eventName - Event name (will be prefixed with ul_)
     * @param {object} properties - Event properties
     */
    track(eventName, properties = {}) {
      if (!this.config.enabled) return;
      
      const event = this.buildEvent(eventName, properties);
      
      if (this.config.debug) {
        console.log('[ULAnalytics] Track:', event);
      }
      
      // Add to queue
      this.queue.push(event);
      
      // Flush immediately if not batching or queue is full
      if (this.config.batchSize <= 1 || this.queue.length >= this.config.batchSize) {
        this.flush();
      }
      
      // Emit for external listeners
      this.emit('track', event);
      
      return event;
    },
    
    /**
     * Track timing/performance
     * @param {string} name - Timing name
     * @param {number} startTime - Start timestamp
     */
    trackTiming(name, startTime) {
      const duration = Date.now() - startTime;
      
      this.track(`timing_${name}`, {
        duration,
        name
      });
      
      return duration;
    },
    
    /**
     * Start a timing measurement
     * @param {string} name - Timing name
     */
    startTiming(name) {
      this.timings[name] = Date.now();
    },
    
    /**
     * End a timing measurement and track it
     * @param {string} name - Timing name
     */
    endTiming(name) {
      if (this.timings[name]) {
        const duration = this.trackTiming(name, this.timings[name]);
        delete this.timings[name];
        return duration;
      }
      return 0;
    },
    
    /**
     * Set user/session properties
     * @param {object} properties - User properties
     */
    setUser(properties) {
      Object.assign(this.session, properties);
    },
    
    /**
     * Set product context
     * @param {string} productId - Product ID
     */
    setProduct(productId) {
      this.session.productId = productId;
    },

    // ==========================================================================
    // EVENT BUILDERS - DTF UPLOADER
    // ==========================================================================
    
    // Upload started
    trackDTFUploadStarted(data = {}) {
      return this.track('dtf_upload_started', {
        fileName: data.fileName,
        fileSize: data.fileSize,
        fileType: data.fileType,
        productId: data.productId || this.session.productId
      });
    },
    
    // Upload completed
    trackDTFUploadCompleted(data = {}) {
      return this.track('dtf_upload_completed', {
        uploadId: data.uploadId,
        fileName: data.fileName,
        fileSize: data.fileSize,
        width: data.width,
        height: data.height,
        dpi: data.dpi,
        duration: data.duration,
        productId: data.productId || this.session.productId
      });
    },
    
    // Upload failed
    trackDTFUploadFailed(data = {}) {
      return this.track('dtf_upload_failed', {
        fileName: data.fileName,
        errorCode: data.errorCode,
        errorMessage: data.errorMessage,
        productId: data.productId || this.session.productId
      });
    },
    
    // Size selected
    trackDTFSizeSelected(data = {}) {
      return this.track('dtf_size_selected', {
        size: data.size,
        variantId: data.variantId,
        price: data.price,
        productId: data.productId || this.session.productId
      });
    },
    
    // Add to cart from DTF
    trackDTFAddToCart(data = {}) {
      return this.track('dtf_add_to_cart', {
        uploadId: data.uploadId,
        variantId: data.variantId,
        size: data.size,
        quantity: data.quantity,
        price: data.price,
        productId: data.productId || this.session.productId
      });
    },
    
    // Customize clicked (opens modal)
    trackDTFCustomizeClicked(data = {}) {
      return this.track('dtf_customize_clicked', {
        uploadId: data.uploadId,
        productId: data.productId || this.session.productId
      });
    },

    // ==========================================================================
    // EVENT BUILDERS - T-SHIRT MODAL
    // ==========================================================================
    
    // Modal opened
    trackTShirtModalOpened(data = {}) {
      this.startTiming('tshirt_modal_session');
      return this.track('tshirt_modal_opened', {
        hasInheritedDesign: data.hasInheritedDesign,
        source: data.source,
        productId: data.productId || this.session.productId
      });
    },
    
    // Modal closed
    trackTShirtModalClosed(data = {}) {
      const duration = this.endTiming('tshirt_modal_session');
      return this.track('tshirt_modal_closed', {
        stepReached: data.stepReached,
        completed: data.completed,
        duration,
        productId: data.productId || this.session.productId
      });
    },
    
    // Step completed
    trackTShirtStepCompleted(step, data = {}) {
      return this.track(`tshirt_step_${step}_completed`, {
        step,
        ...data
      });
    },
    
    // Color changed
    trackTShirtColorChanged(data = {}) {
      return this.track('tshirt_color_changed', {
        colorName: data.colorName,
        colorHex: data.colorHex,
        previousColor: data.previousColor
      });
    },
    
    // Size changed
    trackTShirtSizeChanged(data = {}) {
      return this.track('tshirt_size_changed', {
        size: data.size,
        previousSize: data.previousSize,
        priceDiff: data.priceDiff
      });
    },
    
    // Location toggled
    trackTShirtLocationToggled(data = {}) {
      return this.track('tshirt_location_toggled', {
        location: data.location,
        enabled: data.enabled,
        totalLocations: data.totalLocations
      });
    },
    
    // Design another clicked
    trackTShirtDesignAnother(data = {}) {
      return this.track('tshirt_design_another_clicked', {
        itemsAdded: data.itemsAdded
      });
    },
    
    // Checkout clicked from modal
    trackTShirtCheckout(data = {}) {
      return this.track('tshirt_checkout_clicked', {
        totalPrice: data.totalPrice,
        quantity: data.quantity,
        locations: data.locations
      });
    },
    
    // Add to cart from T-Shirt modal
    trackTShirtAddToCart(data = {}) {
      return this.track('tshirt_add_to_cart', {
        uploadId: data.uploadId,
        variantId: data.variantId,
        color: data.color,
        size: data.size,
        quantity: data.quantity,
        locations: data.locations,
        totalPrice: data.totalPrice,
        productId: data.productId || this.session.productId
      });
    },

    // ==========================================================================
    // EVENT BUILDERS - CONFIRMATION
    // ==========================================================================
    
    // Confirmation shown
    trackConfirmationShown(data = {}) {
      return this.track('confirmation_shown', {
        source: data.source,
        itemCount: data.itemCount,
        cartTotal: data.cartTotal
      });
    },
    
    // Proceed to checkout
    trackProceedCheckout(data = {}) {
      return this.track('proceed_checkout_clicked', {
        cartTotal: data.cartTotal,
        itemCount: data.itemCount
      });
    },
    
    // Continue shopping
    trackContinueShopping(data = {}) {
      return this.track('continue_shopping_clicked', {
        fromSource: data.fromSource
      });
    },

    // ==========================================================================
    // ERROR TRACKING (FAZ 7 Integration)
    // ==========================================================================
    
    trackError(data = {}) {
      return this.track('error_occurred', {
        errorCode: data.errorCode,
        errorType: data.errorType,
        errorMessage: data.errorMessage,
        component: data.component,
        recoverable: data.recoverable
      });
    },

    // ==========================================================================
    // DESTINATIONS
    // ==========================================================================
    
    /**
     * Flush event queue to all destinations
     */
    async flush() {
      if (this.queue.length === 0) return;
      
      const events = [...this.queue];
      this.queue = [];
      
      // Send to each destination
      const promises = [];
      
      // Shopify Analytics (native)
      if (this.config.shopifyEnabled) {
        promises.push(this.sendToShopify(events));
      }
      
      // Custom webhook
      if (this.config.webhookUrl) {
        promises.push(this.sendToWebhook(events));
      }
      
      // GA4
      if (this.config.ga4Enabled && window.gtag) {
        promises.push(this.sendToGA4(events));
      }
      
      // Meta Pixel
      if (this.config.metaPixelEnabled && window.fbq) {
        promises.push(this.sendToMeta(events));
      }
      
      await Promise.allSettled(promises);
    },
    
    /**
     * Send events to Shopify Analytics
     */
    async sendToShopify(events) {
      // Use Shopify's trekkie if available
      if (window.ShopifyAnalytics && window.ShopifyAnalytics.lib) {
        events.forEach(event => {
          try {
            window.ShopifyAnalytics.lib.track('Upload Studio', {
              eventName: event.event,
              ...event.properties
            });
          } catch (e) {
            if (this.config.debug) console.warn('[ULAnalytics] Shopify track error:', e);
          }
        });
      }
      
      // Also push to dataLayer for GTM
      if (window.dataLayer) {
        events.forEach(event => {
          window.dataLayer.push({
            event: `ul_${event.event}`,
            ul_event_id: event.id,
            ul_session_id: this.session.id,
            ...event.properties
          });
        });
      }
    },
    
    /**
     * Send events to custom webhook
     */
    async sendToWebhook(events) {
      if (!this.config.webhookUrl) return;
      
      try {
        await fetch(this.config.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session: this.session,
            events,
            timestamp: Date.now()
          })
        });
      } catch (e) {
        if (this.config.debug) console.warn('[ULAnalytics] Webhook error:', e);
      }
    },
    
    /**
     * Send events to Google Analytics 4
     */
    async sendToGA4(events) {
      if (!window.gtag) return;
      
      events.forEach(event => {
        try {
          window.gtag('event', `ul_${event.event}`, {
            event_category: 'Upload Studio',
            event_label: event.properties.productId || '',
            ...event.properties
          });
        } catch (e) {
          if (this.config.debug) console.warn('[ULAnalytics] GA4 error:', e);
        }
      });
    },
    
    /**
     * Send events to Meta Pixel
     */
    async sendToMeta(events) {
      if (!window.fbq) return;
      
      events.forEach(event => {
        try {
          // Map to standard Meta events where applicable
          const metaEventMap = {
            'dtf_add_to_cart': 'AddToCart',
            'tshirt_add_to_cart': 'AddToCart',
            'proceed_checkout_clicked': 'InitiateCheckout',
            'dtf_customize_clicked': 'CustomizeProduct'
          };
          
          const metaEvent = metaEventMap[event.event];
          
          if (metaEvent) {
            window.fbq('track', metaEvent, {
              content_type: 'product',
              content_ids: [event.properties.productId],
              value: event.properties.price || event.properties.totalPrice || 0,
              currency: 'USD'
            });
          } else {
            window.fbq('trackCustom', `UL_${event.event}`, event.properties);
          }
        } catch (e) {
          if (this.config.debug) console.warn('[ULAnalytics] Meta error:', e);
        }
      });
    },

    // ==========================================================================
    // GLOBAL EVENT BINDING (FAZ 4 Integration)
    // ==========================================================================
    
    bindGlobalEvents() {
      // Listen to ULEvents if available
      if (window.ULEvents) {
        // DTF Upload events
        window.ULEvents.on('uploadStart', (data) => {
          this.trackDTFUploadStarted(data);
        });
        
        window.ULEvents.on('uploadComplete', (data) => {
          this.trackDTFUploadCompleted(data);
        });
        
        window.ULEvents.on('uploadError', (data) => {
          this.trackDTFUploadFailed(data);
        });
        
        // Modal events
        window.ULEvents.on('modalOpen', (data) => {
          if (data.source === 'tshirt-modal') {
            this.trackTShirtModalOpened(data);
          }
        });
        
        window.ULEvents.on('modalClose', (data) => {
          if (data.source === 'tshirt-modal') {
            this.trackTShirtModalClosed(data);
          }
        });
        
        window.ULEvents.on('stepChange', (data) => {
          if (data.source === 'tshirt-modal' && data.step > 1) {
            this.trackTShirtStepCompleted(data.step - 1, data);
          }
        });
        
        // Color/size events
        window.ULEvents.on('colorChange', (data) => {
          this.trackTShirtColorChanged(data);
        });
        
        window.ULEvents.on('sizeChange', (data) => {
          this.trackTShirtSizeChanged(data);
        });
        
        // Cart events
        window.ULEvents.on('addToCart', (data) => {
          if (data.source === 'tshirt-modal') {
            this.trackTShirtAddToCart(data);
          } else {
            this.trackDTFAddToCart(data);
          }
        });
        
        // Error events (FAZ 7)
        window.ULEvents.on('ul:error', (data) => {
          this.trackError(data);
        });
        
        // Confirmation events
        window.ULEvents.on('showConfirmation', (data) => {
          this.trackConfirmationShown(data);
        });
      }
      
      // Also listen to DOM events
      document.addEventListener('ul:showConfirmation', (e) => {
        this.trackConfirmationShown(e.detail || {});
      });
      
      document.addEventListener('ul:addedToCart', (e) => {
        // Already tracked via ULEvents, but ensure coverage
      });
    },

    // ==========================================================================
    // UTILITIES
    // ==========================================================================
    
    buildEvent(eventName, properties) {
      return {
        id: this.generateEventId(),
        event: eventName,
        properties: {
          ...properties,
          sessionId: this.session.id,
          shopDomain: this.session.shopDomain,
          productId: properties.productId || this.session.productId
        },
        timestamp: Date.now(),
        url: window.location.href
      };
    },
    
    generateSessionId() {
      return 'ul_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
    },
    
    generateEventId() {
      return 'evt_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5);
    },
    
    extractShopDomain() {
      // Try to get from Shopify global
      if (window.Shopify && window.Shopify.shop) {
        return window.Shopify.shop;
      }
      // Try meta tag
      const meta = document.querySelector('meta[name="shopify-shop-domain"]');
      if (meta) return meta.content;
      // Fallback to hostname
      return window.location.hostname;
    },
    
    startBatchTimer() {
      this.batchTimer = setInterval(() => {
        if (this.queue.length > 0) {
          this.flush();
        }
      }, this.config.batchInterval);
    },
    
    stopBatchTimer() {
      if (this.batchTimer) {
        clearInterval(this.batchTimer);
        this.batchTimer = null;
      }
    },
    
    emit(eventName, data) {
      document.dispatchEvent(new CustomEvent(`ul:analytics:${eventName}`, {
        detail: data
      }));
    },
    
    /**
     * Enable debug mode
     */
    enableDebug() {
      this.config.debug = true;
      console.log('[ULAnalytics] Debug mode enabled');
    },
    
    /**
     * Disable tracking
     */
    disable() {
      this.config.enabled = false;
      this.stopBatchTimer();
    },
    
    /**
     * Enable tracking
     */
    enable() {
      this.config.enabled = true;
      this.startBatchTimer();
    },
    
    /**
     * Get all tracked events (for debugging)
     */
    getQueue() {
      return [...this.queue];
    },
    
    /**
     * Get session info
     */
    getSession() {
      return { ...this.session };
    }
  };

  // ==========================================================================
  // AUTO-INITIALIZE
  // ==========================================================================
  
  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ULAnalytics.init());
  } else {
    ULAnalytics.init();
  }
  
  // Flush on page unload
  window.addEventListener('beforeunload', () => {
    ULAnalytics.flush();
  });
  
  // Expose globally
  window.ULAnalytics = ULAnalytics;

})();
