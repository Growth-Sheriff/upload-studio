(function() {
  var ROOT_SELECTOR = '[data-ul-main-product-upload-pro]';
  var POLICY = 'main_product_roll_width';

  function toNumber(value) {
    var parsed = Number(value);
    return isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function formatInches(value) {
    var n = toNumber(value);
    if (!n) return '--';
    return Math.abs(n - Math.round(n)) < 0.01 ? String(Math.round(n)) + '"' : n.toFixed(2) + '"';
  }

  function formatMoney(value, currency) {
    var n = Number(value);
    if (!isFinite(n)) return '--';
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: currency || 'USD'
      }).format(n);
    } catch (_) {
      return '$' + n.toFixed(2);
    }
  }

  function getText(value, fallback) {
    var out = String(value == null ? '' : value).trim();
    return out || fallback || '';
  }

  function buildQuery(params) {
    var parts = [];
    Object.keys(params).forEach(function(key) {
      if (params[key] == null || params[key] === '') return;
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(params[key])));
    });
    return parts.length ? '?' + parts.join('&') : '';
  }

  function getTierUnitPrice(tier) {
    if (!tier) return 0;
    var value = tier.price_per_inch != null ? tier.price_per_inch : tier.price_per_sqin;
    var parsed = Number(value);
    return isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function normalizeVariantPrice(raw) {
    if (raw == null || raw === '') return 0;
    var numeric = Number(raw);
    if (!isFinite(numeric)) return 0;
    return numeric > 100 ? numeric / 100 : numeric;
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

  function escapeAttr(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function ensureMarkup(root) {
    if (!root || root.getAttribute('data-umpp-markup') === 'ready') return;
    var accept = escapeAttr(root.getAttribute('data-accepted-files') || '.png,.jpg,.jpeg,.webp,.tif,.tiff,.psd,.pdf,.ai,.eps,.svg');
    var checkoutEnabled = root.getAttribute('data-enable-checkout') === 'true';
    var rollWidth = escapeAttr(root.getAttribute('data-roll-width-in') || '22');
    root.setAttribute('data-umpp-markup', 'ready');
    root.innerHTML = [
      '<div class="ump-pro__shell">',
        '<div class="ump-pro__main">',
          '<div class="ump-pro__hero">',
            '<div><p class="ump__eyebrow">Upload Studio Pro</p><h2 class="ump-pro__title">Upload your print-ready gang sheets</h2></div>',
            '<div class="ump-pro__trust" data-umpp-account-card><span data-umpp-account-status>Checking account pricing</span><strong data-umpp-account-rate>Standard sheet pricing</strong></div>',
          '</div>',
          '<div class="ump-pro__rail" aria-label="Upload workflow">',
            '<div class="ump-pro__rail-step is-active" data-umpp-step-upload><span>01</span><strong>Upload</strong><small data-umpp-step-upload-copy>Waiting for artwork</small></div>',
            '<div class="ump-pro__rail-step" data-umpp-step-measure><span>02</span><strong>Measure</strong><small data-umpp-step-measure-copy>Server-confirmed size</small></div>',
            '<div class="ump-pro__rail-step" data-umpp-step-checkout><span>03</span><strong>Checkout</strong><small data-umpp-step-checkout-copy>Locked until ready</small></div>',
          '</div>',
          '<div class="ump-pro__multi-note" role="note"><span>Multi-sheet ready</span><strong>Upload several gang sheets in one order.</strong><small>Each file is measured separately, queued, and added to the same cart when every sheet is print-ready.</small></div>',
          '<div class="ump__workspace">',
            '<div class="ump__drop" data-ump-dropzone>',
              '<input class="ump__input" data-ump-input type="file" accept="' + accept + '" multiple>',
              '<div class="ump__drop-grid" aria-hidden="true"></div>',
              '<div class="ump__drop-main">',
                '<div class="ump__icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"></path><path d="m7 8 5-5 5 5"></path><path d="M5 15v4h14v-4"></path></svg></div>',
                '<div><p class="ump__eyebrow">Measured upload</p><h3 class="ump-pro__drop-title">Drop one or more gang sheets</h3><p class="ump__copy">We upload, measure, pick the right sheet, and keep checkout locked until every file is print-ready.</p></div>',
                '<button class="ump__upload-btn" type="button" data-ump-upload-trigger><span>Choose files</span></button>',
                '<div class="ump-pro__format-row" aria-label="Supported file formats"><span>PNG</span><span>PDF</span><span>PSD</span><span>AI</span><span>EPS</span><span>TIFF</span></div>',
                '<p class="ump__hint">PNG, JPG, TIFF, PSD, PDF, AI, EPS and SVG are supported. Multiple gang sheets can be checked out together.</p>',
              '</div>',
            '</div>',
            '<div class="ump__status" data-ump-status-panel hidden>',
              '<div class="ump__file">',
                '<img class="ump__thumb" data-ump-thumb alt="" width="76" height="76" hidden>',
                '<div><p class="ump__file-name" data-ump-file-name>Waiting for file</p><p class="ump__file-meta" data-ump-file-meta>Upload a file to detect the gang sheet size.</p><div class="ump__file-pills" data-ump-file-pills hidden><span class="ump__pill ump__pill--size" data-ump-pill-size></span><span class="ump__pill ump__pill--type" data-ump-pill-type></span><span class="ump__pill ump__pill--multipart" data-ump-pill-multipart hidden>Parallel</span></div></div>',
                '<div class="ump__file-actions"><button class="ump__cancel" type="button" data-ump-cancel hidden>Cancel</button><button class="ump__retry" type="button" data-ump-retry hidden>Try again</button><button class="ump__replace" type="button" data-ump-replace>Replace</button></div>',
              '</div>',
              '<div class="ump__progress" data-ump-progress-wrap hidden><div class="ump__progress-bar" data-ump-progress></div></div>',
              '<div class="ump__progress-text" data-ump-progress-text hidden></div>',
              '<div class="ump__stage" data-ump-stage hidden><span class="ump__stage-dot ump__stage-dot--upload" data-ump-stage-upload></span><span class="ump__stage-label" data-ump-stage-upload-label>Uploading</span><span class="ump__stage-sep">/</span><span class="ump__stage-dot ump__stage-dot--measure" data-ump-stage-measure></span><span class="ump__stage-label" data-ump-stage-measure-label>Measuring</span><span class="ump__stage-sep">/</span><span class="ump__stage-dot ump__stage-dot--ready" data-ump-stage-ready></span><span class="ump__stage-label" data-ump-stage-ready-label>Ready</span></div>',
            '</div>',
            '<div class="ump__queue" data-ump-queue hidden></div>',
          '</div>',
        '</div>',
        '<aside class="ump-pro__side" aria-live="polite">',
          '<div class="ump-pro__quote" data-umpp-quote-card><div><p class="ump__eyebrow" data-umpp-quote-kicker>Checkout summary</p><h3 data-umpp-quote-total>Upload required</h3><p data-umpp-quote-meta>Pricing unlocks after the server confirms every gang sheet.</p></div><div class="ump-pro__quote-grid"><span>Rate <strong data-umpp-rate>--</strong></span><span>Billable <strong data-umpp-billable>--</strong></span><span>Files <strong data-umpp-files>0</strong></span></div></div>',
          '<div class="ump__actions"><button class="ump__cart" type="button" data-ump-add data-default-label="Add to cart" disabled><span>Add to cart</span></button>' +
            (checkoutEnabled ? '<button class="ump__checkout" type="button" data-ump-checkout data-default-label="Checkout" disabled><span>Checkout</span></button>' : '') +
          '</div>',
          '<div class="ump-pro__ticket"><div><p>Roll width</p><strong data-umpp-roll>' + rollWidth + '"</strong></div><div><p>Pricing</p><strong data-umpp-pricing-mode>Standard</strong></div><div><p>Ready</p><strong data-umpp-ready-count>0 files</strong></div></div>',
          '<div class="ump__preview-card ump-pro__preview" data-ump-preview-card>',
            '<div class="ump__preview-head"><div><p class="ump__eyebrow">Detected gang sheet</p><h3 class="ump__size" data-ump-size>-- x --</h3></div><span class="ump__badge" data-ump-badge>Locked</span></div>',
            '<div class="ump-pro__spec-strip"><span>Active sheet <strong data-umpp-active-sheet>Pending</strong></span><span>Queue <strong data-umpp-queue-state>Empty</strong></span></div>',
            '<div class="ump__sheet" data-ump-sheet><div class="ump__ruler ump__ruler--top" data-ump-ruler-top></div><div class="ump__ruler ump__ruler--side" data-ump-ruler-side></div><div class="ump__sheet-plane"><div class="ump__art" data-ump-art><span data-ump-art-label>Upload preview</span></div></div></div>',
            '<div class="ump__metrics"><div><span>Width</span><strong data-ump-width>--</strong></div><div><span>Height</span><strong data-ump-height>--</strong></div><div><span>Sheet</span><strong data-ump-sheet-label>--</strong></div></div>',
            '<div class="ump__quality" data-ump-quality hidden><span class="ump__quality-badge" data-ump-quality-badge></span><span class="ump__quality-text" data-ump-quality-text></span></div>',
            '<p class="ump__method" data-ump-method>Upload required before this product can be added to cart.</p>',
          '</div>',
          '<p class="ump__error" data-ump-error hidden></p>',
        '</aside>',
      '</div>'
    ].join('');
  }

  function ProUpload(root) {
    this.root = root;
    this.apiBase = root.getAttribute('data-api-base') || '/apps/customizer';
    this.shopDomain = root.getAttribute('data-shop-domain') || '';
    this.productId = root.getAttribute('data-product-id') || '';
    this.customerId = root.getAttribute('data-customer-id') || '';
    this.customerEmail = root.getAttribute('data-customer-email') || '';
    this.customerName = root.getAttribute('data-customer-name') || '';
    this.rollWidthIn = toNumber(root.getAttribute('data-roll-width-in')) || 22;
    this.context = {
      status: 'loading',
      customerType: 'standard',
      statusLabel: '',
      pricingMode: 'standard_variant',
      hasCustomPricing: false,
      pricePerInch: 0,
      customerName: this.customerName,
      currency: 'USD'
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
    this.bindDom();
    this.bindEvents();
    this.loadContext();
    this.loadProductConfig();
    this.render();
  }

  ProUpload.prototype.getInstance = function() {
    return this.root.__umpUpload || null;
  };

  ProUpload.prototype.getReadyItems = function() {
    var instance = this.getInstance();
    if (!instance || typeof instance.getReadyItems !== 'function') return [];
    return instance.getReadyItems();
  };

  ProUpload.prototype.bindDom = function() {
    this.accountCard = this.root.querySelector('[data-umpp-account-card]');
    this.accountStatus = this.root.querySelector('[data-umpp-account-status]');
    this.accountRate = this.root.querySelector('[data-umpp-account-rate]');
    this.quoteCard = this.root.querySelector('[data-umpp-quote-card]');
    this.quoteKicker = this.root.querySelector('[data-umpp-quote-kicker]');
    this.quoteTotal = this.root.querySelector('[data-umpp-quote-total]');
    this.quoteMeta = this.root.querySelector('[data-umpp-quote-meta]');
    this.rate = this.root.querySelector('[data-umpp-rate]');
    this.billable = this.root.querySelector('[data-umpp-billable]');
    this.files = this.root.querySelector('[data-umpp-files]');
    this.readyCount = this.root.querySelector('[data-umpp-ready-count]');
    this.pricingMode = this.root.querySelector('[data-umpp-pricing-mode]');
    this.activeSheet = this.root.querySelector('[data-umpp-active-sheet]');
    this.queueState = this.root.querySelector('[data-umpp-queue-state]');
    this.stepUpload = this.root.querySelector('[data-umpp-step-upload]');
    this.stepMeasure = this.root.querySelector('[data-umpp-step-measure]');
    this.stepCheckout = this.root.querySelector('[data-umpp-step-checkout]');
    this.stepUploadCopy = this.root.querySelector('[data-umpp-step-upload-copy]');
    this.stepMeasureCopy = this.root.querySelector('[data-umpp-step-measure-copy]');
    this.stepCheckoutCopy = this.root.querySelector('[data-umpp-step-checkout-copy]');
    this.addButton = this.root.querySelector('[data-ump-add]');
    this.checkoutButton = this.root.querySelector('[data-ump-checkout]');
  };

  ProUpload.prototype.bindEvents = function() {
    var self = this;
    this.root.addEventListener('ump:render', function() {
      self.render();
    });
    if (this.addButton) {
      this.addButton.addEventListener('click', function(event) {
        self.handleCustomPurchase(event);
      }, true);
    }
    if (this.checkoutButton) {
      this.checkoutButton.addEventListener('click', function(event) {
        self.handleCustomPurchase(event);
      }, true);
    }
  };

  ProUpload.prototype.isCustomPricing = function() {
    return Boolean(this.context.hasCustomPricing && this.context.pricingMode !== 'standard_variant');
  };

  ProUpload.prototype.isLinearInchPricing = function() {
    var config = this.productConfig.builderConfig || {};
    if (config.volumeDiscountTierUnit === 'linear_inches') return true;
    if (config.alphaProDiscount && config.alphaProDiscount.unit === 'linear_inches') return true;
    var items = this.getReadyItems();
    return items.some(function(item) {
      return item && item.selectedResult && item.selectedResult.pricingMode === 'linear_inches';
    });
  };

  ProUpload.prototype.getLinearCustomerOffer = function() {
    var config = this.productConfig.builderConfig || {};
    var offer = this.productConfig.customerOffer || config.customerOffer || null;
    return offer && offer.enabled === true ? offer : null;
  };

  ProUpload.prototype.getLinearTiers = function() {
    var offer = this.getLinearCustomerOffer();
    if (offer && Array.isArray(offer.tiers) && offer.tiers.length) return offer.tiers;
    var config = this.productConfig.builderConfig || {};
    return Array.isArray(config.volumeDiscountTiers) ? config.volumeDiscountTiers : [];
  };

  ProUpload.prototype.getActiveLinearTier = function(billable) {
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

  ProUpload.prototype.getFallbackVariantUnitPrice = function() {
    var instance = this.getInstance();
    var variantId = instance && typeof instance.getFallbackVariantId === 'function'
      ? instance.getFallbackVariantId()
      : '';
    var variants = instance && Array.isArray(instance.variants) ? instance.variants : [];
    var variant = variants.find(function(item) {
      return String(item.id || '') === String(variantId || '');
    }) || variants[0] || null;
    return normalizeVariantPrice(variant && variant.price);
  };

  ProUpload.prototype.getLinearUnitPrice = function(billable, sampleItem) {
    var offer = this.getLinearCustomerOffer();
    if (offer) {
      var tierPrice = getTierUnitPrice(this.getActiveLinearTier(billable));
      if (tierPrice > 0) return tierPrice;
    }
    var result = sampleItem && sampleItem.selectedResult ? sampleItem.selectedResult : {};
    return toNumber(result.unitPrice || result.pricePerInch) || this.getFallbackVariantUnitPrice();
  };

  ProUpload.prototype.getLinearSummary = function(items) {
    var billable = 0;
    var cartQuantity = 0;
    for (var i = 0; i < items.length; i += 1) {
      var item = items[i] || {};
      var result = item.selectedResult || {};
      var length = toNumber(result.billableLengthIn) || Math.max(toNumber(item.widthIn), toNumber(item.heightIn));
      billable += length;
      cartQuantity += Math.max(1, Number(result.cartQuantity || result.sheetsNeeded) || Math.ceil(length || 1));
    }
    billable = Number(billable.toFixed(2));
    var unitPrice = this.getLinearUnitPrice(billable, items[0] || null);
    return {
      billable: billable,
      cartQuantity: cartQuantity,
      unitPrice: unitPrice,
      total: Number((cartQuantity * unitPrice).toFixed(2))
    };
  };

  ProUpload.prototype.setBaseError = function(message) {
    var instance = this.getInstance();
    if (instance && typeof instance.setError === 'function') {
      instance.setError(message || '');
      return;
    }
    var error = this.root.querySelector('[data-ump-error]');
    if (!error) return;
    error.hidden = !message;
    error.textContent = message || '';
  };

  ProUpload.prototype.loadContext = async function() {
    if (!this.shopDomain || !this.productId) {
      this.context.status = 'ready';
      this.render();
      return;
    }

    try {
      var url = this.apiBase + '/api/vip/context' + buildQuery({
        shop: this.shopDomain,
        shopDomain: this.shopDomain,
        productId: this.productId,
        customerId: this.customerId,
        customerEmail: this.customerEmail
      });
      var response = await fetch(url, { credentials: 'same-origin' });
      var data = await response.json().catch(function() { return {}; });
      if (!response.ok) throw new Error(data.error || 'Failed to load customer pricing.');

      this.context.status = 'ready';
      this.context.customerType = getText(data.customerType, 'standard').toLowerCase();
      if (['business', 'vip'].indexOf(this.context.customerType) === -1) {
        this.context.customerType = 'standard';
      }
      this.context.statusLabel = getText(data.statusLabel, '');
      this.context.pricingMode = getText(data.pricingMode, 'standard_variant').toLowerCase();
      this.context.hasCustomPricing = Boolean(
        data.hasCustomPricing === true ||
        (this.context.pricingMode !== 'standard_variant' && ['business', 'vip'].indexOf(this.context.customerType) >= 0)
      );
      this.context.pricePerInch = toNumber(data.pricePerInch);
      this.context.customerName = getText(data.customerName || (data.assignment && data.assignment.customerName), this.customerName);
      this.context.currency = getText(data.currency, 'USD');
    } catch (error) {
      this.context.status = 'ready';
      this.context.customerType = 'standard';
      this.context.statusLabel = '';
      this.context.pricingMode = 'standard_variant';
      this.context.hasCustomPricing = false;
      this.context.pricePerInch = 0;
      this.context.customerName = this.customerName;
    }

    this.render();
  };

  ProUpload.prototype.loadProductConfig = async function() {
    if (!this.shopDomain || !this.productId) {
      this.productConfig.status = 'ready';
      this.render();
      return;
    }

    try {
      var url = this.apiBase + '/api/product-config/' + encodeURIComponent(this.productId) + buildQuery({
        shop: this.shopDomain,
        customerId: this.customerId,
        customerEmail: this.customerEmail,
        customerName: this.customerName
      });
      var response = await fetch(url, { credentials: 'same-origin' });
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

    this.render();
  };

  ProUpload.prototype.buildCustomItems = function(items) {
    return items.map(function(item) {
      return {
        uploadId: item.uploadId,
        quantity: 1,
        selectedVariantId: item.selectedVariantId || null,
        measurementPolicy: POLICY,
        rollWidthIn: this.rollWidthIn
      };
    }.bind(this));
  };

  ProUpload.prototype.requestQuoteIfNeeded = function(items) {
    if (!this.isCustomPricing()) return;
    if (!items.length) {
      this.quote.key = '';
      this.quote.status = 'idle';
      this.quote.data = null;
      this.quote.error = '';
      return;
    }
    var key = readyKey(items);
    if (key === this.quote.key && (this.quote.status === 'ready' || this.quote.status === 'loading')) return;
    this.requestQuote(items, key);
  };

  ProUpload.prototype.requestQuote = async function(items, key) {
    var token = ++this.quote.token;
    this.quote.key = key;
    this.quote.status = 'loading';
    this.quote.error = '';
    this.renderQuote(items);

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
      if (!response.ok) throw new Error(data.error || 'Failed to calculate custom quote.');
      this.quote.status = 'ready';
      this.quote.data = data;
      this.quote.error = '';
    } catch (error) {
      if (token !== this.quote.token) return;
      this.quote.status = 'error';
      this.quote.data = null;
      this.quote.error = error && error.message ? error.message : 'Failed to calculate custom quote.';
    }

    this.render();
  };

  ProUpload.prototype.handleCustomPurchase = async function(event) {
    if (!this.isCustomPricing()) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    var readyItems = this.getReadyItems();
    if (!readyItems.length) {
      this.setBaseError('Please upload your gang sheet first.');
      return;
    }
    if (this.quote.status !== 'ready' || !this.quote.data) {
      this.setBaseError('Please wait until the custom quote is ready.');
      this.requestQuoteIfNeeded(readyItems);
      return;
    }

    this.setBaseError('');
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
          measurementPolicy: POLICY,
          rollWidthIn: this.rollWidthIn,
          items: this.buildCustomItems(readyItems)
        })
      });
      var data = await response.json().catch(function() { return {}; });
      if (!response.ok) throw new Error(data.error || 'Failed to create custom checkout.');
      var redirect = data.checkoutUrl || data.redirectUrl || data.url || data.invoiceUrl;
      if (!redirect) throw new Error('Custom checkout URL was not returned.');
      window.location.href = redirect;
    } catch (error) {
      this.setBaseError(error && error.message ? error.message : 'Failed to create custom checkout.');
      this.render();
    }
  };

  ProUpload.prototype.renderAccount = function() {
    var custom = this.isCustomPricing();
    var linear = this.isLinearInchPricing();
    var offer = this.getLinearCustomerOffer();
    var anonymous = !this.customerId && !this.customerEmail;
    this.root.classList.toggle('is-custom-pricing', custom || Boolean(offer));
    this.root.classList.toggle('is-linear-inch-pricing', linear);
    if (this.accountCard) this.accountCard.classList.toggle('is-custom', custom || Boolean(offer));
    if (this.accountStatus) {
      if (this.context.status === 'loading' || this.productConfig.status === 'loading') {
        this.accountStatus.textContent = 'Checking account pricing';
      } else if (linear && offer) {
        var offerName = getText(offer.customerName || this.context.customerName, this.customerName || 'valued customer');
        this.accountStatus.textContent = 'Dear valued customer ' + offerName + ', your returning-customer inch pricing is active';
      } else if (linear && anonymous) {
        this.accountStatus.textContent = 'Sign in to unlock returning-customer inch pricing';
      } else if (linear) {
        this.accountStatus.textContent = 'Measured inch checkout';
      } else if (custom) {
        var name = getText(this.context.customerName, 'valued customer');
        this.accountStatus.textContent =
          'Dear valued customer ' + name + ', ' +
          (this.context.customerType === 'business' ? 'your business pricing is active' : 'your VIP pricing is active');
      } else {
        this.accountStatus.textContent = 'Standard account pricing';
      }
    }
    if (this.accountRate) {
      if (linear && offer) {
        var sampleTier = this.getActiveLinearTier(1);
        var sampleRate = getTierUnitPrice(sampleTier);
        this.accountRate.textContent = sampleRate
          ? 'Returning rate from ' + formatMoney(sampleRate, this.context.currency) + ' per inch'
          : 'Returning-customer inch tiers are active';
      } else if (linear && anonymous) {
        this.accountRate.textContent = 'You can still upload and checkout at the standard inch rate';
      } else if (linear) {
        this.accountRate.textContent = 'Pay by measured billable inches';
      } else if (custom) {
        var label = this.context.statusLabel ? this.context.statusLabel + ' / ' : '';
        this.accountRate.textContent = label + formatMoney(this.context.pricePerInch, this.context.currency) + ' per inch';
      } else {
        this.accountRate.textContent = 'Variant pricing checkout';
      }
    }
  };

  ProUpload.prototype.renderProductionState = function(items) {
    var instance = this.getInstance();
    var state = instance && instance.state ? instance.state : {};
    var queueItems = instance && typeof instance.getQueueItems === 'function' ? instance.getQueueItems() : items;
    var readyCount = items.length;
    var queueCount = queueItems.length;
    var activeSheet = state.selectedResult
      ? getText(state.selectedResult.selectedSheetLabel || state.selectedResult.selectedVariantTitle, 'Pending')
      : 'Pending';
    var custom = this.isCustomPricing();
    var linear = this.isLinearInchPricing();
    var quoteReady = !custom || (this.quote.status === 'ready' && this.quote.data);
    var uploading = state.status === 'uploading';
    var measured = readyCount > 0;

    if (this.readyCount) this.readyCount.textContent = readyCount + ' file' + (readyCount === 1 ? '' : 's');
    if (this.pricingMode) {
      this.pricingMode.textContent = linear
        ? 'By inch'
        : custom
        ? (this.context.customerType === 'business' ? 'Business' : 'VIP')
        : 'Standard';
    }
    if (this.activeSheet) this.activeSheet.textContent = activeSheet;
    if (this.queueState) {
      this.queueState.textContent = queueCount
        ? readyCount + '/' + queueCount + ' ready'
        : 'Empty';
    }

    this.setStepState(this.stepUpload, uploading, measured);
    this.setStepState(this.stepMeasure, !uploading && Boolean(state.uploadId) && !measured, measured);
    this.setStepState(this.stepCheckout, measured && !quoteReady, measured && quoteReady);

    if (this.stepUploadCopy) {
      this.stepUploadCopy.textContent = uploading ? 'Transfer in progress' : (queueCount ? queueCount + ' file' + (queueCount === 1 ? '' : 's') + ' queued' : 'Waiting for artwork');
    }
    if (this.stepMeasureCopy) {
      this.stepMeasureCopy.textContent = measured ? readyCount + ' server-confirmed' : 'Server-confirmed size';
    }
    if (this.stepCheckoutCopy) {
      if (!measured) this.stepCheckoutCopy.textContent = 'Locked until ready';
      else if (custom && this.quote.status !== 'ready') this.stepCheckoutCopy.textContent = 'Custom quote pending';
      else this.stepCheckoutCopy.textContent = 'Ready for payment';
    }
  };

  ProUpload.prototype.setStepState = function(node, active, done) {
    if (!node) return;
    node.classList.toggle('is-active', Boolean(active));
    node.classList.toggle('is-done', Boolean(done));
  };

  ProUpload.prototype.renderQuote = function(items) {
    var custom = this.isCustomPricing();
    var linear = this.isLinearInchPricing();
    var readyCount = items.length;
    if (this.files) this.files.textContent = String(readyCount);
    if (this.rate) {
      var linearSummaryForRate = linear ? this.getLinearSummary(items) : null;
      this.rate.textContent = linear && linearSummaryForRate && linearSummaryForRate.unitPrice
        ? formatMoney(linearSummaryForRate.unitPrice, this.context.currency) + '/in'
        : custom && this.context.pricePerInch
        ? formatMoney(this.context.pricePerInch, this.context.currency) + '/in'
        : '--';
    }

    if (this.quoteCard) {
      this.quoteCard.classList.toggle('is-custom', custom || linear);
      this.quoteCard.classList.toggle('is-loading', this.quote.status === 'loading');
    }

    if (linear) {
      if (!readyCount) {
        if (this.quoteKicker) this.quoteKicker.textContent = 'Measured inch checkout';
        if (this.quoteTotal) this.quoteTotal.textContent = 'Upload required';
        if (this.quoteMeta) this.quoteMeta.textContent = 'We charge by the measured gang-sheet length after upload.';
        if (this.billable) this.billable.textContent = '--';
        return;
      }

      var linearSummary = this.getLinearSummary(items);
      var offer = this.getLinearCustomerOffer();
      if (this.quoteKicker) this.quoteKicker.textContent = offer ? 'Returning customer rate' : 'Measured inch checkout';
      if (this.quoteTotal) {
        this.quoteTotal.textContent = linearSummary.unitPrice
          ? formatMoney(linearSummary.total, this.context.currency)
          : linearSummary.cartQuantity + ' billable inches';
      }
      if (this.quoteMeta) {
        this.quoteMeta.textContent =
          linearSummary.cartQuantity + ' inch unit' + (linearSummary.cartQuantity === 1 ? '' : 's') +
          ' / ' + readyCount + ' ready file' + (readyCount === 1 ? '' : 's');
      }
      if (this.billable) this.billable.textContent = linearSummary.billable ? formatInches(linearSummary.billable) : '--';
      return;
    }

    if (!custom) {
      if (this.quoteKicker) this.quoteKicker.textContent = 'Checkout summary';
      if (this.quoteTotal) this.quoteTotal.textContent = readyCount ? readyCount + ' ready file' + (readyCount === 1 ? '' : 's') : 'Upload required';
      if (this.quoteMeta) this.quoteMeta.textContent = readyCount ? 'Standard customers use the selected Shopify sheet variants.' : 'Pricing unlocks after the server confirms every gang sheet.';
      if (this.billable) this.billable.textContent = '--';
      return;
    }

    if (!readyCount) {
      if (this.quoteKicker) this.quoteKicker.textContent = this.context.customerType === 'business' ? 'Business quote' : 'VIP quote';
      if (this.quoteTotal) this.quoteTotal.textContent = 'Upload required';
      if (this.quoteMeta) this.quoteMeta.textContent = 'Your custom rate will be applied after measurement.';
      if (this.billable) this.billable.textContent = '--';
      return;
    }

    if (this.quote.status === 'loading') {
      if (this.quoteTotal) this.quoteTotal.textContent = 'Calculating';
      if (this.quoteMeta) this.quoteMeta.textContent = 'The server is building a measured quote for ' + readyCount + ' ready file' + (readyCount === 1 ? '' : 's') + '.';
      if (this.billable) this.billable.textContent = '--';
      return;
    }

    if (this.quote.status === 'error') {
      if (this.quoteTotal) this.quoteTotal.textContent = 'Quote unavailable';
      if (this.quoteMeta) this.quoteMeta.textContent = this.quote.error || 'Custom quote failed.';
      if (this.billable) this.billable.textContent = '--';
      return;
    }

    var data = this.quote.data || {};
    var billable = toNumber(data.billableLengthIn || (data.quote && data.quote.billableLengthIn));
    var total = data.quoteTotal != null ? data.quoteTotal : data.totalPrice;
    if (this.quoteKicker) this.quoteKicker.textContent = this.context.customerType === 'business' ? 'Business quote ready' : 'VIP quote ready';
    if (this.quoteTotal) this.quoteTotal.textContent = formatMoney(total, data.currency || this.context.currency);
    if (this.quoteMeta) {
      var sheet = getText(data.selectedSheetLabel || data.selectedVariantTitle, 'Measured custom checkout');
      this.quoteMeta.textContent = sheet + ' / ' + readyCount + ' ready file' + (readyCount === 1 ? '' : 's');
    }
    if (this.billable) this.billable.textContent = billable ? formatInches(billable) : '--';
  };

  ProUpload.prototype.renderButtons = function(items) {
    if (!this.isCustomPricing()) return;
    var ready = items.length > 0 && this.quote.status === 'ready' && this.quote.data;
    var label = ready
      ? 'Create custom checkout'
      : (items.length ? 'Preparing custom quote' : 'Upload required');
    if (this.addButton) {
      this.addButton.disabled = !ready;
      this.addButton.textContent = label;
    }
    if (this.checkoutButton) {
      this.checkoutButton.disabled = !ready;
      this.checkoutButton.textContent = ready ? 'Checkout with custom pricing' : label;
    }
  };

  ProUpload.prototype.render = function() {
    var items = this.getReadyItems();
    this.requestQuoteIfNeeded(items);
    this.renderAccount();
    this.renderQuote(items);
    this.renderProductionState(items);
    this.renderButtons(items);
  };

  function init() {
    var roots = document.querySelectorAll(ROOT_SELECTOR);
    roots.forEach(function(root) {
      ensureMarkup(root);
      if (root.dataset.umppInitialized === 'true') return;
      root.dataset.umppInitialized = 'true';
      new ProUpload(root);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  document.addEventListener('shopify:section:load', init);
})();
