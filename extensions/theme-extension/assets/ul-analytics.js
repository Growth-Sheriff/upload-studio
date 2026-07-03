

(function() {
  'use strict';

  const ULAnalytics = {
    version: '4.1.0',

    config: {
      enabled: true,
      debug: false,
      batchSize: 10,
      batchInterval: 5000,
      webhookUrl: null,
      ga4Enabled: false,
      metaPixelEnabled: false,
      shopifyEnabled: true
    },

    session: {
      id: null,
      startTime: null,
      shopDomain: null,
      productId: null,
      customerId: null,
      pageUrl: null
    },

    queue: [],
    batchTimer: null,

    timings: {},

    init(options = {}) {

      Object.assign(this.config, options);

      this.session.id = this.generateSessionId();
      this.session.startTime = Date.now();
      this.session.pageUrl = window.location.href;

      this.session.shopDomain = this.extractShopDomain();

      if (this.config.batchSize > 1) {
        this.startBatchTimer();
      }

      this.bindGlobalEvents();

      this.track('page_view', {
        url: window.location.href,
        referrer: document.referrer
      });

      console.log('[ULAnalytics] Initialized v4.1.0', {
        sessionId: this.session.id,
        shopDomain: this.session.shopDomain
      });
    },

    track(eventName, properties = {}) {
      if (!this.config.enabled) return;

      const event = this.buildEvent(eventName, properties);

      if (this.config.debug) {
        console.log('[ULAnalytics] Track:', event);
      }

      this.queue.push(event);

      if (this.config.batchSize <= 1 || this.queue.length >= this.config.batchSize) {
        this.flush();
      }

      this.emit('track', event);

      return event;
    },

    trackTiming(name, startTime) {
      const duration = Date.now() - startTime;

      this.track(`timing_${name}`, {
        duration,
        name
      });

      return duration;
    },

    startTiming(name) {
      this.timings[name] = Date.now();
    },

    endTiming(name) {
      if (this.timings[name]) {
        const duration = this.trackTiming(name, this.timings[name]);
        delete this.timings[name];
        return duration;
      }
      return 0;
    },

    setUser(properties) {
      Object.assign(this.session, properties);
    },

    setProduct(productId) {
      this.session.productId = productId;
    },

    trackDTFUploadStarted(data = {}) {
      return this.track('dtf_upload_started', {
        fileName: data.fileName,
        fileSize: data.fileSize,
        fileType: data.fileType,
        productId: data.productId || this.session.productId
      });
    },

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

    trackDTFUploadFailed(data = {}) {
      return this.track('dtf_upload_failed', {
        fileName: data.fileName,
        errorCode: data.errorCode,
        errorMessage: data.errorMessage,
        productId: data.productId || this.session.productId
      });
    },

    trackDTFSizeSelected(data = {}) {
      return this.track('dtf_size_selected', {
        size: data.size,
        variantId: data.variantId,
        price: data.price,
        productId: data.productId || this.session.productId
      });
    },

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

    trackDTFCustomizeClicked(data = {}) {
      return this.track('dtf_customize_clicked', {
        uploadId: data.uploadId,
        productId: data.productId || this.session.productId
      });
    },

    trackTShirtModalOpened(data = {}) {
      this.startTiming('tshirt_modal_session');
      return this.track('tshirt_modal_opened', {
        hasInheritedDesign: data.hasInheritedDesign,
        source: data.source,
        productId: data.productId || this.session.productId
      });
    },

    trackTShirtModalClosed(data = {}) {
      const duration = this.endTiming('tshirt_modal_session');
      return this.track('tshirt_modal_closed', {
        stepReached: data.stepReached,
        completed: data.completed,
        duration,
        productId: data.productId || this.session.productId
      });
    },

    trackTShirtStepCompleted(step, data = {}) {
      return this.track(`tshirt_step_${step}_completed`, {
        step,
        ...data
      });
    },

    trackTShirtColorChanged(data = {}) {
      return this.track('tshirt_color_changed', {
        colorName: data.colorName,
        colorHex: data.colorHex,
        previousColor: data.previousColor
      });
    },

    trackTShirtSizeChanged(data = {}) {
      return this.track('tshirt_size_changed', {
        size: data.size,
        previousSize: data.previousSize,
        priceDiff: data.priceDiff
      });
    },

    trackTShirtLocationToggled(data = {}) {
      return this.track('tshirt_location_toggled', {
        location: data.location,
        enabled: data.enabled,
        totalLocations: data.totalLocations
      });
    },

    trackTShirtDesignAnother(data = {}) {
      return this.track('tshirt_design_another_clicked', {
        itemsAdded: data.itemsAdded
      });
    },

    trackTShirtCheckout(data = {}) {
      return this.track('tshirt_checkout_clicked', {
        totalPrice: data.totalPrice,
        quantity: data.quantity,
        locations: data.locations
      });
    },

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

    trackConfirmationShown(data = {}) {
      return this.track('confirmation_shown', {
        source: data.source,
        itemCount: data.itemCount,
        cartTotal: data.cartTotal
      });
    },

    trackProceedCheckout(data = {}) {
      return this.track('proceed_checkout_clicked', {
        cartTotal: data.cartTotal,
        itemCount: data.itemCount
      });
    },

    trackContinueShopping(data = {}) {
      return this.track('continue_shopping_clicked', {
        fromSource: data.fromSource
      });
    },

    trackError(data = {}) {
      return this.track('error_occurred', {
        errorCode: data.errorCode,
        errorType: data.errorType,
        errorMessage: data.errorMessage,
        component: data.component,
        recoverable: data.recoverable
      });
    },

    async flush() {
      if (this.queue.length === 0) return;

      const events = [...this.queue];
      this.queue = [];

      const promises = [];

      if (this.config.shopifyEnabled) {
        promises.push(this.sendToShopify(events));
      }

      if (this.config.webhookUrl) {
        promises.push(this.sendToWebhook(events));
      }

      if (this.config.ga4Enabled && window.gtag) {
        promises.push(this.sendToGA4(events));
      }

      if (this.config.metaPixelEnabled && window.fbq) {
        promises.push(this.sendToMeta(events));
      }

      await Promise.allSettled(promises);
    },

    async sendToShopify(events) {

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

    async sendToMeta(events) {
      if (!window.fbq) return;

      events.forEach(event => {
        try {

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

    bindGlobalEvents() {

      if (window.ULEvents) {

        window.ULEvents.on('uploadStart', (data) => {
          this.trackDTFUploadStarted(data);
        });

        window.ULEvents.on('uploadComplete', (data) => {
          this.trackDTFUploadCompleted(data);
        });

        window.ULEvents.on('uploadError', (data) => {
          this.trackDTFUploadFailed(data);
        });

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

        window.ULEvents.on('colorChange', (data) => {
          this.trackTShirtColorChanged(data);
        });

        window.ULEvents.on('sizeChange', (data) => {
          this.trackTShirtSizeChanged(data);
        });

        window.ULEvents.on('addToCart', (data) => {
          if (data.source === 'tshirt-modal') {
            this.trackTShirtAddToCart(data);
          } else {
            this.trackDTFAddToCart(data);
          }
        });

        window.ULEvents.on('ul:error', (data) => {
          this.trackError(data);
        });

        window.ULEvents.on('showConfirmation', (data) => {
          this.trackConfirmationShown(data);
        });
      }

      document.addEventListener('ul:showConfirmation', (e) => {
        this.trackConfirmationShown(e.detail || {});
      });

      document.addEventListener('ul:addedToCart', (e) => {

      });
    },

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

      if (window.Shopify && window.Shopify.shop) {
        return window.Shopify.shop;
      }

      const meta = document.querySelector('meta[name="shopify-shop-domain"]');
      if (meta) return meta.content;

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

    enableDebug() {
      this.config.debug = true;
      console.log('[ULAnalytics] Debug mode enabled');
    },

    disable() {
      this.config.enabled = false;
      this.stopBatchTimer();
    },

    enable() {
      this.config.enabled = true;
      this.startBatchTimer();
    },

    getQueue() {
      return [...this.queue];
    },

    getSession() {
      return { ...this.session };
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ULAnalytics.init());
  } else {
    ULAnalytics.init();
  }

  window.addEventListener('beforeunload', () => {
    ULAnalytics.flush();
  });

  window.ULAnalytics = ULAnalytics;

})();
