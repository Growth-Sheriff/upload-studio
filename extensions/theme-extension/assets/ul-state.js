/**
 * Product 3D Customizer - Global State Manager
 * ====================================
 * FAZ 4: Centralized State Management
 * 
 * Provides:
 * - Shared state between DTF Uploader and T-Shirt Modal
 * - Event bus for cross-component communication
 * - Persistent state with sessionStorage
 * - Cart state synchronization
 * 
 * Version: 1.0.0
 * Architecture: DTF_TSHIRT_MODAL_ARCHITECTURE.md
 */

(function() {
  'use strict';

  // ==========================================================================
  // STATE STORE
  // ==========================================================================
  const ULState = {
    
    // Current state
    _state: {
      // Upload state (shared between components)
      upload: {
        status: 'idle', // idle | uploading | processing | complete | error
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
      
      // DTF state
      dtf: {
        productId: null,
        selectedVariantId: null,
        quantity: 1,
        extraAnswers: {}
      },
      
      // T-Shirt state
      tshirt: {
        isModalOpen: false,
        currentStep: 1,
        useInheritedDesign: false,
        newUpload: null, // Same structure as upload
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
      
      // Cart state
      cart: {
        items: [],
        itemCount: 0,
        totalPrice: 0,
        pendingItems: [] // Items added in current session
      },
      
      // UI state
      ui: {
        confirmationOpen: false,
        toastMessage: null,
        toastType: null,
        loading: false
      },
      
      // Config (from merchant settings)
      config: {
        tshirtEnabled: true,
        maxFileSizeMB: 1024, // 1GB default
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
    
    // Subscribers
    _subscribers: {},
    
    // Persistence key
    _storageKey: 'ul_state',
    
    // ==========================================================================
    // INITIALIZATION
    // ==========================================================================
    init() {
      // Restore state from session storage
      this._restoreState();
      
      // Bind cart events
      this._bindCartEvents();
      
      // Load storefront config (async)
      const productId = this._getProductIdFromPage();
      if (productId) {
        this.loadStorefrontConfig(productId);
      } else {
        this.loadStorefrontConfig();
      }
      
      console.log('[ULState] Global State Manager initialized v1.1.0');
    },
    
    _getProductIdFromPage() {
      // Try to get product ID from various sources
      if (window.ShopifyAnalytics?.meta?.product?.id) {
        return window.ShopifyAnalytics.meta.product.id;
      }
      if (window.meta?.product?.id) {
        return window.meta.product.id;
      }
      // Try from data attribute
      const productEl = document.querySelector('[data-product-id]');
      if (productEl) {
        return productEl.dataset.productId;
      }
      return null;
    },
    
    // ==========================================================================
    // STATE GETTERS
    // ==========================================================================
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
    
    // ==========================================================================
    // STATE SETTERS
    // ==========================================================================
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
      
      // Notify subscribers
      this._notify(path, value, oldValue);
      
      // Persist state
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
    
    // ==========================================================================
    // SUBSCRIPTIONS
    // ==========================================================================
    subscribe(path, callback) {
      if (!this._subscribers[path]) {
        this._subscribers[path] = [];
      }
      
      this._subscribers[path].push(callback);
      
      // Return unsubscribe function
      return () => {
        const index = this._subscribers[path].indexOf(callback);
        if (index > -1) {
          this._subscribers[path].splice(index, 1);
        }
      };
    },
    
    _notify(path, newValue, oldValue) {
      // Notify exact path subscribers
      if (this._subscribers[path]) {
        this._subscribers[path].forEach(cb => cb(newValue, oldValue, path));
      }
      
      // Notify parent path subscribers
      const parts = path.split('.');
      for (let i = parts.length - 1; i > 0; i--) {
        const parentPath = parts.slice(0, i).join('.');
        if (this._subscribers[parentPath]) {
          this._subscribers[parentPath].forEach(cb => 
            cb(this.get(parentPath), null, parentPath)
          );
        }
      }
      
      // Notify wildcard subscribers
      if (this._subscribers['*']) {
        this._subscribers['*'].forEach(cb => cb(newValue, oldValue, path));
      }
    },
    
    // ==========================================================================
    // PERSISTENCE
    // ==========================================================================
    _persistState() {
      try {
        // Only persist certain parts of state
        const toPersist = {
          upload: this._state.upload,
          dtf: this._state.dtf,
          tshirt: {
            ...this._state.tshirt,
            isModalOpen: false // Don't persist modal open state
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
          
          // Merge with defaults
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
    
    // ==========================================================================
    // CART INTEGRATION
    // ==========================================================================
    _bindCartEvents() {
      // Listen for cart updates
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
    
    // ==========================================================================
    // ACTION HELPERS
    // ==========================================================================
    
    // Upload actions
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
    
    // T-Shirt actions
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
    
    // UI actions
    showToast(message, type = 'success') {
      this.set('ui.toastMessage', message);
      this.set('ui.toastType', type);
      
      // Auto-clear after 3s
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
    
    // ==========================================================================
    // COMPUTED GETTERS
    // ==========================================================================
    
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
      
      // Base price (would come from variant)
      let total = 19.99;
      
      // Add location prices (first is free)
      const enabledLocs = this.getEnabledLocations();
      enabledLocs.forEach((locId, idx) => {
        if (idx > 0) {
          total += pricing.locationPrices[locId] || 0;
        }
      });
      
      // Add size modifier
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
    
    // ==========================================================================
    // RESET
    // ==========================================================================
    
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

    // ==========================================================================
    // STOREFRONT CONFIG LOADING
    // ==========================================================================
    
    /**
     * Load storefront config from API
     * This includes: white-label, asset sets, product config, settings
     */
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
        
        // Store in state
        this.set('storefrontConfig', config);
        
        // Apply white-label styles if enabled
        if (config.whiteLabel?.enabled) {
          this.applyWhiteLabelStyles(config.whiteLabel);
        }
        
        // Update config from settings
        if (config.settings) {
          this.update('config', {
            maxFileSizeMB: config.settings.maxFileSizeMB || 1024,
            minDPI: config.settings.minDpi || 150,
            autoApprove: config.settings.autoApprove ?? true,
          });
        }
        
        // Set asset set model URL globally
        if (config.assetSet?.model?.url) {
          window.UL_TSHIRT_GLB_URL = config.assetSet.model.url;
          console.log('[ULState] Set 3D model URL:', window.UL_TSHIRT_GLB_URL);
        }
        
        // Update location prices from asset set
        if (config.assetSet?.printLocations) {
          const locationPrices = {};
          config.assetSet.printLocations.forEach(loc => {
            locationPrices[loc.id] = loc.price || 0;
          });
          this.set('config.pricing.locationPrices', locationPrices);
        }
        
        // Emit config loaded event
        if (window.ULEvents) {
          window.ULEvents.emit('configLoaded', config);
        }
        
        return config;
        
      } catch (e) {
        console.error('[ULState] Config load error:', e?.message || e?.status || JSON.stringify(e) || 'Unknown error');
        return null;
      }
    },
    
    /**
     * Apply white-label CSS styles dynamically
     */
    applyWhiteLabelStyles(whiteLabel) {
      if (!whiteLabel?.enabled) return;
      
      // Create or update style element
      let styleEl = document.getElementById('ul-whitelabel-styles');
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'ul-whitelabel-styles';
        document.head.appendChild(styleEl);
      }
      
      const primary = whiteLabel.primaryColor || '#667eea';
      const secondary = whiteLabel.secondaryColor || '#764ba2';
      
      styleEl.textContent = `
        /* Upload Lift White-Label Styles */
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
    
    /**
     * Get storefront config (cached)
     */
    getStorefrontConfig() {
      return this.get('storefrontConfig');
    }
  };

  // ==========================================================================
  // EVENT BUS
  // ==========================================================================
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
      
      // Internal handlers
      if (this._handlers[event]) {
        this._handlers[event].forEach(handler => {
          try {
            handler(data);
          } catch (e) {
            console.error(`[ULEvents] Handler error for ${event}:`, e);
          }
        });
      }
      
      // Also dispatch as DOM event for external listeners
      document.dispatchEvent(new CustomEvent(`ul:${event}`, {
        detail: data,
        bubbles: true
      }));
    },
    
    // Predefined events
    EVENTS: {
      // Upload events
      UPLOAD_START: 'uploadStart',
      UPLOAD_PROGRESS: 'uploadProgress',
      UPLOAD_COMPLETE: 'uploadComplete',
      UPLOAD_ERROR: 'uploadError',
      
      // Modal events
      MODAL_OPEN: 'modalOpen',
      MODAL_CLOSE: 'modalClose',
      STEP_CHANGE: 'stepChange',
      
      // Design events
      COLOR_CHANGE: 'colorChange',
      SIZE_CHANGE: 'sizeChange',
      LOCATION_TOGGLE: 'locationToggle',
      LOCATION_SETTING_CHANGE: 'locationSettingChange',
      
      // Cart events
      ADD_TO_CART: 'addToCart',
      CART_UPDATED: 'cartUpdated',
      
      // UI events
      SHOW_TOAST: 'showToast',
      SHOW_CONFIRMATION: 'showConfirmation',
      HIDE_CONFIRMATION: 'hideConfirmation'
    }
  };

  // ==========================================================================
  // INITIALIZE & EXPOSE
  // ==========================================================================
  
  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ULState.init());
  } else {
    ULState.init();
  }
  
  // Expose globally
  window.ULState = ULState;
  window.ULEvents = ULEvents;

})();
