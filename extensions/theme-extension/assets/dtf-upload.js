/**
 * DTF Transfer By Size — Upload + Modal + Price Calculator
 * =========================================================
 * Adapted from nosendgithubfortaslakexcentions taslak.
 * Upload pipeline: api.upload.intent → signed URL → api.upload.complete → poll status
 *
 * Version: 1.0.0
 */
(function() {
  if (window.DtfUploadBlockInitialized) return;
  window.DtfUploadBlockInitialized = true;

  /* ─────────────────────────────────────────────
     FitCheck Mockup SVG Data (from taslak)
     ───────────────────────────────────────────── */
  var FITCHECK_MOCKUPS = [
    {
      id: 'tshirt', name: 'T-Shirt', placement: 'Full Front',
      imgFile: 'mockup-tshirt.png',
      printArea: { top: 28, left: 48, width: 30, maxInches: 12 }
    },
    {
      id: 'hat', name: 'Hat', placement: 'Front Panel',
      imgFile: 'mockup-hat.png',
      printArea: { top: 30, left: 50, width: 34, maxInches: 5 }
    },
    {
      id: 'polo', name: 'Polo', placement: 'Left Chest',
      imgFile: 'mockup-polo.png',
      printArea: { top: 32, left: 55, width: 18, maxInches: 4 }
    },
    {
      id: 'tote', name: 'Tote Bag', placement: 'Center',
      imgFile: 'mockup-totebag.png',
      printArea: { top: 42, left: 50, width: 44, maxInches: 10 }
    },
    {
      id: 'hoodie', name: 'Hoodie', placement: 'Full Front',
      imgFile: 'mockup-hoodie.png',
      printArea: { top: 34, left: 50, width: 32, maxInches: 12 }
    },
    {
      id: 'apron', name: 'Apron', placement: 'Center',
      imgFile: 'mockup-apron.png',
      printArea: { top: 32, left: 50, width: 38, maxInches: 10 }
    }
  ];

  var MOCKUP_COLORS = [
    '#ffffff', '#111827', '#6b7280', '#ef4444', '#f97316',
    '#eab308', '#22c55e', '#a7f3d0', '#3b82f6', '#a855f7'
  ];

  var MIN_MARGIN_IN = 0.125;

  function safeJsonParse(value, fallback) {
    try {
      var parsed = JSON.parse(value);
      return parsed == null ? fallback : parsed;
    } catch (e) {
      return fallback;
    }
  }

  function normalizeMarginIn(value) {
    var parsed = parseFloat(value);
    if (isNaN(parsed) || parsed < MIN_MARGIN_IN) return MIN_MARGIN_IN;
    return parsed;
  }

  function normalizeOptionName(value) {
    return String(value || '').trim().toLowerCase();
  }

  function parseMeasurementValue(value) {
    if (value == null || value === '') return null;
    var cleaned = String(value)
      .replace(/["""''′″]/g, '')
      .replace(/\binch(es)?\b/gi, '')
      .replace(/\bin\b/gi, '')
      .trim();
    var match = cleaned.match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    var parsed = parseFloat(match[0]);
    return isNaN(parsed) ? null : parsed;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeVariantPriceToDollars(rawPrice) {
    if (rawPrice == null || rawPrice === '') return 0;
    if (typeof rawPrice === 'string') {
      if (rawPrice.indexOf('.') !== -1) return parseFloat(rawPrice) || 0;
      var intPrice = parseInt(rawPrice, 10);
      return isNaN(intPrice) ? 0 : intPrice / 100;
    }
    var num = Number(rawPrice);
    if (!isFinite(num)) return 0;
    return num / 100;
  }

  function normalizeCustomerField(value) {
    if (value == null) return '';
    var normalized = String(value).trim();
    if (!normalized || normalized === 'null' || normalized === 'undefined') return '';
    return normalized;
  }

  function parsePositiveNumber(value) {
    var parsed = Number(value);
    return isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  function formatMoneyValue(value, currency) {
    var amount = Number(value);
    if (!isFinite(amount)) amount = 0;
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency || 'USD'
      }).format(amount);
    } catch (error) {
      return '$' + amount.toFixed(2);
    }
  }

  /* ─────────────────────────────────────────────
     DtfUploadBlock Class
     ───────────────────────────────────────────── */
  function DtfUploadBlock(config) {
    this.config = config || {};
    this.config.pricingMode = this.config.pricingMode === 'sheet' ? 'sheet' : 'area';
    this.config.sheetOptionName = this.config.sheetOptionName || null;
    this.config.widthOptionName = this.config.widthOptionName || null;
    this.config.heightOptionName = this.config.heightOptionName || null;
    this.config.modalOptionNames = Array.isArray(this.config.modalOptionNames) ? this.config.modalOptionNames : [];
    this.config.artboardMarginIn = normalizeMarginIn(this.config.artboardMarginIn);
    this.config.imageMarginIn = normalizeMarginIn(this.config.imageMarginIn);
    this.config.productVariants = Array.isArray(this.config.productVariants) ? this.config.productVariants : [];
    this.config.productOptions = Array.isArray(this.config.productOptions) ? this.config.productOptions : [];
    this.state = 'IDLE';
    this.files = [];
    this.activeFileIndex = -1;
    this.currentTab = 'canvas';
    this.mockupColor = '#ffffff';
    this.selectedServiceOptions = {};
    this._cachedOptions = null;
    this._configFetchPromise = null;
    this._configLoaded = false;
    this._customerContextRequestToken = 0;
    this._boundCustomerLoginMessageHandler = null;
    this.loginPopup = null;
    this.loginPollTimer = null;
    this.customer = {
      id: '',
      email: '',
      loggedIn: false,
      customerType: 'guest',
      statusLabel: 'Guest',
      pricePerInch: null,
      currency: this.config.currency || 'USD',
      contextStatus: 'idle'
    };

    // Derive asset base URL from this script's src (same CDN folder)
    var scripts = document.querySelectorAll('script[src*="dtf-upload"]');
    var scriptSrc = scripts.length ? scripts[scripts.length - 1].src : '';
    this.mockupAssetBase = scriptSrc.replace(/dtf-upload\.js.*$/, '');

    this.initDOM();
    this.bindEvents();
    this.syncCustomerIdentity();
    this.updateCustomerStatusUI();
    this.loadCustomerPricingContext();
  }

  DtfUploadBlock.prototype.initDOM = function() {
    this.root = document.getElementById('dtf-upload-root');
    this.dropzone = document.getElementById('dtf-trigger-zone');
    this.triggerBtn = this.root.querySelector('.dtf-upload-trigger');
    this.modal = document.getElementById('dtf-modal');
    this.modalBody = document.getElementById('dtf-modal-body');
    this.ensureCustomerUiScaffolding();
    this.closeBtn = this.modal.querySelector('.dtf-modal__close');
    this.uploadsBtn = this.modal.querySelector('.dtf-modal__uploads-btn');
    this.addToCartBtn = this.modal.querySelector('.dtf-modal__add-to-cart');
    this.customerStatusTitle = this.root.querySelector('.dtf-customer-status__title');
    this.customerStatusText = this.root.querySelector('.dtf-customer-status__text');
    this.customerLoginBtn = this.root.querySelector('.dtf-customer-status__login');
    this.customerAccountLink = this.root.querySelector('.dtf-customer-status__account');
    this.modalCustomerBadge = this.modal.querySelector('.dtf-modal__customer-badge');
    this.modalCustomerTitle = this.modal.querySelector('.dtf-modal__customer-title');
    this.modalCustomerText = this.modal.querySelector('.dtf-modal__customer-text');
    this.modalCustomerLoginBtn = this.modal.querySelector('.dtf-modal__customer-login');
    this.modalCustomerAccountLink = this.modal.querySelector('.dtf-modal__customer-account');

    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    try {
      var formats = JSON.parse(this.config.formats || '[]');
      this.fileInput.accept = formats.map(function(f) { return '.' + f.toLowerCase(); }).join(',');
    } catch(e) {
      this.fileInput.accept = '.png,.jpg,.jpeg,.svg,.pdf,.ai,.psd,.eps';
    }
    this.fileInput.style.display = 'none';
    document.body.appendChild(this.fileInput);
  };

  DtfUploadBlock.prototype.ensureCustomerUiScaffolding = function() {
    if (!this.modal) return;

    var header = this.modal.querySelector('.dtf-modal__header');
    if (!header || header.querySelector('.dtf-modal__customer')) return;

    var uploadsBtn = header.querySelector('.dtf-modal__uploads-btn');
    var closeBtn = header.querySelector('.dtf-modal__close');
    var headerMain = document.createElement('div');
    var customerWrap = document.createElement('div');

    headerMain.className = 'dtf-modal__header-main';
    customerWrap.className = 'dtf-modal__customer';
    customerWrap.setAttribute('aria-live', 'polite');
    customerWrap.innerHTML =
      '<span class="dtf-modal__customer-badge">Guest</span>' +
      '<div class="dtf-modal__customer-copy">' +
        '<div class="dtf-modal__customer-title">Guest checkout</div>' +
        '<div class="dtf-modal__customer-text">Log in to load your saved customer pricing before adding to cart.</div>' +
      '</div>' +
      '<button class="dtf-btn dtf-btn--secondary dtf-modal__customer-login" type="button">Log In</button>' +
      '<a class="dtf-btn dtf-btn--ghost dtf-modal__customer-account" href="/account" hidden>My Account</a>';

    if (uploadsBtn) headerMain.appendChild(uploadsBtn);
    headerMain.appendChild(customerWrap);

    if (closeBtn) header.insertBefore(headerMain, closeBtn);
    else header.appendChild(headerMain);
  };

  DtfUploadBlock.prototype.bindEvents = function() {
    var self = this;
    var loginHandler = function(e) {
      e.preventDefault();
      self.openCustomerLoginPopup();
    };

    this.triggerBtn.addEventListener('click', function() {
      if (self.files.length > 0) {
        self.openModal();
        self.renderState();
      } else {
        self.fileInput.click();
      }
    });

    this.dropzone.addEventListener('click', function(e) {
      if (e.target !== self.triggerBtn && !self.triggerBtn.contains(e.target)) {
        if (self.files.length > 0) {
          self.openModal();
          self.renderState();
        } else {
          self.fileInput.click();
        }
      }
    });

    this.dropzone.addEventListener('dragover', function(e) {
      e.preventDefault();
      self.dropzone.classList.add('dtf-dropzone--dragover');
    });
    this.dropzone.addEventListener('dragleave', function() {
      self.dropzone.classList.remove('dtf-dropzone--dragover');
    });
    this.dropzone.addEventListener('drop', function(e) {
      e.preventDefault();
      self.dropzone.classList.remove('dtf-dropzone--dragover');
      if (e.dataTransfer.files.length) {
        self.handleFileSelect(e.dataTransfer.files[0]);
      }
    });

    this.fileInput.addEventListener('change', function(e) {
      if (e.target.files.length) {
        self.handleFileSelect(e.target.files[0]);
        e.target.value = ''; // reset for re-upload
      }
    });

    this.closeBtn.addEventListener('click', function() { self.closeModal(); });
    this.modal.querySelector('.dtf-modal__backdrop').addEventListener('click', function() { self.closeModal(); });

    // ESC to close
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && !self.modal.hidden) {
        self.closeModal();
      }
    });

    this.addToCartBtn.addEventListener('click', function() { self.addToCart(); });

    // Uploads button — open file picker for new upload
    this.uploadsBtn.addEventListener('click', function() { self.fileInput.click(); });

    if (this.customerLoginBtn) {
      this.customerLoginBtn.addEventListener('click', loginHandler);
    }
    if (this.modalCustomerLoginBtn) {
      this.modalCustomerLoginBtn.addEventListener('click', loginHandler);
    }

    this._boundCustomerLoginMessageHandler = function(event) {
      self.handleCustomerLoginMessage(event);
    };
    window.addEventListener('message', this._boundCustomerLoginMessageHandler);
  };

  /* ─────────────────────────────────────────────
     Modal Open / Close
     ───────────────────────────────────────────── */
  DtfUploadBlock.prototype.openModal = function() {
    this.modal.hidden = false;
    document.body.style.overflow = 'hidden';
    this.renderState();
  };

  DtfUploadBlock.prototype.closeModal = function() {
    this.modal.hidden = true;
    document.body.style.overflow = '';
  };

  DtfUploadBlock.prototype.renderState = function() {
    this.updateCustomerStatusUI();
    if (this.state === 'UPLOADING') {
      this.modalBody.innerHTML =
        '<div class="dtf-uploading">' +
          '<div class="dtf-uploading-box">' +
            '<p style="font-size:48px;margin:0 0 16px 0;">⬆️</p>' +
            '<h3 style="margin:0 0 8px 0;">Uploading your file...</h3>' +
            '<p id="dtf-progress-pct" style="margin:0 0 16px 0;color:var(--dtf-color-text-subdued);">0%</p>' +
            '<div class="dtf-progress"><div class="dtf-progress-bar" id="dtf-progress-bar"></div></div>' +
          '</div>' +
        '</div>';
      this.addToCartBtn.disabled = true;
    } else if (this.state === 'EDITOR' && this.files.length > 0) {
      this.renderEditor();
    } else {
      this.modalBody.innerHTML =
        '<div class="dtf-uploading">' +
          '<div class="dtf-uploading-box">' +
            '<p style="font-size:48px;margin:0 0 16px 0;">📁</p>' +
            '<h3 style="margin:0 0 8px 0;">Upload a file to get started</h3>' +
            '<p style="margin:0;color:var(--dtf-color-text-subdued);">Drag & drop or click to upload</p>' +
          '</div>' +
        '</div>';
    }
  };

  DtfUploadBlock.prototype.renderToggle = function(label, key, checked) {
    var id = 'dtf-toggle-' + key;
    return '<div class="dtf-toggle">' +
      '<span class="dtf-toggle__label">' + label + '</span>' +
      '<label class="dtf-toggle__switch">' +
        '<input type="checkbox" id="' + id + '" data-key="' + key + '"' + (checked ? ' checked' : '') + '>' +
        '<span class="dtf-toggle__track"></span>' +
        '<span class="dtf-toggle__thumb"></span>' +
      '</label>' +
    '</div>';
  };

  /* ─────────────────────────────────────────────
     File Handling — REAL upload pipeline
     Uses: api.upload.intent → signed URL PUT → api.upload.complete → poll status
     ───────────────────────────────────────────── */
  DtfUploadBlock.prototype.handleFileSelect = function(file) {
    var self = this;
    this.ensureConfigReady().then(function() {
      // Client-side validations
      if (file.size > self.config.maxFileMb * 1024 * 1024) {
        alert('File exceeds ' + self.config.maxFileMb + 'MB limit.');
        return;
      }

      self.openModal();
      self.state = 'UPLOADING';
      self.renderState();

      // Read preview for client-side display
      self.readFileAsDataURL(file).then(function(previewUrl) {
        // Read dimensions from image
        self.readClientDimensions(file, previewUrl, function(dims) {
          // Start real upload
          self.startRealUpload(file, previewUrl, dims);
        });
      });
    });
  };

  DtfUploadBlock.prototype.readFileAsDataURL = function(file) {
    return new Promise(function(resolve) {
      // Only read as data URL for supported preview formats
      var previewable = /\.(png|jpe?g|webp|svg|gif)$/i.test(file.name);
      if (!previewable) {
        resolve(null);
        return;
      }
      var reader = new FileReader();
      reader.onload = function(e) { resolve(e.target.result); };
      reader.readAsDataURL(file);
    });
  };

  DtfUploadBlock.prototype.readClientDimensions = function(file, previewUrl, callback) {
    if (!previewUrl) {
      callback({ widthPx: 0, heightPx: 0, dpi: 300, widthIn: 0, heightIn: 0 });
      return;
    }
    var img = new Image();
    img.onload = function() {
      var dpi = 300; // assume 300 DPI default, will be corrected by preflight
      var widthIn = parseFloat((img.naturalWidth / dpi).toFixed(2));
      var heightIn = parseFloat((img.naturalHeight / dpi).toFixed(2));
      callback({
        widthPx: img.naturalWidth,
        heightPx: img.naturalHeight,
        dpi: dpi,
        widthIn: widthIn,
        heightIn: heightIn
      });
    };
    img.onerror = function() {
      callback({ widthPx: 0, heightPx: 0, dpi: 300, widthIn: 0, heightIn: 0 });
    };
    img.src = previewUrl;
  };

  DtfUploadBlock.prototype.startRealUpload = function(file, previewUrl, dims) {
    var self = this;
    var apiBase = this.config.apiBase || '/apps/customizer';
    var shopDomain = this.config.shopDomain;

    // Step 1: Get upload intent (signed URL)
    var intentBody = {
      shopDomain: shopDomain,
      productId: String(this.config.productId),
      mode: 'dtf',
      contentType: file.type || 'application/octet-stream',
      fileName: file.name,
      fileSize: file.size
    };

    // Add customer info if available
    this.syncCustomerIdentity();
    if (this.customer.id) intentBody.customerId = String(this.customer.id);
    if (this.customer.email) intentBody.customerEmail = this.customer.email;

    // Add visitor info if available
    if (window.ULVisitor) {
      if (window.ULVisitor.visitorId) intentBody.visitorId = window.ULVisitor.visitorId;
      if (window.ULVisitor.sessionId) intentBody.sessionId = window.ULVisitor.sessionId;
    }

    fetch(apiBase + '/api/upload/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(intentBody)
    })
    .then(function(res) {
      if (!res.ok) throw new Error('Intent failed: ' + res.status);
      return res.json();
    })
    .then(function(intent) {
      // Step 2: PUT file to signed URL with XHR for progress
      self.uploadToSignedUrl(intent, file, previewUrl, dims);
    })
    .catch(function(err) {
      console.error('[DTF Upload] Intent error:', err);
      alert('Upload failed: ' + err.message);
      self.state = 'IDLE';
      self.renderState();
    });
  };

  DtfUploadBlock.prototype.uploadToSignedUrl = function(intent, file, previewUrl, dims) {
    var self = this;
    var xhr = new XMLHttpRequest();
    var apiBase = this.config.apiBase || '/apps/customizer';

    xhr.upload.addEventListener('progress', function(e) {
      if (e.lengthComputable) {
        var pct = Math.round((e.loaded / e.total) * 100);
        var bar = document.getElementById('dtf-progress-bar');
        var pctEl = document.getElementById('dtf-progress-pct');
        if (bar) bar.style.width = pct + '%';
        if (pctEl) pctEl.textContent = pct + '%';
      }
    });

    xhr.addEventListener('load', function() {
      if (xhr.status >= 200 && xhr.status < 400) {
        // Step 3: Notify server upload is complete
        fetch(apiBase + '/api/upload/complete?shop=' + encodeURIComponent(self.config.shopDomain), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shopDomain: self.config.shopDomain,
            uploadId: intent.uploadId,
            items: [{
              itemId: intent.itemId,
              storageProvider: 'r2',
              fileUrl: intent.publicUrl || '',
              fileSize: file.size
            }]
          })
        })
        .then(function() {
          // Create file entry with client-side dimensions
          var ratio = dims.widthIn > 0 && dims.heightIn > 0
            ? dims.widthIn / dims.heightIn
            : 1;

          self.files.push({
            file: file,
            fileName: file.name,
            previewUrl: previewUrl,
            cdnUrl: intent.publicUrl || '',
            storageKey: intent.key || '',
            uploadId: intent.uploadId,
            itemId: intent.itemId,
            widthPx: dims.widthPx,
            heightPx: dims.heightPx,
            dpi: dims.dpi,
            widthIn: dims.widthIn || 12.5,
            heightIn: dims.heightIn || 7.94,
            measurementStatus: 'pending',
            quantity: 1,
            removeBg: false,
            upscale: false,
            halftone: false,
            keepRatio: true,
            ratio: ratio || 1.57
          });
          self.activeFileIndex = self.files.length - 1;
          self.state = 'EDITOR';
          self.renderState();

          // Step 4: Poll for preflight results (DPI, real dimensions)
          self.pollPreflight(intent.uploadId, self.files.length - 1);
        })
        .catch(function(err) {
          console.error('[DTF Upload] Complete notify error:', err);
          // Still show editor — upload is done, preflight may come later
          self.files.push({
            file: file, fileName: file.name, previewUrl: previewUrl,
            cdnUrl: intent.publicUrl || '', uploadId: intent.uploadId,
            itemId: intent.itemId,
            widthPx: dims.widthPx, heightPx: dims.heightPx, dpi: dims.dpi,
            widthIn: dims.widthIn || 12.5, heightIn: dims.heightIn || 7.94,
            measurementStatus: 'pending',
            quantity: 1, removeBg: false, upscale: false, halftone: false,
            keepRatio: true, ratio: (dims.widthIn / dims.heightIn) || 1.57
          });
          self.activeFileIndex = self.files.length - 1;
          self.state = 'EDITOR';
          self.renderState();
        });
      } else {
        alert('Upload failed (HTTP ' + xhr.status + ')');
        self.state = 'IDLE';
        self.renderState();
      }
    });

    xhr.addEventListener('error', function() {
      alert('Upload failed. Please check your connection.');
      self.state = 'IDLE';
      self.renderState();
    });

    // Use upload method from intent (PUT for Bunny, POST for local)
    var method = intent.uploadMethod || 'PUT';
    xhr.open(method, intent.uploadUrl, true);

    // Set headers from intent
    if (intent.uploadHeaders) {
      var headers = intent.uploadHeaders;
      for (var key in headers) {
        if (headers.hasOwnProperty(key)) {
          xhr.setRequestHeader(key, headers[key]);
        }
      }
    }

    // Set content type
    if (method === 'PUT') {
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    }

    xhr.send(file);
  };

  /* ─────────────────────────────────────────────
     Poll Preflight — get real DPI + dimensions from worker
     ───────────────────────────────────────────── */
  DtfUploadBlock.prototype.pollPreflight = function(uploadId, fileIndex) {
    var self = this;
    var apiBase = this.config.apiBase || '/apps/customizer';
    var attempts = 0;
    var maxAttempts = 40; // 40 × 3s = 2 min timeout

    var interval = setInterval(function() {
      attempts++;
      if (attempts > maxAttempts) {
        clearInterval(interval);
        console.warn('[DTF Upload] Preflight polling timed out for', uploadId);
        return;
      }

      fetch(apiBase + '/api/upload/status/' + uploadId + '?shopDomain=' + encodeURIComponent(self.config.shopDomain))
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (!data || !data.items || !data.items.length) return;

          var item = data.items[0]; // first item
          var fileEntry = self.files[fileIndex];
          if (!fileEntry) { clearInterval(interval); return; }

          // Update with server data if measurement metadata is available
          if ((item.measurementStatus && item.measurementStatus !== 'pending') ||
              (item.preflightStatus && item.preflightStatus !== 'pending')) {
            clearInterval(interval);
            fileEntry.measurementStatus =
              item.measurementStatus ||
              (item.preflightStatus === 'error' ? 'error' : 'ready');
            fileEntry._measurementError =
              (item.errors && item.errors[0]) ||
              (item.problems && item.problems[0] && item.problems[0].message) ||
              (data.errors && data.errors[0]) ||
              (data.problems && data.problems[0] && data.problems[0].message) ||
              '';

            // Update dimensions from preflight
            if (item.widthPx && item.widthPx > 0) fileEntry.widthPx = item.widthPx;
            if (item.heightPx && item.heightPx > 0) fileEntry.heightPx = item.heightPx;
            if (item.effectiveDpi && item.effectiveDpi > 0) fileEntry.dpi = item.effectiveDpi;
            else if (item.dpi && item.dpi > 0) fileEntry.dpi = item.dpi;

            // Recalculate inch dimensions with server-side measurement metadata
            var measurementWidthPx = item.measurementWidthPx && item.measurementWidthPx > 0 ? item.measurementWidthPx : fileEntry.widthPx;
            var measurementHeightPx = item.measurementHeightPx && item.measurementHeightPx > 0 ? item.measurementHeightPx : fileEntry.heightPx;
            if (measurementWidthPx > 0 && measurementHeightPx > 0 && fileEntry.dpi > 0) {
              fileEntry.widthIn = parseFloat((measurementWidthPx / fileEntry.dpi).toFixed(2));
              fileEntry.heightIn = parseFloat((measurementHeightPx / fileEntry.dpi).toFixed(2));
              fileEntry.ratio = fileEntry.widthIn / fileEntry.heightIn;
            }

            // Update thumbnail URL if available
            if (item.thumbnailUrl) fileEntry.previewUrl = item.thumbnailUrl;
            if (item.originalUrl) fileEntry.cdnUrl = item.originalUrl;

            // Re-render if this file is currently selected
            if (self.activeFileIndex === fileIndex && self.state === 'EDITOR') {
              self.renderEditor();
            }

            if (fileEntry.measurementStatus === 'error') {
              self.showToast(fileEntry._measurementError || 'Upload measurement failed.', 'error');
              return;
            }

            console.log('[DTF Upload] Preflight done:', fileEntry.widthIn + 'x' + fileEntry.heightIn + 'in @' + fileEntry.dpi + 'DPI');

            // Mockup generation disabled — FitCheck uses client-side PNG overlay
          }
        })
        .catch(function() { /* ignore poll errors */ });
    }, 3000);
  };

  /* ─────────────────────────────────────────────
     Request Mockup Generation — enqueue job on worker
     ───────────────────────────────────────────── */
  DtfUploadBlock.prototype.requestMockups = function(file) {
    var self = this;
    var apiBase = this.config.apiBase || '/apps/customizer';
    var shopDomain = this.config.shopDomain;

    fetch(apiBase + '/api/mockup/generate?shop=' + encodeURIComponent(shopDomain), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uploadId: file.uploadId,
        shopDomain: shopDomain,
        artworkUrl: file.cdnUrl,
        artworkKey: file.storageKey || '',
        garmentTypes: ['tshirt', 'hoodie', 'polo', 'hat', 'totebag', 'apron'],
        garmentColor: this.mockupColor || '#6b7280'
      })
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.jobId) {
        console.log('[DTF Upload] Mockup job queued:', data.jobId);
        file._mockupJobId = data.jobId;
        // Poll for mockup results
        self.pollMockups(file);
      }
    })
    .catch(function(err) {
      console.warn('[DTF Upload] Mockup request failed:', err.message);
      // Non-critical — FitCheck SVGs still work as fallback
    });
  };

  DtfUploadBlock.prototype.pollMockups = function(file) {
    var self = this;
    var apiBase = this.config.apiBase || '/apps/customizer';
    var attempts = 0;
    var maxAttempts = 30; // 30 × 5s = 2.5min

    var interval = setInterval(function() {
      attempts++;
      if (attempts > maxAttempts) {
        clearInterval(interval);
        console.warn('[DTF Upload] Mockup polling timed out');
        return;
      }

      fetch(apiBase + '/api/upload/status/' + file.uploadId + '?shopDomain=' + encodeURIComponent(self.config.shopDomain))
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (data && data.preflightSummary && data.preflightSummary.mockups) {
            clearInterval(interval);
            file._serverMockups = data.preflightSummary.mockups;
            console.log('[DTF Upload] Server mockups ready:', file._serverMockups.length);
            // Re-render FitCheck if active
            if (self.currentTab === 'fitcheck' && self.state === 'EDITOR') {
              self.renderEditor();
            }
          }
        })
        .catch(function() { /* ignore */ });
    }, 5000);
  };

  DtfUploadBlock.prototype.isSheetPricingEnabled = function() {
    return this.config.pricingMode === 'sheet';
  };

  DtfUploadBlock.prototype.ensureConfigReady = function() {
    if (this._configLoaded) {
      return Promise.resolve(this.config);
    }
    return this.fetchConfigFallback();
  };

  DtfUploadBlock.prototype.applyBuilderConfig = function(builderConfig) {
    if (!builderConfig) return;

    var supportedFormats = Array.isArray(builderConfig.supportedFormats)
      ? builderConfig.supportedFormats
      : null;

    this.config.pricingMode = builderConfig.pricingMode === 'sheet' ? 'sheet' : 'area';
    this.config.sheetOptionName = builderConfig.sheetOptionName || null;
    this.config.widthOptionName = builderConfig.widthOptionName || null;
    this.config.heightOptionName = builderConfig.heightOptionName || null;
    this.config.modalOptionNames = Array.isArray(builderConfig.modalOptionNames) ? builderConfig.modalOptionNames : [];
    this.config.artboardMarginIn = normalizeMarginIn(builderConfig.artboardMarginIn);
    this.config.imageMarginIn = normalizeMarginIn(builderConfig.imageMarginIn);
    if (builderConfig.maxWidthIn) this.config.maxWidth = builderConfig.maxWidthIn;
    if (builderConfig.maxHeightIn) this.config.maxHeight = builderConfig.maxHeightIn;
    if (builderConfig.minWidthIn) this.config.minWidth = builderConfig.minWidthIn;
    if (builderConfig.minHeightIn) this.config.minHeight = builderConfig.minHeightIn;
    if (builderConfig.colorProfile) this.config.colorProfile = builderConfig.colorProfile;
    if (builderConfig.maxFileSizeMb) this.config.maxFileMb = builderConfig.maxFileSizeMb;
    if (supportedFormats && supportedFormats.length) {
      this.config.formats = JSON.stringify(supportedFormats);
      this.fileInput.accept = supportedFormats.map(function(format) {
        return '.' + String(format).toLowerCase();
      }).join(',');
    }
    if (builderConfig.volumeDiscountTiers && builderConfig.volumeDiscountTiers.length > 0) {
      this.config.tiers = JSON.stringify(builderConfig.volumeDiscountTiers);
    }

    this._cachedOptions = null;
    this._variantMatrix = null;
  };

  DtfUploadBlock.prototype.getOptionValue = function(variant, optionIndex) {
    if (!variant) return '';
    var direct = variant['option' + (optionIndex + 1)];
    if (typeof direct === 'string' && direct !== '') return direct;
    if (variant.selectedOptions && variant.selectedOptions[optionIndex]) {
      return variant.selectedOptions[optionIndex].value || '';
    }
    if (Array.isArray(variant.options) && typeof variant.options[optionIndex] === 'string') {
      return variant.options[optionIndex];
    }
    return '';
  };

  DtfUploadBlock.prototype.getEffectiveColorProfile = function() {
    for (var optionName in this.selectedServiceOptions) {
      if (!Object.prototype.hasOwnProperty.call(this.selectedServiceOptions, optionName)) continue;
      var normalized = normalizeOptionName(optionName);
      if (normalized.indexOf('color') >= 0 || normalized.indexOf('profile') >= 0) {
        return this.selectedServiceOptions[optionName];
      }
    }
    return this.config.colorProfile || 'CMYK';
  };

  DtfUploadBlock.prototype.getProductOptions = function() {
    if (this._cachedOptions) return this._cachedOptions;
    if (this.config.productOptions && this.config.productOptions.length) {
      this._cachedOptions = this.config.productOptions;
      return this._cachedOptions;
    }
    if (this.root && this.root.dataset.productOptions) {
      var parsedOptions = safeJsonParse(this.root.dataset.productOptions, []);
      if (parsedOptions.length) {
        this._cachedOptions = parsedOptions;
        return this._cachedOptions;
      }
    }

    var variants = this._getProductVariants();
    if (variants && variants.length && variants[0].selectedOptions) {
      this._cachedOptions = variants[0].selectedOptions.map(function(opt, index) {
        return {
          name: opt.name || ('Option ' + (index + 1)),
          values: [],
        };
      });
      return this._cachedOptions;
    }

    this._cachedOptions = [];
    return this._cachedOptions;
  };

  DtfUploadBlock.prototype.parseSheetSize = function(value) {
    if (!value) return null;
    var cleaned = String(value)
      .replace(/["""'']/g, '')
      .replace(/\binch(es)?\b/gi, '')
      .replace(/\bin\b/gi, '')
      .trim();

    var match = cleaned.match(/(\d+(?:\.\d+)?)\s*[x×X]\s*(\d+(?:\.\d+)?)/);
    if (match) {
      return { widthInch: parseFloat(match[1]), heightInch: parseFloat(match[2]) };
    }

    match = cleaned.match(/(\d+(?:\.\d+)?)\s*by\s*(\d+(?:\.\d+)?)/i);
    if (match) {
      return { widthInch: parseFloat(match[1]), heightInch: parseFloat(match[2]) };
    }

    match = cleaned.match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/);
    if (match) {
      return { widthInch: parseFloat(match[1]), heightInch: parseFloat(match[2]) };
    }

    match = cleaned.match(/(\d+(?:\.\d+)?)\s*[x×X]\s*(\d+(?:\.\d+)?)/i);
    if (match) {
      return { widthInch: parseFloat(match[1]), heightInch: parseFloat(match[2]) };
    }

    var numbers = cleaned.match(/(\d+(?:\.\d+)?)/g);
    if (numbers && numbers.length >= 2) {
      return {
        widthInch: parseFloat(numbers[0]),
        heightInch: parseFloat(numbers[1]),
      };
    }

    return null;
  };

  DtfUploadBlock.prototype.findOptionIndexByName = function(optionDefs, optionName) {
    var normalizedName = normalizeOptionName(optionName);
    if (!normalizedName) return -1;
    for (var i = 0; i < optionDefs.length; i++) {
      if (normalizeOptionName(optionDefs[i].name) === normalizedName) {
        return i;
      }
    }
    return -1;
  };

  DtfUploadBlock.prototype.getOptionValueStats = function(optionDef, index) {
    var values = Array.isArray(optionDef && optionDef.values) ? optionDef.values : [];
    var parseableCount = 0;
    var sheetSizeCount = 0;
    var distinctValues = {};

    for (var i = 0; i < values.length; i++) {
      var measurement = parseMeasurementValue(values[i]);
      if (measurement != null) {
        parseableCount++;
        distinctValues[String(measurement)] = true;
      }
      if (this.parseSheetSize(values[i])) {
        sheetSizeCount++;
      }
    }

    return {
      index: index,
      name: optionDef && optionDef.name ? optionDef.name : ('Option ' + (index + 1)),
      parseableCount: parseableCount,
      sheetSizeCount: sheetSizeCount,
      distinctCount: Object.keys(distinctValues).length,
      totalValues: values.length,
    };
  };

  DtfUploadBlock.prototype.getDimensionNameScore = function(optionName, role) {
    var normalized = normalizeOptionName(optionName);
    if (!normalized) return 0;

    var score = 0;
    if (role === 'width') {
      if (normalized.indexOf('width') >= 0) score += 20;
      if (normalized.indexOf('wide') >= 0) score += 8;
      if (normalized.indexOf('sheet') >= 0) score += 2;
    } else {
      if (normalized.indexOf('height') >= 0) score += 20;
      if (normalized.indexOf('length') >= 0) score += 16;
      if (normalized.indexOf('long') >= 0) score += 8;
      if (normalized.indexOf('sheet') >= 0) score += 2;
    }
    if (normalized.indexOf('size') >= 0) score += 2;
    return score;
  };

  DtfUploadBlock.prototype.detectCombinedDimensionOptionIndex = function(optionDefs) {
    var configuredIndex = this.findOptionIndexByName(optionDefs, this.config.sheetOptionName);
    if (configuredIndex >= 0) {
      var configuredStats = this.getOptionValueStats(optionDefs[configuredIndex], configuredIndex);
      if (configuredStats.sheetSizeCount > 0) return configuredIndex;
    }

    var bestIndex = -1;
    var bestScore = -1;
    for (var i = 0; i < optionDefs.length; i++) {
      var stats = this.getOptionValueStats(optionDefs[i], i);
      if (stats.sheetSizeCount <= 0) continue;
      var score = stats.sheetSizeCount * 10 + stats.distinctCount;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    return bestIndex;
  };

  DtfUploadBlock.prototype.detectSplitDimensionOptionIndexes = function(optionDefs) {
    var metas = [];
    for (var i = 0; i < optionDefs.length; i++) {
      var meta = this.getOptionValueStats(optionDefs[i], i);
      if (meta.parseableCount > 0) metas.push(meta);
    }
    if (metas.length < 2) return null;

    var configuredWidthIndex = this.findOptionIndexByName(optionDefs, this.config.widthOptionName);
    var configuredHeightIndex = this.findOptionIndexByName(optionDefs, this.config.heightOptionName);
    var widthMeta = null;
    var heightMeta = null;
    var m;

    if (configuredWidthIndex >= 0) {
      for (m = 0; m < metas.length; m++) {
        if (metas[m].index === configuredWidthIndex) {
          widthMeta = metas[m];
          break;
        }
      }
    }

    if (configuredHeightIndex >= 0) {
      for (m = 0; m < metas.length; m++) {
        if (metas[m].index === configuredHeightIndex) {
          heightMeta = metas[m];
          break;
        }
      }
    }

    if (!widthMeta) {
      var widthCandidates = metas.slice().sort(function(a, b) {
        var scoreA = this.getDimensionNameScore(a.name, 'width') * 100 + (100 - a.distinctCount) + a.parseableCount;
        var scoreB = this.getDimensionNameScore(b.name, 'width') * 100 + (100 - b.distinctCount) + b.parseableCount;
        return scoreB - scoreA;
      }.bind(this));
      widthMeta = widthCandidates[0];
    }

    if (!heightMeta) {
      var remaining = metas.filter(function(meta) {
        return !widthMeta || meta.index !== widthMeta.index;
      });
      if (!remaining.length) return null;
      remaining.sort(function(a, b) {
        var scoreA = this.getDimensionNameScore(a.name, 'height') * 100 + a.distinctCount * 10 + a.parseableCount;
        var scoreB = this.getDimensionNameScore(b.name, 'height') * 100 + b.distinctCount * 10 + b.parseableCount;
        return scoreB - scoreA;
      }.bind(this));
      heightMeta = remaining[0];
    }

    if (!widthMeta || !heightMeta || widthMeta.index === heightMeta.index) {
      return null;
    }

    return {
      widthIndex: widthMeta.index,
      heightIndex: heightMeta.index,
    };
  };

  DtfUploadBlock.prototype.detectDimensionConfig = function(optionDefs) {
    var configuredCombinedIndex = this.findOptionIndexByName(optionDefs, this.config.sheetOptionName);
    if (configuredCombinedIndex >= 0) {
      var configuredStats = this.getOptionValueStats(optionDefs[configuredCombinedIndex], configuredCombinedIndex);
      if (configuredStats.sheetSizeCount > 0) {
        return {
          mode: 'combined',
          indexes: [configuredCombinedIndex],
          combinedIndex: configuredCombinedIndex,
        };
      }
    }

    var configuredSplit = this.detectSplitDimensionOptionIndexes(optionDefs);
    if (configuredSplit && (this.config.widthOptionName || this.config.heightOptionName)) {
      return {
        mode: 'split',
        indexes: [configuredSplit.widthIndex, configuredSplit.heightIndex],
        widthIndex: configuredSplit.widthIndex,
        heightIndex: configuredSplit.heightIndex,
      };
    }

    var combinedIndex = this.detectCombinedDimensionOptionIndex(optionDefs);
    if (combinedIndex >= 0) {
      return {
        mode: 'combined',
        indexes: [combinedIndex],
        combinedIndex: combinedIndex,
      };
    }

    var splitIndexes = this.detectSplitDimensionOptionIndexes(optionDefs);
    if (splitIndexes) {
      return {
        mode: 'split',
        indexes: [splitIndexes.widthIndex, splitIndexes.heightIndex],
        widthIndex: splitIndexes.widthIndex,
        heightIndex: splitIndexes.heightIndex,
      };
    }

    return null;
  };

  DtfUploadBlock.prototype.buildVariantMatrix = function() {
    if (this._variantMatrix) return this._variantMatrix;

    var variants = this._getProductVariants();
    var optionDefs = this.getProductOptions() || [];
    if (!variants || !variants.length || !optionDefs.length) {
      return null;
    }

    var dimensionConfig = this.detectDimensionConfig(optionDefs);
    if (!dimensionConfig || !dimensionConfig.indexes || !dimensionConfig.indexes.length) {
      return null;
    }

    var configuredModalNames = Array.isArray(this.config.modalOptionNames)
      ? this.config.modalOptionNames.map(normalizeOptionName)
      : [];

    var serviceOptionIndexes = [];
    for (var i = 0; i < optionDefs.length; i++) {
      if (dimensionConfig.indexes.indexOf(i) >= 0) continue;
      if (!configuredModalNames.length || configuredModalNames.indexOf(normalizeOptionName(optionDefs[i].name)) >= 0) {
        serviceOptionIndexes.push(i);
      }
    }

    var familiesByKey = {};
    for (var vi = 0; vi < variants.length; vi++) {
      var variant = variants[vi];
      if (variant && variant.available === false) continue;

      var dims = null;
      var familyLabel = '';
      var optionValuesByIndex = {};

      if (dimensionConfig.mode === 'combined') {
        var sheetValue = this.getOptionValue(variant, dimensionConfig.combinedIndex);
        dims = this.parseSheetSize(sheetValue);
        if (dims) {
          optionValuesByIndex[dimensionConfig.combinedIndex] = sheetValue;
          familyLabel = sheetValue || (dims.widthInch + '" × ' + dims.heightInch + '"');
        }
      } else {
        var widthValue = this.getOptionValue(variant, dimensionConfig.widthIndex);
        var heightValue = this.getOptionValue(variant, dimensionConfig.heightIndex);
        var widthInch = parseMeasurementValue(widthValue);
        var heightInch = parseMeasurementValue(heightValue);
        if (widthInch != null && heightInch != null) {
          dims = {
            widthInch: widthInch,
            heightInch: heightInch,
          };
          optionValuesByIndex[dimensionConfig.widthIndex] = widthValue;
          optionValuesByIndex[dimensionConfig.heightIndex] = heightValue;
          familyLabel = (widthValue || widthInch + '"') + ' × ' + (heightValue || heightInch + '"');
        }
      }
      if (!dims || dims.widthInch < 0.01 || dims.heightInch < 0.01) continue;

      var familyKey = String(dims.widthInch) + 'x' + String(dims.heightInch);
      if (!familiesByKey[familyKey]) {
        familiesByKey[familyKey] = {
          key: familyKey,
          sheetValue: familyLabel,
          displayName: familyLabel || (dims.widthInch + '" x ' + dims.heightInch + '"'),
          widthInch: dims.widthInch,
          heightInch: dims.heightInch,
          optionValuesByIndex: optionValuesByIndex,
          variants: [],
        };
      }
      familiesByKey[familyKey].variants.push(variant);
    }

    var matrix = {
      optionDefs: optionDefs,
      dimensionMode: dimensionConfig.mode,
      dimensionOptionIndexes: dimensionConfig.indexes.slice(),
      sheetOptionIndex: dimensionConfig.mode === 'combined' ? dimensionConfig.combinedIndex : null,
      widthOptionIndex: dimensionConfig.mode === 'split' ? dimensionConfig.widthIndex : null,
      heightOptionIndex: dimensionConfig.mode === 'split' ? dimensionConfig.heightIndex : null,
      serviceOptionIndexes: serviceOptionIndexes,
      serviceOptions: serviceOptionIndexes.map(function(index) {
        var def = optionDefs[index] || {};
        return {
          index: index,
          name: def.name || ('Option ' + (index + 1)),
          values: Array.isArray(def.values) ? def.values : [],
        };
      }),
      sheetFamilies: Object.keys(familiesByKey).map(function(key) {
        return familiesByKey[key];
      }),
    };

    this._variantMatrix = matrix;
    this.ensureServiceOptionSelections(matrix);
    return matrix;
  };

  DtfUploadBlock.prototype.ensureServiceOptionSelections = function(matrix) {
    if (!matrix || !matrix.serviceOptions) return;
    for (var i = 0; i < matrix.serviceOptions.length; i++) {
      var option = matrix.serviceOptions[i];
      if (!option.values || !option.values.length) continue;
      if (option.values.indexOf(this.selectedServiceOptions[option.name]) === -1) {
        var preferredValue = option.values[0];
        if (
          this.config.colorProfile &&
          option.values.indexOf(this.config.colorProfile) >= 0 &&
          (normalizeOptionName(option.name).indexOf('color') >= 0 || normalizeOptionName(option.name).indexOf('profile') >= 0)
        ) {
          preferredValue = this.config.colorProfile;
        }
        this.selectedServiceOptions[option.name] = preferredValue;
      }
    }
  };

  DtfUploadBlock.prototype.syncCustomerIdentity = function() {
    var rawCustomer = window.ULCustomer || {};
    var customerId = normalizeCustomerField(rawCustomer.id);
    var customerEmail = normalizeCustomerField(rawCustomer.email);

    this.customer.id = customerId;
    this.customer.email = customerEmail;
    this.customer.loggedIn = !!(customerId || customerEmail);

    if (!this.customer.loggedIn) {
      this.customer.customerType = 'guest';
      this.customer.statusLabel = 'Guest';
    }

    return this.customer;
  };

  DtfUploadBlock.prototype.getCustomerReturnUrl = function() {
    return window.location.origin + window.location.pathname + window.location.search + '#ul-customer-login-popup';
  };

  DtfUploadBlock.prototype.clearLoginPopupWatcher = function() {
    if (this.loginPollTimer) {
      window.clearInterval(this.loginPollTimer);
      this.loginPollTimer = null;
    }
  };

  DtfUploadBlock.prototype.updateCustomerStatusUI = function() {
    this.syncCustomerIdentity();

    var accountUrl = this.config.accountUrl || '/account';
    var isLoggedIn = this.customer.loggedIn;
    var badgeText = 'Guest';
    var titleText = 'Guest checkout';
    var bodyText = 'Log in to use your saved customer pricing on this page.';
    var rateText = this.customer.pricePerInch != null
      ? ' Active rate: ' + formatMoneyValue(this.customer.pricePerInch, this.customer.currency) + ' / in.'
      : '';
    var identityText = this.customer.email
      ? 'Signed in as ' + this.customer.email + '.'
      : 'Your customer account is signed in.';

    if (isLoggedIn) {
      if (this.customer.contextStatus === 'loading') {
        badgeText = 'Signed in';
        titleText = 'Checking customer status';
        bodyText = identityText + ' We are loading your assigned pricing profile.';
      } else if (this.customer.customerType === 'vip') {
        badgeText = this.customer.statusLabel || 'VIP';
        titleText = 'VIP pricing active';
        bodyText = identityText + ' ' + badgeText + ' account.' + rateText;
      } else {
        badgeText = this.customer.statusLabel || 'Business';
        titleText = 'Business pricing active';
        bodyText = identityText + ' ' + badgeText + ' account. Standard checkout rules apply.' + rateText;
      }
    }

    if (this.customerStatusTitle) this.customerStatusTitle.textContent = titleText;
    if (this.customerStatusText) this.customerStatusText.textContent = bodyText;
    if (this.modalCustomerTitle) this.modalCustomerTitle.textContent = titleText;
    if (this.modalCustomerText) this.modalCustomerText.textContent = bodyText;
    if (this.modalCustomerBadge) this.modalCustomerBadge.textContent = badgeText;

    if (this.customerLoginBtn) this.customerLoginBtn.hidden = isLoggedIn;
    if (this.modalCustomerLoginBtn) this.modalCustomerLoginBtn.hidden = isLoggedIn;

    if (this.customerAccountLink) {
      this.customerAccountLink.hidden = !isLoggedIn;
      this.customerAccountLink.setAttribute('href', accountUrl);
    }
    if (this.modalCustomerAccountLink) {
      this.modalCustomerAccountLink.hidden = !isLoggedIn;
      this.modalCustomerAccountLink.setAttribute('href', accountUrl);
    }
  };

  DtfUploadBlock.prototype.loadCustomerPricingContext = function(forceReloadOnSuccess) {
    var self = this;
    var requestToken = ++this._customerContextRequestToken;
    var wasLoggedIn = this.syncCustomerIdentity().loggedIn;
    var apiBase = this.config.apiBase || '/apps/customizer';
    var shopDomain = this.config.shopDomain || '';
    var productId = this.config.productId || '';

    this.customer.contextStatus = wasLoggedIn ? 'loading' : 'idle';
    this.updateCustomerStatusUI();

    return fetch(
      apiBase + '/api/vip/context?shopDomain=' + encodeURIComponent(shopDomain) + '&productId=' + encodeURIComponent(String(productId)),
      { credentials: 'same-origin' }
    )
      .then(function(response) {
        return response.json().catch(function() { return {}; }).then(function(data) {
          return { response: response, data: data };
        });
      })
      .then(function(result) {
        if (requestToken !== self._customerContextRequestToken) return self.customer;
        if (!result.response.ok) {
          throw new Error(result.data && result.data.error ? result.data.error : 'Failed to load customer pricing context.');
        }

        var data = result.data || {};
        var resolvedCustomerId = normalizeCustomerField(data.customerId);
        var resolvedCustomerType = normalizeCustomerField(data.customerType).toLowerCase();

        if (resolvedCustomerType !== 'vip' && resolvedCustomerType !== 'business' && resolvedCustomerType !== 'guest') {
          resolvedCustomerType = resolvedCustomerId ? 'business' : 'guest';
        }

        self.customer.id = resolvedCustomerId || self.customer.id;
        self.customer.loggedIn = !!(self.customer.id || self.customer.email);
        self.customer.customerType = self.customer.loggedIn ? resolvedCustomerType : 'guest';
        self.customer.statusLabel = normalizeCustomerField(data.statusLabel) || (self.customer.customerType === 'vip' ? 'VIP' : self.customer.loggedIn ? 'Business' : 'Guest');
        self.customer.pricePerInch = parsePositiveNumber(
          data.pricePerInch != null
            ? data.pricePerInch
            : data.status && data.status.pricePerInch != null
              ? data.status.pricePerInch
              : data.businessPricePerInch
        );
        self.customer.currency = normalizeCustomerField(data.currency) || self.customer.currency || self.config.currency || 'USD';
        self.customer.contextStatus = 'ready';

        window.ULCustomer = window.ULCustomer || {};
        if (self.customer.id) window.ULCustomer.id = self.customer.id;
        if (self.customer.email) window.ULCustomer.email = self.customer.email;

        self.updateCustomerStatusUI();

        if (forceReloadOnSuccess && !wasLoggedIn && self.customer.loggedIn) {
          window.location.reload();
        }

        return self.customer;
      })
      .catch(function() {
        if (requestToken !== self._customerContextRequestToken) return self.customer;

        self.customer.contextStatus = 'ready';
        if (self.customer.loggedIn) {
          self.customer.customerType = 'business';
          self.customer.statusLabel = self.customer.statusLabel || 'Business';
        } else {
          self.customer.customerType = 'guest';
          self.customer.statusLabel = 'Guest';
        }
        self.updateCustomerStatusUI();
        return self.customer;
      });
  };

  DtfUploadBlock.prototype.openCustomerLoginPopup = function() {
    var self = this;
    var loginUrl;

    try {
      var resolvedLoginUrl = new URL(this.config.accountLoginUrl || '/account/login', window.location.origin);
      resolvedLoginUrl.searchParams.set('return_url', this.getCustomerReturnUrl());
      loginUrl = resolvedLoginUrl.toString();
    } catch (error) {
      loginUrl = '/account/login?return_url=' + encodeURIComponent(this.getCustomerReturnUrl());
    }

    this.clearLoginPopupWatcher();
    this.loginPopup = window.open(
      loginUrl,
      'ul-customer-login',
      'popup=yes,width=460,height=720,resizable=yes,scrollbars=yes'
    );

    if (!this.loginPopup) {
      window.location.href = loginUrl;
      return;
    }

    try {
      this.loginPopup.focus();
    } catch (error) {}

    this.loginPollTimer = window.setInterval(function() {
      if (!self.loginPopup || self.loginPopup.closed) {
        self.clearLoginPopupWatcher();
        self.loginPopup = null;
        self.loadCustomerPricingContext(true);
      }
    }, 800);
  };

  DtfUploadBlock.prototype.handleCustomerLoginMessage = function(event) {
    if (!event || event.origin !== window.location.origin) return;
    if (!event.data || event.data.type !== 'ul-customer-login-success') return;

    this.clearLoginPopupWatcher();

    if (this.loginPopup && !this.loginPopup.closed) {
      try {
        this.loginPopup.close();
      } catch (error) {}
    }

    this.loginPopup = null;
    this.loadCustomerPricingContext(true);
  };

  DtfUploadBlock.prototype.resolveVariantForFamily = function(family, matrix) {
    if (!family || !matrix) return null;
    for (var i = 0; i < family.variants.length; i++) {
      var variant = family.variants[i];
      var matched = true;
      for (var s = 0; s < matrix.serviceOptions.length; s++) {
        var option = matrix.serviceOptions[s];
        var selectedValue = this.selectedServiceOptions[option.name];
        if (selectedValue && this.getOptionValue(variant, option.index) !== selectedValue) {
          matched = false;
          break;
        }
      }
      if (matched) return variant;
    }
    return null;
  };

  DtfUploadBlock.prototype.fitGrid = function(dw, dh, usableWidth, usableHeight, gap, margin, rotated) {
    if (dw <= 0 || dh <= 0 || dw > usableWidth || dh > usableHeight) {
      return { count: 0, placements: [], rotated: rotated };
    }

    var cols = Math.floor((usableWidth + gap) / (dw + gap));
    var rows = Math.floor((usableHeight + gap) / (dh + gap));

    if (cols <= 0 || rows <= 0) {
      return { count: 0, placements: [], rotated: rotated };
    }

    var placements = [];
    var index = 0;

    for (var row = 0; row < rows; row++) {
      for (var col = 0; col < cols; col++) {
        placements.push({
          x: margin + col * (dw + gap),
          y: margin + row * (dh + gap),
          width: dw,
          height: dh,
          rotated: rotated,
          index: index++,
        });
      }
    }

    return {
      count: cols * rows,
      placements: placements,
      rotated: rotated,
    };
  };

  DtfUploadBlock.prototype.fitGridMixed = function(dw, dh, usableWidth, usableHeight, gap, margin) {
    var placements = [];
    var index = 0;
    var y = 0;
    var normalCols = dw > 0 ? Math.floor((usableWidth + gap) / (dw + gap)) : 0;
    var rotatedCols = dh > 0 ? Math.floor((usableWidth + gap) / (dh + gap)) : 0;

    while (y < usableHeight) {
      var normalFits = y + dh <= usableHeight && normalCols > 0;
      var rotatedFits = y + dw <= usableHeight && rotatedCols > 0;

      if (!normalFits && !rotatedFits) break;

      var useRotated = false;
      var rowHeight = dh;
      var rowCols = normalCols;

      if (normalFits && rotatedFits) {
        var normalDensity = normalCols / dh;
        var rotatedDensity = rotatedCols / dw;
        if (rotatedDensity > normalDensity) {
          useRotated = true;
          rowHeight = dw;
          rowCols = rotatedCols;
        }
      } else if (rotatedFits) {
        useRotated = true;
        rowHeight = dw;
        rowCols = rotatedCols;
      }

      var placedWidth = useRotated ? dh : dw;
      var placedHeight = useRotated ? dw : dh;

      for (var col = 0; col < rowCols; col++) {
        placements.push({
          x: margin + col * (placedWidth + gap),
          y: margin + y,
          width: placedWidth,
          height: placedHeight,
          rotated: useRotated,
          index: index++,
        });
      }

      y += rowHeight + gap;
    }

    return {
      count: placements.length,
      placements: placements,
      rotated: false,
    };
  };

  DtfUploadBlock.prototype.calculateGridFit = function(design, sheet) {
    var gap = normalizeMarginIn(this.config.imageMarginIn);
    var margin = normalizeMarginIn(this.config.artboardMarginIn);
    var usableWidth = sheet.widthInch - 2 * margin;
    var usableHeight = sheet.heightInch - 2 * margin;

    if (usableWidth <= 0 || usableHeight <= 0) {
      return { count: 0, placements: [], rotated: false };
    }

    var normalResult = this.fitGrid(
      design.widthInch,
      design.heightInch,
      usableWidth,
      usableHeight,
      gap,
      margin,
      false
    );

    var rotatedResult = { count: 0, placements: [], rotated: true };
    if (design.widthInch !== design.heightInch) {
      rotatedResult = this.fitGrid(
        design.heightInch,
        design.widthInch,
        usableWidth,
        usableHeight,
        gap,
        margin,
        true
      );
    }

    var mixedResult = { count: 0, placements: [], rotated: false };
    if (design.widthInch !== design.heightInch) {
      mixedResult = this.fitGridMixed(
        design.widthInch,
        design.heightInch,
        usableWidth,
        usableHeight,
        gap,
        margin
      );
    }

    if (mixedResult.count >= normalResult.count && mixedResult.count >= rotatedResult.count) {
      return mixedResult;
    }
    if (rotatedResult.count >= normalResult.count) {
      return rotatedResult;
    }
    return normalResult;
  };

  DtfUploadBlock.prototype.nestDesigns = function(design, sheet, variant) {
    var gridResult = this.calculateGridFit(design, sheet);
    var designsPerSheet = gridResult.count;

    if (designsPerSheet === 0) {
      return {
        sheetKey: sheet.key,
        sheetName: sheet.displayName,
        sheetValue: sheet.sheetValue,
        variantId: variant ? variant.id : null,
        variantTitle: variant ? variant.title : '',
        variantPrice: variant ? normalizeVariantPriceToDollars(variant.price) : 0,
        sheetsNeeded: 0,
        designsPerSheet: 0,
        totalCost: 0,
        efficiency: 0,
        wastePercent: 100,
        error: 'Design too large for this sheet',
      };
    }

    var sheetsNeeded = Math.ceil(design.quantity / designsPerSheet);
    var designArea = design.widthInch * design.heightInch;
    var sheetArea = sheet.widthInch * sheet.heightInch;
    var totalUsedArea = design.quantity * designArea;
    var avgEfficiency = totalUsedArea / (sheetsNeeded * sheetArea) * 100;
    var variantPrice = variant ? normalizeVariantPriceToDollars(variant.price) : 0;

    return {
      sheetKey: sheet.key,
      sheetName: sheet.displayName,
      sheetValue: sheet.sheetValue,
      variantId: variant ? variant.id : null,
      variantTitle: variant ? variant.title : '',
      variantPrice: variantPrice,
      sheetsNeeded: sheetsNeeded,
      designsPerSheet: designsPerSheet,
      totalCost: parseFloat((sheetsNeeded * variantPrice).toFixed(2)),
      efficiency: parseFloat(avgEfficiency.toFixed(1)),
      wastePercent: parseFloat((100 - avgEfficiency).toFixed(1)),
      placements: gridResult.placements,
    };
  };

  DtfUploadBlock.prototype.calculateSheetPricing = function(file) {
    if (!this.isSheetPricingEnabled() || !file) return null;

    var matrix = this.buildVariantMatrix();
    if (!matrix || !matrix.sheetFamilies.length) return null;

    var design = {
      widthInch: file.widthIn,
      heightInch: file.heightIn,
      quantity: file.quantity,
    };

    var results = [];
    for (var i = 0; i < matrix.sheetFamilies.length; i++) {
      var family = matrix.sheetFamilies[i];
      var variant = this.resolveVariantForFamily(family, matrix);
      var result = this.nestDesigns(design, family, variant);
      if (!variant) {
        result.error = result.error || 'No matching variant for selected production options';
      }
      results.push(result);
    }

    var validResults = results.filter(function(result) {
      return result.designsPerSheet > 0 && !!result.variantId;
    });

    validResults.sort(function(a, b) {
      if (a.totalCost !== b.totalCost) return a.totalCost - b.totalCost;
      if (a.sheetsNeeded !== b.sheetsNeeded) return a.sheetsNeeded - b.sheetsNeeded;
      return b.efficiency - a.efficiency;
    });

    var recommended = validResults.length ? validResults[0] : null;
    var selected = null;
    if (file.selectedSheetKey) {
      for (var r = 0; r < validResults.length; r++) {
        if (validResults[r].sheetKey === file.selectedSheetKey) {
          selected = validResults[r];
          break;
        }
      }
    }
    if (!selected && recommended) {
      selected = recommended;
      file.selectedSheetKey = recommended.sheetKey;
    }

    return {
      matrix: matrix,
      results: results,
      validResults: validResults,
      recommended: recommended,
      selected: selected,
    };
  };

  DtfUploadBlock.prototype.resolveAreaVariantSelection = function(widthIn, heightIn) {
    var matrix = this.buildVariantMatrix();
    if (!matrix || !matrix.sheetFamilies || !matrix.sheetFamilies.length) return null;

    var candidates = [];
    for (var i = 0; i < matrix.sheetFamilies.length; i++) {
      var family = matrix.sheetFamilies[i];
      var variant = this.resolveVariantForFamily(family, matrix);
      if (!variant) continue;

      var fits = family.widthInch + 0.01 >= widthIn && family.heightInch + 0.01 >= heightIn;
      var areaDiff = Math.abs((family.widthInch * family.heightInch) - (widthIn * heightIn));
      var overflowPenalty = fits ? 0 : Math.abs(widthIn - family.widthInch) + Math.abs(heightIn - family.heightIn) + 1000;

      candidates.push({
        family: family,
        variant: variant,
        fits: fits,
        areaDiff: areaDiff,
        overflowPenalty: overflowPenalty,
      });
    }

    if (!candidates.length) return null;

    candidates.sort(function(a, b) {
      if (a.fits !== b.fits) return a.fits ? -1 : 1;
      if (a.overflowPenalty !== b.overflowPenalty) return a.overflowPenalty - b.overflowPenalty;
      if (a.areaDiff !== b.areaDiff) return a.areaDiff - b.areaDiff;
      return normalizeVariantPriceToDollars(a.variant.price) - normalizeVariantPriceToDollars(b.variant.price);
    });

    return {
      matrix: matrix,
      family: candidates[0].family,
      variant: candidates[0].variant,
      fits: candidates[0].fits,
    };
  };

  DtfUploadBlock.prototype.getAreaVariantPricing = function(file) {
    if (!file) return null;
    var resolved = this.resolveAreaVariantSelection(file.widthIn, file.heightIn);
    if (!resolved || !resolved.variant) return null;

    var unitPrice = normalizeVariantPriceToDollars(resolved.variant.price);
    var quantity = Math.max(1, parseInt(file.quantity, 10) || 1);
    return {
      matrix: resolved.matrix,
      family: resolved.family,
      variant: resolved.variant,
      fits: resolved.fits,
      unitPrice: unitPrice,
      total: parseFloat((unitPrice * quantity).toFixed(2)),
    };
  };

  DtfUploadBlock.prototype.getVariantDimensionBounds = function(matrix) {
    if (!matrix || !matrix.sheetFamilies || !matrix.sheetFamilies.length) return null;

    var bounds = {
      minWidth: matrix.sheetFamilies[0].widthInch,
      maxWidth: matrix.sheetFamilies[0].widthInch,
      minHeight: matrix.sheetFamilies[0].heightInch,
      maxHeight: matrix.sheetFamilies[0].heightInch,
    };

    for (var i = 1; i < matrix.sheetFamilies.length; i++) {
      var family = matrix.sheetFamilies[i];
      if (family.widthInch < bounds.minWidth) bounds.minWidth = family.widthInch;
      if (family.widthInch > bounds.maxWidth) bounds.maxWidth = family.widthInch;
      if (family.heightInch < bounds.minHeight) bounds.minHeight = family.heightInch;
      if (family.heightInch > bounds.maxHeight) bounds.maxHeight = family.heightInch;
    }

    return bounds;
  };

  DtfUploadBlock.prototype.getFileDisplayPrice = function(file) {
    if (this.isSheetPricingEnabled()) {
      var pricing = this.calculateSheetPricing(file);
      if (pricing && pricing.selected) {
        return {
          subtotal: pricing.selected.totalCost.toFixed(2),
          total: pricing.selected.totalCost.toFixed(2),
        };
      }
      return {
        subtotal: '0.00',
        total: '0.00',
      };
    }
    var areaVariantPricing = this.getAreaVariantPricing(file);
    if (areaVariantPricing) {
      return {
        subtotal: areaVariantPricing.total.toFixed(2),
        total: areaVariantPricing.total.toFixed(2),
      };
    }
    return this.calculatePrice(file.widthIn, file.heightIn, file.quantity);
  };

  DtfUploadBlock.prototype.renderServiceOptionControls = function(matrix) {
    if (!matrix || !matrix.serviceOptions || !matrix.serviceOptions.length) return '';

    var html = [
      '<div class="dtf-sheet-config">',
      '  <div class="dtf-sheet-config__title">Production Options</div>',
      '  <div class="dtf-sheet-config__grid">'
    ];

    for (var i = 0; i < matrix.serviceOptions.length; i++) {
      var option = matrix.serviceOptions[i];
      html.push(
        '    <div class="dtf-input-group">',
        '      <label>' + escapeHtml(option.name) + '</label>',
        '      <select class="dtf-service-select" data-option-name="' + escapeHtml(option.name) + '">'
      );

      for (var v = 0; v < option.values.length; v++) {
        var value = option.values[v];
        html.push(
          '        <option value="' + escapeHtml(value) + '"' +
            (this.selectedServiceOptions[option.name] === value ? ' selected' : '') +
            '>' + escapeHtml(value) + '</option>'
        );
      }

      html.push(
        '      </select>',
        '    </div>'
      );
    }

    html.push(
      '  </div>',
      '</div>'
    );

    return html.join('');
  };

  DtfUploadBlock.prototype.renderSheetPricingRows = function(pricing) {
    if (!pricing || !pricing.results || !pricing.results.length) {
      return '<div class="dtf-sheet-list-empty">No sheet variants were found for this product.</div>';
    }

    var rows = ['<div class="dtf-sheet-list">'];
    for (var i = 0; i < pricing.results.length; i++) {
      var result = pricing.results[i];
      var isSelected = pricing.selected && pricing.selected.sheetKey === result.sheetKey;
      var isRecommended = pricing.recommended && pricing.recommended.sheetKey === result.sheetKey;
      var isDisabled = !result.variantId || result.designsPerSheet === 0;
      var detailText = '';

      if (result.designsPerSheet === 0) {
        detailText = result.error || 'Does not fit';
      } else if (!result.variantId) {
        detailText = result.error || 'No matching variant';
      } else {
        detailText =
          result.designsPerSheet +
          '/sheet · ' +
          result.sheetsNeeded +
          ' sheet' +
          (result.sheetsNeeded > 1 ? 's' : '') +
          ' · ' +
          result.efficiency.toFixed(0) +
          '% eff.';
      }

      rows.push(
        '<button type="button" class="dtf-sheet-choice' +
          (isSelected ? ' is-selected' : '') +
          (isRecommended ? ' is-recommended' : '') +
          '" data-sheet-key="' +
          escapeHtml(result.sheetKey) +
          '"' +
          (isDisabled ? ' disabled' : '') +
          '>',
        '  <span class="dtf-sheet-choice__meta">',
        '    <span class="dtf-sheet-choice__name">' + escapeHtml(result.sheetName) + '</span>',
        (isRecommended ? '    <span class="dtf-sheet-choice__badge">Best</span>' : ''),
        '    <span class="dtf-sheet-choice__detail">' + escapeHtml(detailText) + '</span>',
        '  </span>',
        '  <span class="dtf-sheet-choice__price">' +
          (result.variantId ? '$' + result.totalCost.toFixed(2) : 'N/A') +
          '</span>',
        '</button>'
      );
    }
    rows.push('</div>');
    return rows.join('');
  };

  DtfUploadBlock.prototype.renderSheetPricingSummary = function(file, pricing) {
    if (!pricing || !pricing.selected) {
      return [
        '<div class="dtf-price-calc">',
        '  <div class="dtf-price-row"><span>Status:</span><span>Variant resolution required</span></div>',
        '</div>'
      ].join('');
    }

    var selected = pricing.selected;
    return [
      '<div class="dtf-price-calc">',
      '  <div class="dtf-price-row"><span>Requested Copies:</span><span>' + file.quantity + '</span></div>',
      '  <div class="dtf-price-row"><span>Selected Sheet:</span><span>' + escapeHtml(selected.sheetName) + '</span></div>',
      '  <div class="dtf-price-row"><span>Designs / Sheet:</span><span>' + selected.designsPerSheet + '</span></div>',
      '  <div class="dtf-price-row"><span>Sheets Needed:</span><span>' + selected.sheetsNeeded + '</span></div>',
      '  <div class="dtf-price-row"><span>Price / Sheet:</span><span>$' + selected.variantPrice.toFixed(2) + '</span></div>',
      '  <div class="dtf-price-row"><span>Artboard Margin:</span><span>' + normalizeMarginIn(this.config.artboardMarginIn).toFixed(3) + ' in</span></div>',
      '  <div class="dtf-price-row"><span>Image Margin:</span><span>' + normalizeMarginIn(this.config.imageMarginIn).toFixed(3) + ' in</span></div>',
      '  <div class="dtf-price-divider"></div>',
      '  <div class="dtf-price-row dtf-price-total"><span>Total Price:</span><span>$' + selected.totalCost.toFixed(2) + '</span></div>',
      '</div>'
    ].join('');
  };

  DtfUploadBlock.prototype.renderAreaPricingSummary = function(file, priceData, areaVariantPricing) {
    if (!areaVariantPricing || !areaVariantPricing.variant) {
      return '<div class="dtf-price-calc">' +
        '<div class="dtf-price-row"><span>Price / in\u00B2:</span> <span>$' + priceData.unitPrice + '</span></div>' +
        '<div class="dtf-price-row"><span>Total Area:</span> <span>' + priceData.area + ' in\u00B2</span></div>' +
        '<div class="dtf-price-row"><span>Price:</span> <span>' + priceData.formula + '</span></div>' +
        '<div class="dtf-price-divider"></div>' +
        '<div class="dtf-price-row dtf-price-total"><span>Total Price:</span> <span>$' + priceData.total + '</span></div>' +
      '</div>';
    }

    return '<div class="dtf-price-calc">' +
      '<div class="dtf-price-row"><span>Artwork Area:</span><span>' + priceData.area + ' in\u00B2</span></div>' +
      '<div class="dtf-price-row"><span>Matched Variant:</span><span>' + escapeHtml(areaVariantPricing.variant.title || areaVariantPricing.family.displayName) + '</span></div>' +
      '<div class="dtf-price-row"><span>Variant Price:</span><span>$' + areaVariantPricing.unitPrice.toFixed(2) + '</span></div>' +
      '<div class="dtf-price-row"><span>Quantity:</span><span>' + file.quantity + '</span></div>' +
      '<div class="dtf-price-divider"></div>' +
      '<div class="dtf-price-row dtf-price-total"><span>Total Price:</span><span>$' + areaVariantPricing.total.toFixed(2) + '</span></div>' +
    '</div>';
  };

  /* ─────────────────────────────────────────────
     Pricing — from taslak (client-side, no API)
     ───────────────────────────────────────────── */
  DtfUploadBlock.prototype.getActiveTier = function(qty) {
    var tiers = [];
    try {
      tiers = JSON.parse(this.config.tiers || '[]');
    } catch(e) {}
    if (!tiers.length) return { price_per_sqin: 0.06 };
    var found = null;
    for (var i = 0; i < tiers.length; i++) {
      var t = tiers[i];
      if (qty >= t.min_qty && (t.max_qty === null || qty <= t.max_qty)) {
        found = t;
        break;
      }
    }
    return found || tiers[0];
  };

  DtfUploadBlock.prototype.calculatePrice = function(widthIn, heightIn, qty) {
    var area = widthIn * heightIn;
    var tier = this.getActiveTier(qty);
    var unitPrice = tier.price_per_sqin;
    var total = area * qty * unitPrice;

    return {
      area: area.toFixed(2),
      unitPrice: unitPrice.toFixed(4),
      subtotal: (area * unitPrice).toFixed(2),
      total: total.toFixed(2),
      formula: area.toFixed(2) + ' in\u00B2 \u00D7 ' + qty + ' \u00D7 $' + unitPrice.toFixed(4) + ' /in\u00B2 = $' + total.toFixed(2)
    };
  };

  /* ─────────────────────────────────────────────
     Editor Renderer (from taslak — with focus preservation)
     ───────────────────────────────────────────── */
  DtfUploadBlock.prototype.renderEditor = function() {
    // Preserve focus state
    var activeEl = document.activeElement;
    var activeId = activeEl ? activeEl.id : null;
    var selStart = null, selEnd = null;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
      try { selStart = activeEl.selectionStart; selEnd = activeEl.selectionEnd; } catch(e) {}
    }

    var file = this.files[this.activeFileIndex];
    if (!file) return;

    var priceData = this.calculatePrice(file.widthIn, file.heightIn, file.quantity);
    var variantMatrix = this.buildVariantMatrix();
    var variantBounds = this.getVariantDimensionBounds(variantMatrix);
    var sheetPricing = this.isSheetPricingEnabled() ? this.calculateSheetPricing(file) : null;
    var areaVariantPricing = !this.isSheetPricingEnabled() ? this.getAreaVariantPricing(file) : null;
    var maxWidthLimit = variantBounds ? Math.max(this.config.maxWidth, variantBounds.maxWidth) : this.config.maxWidth;
    var maxHeightLimit = variantBounds ? Math.max(this.config.maxHeight, variantBounds.maxHeight) : this.config.maxHeight;

    // Validation
    var errors = [];
    if (file.widthIn > maxWidthLimit) errors.push('Width should be less than ' + maxWidthLimit + 'in');
    if (file.heightIn > maxHeightLimit) errors.push('Height should be less than ' + maxHeightLimit + 'in');
    if (file.widthIn < this.config.minWidth) errors.push('Width should be at least ' + this.config.minWidth + 'in');
    if (file.heightIn < this.config.minHeight) errors.push('Height should be at least ' + this.config.minHeight + 'in');

    if (this.isSheetPricingEnabled()) {
      if (!sheetPricing) {
        errors.push('Sheet pricing is enabled, but no sheet-sized variants could be analyzed.');
      } else if (!sheetPricing.validResults.length) {
        errors.push('No valid sheet variant matches the current design and production options.');
      }
    } else if (variantMatrix && variantMatrix.sheetFamilies && variantMatrix.sheetFamilies.length && !areaVariantPricing) {
      errors.push('No product variant matches the current dimensions and production options.');
    }

    this.addToCartBtn.disabled = errors.length > 0 || (this.isSheetPricingEnabled() && (!sheetPricing || !sheetPricing.selected));

    // Build HTML
    var leftContent = '';
    if (this.currentTab === 'canvas') {
      leftContent =
        '<div class="dtf-canvas-wrapper">' +
          '<div class="dtf-canvas-dim-top">' + file.widthIn + 'in</div>' +
          '<div class="dtf-canvas-dim-left">' + file.heightIn + 'in</div>' +
          '<div class="dtf-canvas-box">' +
            (file.previewUrl
              ? '<img src="' + file.previewUrl + '" class="dtf-canvas-img" />'
              : '<div style="width:300px;height:200px;display:flex;align-items:center;justify-content:center;font-size:48px;">📄</div>') +
          '</div>' +
        '</div>';
    } else {
      // FitCheck — Progressive Enhancement
      // Priority: 1) Server mockups (real composites) → 2) SVG with artwork overlay (fallback)
      var self = this;
      var serverMockups = file._serverMockups || [];
      var isMockupLoading = file._mockupJobId && !serverMockups.length;
      var mockupCards = '';

      // Map server mockup garmentType → FITCHECK_MOCKUPS id for matching
      var serverMockupMap = {};
      for (var sm = 0; sm < serverMockups.length; sm++) {
        var sMockup = serverMockups[sm];
        // Normalize: server uses 'totebag', SVG array uses 'tote'
        var normalizedType = sMockup.garmentType === 'totebag' ? 'tote' : sMockup.garmentType;
        serverMockupMap[normalizedType] = sMockup;
      }

      for (var m = 0; m < FITCHECK_MOCKUPS.length; m++) {
        var mockup = FITCHECK_MOCKUPS[m];
        var serverMatch = serverMockupMap[mockup.id];

        {
          // ═══ PNG FALLBACK (garment photo + artwork overlay) ═══
          var artworkWidth = Math.min((file.widthIn / mockup.printArea.maxInches) * 100, 100);
          mockupCards +=
            '<div class="dtf-mockup-card' + (isMockupLoading ? ' dtf-mockup-card--loading' : '') + '">' +
              '<div class="dtf-mockup-image-container">' +
                '<div class="dtf-mockup-base">' +
                  '<img src="' + self.mockupAssetBase + mockup.imgFile + '" alt="' + mockup.name + '" style="width:100%;height:100%;object-fit:contain;" />' +
                '</div>' +
                '<div class="dtf-mockup-print-area" style="top:' + mockup.printArea.top + '%;left:' + mockup.printArea.left + '%;width:' + mockup.printArea.width + '%;">' +
                  (file.previewUrl
                    ? '<img src="' + file.previewUrl + '" class="dtf-mockup-artwork" style="width:' + artworkWidth + '%;" />'
                    : '') +
                '</div>' +
                // Loading shimmer overlay when mockups are being generated
                (isMockupLoading
                  ? '<div class="dtf-mockup-shimmer"><div class="dtf-mockup-shimmer-bar"></div></div>'
                  : '') +
              '</div>' +
              '<div class="dtf-mockup-info">' +
                '<h4>' + mockup.name + '</h4>' +
                '<p>' + mockup.placement + '</p>' +
                '<div class="dtf-mockup-dims">' + file.widthIn + 'in \u00D7 ' + file.heightIn + 'in</div>' +
                (isMockupLoading
                  ? '<span class="dtf-mockup-badge-loading">Generating...</span>'
                  : '') +
              '</div>' +
            '</div>';
        }
      }

      var colorSwatches = '';
      for (var c = 0; c < MOCKUP_COLORS.length; c++) {
        var color = MOCKUP_COLORS[c];
        colorSwatches += '<button type="button" class="dtf-color-swatch' + (this.mockupColor === color ? ' active' : '') + '" style="background-color:' + color + ';" data-color="' + color + '"></button>';
      }

      var regenBtn = serverMockups.length > 0
        ? '<button type="button" class="dtf-fitcheck-regen" id="dtf-regen-mockups">\u21BB Regenerate with ' + this.mockupColor + '</button>'
        : '';

      leftContent =
        '<div class="dtf-fitcheck-layout">' +
          '<div class="dtf-fitcheck-grid">' + mockupCards + '</div>' +
          '<div class="dtf-fitcheck-colors">' +
            '<p>Change your preview items to any color below:</p>' +
            '<div class="dtf-color-swatches">' + colorSwatches + '</div>' +
            regenBtn +
          '</div>' +
        '</div>';
    }

    // Error banners
    var errorHtml = '';
    for (var e = 0; e < errors.length; e++) {
      errorHtml += '<div class="dtf-error-banner" role="alert">\u26A0 ' + errors[e] + '</div>';
    }

    // Thumbnails
    var thumbsHtml = '<button class="dtf-thumb-add" id="dtf-add-more">+</button>';
    for (var t = 0; t < this.files.length; t++) {
      var f = this.files[t];
      var tPrice = this.getFileDisplayPrice(f);
      var tActive = t === this.activeFileIndex ? ' active' : '';
      thumbsHtml +=
        '<div class="dtf-thumb' + tActive + '" data-file-index="' + t + '">' +
          (f.previewUrl
            ? '<img src="' + f.previewUrl + '">'
            : '<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:24px;">📄</div>') +
          '<span class="dtf-thumb-badge">' + f.quantity + '</span>' +
          '<div class="dtf-thumb-price">$' + tPrice.subtotal + '</div>' +
        '</div>';
    }

    this.modalBody.innerHTML =
      '<div class="dtf-editor-layout">' +
        '<div class="dtf-editor-left">' +
          '<div class="dtf-tabs">' +
            '<span style="font-size:13px;">Resolution: <strong>' + (file.dpi || 300) + ' DPI</strong></span>' +
            '<div class="dtf-tab-group">' +
              '<button class="dtf-tab' + (this.currentTab === 'canvas' ? ' active' : '') + '" data-tab="canvas">Canvas</button>' +
              '<button class="dtf-tab' + (this.currentTab === 'fitcheck' ? ' active' : '') + '" data-tab="fitcheck">FitCheck</button>' +
            '</div>' +
          '</div>' +
          '<div class="dtf-canvas-container' + (this.currentTab === 'fitcheck' ? ' is-fitcheck' : '') + '">' +
            leftContent +
          '</div>' +
        '</div>' +
        '<div class="dtf-editor-right">' +
          '<div class="dtf-toggles">' +
            this.renderToggle('Remove Background', 'removeBg', file.removeBg) +
            this.renderToggle('Upscale Quality', 'upscale', file.upscale) +
            this.renderToggle('Halftone', 'halftone', file.halftone) +
            this.renderToggle('Keep Aspect Ratio (' + file.ratio.toFixed(2) + ') \u267B', 'keepRatio', file.keepRatio) +
          '</div>' +
          '<div class="dtf-inputs">' +
            '<div class="dtf-input-group">' +
              '<label>WIDTH (IN)</label>' +
              '<input type="number" id="dtf-input-w" value="' + file.widthIn + '" step="0.01"' + (file.widthIn > maxWidthLimit ? ' class="error"' : '') + '>' +
              '<span class="dtf-hint">Max is ' + maxWidthLimit + ' in</span>' +
            '</div>' +
            '<div class="dtf-input-group">' +
              '<label>HEIGHT (IN)</label>' +
              '<input type="number" id="dtf-input-h" value="' + file.heightIn + '" step="0.01"' + (file.heightIn > maxHeightLimit ? ' class="error"' : '') + '>' +
              '<span class="dtf-hint">Max is ' + maxHeightLimit + ' in</span>' +
            '</div>' +
            '<div class="dtf-input-group">' +
              '<label>QUANTITY</label>' +
              '<input type="number" id="dtf-input-q" value="' + file.quantity + '" min="1" step="1">' +
            '</div>' +
          '</div>' +
          this.renderServiceOptionControls((sheetPricing && sheetPricing.matrix) || variantMatrix) +
          '<div class="dtf-errors">' + errorHtml + '</div>' +
          '<div class="dtf-thumbnails">' + thumbsHtml + '</div>' +
          (this.isSheetPricingEnabled()
            ? this.renderSheetPricingRows(sheetPricing) + this.renderSheetPricingSummary(file, sheetPricing)
            : this.renderAreaPricingSummary(file, priceData, areaVariantPricing)) +
        '</div>' +
      '</div>';

    this.bindEditorEvents();

    // Restore focus
    if (activeId) {
      var el = document.getElementById(activeId);
      if (el) {
        el.focus();
        if (selStart !== null) {
          try { el.setSelectionRange(selStart, selEnd); } catch(ex) {}
        }
      }
    }
  };

  /* ─────────────────────────────────────────────
     Editor Event Bindings
     ───────────────────────────────────────────── */
  DtfUploadBlock.prototype.bindEditorEvents = function() {
    var self = this;
    var file = this.files[this.activeFileIndex];
    if (!file) return;

    // Width/Height/Quantity inputs — debounced re-render
    var inputW = document.getElementById('dtf-input-w');
    var inputH = document.getElementById('dtf-input-h');
    var inputQ = document.getElementById('dtf-input-q');
    var renderTimeout = null;

    function debouncedRender() {
      if (renderTimeout) clearTimeout(renderTimeout);
      renderTimeout = setTimeout(function() { self.renderEditor(); }, 300);
    }

    if (inputW) inputW.addEventListener('input', function(e) {
      file.widthIn = parseFloat(e.target.value) || 0;
      if (file.keepRatio && file.ratio > 0) {
        file.heightIn = parseFloat((file.widthIn / file.ratio).toFixed(2));
        if (inputH) inputH.value = file.heightIn;
      }
      debouncedRender();
    });

    if (inputH) inputH.addEventListener('input', function(e) {
      file.heightIn = parseFloat(e.target.value) || 0;
      if (file.keepRatio && file.ratio > 0) {
        file.widthIn = parseFloat((file.heightIn * file.ratio).toFixed(2));
        if (inputW) inputW.value = file.widthIn;
      }
      debouncedRender();
    });

    if (inputQ) inputQ.addEventListener('input', function(e) {
      file.quantity = parseInt(e.target.value, 10) || 1;
      debouncedRender();
    });

    var serviceSelects = this.modalBody.querySelectorAll('.dtf-service-select');
    for (var ss = 0; ss < serviceSelects.length; ss++) {
      serviceSelects[ss].addEventListener('change', function(e) {
        var optionName = e.target.getAttribute('data-option-name');
        if (optionName) {
          self.selectedServiceOptions[optionName] = e.target.value;
          debouncedRender();
        }
      });
    }

    var sheetChoices = this.modalBody.querySelectorAll('.dtf-sheet-choice[data-sheet-key]');
    for (var sc = 0; sc < sheetChoices.length; sc++) {
      sheetChoices[sc].addEventListener('click', function(e) {
        var sheetKey = e.currentTarget.getAttribute('data-sheet-key');
        if (sheetKey) {
          file.selectedSheetKey = sheetKey;
          self.renderEditor();
        }
      });
    }

    // Tab switching
    var tabs = this.modalBody.querySelectorAll('.dtf-tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function(e) {
        self.currentTab = e.target.getAttribute('data-tab');
        self.renderEditor();
      });
    }

    // Color swatches
    var swatches = this.modalBody.querySelectorAll('.dtf-color-swatch');
    for (var s = 0; s < swatches.length; s++) {
      swatches[s].addEventListener('click', function(e) {
        self.mockupColor = e.target.getAttribute('data-color');
        self.renderEditor();
      });
    }

    // Toggles
    var toggles = this.modalBody.querySelectorAll('input[type="checkbox"][data-key]');
    for (var t = 0; t < toggles.length; t++) {
      toggles[t].addEventListener('change', function(e) {
        var key = e.target.getAttribute('data-key');
        file[key] = e.target.checked;
        if (key === 'keepRatio' && file.keepRatio && file.widthIn > 0 && file.heightIn > 0) {
          file.ratio = file.widthIn / file.heightIn;
        }
        // Trigger remove background when toggled ON
        if (key === 'removeBg' && file.removeBg && file.cdnUrl) {
          self.removeBackground(file);
        }
        self.renderEditor();
      });
    }

    // Add more button
    var addMore = document.getElementById('dtf-add-more');
    if (addMore) {
      addMore.addEventListener('click', function() { self.fileInput.click(); });
    }

    // Thumbnail selection
    var thumbItems = this.modalBody.querySelectorAll('[data-file-index]');
    for (var ti = 0; ti < thumbItems.length; ti++) {
      thumbItems[ti].addEventListener('click', function(e) {
        var idx = parseInt(e.currentTarget.getAttribute('data-file-index'), 10);
        if (!isNaN(idx) && idx >= 0 && idx < self.files.length) {
          self.activeFileIndex = idx;
          self.renderEditor();
        }
      });
    }

    // Regenerate mockups button
    var regenBtn = document.getElementById('dtf-regen-mockups');
    // Regenerate button removed — FitCheck is fully client-side
  };

  /* ─────────────────────────────────────────────
     Add to Cart — Shopify /cart/add.js
     Uses variant from page, line item properties per spec
     ───────────────────────────────────────────── */
  DtfUploadBlock.prototype.addToCart = function() {
    var self = this;
    var failedFiles = this.files.filter(function(f) {
      return f.measurementStatus === 'error';
    });
    var readyFiles = this.files.filter(function(f) {
      return f.measurementStatus === 'ready' && f.widthIn > 0 && f.heightIn > 0;
    });
    if (readyFiles.length === 0) {
      if (failedFiles.length > 0) {
        alert(failedFiles[0]._measurementError || 'One of the uploaded files failed server measurement.');
        return;
      }
      alert('Upload measurement is not ready yet. Please wait for server sizing to complete.');
      return;
    }

    this.addToCartBtn.disabled = true;
    this.addToCartBtn.innerHTML = 'Adding...';

    if (this.isSheetPricingEnabled()) {
      var sheetItems = [];
      for (var sf = 0; sf < readyFiles.length; sf++) {
        var readyFile = readyFiles[sf];
        var sheetPricing = this.calculateSheetPricing(readyFile);
        if (!sheetPricing || !sheetPricing.selected || !sheetPricing.selected.variantId) {
          alert('Could not resolve a sheet-priced variant for one of the uploaded files.');
          this.addToCartBtn.disabled = false;
          this.addToCartBtn.innerHTML = 'Add To Cart';
          return;
        }

        var selectedResult = sheetPricing.selected;
        var sheetProperties = {
          '_file_url': readyFile.cdnUrl || '',
          '_file_name': readyFile.fileName,
          '_width_in': String(readyFile.widthIn),
          '_height_in': String(readyFile.heightIn),
          '_remove_background': String(readyFile.removeBg),
          '_upscale_quality': String(readyFile.upscale),
          '_halftone': String(readyFile.halftone),
          '_color_profile': self.getEffectiveColorProfile(),
          '_resolution_dpi': String(readyFile.dpi || 300),
          '_upload_id': readyFile.uploadId || '',
          '_mode': 'dtf_by_size_sheet',
          '_sheet_name': selectedResult.sheetName,
          '_sheet_key': selectedResult.sheetKey,
          '_designs_per_sheet': String(selectedResult.designsPerSheet),
          '_sheets_needed': String(selectedResult.sheetsNeeded),
          '_requested_copies': String(readyFile.quantity),
          '_artboard_margin_in': String(normalizeMarginIn(self.config.artboardMarginIn)),
          '_image_margin_in': String(normalizeMarginIn(self.config.imageMarginIn))
        };

        for (var optionName in self.selectedServiceOptions) {
          if (Object.prototype.hasOwnProperty.call(self.selectedServiceOptions, optionName)) {
            sheetProperties[optionName] = self.selectedServiceOptions[optionName];
          }
        }

        sheetItems.push({
          id: selectedResult.variantId,
          quantity: selectedResult.sheetsNeeded,
          properties: sheetProperties
        });
      }

      fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: sheetItems })
      })
      .then(function(res) {
        if (!res.ok) throw new Error('Cart add failed');
        return res.json();
      })
      .then(function() {
        self.showToast('Added to cart!', 'success');
        self.refreshCartCount();
        self.closeModal();
      })
      .catch(function(err) {
        alert('Failed to add to cart: ' + err.message);
      })
      .finally(function() {
        self.addToCartBtn.disabled = false;
        self.addToCartBtn.innerHTML =
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg> ' +
          'Add To Cart';
      });
      return;
    }

    // Find variant ID per file (based on dimensions)
    var firstFile = readyFiles[0];
    var variantId = this.findVariantId(firstFile.widthIn, firstFile.heightIn);
    if (!variantId) {
      alert('Could not determine product variant. Please refresh the page.');
      this.addToCartBtn.disabled = false;
      this.addToCartBtn.innerHTML = 'Add To Cart';
      return;
    }

    var items = readyFiles.map(function(item) {
      // Per-file variant matching
      var itemVariantId = self.findVariantId(item.widthIn, item.heightIn) || variantId;
      var lineItem = {
        id: itemVariantId,
        quantity: item.quantity,
        properties: {
          '_file_url': item.cdnUrl || '',
          '_file_name': item.fileName,
          '_width_in': String(item.widthIn),
          '_height_in': String(item.heightIn),
          '_total_area_sqin': String((item.widthIn * item.heightIn).toFixed(2)),
          '_price_per_sqin': String(self.getActiveTier(item.quantity).price_per_sqin),
          '_remove_background': String(item.removeBg),
          '_upscale_quality': String(item.upscale),
          '_halftone': String(item.halftone),
          '_color_profile': self.getEffectiveColorProfile(),
          '_resolution_dpi': String(item.dpi || 300),
          '_upload_id': item.uploadId || '',
          '_mode': 'dtf_by_size'
        }
      };
      for (var optionName in self.selectedServiceOptions) {
        if (Object.prototype.hasOwnProperty.call(self.selectedServiceOptions, optionName)) {
          lineItem.properties[optionName] = self.selectedServiceOptions[optionName];
        }
      }
      return lineItem;
    });

    fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: items })
    })
    .then(function(res) {
      if (!res.ok) throw new Error('Cart add failed');
      return res.json();
    })
    .then(function() {
      self.showToast('Added to cart!', 'success');
      self.refreshCartCount();
      self.closeModal();
    })
    .catch(function(err) {
      alert('Failed to add to cart: ' + err.message);
    })
    .finally(function() {
      self.addToCartBtn.disabled = false;
      self.addToCartBtn.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg> ' +
        'Add To Cart';
    });
  };

  DtfUploadBlock.prototype.findVariantId = function(widthIn, heightIn) {
    var resolvedSelection = this.resolveAreaVariantSelection(widthIn, heightIn);
    if (resolvedSelection && resolvedSelection.variant) {
      return resolvedSelection.variant.id;
    }

    // Get all variants from product JSON on page
    var variants = this._getProductVariants();
    if (!variants || variants.length === 0) return null;

    // If only 1 variant, use it
    if (variants.length === 1) return variants[0].id;

    // Parse variant titles to extract W×H (supports: "10in x 10in", "10 x 10", "10x10", etc.)
    var parsed = [];
    for (var i = 0; i < variants.length; i++) {
      var v = variants[i];
      var title = (v.title || v.option1 || '').toLowerCase().replace(/\s+/g, '');
      // Match patterns: "10inx10in", "10x10in", "10x10", "10.5inx12.3in"
      var match = title.match(/^([\d.]+)(?:in)?x([\d.]+)(?:in)?$/);
      if (match) {
        parsed.push({
          id: v.id,
          price: v.price,
          w: parseFloat(match[1]),
          h: parseFloat(match[2]),
          title: v.title
        });
      }
    }

    if (parsed.length === 0) {
      // No parseable variants — fallback to URL param or first variant
      var urlVariant = new URLSearchParams(window.location.search).get('variant');
      if (urlVariant) {
        for (var j = 0; j < variants.length; j++) {
          if (String(variants[j].id) === urlVariant) return variants[j].id;
        }
      }
      return variants[0].id;
    }

    // Try exact match first (within 0.01in tolerance)
    for (var k = 0; k < parsed.length; k++) {
      if (Math.abs(parsed[k].w - widthIn) < 0.01 && Math.abs(parsed[k].h - heightIn) < 0.01) {
        console.log('[DTF] Exact variant match:', parsed[k].title);
        return parsed[k].id;
      }
    }

    // No exact match — find closest by area difference
    var targetArea = widthIn * heightIn;
    var bestIdx = 0;
    var bestDiff = Infinity;
    for (var n = 0; n < parsed.length; n++) {
      var area = parsed[n].w * parsed[n].h;
      var diff = Math.abs(area - targetArea);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = n;
      }
    }
    console.log('[DTF] Closest variant match:', parsed[bestIdx].title, '(target:', widthIn + 'x' + heightIn + ')');
    return parsed[bestIdx].id;
  };

  // Cache product variants from page JSON
  DtfUploadBlock.prototype._getProductVariants = function() {
    if (this._cachedVariants) return this._cachedVariants;

    if (this.config.productVariants && this.config.productVariants.length) {
      this._cachedVariants = this.config.productVariants;
      return this._cachedVariants;
    }

    if (this.root && this.root.dataset.productVariants) {
      var parsedVariants = safeJsonParse(this.root.dataset.productVariants, []);
      if (parsedVariants.length) {
        this._cachedVariants = parsedVariants;
        return this._cachedVariants;
      }
    }

    var jsonEl = document.querySelector(
      '[data-product-json], script[type="application/json"][data-product-json], ' +
      'script#ProductJson-product-template'
    );
    if (jsonEl) {
      try {
        var data = JSON.parse(jsonEl.textContent);
        var product = data.product || data;
        this._cachedVariants = product.variants || [];
        return this._cachedVariants;
      } catch(e) {}
    }

    // Fallback: hidden form input
    var hiddenInput = document.querySelector(
      'form[action*="/cart/add"] input[name="id"][type="hidden"], ' +
      'form[action*="/cart/add"] select[name="id"]'
    );
    if (hiddenInput && hiddenInput.value) {
      this._cachedVariants = [{ id: parseInt(hiddenInput.value, 10), title: '' }];
      return this._cachedVariants;
    }

    return [];
  };

  /* ─────────────────────────────────────────────
     Utilities
     ───────────────────────────────────────────── */
  DtfUploadBlock.prototype.showToast = function(message, type) {
    var toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;top:20px;right:20px;z-index:999999;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:500;color:#fff;background:' + (type === 'success' ? '#22c55e' : '#ef4444') + ';box-shadow:0 4px 12px rgba(0,0,0,0.15);transition:opacity 300ms;';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(function() {
      toast.style.opacity = '0';
      setTimeout(function() { toast.remove(); }, 300);
    }, 3000);
  };

  DtfUploadBlock.prototype.refreshCartCount = function() {
    fetch('/cart.js')
      .then(function(r) { return r.json(); })
      .then(function(cart) {
        var els = document.querySelectorAll('.cart-count, .cart-count-bubble, [data-cart-count], .js-cart-count');
        for (var i = 0; i < els.length; i++) {
          els[i].textContent = cart.item_count;
        }
      })
      .catch(function() {});
  };

  /* ─────────────────────────────────────────────
     Remove Background — calls backend proxy
     ───────────────────────────────────────────── */
  DtfUploadBlock.prototype.removeBackground = function(file) {
    var self = this;
    var apiBase = this.config.apiBase || '/apps/customizer';

    if (!file.cdnUrl && !file.previewUrl) {
      this.showToast('No image URL available for background removal.', 'error');
      return;
    }

    // Store original for undo
    if (!file._originalPreviewUrl) {
      file._originalPreviewUrl = file.previewUrl;
      file._originalCdnUrl = file.cdnUrl;
    }

    file._removingBg = true;
    this.showToast('Removing background...', 'info');

    fetch(apiBase + '/api/remove-bg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl: file.cdnUrl || file.previewUrl })
    })
    .then(function(res) {
      if (!res.ok) throw new Error('Remove BG failed (HTTP ' + res.status + ')');
      return res.json();
    })
    .then(function(data) {
      file._removingBg = false;
      if (data.resultUrl) {
        file.previewUrl = data.resultUrl;
        self.showToast('Background removed!', 'success');
      } else {
        self.showToast('Background removal returned no result.', 'error');
      }
      self.renderEditor();
    })
    .catch(function(err) {
      file._removingBg = false;
      file.removeBg = false;
      console.error('[DTF Upload] Remove BG error:', err);
      self.showToast('Background removal failed: ' + err.message, 'error');
      self.renderEditor();
    });
  };

  /* ─────────────────────────────────────────────
     Fetch config fallback — get tiers from API if metafields empty
     ───────────────────────────────────────────── */
  DtfUploadBlock.prototype.fetchConfigFallback = function() {
    var self = this;
    if (this._configFetchPromise) return this._configFetchPromise;

    var apiBase = this.config.apiBase || '/apps/customizer';
    var shopDomain = this.config.shopDomain;
    var productId = this.config.productId;

    if (!shopDomain || !productId) {
      this._configLoaded = true;
      return Promise.resolve(this.config);
    }

    var hasTiers = false;
    try {
      var parsed = JSON.parse(this.config.tiers || '[]');
      hasTiers = parsed && parsed.length > 0;
    } catch(e) {}

    var hasSheetConfig =
      this.config.pricingMode === 'sheet' ||
      !!this.config.sheetOptionName ||
      !!this.config.widthOptionName ||
      !!this.config.heightOptionName ||
      (Array.isArray(this.config.modalOptionNames) && this.config.modalOptionNames.length > 0);

    if (hasTiers && hasSheetConfig) {
      this._configLoaded = true;
      return Promise.resolve(this.config);
    }

    this._configFetchPromise = fetch(apiBase + '/api/storefront/config?shopDomain=' + encodeURIComponent(shopDomain) + '&productId=' + encodeURIComponent(productId))
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data && data.product && data.product.builderConfig) {
          return { builderConfig: data.product.builderConfig };
        }
        return fetch(apiBase + '/api/product-config/' + encodeURIComponent(productId) + '?shop=' + encodeURIComponent(shopDomain));
      })
      .then(function(res) {
        if (res && typeof res.json === 'function') {
          return res.json();
        }
        return res;
      })
      .then(function(config) {
        if (config && config.builderConfig) {
          self.applyBuilderConfig(config.builderConfig);
          console.log('[DTF Upload] Config loaded from API:', config.builderConfig);
          if (self.state === 'EDITOR') {
            self.renderEditor();
          }
        }
        self._configLoaded = true;
        self._configFetchPromise = null;
        return self.config;
      })
      .catch(function(err) {
        console.warn('[DTF Upload] Config fallback failed:', err);
        self._configLoaded = true;
        self._configFetchPromise = null;
        return self.config;
      });

    return this._configFetchPromise;
  };

  /* ─────────────────────────────────────────────
     Initialization (from taslak — reads data attributes)
     ───────────────────────────────────────────── */
  function init() {
    var root = document.getElementById('dtf-upload-root');
    if (root && !root.dataset.initialized) {
      root.dataset.initialized = 'true';
      var config = {
        productId: root.dataset.productId,
        productTitle: root.dataset.productTitle || '',
        shopDomain: root.dataset.shopDomain,
        apiBase: root.dataset.apiBase || '/apps/customizer',
        maxWidth: parseFloat(root.dataset.maxWidth) || 21.75,
        maxHeight: parseFloat(root.dataset.maxHeight) || 35.75,
        minWidth: parseFloat(root.dataset.minWidth) || 1,
        minHeight: parseFloat(root.dataset.minHeight) || 1,
        maxFileMb: parseInt(root.dataset.maxFileMb, 10) || 500,
        formats: root.dataset.formats,
        tiers: root.dataset.tiers,
        productVariants: safeJsonParse(root.dataset.productVariants || '[]', []),
        productOptions: safeJsonParse(root.dataset.productOptions || '[]', []),
        pricingMode: root.dataset.pricingMode || 'area',
        sheetOptionName: root.dataset.sheetOptionName || null,
        widthOptionName: root.dataset.widthOptionName || null,
        heightOptionName: root.dataset.heightOptionName || null,
        modalOptionNames: safeJsonParse(root.dataset.modalOptionNames || '[]', []),
        artboardMarginIn: normalizeMarginIn(root.dataset.artboardMarginIn),
        imageMarginIn: normalizeMarginIn(root.dataset.imageMarginIn),
        colorProfile: root.dataset.colorProfile || 'CMYK',
        currency: root.dataset.currency || 'USD',
        enableFitcheck: root.dataset.enableFitcheck !== 'false',
        accountLoginUrl: root.dataset.accountLoginUrl || '/account/login',
        accountUrl: root.dataset.accountUrl || '/account'
      };
      window.dtfBlock = new DtfUploadBlock(config);
      // Fetch config from API as fallback if metafields are empty
      window.dtfBlock.fetchConfigFallback();
    }
  }

  // Export for dtf-listing.js to reuse
  window.DtfUploadBlock = DtfUploadBlock;

  document.addEventListener('DOMContentLoaded', init);
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 100);
  }
})();
