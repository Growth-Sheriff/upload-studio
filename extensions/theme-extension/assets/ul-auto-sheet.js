/* ============================================================
   UL Auto Sheet - Main Orchestrator + Modal Manager
   Version: 1.0.0
   Ties together DimensionReader, NestingEngine, Optimizer, Simulator
   Namespace: window.ULAutoSheet
   
   Dependencies:
     - ul-dimension-reader.js (window.ULDimensionReader)
     - ul-nesting-engine.js (window.ULNestingEngine)
     - ul-sheet-optimizer.js (window.ULSheetOptimizer)
     - ul-sheet-simulator.js (window.ULSheetSimulator)
     - ul-auto-sheet.css
   ============================================================ */

(function () {
  'use strict';

  if (window.ULAutoSheet) return;

  /* ─────────────────────────────────────────────
     State
     ───────────────────────────────────────────── */
  var state = {
    initialized: false,
    config: null,        // From storefront config API
    file: null,          // Uploaded File object
    dimensions: null,    // DimensionResult
    thumbnail: '',       // Data URL
    quantity: 1,
    variants: [],        // Shopify variants
    sheets: [],          // SheetSpec[] parsed from variants
    results: [],         // NestingResult[] from nestAllVariants
    optimization: null,  // OptimizationResult from optimizer
    selectedResult: null,// Currently selected NestingResult
    currentSheetIndex: 0,// Which sheet page to show in simulator
    simulator: null,     // SheetSimulator instance
    productId: '',
    shopDomain: '',
    modalEl: null,       // Modal DOM element
    onSelect: null,      // Callback when user selects a variant
  };

  /* ─────────────────────────────────────────────
     Default Config
     ───────────────────────────────────────────── */
  var DEFAULT_CONFIG = {
    enabled: false,
    gapMm: 3,
    marginMm: 5,
    allowRotation: true,
    strategy: 'balanced',
    showSimulator: true,
    showAlternatives: true,
    showComparison: true,
    showQuantitySuggestion: true,
  };

  /* ─────────────────────────────────────────────
     Initialization
     ───────────────────────────────────────────── */

  /**
   * Initialize Auto Sheet with config from storefront API
   * @param {Object} config - autoSheet config from API
   */
  function init(config) {
    state.config = Object.assign({}, DEFAULT_CONFIG, config || {});
    state.initialized = true;

    // Listen for events from the upload flow
    if (window.ULEvents) {
      window.ULEvents.on('uploadComplete', handleUploadComplete);
    }

    console.log('[ULAutoSheet] Initialized', state.config.enabled ? 'ENABLED' : 'DISABLED');
  }

  /**
   * Check if auto sheet is enabled
   * @returns {boolean}
   */
  function isEnabled() {
    return state.initialized && state.config && state.config.enabled;
  }

  /* ─────────────────────────────────────────────
     Modal Creation
     ───────────────────────────────────────────── */

  /**
   * Create the modal DOM structure
   * @returns {HTMLElement}
   */
  function createModal() {
    if (state.modalEl) return state.modalEl;

    var modal = document.createElement('div');
    modal.className = 'ul-sheet-modal';
    modal.id = 'ul-auto-sheet-modal';
    modal.innerHTML = buildModalHTML();

    document.body.appendChild(modal);
    state.modalEl = modal;

    bindModalEvents(modal);

    return modal;
  }

  /**
   * Build the modal HTML
   * @returns {string}
   */
  function buildModalHTML() {
    return [
      '<div class="ul-sheet-modal-overlay" data-action="close"></div>',
      '<div class="ul-sheet-modal-container">',
      
      // ── Header ──
      '  <div class="ul-sheet-header">',
      '    <div class="ul-sheet-header-left">',
      '      <div class="ul-sheet-header-icon">',
      '        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 3v18"/></svg>',
      '      </div>',
      '      <div>',
      '        <h3 class="ul-sheet-header-title">Smart Sheet Calculator</h3>',
      '        <p class="ul-sheet-header-subtitle">Find the optimal sheet size for your design</p>',
      '      </div>',
      '    </div>',
      '    <button class="ul-sheet-close" data-action="close" aria-label="Close">&times;</button>',
      '  </div>',

      // ── Body ──
      '  <div class="ul-sheet-body">',

      // Loading state
      '    <div id="ul-sheet-loading" class="ul-sheet-loading" style="display:none;">',
      '      <div class="ul-sheet-spinner"></div>',
      '      <span class="ul-sheet-loading-text">Analyzing your design...</span>',
      '    </div>',

      // Content (two-column layout)
      '    <div id="ul-sheet-content" class="ul-sheet-layout">',

      // ── Left Column: Controls + Results ──
      '      <div class="ul-sheet-left-col">',

      // Design info card
      '        <div class="ul-sheet-design-info" id="ul-sheet-design-info">',
      '          <img class="ul-sheet-design-thumb" id="ul-sheet-thumb" src="" alt="Design">',
      '          <div class="ul-sheet-design-meta">',
      '            <p class="ul-sheet-design-name" id="ul-sheet-filename">design.png</p>',
      '            <p class="ul-sheet-design-dims" id="ul-sheet-dims">',
      '              <strong id="ul-sheet-dims-inch">0" × 0"</strong>',
      '              <span id="ul-sheet-dims-px"> · 0 × 0 px</span>',
      '              <span id="ul-sheet-dpi-badge"></span>',
      '            </p>',
      '          </div>',
      '        </div>',

      // DPI selector (always visible, 300 default)
      '        <div id="ul-sheet-dpi-override" class="ul-sheet-dpi-section">',
      '          <span class="ul-sheet-dpi-label">Print DPI:</span>',
      '          <div class="ul-sheet-dpi-buttons">',
      '            <button type="button" class="ul-sheet-dpi-btn" data-action="set-dpi" data-dpi="72">72</button>',
      '            <button type="button" class="ul-sheet-dpi-btn" data-action="set-dpi" data-dpi="150">150</button>',
      '            <button type="button" class="ul-sheet-dpi-btn ul-sheet-dpi-btn--active" data-action="set-dpi" data-dpi="300">300</button>',
      '            <button type="button" class="ul-sheet-dpi-btn" data-action="set-dpi" data-dpi="600">600</button>',
      '          </div>',
      '        </div>',

      // Dimension override inputs
      '        <div class="ul-sheet-dim-override">',
      '          <span class="ul-sheet-dim-label">Design Size (inches):</span>',
      '          <div class="ul-sheet-dim-inputs">',
      '            <input type="number" class="ul-sheet-dim-input" id="ul-sheet-dim-w" step="0.1" min="0.1" max="999" placeholder="W">',
      '            <span class="ul-sheet-dim-x">×</span>',
      '            <input type="number" class="ul-sheet-dim-input" id="ul-sheet-dim-h" step="0.1" min="0.1" max="999" placeholder="H">',
      '            <span class="ul-sheet-dim-unit">in</span>',
      '          </div>',
      '        </div>',

      // All sheets list (shows fit/no-fit)
      '        <div id="ul-sheet-all-sheets" class="ul-sheet-all-sheets"></div>',

      // Quantity row
      '        <div class="ul-sheet-quantity-row">',
      '          <span class="ul-sheet-quantity-label">How many copies?</span>',
      '          <div class="ul-sheet-quantity-wrapper">',
      '            <button type="button" class="ul-sheet-quantity-btn" data-action="qty-dec">−</button>',
      '            <input type="number" class="ul-sheet-quantity-input" id="ul-sheet-qty" value="1" min="1" max="9999">',
      '            <button type="button" class="ul-sheet-quantity-btn" data-action="qty-inc">+</button>',
      '          </div>',
      '        </div>',

      // Quantity suggestion
      '        <div id="ul-sheet-qty-suggestion" class="ul-sheet-info-banner ul-sheet-info-banner--info" style="display:none;">',
      '          <svg class="ul-sheet-info-banner-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>',
      '          <span class="ul-sheet-info-banner-text" id="ul-sheet-qty-suggestion-text"></span>',
      '        </div>',

      // Recommended result
      '        <div id="ul-sheet-recommended" style="display:none;"></div>',

      // Alternatives
      '        <div id="ul-sheet-alternatives" style="display:none;"></div>',

      // Comparison table
      '        <div id="ul-sheet-comparison" style="display:none;"></div>',

      '      </div>',

      // ── Right Column: Simulator ──
      '      <div class="ul-sheet-right-col">',
      '        <div class="ul-sheet-simulator" id="ul-sheet-simulator-wrap" style="display:none;">',
      '          <div class="ul-sheet-simulator-header">',
      '            <span class="ul-sheet-simulator-title">',
      '              <span class="ul-sheet-pulse"></span>',
      '              Layout Preview',
      '            </span>',
      '            <div class="ul-sheet-simulator-controls">',
      '              <button class="ul-sheet-sim-control" data-action="toggle-grid" title="Toggle grid">⊞</button>',
      '              <button class="ul-sheet-sim-control" data-action="toggle-margins" title="Toggle margins">▣</button>',
      '            </div>',
      '          </div>',
      '          <div class="ul-sheet-canvas-wrapper">',
      '            <canvas id="ul-sheet-canvas" class="ul-sheet-canvas"></canvas>',
      '            <span class="ul-sheet-canvas-label" id="ul-sheet-canvas-label"></span>',
      '          </div>',

      // Sheet navigation
      '          <div class="ul-sheet-nav" id="ul-sheet-nav" style="display:none;">',
      '            <button class="ul-sheet-nav-btn" data-action="prev-sheet" title="Previous sheet">‹</button>',
      '            <span class="ul-sheet-nav-text" id="ul-sheet-nav-text">Sheet 1 of 1</span>',
      '            <button class="ul-sheet-nav-btn" data-action="next-sheet" title="Next sheet">›</button>',
      '          </div>',
      '        </div>',

      // Savings banner
      '        <div id="ul-sheet-savings" class="ul-sheet-info-banner ul-sheet-info-banner--success" style="display:none;">',
      '          <svg class="ul-sheet-info-banner-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>',
      '          <span class="ul-sheet-info-banner-text" id="ul-sheet-savings-text"></span>',
      '        </div>',

      '      </div>',
      '    </div>',

      '  </div>',

      // ── Footer ──
      '  <div class="ul-sheet-footer">',
      '    <div class="ul-sheet-footer-info" id="ul-sheet-footer-info"></div>',
      '    <div class="ul-sheet-footer-actions">',
      '      <button class="ul-sheet-btn ul-sheet-btn--secondary" data-action="close">Cancel</button>',
      '      <button class="ul-sheet-btn ul-sheet-btn--primary" id="ul-sheet-apply-btn" data-action="apply" disabled>',
      '        Apply Selection',
      '      </button>',
      '    </div>',
      '  </div>',

      '</div>',
    ].join('\n');
  }

  /* ─────────────────────────────────────────────
     Modal Events
     ───────────────────────────────────────────── */

  function bindModalEvents(modal) {
    // Delegated click handler
    modal.addEventListener('click', function (e) {
      var target = e.target;
      var action = target.closest('[data-action]');
      if (!action) return;

      var act = action.dataset.action;
      e.preventDefault();
      e.stopPropagation();

      switch (act) {
        case 'close':
          closeModal();
          break;
        case 'apply':
          applySelection();
          break;
        case 'qty-dec':
          changeQuantity(-1);
          break;
        case 'qty-inc':
          changeQuantity(1);
          break;
        case 'toggle-grid':
          if (state.simulator) state.simulator.toggleGrid();
          break;
        case 'toggle-margins':
          if (state.simulator) state.simulator.toggleMargins();
          break;
        case 'prev-sheet':
          navigateSheet(-1);
          break;
        case 'next-sheet':
          navigateSheet(1);
          break;
        case 'set-qty':
          var setQtyVal = parseInt(action.dataset.qty, 10);
          if (!isNaN(setQtyVal) && setQtyVal > 0) {
            state.quantity = setQtyVal;
            var setQtyInput = state.modalEl.querySelector('#ul-sheet-qty');
            if (setQtyInput) setQtyInput.value = setQtyVal;
            recalculate();
          }
          break;
        case 'set-dpi':
          var setDpiVal = parseInt(action.dataset.dpi, 10);
          if (state.dimensions && !isNaN(setDpiVal) && setDpiVal > 0) {
            state.dimensions.dpi = setDpiVal;
            state.dimensions.widthInch = parseFloat((state.dimensions.widthPx / setDpiVal).toFixed(2));
            state.dimensions.heightInch = parseFloat((state.dimensions.heightPx / setDpiVal).toFixed(2));
            state.dimensions.widthCm = parseFloat((state.dimensions.widthInch * 2.54).toFixed(2));
            state.dimensions.heightCm = parseFloat((state.dimensions.heightInch * 2.54).toFixed(2));
            state.dimensions.source = 'manual';
            state.dimensions.dpiFromExif = true;
            updateDesignInfo();
            recalculate();
            var dpiButtons = state.modalEl.querySelectorAll('[data-action="set-dpi"]');
            for (var di = 0; di < dpiButtons.length; di++) {
              dpiButtons[di].classList.toggle('ul-sheet-dpi-btn--active', dpiButtons[di].dataset.dpi === String(setDpiVal));
            }
          }
          break;
        default:
          break;
      }
    });

    // Alternative items click handler
    modal.addEventListener('click', function (e) {
      var altItem = e.target.closest('[data-variant-id]');
      if (!altItem) return;
      e.preventDefault();
      var variantId = altItem.dataset.variantId;
      selectVariant(variantId);
    });

    // Quantity input change
    var qtyInput = modal.querySelector('#ul-sheet-qty');
    if (qtyInput) {
      qtyInput.addEventListener('input', function () {
        var val = parseInt(this.value, 10);
        if (!isNaN(val) && val > 0) {
          state.quantity = val;
          recalculate();
        }
      });

      qtyInput.addEventListener('blur', function () {
        var val = parseInt(this.value, 10);
        if (isNaN(val) || val < 1) {
          this.value = 1;
          state.quantity = 1;
          recalculate();
        }
      });
    }

    // Dimension override inputs
    var dimW = modal.querySelector('#ul-sheet-dim-w');
    var dimH = modal.querySelector('#ul-sheet-dim-h');

    function handleDimChange() {
      if (!state.dimensions) return;
      var w = parseFloat(dimW ? dimW.value : 0);
      var h = parseFloat(dimH ? dimH.value : 0);
      if (w > 0 && h > 0) {
        state.dimensions.widthInch = w;
        state.dimensions.heightInch = h;
        // Recalculate px from new inches and current DPI
        state.dimensions.widthPx = Math.round(w * state.dimensions.dpi);
        state.dimensions.heightPx = Math.round(h * state.dimensions.dpi);
        state.dimensions.widthCm = parseFloat((w * 2.54).toFixed(2));
        state.dimensions.heightCm = parseFloat((h * 2.54).toFixed(2));
        state.dimensions.source = 'manual';
        updateDesignInfo();
        recalculate();
      }
    }

    if (dimW) {
      dimW.addEventListener('input', handleDimChange);
    }
    if (dimH) {
      dimH.addEventListener('input', handleDimChange);
    }

    // Escape key
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.classList.contains('ul-sheet-modal--visible')) {
        closeModal();
      }
    });
  }

  /* ─────────────────────────────────────────────
     Modal Open / Close
     ───────────────────────────────────────────── */

  /**
   * Open the auto sheet modal
   * @param {Object} params
   * @param {File} params.file - Uploaded file
   * @param {Array} params.variants - Shopify product variants
   * @param {string} params.productId - Product ID
   * @param {string} params.shopDomain - Shop domain
   * @param {number} params.quantity - Initial quantity
   * @param {Function} params.onSelect - Callback(variantId, sheetsNeeded)
   */
  function openModal(params) {
    if (!params || !params.file) {
      console.warn('[ULAutoSheet] No file provided');
      return;
    }

    // Lazy re-init: if config was loaded after initial init, re-read it
    if (!isEnabled()) {
      try {
        var sc = (window.ULState && typeof window.ULState.get === 'function')
          ? window.ULState.get('storefrontConfig') : null;
        if (sc && sc.autoSheet) {
          state.config = Object.assign({}, DEFAULT_CONFIG, sc.autoSheet);
          console.log('[ULAutoSheet] Re-initialized from storefront config, enabled:', state.config.enabled);
        }
      } catch (e) { /* ignore */ }
    }

    if (!isEnabled()) {
      console.log('[ULAutoSheet] Feature not enabled');
      return;
    }

    var modal = createModal();

    // Reset state
    state.file = params.file;
    state.variants = params.variants || [];
    state.productId = params.productId || '';
    state.shopDomain = params.shopDomain || '';
    state.quantity = params.quantity || 1;
    state.onSelect = params.onSelect || null;
    state.currentSheetIndex = 0;
    state.selectedResult = null;
    state.dimensions = null;
    state.thumbnail = '';

    // Parse variants to sheets
    state.sheets = window.ULNestingEngine
      ? window.ULNestingEngine.variantsToSheets(state.variants)
      : [];

    console.log('[ULAutoSheet] Parsed', state.sheets.length, 'sheets from', state.variants.length, 'variants');
    if (state.sheets.length > 0) {
      console.log('[ULAutoSheet] Sheets:', state.sheets.map(function(s){ return s.name + ' ($' + s.price + ')'; }).join(', '));
    } else {
      console.warn('[ULAutoSheet] Variant titles:', state.variants.map(function(v){ return v.title || v.option1 || 'N/A'; }).join(', '));
    }

    if (state.sheets.length === 0) {
      console.warn('[ULAutoSheet] No valid sheet sizes found in variants');
      // Show modal with an error instead of silently returning
      var modal = createModal();
      modal.classList.add('ul-sheet-modal--visible');
      document.body.style.overflow = 'hidden';
      showLoading(false);
      showError(
        'No sheet sizes detected in the product variants. ' +
        'Variant names must include dimensions (e.g., \u201c22 \u00d7 30\u201d).'
      );
      return;
    }

    // Show modal
    modal.classList.add('ul-sheet-modal--visible');
    document.body.style.overflow = 'hidden';

    // Set quantity input
    var qtyInput = modal.querySelector('#ul-sheet-qty');
    if (qtyInput) qtyInput.value = state.quantity;

    // Show loading
    showLoading(true);
    hideContent();

    // Analyze design
    analyzeDesign();
  }

  /**
   * Close the modal
   */
  function closeModal() {
    if (state.modalEl) {
      state.modalEl.classList.remove('ul-sheet-modal--visible');
    }
    document.body.style.overflow = '';

    // Destroy simulator to free memory
    if (state.simulator) {
      state.simulator.destroy();
      state.simulator = null;
    }
  }

  /* ─────────────────────────────────────────────
     Design Analysis
     ───────────────────────────────────────────── */

  async function analyzeDesign() {
    try {
      var reader = window.ULDimensionReader;
      if (!reader) {
        throw new Error('ULDimensionReader not loaded');
      }

      // Read dimensions and thumbnail in parallel
      var dimPromise = reader.readDimensions(state.file);
      var thumbPromise = reader.getThumbnail(state.file, 120);

      var results = await Promise.all([dimPromise, thumbPromise]);
      state.dimensions = results[0];
      state.thumbnail = results[1];

      // Update UI
      updateDesignInfo();
      showLoading(false);
      showContent();

      // Calculate
      recalculate();
    } catch (err) {
      console.error('[ULAutoSheet] Analysis failed:', err);
      showLoading(false);
      showError('Could not analyze your design. Please try again.');
    }
  }

  /**
   * Update the design info card with dimensions
   */
  function updateDesignInfo() {
    if (!state.modalEl || !state.dimensions) return;

    var dims = state.dimensions;
    var reader = window.ULDimensionReader;

    // Thumbnail
    var thumbEl = state.modalEl.querySelector('#ul-sheet-thumb');
    if (thumbEl && state.thumbnail) {
      thumbEl.src = state.thumbnail;
      thumbEl.style.display = 'block';
    } else if (thumbEl) {
      thumbEl.style.display = 'none';
    }

    // Filename
    var nameEl = state.modalEl.querySelector('#ul-sheet-filename');
    if (nameEl) nameEl.textContent = state.file.name || 'Design';

    // Dimensions in inches
    var inchEl = state.modalEl.querySelector('#ul-sheet-dims-inch');
    if (inchEl) inchEl.textContent = reader.formatDimensions(dims, 'inch');

    // Pixels
    var pxEl = state.modalEl.querySelector('#ul-sheet-dims-px');
    if (pxEl) pxEl.textContent = ' · ' + reader.formatPixels(dims);

    // DPI badge
    var dpiEl = state.modalEl.querySelector('#ul-sheet-dpi-badge');
    if (dpiEl) {
      if (dims.dpiFromExif) {
        dpiEl.innerHTML =
          ' · <span style="color:#10b981;font-weight:600;">' +
          dims.dpi +
          ' DPI</span>';
      } else {
        dpiEl.innerHTML =
          ' · <span style="color:#f59e0b;font-weight:600;">' +
          dims.dpi +
          ' DPI (estimated)</span>';
      }
    }

    // DPI override is always visible now, just update the active button
    var dpiButtons = state.modalEl.querySelectorAll('[data-action="set-dpi"]');
    for (var db = 0; db < dpiButtons.length; db++) {
      dpiButtons[db].classList.toggle('ul-sheet-dpi-btn--active', dpiButtons[db].dataset.dpi === String(dims.dpi));
    }

    // Update dimension inputs
    var dimW = state.modalEl.querySelector('#ul-sheet-dim-w');
    var dimH = state.modalEl.querySelector('#ul-sheet-dim-h');
    if (dimW) dimW.value = dims.widthInch;
    if (dimH) dimH.value = dims.heightInch;
  }

  /* ─────────────────────────────────────────────
     Calculation & Rendering
     ───────────────────────────────────────────── */

  /**
   * Recalculate nesting for all variants with current quantity
   */
  function recalculate() {
    if (!state.dimensions || state.dimensions.widthPx === 0) return;

    var engine = window.ULNestingEngine;
    var optimizer = window.ULSheetOptimizer;
    if (!engine || !optimizer) return;

    var design = {
      widthInch: state.dimensions.widthInch,
      heightInch: state.dimensions.heightInch,
      quantity: state.quantity,
    };

    var config = {
      gapMm: state.config.gapMm,
      marginMm: state.config.marginMm,
      allowRotation: state.config.allowRotation,
      strategy: state.config.strategy,
    };

    console.log('[ULAutoSheet] Design:', design.widthInch + '" × ' + design.heightInch + '" (' + state.dimensions.widthPx + '×' + state.dimensions.heightPx + 'px @ ' + state.dimensions.dpi + 'DPI)');
    console.log('[ULAutoSheet] Available sheets:', state.sheets.map(function(s) { return s.name + ' (' + s.widthInch + '×' + s.heightInch + ')'; }));

    // Calculate all variants
    state.results = engine.nestAllVariants(design, state.sheets, config);

    // Optimize
    state.optimization = optimizer.optimize(state.results, config.strategy);

    // Always render all-sheets list (fit = active, no-fit = gray)
    renderAllSheets(design, config);

    // Handle case where no variant can fit the design
    if (!state.optimization.recommended) {
      // Hide recommended/alternatives/comparison, but keep all-sheets visible
      var recEl = state.modalEl.querySelector('#ul-sheet-recommended');
      if (recEl) recEl.style.display = 'none';
      var altEl = state.modalEl.querySelector('#ul-sheet-alternatives');
      if (altEl) altEl.style.display = 'none';
      var cmpEl = state.modalEl.querySelector('#ul-sheet-comparison');
      if (cmpEl) cmpEl.style.display = 'none';
      return;
    }

    // Auto-select recommended
    if (state.optimization.recommended && !state.selectedResult) {
      state.selectedResult = state.optimization.recommended;
    } else if (state.selectedResult) {
      // Keep current selection if still valid
      var currentId = state.selectedResult.sheet.id;
      var found = state.results.find(function (r) {
        return r.sheet.id === currentId;
      });
      state.selectedResult = found || state.optimization.recommended;
    }

    // Update all UI sections
    renderRecommended();
    renderAlternatives();
    renderComparison();
    renderSimulator();
    renderFooter();
    renderQuantitySuggestion();
    renderSavings();
  }

  /**
   * Render all sheets list showing which ones fit (active) and which don't (gray)
   */
  function renderAllSheets(design, config) {
    var container = state.modalEl.querySelector('#ul-sheet-all-sheets');
    if (!container) return;

    var engine = window.ULNestingEngine;
    if (!engine || !state.sheets || state.sheets.length === 0) {
      container.style.display = 'none';
      return;
    }

    var fitCount = 0;
    for (var fc = 0; fc < state.sheets.length; fc++) {
      var fcResult = engine.nestDesigns(design, state.sheets[fc], config);
      if (fcResult.designsPerSheet > 0) fitCount++;
    }

    var html = [
      '<div class="ul-sheet-section" style="margin-top:12px;">',
      '  <div class="ul-sheet-section-title">',
      '    <span class="ul-sheet-badge">📋</span>',
      '    Available Sheets',
      '    <span style="margin-left:auto;font-size:11px;font-weight:500;color:#64748b;background:#f1f5f9;padding:2px 8px;border-radius:10px;">' + fitCount + ' fit / ' + state.sheets.length + ' total</span>',
      '  </div>',
      '  <div class="ul-sheet-all-items-scroll" style="max-height:260px;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#e2e8f0 transparent;">',
    ];

    for (var i = 0; i < state.sheets.length; i++) {
      var s = state.sheets[i];
      var result = engine.nestDesigns(design, s, config);
      var fits = result.designsPerSheet > 0;
      var isSelected = state.selectedResult && state.selectedResult.sheet.id === s.id;

      html.push(
        '<div class="ul-sheet-all-item' +
          (fits ? ' ul-sheet-all-item--fit' : ' ul-sheet-all-item--nofit') +
          (isSelected ? ' ul-sheet-all-item--selected' : '') +
          '"' +
          (fits ? ' data-variant-id="' + escapeHtml(String(s.id)) + '" style="cursor:pointer;"' : '') +
          '>',
        '  <div class="ul-sheet-all-item-name">',
        '    <span class="ul-sheet-all-item-icon">' + (fits ? '✅' : '❌') + '</span>',
        '    ' + escapeHtml(s.name),
        '  </div>',
        '  <div class="ul-sheet-all-item-detail">'
      );

      if (fits) {
        html.push(
          result.designsPerSheet + '/sheet · ' + result.efficiency.toFixed(0) + '% efficiency'
        );
      } else {
        html.push('<span style="color:#94a3b8;">Design too large</span>');
      }

      html.push(
        '  </div>',
        '</div>'
      );
    }

    html.push('  </div>'); // close scroll wrapper
    html.push('</div>');
    container.innerHTML = html.join('\n');
    container.style.display = 'block';
  }

  /**
   * Render the recommended result card
   */
  function renderRecommended() {
    var container = state.modalEl.querySelector('#ul-sheet-recommended');
    if (!container || !state.selectedResult) return;

    var r = state.selectedResult;
    var isRec = r === state.optimization.recommended;
    var tier = window.ULNestingEngine.getEfficiencyTier(r.efficiency);

    container.innerHTML = [
      '<div class="ul-sheet-section">',
      '  <div class="ul-sheet-section-title">',
      '    <span class="ul-sheet-badge">✓</span>',
      '    Selected Sheet Size',
      '  </div>',
      '  <div class="ul-sheet-result' + (isRec ? ' ul-sheet-result--recommended' : '') + '">',
      '    <div class="ul-sheet-result-header">',
      '      <p class="ul-sheet-result-name">',
      '        ' + escapeHtml(r.sheet.name),
      (isRec
        ? '        <span class="ul-sheet-recommended-badge">★ Best</span>'
        : ''),
      '      </p>',
      '      <span class="ul-sheet-result-sheets">' +
        r.sheetsNeeded +
        ' sheet' +
        (r.sheetsNeeded > 1 ? 's' : '') +
        '</span>',
      '    </div>',
      '    <div class="ul-sheet-result-stats">',
      '      <div class="ul-sheet-stat">',
      '        <span class="ul-sheet-stat-value">' + r.designsPerSheet + '</span>',
      '        <span class="ul-sheet-stat-label">Per Sheet</span>',
      '      </div>',
      '      <div class="ul-sheet-stat">',
      '        <span class="ul-sheet-stat-value">' + r.totalDesigns + '</span>',
      '        <span class="ul-sheet-stat-label">Total Copies</span>',
      '      </div>',
      '      <div class="ul-sheet-stat">',
      '        <span class="ul-sheet-stat-value">' + r.efficiency.toFixed(0) + '%</span>',
      '        <span class="ul-sheet-stat-label">Efficiency</span>',
      '      </div>',
      '    </div>',
      '    <div class="ul-sheet-efficiency">',
      '      <div class="ul-sheet-efficiency-header">',
      '        <span class="ul-sheet-efficiency-label">Material Usage</span>',
      '        <span class="ul-sheet-efficiency-value ul-sheet-efficiency-value--' + tier + '">' +
        r.efficiency.toFixed(1) +
        '%</span>',
      '      </div>',
      '      <div class="ul-sheet-efficiency-bar">',
      '        <div class="ul-sheet-efficiency-fill ul-sheet-efficiency-fill--' +
        tier +
        '" style="width:' +
        r.efficiency +
        '%"></div>',
      '      </div>',
      '    </div>',
      '  </div>',
      '</div>',
    ].join('\n');

    container.style.display = 'block';

    // Enable apply button
    var applyBtn = state.modalEl.querySelector('#ul-sheet-apply-btn');
    if (applyBtn) applyBtn.disabled = false;
  }

  /**
   * Render alternative options
   */
  function renderAlternatives() {
    var container = state.modalEl.querySelector('#ul-sheet-alternatives');
    if (!container || !state.config.showAlternatives) return;

    var alts = state.optimization.alternatives || [];
    if (alts.length === 0) {
      container.style.display = 'none';
      return;
    }

    var html = [
      '<div class="ul-sheet-alternatives">',
      '  <h4 class="ul-sheet-alternatives-title">Other Options</h4>',
    ];

    var maxShow = Math.min(alts.length, 4);
    for (var i = 0; i < maxShow; i++) {
      var a = alts[i];
      var isActive = state.selectedResult && state.selectedResult.sheet.id === a.sheet.id;
      html.push(
        '<div class="ul-sheet-alt-item' +
          (isActive ? ' ul-sheet-alt-item--active' : '') +
          '" data-variant-id="' +
          escapeHtml(String(a.sheet.id)) +
          '">',
        '  <div>',
        '    <div class="ul-sheet-alt-name">' + escapeHtml(a.sheet.name) + '</div>',
        '    <div class="ul-sheet-alt-detail">' +
          a.designsPerSheet +
          '/sheet · ' +
          a.efficiency.toFixed(0) +
          '% efficient</div>',
        '  </div>',
        '  <div class="ul-sheet-alt-right">',
        '    <div class="ul-sheet-alt-sheets">' +
          a.sheetsNeeded +
          ' sheet' +
          (a.sheetsNeeded > 1 ? 's' : '') +
          '</div>',
        '    <div class="ul-sheet-alt-efficiency">' +
          a.wastePercent.toFixed(0) +
          '% waste</div>',
        '  </div>',
        '</div>'
      );
    }

    html.push('</div>');
    container.innerHTML = html.join('\n');
    container.style.display = 'block';
  }

  /**
   * Render comparison table
   */
  function renderComparison() {
    var container = state.modalEl.querySelector('#ul-sheet-comparison');
    if (!container || !state.config.showComparison) return;

    var comp = state.optimization.comparison;
    if (!comp || !comp.rows || comp.rows.length < 2) {
      container.style.display = 'none';
      return;
    }

    var html = [
      '<div class="ul-sheet-section" style="margin-top:12px;">',
      '  <div class="ul-sheet-section-title">',
      '    <span class="ul-sheet-badge">⊞</span>',
      '    Comparison',
      '  </div>',
      '  <table class="ul-sheet-comparison">',
      '    <thead><tr>',
    ];

    for (var h = 0; h < comp.headers.length; h++) {
      html.push('      <th>' + escapeHtml(comp.headers[h]) + '</th>');
    }
    html.push('    </tr></thead>', '    <tbody>');

    for (var r = 0; r < comp.rows.length; r++) {
      var row = comp.rows[r];
      html.push(
        '      <tr class="' + (row.isBest ? 'ul-sheet-comparison--best' : '') + '" data-variant-id="' + escapeHtml(String(row.variantId)) + '" style="cursor:pointer;">',
        '        <td>' +
          escapeHtml(row.sheetName) +
          (row.isBest ? '<span class="ul-sheet-comparison--best-label">Best</span>' : '') +
          '</td>',
        '        <td>' + row.designsPerSheet + '</td>',
        '        <td>' + row.sheetsNeeded + '</td>',
        '        <td>' + row.efficiency + '</td>',
        '        <td>' + row.waste + '</td>',
        '        <td>' + row.cost + '</td>',
        '      </tr>'
      );
    }

    html.push('    </tbody>', '  </table>', '</div>');

    container.innerHTML = html.join('\n');
    container.style.display = 'block';
  }

  /**
   * Render the canvas simulator
   */
  function renderSimulator() {
    var wrap = state.modalEl.querySelector('#ul-sheet-simulator-wrap');
    if (!wrap || !state.config.showSimulator || !state.selectedResult) {
      if (wrap) wrap.style.display = 'none';
      return;
    }

    wrap.style.display = 'block';
    var canvas = state.modalEl.querySelector('#ul-sheet-canvas');
    if (!canvas) return;

    // Create or reuse simulator
    if (!state.simulator) {
      state.simulator = window.ULSheetSimulator.create(canvas, {
        padding: 32,
        showDimensions: true,
        showGrid: false,
        showMargins: true,
        showDesignIndex: true,
        animateIn: true,
      });

      // Set design thumbnail
      if (state.thumbnail) {
        state.simulator.setDesignImage(state.thumbnail);
      }
    }

    // Get layout for current sheet page
    var layouts = state.selectedResult.layouts || [];
    var layoutIndex = Math.min(state.currentSheetIndex, layouts.length - 1);
    if (layoutIndex < 0) layoutIndex = 0;

    var marginInch = (state.config.marginMm || 5) / 25.4;

    if (layouts[layoutIndex]) {
      state.simulator.setLayout(
        layouts[layoutIndex],
        state.selectedResult.sheet,
        marginInch
      );
    }

    // Canvas label
    var label = state.modalEl.querySelector('#ul-sheet-canvas-label');
    if (label) {
      label.textContent =
        state.selectedResult.sheet.name +
        ' · ' +
        (layouts[layoutIndex] ? layouts[layoutIndex].placements.length : 0) +
        ' designs';
    }

    // Sheet navigation
    var nav = state.modalEl.querySelector('#ul-sheet-nav');
    if (nav && layouts.length > 1) {
      nav.style.display = 'flex';
      var navText = state.modalEl.querySelector('#ul-sheet-nav-text');
      if (navText) {
        navText.textContent =
          'Sheet ' + (layoutIndex + 1) + ' of ' + layouts.length;
      }

      var prevBtn = nav.querySelector('[data-action="prev-sheet"]');
      var nextBtn = nav.querySelector('[data-action="next-sheet"]');
      if (prevBtn) prevBtn.disabled = layoutIndex === 0;
      if (nextBtn) nextBtn.disabled = layoutIndex >= layouts.length - 1;
    } else if (nav) {
      nav.style.display = 'none';
    }
  }

  /**
   * Render footer info
   */
  function renderFooter() {
    var el = state.modalEl.querySelector('#ul-sheet-footer-info');
    if (!el || !state.selectedResult) return;

    var r = state.selectedResult;
    el.innerHTML =
      '<strong>' +
      escapeHtml(r.sheet.name) +
      '</strong> × ' +
      r.sheetsNeeded +
      ' sheet' +
      (r.sheetsNeeded > 1 ? 's' : '') +
      (r.totalCost > 0
        ? ' · <strong>' + window.ULSheetOptimizer.formatCost(r.totalCost) + '</strong>'
        : '');
  }

  /**
   * Render quantity suggestion banner
   */
  function renderQuantitySuggestion() {
    var el = state.modalEl.querySelector('#ul-sheet-qty-suggestion');
    var textEl = state.modalEl.querySelector('#ul-sheet-qty-suggestion-text');
    if (!el || !textEl || !state.config.showQuantitySuggestion) return;

    if (!state.selectedResult) {
      el.style.display = 'none';
      return;
    }

    var suggestion = window.ULSheetOptimizer.suggestQuantityAdjust(
      state.selectedResult,
      state.quantity
    );

    if (suggestion) {
      textEl.innerHTML =
        '<strong>Tip:</strong> ' +
        escapeHtml(suggestion.reason) +
        ' <a href="#" style="color:inherit;font-weight:700;text-decoration:underline;" data-action="set-qty" data-qty="' +
        suggestion.suggestedQuantity +
        '">Use ' +
        suggestion.suggestedQuantity +
        '</a>';

      el.style.display = 'flex';
      // Click is handled by the delegated set-qty action in bindModalEvents
    } else {
      el.style.display = 'none';
    }
  }

  /**
   * Render savings banner
   */
  function renderSavings() {
    var el = state.modalEl.querySelector('#ul-sheet-savings');
    var textEl = state.modalEl.querySelector('#ul-sheet-savings-text');
    if (!el || !textEl) return;

    var savings = state.optimization ? state.optimization.savings : null;
    if (!savings || (savings.sheetsReduced <= 0 && savings.costSaved <= 0)) {
      el.style.display = 'none';
      return;
    }

    textEl.innerHTML =
      '<strong>Smart choice!</strong> ' + escapeHtml(savings.reason);
    el.style.display = 'flex';
  }

  /* ─────────────────────────────────────────────
     User Actions
     ───────────────────────────────────────────── */

  /**
   * Change quantity by delta
   * @param {number} delta
   */
  function changeQuantity(delta) {
    var qtyInput = state.modalEl.querySelector('#ul-sheet-qty');
    var newVal = Math.max(1, state.quantity + delta);
    state.quantity = newVal;
    if (qtyInput) qtyInput.value = newVal;
    recalculate();
  }

  /**
   * Select a specific variant
   * @param {string} variantId
   */
  function selectVariant(variantId) {
    var found = state.results.find(function (r) {
      return String(r.sheet.id) === String(variantId);
    });

    if (found) {
      state.selectedResult = found;
      state.currentSheetIndex = 0;
      renderRecommended();
      renderAlternatives();
      renderSimulator();
      renderFooter();
      renderQuantitySuggestion();
    }
  }

  /**
   * Navigate between sheet pages in simulator
   * @param {number} delta
   */
  function navigateSheet(delta) {
    if (!state.selectedResult || !state.selectedResult.layouts) return;

    var maxIndex = state.selectedResult.layouts.length - 1;
    state.currentSheetIndex = Math.max(
      0,
      Math.min(maxIndex, state.currentSheetIndex + delta)
    );
    renderSimulator();
  }

  /**
   * Apply the selected variant and close modal
   */
  function applySelection() {
    if (!state.selectedResult) return;

    var result = {
      variantId: state.selectedResult.sheet.variantId,
      sheetName: state.selectedResult.sheet.name,
      sheetsNeeded: state.selectedResult.sheetsNeeded,
      designsPerSheet: state.selectedResult.designsPerSheet,
      quantity: state.quantity,
      efficiency: state.selectedResult.efficiency,
      totalCost: state.selectedResult.totalCost,
    };

    // Call the callback
    if (state.onSelect) {
      state.onSelect(result);
    }

    // Emit event for other modules
    if (window.ULEvents) {
      window.ULEvents.emit('autoSheet:selected', result);
    }

    closeModal();

    // Show confirmation toast
    try {
      var toast = document.createElement('div');
      toast.textContent = '\u2713 Sheet size updated to ' + result.sheetName;
      toast.setAttribute('style',
        'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);' +
        'background:#10b981;color:#fff;padding:12px 24px;border-radius:10px;' +
        'font-size:14px;font-weight:600;z-index:100000;' +
        'box-shadow:0 4px 12px rgba(0,0,0,0.15);' +
        'font-family:-apple-system,system-ui,sans-serif;');
      document.body.appendChild(toast);
      setTimeout(function() {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s ease';
        setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
      }, 3000);
    } catch (e) { /* toast display is non-critical */ }
  }

  /* ─────────────────────────────────────────────
     Event Handlers
     ───────────────────────────────────────────── */

  /**
   * Handle upload complete event from upload flow
   * @param {Object} data
   */
  function handleUploadComplete(data) {
    // Auto-open sheet calculator if enabled and file is available
    // This is optional - merchants can also trigger it manually
    if (isEnabled() && data && data.file) {
      console.log('[ULAutoSheet] Upload complete, ready for sheet calculation');
    }
  }

  /* ─────────────────────────────────────────────
     UI Helpers
     ───────────────────────────────────────────── */

  function showLoading(show) {
    var el = state.modalEl.querySelector('#ul-sheet-loading');
    if (el) el.style.display = show ? 'flex' : 'none';
  }

  function showContent() {
    var el = state.modalEl.querySelector('#ul-sheet-content');
    if (el) el.style.display = 'grid';
  }

  function hideContent() {
    var el = state.modalEl.querySelector('#ul-sheet-content');
    if (el) el.style.display = 'none';
  }

  function showError(message) {
    var content = state.modalEl.querySelector('#ul-sheet-content');
    if (content) {
      content.innerHTML =
        '<div class="ul-sheet-empty" style="grid-column:1/-1;">' +
        '  <div class="ul-sheet-empty-icon">⚠️</div>' +
        '  <p class="ul-sheet-empty-text">' +
        escapeHtml(message) +
        '</p>' +
        '</div>';
      content.style.display = 'grid';
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ─────────────────────────────────────────────
     Public API
     ───────────────────────────────────────────── */
  window.ULAutoSheet = {
    init: init,
    isEnabled: isEnabled,
    openModal: openModal,
    closeModal: closeModal,
    getState: function () {
      return {
        enabled: isEnabled(),
        dimensions: state.dimensions,
        selectedResult: state.selectedResult
          ? {
              sheetName: state.selectedResult.sheet.name,
              sheetsNeeded: state.selectedResult.sheetsNeeded,
              efficiency: state.selectedResult.efficiency,
            }
          : null,
      };
    },
  };
})();
