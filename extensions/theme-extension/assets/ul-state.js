

(function() {
  'use strict';

  const ULState = {

    _state: {

      upload: {
        status: 'idle',
        uploadId: null,
        thumbnailUrl: null,
        originalUrl: null,
        fileName: null,
        dimensions: { width: 0, height: 0, dpi: 0 },
        fileSize: 0,
        mimeType: null,
        progress: 0,
        error: null
      },

      dtf: {
        productId: null,
        selectedVariantId: null,
        quantity: 1,
        extraAnswers: {}
      },

      tshirt: {
        isModalOpen: false,
        currentStep: 1,
        useInheritedDesign: false,
        newUpload: null,
        color: { name: 'White', hex: '#FFFFFF' },
        size: 'M',
        locations: {
          front: { enabled: true, scale: 100, positionX: 0, positionY: 0 },
          back: { enabled: false, scale: 100, positionX: 0, positionY: 0 },
          left_sleeve: { enabled: false, scale: 100, positionX: 0, positionY: 0 },
          right_sleeve: { enabled: false, scale: 100, positionX: 0, positionY: 0 }
        },
        activeLocation: 'front',
        quantity: 1,
        extraAnswers: {},
        specialInstructions: '',
        confirmationChecked: false
      },

      cart: {
        items: [],
        itemCount: 0,
        totalPrice: 0,
        pendingItems: []
      },

      ui: {
        confirmationOpen: false,
        toastMessage: null,
        toastType: null,
        loading: false
      },

      config: {
        tshirtEnabled: true,
        maxFileSizeMB: 1024,
        minDPI: 150,
        allowedTypes: [
          'image/png', 'image/jpeg', 'image/webp', 'image/tiff',
          'image/vnd.adobe.photoshop', 'application/x-photoshop',
          'image/svg+xml', 'application/pdf', 'application/postscript'
        ],
        extraQuestions: [],
        pricing: {
          locationPrices: { front: 0, back: 5, left_sleeve: 3, right_sleeve: 3 },
          sizePricing: { 'XS': 0, 'S': 0, 'M': 0, 'L': 2, 'XL': 2, '2XL': 5, '3XL': 5 }
        }
      }
    },

    _subscribers: {},

    _storageKey: 'ul_state',

    init() {

      this._restoreState();

      this._bindCartEvents();

      const productId = this._getProductIdFromPage();
      if (productId) {
        this.loadStorefrontConfig(productId);
      } else {
        this.loadStorefrontConfig();
      }

      console.log('[ULState] Global State Manager initialized v1.1.0');
    },

    _getProductIdFromPage() {

      if (window.ShopifyAnalytics?.meta?.product?.id) {
        return window.ShopifyAnalytics.meta.product.id;
      }
      if (window.meta?.product?.id) {
        return window.meta.product.id;
      }

      const productEl = document.querySelector('[data-product-id]');
      if (productEl) {
        return productEl.dataset.productId;
      }
      return null;
    },

    get(path) {
      const keys = path.split('.');
      let value = this._state;

      for (const key of keys) {
        if (value && typeof value === 'object' && key in value) {
          value = value[key];
        } else {
          return undefined;
        }
      }

      return value;
    },

    getAll() {
      return JSON.parse(JSON.stringify(this._state));
    },

    set(path, value) {
      const keys = path.split('.');
      const lastKey = keys.pop();
      let target = this._state;

      for (const key of keys) {
        if (!(key in target) || typeof target[key] !== 'object') {
          target[key] = {};
        }
        target = target[key];
      }

      const oldValue = target[lastKey];
      target[lastKey] = value;

      this._notify(path, value, oldValue);

      this._persistState();

      return this;
    },

    update(path, updater) {
      const currentValue = this.get(path);
      const newValue = typeof updater === 'function'
        ? updater(currentValue)
        : { ...currentValue, ...updater };

      return this.set(path, newValue);
    },

    subscribe(path, callback) {
      if (!this._subscribers[path]) {
        this._subscribers[path] = [];
      }

      this._subscribers[path].push(callback);

      return () => {
        const index = this._subscribers[path].indexOf(callback);
        if (index > -1) {
          this._subscribers[path].splice(index, 1);
        }
      };
    },

    _notify(path, newValue, oldValue) {

      if (this._subscribers[path]) {
        this._subscribers[path].forEach(cb => cb(newValue, oldValue, path));
      }

      const parts = path.split('.');
      for (let i = parts.length - 1; i > 0; i--) {
        const parentPath = parts.slice(0, i).join('.');
        if (this._subscribers[parentPath]) {
          this._subscribers[parentPath].forEach(cb =>
            cb(this.get(parentPath), null, parentPath)
          );
        }
      }

      if (this._subscribers['*']) {
        this._subscribers['*'].forEach(cb => cb(newValue, oldValue, path));
      }
    },

    _persistState() {
      try {

        const toPersist = {
          upload: this._state.upload,
          dtf: this._state.dtf,
          tshirt: {
            ...this._state.tshirt,
            isModalOpen: false
          }
        };

        sessionStorage.setItem(this._storageKey, JSON.stringify(toPersist));
      } catch (e) {
        console.warn('[ULState] Failed to persist state:', e);
      }
    },

    _restoreState() {
      try {
        const stored = sessionStorage.getItem(this._storageKey);
        if (stored) {
          const parsed = JSON.parse(stored);

          if (parsed.upload) {
            this._state.upload = { ...this._state.upload, ...parsed.upload };
          }
          if (parsed.dtf) {
            this._state.dtf = { ...this._state.dtf, ...parsed.dtf };
          }
          if (parsed.tshirt) {
            this._state.tshirt = { ...this._state.tshirt, ...parsed.tshirt };
          }
        }
      } catch (e) {
        console.warn('[ULState] Failed to restore state:', e);
      }
    },

    clearPersistedState() {
      sessionStorage.removeItem(this._storageKey);
    },

    _bindCartEvents() {
      document.addEventListener('ul:addedToCart', (e) => {
        this.update('cart.pendingItems', items => [...(items || []), e.detail]);
        this.refreshCart();
      });

      document.addEventListener('ul:cartUpdated', () => {
        this.refreshCart();
      });
    },

    async refreshCart() {
      try {
        const response = await fetch('/cart.js', {
          headers: { 'Accept': 'application/json' }
        });

        if (!response.ok) throw new Error('Failed to fetch cart');

        const cart = await response.json();

        this.set('cart.items', cart.items);
        this.set('cart.itemCount', cart.item_count);
        this.set('cart.totalPrice', cart.total_price);

      } catch (e) {
        console.error('[ULState] Cart refresh error:', e);
      }
    },

    setUploadProgress(progress) {
      this.set('upload.progress', progress);
      this.set('upload.status', 'uploading');
    },

    setUploadComplete(data) {
      this.update('upload', {
        status: 'complete',
        uploadId: data.id || data.uploadId,
        thumbnailUrl: data.thumbnailUrl || data.url,
        originalUrl: data.url || data.originalUrl,
        fileName: data.name || data.fileName,
        dimensions: data.dimensions || { width: 0, height: 0, dpi: 0 },
        fileSize: data.size || 0,
        mimeType: data.mimeType || null,
        progress: 100,
        error: null
      });
    },

    setUploadError(error) {
      this.update('upload', {
        status: 'error',
        error: typeof error === 'string' ? error : error.message,
        progress: 0
      });
    },

    clearUpload() {
      this.set('upload', {
        status: 'idle',
        uploadId: null,
        thumbnailUrl: null,
        originalUrl: null,
        fileName: null,
        dimensions: { width: 0, height: 0, dpi: 0 },
        fileSize: 0,
        mimeType: null,
        progress: 0,
        error: null
      });
    },

    openTShirtModal() {
      this.set('tshirt.isModalOpen', true);
    },

    closeTShirtModal() {
      this.set('tshirt.isModalOpen', false);
    },

    setTShirtStep(step) {
      this.set('tshirt.currentStep', step);
    },

    toggleLocation(locationId) {
      const current = this.get(`tshirt.locations.${locationId}.enabled`);
      this.set(`tshirt.locations.${locationId}.enabled`, !current);
    },

    setLocationSetting(locationId, key, value) {
      this.set(`tshirt.locations.${locationId}.${key}`, value);
    },

    showToast(message, type = 'success') {
      this.set('ui.toastMessage', message);
      this.set('ui.toastType', type);

      setTimeout(() => {
        this.set('ui.toastMessage', null);
        this.set('ui.toastType', null);
      }, 3000);
    },

    openConfirmation() {
      this.set('ui.confirmationOpen', true);
    },

    closeConfirmation() {
      this.set('ui.confirmationOpen', false);
    },

    getEnabledLocations() {
      const locations = this.get('tshirt.locations');
      return Object.entries(locations)
        .filter(([_, loc]) => loc.enabled)
        .map(([id, _]) => id);
    },

    calculateTShirtPrice() {
      const tshirt = this.get('tshirt');
      const pricing = this.get('config.pricing');

      if (!tshirt || !pricing) return 0;

      let total = 19.99;

      const enabledLocs = this.getEnabledLocations();
      enabledLocs.forEach((locId, idx) => {
        if (idx > 0) {
          total += pricing.locationPrices[locId] || 0;
        }
      });

      const sizePrice = pricing.sizePricing[tshirt.size] || 0;
      total += sizePrice;

      return total;
    },

    getUploadData() {
      const upload = this.get('upload');
      return {
        id: upload.uploadId,
        uploadId: upload.uploadId,
        url: upload.originalUrl,
        thumbnailUrl: upload.thumbnailUrl,
        name: upload.fileName,
        dimensions: upload.dimensions
      };
    },

    canProceedToStep(step) {
      const tshirt = this.get('tshirt');
      const upload = this.get('upload');

      switch (step) {
        case 2:
          return tshirt.useInheritedDesign ||
                 (tshirt.newUpload && tshirt.newUpload.status === 'complete') ||
                 upload.status === 'complete';
        case 3:
          return this.getEnabledLocations().length > 0;
        case 4:
          return tshirt.quantity > 0;
        default:
          return true;
      }
    },

    resetTShirt() {
      this.set('tshirt', {
        isModalOpen: this.get('tshirt.isModalOpen'),
        currentStep: 1,
        useInheritedDesign: false,
        newUpload: null,
        color: { name: 'White', hex: '#FFFFFF' },
        size: 'M',
        locations: {
          front: { enabled: true, scale: 100, positionX: 0, positionY: 0 },
          back: { enabled: false, scale: 100, positionX: 0, positionY: 0 },
          left_sleeve: { enabled: false, scale: 100, positionX: 0, positionY: 0 },
          right_sleeve: { enabled: false, scale: 100, positionX: 0, positionY: 0 }
        },
        activeLocation: 'front',
        quantity: 1,
        extraAnswers: {},
        specialInstructions: '',
        confirmationChecked: false
      });
    },

    resetAll() {
      this.clearUpload();
      this.resetTShirt();
      this.set('dtf', {
        productId: null,
        selectedVariantId: null,
        quantity: 1,
        extraAnswers: {}
      });
      this.set('cart.pendingItems', []);
      this.clearPersistedState();
    },

    async loadStorefrontConfig(productId) {
      try {
        const shopDomain = window.Shopify?.shop || '';
        const apiBase = '/apps/customizer';

        const url = new URL(`${apiBase}/api/storefront/config`, window.location.origin);
        url.searchParams.set('shopDomain', shopDomain);
        if (productId) {
          url.searchParams.set('productId', productId);
        }

        console.log('[ULState] Loading storefront config...');

        const response = await fetch(url.toString());
        if (!response.ok) {
          console.warn('[ULState] Failed to load storefront config:', response.status);
          return null;
        }

        const config = await response.json();
        console.log('[ULState] Storefront config loaded:', config);

        this.set('storefrontConfig', config);

        if (config.whiteLabel?.enabled) {
          this.applyWhiteLabelStyles(config.whiteLabel);
        }

        if (config.settings) {
          this.update('config', {
            maxFileSizeMB: config.settings.maxFileSizeMB || 1024,
            minDPI: config.settings.minDpi || 150,
            autoApprove: config.settings.autoApprove ?? true,
          });
        }

        if (config.assetSet?.model?.url) {
          window.UL_TSHIRT_GLB_URL = config.assetSet.model.url;
          console.log('[ULState] Set 3D model URL:', window.UL_TSHIRT_GLB_URL);
        }

        if (config.assetSet?.printLocations) {
          const locationPrices = {};
          config.assetSet.printLocations.forEach(loc => {
            locationPrices[loc.id] = loc.price || 0;
          });
          this.set('config.pricing.locationPrices', locationPrices);
        }

        if (window.ULEvents) {
          window.ULEvents.emit('configLoaded', config);
        }

        return config;

      } catch (e) {
        console.error('[ULState] Config load error:', e?.message || e?.status || JSON.stringify(e) || 'Unknown error');
        return null;
      }
    },

    applyWhiteLabelStyles(whiteLabel) {
      if (!whiteLabel?.enabled) return;

      let styleEl = document.getElementById('ul-whitelabel-styles');
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'ul-whitelabel-styles';
        document.head.appendChild(styleEl);
      }

      const primary = whiteLabel.primaryColor || '#667eea';
      const secondary = whiteLabel.secondaryColor || '#764ba2';

      styleEl.textContent = `
        :root {
          --ul-primary: ${primary};
          --ul-secondary: ${secondary};
          --ul-gradient: linear-gradient(135deg, ${primary} 0%, ${secondary} 100%);
        }

        .ul-quick-btn-trigger,
        .ul-quick-btn-primary,
        .ul-upload-btn,
        .ul-sh-upload-btn,
        .ul-tshirt-btn-primary {
          background: var(--ul-gradient) !important;
        }

        .ul-quick-dropzone:hover,
        .ul-upload-zone:hover,
        .ul-sh-upload-zone:hover {
          border-color: var(--ul-primary) !important;
        }

        .ul-progress-fill,
        .ul-sh-progress-fill {
          background: var(--ul-gradient) !important;
        }

        .ul-price,
        .ul-card-vendor,
        .ul-sh-vendor {
          color: var(--ul-primary) !important;
        }

        ${whiteLabel.customCss || ''}
      `;

      console.log('[ULState] White-label styles applied');
    },

    getStorefrontConfig() {
      return this.get('storefrontConfig');
    }
  };

  const ULEvents = {

    _handlers: {},

    on(event, handler) {
      if (!this._handlers[event]) {
        this._handlers[event] = [];
      }
      this._handlers[event].push(handler);

      return () => this.off(event, handler);
    },

    off(event, handler) {
      if (!this._handlers[event]) return;

      const index = this._handlers[event].indexOf(handler);
      if (index > -1) {
        this._handlers[event].splice(index, 1);
      }
    },

    emit(event, data = {}) {
      console.log(`[ULEvents] Emitting: ${event}`, data);

      if (this._handlers[event]) {
        this._handlers[event].forEach(handler => {
          try {
            handler(data);
          } catch (e) {
            console.error(`[ULEvents] Handler error for ${event}:`, e);
          }
        });
      }

      document.dispatchEvent(new CustomEvent(`ul:${event}`, {
        detail: data,
        bubbles: true
      }));
    },

    EVENTS: {
      UPLOAD_START: 'uploadStart',
      UPLOAD_PROGRESS: 'uploadProgress',
      UPLOAD_COMPLETE: 'uploadComplete',
      UPLOAD_ERROR: 'uploadError',

      MODAL_OPEN: 'modalOpen',
      MODAL_CLOSE: 'modalClose',
      STEP_CHANGE: 'stepChange',

      COLOR_CHANGE: 'colorChange',
      SIZE_CHANGE: 'sizeChange',
      LOCATION_TOGGLE: 'locationToggle',
      LOCATION_SETTING_CHANGE: 'locationSettingChange',

      ADD_TO_CART: 'addToCart',
      CART_UPDATED: 'cartUpdated',

      SHOW_TOAST: 'showToast',
      SHOW_CONFIRMATION: 'showConfirmation',
      HIDE_CONFIRMATION: 'hideConfirmation'
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ULState.init());
  } else {
    ULState.init();
  }

  window.ULState = ULState;
  window.ULEvents = ULEvents;

})();
