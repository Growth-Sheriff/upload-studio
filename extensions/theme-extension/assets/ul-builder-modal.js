/**
 * Upload Studio - Builder Modal v1.0.0
 * ======================================
 * Core modal shell: tabs, state, lifecycle, HTML rendering.
 * Orchestrates ul-builder-upload.js, ul-builder-canvas.js,
 * ul-builder-fitcheck.js, ul-builder-pricing.js
 *
 * Namespace: window.ULBuilderModal
 *
 * Dependencies:
 *   - ul-builder.css
 *   - ul-builder-upload.js   (window.ULBuilderUpload)
 *   - ul-builder-canvas.js   (window.ULBuilderCanvas)
 *   - ul-builder-fitcheck.js (window.ULBuilderFitCheck)
 *   - ul-state.js            (window.ULState) [optional]
 *   - ul-analytics.js        (window.ULAnalytics) [optional]
 */

;(function () {
  'use strict'

  if (window.ULBuilderModal) return

  /* ─────────────────────────────────────────────
     SVG Icons
     ───────────────────────────────────────────── */
  var ICONS = {
    upload:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
    canvas:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
    fitcheck:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.38 3.46L16 2l-4 4-4-4L3.62 3.46A2 2 0 0 0 2.38 5.84L4 16.62V22h16v-5.38l1.62-10.78a2 2 0 0 0-1.24-2.38z"/></svg>',
    close:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    cart:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>',
    reset:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>',
    lock:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    unlock:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    trash:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  }

  /* ─────────────────────────────────────────────
     File type constants
     ───────────────────────────────────────────── */
  var ALLOWED_EXTENSIONS = [
    'png', 'jpg', 'jpeg', 'webp', 'tiff', 'tif',
    'psd', 'svg', 'pdf', 'ai', 'eps',
  ]
  var MAX_FILE_SIZE = 10240 * 1024 * 1024 // 10 GB

  /* ─────────────────────────────────────────────
     Internal State
     ───────────────────────────────────────────── */
  var state = {
    open: false,
    activeTab: 'uploads',        // 'uploads' | 'canvas' | 'fitcheck'
    productId: '',
    shopDomain: '',
    apiBase: '',
    currency: 'USD',
    moneyFormat: '${{amount}}',

    /* Product info read from page */
    variantId: null,
    variantPrice: 0,      // in cents from Shopify
    productTitle: '',
    productHandle: '',

    /* Uploads list – each item:
       { id, uploadId, file, fileName, thumbUrl, originalUrl,
         widthPx, heightPx, dpi, widthIn, heightIn,
         quantity, keepAspect, status } */
    items: [],
    selectedIndex: -1,

    modalEl: null,
    fileInputEl: null,
    initialized: false,
  }

  /* ─────────────────────────────────────────────
     Initialization
     ───────────────────────────────────────────── */
  function init(opts) {
    if (state.initialized) return
    state.productId = opts.productId || ''
    state.shopDomain = opts.shopDomain || ''
    state.apiBase = opts.apiBase || ''
    state.currency = opts.currency || 'USD'
    state.moneyFormat = opts.moneyFormat || '${{amount}}'
    state.initialized = true

    // Read product/variant info from page
    readProductData()

    console.log('[ULBuilderModal] Initialized for product', state.productId, 'variant', state.variantId)
  }

  /* ─────────────────────────────────────────────
     Read Product Data from Page
     ───────────────────────────────────────────── */
  function readProductData() {
    // 1. Try Shopify product JSON (most themes include this)
    var productJsonEl = document.querySelector(
      '[data-product-json], script[type="application/json"][data-product-json], ' +
      'script[data-product-json], .product-json, ' +
      'script[id="ProductJson-product-template"]'
    )
    if (productJsonEl) {
      try {
        var data = JSON.parse(productJsonEl.textContent)
        var product = data.product || data
        state.productTitle = product.title || ''
        state.productHandle = product.handle || ''
        var variants = product.variants || []
        if (variants.length > 0) {
          // Find selected variant or use first
          var selected = findSelectedVariant(variants)
          if (selected) {
            state.variantId = selected.id
            state.variantPrice = selected.price
          }
        }
        console.log('[ULBuilderModal] Product data from JSON:', state.productTitle, 'variant:', state.variantId)
        return
      } catch (e) { /* ignore */ }
    }

    // 2. Try product form hidden input
    var hiddenInput = document.querySelector(
      'form[action*="/cart/add"] input[name="id"][type="hidden"], ' +
      'form[action*="/cart/add"] select[name="id"]'
    )
    if (hiddenInput && hiddenInput.value) {
      state.variantId = parseInt(hiddenInput.value, 10)
    }

    // 3. Try URL param
    if (!state.variantId) {
      var urlParams = new URLSearchParams(window.location.search)
      var urlVariant = urlParams.get('variant')
      if (urlVariant) state.variantId = parseInt(urlVariant, 10)
    }

    // 4. Try meta tags for title
    var metaTitle = document.querySelector('meta[property="og:title"]')
    if (metaTitle) state.productTitle = metaTitle.getAttribute('content') || ''

    console.log('[ULBuilderModal] Product data from DOM:', state.productTitle, 'variant:', state.variantId)
  }

  function findSelectedVariant(variants) {
    if (!variants || !variants.length) return null

    // Check URL param first
    var urlParams = new URLSearchParams(window.location.search)
    var urlVariant = urlParams.get('variant')
    if (urlVariant) {
      var vid = parseInt(urlVariant, 10)
      for (var i = 0; i < variants.length; i++) {
        if (variants[i].id === vid) return variants[i]
      }
    }

    // Check form select/input
    var formInput = document.querySelector(
      'form[action*="/cart/add"] input[name="id"][type="hidden"], ' +
      'form[action*="/cart/add"] select[name="id"]'
    )
    if (formInput && formInput.value) {
      var fid = parseInt(formInput.value, 10)
      for (var j = 0; j < variants.length; j++) {
        if (variants[j].id === fid) return variants[j]
      }
    }

    // Fallback to first available variant
    for (var k = 0; k < variants.length; k++) {
      if (variants[k].available !== false) return variants[k]
    }
    return variants[0]
  }

  /* ─────────────────────────────────────────────
     Open / Close
     ───────────────────────────────────────────── */
  function open() {
    if (!state.initialized) {
      console.error('[ULBuilderModal] Not initialized. Call init() first.')
      return
    }
    if (!state.modalEl) {
      createModal()
    }
    state.open = true
    state.modalEl.classList.add('ulb-open')
    document.body.style.overflow = 'hidden'
    switchTab('uploads')
    updateUI()

    if (window.ULAnalytics) {
      window.ULAnalytics.track('builder_modal_opened', { productId: state.productId })
    }

    document.dispatchEvent(
      new CustomEvent('ul:builder:opened', { detail: { productId: state.productId } })
    )
  }

  function close() {
    if (!state.open) return
    state.open = false
    if (state.modalEl) {
      state.modalEl.classList.remove('ulb-open')
    }
    document.body.style.overflow = ''

    document.dispatchEvent(
      new CustomEvent('ul:builder:closed', { detail: { productId: state.productId } })
    )
  }

  /* ─────────────────────────────────────────────
     Tab Switching
     ───────────────────────────────────────────── */
  function switchTab(tabName) {
    if (tabName === state.activeTab) return
    state.activeTab = tabName

    var tabs = state.modalEl.querySelectorAll('.ulb-tab')
    var panes = state.modalEl.querySelectorAll('.ulb-tab-pane')

    for (var i = 0; i < tabs.length; i++) {
      var isActive = tabs[i].dataset.tab === tabName
      tabs[i].classList.toggle('ulb-tab-active', isActive)
    }
    for (var j = 0; j < panes.length; j++) {
      var isActivePane = panes[j].dataset.pane === tabName
      panes[j].classList.toggle('ulb-pane-active', isActivePane)
    }

    // Notify sub-modules
    if (tabName === 'canvas' && window.ULBuilderCanvas) {
      window.ULBuilderCanvas.activate(getSelectedItem())
    }
    if (tabName === 'fitcheck' && window.ULBuilderFitCheck) {
      window.ULBuilderFitCheck.activate(getSelectedItem())
    }
  }

  /* ─────────────────────────────────────────────
     Modal HTML
     ───────────────────────────────────────────── */
  function createModal() {
    var overlay = document.createElement('div')
    overlay.className = 'ulb-overlay'
    overlay.id = 'ulb-modal-overlay'
    overlay.innerHTML = buildModalHTML()
    document.body.appendChild(overlay)
    state.modalEl = overlay

    // Hidden file input
    var fi = document.createElement('input')
    fi.type = 'file'
    fi.accept = ALLOWED_EXTENSIONS.map(function (e) { return '.' + e }).join(',')
    fi.multiple = true
    fi.style.display = 'none'
    fi.id = 'ulb-file-input'
    overlay.appendChild(fi)
    state.fileInputEl = fi

    bindEvents()
  }

  function buildModalHTML() {
    return [
      '<div class="ulb-modal">',

      /* ── HEADER ── */
      '  <div class="ulb-header">',
      '    <div class="ulb-tabs">',
      '      <button type="button" class="ulb-tab ulb-tab-active" data-tab="uploads">',
              ICONS.upload,
      '        <span>Uploads</span>',
      '        <span class="ulb-tab-badge" id="ulb-upload-count">0</span>',
      '      </button>',
      '      <button type="button" class="ulb-tab" data-tab="canvas">',
              ICONS.canvas,
      '        <span>Canvas</span>',
      '      </button>',
      '      <button type="button" class="ulb-tab" data-tab="fitcheck">',
              ICONS.fitcheck,
      '        <span>FitCheck</span>',
      '      </button>',
      '    </div>',
      '    <div class="ulb-header-right">',
      '      <div class="ulb-dpi-badge" id="ulb-dpi-badge"></div>',
      '      <button type="button" class="ulb-close-btn" data-action="close" aria-label="Close">',
              ICONS.close,
      '      </button>',
      '    </div>',
      '  </div>',

      /* ── BODY ── */
      '  <div class="ulb-body">',
      '    <div class="ulb-body-inner">',
      '      <div class="ulb-content-row">',

      /* ── LEFT PANEL ── */
      '        <div class="ulb-left-panel">',

      /* Uploads pane */
      '          <div class="ulb-tab-pane ulb-pane-active" data-pane="uploads">',
      '            <div class="ulb-dropzone" id="ulb-dropzone">',
      '              <div class="ulb-dropzone-text">Drag & Drop your files here</div>',
      '              <button type="button" class="ulb-dropzone-btn" data-action="browse">',
                      ICONS.upload,
      '                Upload Files <small>(' + ALLOWED_EXTENSIONS.map(function (e) { return e.toUpperCase() }).join(', ') + ')</small>',
      '              </button>',
      '              <div class="ulb-file-types">',
      '                <p>Accepted formats:</p>',
      '                <div class="ulb-file-tags">',
                        ALLOWED_EXTENSIONS.map(function (ext) {
                          return '<span class="ulb-file-tag">' + ext + '</span>'
                        }).join(''),
      '                </div>',
      '              </div>',
      '            </div>',
      '            <div class="ulb-upload-progress" id="ulb-upload-progress">',
      '              <div class="ulb-progress-header">',
      '                <span class="ulb-progress-filename" id="ulb-progress-filename"></span>',
      '                <span class="ulb-progress-percent" id="ulb-progress-percent">0%</span>',
      '              </div>',
      '              <div class="ulb-progress-bar-track">',
      '                <div class="ulb-progress-bar-fill" id="ulb-progress-fill"></div>',
      '              </div>',
      '              <div class="ulb-progress-speed" id="ulb-progress-speed"></div>',
      '            </div>',
      '            <div class="ulb-gallery-spacer" id="ulb-gallery-spacer" style="display:none;"></div>',
      '            <div class="ulb-gallery-grid" id="ulb-gallery-grid"></div>',
      '          </div>',

      /* Canvas pane */
      '          <div class="ulb-tab-pane" data-pane="canvas">',
      '            <div class="ulb-canvas-area" id="ulb-canvas-area">',
      '              <div class="ulb-canvas-empty" id="ulb-canvas-empty">',
                      ICONS.canvas,
      '                <span>Upload a file first to preview on canvas</span>',
      '              </div>',
      '              <div class="ulb-canvas-wrapper" id="ulb-canvas-wrapper" style="display:none;"></div>',
      '            </div>',
      '          </div>',

      /* FitCheck pane */
      '          <div class="ulb-tab-pane" data-pane="fitcheck">',
      '            <div class="ulb-fitcheck-area" id="ulb-fitcheck-area">',
      '              <div class="ulb-fitcheck-empty" id="ulb-fitcheck-empty">',
                      ICONS.fitcheck,
      '                <span>Upload a file first to preview on products</span>',
      '              </div>',
      '              <div id="ulb-fitcheck-content" style="display:none;"></div>',
      '            </div>',
      '          </div>',

      '        </div>',

      /* ── RIGHT PANEL ── */
      '        <div class="ulb-right-panel" id="ulb-right-panel">',

      /* Product Info */
      '          <div class="ulb-section" id="ulb-section-productinfo" style="display:none;">',
      '            <div class="ulb-section-title">Product</div>',
      '            <div style="font-size:13px;color:#374151;font-weight:500;" id="ulb-product-title">' + escapeAttr(state.productTitle || 'Upload your design') + '</div>',
      '          </div>',

      /* Aspect Ratio */
      '          <div class="ulb-section" id="ulb-section-aspect" style="display:none;">',
      '            <div class="ulb-aspect-row">',
      '              <div class="ulb-aspect-info">',
                      ICONS.lock,
      '                <span id="ulb-aspect-text">Keep Aspect Ratio</span>',
      '              </div>',
      '              <button type="button" class="ulb-toggle ulb-toggle-on" data-toggle="aspect" id="ulb-toggle-aspect"></button>',
      '            </div>',
      '            <div class="ulb-aspect-row">',
      '              <span class="ulb-aspect-info" id="ulb-aspect-ratio-display"></span>',
      '              <button type="button" class="ulb-aspect-reset" data-action="reset-dims" title="Reset to original" id="ulb-aspect-reset">',
                      ICONS.reset,
      '              </button>',
      '            </div>',
      '          </div>',

      /* Dimensions */
      '          <div class="ulb-section" id="ulb-section-dims" style="display:none;">',
      '            <div class="ulb-section-title">Dimensions</div>',
      '            <div class="ulb-dim-group">',
      '              <div class="ulb-dim-input-row">',
      '                <span class="ulb-dim-label">WIDTH</span>',
      '                <input type="number" class="ulb-dim-input" id="ulb-dim-width" step="0.01" min="0.5" max="300" placeholder="0.00">',
      '                <span class="ulb-dim-unit">in</span>',
      '              </div>',
      '              <div class="ulb-dim-input-row">',
      '                <span class="ulb-dim-label">HEIGHT</span>',
      '                <input type="number" class="ulb-dim-input" id="ulb-dim-height" step="0.01" min="0.5" max="300" placeholder="0.00">',
      '                <span class="ulb-dim-unit">in</span>',
      '              </div>',
      '              <div class="ulb-dim-input-row">',
      '                <span class="ulb-dim-label">QUANTITY</span>',
      '                <input type="number" class="ulb-dim-input" id="ulb-dim-quantity" step="1" min="1" max="99999" value="1">',
      '                <span class="ulb-dim-unit">pcs</span>',
      '              </div>',
      '            </div>',
      '          </div>',

      /* Thumbnails */
      '          <div class="ulb-section" id="ulb-section-thumbs" style="display:none;">',
      '            <div class="ulb-section-title">Your Designs</div>',
      '            <div class="ulb-thumb-strip" id="ulb-thumb-strip">',
      '              <button type="button" class="ulb-thumb-add" data-action="browse" title="Add design">+</button>',
      '            </div>',
      '          </div>',

      /* File Info */
      '          <div class="ulb-section" id="ulb-section-pricing" style="display:none;">',
      '            <div class="ulb-section-title">File Details</div>',
      '            <div class="ulb-pricing" id="ulb-pricing-box">',
      '              <div class="ulb-pricing-row">',
      '                <span>Dimensions</span>',
      '                <span id="ulb-price-dims">-</span>',
      '              </div>',
      '              <div class="ulb-pricing-row">',
      '                <span>Resolution</span>',
      '                <span id="ulb-price-dpi">-</span>',
      '              </div>',
      '              <div class="ulb-pricing-row">',
      '                <span>Quantity</span>',
      '                <span id="ulb-price-qty">1</span>',
      '              </div>',
      '            </div>',
      '          </div>',

      '        </div>',
      '      </div>',
      '    </div>',
      '  </div>',

      /* ── FOOTER ── */
      '  <div class="ulb-footer">',
      '    <button type="button" class="ulb-footer-close" data-action="close">Close</button>',
      '    <button type="button" class="ulb-cart-btn" data-action="add-to-cart" id="ulb-cart-btn" disabled>',
            ICONS.cart,
      '      <span>Add To Cart</span>',
      '      <span class="ulb-cart-count" id="ulb-cart-count"></span>',
      '    </button>',
      '  </div>',

      '</div>',
    ].join('\n')
  }

  /* ─────────────────────────────────────────────
     Event Binding (Delegation)
     ───────────────────────────────────────────── */
  function bindEvents() {
    var modal = state.modalEl

    /* Click delegation */
    modal.addEventListener('click', function (e) {
      var action = e.target.closest('[data-action]')
      if (action) {
        e.preventDefault()
        handleAction(action.dataset.action, action)
        return
      }

      var tab = e.target.closest('[data-tab]')
      if (tab) {
        e.preventDefault()
        switchTab(tab.dataset.tab)
        return
      }

      var toggle = e.target.closest('[data-toggle]')
      if (toggle) {
        e.preventDefault()
        handleToggle(toggle.dataset.toggle, toggle)
        return
      }

      // Click on overlay background = close
      if (e.target === modal) {
        close()
      }
    })

    /* Drag & drop on dropzone */
    var dropzone = modal.querySelector('#ulb-dropzone')
    if (dropzone) {
      dropzone.addEventListener('dragover', function (e) {
        e.preventDefault()
        dropzone.classList.add('ulb-drag-over')
      })
      dropzone.addEventListener('dragleave', function () {
        dropzone.classList.remove('ulb-drag-over')
      })
      dropzone.addEventListener('drop', function (e) {
        e.preventDefault()
        dropzone.classList.remove('ulb-drag-over')
        var files = e.dataTransfer.files
        if (files.length) {
          handleFiles(files)
        }
      })
    }

    /* File input change */
    state.fileInputEl.addEventListener('change', function () {
      if (state.fileInputEl.files.length) {
        handleFiles(state.fileInputEl.files)
        state.fileInputEl.value = ''
      }
    })

    /* Dimension inputs */
    var dimW = modal.querySelector('#ulb-dim-width')
    var dimH = modal.querySelector('#ulb-dim-height')
    var dimQ = modal.querySelector('#ulb-dim-quantity')

    if (dimW) dimW.addEventListener('input', function () { handleDimChange('width', dimW.value) })
    if (dimH) dimH.addEventListener('input', function () { handleDimChange('height', dimH.value) })
    if (dimQ) dimQ.addEventListener('input', function () { handleDimChange('quantity', dimQ.value) })

    /* Keyboard: ESC to close */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state.open) {
        close()
      }
    })
  }

  /* ─────────────────────────────────────────────
     Action Handlers
     ───────────────────────────────────────────── */
  function handleAction(action, el) {
    switch (action) {
      case 'close':
        close()
        break
      case 'browse':
        state.fileInputEl.click()
        break
      case 'reset-dims':
        resetDimensions()
        break
      case 'add-to-cart':
        addToCart()
        break
      case 'remove-item':
        var idx = parseInt(el.dataset.index, 10)
        if (!isNaN(idx)) removeItem(idx)
        break
    }
  }

  function handleToggle(name, el) {
    el.classList.toggle('ulb-toggle-on')
    var isOn = el.classList.contains('ulb-toggle-on')

    var item = getSelectedItem()
    if (!item) return

    switch (name) {
      case 'aspect':
        item.keepAspect = isOn
        break
    }
  }

  /* ─────────────────────────────────────────────
     File Handling
     ───────────────────────────────────────────── */
  function handleFiles(fileList) {
    for (var i = 0; i < fileList.length; i++) {
      var file = fileList[i]
      var ext = file.name.split('.').pop().toLowerCase()
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        showToast('Unsupported file type: ' + ext.toUpperCase(), 'error')
        continue
      }
      if (file.size > MAX_FILE_SIZE) {
        showToast('File too large: ' + file.name, 'error')
        continue
      }
      if (file.size === 0) {
        showToast('Empty file: ' + file.name, 'error')
        continue
      }
      startUploadItem(file)
    }
  }

  function startUploadItem(file) {
    var itemIndex = state.items.length
    var item = {
      id: 'ulb_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      uploadId: null,
      file: file,
      fileName: file.name,
      thumbUrl: '',
      originalUrl: '',
      widthPx: 0,
      heightPx: 0,
      dpi: 300,
      widthIn: 0,
      heightIn: 0,
      quantity: 1,
      keepAspect: true,
      status: 'uploading', // uploading | processing | ready | error
      progress: 0,
      error: null,
    }
    state.items.push(item)
    state.selectedIndex = itemIndex
    updateUI()

    // Delegate actual upload to ULBuilderUpload
    if (window.ULBuilderUpload) {
      window.ULBuilderUpload.upload(file, {
        apiBase: state.apiBase,
        shopDomain: state.shopDomain,
        productId: state.productId,
        itemId: item.id,
        onProgress: function (pct, speed) {
          item.progress = pct
          updateUploadProgress(item, pct, speed)
        },
        onComplete: function (result) {
          item.status = 'ready'
          item.uploadId = result.uploadId
          item.thumbUrl = result.thumbnailUrl || ''
          item.originalUrl = result.originalUrl || result.fileUrl || ''
          item.widthPx = result.widthPx || 0
          item.heightPx = result.heightPx || 0
          item.dpi = result.dpi || 300
          item.widthIn = result.widthIn || (item.widthPx / (item.dpi || 300))
          item.heightIn = result.heightIn || (item.heightPx / (item.dpi || 300))
          updateUI()
          showRightPanelSections()
          showToast(item.fileName + ' uploaded successfully', 'success')
        },
        onError: function (err) {
          item.status = 'error'
          item.error = err
          updateUI()
          showToast('Upload failed: ' + err, 'error')
        },
      })
    }
  }

  /* ─────────────────────────────────────────────
     Dimension Changes
     ───────────────────────────────────────────── */
  function handleDimChange(field, rawValue) {
    var item = getSelectedItem()
    if (!item) return

    var val = parseFloat(rawValue)
    if (isNaN(val) || val <= 0) return

    if (field === 'quantity') {
      item.quantity = Math.max(1, Math.floor(val))
    } else if (field === 'width') {
      var oldW = item.widthIn
      item.widthIn = val
      if (item.keepAspect && oldW > 0) {
        var ratio = item.heightIn / oldW
        item.heightIn = parseFloat((val * ratio).toFixed(2))
        var hInput = state.modalEl.querySelector('#ulb-dim-height')
        if (hInput) hInput.value = item.heightIn
      }
    } else if (field === 'height') {
      var oldH = item.heightIn
      item.heightIn = val
      if (item.keepAspect && oldH > 0) {
        var ratioH = item.widthIn / oldH
        item.widthIn = parseFloat((val * ratioH).toFixed(2))
        var wInput = state.modalEl.querySelector('#ulb-dim-width')
        if (wInput) wInput.value = item.widthIn
      }
    }

    updateFileDetailsDisplay()
    updateCanvasLabels()
  }

  function resetDimensions() {
    var item = getSelectedItem()
    if (!item || !item.widthPx || !item.dpi) return
    item.widthIn = parseFloat((item.widthPx / item.dpi).toFixed(2))
    item.heightIn = parseFloat((item.heightPx / item.dpi).toFixed(2))
    var wInput = state.modalEl.querySelector('#ulb-dim-width')
    var hInput = state.modalEl.querySelector('#ulb-dim-height')
    if (wInput) wInput.value = item.widthIn
    if (hInput) hInput.value = item.heightIn
    updateFileDetailsDisplay()
    updateCanvasLabels()
  }

  /* ─────────────────────────────────────────────
     Item Management
     ───────────────────────────────────────────── */
  function getSelectedItem() {
    if (state.selectedIndex < 0 || state.selectedIndex >= state.items.length) return null
    return state.items[state.selectedIndex]
  }

  function selectItem(index) {
    if (index < 0 || index >= state.items.length) return
    state.selectedIndex = index
    updateUI()
    var item = state.items[index]
    if (state.activeTab === 'canvas' && window.ULBuilderCanvas) {
      window.ULBuilderCanvas.activate(item)
    }
    if (state.activeTab === 'fitcheck' && window.ULBuilderFitCheck) {
      window.ULBuilderFitCheck.activate(item)
    }
  }

  function removeItem(index) {
    if (index < 0 || index >= state.items.length) return
    state.items.splice(index, 1)
    if (state.selectedIndex >= state.items.length) {
      state.selectedIndex = state.items.length - 1
    }
    updateUI()
    if (state.items.length === 0) {
      hideRightPanelSections()
    }
  }

  /* ─────────────────────────────────────────────
     UI Updates
     ───────────────────────────────────────────── */
  function updateUI() {
    if (!state.modalEl) return

    updateUploadCount()
    updateGallery()
    updateDpiDisplay()
    updateDimensionInputs()
    updateThumbnailStrip()
    updateFileDetailsDisplay()
    updateCartButton()
  }

  function updateUploadCount() {
    var badge = state.modalEl.querySelector('#ulb-upload-count')
    if (badge) badge.textContent = state.items.length
  }

  function updateDpiDisplay() {
    var item = getSelectedItem()
    var badge = state.modalEl.querySelector('#ulb-dpi-badge')
    if (!badge) return

    if (!item || !item.dpi) {
      badge.className = 'ulb-dpi-badge'
      return
    }

    badge.textContent = 'Resolution: ' + item.dpi + ' DPI'
    if (item.dpi >= 300) {
      badge.className = 'ulb-dpi-badge ulb-dpi-good'
    } else if (item.dpi >= 150) {
      badge.className = 'ulb-dpi-badge ulb-dpi-warn'
    } else {
      badge.className = 'ulb-dpi-badge ulb-dpi-bad'
    }
  }

  function updateDimensionInputs() {
    var item = getSelectedItem()
    var wInput = state.modalEl.querySelector('#ulb-dim-width')
    var hInput = state.modalEl.querySelector('#ulb-dim-height')
    var qInput = state.modalEl.querySelector('#ulb-dim-quantity')

    if (!item) return

    if (wInput && document.activeElement !== wInput) wInput.value = item.widthIn || ''
    if (hInput && document.activeElement !== hInput) hInput.value = item.heightIn || ''
    if (qInput && document.activeElement !== qInput) qInput.value = item.quantity || 1
  }

  function updateGallery() {
    var grid = state.modalEl.querySelector('#ulb-gallery-grid')
    var spacer = state.modalEl.querySelector('#ulb-gallery-spacer')
    if (!grid) return

    if (state.items.length === 0) {
      grid.innerHTML = ''
      if (spacer) spacer.style.display = 'none'
      return
    }

    if (spacer) spacer.style.display = 'block'

    var html = ''
    for (var i = 0; i < state.items.length; i++) {
      var item = state.items[i]
      var selectedClass = i === state.selectedIndex ? ' ulb-gallery-selected' : ''
      var thumbSrc = item.thumbUrl || ''
      var dimsStr = item.widthIn && item.heightIn
        ? item.widthIn.toFixed(1) + '" × ' + item.heightIn.toFixed(1) + '"'
        : ''

      if (item.status === 'uploading') {
        html += '<div class="ulb-gallery-item' + selectedClass + '" data-gallery-index="' + i + '">'
        html += '  <div style="display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;gap:6px;">'
        html += '    <div class="ulb-spinner" style="border-top-color:var(--ulb-primary);border-color:var(--ulb-gray-300);"></div>'
        html += '    <span style="font-size:11px;color:var(--ulb-gray-500);">' + Math.round(item.progress) + '%</span>'
        html += '  </div>'
        html += '</div>'
      } else if (item.status === 'error') {
        html += '<div class="ulb-gallery-item' + selectedClass + '" data-gallery-index="' + i + '">'
        html += '  <div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--ulb-danger);font-size:12px;padding:8px;text-align:center;">Error</div>'
        html += '  <button class="ulb-gallery-remove" data-action="remove-item" data-index="' + i + '">×</button>'
        html += '</div>'
      } else {
        html += '<div class="ulb-gallery-item' + selectedClass + '" data-gallery-index="' + i + '">'
        if (thumbSrc) {
          html += '  <img src="' + escapeAttr(thumbSrc) + '" alt="' + escapeAttr(item.fileName) + '" loading="lazy">'
        } else {
          html += '  <div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:24px;color:var(--ulb-gray-400);">📄</div>'
        }
        html += '  <div class="ulb-gallery-item-info">'
        if (dimsStr) html += '<span class="ulb-gallery-dims">' + dimsStr + '</span>'
        html += '  </div>'
        html += '  <button class="ulb-gallery-remove" data-action="remove-item" data-index="' + i + '">×</button>'
        html += '</div>'
      }
    }
    grid.innerHTML = html

    // Bind gallery click for selection
    var items = grid.querySelectorAll('[data-gallery-index]')
    for (var k = 0; k < items.length; k++) {
      items[k].addEventListener('click', (function (idx) {
        return function (e) {
          if (e.target.closest('[data-action]')) return
          selectItem(idx)
        }
      })(k))
    }
  }

  function updateThumbnailStrip() {
    var strip = state.modalEl.querySelector('#ulb-thumb-strip')
    if (!strip) return

    // Keep the add button at the end
    var html = ''
    for (var i = 0; i < state.items.length; i++) {
      var item = state.items[i]
      var activeClass = i === state.selectedIndex ? ' ulb-thumb-active' : ''
      html += '<div class="ulb-thumb-item' + activeClass + '" data-thumb-index="' + i + '">'
      if (item.thumbUrl) {
        html += '<img src="' + escapeAttr(item.thumbUrl) + '" alt="' + escapeAttr(item.fileName) + '">'
      } else {
        html += '<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:18px;color:var(--ulb-gray-400);">📄</div>'
      }
      html += '</div>'
    }
    html += '<button type="button" class="ulb-thumb-add" data-action="browse" title="Add design">+</button>'
    strip.innerHTML = html

    // Bind thumbnail click
    var thumbs = strip.querySelectorAll('[data-thumb-index]')
    for (var k = 0; k < thumbs.length; k++) {
      thumbs[k].addEventListener('click', (function (idx) {
        return function () { selectItem(idx) }
      })(k))
    }
  }

  function updateFileDetailsDisplay() {
    var item = getSelectedItem()
    var pricingSection = state.modalEl.querySelector('#ulb-section-pricing')
    if (!pricingSection) return

    if (!item || item.status !== 'ready') return

    var dimsEl = state.modalEl.querySelector('#ulb-price-dims')
    var dpiEl = state.modalEl.querySelector('#ulb-price-dpi')
    var qtyEl = state.modalEl.querySelector('#ulb-price-qty')

    if (dimsEl) {
      if (item.widthIn > 0 && item.heightIn > 0) {
        dimsEl.textContent = item.widthIn.toFixed(1) + '" × ' + item.heightIn.toFixed(1) + '" (' + item.widthPx + '×' + item.heightPx + 'px)'
      } else if (item.widthPx > 0 && item.heightPx > 0) {
        dimsEl.textContent = item.widthPx + ' × ' + item.heightPx + ' px'
      } else {
        dimsEl.textContent = 'Analyzing...'
      }
    }
    if (dpiEl) {
      dpiEl.textContent = item.dpi ? item.dpi + ' DPI' : '-'
    }
    if (qtyEl) qtyEl.textContent = '× ' + item.quantity
  }

  function updateUploadProgress(item, pct, speed) {
    var progressEl = state.modalEl.querySelector('#ulb-upload-progress')
    var fillEl = state.modalEl.querySelector('#ulb-progress-fill')
    var pctEl = state.modalEl.querySelector('#ulb-progress-percent')
    var nameEl = state.modalEl.querySelector('#ulb-progress-filename')
    var speedEl = state.modalEl.querySelector('#ulb-progress-speed')

    if (!progressEl) return

    progressEl.classList.add('ulb-visible')
    if (nameEl) nameEl.textContent = item.fileName
    if (fillEl) fillEl.style.width = pct + '%'
    if (pctEl) pctEl.textContent = Math.round(pct) + '%'
    if (speedEl && speed) speedEl.textContent = speed

    // Hide progress when done
    if (pct >= 100) {
      setTimeout(function () {
        progressEl.classList.remove('ulb-visible')
      }, 1500)
    }
  }

  function updateCartButton() {
    var btn = state.modalEl.querySelector('#ulb-cart-btn')
    var countSpan = state.modalEl.querySelector('#ulb-cart-count')
    if (!btn) return

    var readyItems = state.items.filter(function (it) { return it.status === 'ready' })
    btn.disabled = readyItems.length === 0

    if (countSpan) {
      var totalQty = 0
      for (var i = 0; i < readyItems.length; i++) {
        totalQty += readyItems[i].quantity || 1
      }
      if (totalQty > 0) {
        countSpan.textContent = totalQty
        countSpan.classList.add('ulb-visible')
      } else {
        countSpan.classList.remove('ulb-visible')
      }
    }
  }

  function updateCanvasLabels() {
    if (state.activeTab === 'canvas' && window.ULBuilderCanvas) {
      window.ULBuilderCanvas.updateLabels(getSelectedItem())
    }
  }

  function showRightPanelSections() {
    var sections = ['productinfo', 'aspect', 'dims', 'thumbs', 'pricing']
    for (var i = 0; i < sections.length; i++) {
      var el = state.modalEl.querySelector('#ulb-section-' + sections[i])
      if (el) el.style.display = ''
    }
  }

  function hideRightPanelSections() {
    var sections = ['productinfo', 'aspect', 'dims', 'thumbs', 'pricing']
    for (var i = 0; i < sections.length; i++) {
      var el = state.modalEl.querySelector('#ulb-section-' + sections[i])
      if (el) el.style.display = 'none'
    }
  }

  /* ─────────────────────────────────────────────
     Add to Cart
     ───────────────────────────────────────────── */
  function addToCart() {
    var readyItems = state.items.filter(function (it) { return it.status === 'ready' })
    if (readyItems.length === 0) return

    var btn = state.modalEl.querySelector('#ulb-cart-btn')
    if (btn) {
      btn.disabled = true
      btn.innerHTML = '<span class="ulb-spinner"></span> Adding...'
    }

    var cartItems = readyItems.map(function (item) {
      return {
        uploadId: item.uploadId,
        fileName: item.fileName,
        thumbUrl: item.thumbUrl,
        originalUrl: item.originalUrl,
        widthIn: item.widthIn,
        heightIn: item.heightIn,
        dpi: item.dpi,
        quantity: item.quantity,
      }
    })

    document.dispatchEvent(
      new CustomEvent('ul:builder:addToCart', {
        detail: {
          productId: state.productId,
          shopDomain: state.shopDomain,
          variantId: state.variantId,
          items: cartItems,
        },
      })
    )

    // Delegate to Shopify cart add
    addItemsToShopifyCart(cartItems)
  }

  function addItemsToShopifyCart(items) {
    var variantId = state.variantId
    if (!variantId) {
      showToast('Could not determine product variant. Please refresh the page.', 'error')
      var btn = state.modalEl.querySelector('#ulb-cart-btn')
      if (btn) {
        btn.disabled = false
        btn.innerHTML = ICONS.cart + ' <span>Add To Cart</span>'
      }
      return
    }

    var promises = items.map(function (item) {
      var properties = {
        '_Upload ID': item.uploadId,
        '_File Name': item.fileName,
        '_Width': item.widthIn.toFixed(2) + ' in',
        '_Height': item.heightIn.toFixed(2) + ' in',
        '_DPI': String(item.dpi),
        '_Thumbnail': item.thumbUrl,
        '_Original': item.originalUrl,
        '_Mode': 'builder',
      }

      return fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [
            {
              id: variantId,
              quantity: item.quantity,
              properties: properties,
            },
          ],
        }),
      })
    })

    Promise.all(promises)
      .then(function () {
        showToast('Added to cart!', 'success')
        if (window.ULAnalytics) {
          window.ULAnalytics.track('builder_add_to_cart', {
            productId: state.productId,
            itemCount: items.length,
          })
        }
        // Refresh cart counter
        refreshShopifyCart()
        close()
      })
      .catch(function (err) {
        showToast('Failed to add to cart: ' + err.message, 'error')
        var btn = state.modalEl.querySelector('#ulb-cart-btn')
        if (btn) {
          btn.disabled = false
          btn.innerHTML = ICONS.cart + ' <span>Add To Cart</span>'
        }
      })
  }

  function refreshShopifyCart() {
    fetch('/cart.js')
      .then(function (r) { return r.json() })
      .then(function (cart) {
        // Update cart count in header (common Shopify patterns)
        var countEls = document.querySelectorAll(
          '.cart-count, .cart-count-bubble, [data-cart-count], .js-cart-count'
        )
        for (var i = 0; i < countEls.length; i++) {
          countEls[i].textContent = cart.item_count
        }
        document.dispatchEvent(
          new CustomEvent('ul:cart:updated', { detail: { count: cart.item_count } })
        )
      })
      .catch(function () { /* ignore */ })
  }

  /* ─────────────────────────────────────────────
     Toast
     ───────────────────────────────────────────── */
  function showToast(message, type) {
    var toast = document.createElement('div')
    toast.className = 'ulb-toast ulb-toast-' + (type || 'success')
    toast.textContent = message
    document.body.appendChild(toast)
    setTimeout(function () {
      toast.style.opacity = '0'
      toast.style.transition = 'opacity 300ms'
      setTimeout(function () { toast.remove() }, 300)
    }, 3000)
  }

  /* ─────────────────────────────────────────────
     Utilities
     ───────────────────────────────────────────── */
  function formatMoney(cents) {
    if (typeof cents !== 'number') return '$0.00'
    var dollars = (cents / 100).toFixed(2)
    var formatted = state.moneyFormat
      .replace('{{amount}}', dollars)
      .replace('{{amount_no_decimals}}', Math.round(cents / 100))
      .replace('{{amount_with_comma_separator}}', dollars.replace('.', ','))
    return formatted
  }

  function escapeAttr(str) {
    if (!str) return ''
    return str
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }

  /* ─────────────────────────────────────────────
     Public API
     ───────────────────────────────────────────── */
  window.ULBuilderModal = {
    version: '1.0.0',
    init: init,
    open: open,
    close: close,
    switchTab: switchTab,
    getState: function () { return state },
    getItems: function () { return state.items },
    getSelectedItem: getSelectedItem,
    selectItem: selectItem,
    removeItem: removeItem,
    showToast: showToast,
    formatMoney: formatMoney,
    ICONS: ICONS,
    ALLOWED_EXTENSIONS: ALLOWED_EXTENSIONS,
  }
})()
