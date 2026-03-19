/**
 * Upload Studio - Builder FitCheck v3.0.0
 * =========================================
 * FitCheck tab: shows uploaded design overlaid on 6 real garment
 * mockup photographs in a 3×2 grid.
 *
 * v3.0.0 Changes:
 *   - Replaced SVG cartoons with real PNG mockup images
 *   - CSS mix-blend-mode: multiply for color tinting
 *   - Proper dimension-aware scaling
 *   - Improved zoom overlay with mockup image
 *   - Better save-as-PNG via canvas compositing
 *
 * Namespace: window.ULBuilderFitCheck
 *
 * Dependencies:
 *   - ul-builder-modal.js (window.ULBuilderModal)
 *   - ul-builder.css
 *   - Mockup images must be set via window.ULBuilderAssets
 */

;(function () {
  'use strict'

  if (window.ULBuilderFitCheck) return

  /* ─────────────────────────────────────────────
     Garment Definitions with REAL print area sizes
     printArea: max printable area in INCHES { w, h }
     imgArea: where the print area sits on the image (percent of image)
     ───────────────────────────────────────────── */
  var GARMENTS = [
    {
      id: 'tshirt',
      label: 'T-Shirt',
      placement: 'Full Front',
      printArea: { w: 12, h: 14 },
      imgArea: { top: 28, left: 28, width: 44, height: 38 },
    },
    {
      id: 'hat',
      label: 'Hat',
      placement: 'Front Panel',
      printArea: { w: 4, h: 2.5 },
      imgArea: { top: 18, left: 25, width: 50, height: 30 },
    },
    {
      id: 'polo',
      label: 'Polo',
      placement: 'Left Chest',
      printArea: { w: 4.5, h: 4.5 },
      imgArea: { top: 28, left: 30, width: 40, height: 35 },
    },
    {
      id: 'tote',
      label: 'Tote Bag',
      placement: 'Center',
      printArea: { w: 10, h: 14 },
      imgArea: { top: 20, left: 18, width: 64, height: 50 },
    },
    {
      id: 'hoodie',
      label: 'Hoodie',
      placement: 'Full Front',
      printArea: { w: 12, h: 14 },
      imgArea: { top: 30, left: 26, width: 48, height: 36 },
    },
    {
      id: 'apron',
      label: 'Apron',
      placement: 'Center',
      printArea: { w: 10, h: 12 },
      imgArea: { top: 22, left: 24, width: 52, height: 40 },
    },
  ]

  /* ─────────────────────────────────────────────
     Color Palette
     ───────────────────────────────────────────── */
  var COLORS = [
    { name: 'White', hex: '#FFFFFF' },
    { name: 'Black', hex: '#1a1a1a' },
    { name: 'Navy', hex: '#1e3a5f' },
    { name: 'Red', hex: '#dc2626' },
    { name: 'Royal Blue', hex: '#2563eb' },
    { name: 'Forest Green', hex: '#166534' },
    { name: 'Charcoal', hex: '#4b5563' },
    { name: 'Burgundy', hex: '#7f1d1d' },
    { name: 'Orange', hex: '#ea580c' },
    { name: 'Purple', hex: '#7c3aed' },
    { name: 'Pink', hex: '#ec4899' },
    { name: 'Light Blue', hex: '#93c5fd' },
    { name: 'Yellow', hex: '#eab308' },
    { name: 'Sand', hex: '#d4c5a9' },
  ]

  var currentItem = null
  var selectedColor = '#FFFFFF'

  /* ─────────────────────────────────────────────
     Get mockup image URL for a garment
     ───────────────────────────────────────────── */
  function getMockupUrl(garmentId) {
    var assets = window.ULBuilderAssets || {}
    return assets[garmentId] || ''
  }

  /* ─────────────────────────────────────────────
     Calculate design fit for a garment
     Returns { fitW, fitH, scalePercent, overflow }
     ───────────────────────────────────────────── */
  function calcDesignFit(garment, designWidthIn, designHeightIn) {
    if (!designWidthIn || !designHeightIn) {
      return { fitW: 0, fitH: 0, scalePercent: 100, overflow: false }
    }
    var pa = garment.printArea
    var scaleW = pa.w / designWidthIn
    var scaleH = pa.h / designHeightIn
    var scale = Math.min(scaleW, scaleH, 1)
    var fitW = designWidthIn * scale
    var fitH = designHeightIn * scale
    var overflow = designWidthIn > pa.w || designHeightIn > pa.h
    return {
      fitW: fitW,
      fitH: fitH,
      scalePercent: Math.round(scale * 100),
      overflow: overflow,
      designW: designWidthIn,
      designH: designHeightIn,
    }
  }

  /* ─────────────────────────────────────────────
     CSS filter for color tinting
     Converts hex color to CSS filter values for multiply blend
     ───────────────────────────────────────────── */
  function getColorFilter(hex) {
    // For white (default), no filter needed
    if (hex === '#FFFFFF' || hex === '#ffffff') return 'none'
    // For other colors, we use background-color with mix-blend-mode
    return hex
  }

  /* ─────────────────────────────────────────────
     Activate FitCheck for an item
     ───────────────────────────────────────────── */
  function activate(item) {
    currentItem = item
    var content = document.querySelector('#ulb-fitcheck-content')
    var empty = document.querySelector('#ulb-fitcheck-empty')

    if (!item || item.status !== 'ready') {
      if (content) content.style.display = 'none'
      if (empty) empty.style.display = 'flex'
      return
    }

    if (empty) empty.style.display = 'none'
    if (content) {
      content.style.display = 'flex'
      content.style.flexDirection = 'column'
      content.style.gap = '12px'
      content.style.flex = '1'
    }

    renderFitCheck(item)
  }

  /* ─────────────────────────────────────────────
     Render FitCheck — full grid of all garments
     ───────────────────────────────────────────── */
  function renderFitCheck(item) {
    var content = document.querySelector('#ulb-fitcheck-content')
    if (!content) return

    var html = ''

    // Color picker row (top)
    html += '<div class="fc-color-row" id="fc-color-row">'
    html += '  <span class="fc-color-label">Change preview color:</span>'
    html += '  <div class="fc-colors">'
    for (var c = 0; c < COLORS.length; c++) {
      var col = COLORS[c]
      var activeClass = col.hex === selectedColor ? ' fc-color-active' : ''
      var border = col.hex === '#FFFFFF' ? 'border-color:#d1d5db;' : ''
      html += '<button type="button" class="fc-color-dot' + activeClass + '" '
      html += 'data-fc-color="' + col.hex + '" title="' + col.name + '" '
      html += 'style="background:' + col.hex + ';' + border + '"></button>'
    }
    html += '  </div>'
    html += '</div>'

    // 3×2 garment grid
    html += '<div class="fc-grid" id="fc-grid">'
    for (var i = 0; i < GARMENTS.length; i++) {
      html += buildGarmentCard(GARMENTS[i], item)
    }
    html += '</div>'

    content.innerHTML = html
    bindEvents(content)
  }

  /* ─────────────────────────────────────────────
     Build a single garment card with PNG mockup
     ───────────────────────────────────────────── */
  function buildGarmentCard(garment, item) {
    var designSrc = item.thumbUrl || item.originalUrl || ''
    var fit = calcDesignFit(garment, item.widthIn, item.heightIn)
    var ia = garment.imgArea
    var mockupUrl = getMockupUrl(garment.id)

    // Calculate design overlay size as % of print area
    var designWidthPct = 100
    var designHeightPct = 100
    if (fit.fitW > 0 && fit.fitH > 0) {
      designWidthPct = (fit.fitW / garment.printArea.w) * 100
      designHeightPct = (fit.fitH / garment.printArea.h) * 100
    }

    // Size label
    var sizeLabel = fit.fitW > 0
      ? fit.fitW.toFixed(1) + '" × ' + fit.fitH.toFixed(1) + '"'
      : (item.widthIn ? item.widthIn.toFixed(1) + '" × ' + item.heightIn.toFixed(1) + '"' : '—')

    var overflowBadge = fit.overflow
      ? '<span class="fc-overflow-badge" title="Design exceeds print area, will be scaled down">↕ Scaled</span>'
      : ''

    // Determine tint style
    var isWhite = selectedColor === '#FFFFFF' || selectedColor === '#ffffff'
    var tintBg = isWhite ? '#f0f0f0' : selectedColor
    var blendMode = isWhite ? 'normal' : 'multiply'

    var html = ''
    html += '<div class="fc-card" data-fc-garment="' + garment.id + '">'

    // Garment mockup with design overlay
    html += '  <div class="fc-garment-wrapper" style="background:' + tintBg + ';border-radius:12px;overflow:hidden;position:relative;">'
    html += '    <div class="fc-garment" style="position:relative;width:100%;aspect-ratio:4/5;">'

    // Mockup image with color tinting via mix-blend-mode
    if (mockupUrl) {
      html += '      <img src="' + escapeAttr(mockupUrl) + '" alt="' + garment.label + '" '
      html += '        class="fc-mockup-img" style="'
      html += 'position:absolute;top:0;left:0;width:100%;height:100%;object-fit:contain;'
      html += 'mix-blend-mode:' + blendMode + ';'
      html += 'pointer-events:none;'
      html += '">'
    } else {
      // Fallback: colored rectangle with label
      html += '      <div style="position:absolute;top:0;left:0;width:100%;height:100%;'
      html += 'display:flex;align-items:center;justify-content:center;'
      html += 'font-size:18px;font-weight:600;color:rgba(0,0,0,0.3);'
      html += '">' + garment.label + '</div>'
    }

    // Design overlay — positioned within the print area
    html += '      <div class="fc-design-overlay" style="'
    html += 'position:absolute;'
    html += 'top:' + ia.top + '%;'
    html += 'left:' + ia.left + '%;'
    html += 'width:' + ia.width + '%;'
    html += 'height:' + ia.height + '%;'
    html += 'display:flex;align-items:center;justify-content:center;'
    html += 'pointer-events:none;'
    html += '">'
    if (designSrc) {
      html += '        <img src="' + escapeAttr(designSrc) + '" alt="Design" style="'
      html += 'max-width:' + designWidthPct.toFixed(1) + '%;'
      html += 'max-height:' + designHeightPct.toFixed(1) + '%;'
      html += 'object-fit:contain;'
      html += 'filter:drop-shadow(0 1px 4px rgba(0,0,0,0.15));'
      html += '">'
    }
    html += '      </div>'

    html += '    </div>'
    html += '  </div>'

    // Info row
    html += '  <div class="fc-card-info">'
    html += '    <span class="fc-card-name">' + garment.label + '</span>'
    html += '    <span class="fc-card-placement">' + garment.placement + '</span>'
    html += '  </div>'

    // Action row
    html += '  <div class="fc-card-actions">'
    html += '    <button type="button" class="fc-action-btn" data-fc-zoom="' + garment.id + '" title="Zoom">'
    html += '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg> Zoom</button>'
    html += '    <button type="button" class="fc-action-btn" data-fc-save="' + garment.id + '" title="Save">'
    html += '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Save</button>'
    html += '  </div>'

    // Size label
    html += '  <div class="fc-size-label">' + sizeLabel + ' ' + overflowBadge + '</div>'

    html += '</div>'
    return html
  }

  /* ─────────────────────────────────────────────
     Event Binding
     ───────────────────────────────────────────── */
  function bindEvents(container) {
    container.addEventListener('click', function (e) {
      // Color picker
      var colorBtn = e.target.closest('[data-fc-color]')
      if (colorBtn) {
        e.preventDefault()
        selectedColor = colorBtn.dataset.fcColor
        var allColors = container.querySelectorAll('[data-fc-color]')
        for (var j = 0; j < allColors.length; j++) {
          allColors[j].classList.toggle('fc-color-active', allColors[j] === colorBtn)
        }
        refreshAllCards()
        return
      }

      // Zoom
      var zoomBtn = e.target.closest('[data-fc-zoom]')
      if (zoomBtn) {
        e.preventDefault()
        openZoom(zoomBtn.dataset.fcZoom)
        return
      }

      // Save
      var saveBtn = e.target.closest('[data-fc-save]')
      if (saveBtn) {
        e.preventDefault()
        saveMockup(saveBtn.dataset.fcSave)
        return
      }

      // Close zoom overlay
      if (e.target.closest('.fc-zoom-close') || e.target.classList.contains('fc-zoom-overlay')) {
        e.preventDefault()
        closeZoom()
        return
      }
    })
  }

  /* ─────────────────────────────────────────────
     Refresh all garment cards (after color change)
     ───────────────────────────────────────────── */
  function refreshAllCards() {
    if (!currentItem) return
    var grid = document.querySelector('#fc-grid')
    if (!grid) return
    var html = ''
    for (var i = 0; i < GARMENTS.length; i++) {
      html += buildGarmentCard(GARMENTS[i], currentItem)
    }
    grid.innerHTML = html
  }

  /* ─────────────────────────────────────────────
     Zoom Overlay
     ───────────────────────────────────────────── */
  function openZoom(garmentId) {
    closeZoom()
    var garment = getGarment(garmentId)
    if (!garment || !currentItem) return

    var fit = calcDesignFit(garment, currentItem.widthIn, currentItem.heightIn)
    var designSrc = currentItem.thumbUrl || currentItem.originalUrl || ''
    var ia = garment.imgArea
    var mockupUrl = getMockupUrl(garment.id)
    var designWidthPct = fit.fitW > 0 ? (fit.fitW / garment.printArea.w) * 100 : 100
    var designHeightPct = fit.fitH > 0 ? (fit.fitH / garment.printArea.h) * 100 : 100

    var sizeLabel = fit.fitW > 0
      ? fit.fitW.toFixed(2) + '" × ' + fit.fitH.toFixed(2) + '"'
      : '—'

    var isWhite = selectedColor === '#FFFFFF' || selectedColor === '#ffffff'
    var tintBg = isWhite ? '#f0f0f0' : selectedColor
    var blendMode = isWhite ? 'normal' : 'multiply'

    var overlay = document.createElement('div')
    overlay.className = 'fc-zoom-overlay'
    overlay.innerHTML = [
      '<div class="fc-zoom-panel">',
      '  <div class="fc-zoom-header">',
      '    <span>' + garment.label + ' — ' + garment.placement + ' — ' + sizeLabel + '</span>',
      '    <button type="button" class="fc-zoom-close">×</button>',
      '  </div>',
      '  <div class="fc-zoom-body" style="background:' + tintBg + ';border-radius:12px;overflow:hidden;">',
      '    <div class="fc-garment fc-garment-zoom" style="position:relative;width:100%;aspect-ratio:4/5;">',
             mockupUrl
               ? '<img src="' + escapeAttr(mockupUrl) + '" alt="' + garment.label + '" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:contain;mix-blend-mode:' + blendMode + ';">'
               : '',
      '      <div class="fc-design-overlay" style="',
      '        position:absolute;',
      '        top:' + ia.top + '%;left:' + ia.left + '%;',
      '        width:' + ia.width + '%;height:' + ia.height + '%;',
      '        display:flex;align-items:center;justify-content:center;">',
             designSrc ? '<img src="' + escapeAttr(designSrc) + '" alt="Design" style="max-width:' + designWidthPct.toFixed(1) + '%;max-height:' + designHeightPct.toFixed(1) + '%;object-fit:contain;filter:drop-shadow(0 2px 8px rgba(0,0,0,0.25));">' : '',
      '      </div>',
      '    </div>',
      '  </div>',
      '</div>',
    ].join('\n')

    document.body.appendChild(overlay)
    requestAnimationFrame(function () { overlay.classList.add('fc-zoom-visible') })

    // Bind close for this overlay
    overlay.addEventListener('click', function (e) {
      if (e.target.closest('.fc-zoom-close') || e.target === overlay) {
        closeZoom()
      }
    })
  }

  function closeZoom() {
    var existing = document.querySelector('.fc-zoom-overlay')
    if (existing) existing.remove()
  }

  /* ─────────────────────────────────────────────
     Save Mockup as PNG via Canvas
     ───────────────────────────────────────────── */
  function saveMockup(garmentId) {
    var garment = getGarment(garmentId)
    if (!garment || !currentItem) return

    var mockupUrl = getMockupUrl(garmentId)
    if (!mockupUrl) {
      if (window.ULBuilderModal && window.ULBuilderModal.showToast) {
        window.ULBuilderModal.showToast('Mockup image not available', 'error')
      }
      return
    }

    var canvas = document.createElement('canvas')
    var ctx = canvas.getContext('2d')
    var size = 800
    canvas.width = size
    canvas.height = Math.round(size * 1.25) // 4:5 aspect ratio

    // Fill background with selected color
    ctx.fillStyle = selectedColor === '#FFFFFF' ? '#f0f0f0' : selectedColor
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // Draw mockup image
    var mockImg = new Image()
    mockImg.crossOrigin = 'anonymous'
    mockImg.onload = function () {
      // Apply multiply blend if not white
      if (selectedColor !== '#FFFFFF' && selectedColor !== '#ffffff') {
        ctx.globalCompositeOperation = 'multiply'
      }
      ctx.drawImage(mockImg, 0, 0, canvas.width, canvas.height)
      ctx.globalCompositeOperation = 'source-over'

      // Draw design overlay
      var designSrc = currentItem.thumbUrl || currentItem.originalUrl
      if (!designSrc) { downloadCanvas(canvas, garmentId); return }

      var designImg = new Image()
      designImg.crossOrigin = 'anonymous'
      designImg.onload = function () {
        var ia = garment.imgArea
        var fit = calcDesignFit(garment, currentItem.widthIn, currentItem.heightIn)

        var areaX = (ia.left / 100) * canvas.width
        var areaY = (ia.top / 100) * canvas.height
        var areaW = (ia.width / 100) * canvas.width
        var areaH = (ia.height / 100) * canvas.height

        var designRatio = designImg.width / designImg.height
        var fitWPct = fit.fitW > 0 ? fit.fitW / garment.printArea.w : 1
        var fitHPct = fit.fitH > 0 ? fit.fitH / garment.printArea.h : 1

        var drawW = areaW * fitWPct
        var drawH = areaH * fitHPct
        // Maintain aspect ratio
        if (drawW / drawH > designRatio) {
          drawW = drawH * designRatio
        } else {
          drawH = drawW / designRatio
        }
        var drawX = areaX + (areaW - drawW) / 2
        var drawY = areaY + (areaH - drawH) / 2

        ctx.drawImage(designImg, drawX, drawY, drawW, drawH)
        downloadCanvas(canvas, garmentId)
      }
      designImg.onerror = function () { downloadCanvas(canvas, garmentId) }
      designImg.src = designSrc
    }
    mockImg.onerror = function () {
      if (window.ULBuilderModal && window.ULBuilderModal.showToast) {
        window.ULBuilderModal.showToast('Failed to load mockup for save', 'error')
      }
    }
    mockImg.src = mockupUrl
  }

  function downloadCanvas(canvas, garmentId) {
    var link = document.createElement('a')
    link.download = 'fitcheck-' + garmentId + '.png'
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  /* ─────────────────────────────────────────────
     Helpers
     ───────────────────────────────────────────── */
  function getGarment(id) {
    for (var i = 0; i < GARMENTS.length; i++) {
      if (GARMENTS[i].id === id) return GARMENTS[i]
    }
    return null
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
  window.ULBuilderFitCheck = {
    version: '3.0.0',
    activate: activate,
    GARMENTS: GARMENTS,
    COLORS: COLORS,
  }
})()
