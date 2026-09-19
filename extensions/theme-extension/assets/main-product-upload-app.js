(function() {
  var ROOT_SELECTOR = '[data-ul-main-product-upload-app]';
  var POLICY = 'finished_sheet';

  function parseJson(value, fallback) {
    try {
      var parsed = JSON.parse(value || '');
      return parsed == null ? fallback : parsed;
    } catch (_) {
      return fallback;
    }
  }

  function toNumber(value) {
    var parsed = Number(value);
    return isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function formatInches(value) {
    var n = toNumber(value);
    if (!n) return '--';
    return Math.abs(n - Math.round(n)) < 0.01 ? String(Math.round(n)) + '"' : n.toFixed(2) + '"';
  }

  function getDisplaySheetDimensions(widthIn, heightIn) {
    var first = toNumber(widthIn);
    var second = toNumber(heightIn);
    if (!(first > 0) || !(second > 0)) return null;
    return { widthIn: Math.min(first, second), lengthIn: Math.max(first, second) };
  }

  function formatDisplaySheetDimensions(widthIn, heightIn) {
    var dimensions = getDisplaySheetDimensions(widthIn, heightIn);
    return dimensions
      ? 'W ' + formatInches(dimensions.widthIn) + ' x L ' + formatInches(dimensions.lengthIn)
      : '-- x --';
  }

  // Shopify's storefront JSON (`product.variants | json`, `/products/x.js`,
  // `/cart.js`) always carries prices as integer minor units (cents). Never
  // guess: variant prices go through variantPriceToDollars, and formatMoney
  // takes dollars. (The old "> 100 means cents" heuristic divided any total
  // above $100 by 100 and multiplied sub-$1 variants by 100.)
  function variantPriceToDollars(raw) {
    if (raw == null || raw === '') return 0;
    var numeric = Number(raw);
    if (!isFinite(numeric) || numeric <= 0) return 0;
    return numeric / 100;
  }

  // Fixed en-US digits so "$15.00" never becomes "$15,00" on a Turkish or
  // German browser: the amount must read exactly as Shopify's cart shows it.
  function formatMoney(dollars, currency) {
    var n = Number(dollars);
    if (!isFinite(n) || n <= 0) return '--';
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency || 'USD'
      }).format(n);
    } catch (_) {
      return '$' + n.toFixed(2);
    }
  }

  function getTierUnitPrice(tier) {
    if (!tier) return 0;
    var value = tier.price_per_inch != null ? tier.price_per_inch : tier.price_per_sqin;
    var parsed = Number(value);
    return isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function getTierLabel(tier) {
    if (!tier) return '';
    if (tier.label) return String(tier.label);
    var min = Math.max(1, Math.floor(Number(tier.min_qty) || 1));
    var max = tier.max_qty == null || tier.max_qty === '' ? null : Math.floor(Number(tier.max_qty) || 0);
    return max && max >= min ? min + '-' + max + ' in' : min + '+ in';
  }

  function getText(value, fallback) {
    var out = String(value == null ? '' : value).trim();
    return out || fallback || '';
  }

  function normalizeCustomerId(value) {
    var raw = String(value == null ? '' : value).trim();
    if (!raw) return '';
    var match = raw.match(/(\d{6,})$/);
    return match ? match[1] : raw.replace(/[^\d]/g, '');
  }

  function getCustomerIdFromGlobals() {
    try {
      var stId = window.__st && (window.__st.cid || window.__st.customerId || window.__st.customer_id);
      var analyticsPage = window.ShopifyAnalytics && window.ShopifyAnalytics.meta && window.ShopifyAnalytics.meta.page;
      var analyticsId = analyticsPage && (analyticsPage.customerId || analyticsPage.customer_id);
      return normalizeCustomerId(stId || analyticsId);
    } catch (_) {
      return '';
    }
  }

  function buildQuery(params) {
    var parts = [];
    Object.keys(params).forEach(function(key) {
      if (params[key] == null || params[key] === '') return;
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(params[key])));
    });
    return parts.length ? '?' + parts.join('&') : '';
  }

  function readyKey(items) {
    return items.map(function(item) {
      return [
        item.uploadId || '',
        item.selectedVariantId || '',
        item.widthIn || '',
        item.heightIn || '',
        Math.max(1, Number(item.copies || item.quantity) || 1)
      ].join(':');
    }).join('|');
  }

  function exactCartStorageAvailable() {
    try {
      var key = '__ump_exact_cart_test__';
      window.localStorage.setItem(key, '1');
      window.localStorage.removeItem(key);
      return true;
    } catch (_) {
      return false;
    }
  }

  function exactCartTotal(entries) {
    return entries.reduce(function(sum, entry) {
      return sum + (Number(entry.totalPrice || entry.exactTotal || 0) || 0);
    }, 0);
  }

  function normalizeDiscountCode(value) {
    return String(value == null ? '' : value).trim().replace(/\s+/g, '').slice(0, 64);
  }

  function getDiscountCodeFromUrl() {
    try {
      var params = new URLSearchParams(window.location.search || '');
      return normalizeDiscountCode(params.get('discount') || params.get('discount_code') || params.get('coupon'));
    } catch (_) {
      return '';
    }
  }

  function getDiscountStorageKey(shopDomain) {
    return 'ump_discount_code:' + String(shopDomain || 'shop').toLowerCase();
  }

  function readStoredDiscountCode(shopDomain) {
    try {
      return normalizeDiscountCode(window.localStorage.getItem(getDiscountStorageKey(shopDomain)));
    } catch (_) {
      return '';
    }
  }

  function writeStoredDiscountCode(shopDomain, code) {
    try {
      var key = getDiscountStorageKey(shopDomain);
      if (code) window.localStorage.setItem(key, code);
      else window.localStorage.removeItem(key);
    } catch (_) {}
  }

  function discountRedirect(path, code) {
    var normalized = normalizeDiscountCode(code);
    if (!normalized) return path || '/cart';
    return '/discount/' + encodeURIComponent(normalized) + '?redirect=' + encodeURIComponent(path || '/cart');
  }

  function getVariantLabel(variant) {
    var label = '';
    if (variant) {
      if (Array.isArray(variant.options) && variant.options.length) {
        label = variant.options.filter(Boolean).join(' / ');
      }
      label = label || variant.title || variant.name || '';
    }
    label = String(label || '').trim();
    return label && label.toLowerCase() !== 'default title' ? label : 'Sheet';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function parseSheetSize(label) {
    // Accepts 22x30, 22 x 30, 22"x30", 22” × 30”, 22in x 30in.
    var match = String(label || '').match(/(\d+(?:\.\d+)?)\s*(?:"|”|″|in(?:ch)?)?\s*[xX×]\s*(\d+(?:\.\d+)?)/);
    if (!match) return null;
    var a = parseFloat(match[1]);
    var b = parseFloat(match[2]);
    if (!(a > 0) || !(b > 0)) return null;
    return { width: a, height: b };
  }

  function getField(payload, name) {
    if (!payload || typeof payload !== 'object') return null;
    if (payload[name] != null) return payload[name];
    if (payload.metadata && typeof payload.metadata === 'object' && payload.metadata[name] != null) {
      return payload.metadata[name];
    }
    return null;
  }

  function sendUploadXhr(url, method, file, headers, onProgress, onXhr) {
    return new Promise(function(resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open(method, url, true);
      xhr.onload = function() {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error('Upload request failed with ' + xhr.status));
      };
      xhr.onerror = function() { reject(new Error('Network error while uploading')); };
      xhr.onabort = function() { reject(new Error('Upload cancelled')); };
      xhr.upload.onprogress = function(event) {
        if (event.lengthComputable && typeof onProgress === 'function') {
          onProgress(event.loaded, event.total);
        }
      };
      if (typeof onXhr === 'function') onXhr(xhr);

      if (method === 'POST') {
        var form = new FormData();
        form.append('file', file);
        if (headers && headers.__extraFields) {
          Object.keys(headers.__extraFields).forEach(function(key) {
            form.append(key, headers.__extraFields[key]);
          });
        }
        xhr.send(form);
        return;
      }

      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      if (headers) {
        Object.keys(headers).forEach(function(key) {
          xhr.setRequestHeader(key, headers[key]);
        });
      }
      xhr.send(file);
    });
  }

  function sleep(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
  }

  // ~6 minutes of thumbnail polling for server-rendered formats: a large PDF
  // can wait for the shared large-image slot long after it was measured.
  var SERVER_THUMBNAIL_ATTEMPTS = 120;

  function getStatusPollDelay(attempt) {
    if (attempt < 6) return 350;
    if (attempt < 14) return 700;
    if (attempt < 28) return 1000;
    if (attempt < 60) return 1500;
    return 3000;
  }

  function MainProductUpload(root) {
    this.root = root;
    this.apiBase = root.getAttribute('data-api-base') || '/apps/customizer';
    this.shopDomain = root.getAttribute('data-shop-domain') || '';
    this.productId = root.getAttribute('data-product-id') || '';
    this.productTitle = root.getAttribute('data-product-title') || '';
    this.currentVariantId = root.getAttribute('data-current-variant-id') || '';
    this.customerId = normalizeCustomerId(root.getAttribute('data-customer-id') || getCustomerIdFromGlobals());
    this.customerEmail = root.getAttribute('data-customer-email') || '';
    this.customerName = root.getAttribute('data-customer-name') || '';
    if (this.customerId && !root.getAttribute('data-customer-id')) {
      root.setAttribute('data-customer-id', this.customerId);
    }
    // Product config is authoritative. This is only the loading fallback.
    this.maxPrintableWidthIn = 22.5;
    this.enableCheckout = root.getAttribute('data-enable-checkout') === 'true';
    this.currency = root.getAttribute('data-currency') || 'USD';
    this.variants = parseJson(root.getAttribute('data-product-variants'), []);
    this.productOptions = parseJson(root.getAttribute('data-product-options'), []);
    this.discountCode = normalizeDiscountCode(
      getDiscountCodeFromUrl() ||
      root.getAttribute('data-discount-code') ||
      readStoredDiscountCode(this.shopDomain)
    );
    if (this.discountCode) writeStoredDiscountCode(this.shopDomain, this.discountCode);
    this.token = 0;
    if (!root.hasAttribute('data-ump-exact-measured')) {
      root.setAttribute('data-ump-exact-measured', 'false');
    }
    this.customerPricing = {
      status: 'loading',
      customerType: 'standard',
      statusLabel: '',
      pricingMode: 'standard_variant',
      hasCustomPricing: false,
      pricePerInch: 0,
      customerName: this.customerName,
      currency: this.currency
    };
    this.productConfig = {
      status: 'loading',
      builderConfig: null,
      customerOffer: null,
      error: ''
    };
    this.quote = {
      status: 'idle',
      key: '',
      token: 0,
      data: null,
      error: ''
    };
    this.exactCartNotice = '';
    this.exactCartStorageEnabled = exactCartStorageAvailable();
    this.state = {
      uploadId: '',
      itemId: '',
      fileName: '',
      localPreviewUrl: '',
      originalUrl: '',
      thumbnailUrl: '',
      widthIn: 0,
      heightIn: 0,
      widthPx: 0,
      heightPx: 0,
      effectiveDpi: 0,
      documentDpi: 0,
      sizingSource: '',
      selectedResult: null,
      selectedVariantId: '',
      copies: 1,
      status: 'idle',
      items: [],
      activeItemId: '',
      batchToken: 0
    };
    this.root.__umpUpload = this;
    this.bindDom();
    this.bindEvents();
    this.renderPriceStrip();
    this.customerPricingPromise = this.loadCustomerPricingContext();
    this.productConfigPromise = this.loadProductConfig();
    this.priceTableExpanded = false;
    this.restorePersistedItems();
    this.render();
    this.restoreReorderFromUrl();
  }

  // ── Session persistence ─────────────────────────────────────────────────
  // Ready uploads survive a page refresh: the serializable part of each item
  // is kept in localStorage (per shop/product/customer) and re-verified
  // against the server on restore, so purchased or expired uploads never
  // come back. Blob preview URLs are never stored (invalid after reload).
  var PERSIST_TTL_MS = 24 * 60 * 60 * 1000;

  MainProductUpload.prototype.getPersistKey = function() {
    return ['umpItems', this.shopDomain || 'shop', this.productId || 'product', this.customerId || 'guest'].join(':');
  };

  MainProductUpload.prototype.persistItems = function() {
    if (!this.exactCartStorageEnabled) return;
    try {
      // Every tab of this product shares the key. Keep the other tabs' saved
      // uploads and replace only the ones this tab has held (so a remove,
      // clear or add-to-cart here still drops them from the saved list).
      var own = this.ownUploadIds = this.ownUploadIds || {};
      (this.state.items || []).forEach(function(item) {
        if (item && item.uploadId) own[String(item.uploadId)] = true;
      });
      var stored = parseJson(window.localStorage.getItem(this.getPersistKey()), null);
      var storedFresh = stored && Array.isArray(stored.items) && stored.savedAt > 0 &&
        Date.now() - stored.savedAt <= PERSIST_TTL_MS;
      var otherTabs = storedFresh
        ? stored.items.filter(function(item) { return item && item.uploadId && !own[String(item.uploadId)]; })
        : [];
      var items = (this.state.items || []).filter(this.isCartReadyItem.bind(this)).map(function(item) {
        return {
          uploadId: item.uploadId,
          itemId: item.itemId,
          fileName: item.fileName,
          lastFile: item.lastFile ? { name: item.lastFile.name, size: item.lastFile.size, type: item.lastFile.type } : null,
          originalUrl: item.originalUrl,
          thumbnailUrl: item.thumbnailUrl,
          widthIn: item.widthIn,
          heightIn: item.heightIn,
          widthPx: item.widthPx,
          heightPx: item.heightPx,
          effectiveDpi: item.effectiveDpi,
          documentDpi: item.documentDpi,
          sizingSource: item.sizingSource,
          selectedResult: item.selectedResult,
          selectedVariantId: item.selectedVariantId,
          copies: Math.max(1, Number(item.copies) || 1),
          isMultipart: item.isMultipart,
          uploadStartTime: item.uploadStartTime,
          uploadEndTime: item.uploadEndTime
        };
      });
      items = otherTabs.concat(items);
      if (!items.length) {
        window.localStorage.removeItem(this.getPersistKey());
        return;
      }
      window.localStorage.setItem(this.getPersistKey(), JSON.stringify({ savedAt: Date.now(), items: items }));
    } catch (_) {}
  };

  MainProductUpload.prototype.restorePersistedItems = function() {
    if (!this.exactCartStorageEnabled) return;
    var stored = null;
    try { stored = parseJson(window.localStorage.getItem(this.getPersistKey()), null); } catch (_) { return; }
    if (!stored || !Array.isArray(stored.items) || !stored.items.length) return;
    if (!(stored.savedAt > 0) || Date.now() - stored.savedAt > PERSIST_TTL_MS) {
      try { window.localStorage.removeItem(this.getPersistKey()); } catch (_) {}
      return;
    }
    var items = stored.items.filter(function(item) {
      return item && item.uploadId && item.selectedVariantId && item.selectedResult;
    }).map(function(item) {
      item.status = 'ready';
      item.localPreviewUrl = '';
      item.copies = Math.max(1, Number(item.copies) || 1);
      // Saved by this or another tab of the same product; another tab may add
      // it to the cart before this one does (see addToCart).
      item.restored = true;
      return item;
    });
    if (!items.length) return;
    // Everything restored is this tab's to keep or drop: uploads the
    // verification below rejects (bought, in the cart, gone) must leave the
    // saved list instead of being kept as another tab's.
    var own = this.ownUploadIds = this.ownUploadIds || {};
    stored.items.forEach(function(item) {
      if (item && item.uploadId) own[String(item.uploadId)] = true;
    });

    // Optimistic restore, then server verification (drop purchased/expired).
    this.state.items = items;
    this.loadUploadItem(items[items.length - 1]);
    this.state.status = 'ready';
    this.setStage(null);
    var self = this;
    // Uploads already sitting in the Shopify cart belong to the cart now
    // (added in another tab, or the redirect after add-to-cart was interrupted).
    var cartCheck = fetch('/cart.js', { headers: { 'Accept': 'application/json' }, cache: 'no-store' })
      .then(function(res) { return res.ok ? res.json() : null; })
      .catch(function() { return null; });
    Promise.all(items.map(function(item) {
      return fetch(self.apiBase + '/api/upload/status/' + encodeURIComponent(item.uploadId) + '?shopDomain=' + encodeURIComponent(self.shopDomain))
        .then(function(res) { return res.ok ? res.json() : null; })
        .catch(function() { return null; });
    }).concat([cartCheck])).then(function(all) {
      var cart = all[all.length - 1];
      var results = all.slice(0, -1);
      var inCart = function(uploadId) {
        return Boolean(cart && (cart.items || []).some(function(line) { return cartLineMatchesUpload(line, uploadId); }));
      };
      var kept = [];
      results.forEach(function(status, index) {
        var item = items[index];
        if (!status || status.error) return;                 // gone on the server
        if (status.orderId) return;                           // already purchased
        if (inCart(item.uploadId)) return;                    // already in the cart
        var canAdd = !status.capabilities || status.capabilities.canAddToCart !== false;
        if (!canAdd) return;
        var first = status.items && status.items[0];
        if (first) {
          item.thumbnailUrl = first.thumbnailUrl || item.thumbnailUrl;
          item.originalUrl = first.originalUrl || item.originalUrl;
        }
        kept.push(item);
      });
      var currentId = self.state.uploadId;
      self.state.items = kept;
      if (!kept.length) {
        self.resetMeasurement(null);
        self.state.items = [];
      } else if (!kept.some(function(item) { return sameUploadId(item.uploadId, currentId); })) {
        self.loadUploadItem(kept[kept.length - 1]);
      } else {
        var current = kept.find(function(item) { return sameUploadId(item.uploadId, currentId); });
        if (current) self.loadUploadItem(current);
      }
      self.persistItems();
      // A reload while a server preview was still rendering: keep waiting for it.
      kept.forEach(function(item) {
        if (!item.thumbnailUrl) self.refreshThumbnail(item.uploadId, SERVER_THUMBNAIL_ATTEMPTS);
      });
      self.render();
    });
  };

  MainProductUpload.prototype.bindDom = function() {
    this.workspace = this.root.querySelector('.ump__workspace');
    this.dropzone = this.root.querySelector('[data-ump-dropzone]');
    this.input = this.root.querySelector('[data-ump-input]');
    this.trigger = this.root.querySelector('[data-ump-upload-trigger]');
    this.statusPanel = this.root.querySelector('[data-ump-status-panel]');
    this.fileName = this.root.querySelector('[data-ump-file-name]');
    this.fileMeta = this.root.querySelector('[data-ump-file-meta]');
    this.thumb = this.root.querySelector('[data-ump-thumb]');
    this.replace = this.root.querySelector('[data-ump-replace]');
    this.cancel = this.root.querySelector('[data-ump-cancel]');
    this.retry = this.root.querySelector('[data-ump-retry]');
    this.filePills = this.root.querySelector('[data-ump-file-pills]');
    this.pillSize = this.root.querySelector('[data-ump-pill-size]');
    this.pillType = this.root.querySelector('[data-ump-pill-type]');
    this.pillMultipart = this.root.querySelector('[data-ump-pill-multipart]');
    this.files = this.root.querySelector('[data-ump-files]');
    this.clearAll = this.root.querySelector('[data-ump-clear]');
    this.filesCount = this.root.querySelector('[data-ump-files-count]');
    this.sheetPlane = this.root.querySelector('[data-ump-sheet-plane]');
    this.sheetCut = this.root.querySelector('[data-ump-sheet-cut]');
    this.note = this.root.querySelector('[data-ump-note]');
    this.progressWrap = this.root.querySelector('[data-ump-progress-wrap]');
    this.progress = this.root.querySelector('[data-ump-progress]');
    this.progressText = this.root.querySelector('[data-ump-progress-text]');
    this.queue = this.root.querySelector('[data-ump-queue]');
    this.stage = this.root.querySelector('[data-ump-stage]');
    this.stageUpload = this.root.querySelector('[data-ump-stage-upload]');
    this.stageMeasure = this.root.querySelector('[data-ump-stage-measure]');
    this.stageReady = this.root.querySelector('[data-ump-stage-ready]');
    this.stageUploadLabel = this.root.querySelector('[data-ump-stage-upload-label]');
    this.stageMeasureLabel = this.root.querySelector('[data-ump-stage-measure-label]');
    this.stageReadyLabel = this.root.querySelector('[data-ump-stage-ready-label]');
    this.badge = this.root.querySelector('[data-ump-badge]');
    this.size = this.root.querySelector('[data-ump-size]');
    this.width = this.root.querySelector('[data-ump-width]');
    this.height = this.root.querySelector('[data-ump-height]');
    this.maxWidthLabel = this.root.querySelector('.ump__spec--max-width');
    if (this.maxWidthLabel) this.maxWidthLabel.textContent = formatInches(this.maxPrintableWidthIn) + ' maximum width';
    if (this.height && this.height.parentElement) {
      var heightLabel = this.height.parentElement.querySelector('span');
      if (heightLabel) heightLabel.textContent = 'Length';
    }
    this.sheetLabel = this.root.querySelector('[data-ump-sheet-label]');
    this.quality = this.root.querySelector('[data-ump-quality]');
    this.qualityBadge = this.root.querySelector('[data-ump-quality-badge]');
    this.qualityText = this.root.querySelector('[data-ump-quality-text]');
    this.method = this.root.querySelector('[data-ump-method]');
    this.sheet = this.root.querySelector('[data-ump-sheet]');
    this.art = this.root.querySelector('[data-ump-art]');
    this.artLabel = this.root.querySelector('[data-ump-art-label]');
    this.rulerTop = this.root.querySelector('[data-ump-ruler-top]');
    this.rulerSide = this.root.querySelector('[data-ump-ruler-side]');
    this.total = this.root.querySelector('[data-ump-total]');
    this.orderNoteWrap = this.root.querySelector('[data-ump-order-note-wrap]');
    this.orderNoteInput = this.root.querySelector('[data-ump-order-note]');
    this.totalValue = this.root.querySelector('[data-ump-total-value]');
    this.totalMeta = this.root.querySelector('[data-ump-total-meta]');
    this.totalLines = this.root.querySelector('[data-ump-total-lines]');
    this.artDimW = this.root.querySelector('[data-ump-art-dim-w]');
    this.artDimH = this.root.querySelector('[data-ump-art-dim-h]');
    this.addButton = this.root.querySelector('[data-ump-add]');
    this.checkoutButton = this.root.querySelector('[data-ump-checkout]');
    this.priceStrip = this.root.querySelector('[data-ump-price-strip]');
    this.priceTable = this.root.querySelector('[data-ump-price-table]');
    this.error = this.root.querySelector('[data-ump-error]');
    this.ensureCustomerPricingCard();
    this.ensureDiscountPanel();
    this.ensureExactCartPanel();
  };

  MainProductUpload.prototype.ensureCustomerPricingCard = function() {
    if (!this.workspace) return;
    this.customerCard = this.root.querySelector('[data-ump-customer-card]');
    if (!this.customerCard) {
      this.customerCard = document.createElement('div');
      this.customerCard.className = 'ump__customer-card';
      this.customerCard.setAttribute('data-ump-customer-card', '');
      this.customerCard.hidden = true;
      this.customerCard.innerHTML = [
        '<div class="ump__customer-card-copy">',
          '<span data-ump-customer-kicker>Account pricing</span>',
          '<strong data-ump-customer-title>Checking account pricing</strong>',
          '<small data-ump-customer-copy>Upload to unlock checkout.</small>',
        '</div>',
        '<div class="ump__customer-card-rate">',
          '<span>Rate</span>',
          '<strong data-ump-customer-rate>--</strong>',
        '</div>'
      ].join('');
      this.workspace.insertBefore(this.customerCard, this.workspace.firstChild);
    }
    this.customerKicker = this.root.querySelector('[data-ump-customer-kicker]');
    this.customerTitle = this.root.querySelector('[data-ump-customer-title]');
    this.customerCopy = this.root.querySelector('[data-ump-customer-copy]');
    this.customerRate = this.root.querySelector('[data-ump-customer-rate]');
    this.ensureExactNoteField();
  };

  MainProductUpload.prototype.ensureExactNoteField = function() {
    this.actions = this.root.querySelector('.ump__actions');
    if (!this.actions) return;
    this.noteWrap = this.root.querySelector('[data-ump-exact-note-wrap]');
    if (!this.noteWrap) {
      this.noteWrap = document.createElement('div');
      this.noteWrap.className = 'ump__exact-note';
      this.noteWrap.setAttribute('data-ump-exact-note-wrap', '');
      this.noteWrap.hidden = true;
      this.noteWrap.innerHTML = [
        '<label for="ump-exact-note-' + escapeHtml(this.root.getAttribute('data-section-id') || 'main') + '">Order note</label>',
        '<textarea id="ump-exact-note-' + escapeHtml(this.root.getAttribute('data-section-id') || 'main') + '" data-ump-exact-note rows="3" maxlength="500" placeholder="Add production notes for this exact measured order."></textarea>',
        '<small>Optional. This note is attached to the measured checkout for production.</small>'
      ].join('');
      this.actions.parentNode.insertBefore(this.noteWrap, this.actions);
    }
    this.noteInput = this.root.querySelector('[data-ump-exact-note]');
  };

  MainProductUpload.prototype.ensureDiscountPanel = function() {
    if (!this.priceStrip || !this.priceStrip.parentNode) return;
    this.discountPanel = this.root.querySelector('[data-ump-discount-panel]');
    if (!this.discountPanel) {
      this.discountPanel = document.createElement('div');
      this.discountPanel.className = 'ump__discount-panel';
      this.discountPanel.setAttribute('data-ump-discount-panel', '');
      this.discountPanel.innerHTML = [
        '<div class="ump__discount-copy">',
          '<span>Shopify discounts</span>',
          '<small data-ump-discount-message>Eligible automatic discounts are applied at checkout.</small>',
        '</div>',
        '<div class="ump__discount-code">',
          '<input data-ump-discount-input type="text" inputmode="text" autocomplete="off" placeholder="Discount code" maxlength="64">',
          '<button data-ump-discount-apply type="button">Apply</button>',
        '</div>'
      ].join('');
      this.priceStrip.parentNode.insertBefore(this.discountPanel, this.priceStrip.nextSibling);
    }
    this.discountInput = this.root.querySelector('[data-ump-discount-input]');
    this.discountApply = this.root.querySelector('[data-ump-discount-apply]');
    this.discountMessage = this.root.querySelector('[data-ump-discount-message]');
    if (this.discountInput) this.discountInput.value = this.discountCode || '';
  };

  MainProductUpload.prototype.getDiscountCode = function() {
    var inputValue = this.discountInput ? this.discountInput.value : this.discountCode;
    return normalizeDiscountCode(inputValue);
  };

  MainProductUpload.prototype.setDiscountCode = function(code) {
    this.discountCode = normalizeDiscountCode(code);
    if (this.discountInput && this.discountInput.value !== this.discountCode) {
      this.discountInput.value = this.discountCode;
    }
    writeStoredDiscountCode(this.shopDomain, this.discountCode);
    this.renderDiscountPanel();
  };

  MainProductUpload.prototype.renderDiscountPanel = function() {
    if (!this.discountPanel) return;
    var exact = this.isExactMeasuredMode();
    var offer = this.getLinearCustomerOffer();
    var shouldShow = exact || offer || Boolean(this.getDiscountCode());
    this.discountPanel.hidden = !shouldShow;
    if (!shouldShow) return;

    var code = this.getDiscountCode();
    if (this.discountMessage) {
      if (code) {
        this.discountMessage.textContent = 'Code ' + code + ' will be sent to checkout. Eligible automatic discounts stay enabled.';
      } else if (exact) {
        this.discountMessage.textContent = 'Eligible automatic Shopify discounts are enabled for this measured checkout. Enter a code if you have one.';
      } else {
        this.discountMessage.textContent = 'Eligible automatic Shopify discounts are applied at checkout. Enter a code if needed.';
      }
    }
    if (this.discountApply) {
      this.discountApply.textContent = code ? 'Applied' : 'Apply';
    }
  };

  MainProductUpload.prototype.ensureExactCartPanel = function() {
    if (!this.priceStrip || !this.priceStrip.parentNode) return;
    this.exactCartPanel = this.root.querySelector('[data-ump-exact-cart-panel]');
    if (!this.exactCartPanel) {
      this.exactCartPanel = document.createElement('div');
      this.exactCartPanel.className = 'ump__exact-cart';
      this.exactCartPanel.setAttribute('data-ump-exact-cart-panel', '');
      this.exactCartPanel.hidden = true;
      this.exactCartPanel.innerHTML = [
        '<div class="ump__exact-cart-head">',
          '<div>',
            '<span>Saved exact cart</span>',
            '<strong data-ump-exact-cart-title>No saved uploads</strong>',
          '</div>',
          '<button data-ump-exact-cart-clear type="button">Clear</button>',
        '</div>',
        '<div class="ump__exact-cart-list" data-ump-exact-cart-list></div>',
        '<button class="ump__exact-cart-checkout" data-ump-exact-cart-checkout type="button">Checkout saved uploads</button>'
      ].join('');
      var anchor = this.discountPanel || this.priceStrip;
      anchor.parentNode.insertBefore(this.exactCartPanel, anchor.nextSibling);
    }
    this.exactCartTitle = this.root.querySelector('[data-ump-exact-cart-title]');
    this.exactCartList = this.root.querySelector('[data-ump-exact-cart-list]');
    this.exactCartClear = this.root.querySelector('[data-ump-exact-cart-clear]');
    this.exactCartCheckout = this.root.querySelector('[data-ump-exact-cart-checkout]');
  };

  MainProductUpload.prototype.renderExactCartPanel = function() {
    if (!this.exactCartPanel) return;
    var entries = this.isExactMeasuredMode() ? this.readExactCart() : [];
    this.exactCartPanel.hidden = !entries.length;
    if (!entries.length) return;

    var total = exactCartTotal(entries);
    var currency = (entries[0] && entries[0].currency) || this.customerPricing.currency || this.currency;
    if (this.exactCartTitle) {
      this.exactCartTitle.textContent = entries.length + ' upload' + (entries.length === 1 ? '' : 's') + ' saved / ' + formatMoney(total, currency);
    }
    if (this.exactCartList) {
      this.exactCartList.innerHTML = entries.slice(0, 4).map(function(entry) {
        var size = entry.widthIn && entry.heightIn ? formatDisplaySheetDimensions(entry.widthIn, entry.heightIn) : 'Measured upload';
        var copies = Math.max(1, Number(entry.quantity || entry.copies) || 1);
        return [
          '<div class="ump__exact-cart-item">',
            '<span>', escapeHtml(entry.fileName || entry.productTitle || 'Gang sheet'), ' × ', copies, '</span>',
            '<strong>', escapeHtml(size), '</strong>',
          '</div>'
        ].join('');
      }).join('') + (entries.length > 4 ? '<small>+' + (entries.length - 4) + ' more saved upload' + (entries.length - 4 === 1 ? '' : 's') + '</small>' : '');
    }
  };

  MainProductUpload.prototype.getPriceVariants = function() {
    return (this.variants || []).filter(function(variant) {
      return variant && variant.available !== false && variant.availableForSale !== false;
    });
  };

  MainProductUpload.prototype.getExactCartKey = function() {
    var identity = this.customerId || this.customerEmail || 'guest';
    return [
      'umpExactMeasuredCart',
      this.shopDomain || 'shop',
      identity
    ].join(':');
  };

  MainProductUpload.prototype.readExactCart = function() {
    if (!this.exactCartStorageEnabled) return [];
    try {
      var raw = window.localStorage.getItem(this.getExactCartKey());
      var parsed = parseJson(raw, []);
      if (!Array.isArray(parsed)) return [];
      var now = Date.now();
      return parsed.filter(function(entry) {
        if (!entry || !entry.uploadId) return false;
        var addedAt = Number(entry.addedAt || 0);
        return !addedAt || now - addedAt < 14 * 24 * 60 * 60 * 1000;
      });
    } catch (_) {
      return [];
    }
  };

  MainProductUpload.prototype.writeExactCart = function(entries) {
    if (!this.exactCartStorageEnabled) return;
    try {
      if (!entries.length) {
        window.localStorage.removeItem(this.getExactCartKey());
        return;
      }
      window.localStorage.setItem(this.getExactCartKey(), JSON.stringify(entries));
    } catch (_) {}
  };

  MainProductUpload.prototype.mergeExactCartEntries = function(existing, additions) {
    var byUpload = {};
    existing.concat(additions).forEach(function(entry) {
      if (!entry || !entry.uploadId) return;
      byUpload[String(entry.uploadId)] = entry;
    });
    return Object.keys(byUpload).map(function(uploadId) { return byUpload[uploadId]; });
  };

  MainProductUpload.prototype.clearExactCart = function() {
    this.writeExactCart([]);
    this.exactCartNotice = '';
    this.render();
  };

  MainProductUpload.prototype.currentExactEntries = function() {
    var readyItems = this.getReadyItems();
    if (!readyItems.length) return [];
    var quote = this.quote.data || {};
    var quoteItems = Array.isArray(quote.items) ? quote.items : [];
    var quoteByUpload = {};
    quoteItems.forEach(function(item) {
      if (item && item.uploadId) quoteByUpload[String(item.uploadId)] = item;
    });
    var fallbackQuote = quote.quote || {};
    var note = this.getCustomerNote();

    return readyItems.map(function(item) {
      var quoteItem = quoteByUpload[String(item.uploadId)] || fallbackQuote || {};
      return {
        uploadId: item.uploadId,
        productId: this.productId,
        productTitle: this.productTitle,
        fileName: item.fileName || quoteItem.fileName || '',
        quantity: Math.max(1, Number(item.copies) || 1),
        selectedVariantId: item.selectedVariantId || this.getFallbackVariantId() || null,
        measurementPolicy: POLICY,
        widthIn: item.widthIn || quoteItem.pageWidthIn || 0,
        heightIn: item.heightIn || quoteItem.pageLengthIn || 0,
        billableLengthIn: quoteItem.billableLengthIn || fallbackQuote.billableLengthIn || 0,
        totalPrice: quoteItem.totalPrice || fallbackQuote.totalPrice || 0,
        pricePerInch: quoteItem.pricePerInch || fallbackQuote.pricePerInch || this.customerPricing.pricePerInch || 0,
        currency: quote.currency || fallbackQuote.currencyCode || this.customerPricing.currency || this.currency,
        customerNote: note,
        addedAt: Date.now()
      };
    }, this);
  };

  MainProductUpload.prototype.isCurrentExactUploadSaved = function() {
    if (!this.state.uploadId) return false;
    return this.readExactCart().some(function(entry) {
      return String(entry.uploadId) === String(this.state.uploadId) &&
        Math.max(1, Number(entry.quantity || entry.copies) || 1) === this.getRequestedCopies();
    }, this);
  };

  MainProductUpload.prototype.getExactCheckoutEntries = function() {
    var saved = this.readExactCart();
    var current = this.quote.status === 'ready' && this.quote.data ? this.currentExactEntries() : [];
    return this.mergeExactCartEntries(saved, current);
  };

  MainProductUpload.prototype.buildExactCheckoutNote = function(entries) {
    var notes = entries
      .map(function(entry) {
        var note = getText(entry.customerNote, '');
        if (!note) return '';
        return (entry.fileName || entry.uploadId || 'Upload') + ': ' + note;
      })
      .filter(Boolean);
    var currentNote = this.getCustomerNote();
    if (currentNote && !notes.some(function(note) { return note.indexOf(currentNote) >= 0; })) {
      notes.push('Current upload: ' + currentNote);
    }
    return notes.join('\n').slice(0, 500);
  };

  MainProductUpload.prototype.isLinearInchPricing = function() {
    var config = this.productConfig.builderConfig || {};
    if (config.volumeDiscountTierUnit === 'linear_inches') return true;
    if (config.alphaProDiscount && config.alphaProDiscount.unit === 'linear_inches') return true;
    var items = this.getReadyItems ? this.getReadyItems() : [];
    return items.some(function(item) {
      return item && item.selectedResult && item.selectedResult.pricingMode === 'linear_inches';
    });
  };

  MainProductUpload.prototype.getLinearCustomerOffer = function() {
    var config = this.productConfig.builderConfig || {};
    var offer = this.productConfig.customerOffer || config.customerOffer || null;
    return offer && offer.enabled === true ? offer : null;
  };

  MainProductUpload.prototype.getLinearTiers = function() {
    var offer = this.getLinearCustomerOffer();
    if (offer && Array.isArray(offer.tiers) && offer.tiers.length) return offer.tiers;
    var config = this.productConfig.builderConfig || {};
    return Array.isArray(config.volumeDiscountTiers) ? config.volumeDiscountTiers : [];
  };

  MainProductUpload.prototype.getActiveLinearTier = function(billable) {
    var tiers = this.getLinearTiers();
    var basis = Number(billable) || 0;
    for (var i = 0; i < tiers.length; i += 1) {
      var tier = tiers[i] || {};
      var min = Number(tier.min_qty) || 0;
      var max = tier.max_qty == null || tier.max_qty === '' ? Infinity : Number(tier.max_qty);
      if (basis >= min && basis <= max) return tier;
    }
    return tiers[0] || null;
  };

  MainProductUpload.prototype.getLinearSummary = function(items) {
    var billable = 0;
    var cartQuantity = 0;
    var sampleResult = null;
    items.forEach(function(item) {
      var result = item && item.selectedResult ? item.selectedResult : {};
      sampleResult = sampleResult || result;
      var length = toNumber(result.billableLengthIn) || Math.max(toNumber(item && item.widthIn), toNumber(item && item.heightIn));
      billable += length;
      cartQuantity += Math.max(1, Number(result.cartQuantity || result.wholeSheetCopies) || Math.ceil(length || 1));
    });
    billable = Number(billable.toFixed(2));

    var tierPrice = this.getLinearCustomerOffer() ? getTierUnitPrice(this.getActiveLinearTier(billable || 1)) : 0;
    var unitPrice = tierPrice || toNumber(sampleResult && (sampleResult.pricePerInch || sampleResult.unitPrice));
    return {
      billable: billable,
      cartQuantity: cartQuantity,
      unitPrice: unitPrice,
      total: unitPrice ? Number((cartQuantity * unitPrice).toFixed(2)) : 0
    };
  };

  MainProductUpload.prototype.renderPriceStrip = function() {
    if (!this.priceStrip) return;
    if (this.isExactMeasuredMode()) {
      var readyItems = this.getReadyItems();
      var data = this.quote && this.quote.data ? this.quote.data : {};
      var billable = toNumber(data.billableLengthIn || (data.quote && data.quote.billableLengthIn));
      var total = data.quoteTotal != null ? data.quoteTotal : data.totalPrice;
      var rate = toNumber(data.pricePerInch || (data.quote && data.quote.pricePerInch)) || toNumber(this.customerPricing.pricePerInch);
      var quoteReady = Boolean(this.quote.status === 'ready' && this.quote.data);
      var quoteTitle = !readyItems.length
        ? 'Upload required'
        : this.quote.status === 'loading'
          ? 'Calculating exact quote'
          : this.quote.status === 'error'
            ? 'Quote unavailable'
            : quoteReady
              ? formatMoney(total, data.currency || this.customerPricing.currency || this.currency)
              : 'Preparing quote';
      var quoteMeta = !readyItems.length
        ? 'No sheet-size rounding. You pay from the measured uploaded length.'
        : this.quote.status === 'error'
          ? (this.quote.error || 'Exact quote failed.')
          : quoteReady
            ? (billable ? formatInches(billable) + ' billable length' : 'Measured billable length') + ' / ' + readyItems.length + ' file' + (readyItems.length === 1 ? '' : 's')
            : 'The server is applying your per-inch rate to the measured upload.';
      var exactCart = this.readExactCart();
      if (exactCart.length) {
        quoteMeta += ' Exact cart: ' + exactCart.length + ' saved upload' + (exactCart.length === 1 ? '' : 's') +
          ' / ' + formatMoney(exactCartTotal(exactCart), data.currency || this.customerPricing.currency || this.currency) +
          '. Checkout includes saved exact uploads.';
      }
      if (this.exactCartNotice) {
        quoteMeta = this.exactCartNotice + ' ' + quoteMeta;
      }

      this.priceStrip.innerHTML = [
        '<div class="ump__price-head ump__price-head--exact">',
          '<span>Exact measured pricing</span>',
          '<strong>No variant rounding</strong>',
        '</div>',
        '<div class="ump__exact-price">',
          '<div>',
            '<small>Rate</small>',
            '<strong>', escapeHtml(rate ? formatMoney(rate, this.customerPricing.currency || this.currency) + ' / in' : '--'), '</strong>',
          '</div>',
          '<div>',
            '<small>Billable</small>',
            '<strong>', escapeHtml(billable ? formatInches(billable) : '--'), '</strong>',
          '</div>',
          '<div>',
            '<small>Total</small>',
            '<strong>', escapeHtml(quoteTitle), '</strong>',
          '</div>',
        '</div>',
        '<p class="ump__exact-meta">', escapeHtml(quoteMeta), '</p>'
      ].join('');
      this.priceStrip.hidden = false;
      return;
    }

    var linear = this.isLinearInchPricing();
    var offer = this.getLinearCustomerOffer();
    var tiers = this.getLinearTiers();
    if (linear && tiers.length) {
      var lineItems = this.getReadyItems();
      var summary = this.getLinearSummary(lineItems);
      var activeTier = this.getActiveLinearTier(summary.billable || 1);
      var tierHtml = tiers.map(function(tier) {
        var price = getTierUnitPrice(tier);
        var active = activeTier && String(activeTier.min_qty) === String(tier.min_qty) && String(activeTier.max_qty) === String(tier.max_qty);
        return [
          '<span class="ump__price-chip ump__price-chip--tier', active ? ' is-active' : '', '" role="listitem">',
            '<small>', escapeHtml(getTierLabel(tier)), tier.popular ? ' / Popular' : '', '</small>',
            '<strong>', escapeHtml(price ? formatMoney(price, this.currency) + ' / in' : '--'), '</strong>',
          '</span>'
        ].join('');
      }, this).join('');
      var title = offer ? 'Your discounted inch pricing' : 'Measured inch pricing';
      var meta = !lineItems.length
        ? 'Discount tiers apply automatically after upload when your account is eligible.'
        : summary.unitPrice
          ? formatInches(summary.billable) + ' measured billable inches / ' + summary.cartQuantity + ' cart inch unit' + (summary.cartQuantity === 1 ? '' : 's') + ' / estimated ' + formatMoney(summary.total, this.currency)
          : 'Measured inch pricing is ready.';

      this.priceStrip.innerHTML = [
        '<div class="ump__price-head ump__price-head--linear">',
          '<span>', escapeHtml(title), '</span>',
          '<strong>', escapeHtml(offer ? 'Auto-applied for your account' : 'Auto-selected after upload'), '</strong>',
        '</div>',
        '<div class="ump__price-row" role="list">',
          tierHtml,
        '</div>',
        '<p class="ump__exact-meta">', escapeHtml(meta), '</p>'
      ].join('');
      this.priceStrip.hidden = false;
      return;
    }

    // Standard variant pricing lives in the table under the upload card
    // (renderPriceTable); the inspector strip is only for exact/linear modes.
    this.priceStrip.hidden = true;
    this.priceStrip.innerHTML = '';
  };

  // Variant price table: every Shopify sheet variant as a row; the sheet(s)
  // auto-selected for the uploaded file(s) turn green with a quantity pill.
  MainProductUpload.prototype.renderPriceTable = function() {
    if (!this.priceTable) return;
    if (this.isExactMeasuredMode() || this.isLinearInchPricing()) {
      this.priceTable.hidden = true;
      this.priceTable.innerHTML = '';
      return;
    }
    var variants = (this.variants || []).filter(function(v) { return v && v.id; });
    if (!variants.length) {
      this.priceTable.hidden = true;
      this.priceTable.innerHTML = '';
      return;
    }
    var readyItems = this.getReadyItems();
    var qtyByVariant = {};
    readyItems.forEach(function(item) {
      var result = item.selectedResult || {};
      var qty = Math.max(1, Number(item.copies) || 1);
      var id = String(item.selectedVariantId || '');
      if (id) qtyByVariant[id] = (qtyByVariant[id] || 0) + qty;
    });
    var pendingId = !readyItems.length && this.state.selectedVariantId ? String(this.state.selectedVariantId) : '';
    var selectedCount = Object.keys(qtyByVariant).length;
    var isSelected = function(variant) {
      var id = String(variant.id);
      return (qtyByVariant[id] || 0) > 0 || (pendingId && pendingId === id);
    };

    // Collapsed by default: the chosen size(s) with two neighbours each side,
    // so 40 rows never push the cart button off screen. "Show all" expands.
    var NEIGHBOURS = 2;
    var visibleIndex = {};
    var anySelected = variants.some(isSelected);
    if (this.priceTableExpanded || !anySelected) {
      variants.forEach(function(_, i) { visibleIndex[i] = true; });
    } else {
      variants.forEach(function(variant, i) {
        if (!isSelected(variant)) return;
        for (var j = Math.max(0, i - NEIGHBOURS); j <= Math.min(variants.length - 1, i + NEIGHBOURS); j += 1) visibleIndex[j] = true;
      });
    }
    var hiddenCount = variants.length - Object.keys(visibleIndex).length;
    var expandedNoSelection = !anySelected && variants.length > 8 && !this.priceTableExpanded;
    if (expandedNoSelection) {
      // Nothing measured yet: show the first rows only.
      visibleIndex = {};
      variants.forEach(function(_, i) { if (i < 6) visibleIndex[i] = true; });
      hiddenCount = variants.length - 6;
    }

    var rows = [];
    var lastShown = -1;
    variants.forEach(function(variant, i) {
      if (!visibleIndex[i]) return;
      if (lastShown >= 0 && i - lastShown > 1) {
        rows.push('<tr class="is-gap"><td colspan="2">···</td></tr>');
      }
      lastShown = i;
      var id = String(variant.id);
      var qty = qtyByVariant[id] || 0;
      var selected = isSelected(variant);
      var unavailable = variant.available === false || variant.availableForSale === false;
      rows.push([
        '<tr class="', selected ? 'is-selected' : '', unavailable ? ' is-unavailable' : '', '">',
          '<td>', selected ? '<span class="ump__price-check">✓</span>' : '', '<strong>', escapeHtml(getVariantLabel(variant)), '</strong>',
            selected ? '<span class="ump__price-auto">' + (this.state.provisional && !qty ? 'Estimated' : 'Auto') + '</span>' : '',
            qty > 1 ? '<span class="ump__price-qty">×' + qty + '</span>' : '',
          '</td>',
          '<td>', escapeHtml(formatMoney(variantPriceToDollars(variant.price), this.currency)), '</td>',
        '</tr>'
      ].join(''));
    }, this);

    var noticeHtml = selectedCount
      ? '<p class="ump__price-notice" role="status">Sheet size chosen automatically from your file\'s measured size. Check it before adding to cart.</p>'
      : '';
    var moreHtml = hiddenCount > 0 || this.priceTableExpanded
      ? '<button type="button" class="ump__btn ump__btn--ghost ump__price-more" data-ump-price-more>' +
          (this.priceTableExpanded ? 'Show fewer sizes' : 'Show all ' + variants.length + ' sizes') +
        '</button>'
      : '';

    this.priceTable.innerHTML = [
      '<div class="ump__price-table-head">',
        '<span>Sizes &amp; prices</span>',
        '<small>', selectedCount ? 'Chosen for your file' : (pendingId && this.state.provisional ? 'Estimated · confirming' : 'Chosen after upload'), '</small>',
      '</div>',
      noticeHtml,
      '<table class="ump__price-table">',
        '<thead><tr><th>Sheet</th><th>Price</th></tr></thead>',
        '<tbody>', rows.join(''), '</tbody>',
      '</table>',
      moreHtml
    ].join('');
    this.priceTable.hidden = false;
  };

  MainProductUpload.prototype.loadCustomerPricingContext = async function() {
    if (!this.shopDomain || !this.productId) {
      this.customerPricing.status = 'ready';
      this.renderCustomerPricingCard();
      return;
    }

    if (!this.customerId) {
      this.customerId = getCustomerIdFromGlobals();
      if (this.customerId) this.root.setAttribute('data-customer-id', this.customerId);
    }

    try {
      var response = await fetch(this.apiBase + '/api/vip/context' + buildQuery({
        shop: this.shopDomain,
        shopDomain: this.shopDomain,
        productId: this.productId,
        customerId: this.customerId,
        customerEmail: this.customerEmail
      }), { credentials: 'same-origin' });
      var data = await response.json().catch(function() { return {}; });
      if (!response.ok) throw new Error(data.error || 'Failed to load customer pricing.');

      var pricingMode = getText(data.pricingMode, 'standard_variant').toLowerCase();
      var customerType = getText(data.customerType, 'standard').toLowerCase();
      this.customerPricing.status = 'ready';
      this.customerPricing.customerType = customerType;
      this.customerPricing.statusLabel = getText(data.statusLabel, '');
      this.customerPricing.pricingMode = pricingMode;
      this.customerPricing.hasCustomPricing = Boolean(
        data.hasCustomPricing === true ||
        (pricingMode !== 'standard_variant' && ['business', 'vip'].indexOf(customerType) >= 0)
      );
      this.customerPricing.pricePerInch = toNumber(data.pricePerInch);
      this.customerPricing.customerName = getText(data.customerName || (data.assignment && data.assignment.customerName), this.customerName);
      this.customerPricing.currency = getText(data.currency, this.currency);
      this.root.setAttribute(
        'data-ump-exact-measured',
        this.customerPricing.hasCustomPricing && pricingMode === 'measured_length' ? 'true' : 'false'
      );
    } catch (error) {
      this.customerPricing.status = 'ready';
      this.customerPricing.customerType = 'standard';
      this.customerPricing.statusLabel = '';
      this.customerPricing.pricingMode = 'standard_variant';
      this.customerPricing.hasCustomPricing = false;
      this.customerPricing.pricePerInch = 0;
      this.customerPricing.customerName = this.customerName;
      this.root.setAttribute('data-ump-exact-measured', 'false');
    }

    this.renderCustomerPricingCard();
    this.renderPriceStrip();
    this.render();
  };

  MainProductUpload.prototype.loadProductConfig = async function() {
    if (!this.shopDomain || !this.productId) {
      this.productConfig.status = 'ready';
      this.renderCustomerPricingCard();
      this.renderPriceStrip();
      return;
    }

    try {
      var response = await fetch(this.apiBase + '/api/product-config/' + encodeURIComponent(this.productId) + buildQuery({
        shop: this.shopDomain,
        customerId: this.customerId,
        customerEmail: this.customerEmail,
        customerName: this.customerName
      }), { credentials: 'same-origin' });
      var data = await response.json().catch(function() { return {}; });
      if (!response.ok) throw new Error(data.error || 'Failed to load product configuration.');
      var builderConfig = data.builderConfig || {};
      this.productConfig.status = 'ready';
      this.productConfig.builderConfig = builderConfig;
      this.productConfig.customerOffer = builderConfig.customerOffer || null;
      if (toNumber(builderConfig.maxPrintableWidthIn) > 0) {
        this.maxPrintableWidthIn = toNumber(builderConfig.maxPrintableWidthIn);
      }
      this.root.setAttribute('data-max-printable-width-in', String(this.maxPrintableWidthIn));
      if (this.maxWidthLabel) this.maxWidthLabel.textContent = formatInches(this.maxPrintableWidthIn) + ' maximum width';
      this.productConfig.error = '';
    } catch (error) {
      this.productConfig.status = 'ready';
      this.productConfig.builderConfig = null;
      this.productConfig.customerOffer = null;
      this.productConfig.error = error && error.message ? error.message : 'Failed to load product configuration.';
    }

    this.renderCustomerPricingCard();
    this.renderPriceStrip();
    this.render();
  };

  MainProductUpload.prototype.renderCustomerPricingCard = function() {
    if (!this.customerCard) return;
    var exact = this.isExactMeasuredMode();
    var offer = this.getLinearCustomerOffer();
    var linear = this.isLinearInchPricing();
    this.root.classList.toggle('is-exact-measured', exact);
    this.root.classList.toggle('is-linear-inch-pricing', linear);
    this.root.classList.toggle('is-customer-offer', Boolean(offer));
    this.customerCard.hidden = !(exact || offer);
    if (!exact && !offer) return;

    if (offer) {
      var offerName = getText(offer.customerName || this.customerPricing.customerName, this.customerName || 'valued customer');
      var sampleTier = this.getActiveLinearTier(1);
      var sampleRate = getTierUnitPrice(sampleTier);
      if (this.customerKicker) this.customerKicker.textContent = 'Returning customer pricing';
      if (this.customerTitle) {
        this.customerTitle.textContent = getText(
          offer.headline,
          'Dear valued customer ' + offerName + ', your discounted inch pricing is active.'
        );
      }
      if (this.customerCopy) {
        this.customerCopy.textContent = getText(
          offer.body,
          'Your discounted prices update automatically from the measured billable inches.'
        );
      }
      if (this.customerRate) {
        this.customerRate.textContent = sampleRate ? 'From ' + formatMoney(sampleRate, this.currency) + ' / in' : 'Tier pricing';
      }
      return;
    }

    var name = getText(this.customerPricing.customerName, 'valued customer');
    var rate = toNumber(this.customerPricing.pricePerInch);
    if (this.customerKicker) this.customerKicker.textContent = getText(this.customerPricing.statusLabel, 'Exact measured pricing');
    if (this.customerTitle) {
      this.customerTitle.textContent = 'Dear valued customer ' + name + ', your exact measured pricing is active.';
    }
    if (this.customerCopy) {
      this.customerCopy.textContent = 'We charge the measured upload length at your assigned rate. No sheet-size variant rounding will be used.';
    }
    if (this.customerRate) {
      this.customerRate.textContent = rate ? formatMoney(rate, this.customerPricing.currency || this.currency) + ' / in' : '--';
    }
  };

  MainProductUpload.prototype.renderExactNoteField = function() {
    if (!this.noteWrap) return;
    this.noteWrap.hidden = !this.isExactMeasuredMode() || !(this.getReadyItems().length || this.readExactCart().length);
  };

  MainProductUpload.prototype.getCustomerNote = function() {
    if (!this.noteInput) return '';
    return String(this.noteInput.value || '').trim().slice(0, 500);
  };

  MainProductUpload.prototype.bindEvents = function() {
    var self = this;
    // Third-party gang-sheet apps (e.g. DripApps) overwrite onclick on cart
    // buttons they think they own, but skip elements marked data-gs-event.
    // Our buttons are ours; make that explicit.
    [this.addButton, this.checkoutButton, this.trigger, this.replace].forEach(function(button) {
      if (button && button.dataset) button.dataset.gsEvent = 'click';
    });
    this.trigger.addEventListener('click', function(event) {
      event.preventDefault();
      self.input.click();
    });
    this.replace.addEventListener('click', function(event) {
      event.preventDefault();
      self.input.click();
    });
    if (this.clearAll) {
      this.clearAll.addEventListener('click', function(event) {
        event.preventDefault();
        self.clearAllUploads();
      });
    }
    if (this.cancel) {
      this.cancel.addEventListener('click', function(event) {
        event.preventDefault();
        self.cancelUpload();
      });
    }
    if (this.retry) {
      this.retry.addEventListener('click', function(event) {
        event.preventDefault();
        if (self.state.lastFile) self.startUploads([self.state.lastFile]);
      });
    }
    if (this.queue) {
      this.queue.addEventListener('click', function(event) {
        var removeButton = event.target.closest('[data-ump-remove-item]');
        if (removeButton) {
          event.preventDefault();
          self.removeUploadItem(removeButton.getAttribute('data-ump-remove-item'));
          return;
        }
        var selectButton = event.target.closest('[data-ump-select-item]');
        if (selectButton) {
          event.preventDefault();
          self.selectUploadItem(selectButton.getAttribute('data-ump-select-item'));
        }
      });
    }
    this.dropzone.addEventListener('click', function(event) {
      if (event.target === self.trigger || self.trigger.contains(event.target)) return;
      self.input.click();
    });
    this.input.addEventListener('change', function(event) {
      var files = toFileArray(event.target.files);
      event.target.value = '';
      if (files.length) self.startUploads(files);
    });
    // Drag & drop: capture phase + stopPropagation so document-level handlers
    // from other storefront apps can neither swallow the drop nor navigate
    // the browser to the file. dragenter/dragover must preventDefault for the
    // drop event to fire at all.
    ['dragenter', 'dragover'].forEach(function(type) {
      self.dropzone.addEventListener(type, function(event) {
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
        self.dropzone.classList.add('is-dragover');
      }, true);
    });
    this.dropzone.addEventListener('dragleave', function(event) {
      // Ignore leaves into child elements; only clear when leaving the card.
      if (event.relatedTarget && self.dropzone.contains(event.relatedTarget)) return;
      self.dropzone.classList.remove('is-dragover');
    }, true);
    this.dropzone.addEventListener('drop', function(event) {
      event.preventDefault();
      event.stopPropagation();
      self.dropzone.classList.remove('is-dragover');
      var files = toFileArray(event.dataTransfer && event.dataTransfer.files);
      if (files.length) self.startUploads(files);
    }, true);
    // Dropping anywhere else on the page must not open the file in the tab.
    window.addEventListener('dragover', function(event) { event.preventDefault(); });
    window.addEventListener('drop', function(event) { event.preventDefault(); });
    // Back from /cart restores this page from the bfcache mid-redirect:
    // release the cart lock so the buttons work again.
    window.addEventListener('pageshow', function(event) {
      if (!event.persisted || !self.cartBusy) return;
      self.cartBusy = false;
      self.render();
    });
    this.addButton.addEventListener('click', function() {
      if (self.isExactMeasuredMode()) {
        self.addExactMeasuredToCart();
        return;
      }
      self.addToCart('/cart');
    });
    if (this.checkoutButton) {
      this.checkoutButton.addEventListener('click', function() {
        if (self.isExactMeasuredMode()) {
          self.handleExactMeasuredCheckout('/checkout');
          return;
        }
        self.addToCart('/checkout');
      });
    }
    // Per-file whole-sheet quantity lives in each queue row (delegated).
    // Re-resolving keeps account pricing and the selected variant current.
    if (this.queue) {
      this.queue.addEventListener('click', function(event) {
        var minus = event.target.closest('[data-ump-copies-minus]');
        var plus = event.target.closest('[data-ump-copies-plus]');
        var control = minus || plus;
        if (!control) return;
        event.preventDefault();
        event.stopPropagation();
        var uploadId = control.getAttribute('data-upload-id');
        var item = self.findItem(uploadId);
        if (!item) return;
        self.setItemCopies(uploadId, (Number(item.copies) || 1) + (plus ? 1 : -1));
      });
      this.queue.addEventListener('change', function(event) {
        var input = event.target.closest('[data-ump-copies-input]');
        if (!input) return;
        self.setItemCopies(input.getAttribute('data-upload-id'), input.value);
      });
    }
    if (this.priceTable) {
      this.priceTable.addEventListener('click', function(event) {
        var toggle = event.target.closest('[data-ump-price-more]');
        if (!toggle) return;
        event.preventDefault();
        self.priceTableExpanded = !self.priceTableExpanded;
        self.renderPriceTable();
      });
    }
    // The finished-sheet preview is drawn in pixels; redraw whenever the plane resizes.
    if (this.sheetPlane && typeof ResizeObserver === 'function') {
      this.previewResizeObserver = new ResizeObserver(function() { self.updatePreviewGeometry(); });
      this.previewResizeObserver.observe(this.sheetPlane);
    }
    if (this.discountInput) {
      this.discountInput.addEventListener('input', function() {
        self.discountCode = normalizeDiscountCode(self.discountInput.value);
        self.renderDiscountPanel();
      });
      this.discountInput.addEventListener('change', function() {
        self.setDiscountCode(self.discountInput.value);
      });
    }
    if (this.discountApply) {
      this.discountApply.addEventListener('click', function(event) {
        event.preventDefault();
        self.setDiscountCode(self.discountInput ? self.discountInput.value : self.discountCode);
      });
    }
    if (this.exactCartClear) {
      this.exactCartClear.addEventListener('click', function(event) {
        event.preventDefault();
        self.clearExactCart();
      });
    }
    if (this.exactCartCheckout) {
      this.exactCartCheckout.addEventListener('click', function(event) {
        event.preventDefault();
        self.handleExactMeasuredCheckout('/checkout');
      });
    }
  };

  MainProductUpload.prototype.setError = function(message) {
    if (!this.error) return;
    if (!message) {
      this.error.hidden = true;
      this.error.textContent = '';
      return;
    }
    this.error.hidden = false;
    this.error.textContent = message;
  };

  MainProductUpload.prototype.setProgress = function(value) {
    if (!this.progress || !this.progressWrap) return;
    this.progressWrap.hidden = !(value > 0 && value < 100);
    this.progress.style.width = Math.max(0, Math.min(100, value)) + '%';
  };

  function formatBytes(n) {
    if (!(n > 0)) return '0 B';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
    return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  function formatEta(seconds) {
    if (!isFinite(seconds) || seconds <= 0) return '';
    if (seconds < 60) return '~' + Math.ceil(seconds) + 's left';
    if (seconds < 3600) return '~' + Math.ceil(seconds / 60) + 'm left';
    return '~' + Math.ceil(seconds / 3600) + 'h left';
  }

  function extFromName(name) {
    var i = String(name || '').lastIndexOf('.');
    return i >= 0 ? String(name).substring(i + 1).toLowerCase() : '';
  }

  function toFileArray(files) {
    if (!files) return [];
    return Array.prototype.slice.call(files).filter(function(file) {
      return file && file.name;
    });
  }

  function sameUploadId(a, b) {
    return String(a || '') === String(b || '');
  }

  MainProductUpload.prototype.setProgressText = function(loaded, total) {
    if (!this.progressText) return;
    if (!(loaded > 0) || !(total > 0)) {
      this.progressText.hidden = true;
      this.progressText.textContent = '';
      return;
    }
    if (window.ULUploadTelemetry && window.ULUploadTelemetry.create) {
      if (!this.state.uploadTelemetry) {
        this.state.uploadTelemetry = window.ULUploadTelemetry.create();
      }
      var snapshot = this.state.uploadTelemetry.tick(loaded, total);
      this.progressText.hidden = false;
      this.progressText.innerHTML =
        '<span><strong>' + snapshot.loadedText + '</strong> / ' + snapshot.totalText + '</span>' +
        '<span>Your internet speed: ' + snapshot.speedText + (snapshot.etaText ? ' • ' + snapshot.etaText : '') + '</span>' +
        (snapshot.advisory ? '<span>' + snapshot.advisory + '</span>' : '');
      return;
    }
    var elapsedSec = Math.max(0.001, (Date.now() - (this.state.uploadStartTime || Date.now())) / 1000);
    var speed = loaded / elapsedSec;
    var remaining = speed > 0 ? (total - loaded) / speed : 0;
    var speedMBs = (speed / (1024 * 1024)).toFixed(1);
    this.progressText.hidden = false;
    this.progressText.innerHTML =
      '<span><strong>' + formatBytes(loaded) + '</strong> / ' + formatBytes(total) + '</span>' +
      '<span>' + speedMBs + ' MB/s' + (formatEta(remaining) ? ' • ' + formatEta(remaining) : '') + '</span>';
  };

  MainProductUpload.prototype.setStage = function(activeStage) {
    if (!this.stage) return;
    if (!activeStage) { this.stage.hidden = true; return; }
    this.stage.hidden = false;
    var stages = ['upload', 'measure', 'ready'];
    var activeIdx = stages.indexOf(activeStage);
    var self = this;
    stages.forEach(function(s, i) {
      var dot = self['stage' + s.charAt(0).toUpperCase() + s.slice(1)];
      var lbl = self['stage' + s.charAt(0).toUpperCase() + s.slice(1) + 'Label'];
      if (!dot || !lbl) return;
      dot.classList.toggle('is-active', i === activeIdx);
      dot.classList.toggle('is-done', i < activeIdx);
      lbl.classList.toggle('is-active', i === activeIdx);
      lbl.classList.toggle('is-done', i < activeIdx);
    });
  };

  MainProductUpload.prototype.cancelUpload = function() {
    if (this.state.abort) {
      try { this.state.abort(); } catch (_) {}
    }
    this.token += 1; // invalidate in-flight callbacks
    this.state.batchToken = (this.state.batchToken || 0) + 1;
    this.state.status = 'idle';
    this.state.abort = null;
    this.setProgress(0);
    this.setProgressText(0, 0);
    this.setStage(null);
    this.setError('Upload cancelled.');
    this.render();
  };

  MainProductUpload.prototype.renderFilePills = function(file, isMultipart) {
    if (!this.filePills) return;
    if (!file) { this.filePills.hidden = true; return; }
    this.filePills.hidden = false;
    if (this.pillSize) this.pillSize.textContent = formatBytes(file.size);
    if (this.pillType) {
      var ext = extFromName(file.name) || (file.type && file.type.split('/')[1]) || 'file';
      this.pillType.textContent = ext.toUpperCase();
    }
    if (this.pillMultipart) this.pillMultipart.hidden = !isMultipart;
  };

  MainProductUpload.prototype.renderQuality = function() {
    if (!this.quality || !this.qualityBadge || !this.qualityText) return;
    var dpi = this.state.effectiveDpi || this.state.documentDpi || 0;
    if (!(dpi > 0)) { this.quality.hidden = true; return; }
    this.quality.hidden = false;
    var tone, label;
    if (dpi >= 250) { tone = 'excellent'; label = 'Excellent print quality'; }
    else if (dpi >= 150) { tone = 'good'; label = 'Good print quality'; }
    else if (dpi >= 100) { tone = 'warn'; label = 'Acceptable — may show some pixelation'; }
    else { tone = 'low'; label = 'Lower DPI — may pixelate when printed'; }
    this.quality.classList.remove('is-excellent', 'is-good', 'is-warn', 'is-low');
    this.quality.classList.add('is-' + tone);
    this.qualityBadge.textContent = Math.round(dpi) + ' DPI';
    this.qualityText.textContent = label;
  };

  MainProductUpload.prototype.resetMeasurement = function(file) {
    if (this.state.abort) {
      try { this.state.abort(); } catch (_) {}
    }
    this.token += 1;
    var savedItems = this.state.items || [];
    var savedBatchToken = this.state.batchToken || 0;
    var currentPreviewIsSaved = savedItems.some(function(item) {
      return item && item.localPreviewUrl === this.state.localPreviewUrl;
    }.bind(this));
    if (this.state.localPreviewUrl) {
      if (!currentPreviewIsSaved) {
        try { URL.revokeObjectURL(this.state.localPreviewUrl); } catch (_) {}
      }
    }
    this.state = {
      uploadId: '',
      itemId: '',
      fileName: file ? file.name : '',
      lastFile: file || null,
      fastRaster: Boolean(
        file && window.ULFileProbe && window.ULFileProbe.isFastRasterFile &&
        window.ULFileProbe.isFastRasterFile(file)
      ),
      localPreviewUrl:
        file && window.ULFileProbe && window.ULFileProbe.isBrowserPreviewable &&
        window.ULFileProbe.isBrowserPreviewable(file)
          ? URL.createObjectURL(file)
          : '',
      originalUrl: '',
      thumbnailUrl: '',
      widthIn: 0,
      heightIn: 0,
      widthPx: 0,
      heightPx: 0,
      effectiveDpi: 0,
      documentDpi: 0,
      sizingSource: '',
      selectedResult: null,
      selectedVariantId: '',
      provisional: false,
      copies: 1,
      status: file ? 'uploading' : 'idle',
      abort: null,
      isMultipart: false,
      uploadStartTime: 0,
      uploadEndTime: 0,
      items: savedItems,
      activeItemId: '',
      batchToken: savedBatchToken
    };
  };

  MainProductUpload.prototype.applyMeasurement = function(payload) {
    var widthIn = toNumber(getField(payload, 'widthIn'));
    var heightIn = toNumber(getField(payload, 'heightIn'));
    if (!(widthIn > 0) || !(heightIn > 0)) return false;
    this.state.widthIn = widthIn;
    this.state.heightIn = heightIn;
    this.state.widthPx = toNumber(getField(payload, 'widthPx')) || this.state.widthPx;
    this.state.heightPx = toNumber(getField(payload, 'heightPx')) || this.state.heightPx;
    this.state.effectiveDpi = toNumber(getField(payload, 'effectiveDpi')) || this.state.effectiveDpi;
    this.state.documentDpi = toNumber(getField(payload, 'documentDpi')) || this.state.documentDpi;
    this.state.sizingSource = String(getField(payload, 'sizingSource') || this.state.sizingSource || '');
    return true;
  };

  MainProductUpload.prototype.createCurrentUploadItem = function() {
    var lastFile = this.state.lastFile
      ? { name: this.state.lastFile.name || this.state.fileName || '', size: this.state.lastFile.size || 0, type: this.state.lastFile.type || '' }
      : null;
    return {
      uploadId: this.state.uploadId,
      itemId: this.state.itemId,
      fileName: this.state.fileName,
      lastFile: lastFile,
      localPreviewUrl: this.state.localPreviewUrl,
      originalUrl: this.state.originalUrl,
      thumbnailUrl: this.state.thumbnailUrl,
      widthIn: this.state.widthIn,
      heightIn: this.state.heightIn,
      widthPx: this.state.widthPx,
      heightPx: this.state.heightPx,
      effectiveDpi: this.state.effectiveDpi,
      documentDpi: this.state.documentDpi,
      sizingSource: this.state.sizingSource,
      selectedResult: this.state.selectedResult,
      selectedVariantId: this.state.selectedVariantId,
      provisional: Boolean(this.state.provisional),
      copies: Math.max(1, Number(this.state.copies) || 1),
      status: this.state.status,
      isMultipart: this.state.isMultipart,
      uploadStartTime: this.state.uploadStartTime,
      uploadEndTime: this.state.uploadEndTime
    };
  };

  MainProductUpload.prototype.isExactMeasuredMode = function() {
    return this.root && this.root.getAttribute('data-ump-exact-measured') === 'true';
  };

  MainProductUpload.prototype.hasMeasuredUpload = function(item) {
    return Boolean(item && item.uploadId && toNumber(item.widthIn) > 0 && toNumber(item.heightIn) > 0);
  };

  MainProductUpload.prototype.setExactMeasuredResult = function() {
    this.state.selectedResult = {
      pricingMode: 'measured_length',
      selectedSheetLabel: 'Exact measured',
      selectedVariantTitle: '',
      selectedVariantId: this.getFallbackVariantId(),
      billableLengthIn: Math.max(toNumber(this.state.widthIn), toNumber(this.state.heightIn)),
      cartQuantity: 1,
      sheetsNeeded: 1
    };
    this.state.selectedVariantId = this.getFallbackVariantId();
  };

  MainProductUpload.prototype.isCartReadyItem = function(item) {
    // Provisional (client-probed) measurements are never cart-ready: only the
    // server-confirmed size may drive a cart line.
    if (item && item.provisional) return false;
    if (this.isExactMeasuredMode()) {
      return this.hasMeasuredUpload(item);
    }
    return Boolean(item && item.uploadId && item.selectedResult && item.selectedVariantId);
  };

  // ── Instant preview (Step 1) ────────────────────────────────────────────
  // Header-only probe (first/last MB) gives size + DPI before a single byte
  // of the file body is sent; the server resolves the same policy for a
  // provisional sheet/price. Everything set here is marked provisional and
  // replaced by the authoritative measurement after upload.
  MainProductUpload.prototype.probeAndPreview = async function(file, currentToken) {
    if (!window.ULFileProbe || !window.ULFileProbe.probe) return null;
    var probe = null;
    try { probe = await window.ULFileProbe.probe(file); } catch (_) { return null; }
    if (currentToken !== this.token) return probe;
    if (!probe || !(probe.widthPx > 0) || !(probe.heightPx > 0)) return probe;
    this.state.provisional = true;
    this.state.widthPx = probe.widthPx;
    this.state.heightPx = probe.heightPx;
    if (probe.dpi > 0) this.state.documentDpi = probe.dpi;
    this.state.sizingSource = 'client_probe';
    if (probe.widthIn > 0 && probe.heightIn > 0) {
      this.state.widthIn = probe.widthIn;
      this.state.heightIn = probe.heightIn;
    }
    this.render();
    if (this.isExactMeasuredMode()) return probe;
    try {
      var response = await fetch(this.apiBase + '/api/upload/resolve-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopDomain: this.shopDomain,
          productId: String(this.productId),
          widthPx: probe.widthPx,
          heightPx: probe.heightPx,
          dpi: probe.dpi || null,
          dpiSource: probe.dpiSource || null,
          quantity: this.getRequestedCopies(),
          selectedVariantId: this.isLinearInchPricing() ? null : (this.getFallbackVariantId() || null),
          customerId: this.customerId || null,
          customerEmail: this.customerEmail || null,
          customerName: this.customerName || null,
          measurementPolicy: POLICY
        })
      });
      var data = await response.json().catch(function() { return {}; });
      if (currentToken !== this.token || !this.state.provisional) return probe;
      if (data && data.dimensions) this.applyMeasurement(data.dimensions);
      if (response.ok && data.resolution) {
        this.state.selectedResult = data.resolution;
        this.state.selectedVariantId = String(data.resolution.selectedVariantId || '');
        this.setError('');
      } else if (!response.ok && data && data.error) {
        // Preserve the server's exact maximum-width explanation.
        this.setError(String(data.error));
      }
      this.render();
    } catch (_) {}
    return probe;
  };

  MainProductUpload.prototype.findItem = function(uploadId) {
    return (this.state.items || []).find(function(item) { return sameUploadId(item.uploadId, uploadId); }) || null;
  };

  // Quantity means complete copies of this uploaded gang sheet. Changing it
  // re-resolves that upload only and leaves the other files untouched.
  MainProductUpload.prototype.setItemCopies = async function(uploadId, next) {
    var item = this.findItem(uploadId);
    if (!item) return;
    var n = Math.floor(Number(next));
    if (!(n > 0)) n = 1;
    if (n > 999) n = 999;
    if (n === (Number(item.copies) || 1)) { this.render(); return; }
    var previous = item.copies || 1;
    item.copies = n;
    // Editing copies here makes it this tab's line to add (see addToCart).
    item.restored = false;
    var isActive = sameUploadId(this.state.uploadId, uploadId);
    if (isActive) this.state.copies = n;
    if (this.isExactMeasuredMode()) {
      // Exact-price quotes are quantity-sensitive, but they do not need a
      // second sheet-variant resolution. Changing whole-sheet copies simply
      // invalidates the quote key; render() requests the fresh server quote.
      this.quote.key = '';
      this.persistItems();
      this.render();
      return;
    }
    this.render();
    try {
      var resolved = await this.resolveForUpload(uploadId, n);
      var live = this.findItem(uploadId);
      if (!live || live.copies !== n) return; // changed again meanwhile
      live.selectedResult = resolved.resolution;
      live.selectedVariantId = resolved.selectedVariantId;
      if (sameUploadId(this.state.uploadId, uploadId)) {
        this.state.selectedResult = resolved.resolution;
        this.state.selectedVariantId = resolved.selectedVariantId;
      }
      this.setError('');
    } catch (error) {
      var rollback = this.findItem(uploadId);
      if (rollback && rollback.copies === n) rollback.copies = previous;
      if (isActive) this.state.copies = previous;
      this.setError(error && error.message ? error.message : 'Could not update the whole-sheet quantity.');
    }
    this.persistItems();
    this.render();
  };

  MainProductUpload.prototype.getRequestedCopies = function() {
    var n = Math.floor(Number(this.state && this.state.copies));
    return n > 0 ? Math.min(n, 999) : 1;
  };

  // ── Reorder deep link (Step 3) ──────────────────────────────────────────
  // /products/<handle>?ul_reorder=<uploadId>: restore a previously measured
  // upload from the status API so a repeat order needs no re-upload.
  MainProductUpload.prototype.restoreReorderFromUrl = async function() {
    var uploadId = '';
    try { uploadId = String(new URLSearchParams(window.location.search).get('ul_reorder') || '').trim(); } catch (_) { return; }
    if (!uploadId || !/^[A-Za-z0-9_-]{8,40}$/.test(uploadId)) return;
    if ((this.state.items || []).some(function(item) { return sameUploadId(item.uploadId, uploadId); })) return;
    try {
      var response = await fetch(this.apiBase + '/api/upload/status/' + encodeURIComponent(uploadId) + '?shopDomain=' + encodeURIComponent(this.shopDomain));
      if (!response.ok) return;
      var data = await response.json();
      var first = data.items && data.items[0];
      if (!first || !(toNumber(first.widthIn) > 0)) return;
      if (data.capabilities && data.capabilities.canAddToCart === false) return;
      var currentToken = this.token;
      this.state.uploadId = uploadId;
      this.state.itemId = first.itemId || first.id || '';
      this.state.fileName = first.fileName || first.originalName || 'Previous design';
      this.state.lastFile = first.fileSize ? { name: this.state.fileName, size: Number(first.fileSize) || 0, type: first.mimeType || '' } : null;
      this.state.thumbnailUrl = first.thumbnailUrl || data.thumbnailUrl || '';
      this.state.originalUrl = first.originalUrl || data.downloadUrl || '';
      this.state.provisional = false;
      this.applyMeasurement(first);
      await this.resolveProduct();
      if (currentToken !== this.token) return;
      this.state.status = 'ready';
      this.rememberCurrentUpload();
      this.setStage(null);
      this.render();
      console.log('[UMP] reorder restored upload ' + uploadId);
    } catch (error) {
      console.warn('[UMP] reorder restore failed:', error && error.message);
    }
  };

  MainProductUpload.prototype.rememberCurrentUpload = function() {
    if (!this.isCartReadyItem(this.state)) return;
    var snapshot = this.createCurrentUploadItem();
    var items = (this.state.items || []).slice();
    var replaced = false;
    for (var i = 0; i < items.length; i += 1) {
      if (sameUploadId(items[i].uploadId, snapshot.uploadId)) {
        items[i] = snapshot;
        replaced = true;
        break;
      }
    }
    if (!replaced) items.push(snapshot);
    this.state.items = items;
    this.state.activeItemId = snapshot.uploadId;
    this.persistItems();
  };

  MainProductUpload.prototype.getReadyItems = function() {
    var ready = (this.state.items || []).filter(this.isCartReadyItem.bind(this));
    if (this.isCartReadyItem(this.state) && !ready.some(function(item) {
      return sameUploadId(item.uploadId, this.state.uploadId);
    }.bind(this))) {
      ready.push(this.createCurrentUploadItem());
    }
    return ready;
  };

  MainProductUpload.prototype.getQueueItems = function() {
    var items = (this.state.items || []).slice();
    var hasCurrent = this.state.uploadId && items.some(function(item) {
      return sameUploadId(item.uploadId, this.state.uploadId);
    }.bind(this));
    if ((this.state.uploadId || this.state.fileName) && !hasCurrent) {
      items.push(this.createCurrentUploadItem());
    }
    return items;
  };

  MainProductUpload.prototype.loadUploadItem = function(item) {
    if (!item) return;
    this.state.uploadId = item.uploadId || '';
    this.state.itemId = item.itemId || '';
    this.state.fileName = item.fileName || '';
    this.state.lastFile = item.lastFile || null;
    this.state.localPreviewUrl = item.localPreviewUrl || '';
    this.state.originalUrl = item.originalUrl || '';
    this.state.thumbnailUrl = item.thumbnailUrl || '';
    this.state.widthIn = toNumber(item.widthIn);
    this.state.heightIn = toNumber(item.heightIn);
    this.state.widthPx = toNumber(item.widthPx);
    this.state.heightPx = toNumber(item.heightPx);
    this.state.effectiveDpi = toNumber(item.effectiveDpi);
    this.state.documentDpi = toNumber(item.documentDpi);
    this.state.sizingSource = item.sizingSource || '';
    this.state.selectedResult = item.selectedResult || null;
    this.state.selectedVariantId = String(item.selectedVariantId || '');
    this.state.provisional = Boolean(item.provisional);
    this.state.copies = Math.max(1, Number(item.copies) || 1);
    this.state.status = item.status || (this.isCartReadyItem(item) ? 'ready' : 'idle');
    this.state.isMultipart = Boolean(item.isMultipart);
    this.state.uploadStartTime = item.uploadStartTime || 0;
    this.state.uploadEndTime = item.uploadEndTime || 0;
    this.state.activeItemId = item.uploadId || '';
    this.state.abort = null;
  };

  MainProductUpload.prototype.selectUploadItem = function(uploadId) {
    var item = (this.state.items || []).find(function(candidate) {
      return sameUploadId(candidate.uploadId, uploadId);
    });
    if (!item) return;
    this.loadUploadItem(item);
    this.setProgress(0);
    this.setProgressText(0, 0);
    this.setStage(null);
    this.render();
  };

  MainProductUpload.prototype.removeUploadItem = function(uploadId) {
    var removed = null;
    var items = (this.state.items || []).filter(function(item) {
      var match = sameUploadId(item.uploadId, uploadId);
      if (match) removed = item;
      return !match;
    });
    if (removed && removed.localPreviewUrl) {
      try { URL.revokeObjectURL(removed.localPreviewUrl); } catch (_) {}
    }
    this.state.items = items;
    if (sameUploadId(this.state.uploadId, uploadId)) {
      if (items.length) {
        this.loadUploadItem(items[items.length - 1]);
      } else {
        this.resetMeasurement(null);
        this.state.items = [];
      }
    }
    this.persistItems();
    this.render();
  };

  // Clear all: drop every file from the widget (in-flight upload aborted,
  // previews revoked, persisted list removed). Server-side drafts are left
  // alone; they are never billed and expire on their own.
  MainProductUpload.prototype.clearAllUploads = function() {
    if (this.state.status === 'uploading') this.cancelUpload();
    (this.state.items || []).forEach(function(item) {
      if (item && item.localPreviewUrl) { try { URL.revokeObjectURL(item.localPreviewUrl); } catch (_) {} }
    });
    this.state.items = [];
    this.resetMeasurement(null);
    this.state.items = [];
    this.persistItems();
    this.setProgress(0);
    this.setProgressText(0, 0);
    this.setStage(null);
    this.setError('');
    this.render();
  };

  // Forget uploads that are now in the Shopify cart: the cart owns them from
  // here on, so a customer returning to the page starts with a clean list.
  MainProductUpload.prototype.forgetUploads = function(uploadIds) {
    var ids = (uploadIds || []).map(String);
    var remaining = (this.state.items || []).filter(function(item) {
      return ids.indexOf(String(item.uploadId)) === -1;
    });
    (this.state.items || []).forEach(function(item) {
      if (ids.indexOf(String(item.uploadId)) !== -1 && item.localPreviewUrl) {
        try { URL.revokeObjectURL(item.localPreviewUrl); } catch (_) {}
      }
    });
    this.state.items = remaining;
    if (ids.indexOf(String(this.state.uploadId)) !== -1) {
      this.resetMeasurement(null);
      this.state.items = remaining;
    }
    this.persistItems();
  };

  MainProductUpload.prototype.renderQueue = function() {
    if (!this.queue) return;
    var items = this.getQueueItems();
    if (!items.length) {
      if (this.files) this.files.hidden = true;
      this.queue.innerHTML = '';
      return;
    }
    var readyCount = items.filter(this.isCartReadyItem.bind(this)).length;
    if (this.files) this.files.hidden = false;
    if (this.filesCount) this.filesCount.textContent = readyCount + '/' + items.length + ' ready';
    var exact = this.isExactMeasuredMode();
    this.queue.innerHTML =
      '<div class="ump__queue-list">' +
        items.map(function(item) {
          var id = escapeHtml(item.uploadId || '');
          var isActive = sameUploadId(item.uploadId, this.state.activeItemId || this.state.uploadId);
          var isReady = this.isCartReadyItem(item);
          var statusLabel = isReady ? 'Ready' : (item.status === 'error' ? 'Failed' : (item.status === 'uploading' ? 'Uploading' : 'Measuring'));
          var result = item.selectedResult || {};
          var sheetLabel = exact && isReady
            ? 'Exact measured'
            : (result.selectedSheetLabel || result.selectedVariantTitle || '');
          var copies = Math.max(1, Number(item.copies) || 1);
          var sizeText = item.widthIn && item.heightIn
            ? formatDisplaySheetDimensions(item.widthIn, item.heightIn)
            : '';
          var metaParts = [];
          if (sizeText) metaParts.push(escapeHtml(sizeText));
          if (sheetLabel) metaParts.push('<b>' + escapeHtml(sheetLabel) + '</b>');
          if (isReady) metaParts.push(copies + ' whole-sheet ' + (copies === 1 ? 'copy' : 'copies'));
          if (item.provisional && sizeText) metaParts.push('est.');
          var thumbUrl = item.thumbnailUrl || item.localPreviewUrl || '';
          var isBusy = !isReady && item.status !== 'error';
          var canEdit = isReady;
          if (isBusy) this.markItemBusy(item);
          var elapsed = isReady ? this.getItemReadySeconds(item) : null;
          var statusText = statusLabel + (elapsed != null ? ' · ' + elapsed.toFixed(1) + 's' : '');
          return '' +
            '<div class="ump__queue-item' + (isActive ? ' is-active' : '') + (isBusy ? ' is-busy' : '') + (item.status === 'error' ? ' is-error' : '') + '">' +
              '<span class="ump__queue-thumb" data-ump-select-item="' + id + '"' + (thumbUrl ? ' style="background-image:url(&quot;' + escapeHtml(thumbUrl.replace(/"/g, '%22')) + '&quot;)"' : '') + '></span>' +
              '<span class="ump__queue-copy" data-ump-select-item="' + id + '">' +
                '<span class="ump__queue-name">' + escapeHtml(item.fileName || 'Gang sheet') + '</span>' +
                '<span class="ump__queue-meta">' + (metaParts.join(' · ') || escapeHtml(statusLabel)) + '</span>' +
              '</span>' +
              '<span class="ump__queue-status' + (isReady ? ' is-ready' : '') + '"' + (elapsed != null ? ' title="Time from file selection to ready"' : '') + '>' + escapeHtml(statusText) + '</span>' +
              '<span class="ump__queue-tools">' +
                (canEdit
                  ? '<span class="ump__copies" role="group" aria-label="Whole-sheet copies">' +
                      '<button type="button" class="ump__copies-btn" data-ump-copies-minus data-upload-id="' + id + '" aria-label="Fewer whole-sheet copies"' + (copies <= 1 ? ' disabled' : '') + '>−</button>' +
                      '<input type="number" class="ump__copies-input" data-ump-copies-input data-upload-id="' + id + '" value="' + copies + '" min="1" max="999" inputmode="numeric" aria-label="Whole-sheet copies">' +
                      '<button type="button" class="ump__copies-btn" data-ump-copies-plus data-upload-id="' + id + '" aria-label="More whole-sheet copies"' + (copies >= 999 ? ' disabled' : '') + '>+</button>' +
                    '</span>'
                  : '') +
                (isReady ? '<button class="ump__queue-remove" type="button" data-ump-remove-item="' + id + '" aria-label="Remove ' + escapeHtml(item.fileName || 'gang sheet') + '">×</button>' : '') +
              '</span>' +
            '</div>';
        }.bind(this)).join('') +
      '</div>';
  };

  // Seconds from file selection until the item became ready. The ready moment is
  // stamped the first time a render sees the item ready after having seen it
  // busy in this page session; an item restored already-ready falls back to the
  // end of its upload transfer, so a reload never shows an inflated duration.
  MainProductUpload.prototype.getItemReadySeconds = function(item) {
    var start = toNumber(item && item.uploadStartTime);
    var key = item && (item.uploadId || item.fileName);
    if (!(start > 0) || !key) return null;
    if (!this.itemReadyAt) this.itemReadyAt = {};
    if (!this.itemReadyAt[key]) {
      var end = toNumber(item.uploadEndTime);
      var seen = this.itemSeenBusy || {};
      // The upload id arrives mid-upload, so busy renders may be keyed by name.
      var wasBusy = Boolean((item.uploadId && seen[item.uploadId]) || (item.fileName && seen[item.fileName]));
      this.itemReadyAt[key] = wasBusy ? Date.now() : (end > start ? end : 0);
    }
    var readyAt = this.itemReadyAt[key];
    return readyAt > start ? (readyAt - start) / 1000 : null;
  };

  MainProductUpload.prototype.markItemBusy = function(item) {
    if (!item) return;
    if (!this.itemSeenBusy) this.itemSeenBusy = {};
    if (item.uploadId) this.itemSeenBusy[item.uploadId] = true;
    if (item.fileName) this.itemSeenBusy[item.fileName] = true;
  };

  MainProductUpload.prototype.getMethodText = function() {
    if (this.isExactMeasuredMode()) {
      return this.state.uploadId
        ? 'Exact measured pricing is active. Checkout uses the measured upload length, not rounded sheet variants.'
        : 'Exact measured pricing is active. Upload required before checkout.';
    }
    var source = this.state.sizingSource;
    if (this.state.provisional || source === 'client_probe') return 'Estimated from the file header — the server confirms the exact size once the upload lands.';
    if (source === 'document_dpi') return 'Measured from embedded document resolution.';
    if (source === 'adobe_default_dpi') return 'Measured with Adobe-compatible no-DPI handling.';
    if (source === 'sheet_width_anchor' || source === 'max_printable_width_anchor') {
      return 'Measured against the configured maximum printable width.';
    }
    return this.state.uploadId ? 'Server-confirmed print size.' : 'Upload required before this product can be added to cart.';
  };

  MainProductUpload.prototype.getFallbackVariantId = function() {
    if (this.currentVariantId) return String(this.currentVariantId);
    for (var i = 0; i < this.variants.length; i += 1) {
      if (this.variants[i] && this.variants[i].available !== false) {
        return String(this.variants[i].id || '');
      }
    }
    return this.variants[0] ? String(this.variants[0].id || '') : '';
  };

  MainProductUpload.prototype.parseSelectedSheet = function() {
    if (this.isExactMeasuredMode() && this.state.widthIn > 0 && this.state.heightIn > 0) {
      var exact = getDisplaySheetDimensions(this.state.widthIn, this.state.heightIn);
      return { width: exact.widthIn, height: exact.lengthIn, label: 'Exact measured' };
    }
    var label = this.state.selectedResult
      ? (this.state.selectedResult.selectedSheetLabel || this.state.selectedResult.selectedVariantTitle || '')
      : '';
    var parsed = parseSheetSize(label);
    return {
      // The press limit, not the variant's nominal width, decides whether the
      // file fits cross-roll. The variant's second dimension remains its sold
      // film length.
      width: this.maxPrintableWidthIn,
      height: parsed && parsed.height > 0
        ? parsed.height
        : Math.max(this.state.widthIn || 0, this.state.heightIn || 0, 12),
      label: label || '--'
    };
  };

  // ── True-scale finished-sheet preview ───────────────────────────────────
  // One uploaded file is one finished sheet. The preview normalizes the short
  // edge as width and the long edge as length; quantity never tiles artwork.
  var PREVIEW_MAX_RATIO = 4; // 22x6 … 22x88 draw in full; longer rolls are cut with a marker

  MainProductUpload.prototype.updatePreviewGeometry = function() {
    if (!this.sheetPlane || !this.art) return;
    var hasSize = this.state.widthIn > 0 && this.state.heightIn > 0;
    var sheet = this.parseSelectedSheet();
    var sheetWidth = sheet.width || this.maxPrintableWidthIn || 22.5;
    var sheetLength = sheet.height || Math.max(this.state.widthIn || 0, this.state.heightIn || 0, 12);
    var trueRatio = sheetLength / sheetWidth;
    var displayRatio = Math.min(PREVIEW_MAX_RATIO, Math.max(0.8, trueRatio));
    this.root.style.setProperty('--ump-sheet-ratio', displayRatio.toFixed(4));

    var planeW = this.sheetPlane.clientWidth || 0;
    var planeH = planeW / displayRatio;
    var scale = sheetWidth > 0 ? planeH / sheetWidth : 0; // px per inch
    if (scale > 0) this.root.style.setProperty('--ump-inch', scale.toFixed(3) + 'px');
    if (this.rulerTop) this.rulerTop.setAttribute('data-label', formatInches(sheetLength));
    if (this.rulerSide) this.rulerSide.setAttribute('data-label', formatInches(sheetWidth));
    if (this.sheetCut) {
      var cut = trueRatio > PREVIEW_MAX_RATIO + 0.01;
      this.sheetCut.hidden = !cut;
      if (cut) this.sheetCut.textContent = 'continues to ' + formatInches(sheetLength);
    }

    var existing = this.art.querySelectorAll('.ump__tile');
    for (var k = 0; k < existing.length; k += 1) existing[k].remove();
    if (!hasSize || !(scale > 0)) {
      this.art.classList.remove('has-tiles');
      if (this.artDimW) this.artDimW.hidden = true;
      if (this.artDimH) this.artDimH.hidden = true;
      return;
    }

    var dw = this.state.widthIn;
    var dh = this.state.heightIn;
    var dimensions = getDisplaySheetDimensions(dw, dh);
    var tileW = dimensions.lengthIn;
    var tileH = dimensions.widthIn;
    var normalizePortraitForDisplay = dh > dw;
    var imageUrl = this.state.thumbnailUrl || this.state.localPreviewUrl || '';
    var tile = document.createElement('i');
    tile.className = 'ump__tile' + (this.state.provisional ? ' is-provisional' : '');
    tile.style.left = '0';
    tile.style.top = '0';
    tile.style.width = (tileW * scale).toFixed(2) + 'px';
    tile.style.height = (tileH * scale).toFixed(2) + 'px';
    if (imageUrl) {
      var img = document.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      img.src = imageUrl;
      img.style.width = (dw * scale).toFixed(2) + 'px';
      img.style.height = (dh * scale).toFixed(2) + 'px';
      img.style.transform = 'translate(-50%, -50%)' + (normalizePortraitForDisplay ? ' rotate(90deg)' : '');
      tile.appendChild(img);
    }
    this.art.appendChild(tile);
    this.art.classList.add('has-tiles');

    // Dimension callouts: top is length, side is width.
    if (this.artDimW) {
      this.artDimW.hidden = false;
      this.artDimW.textContent = formatInches(tileW);
      this.artDimW.style.left = (tileW * scale / 2).toFixed(2) + 'px';
      this.artDimW.style.top = '4px';
      this.artDimW.style.transform = 'translateX(-50%)';
    }
    if (this.artDimH) {
      this.artDimH.hidden = false;
      this.artDimH.textContent = formatInches(tileH);
      this.artDimH.style.left = '4px';
      this.artDimH.style.top = (tileH * scale / 2).toFixed(2) + 'px';
      this.artDimH.style.transform = 'translateY(-50%)';
    }
    this.previewLayout = { normalizedSheet: true };
  };

  MainProductUpload.prototype.getSelectedVariantPrice = function() {
    var id = String(this.state.selectedVariantId || '');
    if (!id) return 0;
    for (var i = 0; i < (this.variants || []).length; i += 1) {
      if (String(this.variants[i] && this.variants[i].id) === id) return variantPriceToDollars(this.variants[i].price);
    }
    return 0;
  };

  // Cart total: exactly what Shopify will charge — each requested copy is one
  // complete uploaded sheet. Re-run on every render so it cannot drift from
  // the per-row whole-sheet quantity.
  MainProductUpload.prototype.computeCartTotal = function(readyItems) {
    var lines = [];
    var total = 0;
    var sheets = 0;
    var copies = 0;
    (readyItems || []).forEach(function(item) {
      var line = buildCartLineRequest(item);
      var unit = this.getVariantPrice(line.variantId);
      var subtotal = unit * line.sheetsNeeded;
      lines.push({
        fileName: item.fileName || 'Gang sheet',
        sheetLabel: line.sheetLabel,
        sheets: line.sheetsNeeded,
        copies: line.copies,
        unit: unit,
        subtotal: subtotal
      });
      total += subtotal;
      sheets += line.sheetsNeeded;
      copies += line.copies;
    }, this);
    return { lines: lines, total: Math.round(total * 100) / 100, sheets: sheets, copies: copies };
  };

  MainProductUpload.prototype.getVariantPrice = function(variantId) {
    var id = String(variantId || '');
    for (var i = 0; i < (this.variants || []).length; i += 1) {
      if (String(this.variants[i] && this.variants[i].id) === id) return variantPriceToDollars(this.variants[i].price);
    }
    return 0;
  };

  MainProductUpload.prototype.renderPriceNow = function(readyItems) {
    // Exact measured checkout has its own note field; everywhere else the
    // order note appears once a sheet is ready to add.
    if (this.orderNoteWrap) {
      this.orderNoteWrap.hidden = this.isExactMeasuredMode() || !(readyItems && readyItems.length);
    }
    if (!this.total || !this.totalValue) return;
    if (this.isExactMeasuredMode() || this.isLinearInchPricing()) { this.total.hidden = true; return; }
    var summary = this.computeCartTotal(readyItems);
    if (!(summary.total > 0)) { this.total.hidden = true; return; }
    this.total.hidden = false;
    this.totalValue.textContent = formatMoney(summary.total, this.currency);
    if (this.totalMeta) {
      this.totalMeta.textContent = summary.sheets + ' whole-sheet ' + (summary.sheets === 1 ? 'copy' : 'copies');
    }
    if (this.totalLines) {
      this.totalLines.innerHTML = summary.lines.map(function(line) {
        return '<li>' +
          '<span>' + escapeHtml(line.fileName) + '</span>' +
          '<span>' + line.sheets + ' × ' + escapeHtml(line.sheetLabel || 'sheet') + '</span>' +
          '<strong>' + escapeHtml(formatMoney(line.subtotal, this.currency)) + '</strong>' +
        '</li>';
      }, this).join('');
    }
  };

  MainProductUpload.prototype.buildCustomItems = function(items) {
    return items.map(function(item) {
      return {
        uploadId: item.uploadId,
        quantity: Math.max(1, Number(item.copies || item.quantity) || 1),
        selectedVariantId: item.selectedVariantId || null,
        measurementPolicy: POLICY
      };
    }.bind(this));
  };

  MainProductUpload.prototype.addExactMeasuredToCart = function() {
    var readyItems = this.getReadyItems();
    if (!readyItems.length) {
      this.setError('Please upload your gang sheet first.');
      return;
    }
    if (this.quote.status !== 'ready' || !this.quote.data) {
      this.setError('Please wait until the exact measured quote is ready.');
      this.requestExactQuoteIfNeeded(readyItems);
      this.render();
      return;
    }
    if (!this.exactCartStorageEnabled) {
      this.setError('Your browser is blocking saved cart storage. Please use Checkout for exact measured pricing.');
      return;
    }

    var additions = this.currentExactEntries();
    var merged = this.mergeExactCartEntries(this.readExactCart(), additions);
    this.writeExactCart(merged);
    this.exactCartNotice = additions.length + ' upload' + (additions.length === 1 ? '' : 's') + ' saved to cart. Add UV/DTF on another product page or checkout together.';
    this.setError('');
    this.render();
  };

  MainProductUpload.prototype.requestExactQuoteIfNeeded = function(items) {
    if (!this.isExactMeasuredMode()) return;
    if (!items.length) {
      this.quote.key = '';
      this.quote.status = 'idle';
      this.quote.data = null;
      this.quote.error = '';
      return;
    }
    var key = readyKey(items);
    if (key === this.quote.key && (this.quote.status === 'ready' || this.quote.status === 'loading')) return;
    this.requestExactQuote(items, key);
  };

  MainProductUpload.prototype.requestExactQuote = async function(items, key) {
    var token = ++this.quote.token;
    this.quote.key = key;
    this.quote.status = 'loading';
    this.quote.data = null;
    this.quote.error = '';
    this.renderPriceStrip();

    try {
      var response = await fetch(this.apiBase + '/api/vip/quote' + buildQuery({ shop: this.shopDomain }), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: this.customerId || null,
          customerEmail: this.customerEmail || null,
          measurementPolicy: POLICY,
          items: this.buildCustomItems(items)
        })
      });
      var data = await response.json().catch(function() { return {}; });
      if (token !== this.quote.token) return;
      if (!response.ok) throw new Error(data.error || 'Failed to calculate exact quote.');
      this.quote.status = 'ready';
      this.quote.data = data;
      this.quote.error = '';
    } catch (error) {
      if (token !== this.quote.token) return;
      this.quote.status = 'error';
      this.quote.data = null;
      this.quote.error = error && error.message ? error.message : 'Failed to calculate exact quote.';
    }

    this.render();
  };

  MainProductUpload.prototype.handleExactMeasuredCheckout = async function(redirectTo) {
    var readyItems = this.getReadyItems();
    var checkoutEntries = this.getExactCheckoutEntries();
    if (!readyItems.length && !checkoutEntries.length) {
      this.setError('Please upload your gang sheet first.');
      return;
    }
    if (readyItems.length && (this.quote.status !== 'ready' || !this.quote.data)) {
      this.setError('Please wait until the exact measured quote is ready.');
      this.requestExactQuoteIfNeeded(readyItems);
      this.render();
      return;
    }
    checkoutEntries = this.getExactCheckoutEntries();
    if (!checkoutEntries.length) {
      this.setError('Please add at least one exact measured upload before checkout.');
      return;
    }

    this.setError('');
    this.cartBusy = true;
    if (this.addButton) this.addButton.disabled = true;
    if (this.checkoutButton) this.checkoutButton.disabled = true;

    try {
      var response = await fetch(this.apiBase + '/api/vip/checkout' + buildQuery({ shop: this.shopDomain }), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: this.customerId || null,
          customerEmail: this.customerEmail || null,
          customerNote: this.buildExactCheckoutNote(checkoutEntries),
          discountCode: this.getDiscountCode() || null,
          acceptAutomaticDiscounts: true,
          checkoutIntent: redirectTo === '/cart' ? 'add_to_cart' : 'checkout',
          measurementPolicy: POLICY,
          items: this.buildCustomItems(checkoutEntries)
        })
      });
      var data = await response.json().catch(function() { return {}; });
      if (!response.ok) throw new Error(data.error || 'Failed to create exact checkout.');
      var redirect = data.checkoutUrl || data.redirectUrl || data.url || data.invoiceUrl;
      if (!redirect) throw new Error('Exact checkout URL was not returned.');
      // The saved list is shared by every product tab: drop only what this
      // checkout sent, keeping anything another tab saved in the meantime.
      var sentIds = checkoutEntries.map(function(entry) { return String(entry.uploadId); });
      this.writeExactCart(this.readExactCart().filter(function(entry) {
        return sentIds.indexOf(String(entry.uploadId)) === -1;
      }));
      window.location.href = redirect;
    } catch (error) {
      this.setError(error && error.message ? error.message : 'Failed to create exact checkout.');
      this.cartBusy = false;
      this.render();
    }
  };

  MainProductUpload.prototype.render = function() {
    var readyItems = this.getReadyItems();
    var queueItems = this.getQueueItems();
    var exactMode = this.isExactMeasuredMode();
    var exactCartItems = exactMode ? this.readExactCart() : [];
    this.requestExactQuoteIfNeeded(readyItems);
    this.renderCustomerPricingCard();
    this.renderExactNoteField();
    this.renderPriceStrip();
    this.renderDiscountPanel();
    this.renderExactCartPanel();
    var hasBlockingWork = this.state.status === 'uploading' || this.state.status === 'error';
    var quoteReady = !exactMode || !readyItems.length || Boolean(this.quote.status === 'ready' && this.quote.data);
    var addReady = readyItems.length > 0 && !hasBlockingWork && quoteReady;
    var ready = exactMode
      ? (readyItems.length > 0 || exactCartItems.length > 0) && !hasBlockingWork && quoteReady
      : readyItems.length > 0 && !hasBlockingWork && quoteReady;
    // The transfer strip only exists while a file is in flight or failed;
    // ready files live in the files list.
    var inFlight = Boolean(this.state.fileName) && (this.state.status === 'uploading' || this.state.status === 'error');
    this.statusPanel.hidden = !inFlight;
    this.fileName.textContent = this.state.fileName || '';

    var fileMetaText = 'Upload a file to detect the gang sheet size.';
    if (this.state.status === 'ready') {
      var dur = (this.state.uploadEndTime && this.state.uploadStartTime)
        ? ((this.state.uploadEndTime - this.state.uploadStartTime) / 1000).toFixed(1) + 's'
        : null;
      fileMetaText = 'Ready' + (dur ? ' in ' + dur : '') + '. ' + this.getMethodText();
    } else if (this.state.status === 'uploading') {
      var provisionalText = this.state.provisional && this.state.widthIn && this.state.heightIn
        ? 'Estimated ' + formatDisplaySheetDimensions(this.state.widthIn, this.state.heightIn) +
          (this.state.selectedResult && this.state.selectedResult.selectedSheetLabel ? ' → ' + this.state.selectedResult.selectedSheetLabel : '') +
          ' · confirming on server. '
        : '';
      fileMetaText = provisionalText + (this.state.resumedParts > 0
        ? 'Resuming upload — ' + this.state.resumedParts + ' chunks already on the server...'
        : this.state.isMultipart
        ? 'Uploading in parallel chunks...'
        : this.state.fastRaster
          ? 'Uploading and validating the stored header...'
          : 'Uploading and measuring...');
    } else if (this.state.status === 'error') {
      fileMetaText = 'Upload failed. You can try again or pick a different file.';
    }
    this.fileMeta.textContent = fileMetaText;

    var imageUrl = this.state.thumbnailUrl || this.state.localPreviewUrl || '';
    if (imageUrl) {
      this.thumb.hidden = false;
      this.thumb.src = imageUrl;
    } else {
      this.thumb.hidden = true;
      this.thumb.removeAttribute('src');
    }

    this.renderFilePills(this.state.lastFile, this.state.isMultipart);
    this.renderQueue();

    if (this.cancel) this.cancel.hidden = this.state.status !== 'uploading';
    if (this.retry) this.retry.hidden = this.state.status !== 'error';
    if (this.note) {
      this.note.hidden = true;
      this.note.textContent = '';
    }

    var displayDimensions = getDisplaySheetDimensions(this.state.widthIn, this.state.heightIn);
    this.size.textContent = formatDisplaySheetDimensions(this.state.widthIn, this.state.heightIn);
    this.width.textContent = displayDimensions ? formatInches(displayDimensions.widthIn) : '--';
    this.height.textContent = displayDimensions ? formatInches(displayDimensions.lengthIn) : '--';
    this.sheetLabel.textContent = exactMode && this.state.widthIn && this.state.heightIn
      ? 'Exact measured'
      : this.state.selectedResult
      ? (this.state.selectedResult.selectedSheetLabel || this.state.selectedResult.selectedVariantTitle || '--') + (this.state.provisional ? ' (est.)' : '')
      : '--';
    this.renderQuality();
    this.renderPriceNow(readyItems);
    this.renderPriceTable();
    if (this.method) this.method.textContent = this.getMethodText();

    var badgeLabel, badgeClass;
    if (ready) { badgeLabel = 'Ready'; badgeClass = 'is-ready'; }
    else if (exactMode && readyItems.length && this.quote.status === 'loading') {
      badgeLabel = 'Quoting';
      badgeClass = 'is-measuring';
    }
    else if (exactMode && readyItems.length && this.quote.status === 'error') {
      badgeLabel = 'Quote error';
      badgeClass = '';
    }
    else if (this.state.status === 'uploading') {
      badgeLabel = this.state.fastRaster ? 'Uploading' : (this.state.uploadId ? 'Measuring' : 'Uploading');
      badgeClass = this.state.fastRaster ? 'is-uploading' : (this.state.uploadId ? 'is-measuring' : 'is-uploading');
    } else if (this.state.status === 'error') {
      badgeLabel = 'Error'; badgeClass = '';
    } else {
      badgeLabel = 'Waiting'; badgeClass = '';
    }
    this.badge.textContent = badgeLabel;
    this.badge.classList.remove('is-ready', 'is-uploading', 'is-measuring');
    if (badgeClass) this.badge.classList.add(badgeClass);

    this.addButton.disabled = Boolean(this.cartBusy) || (exactMode ? !addReady : !ready);
    if (this.addButton) {
      var addLabel = this.addButton.getAttribute('data-default-label') || 'Add to cart';
      if (exactMode) {
        this.addButton.textContent = addReady
          ? (this.isCurrentExactUploadSaved() ? 'Saved to cart' : 'Add to cart')
          : (readyItems.length ? 'Preparing exact quote' : 'Upload required');
      } else {
        this.addButton.textContent = readyItems.length > 1 ? 'Add ' + readyItems.length + ' gang sheets to cart' : addLabel;
      }
    }
    if (this.checkoutButton) this.checkoutButton.disabled = Boolean(this.cartBusy) || !ready;
    if (this.checkoutButton) {
      var checkoutLabel = this.checkoutButton.getAttribute('data-default-label') || 'Checkout';
      if (exactMode) {
        var exactCheckoutCount = this.getExactCheckoutEntries().length;
        this.checkoutButton.textContent = ready
          ? (exactCheckoutCount > 1 ? 'Checkout ' + exactCheckoutCount + ' exact uploads' : 'Checkout exact upload')
          : (readyItems.length ? 'Preparing exact quote' : 'Upload required');
      } else {
        this.checkoutButton.textContent = readyItems.length > 1 ? 'Checkout with ' + readyItems.length + ' gang sheets' : checkoutLabel;
      }
    }
    this.updatePreviewGeometry();
    this.root.dispatchEvent(new CustomEvent('ump:render', { detail: { instance: this } }));
  };

  // ── Resumable multipart sessions (Step 2) ───────────────────────────────
  // Per-file (content fingerprint) record of an in-flight R2 multipart
  // upload: which parts landed (ETags) and the ids needed to ask the server
  // for fresh presigned URLs. Survives refresh/tab close; the next drop of
  // the same file resumes instead of restarting.
  var MP_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
  var SINGLE_SHOT_FALLBACK_MAX_BYTES = 256 * 1024 * 1024;

  MainProductUpload.prototype.getMpSessionKey = function(fingerprint) {
    return ['umpMp', this.shopDomain || 'shop', this.productId || 'product', fingerprint].join(':');
  };

  MainProductUpload.prototype.loadMpSession = function(fingerprint, file) {
    if (!fingerprint || !this.exactCartStorageEnabled) return null;
    var session = null;
    try { session = parseJson(window.localStorage.getItem(this.getMpSessionKey(fingerprint)), null); } catch (_) { return null; }
    if (!session || !session.uploadId || !session.multipartUploadId || !session.key) return null;
    if (!(session.savedAt > 0) || Date.now() - session.savedAt > MP_SESSION_TTL_MS || (file && session.fileSize !== file.size)) {
      this.clearMpSession(fingerprint);
      return null;
    }
    return session;
  };

  MainProductUpload.prototype.saveMpSession = function(fingerprint, session) {
    if (!fingerprint || !this.exactCartStorageEnabled) return;
    session.savedAt = Date.now();
    try { window.localStorage.setItem(this.getMpSessionKey(fingerprint), JSON.stringify(session)); } catch (_) {}
  };

  MainProductUpload.prototype.clearMpSession = function(fingerprint) {
    if (!fingerprint) return;
    try { window.localStorage.removeItem(this.getMpSessionKey(fingerprint)); } catch (_) {}
  };

  // Ask the server which parts R2 already holds and get fresh URLs for the
  // rest. Returns {uploadedParts, parts, completeUrl, abortUrl} or null when
  // the multipart upload is gone (client must start over).
  MainProductUpload.prototype.requestMultipartResume = async function(session) {
    var response = await fetch(this.apiBase + '/api/upload/multipart-resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shopDomain: this.shopDomain,
        uploadId: session.uploadId,
        key: session.key,
        multipartUploadId: session.multipartUploadId,
        partSize: session.partSize,
        totalParts: session.totalParts
      })
    });
    var data = await response.json().catch(function() { return {}; });
    if (!response.ok || !data.success) return null;
    return data;
  };

  function suggestPartSizeMb(fileSize) {
    if (fileSize < 64 * 1024 * 1024) return 8;
    if (fileSize < 512 * 1024 * 1024) return 16;
    return 32;
  }

  MainProductUpload.prototype.performUpload = async function(file, intent, onProgress, transport) {
    var self = this;
    transport = transport || {};
    var fingerprint = transport.fingerprint || '';
    // Parallel multipart first when the intent advertises it (R2, large files).
    if (intent.multipart && window.ULMultipartUploader && window.ULMultipartUploader.tryUpload) {
      this.state.isMultipart = true;
      this.render();
      var mp = intent.multipart;
      var session = transport.session || null;
      if (fingerprint && !session) {
        session = {
          uploadId: intent.uploadId, itemId: intent.itemId, key: mp.key,
          multipartUploadId: mp.uploadId, partSize: mp.partSize, totalParts: mp.totalParts,
          publicUrl: mp.publicUrl || intent.publicUrl || '', fileName: file.name, fileSize: file.size, parts: {}
        };
        this.saveMpSession(fingerprint, session);
      }
      var resume = transport.resume || null;
      var mpAttempt = 0;
      while (true) {
        mpAttempt += 1;
        try {
          var mpResult = await window.ULMultipartUploader.tryUpload(file, intent, {
            onProgress: onProgress,
            shopDomain: this.shopDomain,
            concurrency: window.ULMultipartUploader.DEFAULT_CONCURRENCY || 6,
            resume: resume,
            registerAbort: function(abortFn) { self.state.abort = abortFn; },
            onPartDone: function(partNumber, etag) {
              if (!session) return;
              session.parts[partNumber] = etag;
              self.saveMpSession(fingerprint, session);
            }
          });
          self.state.abort = null;
          if (mpResult) {
            intent.publicUrl = mpResult.fileUrl || intent.publicUrl;
            intent.storageProvider = mpResult.storageProvider;
            this.clearMpSession(fingerprint);
            return;
          }
          break;
        } catch (mpErr) {
          self.state.abort = null;
          // Cancelled by the customer: keep the session (the next drop of the
          // same file resumes) and stop here.
          if (mpErr && mpErr.cancelled) throw new Error('Upload cancelled.');
          // In-place resume: fresh URLs for the parts still missing, twice,
          // before giving up on multipart for this attempt.
          if (mpErr && mpErr.resumable && session && mpAttempt <= 2) {
            console.warn('[UMP] multipart interrupted (' + (mpErr.message || 'error') + '), resuming in place...');
            await sleep(1500 * mpAttempt);
            var fresh = null;
            try { fresh = await this.requestMultipartResume(session); } catch (_) {}
            if (fresh) {
              resume = fresh;
              intent.multipart.parts = fresh.parts && fresh.parts.length ? fresh.parts : intent.multipart.parts;
              intent.multipart.completeUrl = fresh.completeUrl || intent.multipart.completeUrl;
              intent.multipart.abortUrl = fresh.abortUrl || intent.multipart.abortUrl;
              this.state.resumedParts = (fresh.uploadedParts || []).length;
              this.render();
              continue;
            }
          }
          console.warn('[UMP] multipart failed:', mpErr && mpErr.message);
          if (file.size > SINGLE_SHOT_FALLBACK_MAX_BYTES) {
            // Re-sending a huge file in one request is worse than asking for
            // one more drop: the session is kept, the next drop resumes.
            throw new Error('Connection interrupted. Drop the same file again to resume from where it stopped.');
          }
          this.state.isMultipart = false;
          this.render();
          break;
        }
      }
    }

    var storageProvider = intent.storageProvider || 'local';
    var method = intent.uploadMethod || (storageProvider === 'local' ? 'POST' : 'PUT');
    var headers = intent.uploadHeaders || null;
    if (method === 'POST') {
      headers = { __extraFields: { key: intent.key || '', uploadId: intent.uploadId || '', itemId: intent.itemId || '' } };
    }
    var retry = intent.retryConfig || { maxRetries: 3, retryDelayMs: 1000 };
    var maxRetries = Math.max(1, Number(retry.maxRetries) || 3);
    var delay = Math.max(250, Number(retry.retryDelayMs) || 1000);
    var lastError = null;

    for (var i = 0; i < maxRetries; i += 1) {
      try {
        await sendUploadXhr(intent.uploadUrl, method, file, headers, onProgress, function(xhr) {
          self.state.abort = function() { try { xhr.abort(); } catch (_) {} };
        });
        self.state.abort = null;
        this.clearMpSession(fingerprint);
        return;
      } catch (error) {
        lastError = error;
        if (String(error && error.message).indexOf('cancelled') !== -1) throw error;
        if (i < maxRetries - 1) await sleep(delay * Math.pow(2, i));
      }
    }

    var localFallback = intent.fallbackUrls && intent.fallbackUrls.local;
    if (storageProvider !== 'local' && localFallback && localFallback.url) {
      var localMethod = localFallback.method || 'PUT';
      var localHeaders = localMethod === 'POST' ? {
        __extraFields: { key: intent.key || '', uploadId: intent.uploadId || '', itemId: intent.itemId || '' }
      } : null;
      await sendUploadXhr(localFallback.url, localMethod, file, localHeaders, onProgress, function(xhr) {
        self.state.abort = function() { try { xhr.abort(); } catch (_) {} };
      });
      intent.storageProvider = 'local';
      intent.publicUrl = localFallback.publicUrl || intent.publicUrl;
      self.state.abort = null;
      this.clearMpSession(fingerprint);
      return;
    }

    throw lastError || new Error('Upload failed');
  };

  MainProductUpload.prototype.startUploads = async function(files) {
    var list = toFileArray(files);
    if (!list.length) return;
    if (this.productConfig.status === 'loading' && this.productConfigPromise) {
      try { await this.productConfigPromise; } catch (_) {}
    }
    var batchToken = (this.state.batchToken || 0) + 1;
    this.state.batchToken = batchToken;
    for (var i = 0; i < list.length; i += 1) {
      if (this.state.batchToken !== batchToken) return;
      await this.startUpload(list[i], batchToken);
      if (this.state.batchToken !== batchToken) return;
      if (this.state.status === 'error') return;
    }
  };

  MainProductUpload.prototype.startUpload = async function(file, batchToken) {
    this.resetMeasurement(file);
    this.state.batchToken = batchToken || this.state.batchToken || 0;
    var currentToken = this.token;
    this.state.uploadStartTime = Date.now();
    this.state.uploadTelemetry = window.ULUploadTelemetry && window.ULUploadTelemetry.create
      ? window.ULUploadTelemetry.create()
      : null;
    this.setError('');
    this.setProgress(8);
    this.setStage('upload');
    this.state.resumedParts = 0;
    this.render();

    try {
      // Header probe (instant size/price) and content fingerprint run while
      // the intent is negotiated; neither reads more than 2 MB of the file.
      var self = this;
      var probePromise = this.probeAndPreview(file, currentToken);
      var previewPromise = probePromise.then(async function(probe) {
        if (!window.ULFileProbe || !window.ULFileProbe.createPreview) return null;
        var preview = await window.ULFileProbe.createPreview(file, probe).catch(function() { return null; });
        if (preview && currentToken === self.token) {
          if (self.state.localPreviewUrl) {
            try { URL.revokeObjectURL(self.state.localPreviewUrl); } catch (_) {}
          }
          self.state.localPreviewUrl = preview.objectUrl || '';
          self.render();
        }
        return preview;
      });
      var fingerprintPromise = window.ULFileProbe && window.ULFileProbe.fingerprint
        ? window.ULFileProbe.fingerprint(file).catch(function() { return null; })
        : Promise.resolve(null);
      var fingerprint = await fingerprintPromise;
      if (currentToken !== this.token) return;

      var intent = null;
      var resume = null;
      var session = this.loadMpSession(fingerprint, file);
      if (session) {
        var resumeData = null;
        try { resumeData = await this.requestMultipartResume(session); } catch (_) {}
        if (currentToken !== this.token) return;
        if (resumeData) {
          intent = {
            uploadId: session.uploadId,
            itemId: session.itemId,
            key: session.key,
            publicUrl: session.publicUrl,
            storageProvider: 'r2',
            multipart: {
              uploadId: session.multipartUploadId,
              key: session.key,
              partSize: session.partSize,
              totalParts: session.totalParts,
              parts: resumeData.parts || [],
              completeUrl: resumeData.completeUrl,
              abortUrl: resumeData.abortUrl,
              publicUrl: session.publicUrl
            }
          };
          resume = resumeData;
          this.state.resumedParts = (resumeData.uploadedParts || []).length;
          console.log('[UMP] resuming multipart upload ' + session.uploadId + ': ' + this.state.resumedParts + '/' + session.totalParts + ' parts already on R2');
        } else {
          this.clearMpSession(fingerprint);
          session = null;
        }
      }

      if (!intent) {
        var intentResponse = await fetch(this.apiBase + '/api/upload/intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shopDomain: this.shopDomain,
            productId: String(this.productId),
            variantId: this.getFallbackVariantId() || null,
            mode: 'dtf',
            measurementPolicy: POLICY,
            fileName: file.name,
            contentType: file.type || 'application/octet-stream',
            fileSize: file.size,
            customerId: this.customerId || null,
            customerEmail: this.customerEmail || null,
            fingerprint: fingerprint || null,
            partSizeMb: suggestPartSizeMb(file.size)
          })
        });
        intent = await intentResponse.json().catch(function() { return {}; });
        if (!intentResponse.ok) throw new Error(intent.error || 'Failed to create upload intent.');
        if (currentToken !== this.token) return;
      }

      this.state.uploadId = intent.uploadId;
      this.state.itemId = intent.itemId;

      if (intent.deduplicated) {
        // Same file, same customer, already measured: nothing to send.
        console.log('[UMP] instant re-upload: reusing measured upload ' + intent.uploadId);
        this.state.isMultipart = false;
        if (!this.state.fastRaster) this.setStage('measure');
        this.setProgress(86);
        await this.pollStatus(currentToken);
        if (currentToken !== this.token) return;
        this.rememberCurrentUpload();
        this.refreshThumbnail(this.state.uploadId, SERVER_THUMBNAIL_ATTEMPTS);
        this.render();
        return;
      }

      this.state.isMultipart = Boolean(intent.multipart);
      this.setProgress(18);
      this.render();
      var previewUploadPromise = previewPromise.then(function(preview) {
        if (!preview || !window.ULFileProbe || !window.ULFileProbe.uploadPreview) return null;
        return window.ULFileProbe.uploadPreview(self.apiBase, intent.uploadId, intent.itemId, preview)
          .then(function(result) {
            if (result && currentToken === self.token && result.thumbnailUrl) {
              self.state.thumbnailUrl = result.thumbnailUrl;
            }
            return result;
          });
      }).catch(function() { return null; });
      await this.performUpload(file, intent, function(loaded, total) {
        var ratio = total > 0 ? loaded / total : 0;
        this.setProgress(18 + ratio * 52);
        this.setProgressText(loaded, total);
      }.bind(this), { fingerprint: fingerprint, session: session, resume: resume });
      if (currentToken !== this.token) return;
      var headerProbe = null;
      try { headerProbe = await probePromise; } catch (_) {}
      // Thumbnail work is best-effort and never holds server header validation.
      void previewUploadPromise;
      this.setProgressText(0, 0);
      if (!this.state.fastRaster) this.setStage('measure');

      this.setProgress(76);
      var completeResponse = await fetch(this.apiBase + '/api/upload/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopDomain: this.shopDomain,
          uploadId: intent.uploadId,
          items: [{
            itemId: intent.itemId,
            location: 'front',
            fileUrl: intent.publicUrl || null,
            storageProvider: intent.storageProvider || 'local',
            fileSize: file.size,
            headerProbe: headerProbe
          }]
        })
      });
      var complete = await completeResponse.json().catch(function() { return {}; });
      if (!completeResponse.ok) throw new Error(complete.error || 'Failed to finalize upload.');
      if (currentToken !== this.token) return;

      this.setProgress(86);
      if (complete.fastPath) {
        await this.finishFastCompletion(complete, currentToken);
      } else {
        await this.pollStatus(currentToken);
      }
      if (currentToken !== this.token) return;
      this.rememberCurrentUpload();
      // Server-measured formats (PDF, AI, EPS, TIFF, PSD, SVG, WEBP) finish
      // measuring before their preview is rendered; keep asking for it.
      if (!complete.fastPath) this.refreshThumbnail(this.state.uploadId, SERVER_THUMBNAIL_ATTEMPTS);
      this.render();
    } catch (error) {
      if (currentToken !== this.token) return;
      this.state.status = 'error';
      this.state.abort = null;
      this.setProgress(0);
      this.setProgressText(0, 0);
      this.setStage(null);
      var msg = error && error.message ? error.message : 'Upload failed.';
      // The server message carries the real limit ("Maximum size is 1024 MB").
      if (/file too large/i.test(msg) && !/maximum size is \d+/i.test(msg)) msg = 'File too large for this storage tier. Try a smaller file or compress.';
      else if (/unsupported file type/i.test(msg)) msg = 'Unsupported file type. PNG, JPG, WEBP, TIFF, PSD, PDF, AI, EPS and SVG are accepted.';
      else if (/network/i.test(msg)) msg = 'Network issue while uploading. Check your connection and try again.';
      this.setError(msg);
      this.render();
    }
  };

  MainProductUpload.prototype.finishFastCompletion = async function(complete, currentToken) {
    if (currentToken !== this.token) return;
    var item = complete && (complete.item || (complete.items && complete.items[0]));
    if (!item) throw new Error('The server did not return the stored header measurement.');
    this.state.thumbnailUrl = item.thumbnailUrl || this.state.thumbnailUrl || '';
    this.state.originalUrl = item.originalUrl || this.state.originalUrl || '';
    var blocked =
      item.orderabilityStatus === 'blocked' ||
      item.measurementStatus === 'error' ||
      complete.status === 'blocked';
    if (blocked) {
      throw new Error(
        (item.errors && item.errors[0]) ||
        (item.problems && item.problems[0] && item.problems[0].message) ||
        'The stored PNG/JPEG header could not be validated.'
      );
    }
    if (!this.applyMeasurement(item)) {
      throw new Error('The stored PNG/JPEG header did not contain a usable print size.');
    }
    this.state.provisional = false;
    this.state.selectedResult = null;
    this.state.selectedVariantId = '';
    await this.resolveProduct();
    if (currentToken !== this.token) return;
    this.state.status = 'ready';
    this.state.uploadEndTime = Date.now();
    this.setProgress(100);
    this.setStage('ready');
    this.refreshThumbnail(this.state.uploadId);
    setTimeout(function() {
      if (currentToken !== this.token) return;
      this.setProgress(0);
      this.setStage(null);
      this.render();
    }.bind(this), 1200);
    this.render();
  };

  MainProductUpload.prototype.refreshThumbnail = function(uploadId, maxAttempts) {
    if (!uploadId || !window.ULFileProbe || !window.ULFileProbe.waitForThumbnail) return;
    var isCurrent = sameUploadId(this.state.uploadId, uploadId);
    var queued = this.findItem(uploadId);
    if (isCurrent ? this.state.thumbnailUrl : (queued && queued.thumbnailUrl)) return;
    this.thumbnailWaits = this.thumbnailWaits || {};
    if (this.thumbnailWaits[uploadId]) return;
    this.thumbnailWaits[uploadId] = true;
    var self = this;
    var stillListed = function() {
      return Boolean(self.findItem(uploadId) || sameUploadId(self.state.uploadId, uploadId));
    };
    window.ULFileProbe.waitForThumbnail(this.apiBase, this.shopDomain, uploadId, maxAttempts, stillListed)
      .then(function(thumbnailUrl) {
        if (!thumbnailUrl) return;
        var target = self.findItem(uploadId);
        if (target) target.thumbnailUrl = thumbnailUrl;
        if (sameUploadId(self.state.uploadId, uploadId)) self.state.thumbnailUrl = thumbnailUrl;
        self.persistItems();
        self.showArrivedThumbnail(uploadId, thumbnailUrl);
      })
      .catch(function() {})
      .then(function() { delete self.thumbnailWaits[uploadId]; });
  };

  // A preview can land minutes after the file became ready. If the customer is
  // typing a copies value right then, rebuilding the queue would drop it, so
  // only the row thumbnail and the sheet preview are patched.
  MainProductUpload.prototype.showArrivedThumbnail = function(uploadId, thumbnailUrl) {
    var focused = document.activeElement;
    if (!this.queue || !focused || !this.queue.contains(focused)) {
      this.render();
      return;
    }
    var thumbs = this.queue.querySelectorAll('.ump__queue-thumb[data-ump-select-item]');
    for (var i = 0; i < thumbs.length; i += 1) {
      if (sameUploadId(thumbs[i].getAttribute('data-ump-select-item'), uploadId)) {
        thumbs[i].style.backgroundImage = 'url("' + thumbnailUrl.replace(/"/g, '%22') + '")';
      }
    }
    if (sameUploadId(this.state.uploadId, uploadId)) this.updatePreviewGeometry();
  };

  MainProductUpload.prototype.pollStatus = async function(currentToken) {
    // Large gang sheets can take the server minutes to measure: ~8 minutes budget.
    for (var attempt = 0; attempt < 200; attempt += 1) {
      if (currentToken !== this.token) return;
      var response = await fetch(this.apiBase + '/api/upload/status/' + encodeURIComponent(this.state.uploadId) + '?shopDomain=' + encodeURIComponent(this.shopDomain));
      if (response.ok) {
        var data = await response.json();
        var item = data.items && data.items[0] ? data.items[0] : null;
        if (item) {
          this.state.thumbnailUrl = item.thumbnailUrl || data.thumbnailUrl || this.state.thumbnailUrl || '';
          this.state.originalUrl = item.originalUrl || data.downloadUrl || this.state.originalUrl || '';
          if (this.applyMeasurement(item)) {
            // Server measurement replaces the provisional probe entirely.
            this.state.provisional = false;
            this.state.selectedResult = null;
            this.state.selectedVariantId = '';
          }
          var measurementStatus = item.measurementStatus || 'pending';
          var blocked = data.orderabilityStatus === 'blocked' || item.orderabilityStatus === 'blocked' || data.status === 'error';
          if (blocked || measurementStatus === 'error') {
            throw new Error((item.errors && item.errors[0]) || (data.errors && data.errors[0]) || data.error || 'Upload could not be measured.');
          }
          if (this.state.widthIn && this.state.heightIn && measurementStatus !== 'pending') {
            await this.resolveProduct();
            this.state.status = 'ready';
            this.state.uploadEndTime = Date.now();
            this.setProgress(100);
            this.setStage('ready');
            setTimeout(function() {
              if (currentToken !== this.token) return;
              this.setProgress(0);
              this.setStage(null);
              this.render();
            }.bind(this), 1200);
            this.render();
            return;
          }
        }
      }
      this.setProgress(Math.min(94, 86 + attempt));
      this.render();
      await sleep(getStatusPollDelay(attempt));
    }
    throw new Error('Upload finished, but the server did not confirm print size in time.');
  };

  MainProductUpload.prototype.resolveProduct = async function() {
    if (this.customerPricing.status === 'loading' && this.customerPricingPromise) {
      try { await this.customerPricingPromise; } catch (_) {}
    }
    if (this.productConfig.status === 'loading' && this.productConfigPromise) {
      try { await this.productConfigPromise; } catch (_) {}
    }
    if (this.isExactMeasuredMode() && this.hasMeasuredUpload(this.state)) {
      this.setExactMeasuredResult();
      return;
    }
    var data = await this.requestResolve(this.state.uploadId, this.getRequestedCopies());
    if (data.payload && data.payload.upload) this.applyMeasurement(data.payload.upload);
    if (!data.ok) {
      if (this.isExactMeasuredMode() && data.payload && data.payload.upload && this.hasMeasuredUpload(this.state)) {
        this.setExactMeasuredResult();
        return;
      }
      throw new Error(data.payload.error || 'No product variant can fit this upload.');
    }
    if (this.isExactMeasuredMode() && this.hasMeasuredUpload(this.state)) {
      this.setExactMeasuredResult();
      return;
    }
    this.state.selectedResult = data.payload.resolution || null;
    this.state.selectedVariantId = this.state.selectedResult ? String(this.state.selectedResult.selectedVariantId || '') : '';
    if (!this.state.selectedVariantId && !this.isExactMeasuredMode()) throw new Error('No product variant can fit this upload.');
  };

  MainProductUpload.prototype.requestResolve = async function(uploadId, quantity) {
    var linear = this.isLinearInchPricing();
    var response = await fetch(this.apiBase + '/api/upload/resolve-product', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shopDomain: this.shopDomain,
        productId: String(this.productId),
        uploadId: uploadId,
        quantity: Math.max(1, Math.floor(Number(quantity) || 1)),
        selectedVariantId: linear ? null : (this.getFallbackVariantId() || null),
        customerId: this.customerId || null,
        customerEmail: this.customerEmail || null,
        customerName: this.customerName || null,
        measurementPolicy: POLICY
      })
    });
    var payload = await response.json().catch(function() { return {}; });
    return { ok: response.ok, payload: payload || {} };
  };

  // Resolve any upload (not necessarily the active one) for a quantity.
  MainProductUpload.prototype.resolveForUpload = async function(uploadId, quantity) {
    var data = await this.requestResolve(uploadId, quantity);
    if (!data.ok || !data.payload.resolution) {
      throw new Error((data.payload && data.payload.error) || 'Could not resolve this gang sheet.');
    }
    var resolution = data.payload.resolution;
    var selectedVariantId = String(resolution.selectedVariantId || '');
    if (!selectedVariantId) throw new Error('Could not resolve this gang sheet.');
    return { resolution: resolution, selectedVariantId: selectedVariantId };
  };

  // ── Verified cart mutations ─────────────────────────────────────────────
  // Line properties are built by the server (/api/cart/prepare): Print Ready,
  // Sheet Identity and DPI. The
  // add itself is idempotent and verified: read the cart, add only the
  // missing quantity, then re-read to confirm the line is really there.

  // Twin-product override (builderConfig.cartProductHandle): resolve cart
  // variants from a hidden duplicate product so third-party gang-sheet apps
  // that own the PAGE product never see our lines in their checkout rules.
  // Mapping is by variant title (the twin is a duplicate: titles identical).
  MainProductUpload.prototype.resolveCartProductVariants = async function() {
    var config = (this.productConfig && this.productConfig.builderConfig) || {};
    var handle = String(config.cartProductHandle || '').trim();
    if (!handle) return null;
    if (this.cartProductCache && this.cartProductCache.handle === handle) return this.cartProductCache;
    try {
      var response = await fetch('/products/' + encodeURIComponent(handle) + '.js', {
        headers: { 'Accept': 'application/json' }
      });
      if (!response.ok) throw new Error('cart product fetch failed: ' + response.status);
      var product = await response.json();
      var byTitle = {};
      (product.variants || []).forEach(function(variant) {
        byTitle[String(variant.title || '').trim().toLowerCase()] = variant.id;
      });
      this.cartProductCache = { handle: handle, byTitle: byTitle, productId: product.id };
      return this.cartProductCache;
    } catch (error) {
      console.warn('[UMP] cart product override unavailable, using page product:', error);
      return null;
    }
  };

  MainProductUpload.prototype.prepareCartProperties = async function(uploadIds, lines) {
    try {
      var response = await fetch(this.apiBase + '/api/cart/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopDomain: this.shopDomain, uploadIds: uploadIds, lines: lines || [] })
      });
      if (!response.ok) throw new Error('prepare failed: ' + response.status);
      var data = await response.json();
      if (!data || !data.success || !Array.isArray(data.items)) throw new Error('prepare payload invalid');
      var map = {};
      var firstPreparationError = '';
      data.items.forEach(function(entry) {
        if (entry && entry.found && entry.orderable && entry.properties && entry.cartInstruction) {
          map[entry.uploadId] = {
            properties: entry.properties,
            cartInstruction: entry.cartInstruction
          };
        } else if (!firstPreparationError && entry && entry.error) {
          firstPreparationError = String(entry.error);
        }
      });
      if (Object.keys(map).length !== uploadIds.length) {
        throw new Error(firstPreparationError || 'One or more uploads could not be prepared for cart.');
      }
      return map;
    } catch (error) {
      console.warn('[UMP] cart/prepare unavailable:', error);
      throw new Error((error && error.message) || 'Your measured sheet could not be verified for cart. Please try again.');
    }
  };

  MainProductUpload.prototype.fallbackCartProperties = function(item) {
    // Degraded mode when the app API is unreachable: same carriers, built
    // from data the widget already holds. Build the identity link as an
    // absolute proxy URL (https://<shop>/apps/customizer/i/<id>) so it stays
    // clickable from the order admin, not just from the storefront.
    var base = /^https?:/i.test(this.apiBase || '')
      ? this.apiBase
      : (this.shopDomain ? 'https://' + this.shopDomain : '') + (this.apiBase || '/apps/customizer');
    var identityUrl = base + '/i/' + item.uploadId;
    // Same three visible properties the server writes.
    var dpi = Math.round(Number(item.effectiveDpi || item.documentDpi) || 0);
    return {
      'Print Ready': item.originalUrl || identityUrl,
      'Sheet Identity': identityUrl,
      'DPI': dpi > 0 ? String(dpi) : 'n/a'
    };
  };

  // What the customer asked for: every quantity unit is one complete copy of
  // the uploaded gang sheet. Legacy fields remain on the request wire only so
  // older servers can parse it; they carry the same one-sheet-per-copy rule.
  function buildCartLineRequest(item) {
    var result = item.selectedResult || {};
    var copies = Math.max(1, Number(item.copies) || 1);
    var sheetLabel = String(result.selectedSheetLabel || result.selectedVariantTitle || '');
    return {
      uploadId: item.uploadId,
      copies: copies,
      designsPerSheet: 1,
      sheetsNeeded: copies,
      variantId: String(item.selectedVariantId || ''),
      sheetLabel: sheetLabel
    };
  }

  MainProductUpload.prototype.readCart = async function() {
    var response = await fetch('/cart.js', {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store'
    });
    if (!response.ok) throw new Error('Cart read failed with status ' + response.status);
    return response.json();
  };

  function cartLineMatchesUpload(line, uploadId) {
    var props = (line && line.properties) || {};
    if (props['_ul_upload_id'] === uploadId) return true;
    var identity = String(props['Sheet Identity'] || props['_ul_identity'] || props['Design Identity'] || '');
    return identity.indexOf('/i/' + uploadId) !== -1;
  }

  function cartLinesForUpload(cart, uploadId) {
    return ((cart && cart.items) || []).filter(function(line) { return cartLineMatchesUpload(line, uploadId); });
  }

  // A line is "exactly what we want" when variant and whole-sheet quantity
  // match; anything else is stale.
  function cartLineIsExact(line, cartItem) {
    if (Number(line.variant_id || line.id) !== Number(cartItem.id)) return false;
    if ((Number(line.quantity) || 0) !== cartItem.quantity) return false;
    var props = line.properties || {};
    var want = cartItem.properties || {};
    return String(props['Sheet Identity'] || '') === String(want['Sheet Identity'] || '');
  }

  // Shopify applies /cart/*.js writes from different tabs without ordering, so
  // two tabs adding at once can drop each other's line. Every cart write of
  // our blocks in this browser runs under one Web Lock (same name in the Mod2
  // block); browsers without Web Locks run unlocked, as before.
  // A tab never waits more than 20 s for another tab's lock; after that it
  // writes unlocked, exactly as before the lock existed.
  function withCartLock(task) {
    if (typeof navigator === 'undefined' || !navigator.locks || typeof navigator.locks.request !== 'function') {
      return task();
    }
    var acquired = false;
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = controller ? setTimeout(function() { controller.abort(); }, 20000) : null;
    return navigator.locks.request('ul-shopify-cart', controller ? { signal: controller.signal } : {}, function() {
      acquired = true;
      if (timer) clearTimeout(timer);
      return task();
    }).catch(function(error) {
      if (!acquired && error && error.name === 'AbortError') return task();
      throw error;
    });
  }

  async function cartRequest(url, body) {
    var response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      var payload = await response.json().catch(function() { return {}; });
      var error = new Error(payload.description || payload.message || ('Cart request failed with status ' + response.status));
      error.status = response.status;
      throw error;
    }
    return response.json().catch(function() { return {}; });
  }

  // Idempotent, Shopify-native cart sync for one gang sheet:
  //   1. read the cart (/cart.js)
  //   2. if a line for this upload already matches variant + quantity → done
  //   3. otherwise drop every stale line for this upload (/cart/change.js by
  //      line key, quantity 0 — never by index, which shifts)
  //   4. add the desired line once (/cart/add.js)
  //   5. re-read and verify the line is there with the right quantity.
  // Quantity is the number of complete sheets Shopify bills.
  MainProductUpload.prototype.ensureCartLine = async function(cartItem, uploadId) {
    var attempts = 0;
    var maxAttempts = 3;
    while (true) {
      attempts += 1;
      try {
        var cart = await this.readCart();
        var lines = cartLinesForUpload(cart, uploadId);
        if (lines.length === 1 && cartLineIsExact(lines[0], cartItem)) return cart;

        for (var i = 0; i < lines.length; i += 1) {
          if (lines[i].key) await cartRequest('/cart/change.js', { id: lines[i].key, quantity: 0 });
        }

        await cartRequest('/cart/add.js', {
          items: [{
            id: cartItem.id,
            quantity: cartItem.quantity,
            properties: cartItem.properties
          }]
        });

        var after = await this.readCart();
        var verified = cartLinesForUpload(after, uploadId);
        if (verified.length === 1 && cartLineIsExact(verified[0], cartItem)) return after;
        throw new Error('Cart line not verified after add.');
      } catch (error) {
        var status = Number(error && error.status);
        // 409: Shopify rejected a concurrent write to this cart; retry it.
        var terminal = status >= 400 && status < 500 && status !== 408 && status !== 409 && status !== 429;
        if (terminal || attempts >= maxAttempts) throw error;
        await new Promise(function(resolve) { setTimeout(resolve, 400 * Math.pow(2, attempts - 1)); });
      }
    }
  };

  // Cart reads outside ensureCartLine get the same retry/backoff it uses.
  MainProductUpload.prototype.readCartRetrying = async function() {
    for (var attempt = 1; ; attempt += 1) {
      try {
        return await this.readCart();
      } catch (error) {
        if (attempt >= 3) throw error;
        await sleep(400 * Math.pow(2, attempt - 1));
      }
    }
  };

  // Last check before leaving the page: the theme (or a browser without Web
  // Locks) may have rewritten the cart meanwhile. Put back any of this tab's
  // lines that are gone, and fail loudly rather than redirect without them.
  // If the cart cannot be read at all, ensureCartLine's verified cart stands.
  MainProductUpload.prototype.verifyCartLines = async function(cartItems, verifiedCart) {
    var hasLine = function(cart, cartItem) {
      return cartLinesForUpload(cart, cartItem.uploadId).some(function(line) {
        return cartLineIsExact(line, cartItem);
      });
    };
    for (var round = 0; round < 3; round += 1) {
      var cart;
      try {
        cart = await this.readCartRetrying();
      } catch (_) {
        return verifiedCart;
      }
      var missing = cartItems.filter(function(cartItem) { return !hasLine(cart, cartItem); });
      if (!missing.length) return cart;
      if (round === 2) break;
      for (var i = 0; i < missing.length; i += 1) {
        verifiedCart = await this.ensureCartLine(missing[i], missing[i].uploadId);
      }
    }
    throw new Error('Some gang sheets could not be added to the cart. Please try again.');
  };

  MainProductUpload.prototype.bindCartToken = async function(cart, uploadIds) {
    try {
      var token = cart && cart.token ? String(cart.token) : '';
      if (!token) {
        var fresh = await this.readCart();
        token = fresh && fresh.token ? String(fresh.token) : '';
      }
      if (!token) return;
      await fetch(this.apiBase + '/api/cart/bind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopDomain: this.shopDomain, cartToken: token, uploadIds: uploadIds })
      });
    } catch (error) {
      // Binding is a redundancy layer; never block checkout on it.
      console.warn('[UMP] cart token bind failed (non-fatal):', error);
    }
  };

  // Shopify's native order note (cart.note → order "Notes"), so the three line
  // properties stay untouched. Appends instead of overwriting whatever the
  // customer or the theme's cart page already wrote, and gives up silently
  // after 3 s. Each note names its files: several tabs can add notes to one cart.
  MainProductUpload.prototype.saveOrderNote = async function(fileNames) {
    var text = this.orderNoteInput ? String(this.orderNoteInput.value || '').trim().slice(0, 500) : '';
    if (!text) return;
    var files = (fileNames || []).filter(Boolean).join(', ').slice(0, 300);
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = controller ? setTimeout(function() { controller.abort(); }, 3000) : null;
    try {
      var signal = controller ? controller.signal : undefined;
      var cartResponse = await fetch('/cart.js', { headers: { 'Accept': 'application/json' }, signal: signal });
      var cart = cartResponse.ok ? await cartResponse.json() : {};
      var current = String((cart && cart.note) || '');
      var line = 'Gang sheet note' + (files ? ' (' + files + ')' : '') + ': ' + text;
      if (current.indexOf(line) >= 0) return;
      var next = current ? current + '\n' + line : line;
      await fetch('/cart/update.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ note: next.slice(0, 5000) }),
        signal: signal
      });
    } catch (error) {
      console.warn('[UMP] order note was not saved:', error && error.message ? error.message : error);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  MainProductUpload.prototype.addToCart = async function(redirectTo) {
    var readyItems = this.getReadyItems();
    if (!readyItems.length) {
      this.setError('Please upload your design first.');
      return;
    }
    if (this.state.status === 'uploading') {
      this.setError('Please wait until every gang sheet is measured.');
      return;
    }
    this.setError('');
    // Held until redirect or failure so no background render() (e.g. a late
    // preview) re-enables the buttons and lets a second click add twice.
    this.cartBusy = true;
    this.addButton.disabled = true;
    if (this.checkoutButton) this.checkoutButton.disabled = true;

    try {
      var self = this;
      // An upload restored from this product's saved list that another tab
      // already put in the cart is that tab's line; adding it here would
      // replace the line with this tab's copies. Leave it where it is. Checked
      // before prepare (so its row keeps that tab's copies) and again under
      // the cart lock. A failed read here just means "none found".
      var addedElsewhere = [];
      if (readyItems.some(function(item) { return item.restored; })) {
        var cartBefore = await this.readCart().catch(function() { return null; });
        addedElsewhere = readyItems.filter(function(item) {
          return item.restored && cartLinesForUpload(cartBefore, item.uploadId).length > 0;
        });
      }
      if (addedElsewhere.length) {
        this.forgetUploads(addedElsewhere.map(function(item) { return item.uploadId; }));
        readyItems = readyItems.filter(function(item) { return addedElsewhere.indexOf(item) === -1; });
        if (!readyItems.length) {
          await withCartLock(function() {
            return self.saveOrderNote(addedElsewhere.map(function(item) { return item.fileName; }));
          });
          window.location.href = discountRedirect(redirectTo || '/cart', this.getDiscountCode());
          return;
        }
      }
      var uploadIds = readyItems.map(function(item) { return item.uploadId; });
      var fileNames = readyItems.map(function(item) { return item.fileName; });
      var lineRequests = readyItems.map(buildCartLineRequest);
      var serverProperties = await this.prepareCartProperties(uploadIds, lineRequests);

      var cartItems = readyItems.map(function(item) {
        var result = item.selectedResult || {};
        var preparedLine = serverProperties[item.uploadId];
        if (!preparedLine) throw new Error('A measured gang sheet could not be verified for cart.');
        var variantId = parseInt(preparedLine.cartInstruction.variantId || item.selectedVariantId, 10);
        if (!(variantId > 0)) throw new Error('A measured gang sheet has no matching variant.');
        var requestedLine = buildCartLineRequest(item);
        // A linear-inch variant uses Shopify quantity as the integer-inch
        // billing carrier. Physical production quantity remains `copies` and
        // is what /api/cart/prepare validates. Sheet-priced variants continue
        // to use one Shopify unit per whole-sheet copy.
        var quantity = self.isLinearInchPricing()
          ? Math.max(1, Math.ceil(Number(
              preparedLine.cartInstruction.cartQuantity || result.cartQuantity || 0
            ) || 1))
          : requestedLine.sheetsNeeded;
        var properties = preparedLine.properties;
        var pageVariant = (self.variants || []).find(function(v) {
          return Number(v && v.id) === variantId;
        });
        return {
          id: variantId,
          quantity: quantity,
          properties: properties,
          uploadId: item.uploadId,
          fileName: item.fileName,
          restored: Boolean(item.restored),
          variantTitle: String(preparedLine.cartInstruction.variantTitle || result.selectedVariantTitle || (pageVariant && pageVariant.title) || '')
        };
      });
      // From here on these are this tab's own cart lines, also on a retry.
      readyItems.forEach(function(item) { item.restored = false; });

      var twin = await this.resolveCartProductVariants();
      if (twin) {
        cartItems.forEach(function(cartItem) {
          var key = cartItem.variantTitle.trim().toLowerCase();
          var mapped = key && twin.byTitle[key];
          if (mapped) {
            cartItem.id = Number(mapped);
          } else {
            console.warn('[UMP] twin variant not found for "' + cartItem.variantTitle + '"; keeping page product variant');
          }
        });
      }

      // One tab at a time writes the cart (see withCartLock), so tabs adding
      // DTF and UV sheets at the same moment cannot drop each other's lines.
      var syncedCart = await withCartLock(async function() {
        if (cartItems.some(function(cartItem) { return cartItem.restored; })) {
          // Another tab may have added a restored upload while this one waited.
          var current = await self.readCart().catch(function() { return null; });
          cartItems = cartItems.filter(function(cartItem) {
            return !(cartItem.restored && cartLinesForUpload(current, cartItem.uploadId).length > 0);
          });
        }
        var cart = null;
        for (var i = 0; i < cartItems.length; i++) {
          cart = await self.ensureCartLine(cartItems[i], cartItems[i].uploadId);
        }
        if (cartItems.length) cart = await self.verifyCartLines(cartItems, cart);

        // Runs only after every line is in the cart and never throws: a note that
        // cannot be saved must not stop the customer from reaching cart/checkout.
        await self.saveOrderNote(fileNames);
        return cart;
      });

      // An app-server call, not a cart write: kept out of the lock.
      if (cartItems.length) {
        await this.bindCartToken(syncedCart, cartItems.map(function(cartItem) { return cartItem.uploadId; }));
      }

      // The cart owns these uploads now; do not show them again on return.
      this.forgetUploads(uploadIds);

      window.location.href = discountRedirect(redirectTo || '/cart', this.getDiscountCode());
    } catch (error) {
      this.setError(error && error.message ? error.message : 'Failed to add to cart.');
      this.cartBusy = false;
      this.addButton.disabled = false;
      if (this.checkoutButton) this.checkoutButton.disabled = false;
      this.render();
    }
  };

  function init() {
    var roots = document.querySelectorAll(ROOT_SELECTOR);
    roots.forEach(function(root) {
      if (root.dataset.umpInitialized === 'true') return;
      root.dataset.umpInitialized = 'true';
      new MainProductUpload(root);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  document.addEventListener('shopify:section:load', init);
})();
