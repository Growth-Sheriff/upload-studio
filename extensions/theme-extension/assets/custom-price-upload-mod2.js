  (function() {
    try {
      if (window.location.hash === '#ul-main-customer-login-popup') {
        if (window.opener) {
          window.opener.postMessage({ type: 'ul-main-customer-login-success' }, window.location.origin);
          window.close();
          return;
        }
        if (window.history && typeof window.history.replaceState === 'function') {
          window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
        }
      }
    } catch (error) {}

    // App block asset: the block marks its root with data-ul-custom-price-mod2
    // (one instance per product page).
    var root = document.querySelector('[data-ul-custom-price-mod2]');
    if (!root || root.getAttribute('data-ul-main-product-bound') === 'true') return;
    root.setAttribute('data-ul-main-product-bound', 'true');
    var MAIN_PRODUCT_MEASUREMENT_POLICY = 'main_product_roll_width';
    var MAIN_PRODUCT_ROLL_WIDTH_IN = 22;

    function parseOptionalPositiveNumber(value) {
      var parsed = Number(value);
      return isFinite(parsed) && parsed > 0 ? parsed : null;
    }

    function getServerConfirmedUploadInches(payload) {
      if (!payload) return null;
      var widthIn = parseOptionalPositiveNumber(payload.widthIn);
      var heightIn = parseOptionalPositiveNumber(payload.heightIn);
      if (widthIn && heightIn) {
        return { widthIn: widthIn, heightIn: heightIn };
      }
      return null;
    }

    function getMeasurementStageStatus(payload) {
      if (!payload || typeof payload !== 'object') return null;
      if (
        payload.measurementStatus === 'pending' ||
        payload.measurementStatus === 'ready' ||
        payload.measurementStatus === 'warning' ||
        payload.measurementStatus === 'error'
      ) {
        return payload.measurementStatus;
      }

      if (
        payload.stages &&
        typeof payload.stages === 'object' &&
        payload.stages.measurement &&
        typeof payload.stages.measurement === 'object'
      ) {
        var stageStatus = payload.stages.measurement.status;
        if (
          stageStatus === 'pending' ||
          stageStatus === 'ready' ||
          stageStatus === 'warning' ||
          stageStatus === 'error'
        ) {
          return stageStatus;
        }
      }

      return null;
    }

    function applyMainProductRollMeasurement(target) {
      if (!target || !(target.widthPx > 0) || !(target.heightPx > 0)) return false;
      var shortSidePx = Math.min(target.widthPx, target.heightPx);
      var longSidePx = Math.max(target.widthPx, target.heightPx);
      if (!(shortSidePx > 0)) return false;
      var isPortrait = target.heightPx >= target.widthPx;
      var longSideIn = (longSidePx / shortSidePx) * MAIN_PRODUCT_ROLL_WIDTH_IN;
      target.widthIn = Number((isPortrait ? MAIN_PRODUCT_ROLL_WIDTH_IN : longSideIn).toFixed(2));
      target.heightIn = Number((isPortrait ? longSideIn : MAIN_PRODUCT_ROLL_WIDTH_IN).toFixed(2));
      target.effectiveDpi = Math.round(shortSidePx / MAIN_PRODUCT_ROLL_WIDTH_IN);
      target.sizingSource = 'sheet_width_anchor';
      target.measurementMode = 'full';
      return target.widthIn > 0 && target.heightIn > 0;
    }

    function applyMainProductDocumentDpiMeasurement(target) {
      if (!target || !(target.widthPx > 0) || !(target.heightPx > 0) || !(target.embeddedDpi > 1)) return false;
      target.widthIn = Number((target.widthPx / target.embeddedDpi).toFixed(2));
      target.heightIn = Number((target.heightPx / target.embeddedDpi).toFixed(2));
      target.effectiveDpi = target.embeddedDpi;
      target.sizingSource = 'document_dpi';
      target.measurementMode = 'full';
      return target.widthIn > 0 && target.heightIn > 0;
    }

    function applyServerMeasurement(payload, targetState) {
      if (!payload) return false;

      var target = targetState || state;

      target.widthPx = parseNonNegativeNumber(getPayloadField(payload, 'widthPx')) || target.widthPx || 0;
      target.heightPx = parseNonNegativeNumber(getPayloadField(payload, 'heightPx')) || target.heightPx || 0;
      target.trimmedWidthPx = parseNonNegativeNumber(getPayloadField(payload, 'trimmedWidthPx')) || 0;
      target.trimmedHeightPx = parseNonNegativeNumber(getPayloadField(payload, 'trimmedHeightPx')) || 0;
      target.trimmedOffsetXPx = parseNonNegativeNumber(getPayloadField(payload, 'trimmedOffsetXPx')) || 0;
      target.trimmedOffsetYPx = parseNonNegativeNumber(getPayloadField(payload, 'trimmedOffsetYPx')) || 0;
      // embeddedDpi must come ONLY from the file's own metadata (documentDpi).
      // The generic `dpi` field is the anchored fallback (e.g. shortEdgePx/22)
      // and using it as embeddedDpi makes the client recompute dims with that
      // reverse-engineered value (e.g. 1494/30 = 49.80 instead of the server's
      // correctly anchored 49.20), masking the "no embedded DPI" case.
      target.embeddedDpi =
        parseNonNegativeNumber(getPayloadField(payload, 'documentDpi')) ||
        target.embeddedDpi ||
        0;
      target.effectiveDpi = parseNonNegativeNumber(getPayloadField(payload, 'effectiveDpi')) || target.effectiveDpi || 0;
      var nextSizingSource = getPayloadField(payload, 'sizingSource');
      target.sizingSource =
        typeof nextSizingSource === 'string' && nextSizingSource
          ? String(nextSizingSource)
          : target.sizingSource;
      var nextMeasurementMode = getPayloadField(payload, 'measurementMode');
      target.measurementMode =
        typeof nextMeasurementMode === 'string' && nextMeasurementMode
          ? String(nextMeasurementMode)
          : target.measurementMode;

      var measurementStatus = getMeasurementStageStatus(payload);
      if (measurementStatus && measurementStatus !== 'ready' && measurementStatus !== 'warning') {
        return false;
      }

      var confirmedInches = getServerConfirmedUploadInches(payload);
      if (confirmedInches) {
        target.widthIn = confirmedInches.widthIn;
        target.heightIn = confirmedInches.heightIn;
        return true;
      }
      if (applyMainProductDocumentDpiMeasurement(target)) {
        return true;
      }
      return applyMainProductRollMeasurement(target);
    }

    function getResolvedSizingSource(value) {
      if (value && typeof value === 'object') {
        var explicitSource = typeof value.sizingSource === 'string' && value.sizingSource ? String(value.sizingSource) : '';
        if (explicitSource) return explicitSource;
        var embeddedDpi = parseNonNegativeNumber(value.embeddedDpi);
        var effectiveDpi = parseNonNegativeNumber(value.effectiveDpi);
        if (embeddedDpi > 0 && effectiveDpi > 0 && Math.abs(embeddedDpi - effectiveDpi) < 0.01) {
          return 'document_dpi';
        }
      }
      return 'sheet_width_anchor';
    }

    function getResolvedSizingDpi(value) {
      if (!value || typeof value !== 'object') return 0;
      var embeddedDpi = parseNonNegativeNumber(value.embeddedDpi);
      var effectiveDpi = parseNonNegativeNumber(value.effectiveDpi);
      if (embeddedDpi > 0) return embeddedDpi;
      if (effectiveDpi > 0) return effectiveDpi;
      return 0;
    }

    function getSizingMethodText(value) {
      if (!value || typeof value !== 'object') {
        return 'Document size will be confirmed after upload measurement.';
      }
      var embeddedDpi = parseNonNegativeNumber(value.embeddedDpi);
      var effectiveDpi = parseNonNegativeNumber(value.effectiveDpi);
      var widthIn = parseNonNegativeNumber(value.widthIn);
      var heightIn = parseNonNegativeNumber(value.heightIn);
      var source = getResolvedSizingSource(value);

      if (!(widthIn > 0) || !(heightIn > 0)) {
        return 'Document size will be confirmed after upload measurement.';
      }

      var sizeText = widthIn.toFixed(2) + '" × ' + heightIn.toFixed(2) + '"';

      if (source === 'document_dpi' && embeddedDpi > 0) {
        return 'Document size: ' + sizeText + ' (file resolution: ' + embeddedDpi + ' DPI).';
      }

      if (embeddedDpi > 0) {
        return 'Document size: ' + sizeText + ' (file resolution: ' + embeddedDpi + ' DPI).';
      }

      if (effectiveDpi > 0) {
        return 'Document size: ' + sizeText + ' (artwork prints at ~' + Math.round(effectiveDpi) + ' DPI).';
      }

      return 'Document size: ' + sizeText + '.';
    }

    var productJsonEl = root.querySelector('script[data-ul-mod2-product-json]');
    var productData = productJsonEl ? JSON.parse(productJsonEl.textContent) : { variants: [] };
    var apiBase = root.getAttribute('data-api-base') || '/apps/customizer';
    var shopDomain = root.getAttribute('data-shop-domain') || '';
    var customerLoggedIn = root.getAttribute('data-customer-logged-in') === 'true';

    function sendUploadXhr(url, method, file, headers, onProgress) {
      return new Promise(function(resolve, reject) {
        var xhr = new XMLHttpRequest();
        var settled = false;
        function fail(err) { if (settled) return; settled = true; reject(err); }
        function done() { if (settled) return; settled = true; resolve(); }
        xhr.upload.addEventListener('progress', function(e) {
          if (typeof onProgress === 'function' && e.lengthComputable) onProgress(e.loaded, e.total);
        });
        xhr.addEventListener('load', function() {
          if (xhr.status >= 200 && xhr.status < 300) done();
          else fail(new Error('HTTP_' + xhr.status));
        });
        xhr.addEventListener('error', function() { fail(new Error('XHR_ERROR')); });
        xhr.addEventListener('timeout', function() { fail(new Error('XHR_TIMEOUT')); });
        xhr.addEventListener('abort', function() { fail(new Error('XHR_ABORT')); });
        xhr.timeout = 10 * 60 * 1000;
        try {
          xhr.open(method, url, true);
          if (method === 'PUT') {
            xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
            if (headers) Object.keys(headers).forEach(function(k) { xhr.setRequestHeader(k, headers[k]); });
            xhr.send(file);
          } else if (method === 'POST') {
            var fd = new FormData();
            fd.append('file', file);
            if (headers && headers.__extraFields) {
              Object.keys(headers.__extraFields).forEach(function(k) { fd.append(k, headers.__extraFields[k]); });
            }
            xhr.send(fd);
          } else {
            xhr.send(file);
          }
        } catch (e) { fail(e); }
      });
    }

    function sleepMs(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

    // Content fingerprint via the shared probe (null when unavailable).
    async function ulFingerprint(file) {
      try {
        if (window.ULFileProbe && window.ULFileProbe.fingerprint) return await window.ULFileProbe.fingerprint(file);
      } catch (_) {}
      return null;
    }

    async function performUploadWithRetry(file, intent, onProgress) {
      if (intent.deduplicated) {
        if (typeof onProgress === 'function') onProgress(file.size, file.size);
        return { via: 'dedupe', attempt: 0 };
      }
      // Upgrade from Variant Gang Sheet Upload: parallel multipart with
      // in-place resume for large files (R2), single-shot below the threshold.
      if (intent.multipart && window.ULMultipartUploader && window.ULMultipartUploader.tryUpload) {
        try {
          var mpResult = await window.ULMultipartUploader.tryUpload(file, intent, {
            onProgress: onProgress,
            shopDomain: shopDomain,
            concurrency: window.ULMultipartUploader.DEFAULT_CONCURRENCY || 6
          });
          if (mpResult) {
            intent.publicUrl = mpResult.fileUrl || intent.publicUrl;
            intent.storageProvider = mpResult.storageProvider;
            return { via: 'r2-multipart', attempt: 1 };
          }
        } catch (mpErr) {
          try { console.warn('[MainUpload] multipart failed, falling back to single-shot: ' + (mpErr && mpErr.message ? mpErr.message : mpErr)); } catch (_) {}
        }
      }
      var storageProvider = intent.storageProvider || 'local';
      var primaryMethod = intent.uploadMethod || (storageProvider === 'local' ? 'POST' : 'PUT');
      var primaryHeaders = intent.uploadHeaders || null;
      if (primaryMethod === 'POST') {
        primaryHeaders = { __extraFields: {
          key: intent.key || '',
          uploadId: intent.uploadId || '',
          itemId: intent.itemId || ''
        } };
      }
      var retryConfig = intent.retryConfig || { maxRetries: 3, retryDelayMs: 1000 };
      var maxRetries = Math.max(1, Number(retryConfig.maxRetries) || 3);
      var baseDelay = Math.max(250, Number(retryConfig.retryDelayMs) || 1000);

      var lastErr = null;
      for (var attempt = 0; attempt < maxRetries; attempt++) {
        try {
          await sendUploadXhr(intent.uploadUrl, primaryMethod, file, primaryHeaders, onProgress);
          return { via: storageProvider, attempt: attempt + 1 };
        } catch (err) {
          lastErr = err;
          try { console.warn('[MainUpload] Primary upload attempt ' + (attempt + 1) + ' failed: ' + (err && err.message ? err.message : err)); } catch (_) {}
          if (attempt < maxRetries - 1) {
            await sleepMs(baseDelay * Math.pow(2, attempt));
          }
        }
      }

      var fallbackCandidates = [];
      if (intent.fallbackUrls) {
        if (intent.fallbackUrls.r2 && intent.fallbackUrls.r2.url && storageProvider !== 'r2') {
          fallbackCandidates.push({
            label: 'r2',
            url: intent.fallbackUrls.r2.url,
            method: intent.fallbackUrls.r2.method || 'PUT',
            headers: null
          });
        }
        if (intent.fallbackUrls.local && intent.fallbackUrls.local.url) {
          fallbackCandidates.push({
            label: 'local',
            url: intent.fallbackUrls.local.url,
            method: intent.fallbackUrls.local.method || 'POST',
            headers: { __extraFields: {
              key: intent.key || '',
              uploadId: intent.uploadId || '',
              itemId: intent.itemId || ''
            } }
          });
        }
      }
      if (storageProvider !== 'local') {
        fallbackCandidates.push({
          label: 'proxy-local',
          url: apiBase + '/api/upload/local',
          method: 'POST',
          headers: { __extraFields: {
            key: intent.key || '',
            uploadId: intent.uploadId || '',
            itemId: intent.itemId || ''
          } }
        });
      }

      for (var i = 0; i < fallbackCandidates.length; i++) {
        var cand = fallbackCandidates[i];
        try {
          try { console.warn('[MainUpload] Falling back to ' + cand.label); } catch (_) {}
          await sendUploadXhr(cand.url, cand.method, file, cand.headers, onProgress);
          return { via: cand.label, attempt: maxRetries + i + 1, fallback: true };
        } catch (err) {
          lastErr = err;
          try { console.warn('[MainUpload] Fallback ' + cand.label + ' failed: ' + (err && err.message ? err.message : err)); } catch (_) {}
        }
      }

      var msg = (lastErr && lastErr.message) ? lastErr.message : 'XHR_ERROR';
      throw new Error('Upload failed after retries (' + msg + ')');
    }

    var customerFirstName = root.getAttribute('data-customer-first-name') || '';
    var customerLastName = root.getAttribute('data-customer-last-name') || '';
    var effectiveRules = {
      maxUploadWidth: parseOptionalPositiveNumber(root.getAttribute('data-max-upload-width'))
    };

    var galleryPanel = root.querySelector('.ul-main-gallery-panel');
    var customerWorkspace = root.querySelector('.ul-main-customer-workspace');
    var customerWorkspaceStatus = root.querySelector('.ul-main-customer-workspace-status');
    var customerWorkspaceTitle = root.querySelector('.ul-main-customer-workspace-title');
    var customerWorkspaceCopy = root.querySelector('.ul-main-customer-workspace-copy');
    var customerWorkspaceMeta = root.querySelector('.ul-main-customer-workspace-meta');
    var customerWorkspaceCount = root.querySelector('.ul-main-customer-workspace-count');
    var customerWorkspaceList = root.querySelector('.ul-main-customer-workspace-list');
    var themeCustomerId = root.getAttribute('data-customer-id') || '';
    var themeCustomerEmail = root.getAttribute('data-customer-email') || '';
    var uploadInput = root.querySelector('.ul-main-upload-input');
    var uploadTrigger = root.querySelector('.ul-main-upload-trigger');
    var uploadBox = root.querySelector('.ul-main-upload-box');
    var uploadLoading = root.querySelector('.ul-main-upload-loading');
    var uploadLoadingText = root.querySelector('.ul-main-upload-loading-text');
    var uploadProgress = root.querySelector('.ul-main-upload-progress');
    var customBatchInline = root.querySelector('.ul-main-custom-batch-inline');
    var customBatchInlineCurrent = root.querySelector('.ul-main-custom-batch-inline-current');
    var customBatchInlineTotal = root.querySelector('.ul-main-custom-batch-inline-total');
    var inlinePricingBox = root.querySelector('.ul-main-inline-pricing');
    var inlinePricingKicker = root.querySelector('.ul-main-inline-pricing-kicker');
    var inlinePricingTotal = root.querySelector('.ul-main-inline-pricing-total');
    var inlinePricingMeta = root.querySelector('.ul-main-inline-pricing-meta');
    var inlinePricingButton = root.querySelector('.ul-main-inline-pricing-button');
    var customBatchProgress = root.querySelector('.ul-main-custom-batch-progress');
    var customBatchStep = root.querySelector('.ul-main-custom-batch-step');
    var customBatchText = root.querySelector('.ul-main-custom-batch-text');
    var customBatchMeta = root.querySelector('.ul-main-custom-batch-meta');
    var customBatchCountText = root.querySelector('.ul-main-custom-batch-count-text');
    var customBatchBar = root.querySelector('.ul-main-custom-batch-bar');
    var uploadFeedback = root.querySelector('.ul-main-upload-feedback');
    var customQueueEl = root.querySelector('.ul-main-custom-queue');
    var uploadThumb = root.querySelector('.ul-main-upload-thumb');
    var uploadName = root.querySelector('.ul-main-upload-name');
    var uploadMeta = root.querySelector('.ul-main-upload-meta');
    var uploadStatus = root.querySelector('.ul-main-upload-status');
    var uploadError = root.querySelector('.ul-main-upload-error');
    var uploadRemove = root.querySelector('.ul-main-upload-remove');
    var detectedBox = root.querySelector('.ul-main-detected');
    var detectedTitle = root.querySelector('.ul-main-detected-title');
    var detectedWidth = root.querySelector('.ul-main-detected-width');
    var detectedHeight = root.querySelector('.ul-main-detected-height');
    var detectedVariant = root.querySelector('.ul-main-selected-variant');
    var detectedNote = root.querySelector('.ul-main-detected-note');
    var vipPricingBox = root.querySelector('.ul-main-vip-pricing');
    var vipPricingTitle = root.querySelector('.ul-main-vip-pricing-title');
    var vipPricingRate = root.querySelector('.ul-main-vip-pricing-rate');
    var vipPricingLength = root.querySelector('.ul-main-vip-pricing-length');
    var vipPricingTotal = root.querySelector('.ul-main-vip-pricing-total');
    var vipPreviewCard = root.querySelector('.ul-main-vip-preview-card');
    var vipPreviewSummary = root.querySelector('.ul-main-vip-preview-summary');
    var vipPreviewBillingChip = root.querySelector('.ul-main-vip-preview-billing-chip');
    var vipPreviewArtworkChip = root.querySelector('.ul-main-vip-preview-artwork-chip');
    var vipPreviewModeChip = root.querySelector('.ul-main-vip-preview-mode-chip');
    var vipPreviewSelector = root.querySelector('.ul-main-vip-preview-selector');
    var vipPreviewSelect = root.querySelector('.ul-main-vip-preview-select');
    var vipPreviewActive = root.querySelector('.ul-main-vip-preview-active');
    var vipPreviewActiveTitle = root.querySelector('.ul-main-vip-preview-active-title');
    var vipPreviewActiveMeta = root.querySelector('.ul-main-vip-preview-active-meta');
    var vipPreviewActiveNote = root.querySelector('.ul-main-vip-preview-active-note');
    var vipPreviewActivePills = root.querySelector('.ul-main-vip-preview-active-pills');
    var vipPreviewEmpty = root.querySelector('.ul-main-vip-preview-empty');
    var vipPreviewEmptyTitle = root.querySelector('.ul-main-vip-preview-empty-title');
    var vipPreviewEmptyBody = root.querySelector('.ul-main-vip-preview-empty-body');
    var vipPreviewCanvas = root.querySelector('.ul-main-vip-preview-canvas');
    var vipPreviewFootnote = root.querySelector('.ul-main-vip-preview-footnote');
    var vipPreviewTopTrack = root.querySelector('.ul-main-vip-preview-top-track');
    var vipPreviewLeftTrack = root.querySelector('.ul-main-vip-preview-left-track');
    var vipPreviewStageWrap = root.querySelector('.ul-main-vip-preview-stage-wrap');
    var vipPreviewStageRail = root.querySelector('.ul-main-vip-preview-stage-rail');
    var vipPreviewStage = root.querySelector('.ul-main-vip-preview-stage');
    var vipPreviewImage = root.querySelector('.ul-main-vip-preview-image');
    var vipPreviewArtwork = root.querySelector('.ul-main-vip-preview-artwork');
    var quantitySelect = root.querySelector('.ul-main-quantity');
    var quantityRow = root.querySelector('.ul-main-quantity-row');
    var addToCartBtn = root.querySelector('.ul-main-add-to-cart');
    var buyNowBtn = root.querySelector('.ul-main-buy-now');
    var hiddenVariantInput = root.querySelector('.ul-main-variant-input');
    var variantSelect = root.querySelector('.ul-main-variant-select');
    var productPrice = root.querySelector('.ul-main-product-price');
    var buyBoxPrice = root.querySelector('.ul-main-buybox-price');
    var variantPricingTable = root.querySelector('.ul-main-variant-pricing');
    var productImage = root.querySelector('.ul-main-product-image');
    var thumbButtons = Array.prototype.slice.call(root.querySelectorAll('.js-thumb-click'));
    var accordionTriggers = Array.prototype.slice.call(root.querySelectorAll('.js-accordion-trigger'));
    var variantRows = Array.prototype.slice.call(root.querySelectorAll('.ul-main-variant-row'));
    var uploadRequired = Boolean(uploadInput && uploadBox);
    var addToCartLabel = addToCartBtn ? addToCartBtn.textContent : 'Add to Cart';
    var buyNowLabel = buyNowBtn ? buyNowBtn.textContent : 'Buy Now';
    var detectedDefaultTitle = detectedTitle ? detectedTitle.textContent : 'Detected Gang Sheet Size';
    var customerStatusTitle = root.querySelector('.ul-main-customer-status-title');
    var customerStatusText = root.querySelector('.ul-main-customer-status-text');
    var customerStatusBadge = root.querySelector('.ul-main-customer-status-badge');
    var customerLoginLink = root.querySelector('.ul-main-customer-login');
    var customerAccountLink = root.querySelector('.ul-main-customer-account');
    var customerLoginPopup = null;
    var customerLoginPollTimer = null;

    var state = {
      uploadId: '',
      originalUrl: '',
      thumbnailUrl: '',
      fileName: '',
      widthPx: 0,
      heightPx: 0,
      trimmedWidthPx: 0,
      trimmedHeightPx: 0,
      trimmedOffsetXPx: 0,
      trimmedOffsetYPx: 0,
      embeddedDpi: 0,
      effectiveDpi: 0,
      sizingSource: null,
      measurementMode: null,
      widthIn: 0,
      heightIn: 0,
      quantity: parseInt(quantitySelect && quantitySelect.value || '1', 10) || 1,
      preferredVariantId: productData.selectedVariantId || null,
      selectedVariantId: productData.selectedVariantId || null,
      selectedResult: null,
      lastFile: null,
      customItems: [],
      activeCustomItemId: ''
    };
    var resolveRequestToken = 0;
    var uploadFlowToken = 0;
    var vipQuoteRequestToken = 0;
    var customerPricingRequestToken = 0;
    var customerPricingPromise = null;
    var customerPricing = {
      status: customerLoggedIn ? 'loading' : 'ready',
      customerType: customerLoggedIn ? 'unknown' : 'guest',
      statusKey: '',
      statusLabel: '',
      pricingMode: 'standard_variant',
      hasCustomPricing: false,
      pricePerInch: null,
      currency: 'USD',
      source: 'fallback',
      quoteStatus: 'idle',
      quoteTotal: null,
      quoteLengthIn: null,
      quoteVariantId: null,
      quoteVariantTitle: '',
      quoteSheetLabel: '',
      quoteSheetsNeeded: null,
      quoteDesignsPerSheet: null,
      quoteItems: [],
      totalRequestedQuantity: 0
    };
    var customerWorkspaceState = {
      status: 'idle',
      items: [],
      error: '',
      loadedKey: '',
      activeActionId: ''
    };
    var customBatchState = {
      active: false,
      total: 0,
      currentIndex: 0,
      completed: 0,
      fileName: '',
      stage: '',
      meta: '',
      progressRatio: 0
    };
    var customBatchHideTimer = null;

    function moneyFromCents(cents) {
      return '$' + ((Number(cents || 0) / 100).toFixed(2));
    }

    function formatMoneyValue(value, currency) {
      var amount = Number(value);
      if (!isFinite(amount)) amount = 0;
      try {
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: currency || 'USD',
        }).format(amount);
      } catch (error) {
        return '$' + amount.toFixed(2);
      }
    }

    function clearCustomBatchHideTimer() {
      if (customBatchHideTimer) {
        window.clearTimeout(customBatchHideTimer);
        customBatchHideTimer = null;
      }
    }

    function syncCustomBatchProgressUI() {
      if (!customBatchInline || !customBatchProgress) return;

      if (!customBatchState.active || !(customBatchState.total > 0)) {
        customBatchInline.classList.add('hidden');
        customBatchProgress.classList.add('hidden');
        if (customBatchBar) customBatchBar.style.width = '0%';
        return;
      }

      var safeTotal = Math.max(1, customBatchState.total);
      var safeCurrent = Math.max(1, Math.min(safeTotal, customBatchState.currentIndex || 1));
      var progressPercent = Math.max(0, Math.min(100, Math.round((customBatchState.progressRatio || 0) * 100)));

      customBatchInline.classList.remove('hidden');
      customBatchProgress.classList.remove('hidden');
      if (customBatchInlineCurrent) customBatchInlineCurrent.textContent = String(safeCurrent);
      if (customBatchInlineTotal) customBatchInlineTotal.textContent = String(safeTotal);
      if (customBatchStep) customBatchStep.textContent = 'File ' + safeCurrent + ' of ' + safeTotal;
      if (customBatchText) customBatchText.textContent = customBatchState.stage || 'Preparing upload queue...';
      if (customBatchMeta) customBatchMeta.textContent = customBatchState.meta || ('Completed ' + Math.max(0, customBatchState.completed) + ' of ' + safeTotal + ' uploads.');
      if (customBatchCountText) customBatchCountText.textContent = safeCurrent + '/' + safeTotal;
      if (customBatchBar) customBatchBar.style.width = progressPercent + '%';
    }

    function setCustomBatchProgress(patch) {
      clearCustomBatchHideTimer();
      customBatchState.active = patch && typeof patch.active === 'boolean' ? patch.active : customBatchState.active;
      if (patch && patch.total != null) customBatchState.total = Math.max(0, Number(patch.total) || 0);
      if (patch && patch.currentIndex != null) customBatchState.currentIndex = Math.max(0, Number(patch.currentIndex) || 0);
      if (patch && patch.completed != null) customBatchState.completed = Math.max(0, Number(patch.completed) || 0);
      if (patch && patch.fileName != null) customBatchState.fileName = String(patch.fileName || '');
      if (patch && patch.stage != null) customBatchState.stage = String(patch.stage || '');
      if (patch && patch.meta != null) customBatchState.meta = String(patch.meta || '');
      if (patch && patch.progressRatio != null) {
        customBatchState.progressRatio = Math.max(0, Math.min(1, Number(patch.progressRatio) || 0));
      }
      syncCustomBatchProgressUI();
    }

    function hideCustomBatchProgress() {
      clearCustomBatchHideTimer();
      customBatchState.active = false;
      customBatchState.total = 0;
      customBatchState.currentIndex = 0;
      customBatchState.completed = 0;
      customBatchState.fileName = '';
      customBatchState.stage = '';
      customBatchState.meta = '';
      customBatchState.progressRatio = 0;
      syncCustomBatchProgressUI();
    }

    function scheduleHideCustomBatchProgress(delayMs) {
      clearCustomBatchHideTimer();
      customBatchHideTimer = window.setTimeout(function() {
        hideCustomBatchProgress();
      }, delayMs || 1200);
    }

    function updateCustomBatchProgressForFile(batchMeta, stageText, fileProgress, metaText) {
      if (!batchMeta || !(batchMeta.total > 0)) return;

      var safeTotal = Math.max(1, Number(batchMeta.total) || 1);
      var safeIndex = Math.max(1, Math.min(safeTotal, Number(batchMeta.index) || 1));
      var safeFileProgress = Math.max(0, Math.min(1, Number(fileProgress) || 0));

      setCustomBatchProgress({
        active: true,
        total: safeTotal,
        currentIndex: safeIndex,
        completed: Math.max(0, safeIndex - 1),
        fileName: batchMeta.fileName || '',
        stage: stageText,
        meta: metaText || ('Processing ' + safeIndex + ' of ' + safeTotal + ' uploads.'),
        progressRatio: ((safeIndex - 1) + safeFileProgress) / safeTotal
      });
    }

    function updateCustomerStatusUI() {
      if (!customerStatusTitle || !customerStatusText) return;

      if (!customerLoggedIn) {
        customerStatusTitle.textContent = 'Unlock your account pricing';
        customerStatusText.textContent = 'Sign in to instantly load your assigned pricing profile, reorder access, and custom checkout privileges before you upload.';
        if (customerStatusBadge) {
          customerStatusBadge.textContent = '';
          customerStatusBadge.classList.add('hidden');
        }
        if (customerLoginLink) customerLoginLink.classList.remove('hidden');
        if (customerAccountLink) customerAccountLink.classList.add('hidden');
        return;
      }

      if (customerLoginLink) customerLoginLink.classList.add('hidden');
      if (customerAccountLink) customerAccountLink.classList.remove('hidden');

      if (customerPricing.status === 'loading') {
        customerStatusTitle.textContent = 'Checking pricing for ' + getCustomerDisplayName();
        customerStatusText.textContent = 'We are securely loading your assigned status, product rules, and customer-specific checkout pricing.';
        if (customerStatusBadge) {
          customerStatusBadge.textContent = '';
          customerStatusBadge.classList.add('hidden');
        }
        return;
      }

      var label = customerPricing.statusLabel || (customerPricing.customerType === 'business' ? 'Business' : customerPricing.customerType === 'vip' ? 'VIP' : 'Standard Customer');
      var customerName = getCustomerDisplayName();
      var badgeLabel = customerPricing.customerType === 'business'
        ? 'BUSINESS'
        : customerPricing.customerType === 'vip'
          ? label
          : 'STANDARD';

      if (customerPricing.hasCustomPricing && (customerPricing.customerType === 'business' || customerPricing.customerType === 'vip')) {
        var rateText = customerPricing.pricePerInch != null
          ? 'Active rate: ' + formatMoneyValue(customerPricing.pricePerInch, customerPricing.currency) + ' / in'
          : 'Rate is loading from the server.';
        if (customerPricing.customerType === 'business') {
          customerStatusTitle.textContent = 'Welcome back, ' + customerName + '. Your private pricing desk is ready.';
          customerStatusText.textContent = 'This page has been personalized for your ' + label + ' profile. Upload new artwork, revisit saved files, and check out with your assigned sheet-based pricing already applied. ' + rateText;
        } else {
          customerStatusTitle.textContent = 'Welcome back, ' + customerName + '. Your private pricing desk is ready.';
          customerStatusText.textContent = 'This page has been personalized for your ' + label + ' profile. Upload fresh artwork, reorder saved files, and place measured custom-priced orders with your assigned rate already applied. ' + rateText;
        }
      } else if (customerPricing.customerType === 'business' || customerPricing.customerType === 'vip') {
        customerStatusTitle.textContent = 'Welcome back, ' + customerName;
        customerStatusText.textContent = label + ' is assigned to this account, but this product is currently using standard variant pricing.';
      } else {
        customerStatusTitle.textContent = 'Welcome back, ' + customerName;
        customerStatusText.textContent = 'Your account is active with standard checkout pricing. Upload normally or log in with a custom-priced account to unlock assigned rates.';
      }

      if (customerStatusBadge) {
        customerStatusBadge.textContent = badgeLabel;
        customerStatusBadge.classList.remove('hidden');
      }
    }

    function clearCustomerLoginPopupWatcher() {
      if (customerLoginPollTimer) {
        window.clearInterval(customerLoginPollTimer);
        customerLoginPollTimer = null;
      }
    }

    function getCustomerLoginReturnPath() {
      return window.location.pathname + window.location.search + '#ul-main-customer-login-popup';
    }

    async function maybeReloadForLoggedInCustomer() {
      if (customerLoggedIn) return false;
      try {
        var response = await fetch(
          apiBase +
            '/api/vip/context?shopDomain=' +
            encodeURIComponent(shopDomain) +
            '&productId=' +
            encodeURIComponent(String(productData.productId)) +
            '&customerId=' +
            encodeURIComponent(themeCustomerId || '') +
            '&customerEmail=' +
            encodeURIComponent(themeCustomerEmail || ''),
          { credentials: 'same-origin' }
        );
        var data = await response.json().catch(function() { return {}; });
        if (response.ok && data && data.customerId) {
          window.location.reload();
          return true;
        }
      } catch (error) {}
      return false;
    }

    function openCustomerLoginPopup() {
      var loginUrl;
      var popupFeatures = 'popup=yes,width=460,height=720,resizable=yes,scrollbars=yes';
      try {
        var resolvedLoginUrl = new URL('/customer_authentication/login', window.location.origin);
        resolvedLoginUrl.searchParams.set('return_to', getCustomerLoginReturnPath());
        loginUrl = resolvedLoginUrl.toString();
      } catch (error) {
        loginUrl = '/customer_authentication/login?return_to=' + encodeURIComponent(getCustomerLoginReturnPath());
      }

      clearCustomerLoginPopupWatcher();
      customerLoginPopup = window.open('', 'ul-main-customer-login', popupFeatures);

      if (!customerLoginPopup) {
        window.location.href = loginUrl;
        return;
      }

      try {
        var popupDoc = customerLoginPopup.document;
        popupDoc.title = 'Opening login...';

        if (popupDoc.head) {
          var meta = popupDoc.createElement('meta');
          meta.setAttribute('charset', 'utf-8');
          popupDoc.head.appendChild(meta);

          var style = popupDoc.createElement('style');
          style.textContent =
            'html,body{height:100%;margin:0;font-family:Arial,sans-serif;background:#f8fafc;color:#111827;}' +
            'body{display:flex;align-items:center;justify-content:center;padding:24px;}' +
            '.card{max-width:320px;padding:24px 22px;border:1px solid #e5e7eb;border-radius:16px;background:#ffffff;box-shadow:0 10px 30px rgba(15,23,42,0.08);text-align:center;}' +
            '.spinner{width:28px;height:28px;margin:0 auto 16px;border:3px solid #fde68a;border-top-color:#f59e0b;border-radius:999px;animation:spin 0.8s linear infinite;}' +
            '.title{font-size:16px;font-weight:700;margin:0 0 8px;}' +
            '.text{font-size:13px;line-height:1.5;color:#4b5563;margin:0;}' +
            '@keyframes spin{to{transform:rotate(360deg);}}';
          popupDoc.head.appendChild(style);
        }

        if (popupDoc.body) {
          popupDoc.body.innerHTML = '';
          var card = popupDoc.createElement('div');
          card.className = 'card';

          var spinner = popupDoc.createElement('div');
          spinner.className = 'spinner';
          card.appendChild(spinner);

          var title = popupDoc.createElement('p');
          title.className = 'title';
          title.textContent = 'Opening customer login';
          card.appendChild(title);

          var text = popupDoc.createElement('p');
          text.className = 'text';
          text.textContent = 'Please wait while we securely redirect you to the Shopify login screen.';
          card.appendChild(text);

          popupDoc.body.appendChild(card);
        }
      } catch (error) {}

      try {
        customerLoginPopup.location.href = loginUrl;
      } catch (error) {
        try {
          customerLoginPopup.close();
        } catch (closeError) {}
        customerLoginPopup = null;
        window.location.href = loginUrl;
        return;
      }

      try {
        customerLoginPopup.focus();
      } catch (error) {}

      customerLoginPollTimer = window.setInterval(function() {
        if (!customerLoginPopup || customerLoginPopup.closed) {
          clearCustomerLoginPopupWatcher();
          customerLoginPopup = null;
          maybeReloadForLoggedInCustomer();
        }
      }, 800);
    }

    function handleCustomerLoginMessage(event) {
      if (!event || event.origin !== window.location.origin) return;
      if (!event.data || event.data.type !== 'ul-main-customer-login-success') return;

      clearCustomerLoginPopupWatcher();
      if (customerLoginPopup && !customerLoginPopup.closed) {
        try {
          customerLoginPopup.close();
        } catch (error) {}
      }
      customerLoginPopup = null;
      window.location.reload();
    }

    function parsePositiveNumber(value) {
      var parsed = Number(value);
      return isFinite(parsed) && parsed > 0 ? parsed : null;
    }

    function parseNonNegativeNumber(value) {
      var parsed = Number(value);
      return isFinite(parsed) && parsed >= 0 ? parsed : 0;
    }

    function getPayloadField(payload, key) {
      if (!payload) return null;
      if (payload[key] != null) return payload[key];
      if (payload.metadata && typeof payload.metadata === 'object' && payload.metadata[key] != null) {
        return payload.metadata[key];
      }
      return null;
    }

    function resetVipQuoteState() {
      customerPricing.quoteStatus = 'idle';
      customerPricing.quoteTotal = null;
      customerPricing.quoteLengthIn = null;
      customerPricing.quoteVariantId = null;
      customerPricing.quoteVariantTitle = '';
      customerPricing.quoteSheetLabel = '';
      customerPricing.quoteSheetsNeeded = null;
      customerPricing.quoteDesignsPerSheet = null;
      customerPricing.quoteItems = [];
      customerPricing.totalRequestedQuantity = 0;
    }

    function markCustomQueueQuoteDirty() {
      if (!hasCustomQueueItems()) {
        resetVipQuoteState();
        return;
      }
      syncCustomQueueQuoteSummary();
      if (!getCustomQueueReadyItems().length) {
        customerPricing.quoteStatus = 'loading';
      }
    }

    function getCustomQueueItems() {
      return Array.isArray(state.customItems) ? state.customItems : [];
    }

    function hasCustomQueueItems() {
      return getCustomQueueItems().length > 0;
    }

    function createCustomQueueItem(file) {
      return {
        id: 'tmp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        uploadId: '',
        fileName: file && file.name ? file.name : '',
        fileSize: file && file.size ? file.size : 0,
        localPreviewUrl: file && window.URL && window.URL.createObjectURL ? window.URL.createObjectURL(file) : '',
        originalUrl: '',
        thumbnailUrl: '',
        widthPx: 0,
        heightPx: 0,
        trimmedWidthPx: 0,
        trimmedHeightPx: 0,
        trimmedOffsetXPx: 0,
        trimmedOffsetYPx: 0,
        embeddedDpi: 0,
        effectiveDpi: 0,
        sizingSource: null,
        measurementMode: null,
        widthIn: 0,
        heightIn: 0,
        requestedQuantity: 1,
        selectedVariantId: '',
        selectedVariantTitle: '',
        selectedSheetLabel: '',
        sheetsNeeded: 0,
        designsPerSheet: 0,
        billableLengthIn: 0,
        totalPrice: null,
        uploadToken: '',
        quoteStatus: 'uploading',
        uploadStatus: 'uploading',
        quoteRequestKey: '',
        error: '',
        lastFile: file || null
      };
    }

    function revokeCustomItemPreviewUrl(item) {
      if (!item || !item.localPreviewUrl || !window.URL || !window.URL.revokeObjectURL) return;
      try {
        window.URL.revokeObjectURL(item.localPreviewUrl);
      } catch (error) {}
      item.localPreviewUrl = '';
    }

    function getCustomQueueItemById(itemId) {
      var items = getCustomQueueItems();
      for (var i = 0; i < items.length; i++) {
        if (String(items[i].id) === String(itemId) || String(items[i].uploadId) === String(itemId)) {
          return items[i];
        }
      }
      return null;
    }

    function setActiveCustomQueueItem(itemId) {
      var item = getCustomQueueItemById(itemId);
      if (!item) return;

      state.activeCustomItemId = item.uploadId || item.id;
      state.uploadId = item.uploadId || '';
      state.originalUrl = item.originalUrl || '';
      state.thumbnailUrl = item.thumbnailUrl || '';
      state.fileName = item.fileName || '';
      state.widthPx = item.widthPx || 0;
      state.heightPx = item.heightPx || 0;
      state.trimmedWidthPx = item.trimmedWidthPx || 0;
      state.trimmedHeightPx = item.trimmedHeightPx || 0;
      state.trimmedOffsetXPx = item.trimmedOffsetXPx || 0;
      state.trimmedOffsetYPx = item.trimmedOffsetYPx || 0;
      state.embeddedDpi = item.embeddedDpi || 0;
      state.effectiveDpi = item.effectiveDpi || 0;
      state.sizingSource = item.sizingSource || null;
      state.measurementMode = item.measurementMode || null;
      state.widthIn = item.widthIn || 0;
      state.heightIn = item.heightIn || 0;
      state.quantity = item.requestedQuantity || 1;
      state.selectedVariantId = item.selectedVariantId || '';
      state.selectedResult = item.selectedVariantId
        ? {
            selectedVariantId: item.selectedVariantId || '',
            selectedVariantTitle: item.selectedVariantTitle || '',
            selectedSheetLabel: item.selectedSheetLabel || '',
            sheetsNeeded: item.sheetsNeeded || 1,
            designsPerSheet: item.designsPerSheet || 0
          }
        : null;
    }

    function getActiveCustomQueueItem() {
      if (!hasCustomQueueItems()) return null;
      return getCustomQueueItemById(state.activeCustomItemId) || getCustomQueueItems()[0] || null;
    }

    function removeCustomQueueItem(itemId) {
      var nextItems = [];
      var removedCurrent = false;
      getCustomQueueItems().forEach(function(item) {
        if (String(item.id) === String(itemId) || String(item.uploadId) === String(itemId)) {
          revokeCustomItemPreviewUrl(item);
          if (String(state.activeCustomItemId) === String(item.uploadId || item.id)) {
            removedCurrent = true;
          }
          return;
        }
        nextItems.push(item);
      });
      state.customItems = nextItems;
      if (!state.customItems.length) {
        state.activeCustomItemId = '';
      } else if (removedCurrent || !getCustomQueueItemById(state.activeCustomItemId)) {
        setActiveCustomQueueItem(state.customItems[0].uploadId || state.customItems[0].id);
      }
    }

    function resetCustomQueue() {
      getCustomQueueItems().forEach(function(item) {
        revokeCustomItemPreviewUrl(item);
      });
      state.customItems = [];
      state.activeCustomItemId = '';
    }

    function getCustomQueueReadyItems() {
      return getCustomQueueItems().filter(function(item) {
        return item && item.uploadId && item.quoteStatus === 'ready' && !item.error;
      });
    }

    function getCustomQueueActionableItems() {
      return getCustomQueueItems().filter(function(item) {
        return item && item.uploadId && !item.error;
      });
    }

    function getCustomQueueQuotableItems() {
      return getCustomQueueActionableItems().filter(function(item) {
        return (
          item &&
          item.uploadId &&
          item.uploadStatus !== 'uploading' &&
          item.widthIn > 0 &&
          item.heightIn > 0
        );
      });
    }

    function getCustomQueueItemsAwaitingQuote() {
      return getCustomQueueQuotableItems().filter(function(item) {
        return item && item.quoteStatus !== 'ready';
      });
    }

    function customQueueHasErrors() {
      return getCustomQueueItems().some(function(item) {
        return item && item.error;
      });
    }

    function customQueueAllReady() {
      var items = getCustomQueueActionableItems();
      return items.length > 0 && items.every(function(item) {
        return item && item.uploadId && item.quoteStatus === 'ready' && !item.error;
      });
    }

    function syncCustomQueueQuoteSummary() {
      var readyItems = getCustomQueueReadyItems();
      var quotableItems = getCustomQueueQuotableItems();

      customerPricing.quoteItems = readyItems.map(function(item) {
        return {
          uploadId: item.uploadId,
          fileName: item.fileName || '',
          requestedQuantity: item.requestedQuantity || 1,
          billableLengthIn: item.billableLengthIn || 0,
          totalPrice: item.totalPrice,
          selectedVariantId: item.selectedVariantId || '',
          selectedVariantTitle: item.selectedVariantTitle || '',
          selectedSheetLabel: item.selectedSheetLabel || '',
          sheetsNeeded: item.sheetsNeeded || 0,
          designsPerSheet: item.designsPerSheet || 0,
          measurement: {
            dpi: item.embeddedDpi || 0,
            effectiveDpi: item.effectiveDpi || 0,
            sizingSource: item.sizingSource || null,
            widthIn: item.widthIn || 0,
            heightIn: item.heightIn || 0,
            measurementMode: item.measurementMode || null,
          },
        };
      });

      customerPricing.totalRequestedQuantity = readyItems.reduce(function(sum, item) {
        return sum + Math.max(1, Number(item.requestedQuantity) || 1);
      }, 0);

      customerPricing.quoteLengthIn = readyItems.length
        ? Number(
            readyItems.reduce(function(sum, item) {
              return sum + (Number(item.billableLengthIn) || 0);
            }, 0).toFixed(2)
          )
        : null;

      customerPricing.quoteTotal = readyItems.length
        ? Number(
            readyItems.reduce(function(sum, item) {
              return sum + (Number(item.totalPrice) || 0);
            }, 0).toFixed(2)
          )
        : null;

      if (readyItems.length) {
        var firstReady = readyItems[0];
        customerPricing.quoteVariantId = firstReady.selectedVariantId || null;
        customerPricing.quoteVariantTitle = firstReady.selectedVariantTitle || '';
        customerPricing.quoteSheetLabel = firstReady.selectedSheetLabel || '';
        customerPricing.quoteSheetsNeeded = readyItems.reduce(function(sum, item) {
          return sum + (parsePositiveNumber(item.sheetsNeeded) || 0);
        }, 0) || null;
        customerPricing.quoteDesignsPerSheet = parsePositiveNumber(firstReady.designsPerSheet) || null;
        customerPricing.quoteStatus = 'ready';
        return;
      }

      customerPricing.quoteVariantId = null;
      customerPricing.quoteVariantTitle = '';
      customerPricing.quoteSheetLabel = '';
      customerPricing.quoteSheetsNeeded = null;
      customerPricing.quoteDesignsPerSheet = null;
      customerPricing.quoteStatus = quotableItems.length ? 'loading' : (hasCustomQueueItems() ? 'loading' : 'idle');
    }

    function clearError() {
      if (!uploadError) return;
      uploadError.textContent = '';
      uploadError.classList.add('hidden');
    }

    function showError(message) {
      if (!uploadError) return;
      uploadError.textContent = message;
      uploadError.classList.remove('hidden');
    }

    function syncUploadInputMode() {
      if (!uploadInput) return;
      uploadInput.multiple = hasCustomPricingActive();
    }

    function renderCustomQueue() {
      if (!customQueueEl) return;

      if (!hasCustomPricingActive() || !hasCustomQueueItems()) {
        customQueueEl.innerHTML = '';
        customQueueEl.classList.add('hidden');
        return;
      }

      customQueueEl.classList.remove('hidden');

      var itemsHtml = getCustomQueueItems().map(function(item) {
        var previewSrc = item.thumbnailUrl || item.originalUrl || item.localPreviewUrl || '';
        var metaParts = [];
        if (item.widthPx && item.heightPx) metaParts.push(item.widthPx + ' x ' + item.heightPx + ' px');
        if (item.embeddedDpi) metaParts.push('File ' + item.embeddedDpi + ' DPI');
        if (item.widthIn && item.heightIn) {
          metaParts.push(formatInches(Math.min(item.widthIn, item.heightIn)) + ' x ' + formatInches(Math.max(item.widthIn, item.heightIn)));
        }
        var sizingMethodText = getSizingMethodText(item);
        var summaryText = '';
        if (item.selectedVariantTitle) {
          summaryText = item.selectedVariantTitle;
          if (item.sheetsNeeded) {
            summaryText += ' • ' + item.sheetsNeeded + ' sheet' + (item.sheetsNeeded === 1 ? '' : 's');
          }
        } else if (item.billableLengthIn) {
          summaryText = 'Billable length ' + formatInches(item.billableLengthIn);
        } else if (item.quoteStatus === 'processing' || item.quoteStatus === 'uploading' || item.quoteStatus === 'measuring') {
          summaryText = 'Processing file...';
        }

        var statusToneClass =
          item.error
            ? 'is-error'
            : item.quoteStatus === 'ready'
              ? 'is-ready'
              : 'is-pending';
        var statusLabel = item.error
          ? item.error
          : item.quoteStatus === 'ready'
            ? 'Quote ready'
            : 'Processing upload';
        var itemTotalText = item.totalPrice != null
          ? formatMoneyValue(item.totalPrice, customerPricing.currency)
          : 'Pending';
        var itemId = item.uploadId || item.id;
        var isActive = String(state.activeCustomItemId) === String(itemId);

        return '' +
          '<div class="ul-main-custom-queue-item' + (isActive ? ' is-active' : '') + ' rounded-2xl border bg-white p-4 shadow-sm" data-queue-item-id="' + itemId + '" data-queue-activate="' + itemId + '">' +
            '<div class="ul-main-custom-queue-row flex items-start gap-3">' +
              '<div class="ul-main-custom-thumb h-16 w-16 flex-shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">' +
                (previewSrc
                  ? '<img src="' + previewSrc + '" alt="' + (item.fileName || 'Upload preview').replace(/"/g, '&quot;') + '" class="h-full w-full object-cover">'
                  : '<div class="flex h-full w-full items-center justify-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">PNG</div>') +
              '</div>' +
              '<div class="ul-main-custom-body min-w-0 flex-1">' +
                '<div class="ul-main-custom-head flex flex-wrap items-start justify-between gap-3">' +
                  '<div class="ul-main-custom-main min-w-0 flex-1">' +
                    '<button type="button" class="ul-main-custom-queue-activate ul-main-custom-title block max-w-full truncate text-left text-sm font-semibold text-slate-900 hover:text-slate-700" data-queue-activate="' + itemId + '">' + (item.fileName || 'Uploaded file') + '</button>' +
                    '<div class="ul-main-custom-meta mt-1 text-xs text-slate-500">' + (metaParts.join(' • ') || 'Waiting for file measurement...') + '</div>' +
                    '<div class="ul-main-custom-summary mt-2 text-xs font-medium text-slate-700">' + (summaryText || '&nbsp;') + '</div>' +
                    '<div class="ul-main-custom-sizing mt-2 text-[11px] font-medium text-slate-500">' + sizingMethodText + '</div>' +
                  '</div>' +
                  '<div class="ul-main-custom-price text-right">' +
                    '<div class="text-xs uppercase tracking-wide text-slate-400">Item total</div>' +
                    '<div class="mt-1 text-sm font-semibold text-slate-900">' + itemTotalText + '</div>' +
                  '</div>' +
                '</div>' +
                '<div class="ul-main-custom-controls mt-3 flex flex-wrap items-center justify-between gap-3">' +
                  '<div class="ul-main-custom-qty inline-flex items-center rounded-full border border-slate-200 bg-slate-50 p-1">' +
                    '<button type="button" class="ul-main-custom-qty-btn inline-flex h-8 w-8 items-center justify-center rounded-full text-base font-semibold text-slate-700 hover:bg-white" data-queue-qty="' + itemId + '" data-delta="-1">−</button>' +
                    '<input type="number" min="1" step="1" value="' + (item.requestedQuantity || 1) + '" class="ul-main-custom-qty-input w-16 border-0 bg-transparent text-center text-sm font-semibold text-slate-900 focus:outline-none focus:ring-0" data-queue-qty-input="' + itemId + '">' +
                    '<button type="button" class="ul-main-custom-qty-btn inline-flex h-8 w-8 items-center justify-center rounded-full text-base font-semibold text-slate-700 hover:bg-white" data-queue-qty="' + itemId + '" data-delta="1">+</button>' +
                  '</div>' +
                  '<div class="flex flex-wrap items-center gap-2">' +
                    '<span class="ul-main-custom-status inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold ' + statusToneClass + '">' + statusLabel + '</span>' +
                    '<button type="button" class="ul-main-custom-remove inline-flex items-center rounded-full border border-red-200 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-50" data-queue-remove="' + itemId + '">Remove</button>' +
                  '</div>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>';
      }).join('');

      var totalFiles = getCustomQueueItems().length;
      var totalCopies = getCustomQueueItems().reduce(function(sum, item) {
        return sum + Math.max(1, Number(item.requestedQuantity) || 1);
      }, 0);

      customQueueEl.innerHTML =
        '<div class="ul-main-custom-queue-header mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-950 px-4 py-3 text-white">' +
          '<div>' +
            '<div class="text-sm font-semibold">Custom pricing upload queue</div>' +
            '<div class="mt-1 text-xs text-slate-300">Each uploaded design keeps its own quantity and quote.</div>' +
          '</div>' +
          '<div class="ul-main-custom-queue-header-pills flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-200">' +
            '<span class="ul-main-custom-queue-header-pill rounded-full bg-white/10 px-3 py-1">' + totalFiles + ' file' + (totalFiles === 1 ? '' : 's') + '</span>' +
            '<span class="ul-main-custom-queue-header-pill rounded-full bg-white/10 px-3 py-1">' + totalCopies + ' total copies</span>' +
          '</div>' +
        '</div>' +
        '<div class="ul-main-custom-queue-list space-y-3">' + itemsHtml + '</div>';
    }

    function resetSelectionUI() {
      variantRows.forEach(function(row) {
        row.classList.remove('bg-green-100', 'ring-2', 'ring-green-500');
      });
    }

    function getFallbackVariantId() {
      return state.preferredVariantId || productData.selectedVariantId || null;
    }

    function resetActionLabels() {
      if (hasCustomPricingActive()) {
        var customLabel = isBusinessPricingActive() ? 'Create Business Checkout' : 'Create VIP Checkout';
        if (addToCartBtn) addToCartBtn.textContent = customLabel;
        if (buyNowBtn) buyNowBtn.textContent = customLabel;
        if (inlinePricingButton) inlinePricingButton.textContent = customLabel;
        return;
      }
      if (addToCartBtn) addToCartBtn.textContent = addToCartLabel;
      if (buyNowBtn) buyNowBtn.textContent = buyNowLabel;
      if (inlinePricingButton) inlinePricingButton.textContent = 'Create Custom Checkout';
    }

    function setPurchaseButtonsDisabled(disabled) {
      [addToCartBtn, buyNowBtn, inlinePricingButton].forEach(function(button) {
        if (!button) return;
        button.disabled = disabled;
        button.setAttribute('aria-disabled', disabled ? 'true' : 'false');
        button.classList.toggle('opacity-50', disabled);
        button.classList.toggle('cursor-not-allowed', disabled);
        button.classList.toggle('pointer-events-none', disabled);
      });
    }

    function hasCustomPricingActive() {
      return customerPricing.status === 'ready' && customerPricing.hasCustomPricing === true;
    }

    function isBusinessPricingActive() {
      return hasCustomPricingActive() && customerPricing.customerType === 'business';
    }

    function isVipPricingActive() {
      return hasCustomPricingActive() && customerPricing.customerType === 'vip';
    }

    function isCustomerPricingLoading() {
      return customerLoggedIn && customerPricing.status === 'loading';
    }

    function getBillablePageLengthIn() {
      if (!(state.widthIn > 0) || !(state.heightIn > 0)) return null;
      return Math.max(state.widthIn, state.heightIn);
    }

    function getBillablePageWidthIn() {
      if (!(state.widthIn > 0) || !(state.heightIn > 0)) return null;
      return Math.min(state.widthIn, state.heightIn);
    }

    function formatInches(value) {
      var amount = Number(value || 0);
      if (!isFinite(amount)) amount = 0;
      return amount.toFixed(2) + '"';
    }

    function formatRulerLabel(value) {
      var amount = Number(value || 0);
      if (!isFinite(amount)) amount = 0;
      return Math.abs(amount - Math.round(amount)) < 0.01 ? String(Math.round(amount)) : amount.toFixed(1);
    }

    function clearNode(node) {
      if (!node) return;
      while (node.firstChild) {
        node.removeChild(node.firstChild);
      }
    }

    function escapeHtml(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function getCustomerDisplayName() {
      var first = String(customerFirstName || '').trim();
      var last = String(customerLastName || '').trim();
      if (first) return first;
      if (last) return last;
      var email = root.getAttribute('data-customer-email') || '';
      if (email && email.indexOf('@') > 0) return email.split('@')[0];
      return 'there';
    }

    function shouldShowCustomerWorkspace() {
      return hasCustomPricingActive() && (customerPricing.customerType === 'business' || customerPricing.customerType === 'vip');
    }

    function getCustomerWorkspaceKey() {
      return [
        customerPricing.customerType || '',
        customerPricing.statusKey || '',
        String(productData.productId || ''),
        root.getAttribute('data-customer-id') || ''
      ].join(':');
    }

    function getCustomerWorkspaceItems() {
      return Array.isArray(customerWorkspaceState.items) ? customerWorkspaceState.items : [];
    }

    function getWorkspaceItemById(itemId) {
      var items = getCustomerWorkspaceItems();
      for (var i = 0; i < items.length; i += 1) {
        if (String(items[i].uploadId) === String(itemId)) return items[i];
      }
      return null;
    }

    function formatWorkspaceDate(value) {
      if (!value) return 'Recent order';
      try {
        return new Intl.DateTimeFormat('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        }).format(new Date(value));
      } catch (error) {
        return 'Recent order';
      }
    }

    function buildCustomerWorkspaceQueueItem(item) {
      var measurement = item && item.measurement && typeof item.measurement === 'object' ? item.measurement : {};
      return {
        id: 'workspace-' + String(item.uploadId || ''),
        uploadId: String(item.uploadId || ''),
        fileName: item.fileName || 'Print-ready upload',
        fileSize: 0,
        localPreviewUrl: '',
        originalUrl: item.uploadUrl || '',
        thumbnailUrl: item.thumbnailUrl || '',
        widthPx: parseNonNegativeNumber(measurement.widthPx),
        heightPx: parseNonNegativeNumber(measurement.heightPx),
        trimmedWidthPx: parseNonNegativeNumber(measurement.trimmedWidthPx),
        trimmedHeightPx: parseNonNegativeNumber(measurement.trimmedHeightPx),
        trimmedOffsetXPx: parseNonNegativeNumber(measurement.trimmedOffsetXPx),
        trimmedOffsetYPx: parseNonNegativeNumber(measurement.trimmedOffsetYPx),
        embeddedDpi: parseNonNegativeNumber(measurement.dpi),
        effectiveDpi: parseNonNegativeNumber(measurement.effectiveDpi),
        sizingSource: measurement.sizingSource || null,
        measurementMode: measurement.measurementMode || 'full',
        widthIn: parsePositiveNumber(measurement.widthIn) || 0,
        heightIn: parsePositiveNumber(measurement.heightIn) || 0,
        requestedQuantity: Math.max(1, parseInt(item.requestedQuantity || item.lastOrderedQuantity || 1, 10) || 1),
        selectedVariantId: item.selectedVariantId || '',
        selectedVariantTitle: item.selectedVariantTitle || '',
        selectedSheetLabel: item.selectedSheetLabel || '',
        sheetsNeeded: 0,
        designsPerSheet: 0,
        billableLengthIn: parsePositiveNumber(item.billableLengthIn) || 0,
        totalPrice: null,
        uploadToken: '',
        quoteStatus: 'processing',
        uploadStatus: 'ready',
        quoteRequestKey: '',
        error: '',
        lastFile: null
      };
    }

    function ensureWorkspaceItemInQueue(workspaceItem) {
      if (!workspaceItem) return null;
      var existing = getCustomQueueItemById(workspaceItem.uploadId);
      if (existing) {
        existing.requestedQuantity = Math.max(1, parseInt(workspaceItem.requestedQuantity || 1, 10) || 1);
        existing.selectedVariantId = workspaceItem.selectedVariantId || existing.selectedVariantId || '';
        existing.selectedVariantTitle = workspaceItem.selectedVariantTitle || existing.selectedVariantTitle || '';
        existing.selectedSheetLabel = workspaceItem.selectedSheetLabel || existing.selectedSheetLabel || '';
        existing.quoteStatus = existing.uploadStatus === 'ready' ? 'processing' : existing.quoteStatus;
        return existing;
      }

      var queueItem = buildCustomerWorkspaceQueueItem(workspaceItem);
      state.customItems = getCustomQueueItems().concat(queueItem);
      return queueItem;
    }

    function getWorkspaceActionLabel(item) {
      var quantity = Math.max(1, parseInt(item.requestedQuantity || item.lastOrderedQuantity || 1, 10) || 1);
      return quantity + ' cop' + (quantity === 1 ? 'y' : 'ies');
    }

    function renderCustomerWorkspace() {
      if (!customerWorkspace || !galleryPanel || !customerWorkspaceList) return;

      if (!shouldShowCustomerWorkspace()) {
        customerWorkspace.classList.add('hidden');
        galleryPanel.classList.remove('hidden');
        return;
      }

      customerWorkspace.classList.remove('hidden');
      galleryPanel.classList.add('hidden');

      var displayName = getCustomerDisplayName();
      var workspaceStatusLabel = customerPricing.statusLabel || (customerPricing.customerType === 'business' ? 'Business' : 'VIP');
      if (customerWorkspaceStatus) {
        customerWorkspaceStatus.textContent = workspaceStatusLabel;
        customerWorkspaceStatus.classList.remove('hidden');
      }

      if (customerWorkspaceTitle) {
        customerWorkspaceTitle.textContent = 'Hello ' + displayName + ', your private pricing studio is ready.';
      }

      if (customerWorkspaceCopy) {
        customerWorkspaceCopy.textContent =
          'This reorder studio has been tailored to your ' +
          workspaceStatusLabel +
          ' pricing profile. Every quick action below keeps your assigned pricing, saved print-ready artwork, and preferred reorder flow perfectly in sync so you can move from upload to checkout faster.';
      }

      if (customerWorkspaceMeta) {
        var metaChips = [];
        if (customerPricing.pricePerInch != null) {
          metaChips.push('<span class="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white">' + escapeHtml(formatMoneyValue(customerPricing.pricePerInch, customerPricing.currency) + ' / in') + '</span>');
        }
        metaChips.push('<span class="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white">' + escapeHtml(customerPricing.customerType === 'business' ? 'Business reorder flow' : 'VIP reorder flow') + '</span>');
        metaChips.push('<span class="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white">' + escapeHtml(String(getCustomerWorkspaceItems().length)) + ' saved files</span>');
        customerWorkspaceMeta.innerHTML = metaChips.join('');
      }

      var items = getCustomerWorkspaceItems();
      if (customerWorkspaceCount) {
        customerWorkspaceCount.textContent = items.length + ' file' + (items.length === 1 ? '' : 's');
      }

      if (customerWorkspaceState.status === 'loading') {
        customerWorkspaceList.innerHTML =
          '<div class="space-y-3">' +
            '<div class="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">' +
              '<div class="h-4 w-32 animate-pulse bg-slate-200"></div>' +
              '<div class="mt-3 h-20 animate-pulse bg-slate-100"></div>' +
            '</div>' +
            '<div class="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">' +
              '<div class="h-4 w-40 animate-pulse bg-slate-200"></div>' +
              '<div class="mt-3 h-20 animate-pulse bg-slate-100"></div>' +
            '</div>' +
          '</div>';
        return;
      }

      if (customerWorkspaceState.status === 'error') {
        customerWorkspaceList.innerHTML =
          '<div class="rounded-[24px] border border-red-200 bg-red-50 px-4 py-5 text-sm text-red-700">' +
            escapeHtml(customerWorkspaceState.error || 'We could not load your saved uploads right now.') +
          '</div>';
        return;
      }

      if (!items.length) {
        customerWorkspaceList.innerHTML =
          '<div class="rounded-[24px] border border-dashed border-slate-300 bg-white px-5 py-10 text-center">' +
            '<div class="text-sm font-semibold text-slate-900">Your saved print-ready uploads will appear here.</div>' +
            '<div class="mt-2 text-xs leading-6 text-slate-500">Once you complete a paid order on this product, your most recent uploads, last ordered quantity, and quick reorder actions will be ready in this panel.</div>' +
          '</div>';
        return;
      }

      var workspaceHtml = items.map(function(item) {
        var previewSrc = item.thumbnailUrl || '';
        var quantity = Math.max(1, parseInt(item.requestedQuantity || item.lastOrderedQuantity || 1, 10) || 1);
        var actionBusy = String(customerWorkspaceState.activeActionId) === String(item.uploadId);
        var sizeText = '';
        if (item.measurement && item.measurement.widthIn && item.measurement.heightIn) {
          sizeText = formatInches(Math.min(item.measurement.widthIn, item.measurement.heightIn)) + ' x ' + formatInches(Math.max(item.measurement.widthIn, item.measurement.heightIn));
        }
        var billableText = item.billableLengthIn ? 'Billable length ' + formatInches(item.billableLengthIn) : '';
        return '' +
          '<div class="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm transition-shadow duration-200 hover:shadow-md" data-workspace-item="' + escapeHtml(item.uploadId) + '">' +
            '<div class="flex items-start gap-4">' +
              '<div class="h-20 w-20 flex-shrink-0 overflow-hidden rounded-[20px] border border-slate-200 bg-slate-100">' +
                (previewSrc
                  ? '<img src="' + escapeHtml(previewSrc) + '" alt="' + escapeHtml(item.fileName || 'Recent upload') + '" class="h-full w-full object-cover">'
                  : '<div class="flex h-full w-full items-center justify-center text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">PNG</div>') +
              '</div>' +
              '<div class="min-w-0 flex-1">' +
                '<div class="flex flex-wrap items-start justify-between gap-3">' +
                  '<div class="min-w-0 flex-1">' +
                    '<div class="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700">' + escapeHtml(item.productTitle || 'Custom Upload') + '</div>' +
                    '<div class="mt-3 truncate text-sm font-semibold text-slate-900">' + escapeHtml(item.fileName || 'Print-ready upload') + '</div>' +
                    '<div class="mt-2 flex flex-wrap gap-2 text-[11px] font-medium text-slate-500">' +
                      '<span class="rounded-full border border-slate-200 bg-white px-3 py-1">Last order ' + escapeHtml(formatWorkspaceDate(item.orderedAt)) + '</span>' +
                      '<span class="rounded-full border border-slate-200 bg-white px-3 py-1">Last qty ' + escapeHtml(String(item.lastOrderedQuantity || quantity)) + '</span>' +
                      (sizeText ? '<span class="rounded-full border border-slate-200 bg-white px-3 py-1">' + escapeHtml(sizeText) + '</span>' : '') +
                      (billableText ? '<span class="rounded-full border border-slate-200 bg-white px-3 py-1">' + escapeHtml(billableText) + '</span>' : '') +
                    '</div>' +
                  '</div>' +
                  '<div class="text-right">' +
                    '<div class="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Quick reorder</div>' +
                    '<div class="mt-2 text-xs font-medium text-slate-600">' + escapeHtml(getWorkspaceActionLabel(item)) + '</div>' +
                  '</div>' +
                '</div>' +
                '<div class="mt-4 flex flex-wrap items-center gap-2">' +
                  '<a href="' + escapeHtml(item.uploadUrl || '#') + '" target="_blank" rel="noopener noreferrer" class="inline-flex items-center rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"' + (item.uploadUrl ? '' : ' aria-disabled="true" tabindex="-1"') + '>Print READY</a>' +
                  '<div class="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 p-1">' +
                    '<button type="button" class="inline-flex h-8 w-8 items-center justify-center rounded-full text-base font-semibold text-slate-700 hover:bg-white" data-workspace-qty="' + escapeHtml(item.uploadId) + '" data-delta="-1">-</button>' +
                    '<input type="number" min="1" step="1" value="' + quantity + '" class="w-14 border-0 bg-transparent text-center text-sm font-semibold text-slate-900 focus:outline-none focus:ring-0" data-workspace-qty-input="' + escapeHtml(item.uploadId) + '">' +
                    '<button type="button" class="inline-flex h-8 w-8 items-center justify-center rounded-full text-base font-semibold text-slate-700 hover:bg-white" data-workspace-qty="' + escapeHtml(item.uploadId) + '" data-delta="1">+</button>' +
                  '</div>' +
                  '<button type="button" class="inline-flex items-center rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition-colors duration-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60" data-workspace-add="' + escapeHtml(item.uploadId) + '"' + (actionBusy ? ' disabled' : '') + '>' + (actionBusy ? 'Working...' : 'Add to Cart') + '</button>' +
                  '<button type="button" class="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-900 transition-colors duration-200 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60" data-workspace-buy="' + escapeHtml(item.uploadId) + '"' + (actionBusy ? ' disabled' : '') + '>Buy Now</button>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>';
      }).join('');

      customerWorkspaceList.innerHTML = '<div class="space-y-3">' + workspaceHtml + '</div>';
    }

    function hasArtworkBounds() {
      return state.trimmedWidthPx > 0 && state.trimmedHeightPx > 0;
    }

    function hasSeparateArtworkBounds() {
      if (!hasArtworkBounds() || !(state.widthPx > 0) || !(state.heightPx > 0)) return false;
      return (
        state.trimmedWidthPx < state.widthPx ||
        state.trimmedHeightPx < state.heightPx ||
        state.trimmedOffsetXPx > 0 ||
        state.trimmedOffsetYPx > 0
      );
    }

    function getArtworkBoundsInches() {
      if (!hasArtworkBounds()) return null;
      var dpi = state.effectiveDpi > 0 ? state.effectiveDpi : 200;
      return {
        widthIn: Number((state.trimmedWidthPx / dpi).toFixed(2)),
        heightIn: Number((state.trimmedHeightPx / dpi).toFixed(2)),
        offsetXIn: Number((state.trimmedOffsetXPx / dpi).toFixed(2)),
        offsetYIn: Number((state.trimmedOffsetYPx / dpi).toFixed(2))
      };
    }

    function chooseRulerStep(totalIn, axis) {
      if (axis === 'x') {
        if (totalIn <= 24) return 2;
        if (totalIn <= 48) return 4;
        return 6;
      }

      if (totalIn <= 48) return 4;
      if (totalIn <= 96) return 8;
      if (totalIn <= 180) return 12;
      return 24;
    }

    function buildRulerMarks(track, totalIn, scale, axis, padding) {
      if (!track) return;
      clearNode(track);

      if (!(totalIn > 0) || !(scale > 0)) {
        if (axis === 'x') track.style.width = '0px';
        else track.style.height = '0px';
        return;
      }

      var offset = Math.max(0, Number(padding) || 0);
      var trackSize = Math.max(1, Math.round((totalIn * scale) + (offset * 2)));
      if (axis === 'x') track.style.width = trackSize + 'px';
      else track.style.height = trackSize + 'px';

      var majorStep = chooseRulerStep(totalIn, axis);
      var minorStep = Math.max(1, majorStep / 2);
      var value = 0;
      while (value <= totalIn + 0.001) {
        var isMajor =
          value === 0 ||
          Math.abs((value / majorStep) - Math.round(value / majorStep)) < 0.001 ||
          Math.abs(value - totalIn) < 0.001;
        var mark = document.createElement('div');
        mark.className = 'ul-main-vip-preview-tick' + (isMajor ? ' is-major' : '');
        var isFirst = value === 0;
        var isLast = Math.abs(value - totalIn) < 0.001;
        var position = Math.round(offset + Math.min(totalIn, value) * scale);
        if (axis === 'x') {
          mark.style.left = position + 'px';
        } else {
          mark.style.top = position + 'px';
        }
        track.appendChild(mark);

        if (isMajor) {
          var label = document.createElement('span');
          label.className = 'ul-main-vip-preview-tick-label';
          label.textContent = formatRulerLabel(value);
          if (axis === 'x') {
            label.style.left = position + 'px';
            label.style.transform = isFirst ? 'translateX(0)' : (isLast ? 'translateX(-100%)' : 'translateX(-50%)');
          } else {
            label.style.top = position + 'px';
            label.style.transform = isFirst ? 'translateY(0)' : (isLast ? 'translateY(-100%)' : 'translateY(-50%)');
          }
          track.appendChild(label);
        }

        value = Number((value + minorStep).toFixed(2));
      }
    }

    function getPreviewBoardMetrics(stageWrap, boardData) {
      var widthIn = Math.max(Number(boardData && boardData.billableWidthIn) || 0, 0.25);
      var lengthIn = Math.max(Number(boardData && boardData.billableLengthIn) || 0, 0.25);
      var availableWidth = stageWrap && stageWrap.clientWidth
        ? Math.max(180, stageWrap.clientWidth - 2)
        : 250;
      var scale = Math.max(12, Math.min(96, availableWidth / widthIn));

      return {
        scale: scale,
        stageWidth: Math.max(1, Math.round(widthIn * scale)),
        stageHeight: Math.max(1, Math.round(lengthIn * scale))
      };
    }

    function buildPreviewBoardDataFromItem(item) {
      if (!item || !(item.widthIn > 0) || !(item.heightIn > 0)) return null;

      var billableWidthIn = Math.min(item.widthIn, item.heightIn);
      var billableLengthIn = Math.max(item.widthIn, item.heightIn);
      var imageSrc = item.thumbnailUrl || item.originalUrl || item.localPreviewUrl || '';
      var hasArtwork =
        item.trimmedWidthPx > 0 &&
        item.trimmedHeightPx > 0 &&
        item.widthPx > 0 &&
        item.heightPx > 0 &&
        (
          item.trimmedWidthPx < item.widthPx ||
          item.trimmedHeightPx < item.heightPx ||
          item.trimmedOffsetXPx > 0 ||
          item.trimmedOffsetYPx > 0
        );
      var artworkBounds = null;
      if (hasArtwork) {
        var dpi = item.effectiveDpi > 0 ? item.effectiveDpi : 200;
        artworkBounds = {
          widthIn: Number((item.trimmedWidthPx / dpi).toFixed(2)),
          heightIn: Number((item.trimmedHeightPx / dpi).toFixed(2)),
          offsetXIn: Number((item.trimmedOffsetXPx / dpi).toFixed(2)),
          offsetYIn: Number((item.trimmedOffsetYPx / dpi).toFixed(2))
        };
      }

      return {
        id: item.uploadId || item.id,
        fileName: item.fileName || 'Uploaded file',
        imageSrc: imageSrc,
        billableWidthIn: billableWidthIn,
        billableLengthIn: billableLengthIn,
        artworkBounds: artworkBounds,
        requestedQuantity: item.requestedQuantity || 1,
        totalPrice: item.totalPrice,
        selectedVariantTitle: item.selectedVariantTitle || '',
        statusLabel: item.selectedVariantTitle
          ? item.selectedVariantTitle + (item.sheetsNeeded ? ' • ' + item.sheetsNeeded + ' sheet' + (item.sheetsNeeded === 1 ? '' : 's') : '')
          : 'Measured full page',
      };
    }

    function renderPreviewBoardShell(item) {
      var itemId = item.id;
      var wrapper = document.createElement('div');
      wrapper.className = 'ul-main-vip-preview-board rounded-[24px] border border-slate-200 bg-white/95 p-4 shadow-sm';
      wrapper.setAttribute('data-preview-board', itemId);
      wrapper.innerHTML =
        '<div class="ul-main-vip-preview-board-top mb-3 flex flex-wrap items-start justify-between gap-3">' +
          '<div class="min-w-0 flex-1">' +
            '<button type="button" class="ul-main-vip-preview-focus ul-main-vip-preview-board-title block max-w-full truncate text-left text-sm font-semibold text-slate-900 hover:text-slate-700" data-preview-focus="' + itemId + '">' + item.fileName + '</button>' +
            '<div class="ul-main-vip-preview-board-meta mt-1 text-xs text-slate-500">' + item.statusLabel + '</div>' +
          '</div>' +
          '<div class="ul-main-vip-preview-board-pills flex flex-wrap items-center gap-2">' +
            '<span class="ul-main-vip-preview-mini-chip">Qty ' + item.requestedQuantity + '</span>' +
            '<span class="ul-main-vip-preview-mini-chip">' + formatInches(item.billableWidthIn) + ' × ' + formatInches(item.billableLengthIn) + '</span>' +
            '<span class="ul-main-vip-preview-mini-chip">' + (item.totalPrice != null ? formatMoneyValue(item.totalPrice, customerPricing.currency) : 'Pending') + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="ul-main-vip-preview-ruler-shell">' +
          '<div class="ul-main-vip-preview-corner"></div>' +
          '<div class="ul-main-vip-preview-top-ruler"><div class="ul-main-vip-preview-top-track"></div></div>' +
          '<div class="ul-main-vip-preview-left-ruler"><div class="ul-main-vip-preview-left-track"></div></div>' +
          '<div class="ul-main-vip-preview-stage-wrap">' +
            '<div class="ul-main-vip-preview-stage-rail">' +
              '<div class="ul-main-vip-preview-stage">' +
                '<img class="ul-main-vip-preview-image hidden" alt="' + item.fileName.replace(/"/g, '&quot;') + '">' +
                '<div class="ul-main-vip-preview-artwork hidden"></div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="mt-3 text-[11px] leading-5 text-slate-500">' +
          (item.artworkBounds
            ? 'Solid frame is the billed full page. Dashed overlay marks artwork bounds for reference only.'
            : 'Solid frame is the billed full page. No separate artwork bounds were detected.') +
        '</div>';
      return wrapper;
    }

    function renderPreviewBoard(wrapper, boardData) {
      if (!wrapper || !boardData) return;

      var topTrack = wrapper.querySelector('.ul-main-vip-preview-top-track');
      var leftTrack = wrapper.querySelector('.ul-main-vip-preview-left-track');
      var stageWrap = wrapper.querySelector('.ul-main-vip-preview-stage-wrap');
      var stageRail = wrapper.querySelector('.ul-main-vip-preview-stage-rail');
      var stage = wrapper.querySelector('.ul-main-vip-preview-stage');
      var image = wrapper.querySelector('.ul-main-vip-preview-image');
      var artwork = wrapper.querySelector('.ul-main-vip-preview-artwork');

      var metrics = getPreviewBoardMetrics(stageWrap, boardData);
      var scale = metrics.scale;
      var stageWidth = metrics.stageWidth;
      var stageHeight = metrics.stageHeight;

      if (stageRail) {
        stageRail.style.width = stageWidth + 'px';
        stageRail.style.height = stageHeight + 'px';
      }
      if (stage) {
        stage.style.width = stageWidth + 'px';
        stage.style.height = stageHeight + 'px';
      }

      if (image && boardData.imageSrc) {
        image.src = boardData.imageSrc;
        image.classList.remove('hidden');
      }

      if (boardData.artworkBounds && artwork) {
        artwork.classList.remove('hidden');
        artwork.style.left = Math.max(0, Math.round(boardData.artworkBounds.offsetXIn * scale)) + 'px';
        artwork.style.top = Math.max(0, Math.round(boardData.artworkBounds.offsetYIn * scale)) + 'px';
        artwork.style.width = Math.max(10, Math.round(boardData.artworkBounds.widthIn * scale)) + 'px';
        artwork.style.height = Math.max(10, Math.round(boardData.artworkBounds.heightIn * scale)) + 'px';
      } else if (artwork) {
        artwork.classList.add('hidden');
        artwork.removeAttribute('style');
      }

      buildRulerMarks(topTrack, boardData.billableWidthIn, scale, 'x', 0);
      buildRulerMarks(leftTrack, boardData.billableLengthIn, scale, 'y', 0);

      function syncBoardRulers() {
        if (topTrack) topTrack.style.transform = 'translateX(' + (-stageWrap.scrollLeft) + 'px)';
        if (leftTrack) leftTrack.style.transform = 'translateY(' + (-stageWrap.scrollTop) + 'px)';
      }

      stageWrap.removeEventListener('scroll', syncBoardRulers);
      stageWrap.addEventListener('scroll', syncBoardRulers);
      syncBoardRulers();
    }

    function setVipPreviewEmptyState(titleText, bodyText) {
      if (vipPreviewEmptyTitle) vipPreviewEmptyTitle.textContent = titleText || 'Full-page quote preview';
      if (vipPreviewEmptyBody) vipPreviewEmptyBody.textContent = bodyText || '';
    }

    function renderVipPreviewSelector(items, activeItemId) {
      if (!vipPreviewSelector || !vipPreviewSelect) return;
      if (!items.length || items.length === 1) {
        vipPreviewSelector.classList.add('hidden');
        vipPreviewSelect.innerHTML = '';
        return;
      }

      vipPreviewSelector.classList.remove('hidden');
      vipPreviewSelect.innerHTML = items.map(function(item, index) {
        var itemId = item.uploadId || item.id;
        var ready = item.quoteStatus === 'ready' && !item.error;
        var statusLabel = item.error ? 'Issue' : ready ? 'Ready' : 'Processing';
        var optionLabel = (index + 1) + '. ' + (item.fileName || 'Uploaded file') + ' • Qty ' + (item.requestedQuantity || 1) + ' • ' + statusLabel;
        return '<option value="' + itemId + '"' + (String(activeItemId) === String(itemId) ? ' selected' : '') + '>' + optionLabel.replace(/"/g, '&quot;') + '</option>';
      }).join('');
    }

    function updateVipPreviewActivePanel(item, boardData, queueCount) {
      if (!vipPreviewActive) return;
      if (!item) {
        vipPreviewActive.classList.add('hidden');
        if (vipPreviewActiveTitle) vipPreviewActiveTitle.textContent = '';
        if (vipPreviewActiveMeta) vipPreviewActiveMeta.textContent = '';
        if (vipPreviewActiveNote) {
          vipPreviewActiveNote.textContent = '';
          vipPreviewActiveNote.classList.add('hidden');
        }
        if (vipPreviewActivePills) vipPreviewActivePills.innerHTML = '';
        return;
      }

      vipPreviewActive.classList.remove('hidden');
      if (vipPreviewActiveTitle) {
        vipPreviewActiveTitle.textContent = item.fileName || 'Uploaded file';
      }

      var metaText = '';
      if (boardData) {
        metaText = (boardData.statusLabel || 'Measured full page') + ' • ' + formatInches(boardData.billableWidthIn) + ' × ' + formatInches(boardData.billableLengthIn);
      } else if (item.error) {
        metaText = item.error;
      } else if (item.uploadStatus === 'ready') {
        metaText = 'Measurement ready. Waiting for combined quote refresh.';
      } else if (item.uploadStatus === 'processing' || item.quoteStatus === 'processing' || item.quoteStatus === 'measuring') {
        metaText = 'Server is still measuring this file before it can be priced.';
      } else {
        metaText = 'Upload is still being prepared.';
      }
      if (queueCount > 1) {
        metaText += ' • ' + queueCount + ' designs in this queue';
      }
      if (vipPreviewActiveMeta) vipPreviewActiveMeta.textContent = metaText;
      if (vipPreviewActiveNote) {
        var sizingMethodText = getSizingMethodText(item);
        if (sizingMethodText) {
          vipPreviewActiveNote.textContent = sizingMethodText;
          vipPreviewActiveNote.classList.remove('hidden');
        } else {
          vipPreviewActiveNote.textContent = '';
          vipPreviewActiveNote.classList.add('hidden');
        }
      }

      if (vipPreviewActivePills) {
        var pills = [];
        pills.push('<span class="ul-main-vip-preview-mini-chip">Qty ' + (item.requestedQuantity || 1) + '</span>');
        if (boardData) {
          pills.push('<span class="ul-main-vip-preview-mini-chip">' + formatInches(boardData.billableWidthIn) + ' × ' + formatInches(boardData.billableLengthIn) + '</span>');
        }
        pills.push('<span class="ul-main-vip-preview-mini-chip">' + (item.totalPrice != null ? formatMoneyValue(item.totalPrice, customerPricing.currency) : 'Pending') + '</span>');
        vipPreviewActivePills.innerHTML = pills.join('');
      }
    }

    function clearStaticPreviewBoard() {
      if (vipPreviewImage) {
        vipPreviewImage.classList.add('hidden');
        vipPreviewImage.removeAttribute('src');
      }
      if (vipPreviewArtwork) {
        vipPreviewArtwork.classList.add('hidden');
        vipPreviewArtwork.removeAttribute('style');
      }
      if (vipPreviewStageRail) {
        vipPreviewStageRail.style.width = '';
        vipPreviewStageRail.style.height = '';
      }
      if (vipPreviewStage) {
        vipPreviewStage.style.width = '';
        vipPreviewStage.style.height = '';
      }
      clearNode(vipPreviewTopTrack);
      clearNode(vipPreviewLeftTrack);
    }

    function renderStaticPreviewBoard(boardData) {
      if (!boardData || !vipPreviewStageWrap) return;

      var metrics = getPreviewBoardMetrics(vipPreviewStageWrap, boardData);
      var scale = metrics.scale;
      var stageWidth = metrics.stageWidth;
      var stageHeight = metrics.stageHeight;

      if (vipPreviewStageRail) {
        vipPreviewStageRail.style.width = stageWidth + 'px';
        vipPreviewStageRail.style.height = stageHeight + 'px';
      }
      if (vipPreviewStage) {
        vipPreviewStage.style.width = stageWidth + 'px';
        vipPreviewStage.style.height = stageHeight + 'px';
      }

      if (vipPreviewImage && boardData.imageSrc) {
        vipPreviewImage.src = boardData.imageSrc;
        vipPreviewImage.classList.remove('hidden');
      }

      if (boardData.artworkBounds && vipPreviewArtwork) {
        vipPreviewArtwork.classList.remove('hidden');
        vipPreviewArtwork.style.left = Math.max(0, Math.round(boardData.artworkBounds.offsetXIn * scale)) + 'px';
        vipPreviewArtwork.style.top = Math.max(0, Math.round(boardData.artworkBounds.offsetYIn * scale)) + 'px';
        vipPreviewArtwork.style.width = Math.max(10, Math.round(boardData.artworkBounds.widthIn * scale)) + 'px';
        vipPreviewArtwork.style.height = Math.max(10, Math.round(boardData.artworkBounds.heightIn * scale)) + 'px';
      }

      buildRulerMarks(vipPreviewTopTrack, boardData.billableWidthIn, scale, 'x', 0);
      buildRulerMarks(vipPreviewLeftTrack, boardData.billableLengthIn, scale, 'y', 0);
      syncVipPreviewRulers();
    }

    function syncVipPreviewRulers() {
      if (!vipPreviewStageWrap) return;
      if (vipPreviewTopTrack) {
        vipPreviewTopTrack.style.transform = 'translateX(' + (-vipPreviewStageWrap.scrollLeft) + 'px)';
      }
      if (vipPreviewLeftTrack) {
        vipPreviewLeftTrack.style.transform = 'translateY(' + (-vipPreviewStageWrap.scrollTop) + 'px)';
      }
    }

    function updateVipPreviewUI() {
      if (!vipPreviewCard) return;

      if (!hasCustomPricingActive()) {
        vipPreviewCard.classList.add('hidden');
        return;
      }

      vipPreviewCard.classList.remove('hidden');
      var queueItems = hasCustomQueueItems() ? getCustomQueueItems() : [];
      var previewItems = getCustomQueueActionableItems().map(buildPreviewBoardDataFromItem).filter(Boolean);

      if (!previewItems.length && state.uploadId) {
        var singleItem = buildPreviewBoardDataFromItem({
          id: state.uploadId || 'active',
          uploadId: state.uploadId,
          fileName: state.fileName,
          widthIn: state.widthIn,
          heightIn: state.heightIn,
          widthPx: state.widthPx,
          heightPx: state.heightPx,
          trimmedWidthPx: state.trimmedWidthPx,
          trimmedHeightPx: state.trimmedHeightPx,
          trimmedOffsetXPx: state.trimmedOffsetXPx,
          trimmedOffsetYPx: state.trimmedOffsetYPx,
          embeddedDpi: state.embeddedDpi,
          effectiveDpi: state.effectiveDpi,
          sizingSource: state.sizingSource,
          thumbnailUrl: state.thumbnailUrl,
          originalUrl: state.originalUrl,
          localPreviewUrl: uploadThumb ? uploadThumb.getAttribute('src') || '' : '',
          requestedQuantity: state.quantity,
          totalPrice: customerPricing.quoteTotal,
          selectedVariantTitle: customerPricing.quoteVariantTitle || (state.selectedResult && state.selectedResult.selectedVariantTitle) || '',
          sheetsNeeded: customerPricing.quoteSheetsNeeded || (state.selectedResult && state.selectedResult.sheetsNeeded) || 0
        });
        if (singleItem) previewItems = [singleItem];
      }

      var activeQueueItem = queueItems.length ? getActiveCustomQueueItem() : null;
      if (queueItems.length && activeQueueItem && String(state.activeCustomItemId) !== String(activeQueueItem.uploadId || activeQueueItem.id)) {
        setActiveCustomQueueItem(activeQueueItem.uploadId || activeQueueItem.id);
      }
      var activePreviewItem = activeQueueItem
        ? buildPreviewBoardDataFromItem(activeQueueItem)
        : (previewItems[0] || null);

      if (!previewItems.length) {
        if (vipPreviewCanvas) vipPreviewCanvas.classList.add('hidden');
        if (vipPreviewEmpty) vipPreviewEmpty.classList.remove('hidden');
        clearStaticPreviewBoard();
        renderVipPreviewSelector(queueItems, state.activeCustomItemId);
        updateVipPreviewActivePanel(activeQueueItem, null, queueItems.length);
        if (vipPreviewSummary) {
          vipPreviewSummary.textContent = hasCustomQueueItems()
            ? 'We are still measuring your uploaded files before pricing.'
            : 'Upload one or more PNG files to see full-page ruler previews for each design.';
        }
        if (vipPreviewBillingChip) vipPreviewBillingChip.textContent = 'Billing pages pending';
        if (vipPreviewArtworkChip) vipPreviewArtworkChip.textContent = 'Artwork bounds pending';
        if (vipPreviewModeChip) vipPreviewModeChip.textContent = isBusinessPricingActive() ? 'Business sheet pricing' : 'Full canvas billing';
        setVipPreviewEmptyState(
          queueItems.length ? 'Queued design is still processing' : 'Full-page quote preview',
          queueItems.length
            ? 'The queue selector stays available while the server measures each upload. Pick any file to monitor its status and open its ruler view as soon as it is ready.'
            : 'We will render the uploaded page against a scrollable inch ruler. Pricing uses the full uploaded page, not trimmed artwork bounds.'
        );
        if (vipPreviewFootnote) {
          vipPreviewFootnote.textContent = 'Each design preview uses the full uploaded page. Dashed overlays mark artwork bounds only for visual reference.';
        }
        return;
      }

      renderVipPreviewSelector(queueItems, state.activeCustomItemId);
      updateVipPreviewActivePanel(activeQueueItem || previewItems[0], activePreviewItem, queueItems.length);

      if (activePreviewItem) {
        if (vipPreviewCanvas) vipPreviewCanvas.classList.remove('hidden');
        if (vipPreviewEmpty) vipPreviewEmpty.classList.add('hidden');
        clearStaticPreviewBoard();
        renderStaticPreviewBoard(activePreviewItem);
      } else {
        if (vipPreviewCanvas) vipPreviewCanvas.classList.add('hidden');
        if (vipPreviewEmpty) vipPreviewEmpty.classList.remove('hidden');
        clearStaticPreviewBoard();
        setVipPreviewEmptyState(
          'Selected design is still being measured',
          'This design is focused, but its exact billed page has not been confirmed yet. You can keep working in the queue while the server finishes measuring it.'
        );
      }

      var previewTotalLength = previewItems.reduce(function(sum, item) {
        return sum + Number(item.billableLengthIn || 0);
      }, 0);
      var previewTotalPages = previewItems.length;
      var previewHasArtwork = previewItems.some(function(item) { return !!item.artworkBounds; });

      if (vipPreviewBillingChip) {
        vipPreviewBillingChip.textContent =
          previewTotalPages + ' page' + (previewTotalPages === 1 ? '' : 's') + ' • ' + formatInches(previewTotalLength) + ' total billable length';
      }
      if (vipPreviewArtworkChip) {
        vipPreviewArtworkChip.textContent = previewHasArtwork ? 'Artwork overlays detected' : 'Artwork matches full pages';
      }
      if (vipPreviewModeChip) {
        vipPreviewModeChip.textContent = isBusinessPricingActive() ? 'Business multi-sheet pricing' : 'VIP multi-page billing';
      }
      if (vipPreviewSummary) {
        vipPreviewSummary.textContent =
          customerPricing.quoteStatus === 'ready'
            ? 'Select a design from the left queue or the dropdown above to inspect its ruler preview. The checkout total combines every ready file in the queue.'
            : 'Pick any queued design to inspect it here while the server continues building the combined custom quote.';
      }
      if (vipPreviewFootnote) {
        vipPreviewFootnote.textContent = previewHasArtwork
          ? 'The solid frame is always the billed full page for the focused design. Dashed overlays show artwork bounds only for reference.'
          : 'The focused design always shows the billed full page. No separate artwork bounds were detected in the current queue.';
      }
    }

    function syncPurchaseButtonsForCurrentState() {
      if (uploadRequired) {
        if (isCustomerPricingLoading()) {
          setPurchaseButtonsDisabled(true);
          return;
        }
        if (hasCustomPricingActive()) {
          setPurchaseButtonsDisabled(!(customQueueAllReady() && customerPricing.quoteStatus === 'ready' && customerPricing.quoteTotal != null));
          return;
        }
        setPurchaseButtonsDisabled(!(state.uploadId && state.selectedResult && state.selectedVariantId));
        return;
      }
      setPurchaseButtonsDisabled(!state.selectedVariantId);
    }

    function syncPricingVisibility() {
      if (root) {
        root.classList.toggle('ul-main-has-custom-pricing', hasCustomPricingActive());
        root.classList.toggle('ul-main-has-business-pricing', isBusinessPricingActive());
        root.classList.toggle('ul-main-has-vip-pricing', isVipPricingActive());
      }
      renderCustomerWorkspace();
      if (variantPricingTable) {
        if (hasCustomPricingActive()) variantPricingTable.classList.add('hidden');
        else variantPricingTable.classList.remove('hidden');
      }
      if (quantityRow) {
        if (hasCustomPricingActive()) quantityRow.classList.add('hidden');
        else quantityRow.classList.remove('hidden');
      }
      if (buyNowBtn) {
        if (hasCustomPricingActive()) buyNowBtn.classList.add('hidden');
        else buyNowBtn.classList.remove('hidden');
      }
      if (vipPricingBox) {
        if (customerLoggedIn && customerPricing.status === 'loading') {
          vipPricingBox.classList.remove('hidden');
        } else if (hasCustomPricingActive()) {
          vipPricingBox.classList.remove('hidden');
        } else {
          vipPricingBox.classList.add('hidden');
        }
      }
      if (inlinePricingBox) {
        if (customerLoggedIn && customerPricing.status === 'loading') {
          inlinePricingBox.classList.remove('hidden');
        } else if (hasCustomPricingActive()) {
          inlinePricingBox.classList.remove('hidden');
        } else {
          inlinePricingBox.classList.add('hidden');
          inlinePricingBox.classList.remove('is-live');
        }
      }
      if (detectedBox && hasCustomPricingActive()) {
        detectedBox.classList.add('hidden');
      }
      if (uploadFeedback && hasCustomPricingActive()) {
        uploadFeedback.classList.add('hidden');
      }
      resetActionLabels();
      renderCustomQueue();
      syncUploadInputMode();
    }

    function syncEffectiveRules(config) {
      if (!config) return;
      effectiveRules.maxUploadWidth =
        parseOptionalPositiveNumber(config.maxWidthIn) || effectiveRules.maxUploadWidth;
    }

    function setVipPricingMessage(titleText, rateText, lengthText, totalText) {
      if (vipPricingTitle) vipPricingTitle.textContent = titleText || '';
      if (vipPricingRate) vipPricingRate.textContent = rateText || '';
      if (vipPricingLength) vipPricingLength.textContent = lengthText || '';
      if (vipPricingTotal) vipPricingTotal.textContent = totalText || '';
    }

    function setInlinePricingAlertLevel(level) {
      var safeLevel = Math.max(0, Math.min(6, parseInt(level || '0', 10) || 0));
      if (inlinePricingBox) inlinePricingBox.setAttribute('data-alert-level', String(safeLevel));
      if (inlinePricingButton) inlinePricingButton.setAttribute('data-alert-level', String(safeLevel));
    }

    function setInlinePricingMessage(kickerText, totalText, metaText, isLive) {
      if (inlinePricingKicker) inlinePricingKicker.textContent = kickerText || 'Custom pricing';
      if (inlinePricingTotal) inlinePricingTotal.textContent = totalText || '$0.00';
      if (inlinePricingMeta) inlinePricingMeta.textContent = metaText || 'Waiting for your measured quote.';
      if (inlinePricingBox) inlinePricingBox.classList.toggle('is-live', !!isLive);
      if (inlinePricingButton) inlinePricingButton.classList.toggle('is-live', !!isLive);
      if (!isLive) setInlinePricingAlertLevel(0);
    }

    function updateVipPricingUI() {
      if (!vipPricingBox) return;
      syncPricingVisibility();

      if (!hasCustomPricingActive()) {
        if (vipPricingTitle) vipPricingTitle.textContent = '';
        if (vipPricingRate) vipPricingRate.textContent = '';
        if (vipPricingLength) vipPricingLength.textContent = '';
        if (vipPricingTotal) vipPricingTotal.textContent = '';
        setInlinePricingMessage(
          customerLoggedIn && customerPricing.status === 'loading' ? 'Pricing desk' : 'Custom pricing',
          customerLoggedIn && customerPricing.status === 'loading' ? 'Checking...' : '$0.00',
          customerLoggedIn && customerPricing.status === 'loading'
            ? 'Checking your assigned pricing and loading your checkout desk.'
            : 'Upload artwork to unlock your measured total here.',
          false
        );
        if (detectedTitle) detectedTitle.textContent = detectedDefaultTitle;
        return;
      }

      var queueItems = getCustomQueueItems();
      var actionableQueueItems = getCustomQueueActionableItems();
      var queueMode = queueItems.length > 0;
      var readyQueueItems = getCustomQueueReadyItems();
      var readyCount = readyQueueItems.length;
      var totalCopies = queueItems.reduce(function(sum, item) {
        return sum + Math.max(1, Number(item.requestedQuantity) || 1);
      }, 0);
      var billableLengthIn = customerPricing.quoteLengthIn || getBillablePageLengthIn();
      var billableWidthIn = getBillablePageWidthIn();
      var isBusiness = isBusinessPricingActive();
      var rateLabel = customerPricing.pricePerInch != null
        ? (isBusiness ? 'Business rate: ' : 'VIP price per inch: ') + formatMoneyValue(customerPricing.pricePerInch, customerPricing.currency) + ' / in'
        : 'Rate is loading from the server...';
      var lengthLabel = '';
      if (queueMode) {
        var totalFiles = queueItems.length;
        var actionableFiles = actionableQueueItems.length;
        var failedFiles = Math.max(0, totalFiles - actionableFiles);
        var waitingFiles = Math.max(0, actionableFiles - readyCount);
        if (readyCount > 0) {
          lengthLabel =
            readyCount +
            ' of ' +
            actionableFiles +
            ' ready design' +
            (actionableFiles === 1 ? '' : 's') +
            ', ' +
            totalCopies +
            ' total cop' +
            (totalCopies === 1 ? 'y' : 'ies') +
            '. Current billable length: ' +
            (billableLengthIn ? billableLengthIn.toFixed(2) + '"' : 'pending');
          if (waitingFiles) {
            lengthLabel += '. ' + waitingFiles + ' upload' + (waitingFiles === 1 ? ' is' : 's are') + ' still measuring.';
          }
          if (failedFiles) {
            lengthLabel += ' ' + failedFiles + ' failed file' + (failedFiles === 1 ? '' : 's') + ' excluded from this quote.';
          }
        } else {
          lengthLabel =
            'Waiting for the first ready upload to finish measuring before building the running total.' +
            (failedFiles ? ' Failed uploads are excluded until you remove or replace them.' : '');
        }
      } else if (isBusiness) {
        if (customerPricing.quoteVariantTitle) {
          lengthLabel = 'Selected sheet: ' + customerPricing.quoteVariantTitle;
          if (customerPricing.quoteSheetsNeeded) {
            lengthLabel += ' (' + customerPricing.quoteSheetsNeeded + ' sheet' + (customerPricing.quoteSheetsNeeded === 1 ? '' : 's') + ')';
          }
        } else if (state.selectedResult && state.selectedResult.selectedVariantTitle) {
          lengthLabel = 'Selected sheet: ' + state.selectedResult.selectedVariantTitle;
        } else {
          lengthLabel = 'Waiting for the server to confirm the best sheet size...';
        }
        if (billableLengthIn) {
          lengthLabel += '. Billable length: ' + billableLengthIn.toFixed(2) + '"';
        }
      } else {
        lengthLabel = billableLengthIn
          ? 'Uploaded page: ' + (billableWidthIn ? billableWidthIn.toFixed(2) + '" x ' : '') + billableLengthIn.toFixed(2) + '"'
          : 'Waiting for server-confirmed measurement...';
      }
      var totalLabel = customerPricing.quoteTotal != null
        ? 'Exact total: ' + formatMoneyValue(customerPricing.quoteTotal, customerPricing.currency)
        : (isBusiness ? 'Exact total will be returned after the sheet fit is confirmed.' : 'Exact total will be returned by the server quote.');
      var titleLabel = customerPricing.statusLabel
        ? (isBusiness ? 'Business pricing: ' : 'VIP pricing: ') + customerPricing.statusLabel
        : (isBusiness ? 'Business pricing active' : 'VIP pricing active');

      if (queueMode) {
        totalLabel = customerPricing.quoteTotal != null
          ? 'Queue total: ' + formatMoneyValue(customerPricing.quoteTotal, customerPricing.currency)
          : 'Queue total will be returned after every file is quoted.';
      }

      var inlineKicker = isBusiness ? 'Business pricing live' : 'VIP pricing live';
      var inlineTotalText = customerPricing.quoteTotal != null
        ? formatMoneyValue(customerPricing.quoteTotal, customerPricing.currency)
        : 'Please upload your gang sheet';
      var inlineMetaText = customerPricing.quoteTotal != null
        ? (queueMode
            ? readyCount + ' ready design' + (readyCount === 1 ? '' : 's') + ' • ' + totalCopies + ' total cop' + (totalCopies === 1 ? 'y' : 'ies')
            : (billableLengthIn ? 'Billable length ' + billableLengthIn.toFixed(2) + '"' : 'Ready to create checkout'))
        : (queueMode
            ? 'Building your measured running total from each ready upload.'
            : 'Waiting for the server-confirmed quote to finish.');
      var inlineAlertLevel = 0;
      if (customerPricing.quoteStatus === 'ready' && customerPricing.quoteTotal != null) {
        inlineAlertLevel = queueMode ? Math.min(6, Math.max(1, readyCount)) : 1;
        if (queueMode && actionableQueueItems.length > readyCount) {
          inlineAlertLevel = Math.min(6, inlineAlertLevel + 1);
        }
      }

      setVipPricingMessage(
        titleLabel,
        rateLabel,
        lengthLabel,
        totalLabel
      );
      setInlinePricingMessage(
        inlineKicker,
        inlineTotalText,
        inlineMetaText,
        customerPricing.quoteStatus === 'ready' && customerPricing.quoteTotal != null
      );
      setInlinePricingAlertLevel(inlineAlertLevel);

      if (customerPricing.quoteTotal != null) {
        if (productPrice) productPrice.textContent = formatMoneyValue(customerPricing.quoteTotal, customerPricing.currency);
        if (buyBoxPrice) buyBoxPrice.textContent = formatMoneyValue(customerPricing.quoteTotal, customerPricing.currency);
      } else {
        if (productPrice) productPrice.textContent = isBusiness ? 'Business quote pending' : 'VIP quote pending';
        if (buyBoxPrice) buyBoxPrice.textContent = isBusiness ? 'Business quote pending' : 'VIP quote pending';
      }

      if (detectedVariant) {
        if (queueMode) {
          detectedVariant.value = queueItems.length + ' queued file' + (queueItems.length === 1 ? '' : 's');
        } else if (isBusiness) {
          detectedVariant.value = customerPricing.quoteVariantTitle || (state.selectedResult && state.selectedResult.selectedVariantTitle) || 'Business custom checkout';
        } else {
          detectedVariant.value = customerPricing.statusLabel ? customerPricing.statusLabel : 'VIP measured checkout';
        }
      }
      if (detectedTitle) {
        detectedTitle.textContent = isBusiness ? detectedDefaultTitle : 'Detected Uploaded Page';
      }
      updateVipPreviewUI();
    }

    async function loadCustomerPricingContext() {
      var requestToken = ++customerPricingRequestToken;
      if (!customerLoggedIn) {
        customerPricing.status = 'ready';
        customerPricing.customerType = 'guest';
        customerPricing.source = 'fallback';
        updateCustomerStatusUI();
        syncPricingVisibility();
        syncPurchaseButtonsForCurrentState();
        return customerPricing;
      }

      updateCustomerStatusUI();

      try {
        var contextUrl =
          apiBase +
          '/api/vip/context?shopDomain=' +
          encodeURIComponent(shopDomain) +
          '&productId=' +
          encodeURIComponent(String(productData.productId)) +
          '&customerId=' +
          encodeURIComponent(themeCustomerId || '') +
          '&customerEmail=' +
          encodeURIComponent(themeCustomerEmail || '');
        var response = await fetch(contextUrl, { credentials: 'same-origin' });
        var data = await response.json().catch(function() { return {}; });
        if (requestToken !== customerPricingRequestToken) return customerPricing;

        if (!response.ok) {
          throw new Error(data && data.error ? data.error : 'Failed to load customer pricing context.');
        }

        customerPricing.status = 'ready';
        customerPricing.customerType = String(
          data.customerType || data.statusType || data.mode || 'standard'
        ).toLowerCase();
        if (['business', 'vip'].indexOf(customerPricing.customerType) === -1) customerPricing.customerType = 'standard';
        customerPricing.statusKey = String(data.statusKey || data.customerStatusKey || '');
        customerPricing.statusLabel = String(data.statusLabel || data.customerStatusLabel || '').trim();
        customerPricing.pricingMode = String(data.pricingMode || 'standard_variant').toLowerCase();
        customerPricing.hasCustomPricing = Boolean(
          data.hasCustomPricing === true ||
          (customerPricing.pricingMode !== 'standard_variant' && ['business', 'vip'].indexOf(customerPricing.customerType) >= 0)
        );
        customerPricing.pricePerInch = parsePositiveNumber(
          data.pricePerInch != null
            ? data.pricePerInch
            : data.quote && data.quote.pricePerInch != null
              ? data.quote.pricePerInch
              : null
        );
        customerPricing.currency = String(data.currency || data.quote && data.quote.currency || 'USD');
        customerPricing.source = String(data.source || 'app_proxy');
        if (!customerPricing.hasCustomPricing) {
          resetVipQuoteState();
        }
        customerWorkspaceState.status = customerPricing.hasCustomPricing ? 'loading' : 'idle';
        if (!customerPricing.hasCustomPricing) {
          customerWorkspaceState.items = [];
          customerWorkspaceState.error = '';
          customerWorkspaceState.loadedKey = '';
          customerWorkspaceState.activeActionId = '';
        }

        updateCustomerStatusUI();
        syncPricingVisibility();
        await loadCustomerWorkspace();
        updateVipPricingUI();
        resetActionLabels();
        syncPurchaseButtonsForCurrentState();
        return customerPricing;
      } catch (error) {
        if (requestToken !== customerPricingRequestToken) return customerPricing;
        customerPricing.status = 'ready';
        customerPricing.customerType = 'standard';
        customerPricing.pricingMode = 'standard_variant';
        customerPricing.hasCustomPricing = false;
        customerPricing.source = 'fallback';
        resetVipQuoteState();
        customerWorkspaceState.status = 'idle';
        customerWorkspaceState.items = [];
        customerWorkspaceState.error = '';
        customerWorkspaceState.loadedKey = '';
        customerWorkspaceState.activeActionId = '';
        updateCustomerStatusUI();
        syncPricingVisibility();
        renderCustomerWorkspace();
        updateVipPreviewUI();
        resetActionLabels();
        syncPurchaseButtonsForCurrentState();
        return customerPricing;
      }
    }

    async function loadCustomerWorkspace() {
      if (!customerWorkspace || !customerWorkspaceList) return null;

      if (!shouldShowCustomerWorkspace()) {
        customerWorkspaceState.status = 'idle';
        customerWorkspaceState.items = [];
        customerWorkspaceState.error = '';
        customerWorkspaceState.loadedKey = '';
        customerWorkspaceState.activeActionId = '';
        renderCustomerWorkspace();
        return null;
      }

      var workspaceKey = getCustomerWorkspaceKey();
      if (customerWorkspaceState.loadedKey === workspaceKey && customerWorkspaceState.status === 'ready') {
        renderCustomerWorkspace();
        return customerWorkspaceState.items;
      }

      customerWorkspaceState.status = 'loading';
      customerWorkspaceState.error = '';
      renderCustomerWorkspace();

      try {
        var workspaceUrl =
          apiBase +
          '/api/customer-pricing/workspace?shopDomain=' +
          encodeURIComponent(shopDomain) +
          '&productId=' +
          encodeURIComponent(String(productData.productId)) +
          '&customerId=' +
          encodeURIComponent(themeCustomerId || '') +
          '&customerEmail=' +
          encodeURIComponent(themeCustomerEmail || '');
        var response = await fetch(workspaceUrl, { credentials: 'same-origin' });
        var data = await response.json().catch(function() { return {}; });
        if (!response.ok) {
          throw new Error(data && data.error ? data.error : 'Failed to load recent ordered uploads.');
        }

        customerWorkspaceState.status = 'ready';
        customerWorkspaceState.items = Array.isArray(data.items)
          ? data.items.map(function(item) {
              var requestedQuantity = Math.max(1, parseInt(item.requestedQuantity || item.lastOrderedQuantity || 1, 10) || 1);
              return {
                uploadId: String(item.uploadId || ''),
                productTitle: String(item.productTitle || productData.title || 'Custom Upload'),
                productId: String(item.productId || ''),
                productHandle: String(item.productHandle || ''),
                fileName: String(item.fileName || 'Print-ready upload'),
                uploadUrl: String(item.uploadUrl || ''),
                thumbnailUrl: String(item.thumbnailUrl || ''),
                orderedAt: item.orderedAt || '',
                lastOrderedQuantity: Math.max(1, parseInt(item.lastOrderedQuantity || requestedQuantity, 10) || requestedQuantity),
                requestedQuantity: requestedQuantity,
                selectedVariantId: String(item.selectedVariantId || ''),
                selectedVariantTitle: String(item.selectedVariantTitle || ''),
                selectedSheetLabel: String(item.selectedSheetLabel || ''),
                billableLengthIn: parsePositiveNumber(item.billableLengthIn) || 0,
                measurement: item.measurement && typeof item.measurement === 'object' ? item.measurement : null
              };
            }).filter(function(item) {
              return item.uploadId;
            })
          : [];
        customerWorkspaceState.loadedKey = workspaceKey;
        customerWorkspaceState.activeActionId = '';
        renderCustomerWorkspace();
        return customerWorkspaceState.items;
      } catch (error) {
        customerWorkspaceState.status = 'error';
        customerWorkspaceState.error = error && error.message ? error.message : 'Failed to load recent ordered uploads.';
        customerWorkspaceState.items = [];
        customerWorkspaceState.loadedKey = '';
        customerWorkspaceState.activeActionId = '';
        renderCustomerWorkspace();
        return null;
      }
    }

    async function checkoutWorkspaceItem(workspaceItem) {
      if (!workspaceItem) return;
      clearError();
      customerWorkspaceState.activeActionId = workspaceItem.uploadId;
      renderCustomerWorkspace();
      try {
        var checkoutResponse = await fetch(apiBase + '/api/vip/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
              shopDomain: shopDomain,
              productId: String(productData.productId),
              customerId: themeCustomerId || '',
              customerEmail: themeCustomerEmail || '',
              measurementPolicy: MAIN_PRODUCT_MEASUREMENT_POLICY,
              rollWidthIn: MAIN_PRODUCT_ROLL_WIDTH_IN,
              items: [{
                uploadId: workspaceItem.uploadId,
                quantity: workspaceItem.requestedQuantity || 1,
                selectedVariantId: workspaceItem.selectedVariantId || ''
              }]
          })
        });
        var checkoutData = await checkoutResponse.json().catch(function() { return {}; });
        if (!checkoutResponse.ok) {
          throw new Error(checkoutData.error || 'Failed to create custom checkout.');
        }
        window.location.href = checkoutData.checkoutUrl || checkoutData.redirectUrl || checkoutData.url || '/checkout';
      } catch (error) {
        showError(error && error.message ? error.message : 'Failed to create custom checkout.');
        customerWorkspaceState.activeActionId = '';
        renderCustomerWorkspace();
      }
    }

    function addWorkspaceItemToQueue(workspaceItem) {
      if (!workspaceItem) return;
      clearError();
      var queueItem = ensureWorkspaceItemInQueue(workspaceItem);
      if (!queueItem) return;
      customerWorkspaceState.activeActionId = workspaceItem.uploadId;
      setActiveCustomQueueItem(queueItem.uploadId || queueItem.id);
      markCustomQueueQuoteDirty();
      renderCustomQueue();
      updateVipPricingUI();
      updateVipPreviewUI();
      syncPurchaseButtonsForCurrentState();
      renderCustomerWorkspace();
      loadVipQuote().finally(function() {
        customerWorkspaceState.activeActionId = '';
        renderCustomerWorkspace();
      });
      if (uploadBox && typeof uploadBox.scrollIntoView === 'function') {
        uploadBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    async function loadVipQuote() {
      if (!hasCustomPricingActive()) return null;

      var requestToken = ++vipQuoteRequestToken;
      var queueMode = hasCustomQueueItems();
      var requestBody;

      if (queueMode) {
        customerPricing.quoteStatus = getCustomQueueReadyItems().length ? 'ready' : 'loading';
        syncCustomQueueQuoteSummary();
        updateVipPricingUI();
        syncPurchaseButtonsForCurrentState();

        var queueItems = getCustomQueueItemsAwaitingQuote();
        if (!queueItems.length) {
          syncCustomQueueQuoteSummary();
          updateVipPreviewUI();
          updateVipPricingUI();
          syncPurchaseButtonsForCurrentState();
          return {
            items: customerPricing.quoteItems || [],
            totalPrice: customerPricing.quoteTotal,
            billableLengthIn: customerPricing.quoteLengthIn,
            currency: customerPricing.currency,
          };
        }

        var itemResponses = await Promise.all(queueItems.map(async function(queueItem) {
          var requestKey =
            String(queueItem.uploadId || queueItem.id || '') +
            ':' +
            String(queueItem.requestedQuantity || 1) +
            ':' +
            String(Date.now()) +
            ':' +
            Math.random().toString(36).slice(2, 8);
          queueItem.quoteRequestKey = requestKey;
          queueItem.quoteStatus = 'processing';
          queueItem.error = '';
          try {
            var response = await fetch(apiBase + '/api/vip/quote', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'same-origin',
              body: JSON.stringify({
                shopDomain: shopDomain,
                productId: String(productData.productId),
                customerId: themeCustomerId || '',
                customerEmail: themeCustomerEmail || '',
                measurementPolicy: MAIN_PRODUCT_MEASUREMENT_POLICY,
                rollWidthIn: MAIN_PRODUCT_ROLL_WIDTH_IN,
                items: [{
                  uploadId: queueItem.uploadId,
                  quantity: queueItem.requestedQuantity || 1,
                  selectedVariantId: queueItem.selectedVariantId || ''
                }]
              })
            });
            var data = await response.json().catch(function() { return {}; });
            if (!response.ok) {
              throw new Error(data && data.error ? data.error : 'Failed to load custom quote.');
            }

            var quoteItem = Array.isArray(data.items) && data.items[0] ? data.items[0] : null;
            if (!quoteItem) {
              throw new Error('Failed to load custom quote.');
            }

            var currentQueueItem = getCustomQueueItemById(queueItem.uploadId || queueItem.id);
            if (!currentQueueItem || currentQueueItem.quoteRequestKey !== requestKey) {
              return null;
            }

            if (quoteItem.measurement && typeof quoteItem.measurement === 'object') {
              applyServerMeasurement(quoteItem.measurement, currentQueueItem);
            }
            currentQueueItem.billableLengthIn = parsePositiveNumber(quoteItem.billableLengthIn) || 0;
            currentQueueItem.totalPrice = parsePositiveNumber(quoteItem.totalPrice);
            currentQueueItem.selectedVariantId = String(quoteItem.selectedVariantId || '');
            currentQueueItem.selectedVariantTitle = String(quoteItem.selectedVariantTitle || '');
            currentQueueItem.selectedSheetLabel = String(quoteItem.selectedSheetLabel || '');
            currentQueueItem.sheetsNeeded = parsePositiveNumber(quoteItem.sheetsNeeded) || 0;
            currentQueueItem.designsPerSheet = parsePositiveNumber(quoteItem.designsPerSheet) || 0;
            currentQueueItem.quoteStatus = 'ready';
            currentQueueItem.error = '';
            currentQueueItem.quoteRequestKey = '';
            customerPricing.currency = String(data.currency || customerPricing.currency || 'USD');
            return quoteItem;
          } catch (error) {
            var currentQueueItem = getCustomQueueItemById(queueItem.uploadId || queueItem.id);
            if (!currentQueueItem || currentQueueItem.quoteRequestKey !== requestKey) {
              return null;
            }
            currentQueueItem.totalPrice = null;
            currentQueueItem.billableLengthIn = 0;
            currentQueueItem.selectedVariantId = '';
            currentQueueItem.selectedVariantTitle = '';
            currentQueueItem.selectedSheetLabel = '';
            currentQueueItem.sheetsNeeded = 0;
            currentQueueItem.designsPerSheet = 0;
            currentQueueItem.quoteStatus = 'error';
            currentQueueItem.error = error && error.message ? error.message : 'Failed to load custom quote.';
            currentQueueItem.quoteRequestKey = '';
            return null;
          }
        }));

        syncCustomQueueQuoteSummary();
        if (!getCustomQueueItemById(state.activeCustomItemId) && getCustomQueueItems().length) {
          setActiveCustomQueueItem(getCustomQueueItems()[0].uploadId || getCustomQueueItems()[0].id);
        } else if (state.activeCustomItemId) {
          setActiveCustomQueueItem(state.activeCustomItemId);
        }
        renderCustomQueue();
        updateVipPreviewUI();
        updateVipPricingUI();
        syncPurchaseButtonsForCurrentState();
        return {
          items: itemResponses.filter(Boolean),
          totalPrice: customerPricing.quoteTotal,
          billableLengthIn: customerPricing.quoteLengthIn,
          currency: customerPricing.currency,
        };
      } else {
        customerPricing.quoteStatus = 'loading';
        updateVipPricingUI();
        syncPurchaseButtonsForCurrentState();
        if (!state.uploadId || !(state.widthIn > 0) || !(state.heightIn > 0)) return null;
        requestBody = {
          shopDomain: shopDomain,
          productId: String(productData.productId),
          customerId: themeCustomerId || '',
          customerEmail: themeCustomerEmail || '',
          uploadId: state.uploadId,
          quantity: state.quantity,
          measurementPolicy: MAIN_PRODUCT_MEASUREMENT_POLICY,
          rollWidthIn: MAIN_PRODUCT_ROLL_WIDTH_IN,
          selectedVariantId:
            state.selectedResult && state.selectedResult.selectedVariantId
              ? state.selectedResult.selectedVariantId
              : state.selectedVariantId
        };
      }

      try {
        var response = await fetch(apiBase + '/api/vip/quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(requestBody)
        });
        var data = await response.json().catch(function() { return {}; });
        if (requestToken !== vipQuoteRequestToken) return null;

        if (!response.ok) {
          throw new Error(data && data.error ? data.error : 'Failed to load custom quote.');
        }

        customerPricing.quoteStatus = 'ready';
        customerPricing.quoteTotal = parsePositiveNumber(
          data.totalPrice != null
            ? data.totalPrice
            : data.exactTotal != null
              ? data.exactTotal
            : data.total != null
              ? data.total
              : data.quote && data.quote.total != null
                ? data.quote.total
              : data.quote && data.quote.totalPrice != null
                  ? data.quote.totalPrice
                  : data.quote && data.quote.exactTotal != null
                    ? data.quote.exactTotal
                : null
        );
        customerPricing.totalRequestedQuantity = parseNonNegativeNumber(
          data.totalRequestedQuantity != null
            ? data.totalRequestedQuantity
            : data.quote && data.quote.totalRequestedQuantity != null
              ? data.quote.totalRequestedQuantity
              : 0
        ) || 0;
        customerPricing.quoteLengthIn = parsePositiveNumber(
          data.billableLengthIn != null
            ? data.billableLengthIn
            : data.pageLengthIn != null
              ? data.pageLengthIn
              : data.quote && data.quote.billableLengthIn != null
                ? data.quote.billableLengthIn
                : data.quote && data.quote.pageLengthIn != null
                  ? data.quote.pageLengthIn
                    : null
        );
        customerPricing.quoteVariantId = data.selectedVariantId != null
          ? String(data.selectedVariantId || '')
          : data.quote && data.quote.selectedVariantId != null
            ? String(data.quote.selectedVariantId || '')
            : null;
        customerPricing.quoteVariantTitle = String(
          data.selectedVariantTitle != null
            ? data.selectedVariantTitle
            : data.quote && data.quote.selectedVariantTitle != null
              ? data.quote.selectedVariantTitle
              : ''
        );
        customerPricing.quoteSheetLabel = String(
          data.selectedSheetLabel != null
            ? data.selectedSheetLabel
            : data.quote && data.quote.selectedSheetLabel != null
              ? data.quote.selectedSheetLabel
              : ''
        );
        customerPricing.quoteSheetsNeeded = parsePositiveNumber(
          data.sheetsNeeded != null
            ? data.sheetsNeeded
            : data.quote && data.quote.sheetsNeeded != null
              ? data.quote.sheetsNeeded
              : null
        );
        customerPricing.quoteDesignsPerSheet = parsePositiveNumber(
          data.designsPerSheet != null
            ? data.designsPerSheet
            : data.quote && data.quote.designsPerSheet != null
              ? data.quote.designsPerSheet
              : null
        );
        customerPricing.quoteItems = Array.isArray(data.items)
          ? data.items
          : data.quote && Array.isArray(data.quote.items)
            ? data.quote.items
            : [];
        customerPricing.currency = String(data.currency || data.quote && data.quote.currency || customerPricing.currency || 'USD');
        customerPricing.statusLabel = String(data.statusLabel || data.quote && data.quote.statusLabel || customerPricing.statusLabel || '').trim();
        clearError();
        if (isBusinessPricingActive() && customerPricing.quoteVariantId) {
          state.selectedResult = {
            selectedVariantId: customerPricing.quoteVariantId,
            selectedVariantTitle: customerPricing.quoteVariantTitle || '',
            selectedSheetLabel: customerPricing.quoteSheetLabel || '',
            designsPerSheet: customerPricing.quoteDesignsPerSheet || 0,
            sheetsNeeded: customerPricing.quoteSheetsNeeded || 1
          };
          setSelectedVariant(customerPricing.quoteVariantId);
          updateDetectedUI();
        }
        updateVipPricingUI();
        syncPurchaseButtonsForCurrentState();
        return data;
      } catch (error) {
        if (requestToken !== vipQuoteRequestToken) return null;
        customerPricing.quoteStatus = 'error';
        if (queueMode) {
          syncCustomQueueQuoteSummary();
          renderCustomQueue();
        }
        showError(error && error.message ? error.message : 'Failed to load custom quote.');
        updateVipPricingUI();
        syncPurchaseButtonsForCurrentState();
        return null;
      }
    }

    function setMainProductImage(imageUrl) {
      if (!productImage || !imageUrl) return;
      productImage.src = imageUrl;
    }

    function setSelectedVariant(variantId) {
      var normalizedVariantId = variantId != null && variantId !== '' ? String(variantId) : null;
      state.selectedVariantId = normalizedVariantId;
      if (hiddenVariantInput) hiddenVariantInput.value = normalizedVariantId || '';
      if (variantSelect) {
        variantSelect.value = normalizedVariantId || '';
        if (normalizedVariantId) {
          var selectedOption = variantSelect.options[variantSelect.selectedIndex];
          if (selectedOption && selectedOption.getAttribute('data-image-url')) {
            setMainProductImage(selectedOption.getAttribute('data-image-url'));
          }
        }
      }

      var selectedVariant = null;
      var sourceVariants = productData.variants || [];
      for (var i = 0; i < sourceVariants.length; i++) {
        if (String(sourceVariants[i].id) === String(normalizedVariantId)) {
          selectedVariant = sourceVariants[i];
          break;
        }
      }

      resetSelectionUI();
      variantRows.forEach(function(row) {
        if (String(row.getAttribute('data-variant-id')) === String(normalizedVariantId)) {
          row.classList.add('bg-green-100', 'ring-2', 'ring-green-500');
        }
      });

      if (selectedVariant) {
        if (!hasCustomPricingActive()) {
          if (productPrice) productPrice.textContent = moneyFromCents(selectedVariant.price);
          if (buyBoxPrice) buyBoxPrice.textContent = moneyFromCents(selectedVariant.price);
          if (detectedVariant) detectedVariant.value = selectedVariant.title;
        }
      } else if (detectedVariant && !normalizedVariantId) {
        detectedVariant.value = state.uploadId ? 'No matching sheet size' : '';
        if (!hasCustomPricingActive() && state.uploadId) {
          if (productPrice) productPrice.textContent = 'Unavailable';
          if (buyBoxPrice) buyBoxPrice.textContent = 'Unavailable';
        }
      }
    }

    function updateDetectedUI() {
      if (!detectedBox) return;
      if (!state.widthIn || !state.heightIn) {
        detectedBox.classList.add('hidden');
        return;
      }
      detectedBox.classList.remove('hidden');
      if (detectedWidth) detectedWidth.value = state.widthIn.toFixed(2) + '"';
      if (detectedHeight) detectedHeight.value = state.heightIn.toFixed(2) + '"';
      if (detectedNote) {
        var notes = isVipPricingActive()
          ? ['Measured on the server. Pricing uses the full uploaded page size.']
          : isBusinessPricingActive()
            ? ['Resolved on the server using the matched sheet size. Checkout uses your assigned per-inch rate on the selected sheet length.']
            : ['Resolved on server using the saved product sheet rules.'];
        if ((isBusinessPricingActive() || !hasCustomPricingActive()) && state.selectedResult && state.selectedResult.designsPerSheet && state.selectedResult.sheetsNeeded) {
          notes.push(
            state.selectedResult.designsPerSheet + ' design(s) per sheet, ' +
            state.selectedResult.sheetsNeeded + ' sheet(s) needed.'
          );
        }
        if (hasSeparateArtworkBounds()) {
          notes.push('Artwork bounds were also detected for preview, but billing keeps the full uploaded page size.');
        }
        notes.push(getSizingMethodText(state));
        detectedNote.textContent = notes.join(' ');
      }
    }

    async function updateVariantResolution() {
      if (!state.uploadId) {
        state.selectedResult = null;
        updateDetectedUI();
        setSelectedVariant(getFallbackVariantId());
        syncPurchaseButtonsForCurrentState();
        return;
      }
      if (!state.widthIn || !state.heightIn) {
        syncPurchaseButtonsForCurrentState();
        return;
      }

      var requestToken = ++resolveRequestToken;
      clearError();
      setPurchaseButtonsDisabled(true);
      if (uploadStatus) uploadStatus.textContent = 'Resolving best variant...';

      try {
        var response = await fetch(apiBase + '/api/upload/resolve-product', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shopDomain: shopDomain,
            productId: String(productData.productId),
            uploadId: state.uploadId,
            quantity: state.quantity,
            selectedVariantId:
              getFallbackVariantId() ||
              state.selectedVariantId ||
              (hiddenVariantInput ? hiddenVariantInput.value : '') ||
              null,
            maxUploadWidth: effectiveRules.maxUploadWidth,
            measurementPolicy: MAIN_PRODUCT_MEASUREMENT_POLICY,
            rollWidthIn: MAIN_PRODUCT_ROLL_WIDTH_IN
          })
        });
        var data = await response.json().catch(function() { return {}; });
        if (requestToken !== resolveRequestToken) return;
        syncEffectiveRules(data && data.config ? data.config : null);

      if (data && data.upload) {
          applyServerMeasurement(data.upload);
        }

        if (!response.ok) {
          state.selectedResult = null;
          updateDetectedUI();
          setSelectedVariant(null);
          showError(data && data.error ? data.error : 'Failed to resolve product variant.');
          if (uploadStatus) uploadStatus.textContent = '';
          syncPurchaseButtonsForCurrentState();
          return;
        }

        state.selectedResult = data && data.resolution ? data.resolution : null;
      } catch (error) {
        if (requestToken !== resolveRequestToken) return;
        state.selectedResult = null;
        updateDetectedUI();
        setSelectedVariant(null);
        showError(error && error.message ? error.message : 'Failed to resolve product variant.');
        if (uploadStatus) uploadStatus.textContent = '';
        syncPurchaseButtonsForCurrentState();
        return;
      }

      updateDetectedUI();
      if (!state.selectedResult || !state.selectedResult.selectedVariantId) {
        state.selectedResult = null;
        setSelectedVariant(null);
        showError('No product variant can fit this upload with the current quantity and available sheet sizes.');
        if (uploadStatus) uploadStatus.textContent = '';
        syncPurchaseButtonsForCurrentState();
        return;
      }

      clearError();
      setSelectedVariant(state.selectedResult.selectedVariantId);
      syncPurchaseButtonsForCurrentState();
      if (uploadStatus) {
        uploadStatus.textContent = 'Ready. Auto-selected variant: ' + (state.selectedResult.selectedVariantTitle || state.selectedResult.selectedSheetLabel || '');
      }
    }

    function resetUploadState() {
      resolveRequestToken += 1;
      uploadFlowToken += 1;
      state.uploadId = '';
      state.originalUrl = '';
      state.thumbnailUrl = '';
      state.fileName = '';
      state.widthPx = 0;
      state.heightPx = 0;
      state.trimmedWidthPx = 0;
      state.trimmedHeightPx = 0;
      state.trimmedOffsetXPx = 0;
      state.trimmedOffsetYPx = 0;
      state.embeddedDpi = 0;
      state.effectiveDpi = 0;
      state.sizingSource = null;
      state.measurementMode = null;
      state.widthIn = 0;
      state.heightIn = 0;
      state.selectedResult = null;
      state.lastFile = null;
      resetVipQuoteState();
      if (uploadInput) uploadInput.value = '';
      if (uploadFeedback) uploadFeedback.classList.add('hidden');
      if (uploadLoading) uploadLoading.classList.add('hidden');
      if (detectedBox) detectedBox.classList.add('hidden');
      if (uploadThumb) {
        uploadThumb.removeAttribute('src');
        uploadThumb.classList.add('hidden');
      }
      if (uploadStatus) uploadStatus.textContent = '';
      setSelectedVariant(getFallbackVariantId());
      clearError();
      resetActionLabels();
      updateVipPricingUI();
      syncPurchaseButtonsForCurrentState();
    }

    function updatePreview() {
      if (!uploadFeedback) return;
      uploadFeedback.classList.remove('hidden');
      if (uploadName) uploadName.textContent = state.fileName;
      var meta = [];
      if (state.widthPx && state.heightPx) meta.push(state.widthPx + ' x ' + state.heightPx + ' px');
      if (state.embeddedDpi) meta.push('File ' + state.embeddedDpi + ' DPI');
      meta.push(getSizingMethodText(state));
      if (state.lastFile && state.lastFile.size) meta.push((state.lastFile.size / (1024 * 1024)).toFixed(1) + ' MB');
      if (uploadMeta) uploadMeta.textContent = meta.join(' | ');

      var ext = (state.fileName.split('.').pop() || '').toLowerCase();
      var isNonBrowser = ['psd', 'pdf', 'ai', 'eps', 'tiff', 'tif'].indexOf(ext) >= 0;
      if (state.thumbnailUrl) {
        uploadThumb.src = state.thumbnailUrl;
        uploadThumb.classList.remove('hidden');
      } else if (!isNonBrowser && state.lastFile && state.lastFile.type && state.lastFile.type.indexOf('image/') === 0) {
        var reader = new FileReader();
        reader.onload = function(e) {
          uploadThumb.src = e.target.result;
          uploadThumb.classList.remove('hidden');
        };
        reader.readAsDataURL(state.lastFile);
      } else {
        uploadThumb.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><rect width="80" height="80" rx="10" fill="#f3f4f6"/><path d="M24 16h22l10 10v38H24z" fill="#e5e7eb" stroke="#9ca3af" stroke-width="2"/><text x="40" y="48" text-anchor="middle" font-size="12" font-family="Arial" fill="#374151">' + ext.toUpperCase() + '</text></svg>');
        uploadThumb.classList.remove('hidden');
      }
      updateVipPreviewUI();
    }

    function isAcceptedFile(file) {
      if (!uploadInput || !uploadInput.accept) return true;
      var acceptedValues = uploadInput.accept.split(',').map(function(value) {
        return String(value || '').trim().toLowerCase();
      }).filter(Boolean);
      if (!acceptedValues.length) return true;

      var fileName = String(file && file.name || '').toLowerCase();
      var mimeType = String(file && file.type || '').toLowerCase();
      for (var i = 0; i < acceptedValues.length; i++) {
        var acceptedValue = acceptedValues[i];
        if (acceptedValue.charAt(0) === '.' && fileName.slice(-acceptedValue.length) === acceptedValue) {
          return true;
        }
        if (acceptedValue.indexOf('/') > 0 && mimeType === acceptedValue) {
          return true;
        }
      }
      return false;
    }

    function getPreflightErrorMessage(statusPayload, item) {
      var lifecycleProblems =
        item && item.problems && item.problems.length
          ? item.problems
          : statusPayload && statusPayload.problems && statusPayload.problems.length
            ? statusPayload.problems
            : [];

      for (var j = 0; j < lifecycleProblems.length; j++) {
        if (lifecycleProblems[j] && lifecycleProblems[j].severity === 'error' && lifecycleProblems[j].message) {
          return lifecycleProblems[j].message;
        }
      }

      var checks =
        item &&
        item.preflightResult &&
        item.preflightResult.checks &&
        item.preflightResult.checks.length
          ? item.preflightResult.checks
          : [];

      for (var i = 0; i < checks.length; i++) {
        if (checks[i] && checks[i].status === 'error' && checks[i].message) {
          return checks[i].message;
        }
      }

      if (statusPayload && statusPayload.error) {
        return statusPayload.error;
      }

      return 'Upload processing failed on the server. Please try another file or contact support.';
    }

    async function pollUploadStatus(uploadId, uploadToken) {
      for (var attempts = 0; attempts < 60; attempts++) {
        if (uploadToken !== uploadFlowToken) return false;
        var response = await fetch(apiBase + '/api/upload/status/' + encodeURIComponent(uploadId) + '?shopDomain=' + encodeURIComponent(shopDomain));
        if (response.ok) {
          var data = await response.json();
          if (uploadToken !== uploadFlowToken) return false;
          var firstItem = data.items && data.items[0] ? data.items[0] : null;
          if (firstItem) {
            var measurementStatus = firstItem.measurementStatus || 'pending';
            var orderabilityStatus = data.orderabilityStatus || '';
            state.thumbnailUrl = firstItem.thumbnailUrl || data.thumbnailUrl || '';
            state.originalUrl = firstItem.originalUrl || data.downloadUrl || '';
            applyServerMeasurement(firstItem);
            if (measurementStatus === 'error' || orderabilityStatus === 'blocked' || data.status === 'error') {
              if (uploadLoading) uploadLoading.classList.add('hidden');
              if (uploadStatus) uploadStatus.textContent = '';
              state.selectedResult = null;
              setSelectedVariant(null);
              syncPurchaseButtonsForCurrentState();
              showError(getPreflightErrorMessage(data, firstItem));
              return false;
            }
            if (state.widthIn && state.heightIn && measurementStatus !== 'error') {
              if (customerPricing.status === 'loading' && customerPricingPromise) {
                await customerPricingPromise.catch(function() { return null; });
              }
              if (uploadLoading) uploadLoading.classList.add('hidden');
              updatePreview();
              if (hasCustomPricingActive()) {
                var vipQuoteData = await loadVipQuote();
                if (!vipQuoteData || customerPricing.quoteStatus !== 'ready' || customerPricing.quoteTotal == null) {
                  return false;
                }
              } else {
                await updateVariantResolution();
              }
              return true;
            }
          }
        }
        if (uploadLoadingText) uploadLoadingText.textContent = 'Waiting for server-confirmed print size...';
        if (uploadProgress) uploadProgress.style.width = Math.min(92, 25 + attempts) + '%';
        await new Promise(function(resolve) { setTimeout(resolve, 1500); });
      }
      if (uploadLoading) uploadLoading.classList.add('hidden');
      showError('Upload finished, but the server did not confirm print size in time. Please try again.');
      return false;
    }

    async function pollCustomQueueItemStatus(queueItem, uploadToken, batchMeta) {
      for (var attempts = 0; attempts < 60; attempts++) {
        if (!queueItem || queueItem.uploadToken !== uploadToken) return false;
        var response = await fetch(apiBase + '/api/upload/status/' + encodeURIComponent(queueItem.uploadId) + '?shopDomain=' + encodeURIComponent(shopDomain));
        if (response.ok) {
          var data = await response.json();
          if (!queueItem || queueItem.uploadToken !== uploadToken) return false;
          var firstItem = data.items && data.items[0] ? data.items[0] : null;
          if (firstItem) {
            queueItem.thumbnailUrl = firstItem.thumbnailUrl || data.thumbnailUrl || queueItem.thumbnailUrl || '';
            queueItem.originalUrl = firstItem.originalUrl || data.downloadUrl || queueItem.originalUrl || '';
            applyServerMeasurement(firstItem, queueItem);
            var measurementStatus = firstItem.measurementStatus || 'pending';
            var orderabilityStatus = data.orderabilityStatus || '';

            if (measurementStatus === 'error' || orderabilityStatus === 'blocked' || data.status === 'error') {
              queueItem.uploadStatus = 'error';
              queueItem.quoteStatus = 'error';
              queueItem.error = getPreflightErrorMessage(data, firstItem);
              updateCustomBatchProgressForFile(
                batchMeta,
                'Measurement failed for ' + (queueItem.fileName || 'uploaded file'),
                1,
                queueItem.error
              );
              renderCustomQueue();
              updateVipPreviewUI();
              syncPurchaseButtonsForCurrentState();
              return false;
            }

            if (queueItem.widthIn && queueItem.heightIn && measurementStatus !== 'error') {
              queueItem.uploadStatus = 'ready';
              queueItem.quoteStatus = 'processing';
              queueItem.error = '';
              updateCustomBatchProgressForFile(
                batchMeta,
                'Refreshing quote for ' + (queueItem.fileName || 'uploaded file'),
                0.94,
                'Server measurement is ready. Updating the combined custom quote.'
              );
              if (!state.activeCustomItemId) {
                setActiveCustomQueueItem(queueItem.uploadId || queueItem.id);
              }
              renderCustomQueue();
              updateVipPreviewUI();
              await loadVipQuote();
              if (queueItem.error) {
                updateCustomBatchProgressForFile(
                  batchMeta,
                  'Quote blocked for ' + (queueItem.fileName || 'uploaded file'),
                  1,
                  queueItem.error
                );
                renderCustomQueue();
                updateVipPreviewUI();
                syncPurchaseButtonsForCurrentState();
                return false;
              }
              updateCustomBatchProgressForFile(
                batchMeta,
                (queueItem.fileName || 'Uploaded file') + ' is ready',
                1,
                'Measured and added to the combined quote.'
              );
              return true;
            }
          }
        }

        queueItem.uploadStatus = 'processing';
        queueItem.quoteStatus = 'processing';
        updateCustomBatchProgressForFile(
          batchMeta,
          'Measuring ' + (queueItem.fileName || 'uploaded file'),
          Math.min(0.92, 0.82 + (attempts * 0.01)),
          'Waiting for the server to confirm the exact billed page size.'
        );
        renderCustomQueue();
        await new Promise(function(resolve) { setTimeout(resolve, 1500); });
      }

      queueItem.uploadStatus = 'error';
      queueItem.quoteStatus = 'error';
      queueItem.error = 'Upload finished, but the server did not confirm print size in time. Please try again.';
      updateCustomBatchProgressForFile(
        batchMeta,
        'Measurement timed out for ' + (queueItem.fileName || 'uploaded file'),
        1,
        queueItem.error
      );
      renderCustomQueue();
      updateVipPreviewUI();
      syncPurchaseButtonsForCurrentState();
      return false;
    }

    async function uploadSingleCustomPricingFile(file, batchMeta) {
      var queueItem = createCustomQueueItem(file);
      state.customItems = getCustomQueueItems().concat(queueItem);
      markCustomQueueQuoteDirty();
      if (!state.activeCustomItemId) {
        state.activeCustomItemId = queueItem.id;
      }
      updateCustomBatchProgressForFile(
        batchMeta,
        'Preparing ' + (file.name || 'uploaded file'),
        0.04,
        'Added to the queue and requesting an upload slot.'
      );
      renderCustomQueue();
      updateVipPricingUI();
      updateVipPreviewUI();
      syncPurchaseButtonsForCurrentState();

      var uploadToken = 'queue-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
      queueItem.uploadToken = uploadToken;
      resolveRequestToken += 1;
      clearError();

      try {
        updateCustomBatchProgressForFile(
          batchMeta,
          'Creating upload slot for ' + (file.name || 'uploaded file'),
          0.08,
          'Requesting a secure upload intent from the server.'
        );
        var intentRes = await fetch(apiBase + '/api/upload/intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shopDomain: shopDomain,
            productId: String(productData.productId),
            mode: 'dtf',
            fileName: file.name,
            contentType: file.type || 'application/octet-stream',
            fileSize: file.size,
            customerId: root.getAttribute('data-customer-id') || null,
            customerEmail: root.getAttribute('data-customer-email') || null,
            // Upgrades: content fingerprint (instant re-upload for the same
            // customer + file) and a part-size hint for multipart.
            fingerprint: await ulFingerprint(file),
            partSizeMb: file.size < 64 * 1024 * 1024 ? 8 : file.size < 512 * 1024 * 1024 ? 16 : 32
          })
        });
        if (!intentRes.ok) {
          var intentErr = await intentRes.json().catch(function() { return {}; });
          throw new Error(intentErr.error || 'Failed to create upload intent.');
        }

        var intent = await intentRes.json();
        if (queueItem.uploadToken !== uploadToken) return;
        queueItem.uploadId = intent.uploadId;
        queueItem.uploadStatus = 'uploading';
        queueItem.quoteStatus = 'uploading';
        updateCustomBatchProgressForFile(
          batchMeta,
          'Uploading ' + (file.name || 'uploaded file'),
          0.14,
          'File ' + (batchMeta && batchMeta.index ? batchMeta.index : 1) + ' is on its way to the server.'
        );
        renderCustomQueue();

        var uploadStartedAt = Date.now();

        await performUploadWithRetry(file, intent, function(loaded, total) {
          var fileRatio = total > 0 ? (loaded / total) : 0;
          updateCustomBatchProgressForFile(
            batchMeta,
            'Uploading ' + (file.name || 'uploaded file'),
            0.14 + (Math.max(0, Math.min(1, fileRatio)) * 0.56),
            (loaded / (1024 * 1024)).toFixed(1) + ' MB of ' + (total / (1024 * 1024)).toFixed(1) + ' MB uploaded.'
          );
        });

        if (queueItem.uploadToken !== uploadToken) return;

        queueItem.uploadStatus = 'processing';
        queueItem.quoteStatus = 'processing';
        updateCustomBatchProgressForFile(
          batchMeta,
          'Finalizing ' + (file.name || 'uploaded file'),
          0.76,
          'Upload completed. Registering the file and preparing measurement.'
        );
        renderCustomQueue();

        // Deduplicated intents reuse an already-measured upload: nothing to
        // transfer or finalize, the status poll below picks up the result.
        var completeRes = intent.deduplicated
          ? { ok: true, json: function() { return Promise.resolve({}); } }
          : await fetch(apiBase + '/api/upload/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shopDomain: shopDomain,
            uploadId: intent.uploadId,
            items: [{
              itemId: intent.itemId,
              location: 'front',
              fileUrl: intent.publicUrl || null,
              storageProvider: intent.storageProvider || 'local',
              fileSize: file.size,
              uploadDurationMs: Date.now() - uploadStartedAt
            }]
          })
        });
        if (!completeRes.ok) {
          var completeErr = await completeRes.json().catch(function() { return {}; });
          throw new Error(completeErr.error || 'Failed to finalize upload.');
        }
        if (queueItem.uploadToken !== uploadToken) return;

        updateCustomBatchProgressForFile(
          batchMeta,
          'Measuring ' + (file.name || 'uploaded file'),
          0.84,
          'The server is now confirming the exact billed page dimensions.'
        );
        await pollCustomQueueItemStatus(queueItem, uploadToken, batchMeta);
      } catch (error) {
        queueItem.uploadStatus = 'error';
        queueItem.quoteStatus = 'error';
        queueItem.error = error && error.message ? error.message : 'Upload failed.';
        updateCustomBatchProgressForFile(
          batchMeta,
          'Upload failed for ' + (file.name || 'uploaded file'),
          1,
          queueItem.error
        );
        renderCustomQueue();
        updateVipPreviewUI();
        syncPurchaseButtonsForCurrentState();
        showError(queueItem.error);
      }
    }

    async function handleCustomPricingFiles(fileList) {
      var files = Array.prototype.slice.call(fileList || []);
      if (!files.length) return;

      var validFiles = files.filter(function(file) {
        return isAcceptedFile(file);
      });

      files.forEach(function(file) {
        if (!isAcceptedFile(file)) {
          showError('Unsupported file format. Please upload PNG files only.');
        }
      });

      if (!validFiles.length) return;

      setCustomBatchProgress({
        active: true,
        total: validFiles.length,
        currentIndex: 1,
        completed: 0,
        stage: 'Preparing upload queue',
        meta: 'Your files will be uploaded and measured one by one.',
        progressRatio: 0.02
      });

      for (var i = 0; i < validFiles.length; i++) {
        var batchMeta = {
          index: i + 1,
          total: validFiles.length,
          fileName: validFiles[i] && validFiles[i].name ? validFiles[i].name : ''
        };
        await uploadSingleCustomPricingFile(validFiles[i], batchMeta);
        setCustomBatchProgress({
          active: true,
          total: validFiles.length,
          currentIndex: Math.min(validFiles.length, i + 1),
          completed: i + 1,
          fileName: batchMeta.fileName,
          stage: (i + 1 === validFiles.length ? 'Upload queue is ready' : 'Queued ' + (i + 1) + ' of ' + validFiles.length + ' files'),
          meta: (i + 1 === validFiles.length)
            ? 'Every valid upload has been processed and added to the combined quote.'
            : 'Moving to the next file in the queue.',
          progressRatio: (i + 1) / validFiles.length
        });
      }

      scheduleHideCustomBatchProgress(1400);
    }

    async function handleFile(file) {
      if (!file) return;
      if (!isAcceptedFile(file)) {
        showError('Unsupported file format. Please upload a PNG file.');
        return;
      }

      if (hasCustomPricingActive()) {
        await handleCustomPricingFiles([file]);
        return;
      }

      var uploadToken = ++uploadFlowToken;
      resolveRequestToken += 1;
      clearError();
      state.uploadId = '';
      state.originalUrl = '';
      state.thumbnailUrl = '';
      state.lastFile = file;
      state.fileName = file.name;
      state.widthPx = 0;
      state.heightPx = 0;
      state.trimmedWidthPx = 0;
      state.trimmedHeightPx = 0;
      state.trimmedOffsetXPx = 0;
      state.trimmedOffsetYPx = 0;
      state.embeddedDpi = 0;
      state.effectiveDpi = 0;
      state.sizingSource = null;
      state.measurementMode = null;
      state.widthIn = 0;
      state.heightIn = 0;
      state.selectedResult = null;
      resetVipQuoteState();
      if (uploadFeedback) uploadFeedback.classList.add('hidden');
      if (detectedBox) detectedBox.classList.add('hidden');
      if (uploadThumb) {
        uploadThumb.removeAttribute('src');
        uploadThumb.classList.add('hidden');
      }
      if (uploadLoading) uploadLoading.classList.remove('hidden');
      if (uploadLoadingText) uploadLoadingText.textContent = 'Preparing upload...';
      if (uploadProgress) uploadProgress.style.width = '12%';
      if (uploadStatus) uploadStatus.textContent = '';
      resetActionLabels();
      setSelectedVariant(getFallbackVariantId());
      updateVipPreviewUI();
      syncPurchaseButtonsForCurrentState();
      try {
        var intentRes = await fetch(apiBase + '/api/upload/intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shopDomain: shopDomain,
            productId: String(productData.productId),
            mode: 'dtf',
            fileName: file.name,
            contentType: file.type || 'application/octet-stream',
            fileSize: file.size,
            customerId: root.getAttribute('data-customer-id') || null,
            customerEmail: root.getAttribute('data-customer-email') || null,
            // Upgrades: content fingerprint (instant re-upload for the same
            // customer + file) and a part-size hint for multipart.
            fingerprint: await ulFingerprint(file),
            partSizeMb: file.size < 64 * 1024 * 1024 ? 8 : file.size < 512 * 1024 * 1024 ? 16 : 32
          })
        });
        if (!intentRes.ok) {
          var intentErr = await intentRes.json().catch(function() { return {}; });
          throw new Error(intentErr.error || 'Failed to create upload intent.');
        }
        var intent = await intentRes.json();
        if (uploadToken !== uploadFlowToken) return;
        state.uploadId = intent.uploadId;
        if (uploadLoadingText) uploadLoadingText.textContent = 'Uploading file...';
        if (uploadProgress) uploadProgress.style.width = '28%';
        var uploadStartedAt = Date.now();

        await performUploadWithRetry(file, intent, function(loaded, total) {
          if (uploadToken !== uploadFlowToken || !uploadProgress || !uploadLoadingText) return;
          var ratio = total > 0 ? (loaded / total) : 0;
          uploadProgress.style.width = (28 + (ratio * 42)) + '%';
          uploadLoadingText.textContent = 'Uploading ' + (loaded / (1024 * 1024)).toFixed(1) + ' / ' + (total / (1024 * 1024)).toFixed(1) + ' MB';
        });
        if (uploadToken !== uploadFlowToken) return;

        if (uploadLoadingText) uploadLoadingText.textContent = 'Finalizing upload...';
        if (uploadProgress) uploadProgress.style.width = '75%';
        // Deduplicated intents reuse an already-measured upload: nothing to
        // transfer or finalize, the status poll below picks up the result.
        var completeRes = intent.deduplicated
          ? { ok: true, json: function() { return Promise.resolve({}); } }
          : await fetch(apiBase + '/api/upload/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shopDomain: shopDomain,
            uploadId: intent.uploadId,
            items: [{
              itemId: intent.itemId,
              location: 'front',
              fileUrl: intent.publicUrl || null,
              storageProvider: intent.storageProvider || 'local',
              fileSize: file.size,
              uploadDurationMs: Date.now() - uploadStartedAt
            }]
          })
        });
        if (!completeRes.ok) {
          var completeErr = await completeRes.json().catch(function() { return {}; });
          throw new Error(completeErr.error || 'Failed to finalize upload.');
        }
        if (uploadToken !== uploadFlowToken) return;

        if (uploadLoadingText) uploadLoadingText.textContent = 'Detecting gang sheet size...';
        if (uploadProgress) uploadProgress.style.width = '85%';
        await pollUploadStatus(intent.uploadId, uploadToken);
      } catch (error) {
        if (uploadToken !== uploadFlowToken) return;
        state.uploadId = '';
        state.originalUrl = '';
        state.thumbnailUrl = '';
        state.selectedResult = null;
        state.trimmedWidthPx = 0;
        state.trimmedHeightPx = 0;
        state.trimmedOffsetXPx = 0;
        state.trimmedOffsetYPx = 0;
        if (uploadLoading) uploadLoading.classList.add('hidden');
        updateVipPreviewUI();
        syncPurchaseButtonsForCurrentState();
        showError(error && error.message ? error.message : 'Upload failed.');
      }
    }

    function setActiveThumbnail(button) {
      thumbButtons.forEach(function(item) {
        item.classList.remove('is-active');
      });
      if (button) button.classList.add('is-active');
    }

    async function addConfiguredItem(redirectPath, triggerButton) {
      if (uploadRequired && !state.uploadId) {
        showError('Please upload your design first.');
        return;
      }
      var isVip = isVipPricingActive();
      var isCustomPricing = hasCustomPricingActive();
      var variantId = state.selectedVariantId || (hiddenVariantInput ? hiddenVariantInput.value : '') || getFallbackVariantId();
      if (!isCustomPricing && !variantId) {
        showError('Please select a product variant first.');
        return;
      }
      if (!isCustomPricing && uploadRequired && !state.selectedResult) {
        showError('Please upload your design first.');
        return;
      }
      if (isCustomPricing && (customerPricing.quoteStatus !== 'ready' || customerPricing.quoteTotal == null)) {
        showError((isBusinessPricingActive() ? 'Business pricing' : 'VIP pricing') + ' is still loading. Please wait for the quote to finish.');
        return;
      }

      clearError();
      setPurchaseButtonsDisabled(true);
      resetActionLabels();
      if (triggerButton) {
        triggerButton.textContent = redirectPath === '/checkout' ? 'Buying...' : 'Adding...';
      }

      try {
        if (isCustomPricing) {
          var customItemsPayload = hasCustomQueueItems()
            ? getCustomQueueReadyItems().map(function(item) {
                return {
                  uploadId: item.uploadId,
                  quantity: item.requestedQuantity || 1,
                  selectedVariantId: item.selectedVariantId || ''
                };
              }).filter(function(item) {
                return item.uploadId;
              })
            : [];
          var vipResponse = await fetch(apiBase + '/api/vip/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
              shopDomain: shopDomain,
              productId: String(productData.productId),
              uploadId: state.uploadId,
              items: customItemsPayload,
              customerId: root.getAttribute('data-customer-id') || '',
              customerEmail: root.getAttribute('data-customer-email') || '',
              customerType: customerPricing.customerType,
              statusKey: customerPricing.statusKey,
              pricePerInch: customerPricing.pricePerInch,
              measurementPolicy: MAIN_PRODUCT_MEASUREMENT_POLICY,
              rollWidthIn: MAIN_PRODUCT_ROLL_WIDTH_IN,
              selectedVariantId:
                customerPricing.quoteVariantId ||
                (state.selectedResult && state.selectedResult.selectedVariantId) ||
                state.selectedVariantId ||
                '',
              billableLengthIn: customerPricing.quoteLengthIn || getBillablePageLengthIn(),
              quantity: isBusinessPricingActive() ? state.quantity : 1
            })
          });
          var vipData = await vipResponse.json().catch(function() { return {}; });
          if (!vipResponse.ok) {
            throw new Error(vipData.error || 'Failed to create custom checkout.');
          }
          if (vipData.quoteTotal != null) {
            customerPricing.quoteTotal = parsePositiveNumber(vipData.quoteTotal);
          } else if (vipData.exactTotal != null) {
            customerPricing.quoteTotal = parsePositiveNumber(vipData.exactTotal);
          }
          if (customerPricing.quoteTotal != null) {
            customerPricing.currency = String(vipData.currency || customerPricing.currency || 'USD');
            updateVipPricingUI();
          }
          window.location.href = vipData.checkoutUrl || vipData.redirectUrl || vipData.url || redirectPath;
          return;
        }

        var quantityValue = quantitySelect ? parseInt(quantitySelect.value || '1', 10) || 1 : 1;
        // Exactly the three customer-visible line properties every block
        // writes (Print Ready, Sheet Identity, DPI), built by the server;
        // copies / sheet facts are persisted on the upload row.
        var properties = uploadRequired && window.ULLineProperties
          ? await window.ULLineProperties.build({
              uploadId: state.uploadId,
              fileUrl: state.originalUrl || '',
              dpi: state.effectiveDpi || state.embeddedDpi || 0,
              line: {
                copies: quantityValue,
                designsPerSheet: state.selectedResult ? state.selectedResult.designsPerSheet : null,
                sheetsNeeded: state.selectedResult ? state.selectedResult.sheetsNeeded : null,
                variantId: String(variantId || ''),
                sheetLabel: state.selectedResult ? (state.selectedResult.selectedSheetLabel || state.selectedResult.selectedVariantTitle || '') : ''
              }
            })
          : {};

        var response = await fetch('/cart/add.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: [{
              id: parseInt(variantId, 10),
              quantity: state.selectedResult ? state.selectedResult.sheetsNeeded : quantityValue,
              properties: properties
            }]
          })
        });
        if (!response.ok) {
          var err = await response.json().catch(function() { return {}; });
          throw new Error(err.description || 'Failed to add to cart.');
        }
        window.location.href = redirectPath;
      } catch (error) {
        showError(error && error.message ? error.message : 'Failed to add to cart.');
        resetActionLabels();
        syncPurchaseButtonsForCurrentState();
      }
    }

    if (uploadInput) {
      uploadInput.addEventListener('change', function(e) {
        if (e.target.files && e.target.files.length) {
          if (hasCustomPricingActive()) {
            handleCustomPricingFiles(e.target.files);
          } else if (e.target.files[0]) {
            handleFile(e.target.files[0]);
          }
        }
      });
    }

    if (uploadTrigger && uploadInput) {
      uploadTrigger.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          uploadInput.click();
        }
      });
    }

    if (uploadBox) {
      uploadBox.addEventListener('dragover', function(e) {
        e.preventDefault();
      });
      uploadBox.addEventListener('drop', function(e) {
        e.preventDefault();
        if (e.dataTransfer.files && e.dataTransfer.files.length) {
          if (hasCustomPricingActive()) {
            handleCustomPricingFiles(e.dataTransfer.files);
          } else if (e.dataTransfer.files[0]) {
            handleFile(e.dataTransfer.files[0]);
          }
        }
      });
    }

    if (customQueueEl) {
      customQueueEl.addEventListener('click', function(event) {
        var qtyButton = event.target.closest('[data-queue-qty]');
        if (qtyButton) {
          var queueItem = getCustomQueueItemById(qtyButton.getAttribute('data-queue-qty'));
          if (!queueItem) return;
          var delta = parseInt(qtyButton.getAttribute('data-delta') || '0', 10) || 0;
          var nextQuantity = Math.max(1, (queueItem.requestedQuantity || 1) + delta);
          queueItem.requestedQuantity = nextQuantity;
          queueItem.quoteStatus = queueItem.uploadStatus === 'ready' ? 'processing' : queueItem.quoteStatus;
          markCustomQueueQuoteDirty();
          if (String(state.activeCustomItemId) === String(queueItem.uploadId || queueItem.id)) {
            setActiveCustomQueueItem(queueItem.uploadId || queueItem.id);
          }
          renderCustomQueue();
          updateVipPricingUI();
          updateVipPreviewUI();
          loadVipQuote();
          return;
        }

        var removeButton = event.target.closest('[data-queue-remove]');
        if (removeButton) {
          removeCustomQueueItem(removeButton.getAttribute('data-queue-remove'));
          markCustomQueueQuoteDirty();
          renderCustomQueue();
          if (!hasCustomQueueItems()) {
            resetVipQuoteState();
            setSelectedVariant(getFallbackVariantId());
          } else {
            loadVipQuote();
          }
          updateVipPricingUI();
          updateVipPreviewUI();
          syncPurchaseButtonsForCurrentState();
          return;
        }

        var activateButton = event.target.closest('[data-queue-activate]');
        if (activateButton) {
          setActiveCustomQueueItem(activateButton.getAttribute('data-queue-activate'));
          renderCustomQueue();
          updateVipPreviewUI();
          return;
        }
      });

      customQueueEl.addEventListener('change', function(event) {
        var input = event.target.closest('[data-queue-qty-input]');
        if (!input) return;
        var queueItem = getCustomQueueItemById(input.getAttribute('data-queue-qty-input'));
        if (!queueItem) return;
        var nextQuantity = parseInt(input.value || '1', 10) || 1;
        if (nextQuantity < 1) nextQuantity = 1;
        input.value = String(nextQuantity);
        queueItem.requestedQuantity = nextQuantity;
        queueItem.quoteStatus = queueItem.uploadStatus === 'ready' ? 'processing' : queueItem.quoteStatus;
        markCustomQueueQuoteDirty();
        if (String(state.activeCustomItemId) === String(queueItem.uploadId || queueItem.id)) {
          setActiveCustomQueueItem(queueItem.uploadId || queueItem.id);
        }
        renderCustomQueue();
        updateVipPricingUI();
        updateVipPreviewUI();
        loadVipQuote();
      });
    }

    if (customerWorkspaceList) {
      customerWorkspaceList.addEventListener('click', function(event) {
        var qtyButton = event.target.closest('[data-workspace-qty]');
        if (qtyButton) {
          var workspaceItem = getWorkspaceItemById(qtyButton.getAttribute('data-workspace-qty'));
          if (!workspaceItem) return;
          var delta = parseInt(qtyButton.getAttribute('data-delta') || '0', 10) || 0;
          workspaceItem.requestedQuantity = Math.max(1, (workspaceItem.requestedQuantity || workspaceItem.lastOrderedQuantity || 1) + delta);
          renderCustomerWorkspace();
          return;
        }

        var addButton = event.target.closest('[data-workspace-add]');
        if (addButton) {
          addWorkspaceItemToQueue(getWorkspaceItemById(addButton.getAttribute('data-workspace-add')));
          return;
        }

        var buyButton = event.target.closest('[data-workspace-buy]');
        if (buyButton) {
          checkoutWorkspaceItem(getWorkspaceItemById(buyButton.getAttribute('data-workspace-buy')));
        }
      });

      customerWorkspaceList.addEventListener('change', function(event) {
        var input = event.target.closest('[data-workspace-qty-input]');
        if (!input) return;
        var workspaceItem = getWorkspaceItemById(input.getAttribute('data-workspace-qty-input'));
        if (!workspaceItem) return;
        var nextQuantity = parseInt(input.value || '1', 10) || 1;
        if (nextQuantity < 1) nextQuantity = 1;
        workspaceItem.requestedQuantity = nextQuantity;
        input.value = String(nextQuantity);
        renderCustomerWorkspace();
      });
    }

    if (vipPreviewSelect) {
      vipPreviewSelect.addEventListener('change', function() {
        if (!vipPreviewSelect.value) return;
        setActiveCustomQueueItem(vipPreviewSelect.value);
        renderCustomQueue();
        updateVipPreviewUI();
      });
    }

    if (uploadRemove) {
      uploadRemove.addEventListener('click', function() {
        resetUploadState();
      });
    }

    if (vipPreviewStageWrap) {
      vipPreviewStageWrap.addEventListener('scroll', syncVipPreviewRulers);
    }

    window.addEventListener('resize', function() {
      updateVipPreviewUI();
    });

    if (quantitySelect) {
      function syncQuantityValue() {
        var nextQuantity = parseInt(quantitySelect.value || '1', 10) || 1;
        if (nextQuantity < 1) nextQuantity = 1;
        quantitySelect.value = String(nextQuantity);
        state.quantity = nextQuantity;
        if (state.uploadId) {
          if (hasCustomPricingActive()) loadVipQuote();
          else updateVariantResolution();
        }
      }

      quantitySelect.addEventListener('change', syncQuantityValue);
      quantitySelect.addEventListener('input', syncQuantityValue);
    }

    if (variantSelect) {
      variantSelect.addEventListener('change', function() {
        state.preferredVariantId = variantSelect.value || null;
        setSelectedVariant(state.preferredVariantId);
        if (state.uploadId) {
          if (hasCustomPricingActive()) loadVipQuote();
          else updateVariantResolution();
        } else {
          syncPurchaseButtonsForCurrentState();
        }
      });
    }

    thumbButtons.forEach(function(button, index) {
      if (index === 0) setActiveThumbnail(button);
      button.addEventListener('click', function() {
        setActiveThumbnail(button);
        setMainProductImage(button.getAttribute('data-image-url'));
      });
    });

    accordionTriggers.forEach(function(trigger) {
      trigger.addEventListener('click', function() {
        var targetId = trigger.getAttribute('data-target');
        if (!targetId) return;
        var target = document.getElementById(targetId);
        var willOpen = target ? target.classList.contains('hidden') : false;

        accordionTriggers.forEach(function(otherTrigger) {
          var otherTargetId = otherTrigger.getAttribute('data-target');
          var otherTarget = otherTargetId ? document.getElementById(otherTargetId) : null;
          var otherIcon = otherTrigger.querySelector('.js-accordion-icon');
          if (otherTarget) otherTarget.classList.add('hidden');
          otherTrigger.setAttribute('aria-expanded', 'false');
          if (otherIcon) otherIcon.classList.remove('is-open');
        });

        if (target && willOpen) target.classList.remove('hidden');
        trigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
        var icon = trigger.querySelector('.js-accordion-icon');
        if (icon && willOpen) icon.classList.add('is-open');
      });
    });

    if (addToCartBtn) {
      addToCartBtn.addEventListener('click', function() {
        addConfiguredItem('/cart', addToCartBtn);
      });
    }

    if (buyNowBtn) {
      buyNowBtn.addEventListener('click', function() {
        addConfiguredItem('/checkout', buyNowBtn);
      });
    }

    if (inlinePricingButton) {
      inlinePricingButton.addEventListener('click', function() {
        addConfiguredItem('/checkout', inlinePricingButton);
      });
    }

    if (customerLoginLink) {
      customerLoginLink.addEventListener('click', function(event) {
        event.preventDefault();
        openCustomerLoginPopup();
      });
    }

    window.addEventListener('message', handleCustomerLoginMessage);

    updateCustomerStatusUI();
    syncUploadInputMode();
    customerPricingPromise = loadCustomerPricingContext();
    setSelectedVariant(getFallbackVariantId());
    updateVipPreviewUI();
    syncPurchaseButtonsForCurrentState();
  })();
