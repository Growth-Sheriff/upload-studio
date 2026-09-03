(function() {
  var ROOT_SELECTOR = '[data-ul-main-product-upload-app]';
  var POLICY = 'main_product_roll_width';

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

  function normalizeVariantPrice(raw) {
    if (raw == null || raw === '') return 0;
    var numeric = Number(raw);
    if (!isFinite(numeric) || numeric <= 0) return 0;
    return numeric > 100 ? numeric / 100 : numeric;
  }

  function formatMoney(value, currency) {
    var n = normalizeVariantPrice(value);
    if (!n) return '--';
    try {
      return new Intl.NumberFormat(undefined, {
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
        item.heightIn || ''
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
      return sum + normalizeVariantPrice(entry.totalPrice || entry.exactTotal || 0);
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
    var match = String(label || '').match(/(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)/);
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

  function getStatusPollDelay(attempt) {
    if (attempt < 6) return 350;
    if (attempt < 14) return 700;
    if (attempt < 28) return 1000;
    return 1500;
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
    this.rollWidthIn = toNumber(root.getAttribute('data-roll-width-in')) || 22;
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
    this.requestedCopies = 1;
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
          isMultipart: item.isMultipart,
          uploadStartTime: item.uploadStartTime,
          uploadEndTime: item.uploadEndTime
        };
      });
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
      return item;
    });
    if (!items.length) return;

    // Optimistic restore, then server verification (drop purchased/expired).
    this.state.items = items;
    this.loadUploadItem(items[items.length - 1]);
    this.state.status = 'ready';
    this.setStage(null);
    var self = this;
    Promise.all(items.map(function(item) {
      return fetch(self.apiBase + '/api/upload/status/' + encodeURIComponent(item.uploadId) + '?shopDomain=' + encodeURIComponent(self.shopDomain))
        .then(function(res) { return res.ok ? res.json() : null; })
        .catch(function() { return null; });
    })).then(function(results) {
      var kept = [];
      results.forEach(function(status, index) {
        var item = items[index];
        if (!status || status.error) return;                 // gone on the server
        if (status.orderId) return;                           // already purchased
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
    this.copies = this.root.querySelector('[data-ump-copies]');
    this.copiesInput = this.root.querySelector('[data-ump-copies-input]');
    this.copiesMinus = this.root.querySelector('[data-ump-copies-minus]');
    this.copiesPlus = this.root.querySelector('[data-ump-copies-plus]');
    this.copiesSummary = this.root.querySelector('[data-ump-copies-summary]');
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
    this.priceNow = this.root.querySelector('[data-ump-price-now]');
    this.priceNowValue = this.root.querySelector('[data-ump-price-now-value]');
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
        var size = entry.widthIn && entry.heightIn ? formatInches(entry.widthIn) + ' x ' + formatInches(entry.heightIn) : 'Measured upload';
        return [
          '<div class="ump__exact-cart-item">',
            '<span>', escapeHtml(entry.fileName || entry.productTitle || 'Gang sheet'), '</span>',
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
        quantity: 1,
        selectedVariantId: item.selectedVariantId || this.getFallbackVariantId() || null,
        measurementPolicy: POLICY,
        rollWidthIn: this.rollWidthIn,
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
      return String(entry.uploadId) === String(this.state.uploadId);
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
      cartQuantity += Math.max(1, Number(result.cartQuantity || result.sheetsNeeded) || Math.ceil(length || 1));
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
      var qty = Math.max(1, Number(result.cartQuantity || result.sheetsNeeded) || 1);
      var id = String(item.selectedVariantId || '');
      if (id) qtyByVariant[id] = (qtyByVariant[id] || 0) + qty;
    });
    var pendingId = !readyItems.length && this.state.selectedVariantId ? String(this.state.selectedVariantId) : '';
    var selectedCount = Object.keys(qtyByVariant).length;

    var rows = variants.map(function(variant) {
      var id = String(variant.id);
      var qty = qtyByVariant[id] || 0;
      var selected = qty > 0 || (pendingId && pendingId === id);
      var unavailable = variant.available === false || variant.availableForSale === false;
      return [
        '<tr class="', selected ? 'is-selected' : '', unavailable ? ' is-unavailable' : '', '">',
          '<td>', selected ? '<span class="ump__price-check">✓</span>' : '', '<strong>', escapeHtml(getVariantLabel(variant)), '</strong>',
            selected ? '<span class="ump__price-auto">Auto-selected</span>' : '',
            qty > 1 ? '<span class="ump__price-qty">×' + qty + '</span>' : '',
          '</td>',
          '<td>', escapeHtml(formatMoney(variant.price, this.currency)), '</td>',
        '</tr>'
      ].join('');
    }, this).join('');

    var noticeHtml = selectedCount
      ? '<p class="ump__price-notice" role="status">' +
          '<strong>Auto-selected by the system.</strong> Based on the measured size of your file' +
          (selectedCount === 1 ? ', the highlighted sheet size was chosen automatically' : ', the highlighted sheet sizes were chosen automatically') +
          ' &mdash; please check it before you add to cart.' +
        '</p>'
      : '';

    this.priceTable.innerHTML = [
      '<div class="ump__price-table-head">',
        '<span>Sheet sizes &amp; prices</span>',
        '<small>', selectedCount ? 'System selection' : (pendingId && this.state.provisional ? 'Estimated · confirming' : 'Selected automatically after upload'), '</small>',
      '</div>',
      noticeHtml,
      '<table class="ump__price-table">',
        '<thead><tr><th>Sheet size</th><th>Price</th></tr></thead>',
        '<tbody>', rows, '</tbody>',
      '</table>'
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
    // Copies stepper: re-resolves the active upload with the new quantity so
    // designs-per-sheet / sheets-needed come from the server nesting logic.
    var onCopiesChange = function(next) {
      var n = Math.floor(Number(next));
      if (!(n > 0)) n = 1;
      if (n > 999) n = 999;
      if (n === self.getRequestedCopies()) { self.renderCopies(); return; }
      self.requestedCopies = n;
      self.renderCopies();
      self.reresolveForCopies();
    };
    if (this.copiesMinus) this.copiesMinus.addEventListener('click', function(event) { event.preventDefault(); onCopiesChange(self.getRequestedCopies() - 1); });
    if (this.copiesPlus) this.copiesPlus.addEventListener('click', function(event) { event.preventDefault(); onCopiesChange(self.getRequestedCopies() + 1); });
    if (this.copiesInput) this.copiesInput.addEventListener('change', function() { onCopiesChange(self.copiesInput.value); });
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
      localPreviewUrl: file && file.type && file.type.indexOf('image/') === 0 ? URL.createObjectURL(file) : '',
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
          measurementPolicy: POLICY,
          rollWidthIn: this.rollWidthIn,
          maxUploadWidth: this.rollWidthIn
        })
      });
      var data = await response.json().catch(function() { return {}; });
      if (currentToken !== this.token || !this.state.provisional) return probe;
      if (data && data.dimensions) this.applyMeasurement(data.dimensions);
      if (response.ok && data.resolution) {
        this.state.selectedResult = data.resolution;
        this.state.selectedVariantId = String(data.resolution.selectedVariantId || '');
      }
      this.render();
    } catch (_) {}
    return probe;
  };

  MainProductUpload.prototype.renderCopies = function() {
    if (!this.copies) return;
    var show = !this.isExactMeasuredMode() && Boolean(this.state.uploadId) && this.state.status !== 'error';
    this.copies.hidden = !show;
    if (!show) return;
    var copies = this.getRequestedCopies();
    if (this.copiesInput && String(this.copiesInput.value) !== String(copies)) this.copiesInput.value = String(copies);
    if (this.copiesMinus) this.copiesMinus.disabled = copies <= 1 || this.state.status === 'uploading';
    if (this.copiesPlus) this.copiesPlus.disabled = copies >= 999 || this.state.status === 'uploading';
    if (this.copiesSummary) {
      var result = this.state.selectedResult || {};
      var perSheet = Number(result.designsPerSheet) || 0;
      var sheets = Number(result.cartQuantity || result.sheetsNeeded) || 0;
      var text = '';
      if (result.pricingMode === 'linear_inches') {
        text = sheets ? sheets + ' billable inches' : '';
      } else if (perSheet > 0 && sheets > 0) {
        text = perSheet + ' per sheet · ' + sheets + ' sheet' + (sheets === 1 ? '' : 's');
      }
      this.copiesSummary.textContent = text + (this.state.provisional && text ? ' (est.)' : '');
    }
  };

  MainProductUpload.prototype.reresolveForCopies = async function() {
    if (this.isExactMeasuredMode()) return;
    if (!this.state.uploadId || this.state.status === 'uploading') return;
    var currentToken = this.token;
    var uploadId = this.state.uploadId;
    try {
      await this.resolveProduct();
      if (currentToken !== this.token || !sameUploadId(this.state.uploadId, uploadId)) return;
      this.rememberCurrentUpload();
      this.setError('');
    } catch (error) {
      if (currentToken !== this.token) return;
      this.setError(error && error.message ? error.message : 'No product variant can fit this quantity.');
    }
    this.render();
  };

  MainProductUpload.prototype.getRequestedCopies = function() {
    var n = Math.floor(Number(this.requestedCopies));
    return n > 0 ? Math.min(n, 999) : 1;
  };

  // Rotation hint: the policy measures against the roll width; a design that
  // only fits sideways is worth telling the customer about.
  MainProductUpload.prototype.getRotationHint = function() {
    var roll = toNumber(this.rollWidthIn);
    var w = toNumber(this.state.widthIn);
    var h = toNumber(this.state.heightIn);
    if (!(roll > 0) || !(w > 0) || !(h > 0)) return '';
    if (w > roll && h <= roll) return 'Wider than the ' + formatInches(roll) + ' roll — it will be placed rotated (' + formatInches(h) + ' x ' + formatInches(w) + ').';
    return '';
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

  MainProductUpload.prototype.renderQueue = function() {
    if (!this.queue) return;
    var items = this.getQueueItems();
    if (!items.length) {
      this.queue.hidden = true;
      this.queue.innerHTML = '';
      return;
    }
    var readyCount = items.filter(this.isCartReadyItem.bind(this)).length;
    this.queue.hidden = false;
    this.queue.innerHTML =
      '<div class="ump__queue-head">' +
        '<span>Gang sheets</span>' +
        '<strong>' + readyCount + '/' + items.length + ' ready</strong>' +
      '</div>' +
      '<div class="ump__queue-list">' +
        items.map(function(item, index) {
          var isActive = sameUploadId(item.uploadId, this.state.activeItemId || this.state.uploadId);
          var isReady = this.isCartReadyItem(item);
          var statusLabel = isReady ? 'Ready' : (item.status === 'error' ? 'Error' : (item.status === 'uploading' ? 'Uploading' : 'Measuring'));
          var sheetLabel = this.isExactMeasuredMode() && isReady
            ? 'Exact measured'
            : item.selectedResult
            ? (item.selectedResult.selectedSheetLabel || item.selectedResult.selectedVariantTitle || '')
            : '';
          var sizeText = item.widthIn && item.heightIn
            ? formatInches(item.widthIn) + ' x ' + formatInches(item.heightIn)
            : 'Measuring';
          var thumbUrl = item.thumbnailUrl || item.localPreviewUrl || '';
          var isBusy = !isReady && item.status !== 'error';
          return '' +
            '<div class="ump__queue-item' + (isActive ? ' is-active' : '') + (isBusy ? ' is-busy' : '') + (item.status === 'error' ? ' is-error' : '') + '">' +
              '<button class="ump__queue-main" type="button" data-ump-select-item="' + escapeHtml(item.uploadId || '') + '">' +
                '<span class="ump__queue-index">' + (index + 1) + '</span>' +
                (thumbUrl
                  ? '<span class="ump__queue-thumb" style="background-image:url(&quot;' + escapeHtml(thumbUrl.replace(/"/g, '%22')) + '&quot;)"></span>'
                  : '<span class="ump__queue-thumb"></span>') +
                '<span class="ump__queue-copy">' +
                  '<span class="ump__queue-name">' + escapeHtml(item.fileName || 'Gang sheet') + '</span>' +
                  '<span class="ump__queue-meta">' + escapeHtml(sizeText) + (sheetLabel ? ' / ' + escapeHtml(sheetLabel) : '') + '</span>' +
                '</span>' +
                '<span class="ump__queue-status' + (isReady ? ' is-ready' : '') + '">' + escapeHtml(statusLabel) + '</span>' +
              '</button>' +
              (isReady ? '<button class="ump__queue-remove" type="button" data-ump-remove-item="' + escapeHtml(item.uploadId || '') + '" aria-label="Remove ' + escapeHtml(item.fileName || 'gang sheet') + '">Remove</button>' : '') +
            '</div>';
        }.bind(this)).join('') +
      '</div>';
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
    if (source === 'sheet_width_anchor') return 'Measured against the configured roll width.';
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
      return { width: this.state.widthIn, height: this.state.heightIn, label: 'Exact measured' };
    }
    var label = this.state.selectedResult
      ? (this.state.selectedResult.selectedSheetLabel || this.state.selectedResult.selectedVariantTitle || '')
      : '';
    var parsed = parseSheetSize(label) || { width: this.rollWidthIn, height: Math.max(this.rollWidthIn, this.state.heightIn || 12) };
    var designLandscape = this.state.widthIn >= this.state.heightIn;
    var sheetLong = Math.max(parsed.width, parsed.height);
    var sheetShort = Math.min(parsed.width, parsed.height);
    return designLandscape
      ? { width: sheetLong, height: sheetShort, label: label || '--' }
      : { width: sheetShort, height: sheetLong, label: label || '--' };
  };

  MainProductUpload.prototype.updatePreviewGeometry = function() {
    var hasSize = this.state.widthIn > 0 && this.state.heightIn > 0;
    var sheet = this.parseSelectedSheet();
    var sheetRatio = sheet.width > 0 && sheet.height > 0 ? sheet.width / sheet.height : 1.83;
    var artW = 58;
    var artH = 34;
    if (hasSize) {
      artW = Math.max(6, Math.min(100, (this.state.widthIn / sheet.width) * 100));
      artH = Math.max(6, Math.min(100, (this.state.heightIn / sheet.height) * 100));
    }
    this.root.style.setProperty('--ump-sheet-ratio', String(Math.max(0.45, Math.min(4.5, sheetRatio))));
    this.root.style.setProperty('--ump-art-w', artW.toFixed(2) + '%');
    this.root.style.setProperty('--ump-art-h', artH.toFixed(2) + '%');
    this.rulerTop.setAttribute('data-label', formatInches(sheet.width));
    this.rulerSide.setAttribute('data-label', formatInches(sheet.height));

    // Dimension callouts on the artwork and sheet utilization (design area
    // over selected sheet area) — the two numbers a gang-sheet buyer checks
    // before paying.
    if (this.artDimW) {
      this.artDimW.hidden = !hasSize;
      if (hasSize) this.artDimW.textContent = formatInches(this.state.widthIn);
    }
    if (this.artDimH) {
      this.artDimH.hidden = !hasSize;
      if (hasSize) this.artDimH.textContent = formatInches(this.state.heightIn);
    }
  };

  MainProductUpload.prototype.getSelectedVariantPrice = function() {
    var id = String(this.state.selectedVariantId || '');
    if (!id) return 0;
    for (var i = 0; i < (this.variants || []).length; i += 1) {
      if (String(this.variants[i] && this.variants[i].id) === id) return normalizeVariantPrice(this.variants[i].price);
    }
    return 0;
  };

  MainProductUpload.prototype.renderPriceNow = function(readyItems) {
    if (!this.priceNow || !this.priceNowValue) return;
    if (this.isExactMeasuredMode() || this.isLinearInchPricing()) { this.priceNow.hidden = true; return; }
    var total = 0;
    var count = 0;
    (readyItems || []).forEach(function(item) {
      var result = item.selectedResult || {};
      var qty = Math.max(1, Number(result.cartQuantity || result.sheetsNeeded) || 1);
      var variantId = String(item.selectedVariantId || '');
      var price = 0;
      for (var i = 0; i < (this.variants || []).length; i += 1) {
        if (String(this.variants[i] && this.variants[i].id) === variantId) { price = normalizeVariantPrice(this.variants[i].price); break; }
      }
      if (price > 0) { total += price * qty; count += qty; }
    }, this);
    if (!(total > 0)) { this.priceNow.hidden = true; return; }
    this.priceNow.hidden = false;
    this.priceNowValue.innerHTML = escapeHtml(formatMoney(total, this.currency)) +
      '<small>' + count + ' sheet' + (count === 1 ? '' : 's') + '</small>';
  };

  MainProductUpload.prototype.buildCustomItems = function(items) {
    return items.map(function(item) {
      return {
        uploadId: item.uploadId,
        quantity: Math.max(1, Number(item.quantity || 1) || 1),
        selectedVariantId: item.selectedVariantId || null,
        measurementPolicy: item.measurementPolicy || POLICY,
        rollWidthIn: toNumber(item.rollWidthIn) || this.rollWidthIn
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
          rollWidthIn: this.rollWidthIn,
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
          rollWidthIn: this.rollWidthIn,
          items: this.buildCustomItems(checkoutEntries)
        })
      });
      var data = await response.json().catch(function() { return {}; });
      if (!response.ok) throw new Error(data.error || 'Failed to create exact checkout.');
      var redirect = data.checkoutUrl || data.redirectUrl || data.url || data.invoiceUrl;
      if (!redirect) throw new Error('Exact checkout URL was not returned.');
      this.writeExactCart([]);
      window.location.href = redirect;
    } catch (error) {
      this.setError(error && error.message ? error.message : 'Failed to create exact checkout.');
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
    var hasUpload = Boolean(this.state.uploadId || this.state.fileName);
    this.statusPanel.hidden = !hasUpload;
    this.fileName.textContent = this.state.fileName || 'Waiting for file';

    var fileMetaText = 'Upload a file to detect the gang sheet size.';
    if (this.state.status === 'ready') {
      var dur = (this.state.uploadEndTime && this.state.uploadStartTime)
        ? ((this.state.uploadEndTime - this.state.uploadStartTime) / 1000).toFixed(1) + 's'
        : null;
      fileMetaText = 'Ready' + (dur ? ' in ' + dur : '') + '. ' + this.getMethodText();
    } else if (this.state.status === 'uploading') {
      var provisionalText = this.state.provisional && this.state.widthIn && this.state.heightIn
        ? 'Estimated ' + formatInches(this.state.widthIn) + ' x ' + formatInches(this.state.heightIn) +
          (this.state.selectedResult && this.state.selectedResult.selectedSheetLabel ? ' → ' + this.state.selectedResult.selectedSheetLabel : '') +
          ' · confirming on server. '
        : '';
      var rotationHint = this.getRotationHint();
      fileMetaText = provisionalText + (this.state.resumedParts > 0
        ? 'Resuming upload — ' + this.state.resumedParts + ' chunks already on the server...'
        : this.state.isMultipart
        ? 'Uploading in parallel chunks...'
        : 'Uploading and measuring...') + (rotationHint ? ' ' + rotationHint : '');
    } else if (this.state.status === 'error') {
      fileMetaText = 'Upload failed. You can try again or pick a different file.';
    }
    this.fileMeta.textContent = fileMetaText;

    var imageUrl = this.state.thumbnailUrl || this.state.localPreviewUrl || '';
    if (imageUrl) {
      this.thumb.hidden = false;
      this.thumb.src = imageUrl;
      this.art.classList.add('has-image');
      this.art.style.backgroundImage = 'url("' + imageUrl.replace(/"/g, '%22') + '")';
    } else {
      this.thumb.hidden = true;
      this.thumb.removeAttribute('src');
      this.art.classList.remove('has-image');
      this.art.style.backgroundImage = '';
    }

    this.renderFilePills(this.state.lastFile, this.state.isMultipart);
    this.renderQueue();

    if (this.cancel) this.cancel.hidden = this.state.status !== 'uploading';
    if (this.retry) this.retry.hidden = this.state.status !== 'error';
    if (this.replace) this.replace.textContent = queueItems.length ? 'Add more' : 'Replace';

    this.size.textContent = this.state.widthIn && this.state.heightIn
      ? formatInches(this.state.widthIn) + ' x ' + formatInches(this.state.heightIn)
      : '-- x --';
    this.width.textContent = formatInches(this.state.widthIn);
    this.height.textContent = formatInches(this.state.heightIn);
    this.sheetLabel.textContent = exactMode && this.state.widthIn && this.state.heightIn
      ? 'Exact measured'
      : this.state.selectedResult
      ? (this.state.selectedResult.selectedSheetLabel || this.state.selectedResult.selectedVariantTitle || '--') + (this.state.provisional ? ' (est.)' : '')
      : '--';
    this.renderQuality();
    this.renderPriceNow(readyItems);
    this.renderPriceTable();
    this.renderCopies();
    this.method.textContent = this.getMethodText();

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
      badgeLabel = this.state.uploadId ? 'Measuring' : 'Uploading';
      badgeClass = this.state.uploadId ? 'is-measuring' : 'is-uploading';
    } else if (this.state.status === 'error') {
      badgeLabel = 'Error'; badgeClass = '';
    } else {
      badgeLabel = 'Locked'; badgeClass = '';
    }
    this.badge.textContent = badgeLabel;
    this.badge.classList.remove('is-ready', 'is-uploading', 'is-measuring');
    if (badgeClass) this.badge.classList.add(badgeClass);

    this.addButton.disabled = exactMode ? !addReady : !ready;
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
    if (this.checkoutButton) this.checkoutButton.disabled = !ready;
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
    if (this.artLabel) this.artLabel.textContent = this.state.fileName || 'Upload preview';
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
            onPartDone: function(partNumber, etag) {
              if (!session) return;
              session.parts[partNumber] = etag;
              self.saveMpSession(fingerprint, session);
            }
          });
          if (mpResult) {
            intent.publicUrl = mpResult.fileUrl || intent.publicUrl;
            intent.storageProvider = mpResult.storageProvider;
            this.clearMpSession(fingerprint);
            return;
          }
          break;
        } catch (mpErr) {
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

    if (storageProvider !== 'local') {
      await sendUploadXhr(this.apiBase + '/api/upload/local', 'POST', file, {
        __extraFields: { key: intent.key || '', uploadId: intent.uploadId || '', itemId: intent.itemId || '' }
      }, onProgress, function(xhr) {
        self.state.abort = function() { try { xhr.abort(); } catch (_) {} };
      });
      self.state.abort = null;
      this.clearMpSession(fingerprint);
      return;
    }

    throw lastError || new Error('Upload failed');
  };

  MainProductUpload.prototype.startUploads = async function(files) {
    var list = toFileArray(files);
    if (!list.length) return;
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
        this.setStage('measure');
        this.setProgress(86);
        await this.pollStatus(currentToken);
        if (currentToken !== this.token) return;
        this.rememberCurrentUpload();
        this.render();
        return;
      }

      this.state.isMultipart = Boolean(intent.multipart);
      this.setProgress(18);
      this.render();
      await this.performUpload(file, intent, function(loaded, total) {
        var ratio = total > 0 ? loaded / total : 0;
        this.setProgress(18 + ratio * 52);
        this.setProgressText(loaded, total);
      }.bind(this), { fingerprint: fingerprint, session: session, resume: resume });
      if (currentToken !== this.token) return;
      try { await probePromise; } catch (_) {}
      this.setProgressText(0, 0);
      this.setStage('measure');

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
            fileSize: file.size
          }]
        })
      });
      var complete = await completeResponse.json().catch(function() { return {}; });
      if (!completeResponse.ok) throw new Error(complete.error || 'Failed to finalize upload.');
      if (currentToken !== this.token) return;

      this.setProgress(86);
      await this.pollStatus(currentToken);
      if (currentToken !== this.token) return;
      this.rememberCurrentUpload();
      this.render();
    } catch (error) {
      if (currentToken !== this.token) return;
      this.state.status = 'error';
      this.state.abort = null;
      this.setProgress(0);
      this.setProgressText(0, 0);
      this.setStage(null);
      var msg = error && error.message ? error.message : 'Upload failed.';
      if (/file too large/i.test(msg)) msg = 'File too large for this storage tier. Try a smaller file or compress.';
      else if (/unsupported file type/i.test(msg)) msg = 'Unsupported file type. PNG, JPG, WEBP, TIFF, PSD, PDF, AI, EPS and SVG are accepted.';
      else if (/network/i.test(msg)) msg = 'Network issue while uploading. Check your connection and try again.';
      this.setError(msg);
      this.render();
    }
  };

  MainProductUpload.prototype.pollStatus = async function(currentToken) {
    for (var attempt = 0; attempt < 60; attempt += 1) {
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
            throw new Error((item.errors && item.errors[0]) || (data.errors && data.errors[0]) || 'Upload could not be measured.');
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
    var linear = this.isLinearInchPricing();
    var response = await fetch(this.apiBase + '/api/upload/resolve-product', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shopDomain: this.shopDomain,
        productId: String(this.productId),
        uploadId: this.state.uploadId,
        quantity: this.getRequestedCopies(),
        selectedVariantId: linear ? null : (this.getFallbackVariantId() || null),
        customerId: this.customerId || null,
        customerEmail: this.customerEmail || null,
        customerName: this.customerName || null,
        measurementPolicy: POLICY,
        rollWidthIn: this.rollWidthIn,
        maxUploadWidth: this.rollWidthIn
      })
    });
    var data = await response.json().catch(function() { return {}; });
    if (data && data.upload) this.applyMeasurement(data.upload);
    if (!response.ok) {
      if (this.isExactMeasuredMode() && data && data.upload && this.hasMeasuredUpload(this.state)) {
        this.setExactMeasuredResult();
        return;
      }
      throw new Error(data.error || 'No product variant can fit this upload.');
    }
    if (this.isExactMeasuredMode() && this.hasMeasuredUpload(this.state)) {
      this.setExactMeasuredResult();
      return;
    }
    this.state.selectedResult = data.resolution || null;
    this.state.selectedVariantId = this.state.selectedResult ? String(this.state.selectedResult.selectedVariantId || '') : '';
    if (!this.state.selectedVariantId && !this.isExactMeasuredMode()) throw new Error('No product variant can fit this upload.');
  };

  // ── Verified cart mutations ─────────────────────────────────────────────
  // Line properties are built by the server (/api/cart/prepare): two visible
  // links (Design File, Design Identity) plus a transitional hidden id. The
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

  MainProductUpload.prototype.prepareCartProperties = async function(uploadIds) {
    try {
      var response = await fetch(this.apiBase + '/api/cart/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopDomain: this.shopDomain, uploadIds: uploadIds })
      });
      if (!response.ok) throw new Error('prepare failed: ' + response.status);
      var data = await response.json();
      if (!data || !data.success || !Array.isArray(data.items)) throw new Error('prepare payload invalid');
      var map = {};
      data.items.forEach(function(entry) {
        if (entry && entry.found && entry.properties) map[entry.uploadId] = entry.properties;
      });
      return map;
    } catch (error) {
      console.warn('[UMP] cart/prepare unavailable, using client-side fallback properties:', error);
      return null;
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
    var properties = {
      '_ul_identity': identityUrl,
      '_ul_upload_id': item.uploadId
    };
    properties['_ul_design_file'] = item.originalUrl || identityUrl;
    properties['_Print Ready File'] = item.originalUrl || identityUrl;
    // Customer-visible line (themes render non-underscore properties).
    properties['Uploaded File'] = item.originalUrl || identityUrl;
    return properties;
  };

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
    var identity = String(props['_ul_identity'] || props['Design Identity'] || '');
    return identity.indexOf('/i/' + uploadId) !== -1;
  }

  function countCartQuantityForUpload(cart, variantId, uploadId) {
    var items = (cart && cart.items) || [];
    return items.reduce(function(total, line) {
      var lineVariant = Number(line.variant_id || line.id);
      if (lineVariant !== variantId) return total;
      if (!cartLineMatchesUpload(line, uploadId)) return total;
      return total + (Number(line.quantity) || 0);
    }, 0);
  }

  MainProductUpload.prototype.ensureCartLine = async function(cartItem, uploadId) {
    var attempts = 0;
    var maxAttempts = 3;
    while (true) {
      attempts += 1;
      try {
        var cart = await this.readCart();
        var current = countCartQuantityForUpload(cart, cartItem.id, uploadId);
        if (current >= cartItem.quantity) return cart;
        var response = await fetch('/cart/add.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({
            items: [{
              id: cartItem.id,
              quantity: cartItem.quantity - current,
              properties: cartItem.properties
            }]
          })
        });
        if (!response.ok) {
          var payload = await response.json().catch(function() { return {}; });
          var error = new Error(payload.description || payload.message || ('Cart add failed with status ' + response.status));
          error.status = response.status;
          throw error;
        }
        var after = await this.readCart();
        if (countCartQuantityForUpload(after, cartItem.id, uploadId) >= cartItem.quantity) return after;
        throw new Error('Cart line not visible after add.');
      } catch (error) {
        var status = Number(error && error.status);
        var terminal = status >= 400 && status < 500 && status !== 408 && status !== 429;
        if (terminal || attempts >= maxAttempts) throw error;
        await new Promise(function(resolve) { setTimeout(resolve, 400 * Math.pow(2, attempts - 1)); });
      }
    }
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
    this.addButton.disabled = true;
    if (this.checkoutButton) this.checkoutButton.disabled = true;

    try {
      var self = this;
      var uploadIds = readyItems.map(function(item) { return item.uploadId; });
      var serverProperties = await this.prepareCartProperties(uploadIds);

      var cartItems = readyItems.map(function(item) {
        var result = item.selectedResult || {};
        var variantId = parseInt(item.selectedVariantId, 10);
        if (!(variantId > 0)) throw new Error('A measured gang sheet has no matching variant.');
        var quantity = Math.max(1, Number(result.cartQuantity || result.sheetsNeeded) || 1);
        var properties = (serverProperties && serverProperties[item.uploadId]) ||
          self.fallbackCartProperties(item);
        var pageVariant = (self.variants || []).find(function(v) {
          return Number(v && v.id) === variantId;
        });
        return {
          id: variantId,
          quantity: quantity,
          properties: properties,
          uploadId: item.uploadId,
          variantTitle: String(result.selectedVariantTitle || (pageVariant && pageVariant.title) || '')
        };
      });

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

      var lastCart = null;
      for (var i = 0; i < cartItems.length; i++) {
        lastCart = await this.ensureCartLine(cartItems[i], cartItems[i].uploadId);
      }

      await this.bindCartToken(lastCart, uploadIds);

      window.location.href = discountRedirect(redirectTo || '/cart', this.getDiscountCode());
    } catch (error) {
      this.setError(error && error.message ? error.message : 'Failed to add to cart.');
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
