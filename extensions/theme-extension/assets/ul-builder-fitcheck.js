/**
 * Upload Studio - Builder FitCheck v2.0.0
 * =========================================
 * FitCheck tab: shows uploaded design overlaid on 6 garment mockups
 * in a 3×2 grid. Each mockup has real print-area dimensions (inches)
 * so the design is placed at its true proportional size.
 *
 * Features:
 *   - Dimension-aware scaling (design sized relative to garment print area)
 *   - 6 garment grid with size labels
 *   - Zoom overlay per mockup
 *   - Save mockup as PNG
 *   - 14-color picker
 *
 * Namespace: window.ULBuilderFitCheck
 *
 * Dependencies:
 *   - ul-builder-modal.js (window.ULBuilderModal)
 *   - ul-builder.css
 */

;(function () {
  'use strict'

  if (window.ULBuilderFitCheck) return

  /* ─────────────────────────────────────────────
     Garment Definitions with REAL print area sizes
     Each garment has:
       - printArea: max printable area in INCHES { w, h }
       - svgArea: where the print area sits on the SVG (percent)
       - placement: label like "Full Front", "Center"
     ───────────────────────────────────────────── */
  var GARMENTS = [
    {
      id: 'tshirt',
      label: 'T-Shirt',
      placement: 'Full Front',
      printArea: { w: 12, h: 14 },
      svgArea: { top: 22, left: 25, width: 50, height: 40 },
    },
    {
      id: 'hat',
      label: 'Hat',
      placement: 'Front Panel',
      printArea: { w: 4, h: 2.5 },
      svgArea: { top: 15, left: 20, width: 60, height: 35 },
    },
    {
      id: 'polo',
      label: 'Polo',
      placement: 'Left Chest',
      printArea: { w: 4.5, h: 4.5 },
      svgArea: { top: 24, left: 28, width: 44, height: 38 },
    },
    {
      id: 'tote',
      label: 'Tote Bag',
      placement: 'Center',
      printArea: { w: 10, h: 14 },
      svgArea: { top: 15, left: 15, width: 70, height: 55 },
    },
    {
      id: 'hoodie',
      label: 'Hoodie',
      placement: 'Full Front',
      printArea: { w: 12, h: 14 },
      svgArea: { top: 25, left: 22, width: 56, height: 38 },
    },
    {
      id: 'apron',
      label: 'Apron',
      placement: 'Center',
      printArea: { w: 10, h: 12 },
      svgArea: { top: 18, left: 22, width: 56, height: 42 },
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
    html += '  <span class="fc-color-label">Change your preview items to any color below:</span>'
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
     Build a single garment card
     ───────────────────────────────────────────── */
  function buildGarmentCard(garment, item) {
    var designSrc = item.thumbUrl || item.originalUrl || ''
    var fit = calcDesignFit(garment, item.widthIn, item.heightIn)
    var sa = garment.svgArea

    // Calculate design overlay size as % of mockup area
    var designWidthPct = 100
    var designHeightPct = 100
    if (fit.fitW > 0 && fit.fitH > 0) {
      designWidthPct = (fit.fitW / garment.printArea.w) * 100
      designHeightPct = (fit.fitH / garment.printArea.h) * 100
    }

    // Actual display dimensions label
    var sizeLabel = fit.fitW > 0
      ? fit.fitW.toFixed(2) + 'in × ' + fit.fitH.toFixed(2) + 'in'
      : (item.widthIn ? item.widthIn.toFixed(2) + 'in × ' + item.heightIn.toFixed(2) + 'in' : '—')

    var overflowBadge = fit.overflow
      ? '<span class="fc-overflow-badge" title="Design exceeds print area, will be scaled down">↕ Scaled</span>'
      : ''

    var html = ''
    html += '<div class="fc-card" data-fc-garment="' + garment.id + '">'

    // Garment mockup with design overlay
    html += '  <div class="fc-garment-wrapper">'
    html += '    <div class="fc-garment">'
    // SVG mockup
    html += '      ' + buildSVGMockup(garment, selectedColor)
    // Design overlay — positioned within the print area, scaled proportionally
    html += '      <div class="fc-design-overlay" style="'
    html += 'position:absolute;'
    html += 'top:' + sa.top + '%;'
    html += 'left:' + sa.left + '%;'
    html += 'width:' + sa.width + '%;'
    html += 'height:' + sa.height + '%;'
    html += 'display:flex;align-items:center;justify-content:center;'
    html += '">'
    if (designSrc) {
      html += '        <img src="' + escapeAttr(designSrc) + '" alt="Design" style="'
      html += 'max-width:' + designWidthPct.toFixed(1) + '%;'
      html += 'max-height:' + designHeightPct.toFixed(1) + '%;'
      html += 'object-fit:contain;'
      html += 'filter:drop-shadow(0 2px 6px rgba(0,0,0,0.2));'
      html += '">'
    }
    html += '      </div>'
    html += '    </div>'
    html += '  </div>'

    // Info row: garment name + placement
    html += '  <div class="fc-card-info">'
    html += '    <span class="fc-card-name">' + garment.label + '</span>'
    html += '    <span class="fc-card-placement">' + garment.placement + '</span>'
    html += '  </div>'

    // Action row: zoom + save + size
    html += '  <div class="fc-card-actions">'
    html += '    <button type="button" class="fc-action-btn" data-fc-zoom="' + garment.id + '" title="Zoom"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg> Zoom</button>'
    html += '    <button type="button" class="fc-action-btn" data-fc-save="' + garment.id + '" title="Save"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Save</button>'
    html += '  </div>'

    // Size label
    html += '  <div class="fc-size-label">' + sizeLabel + ' ' + overflowBadge + '</div>'

    html += '</div>'
    return html
  }

  /* ─────────────────────────────────────────────
     SVG Mockup Generator
     ───────────────────────────────────────────── */
  function buildSVGMockup(garment, color) {
    var w = 320
    var h = 400
    var bc = isLightColor(color) ? '#e5e7eb' : 'rgba(255,255,255,0.1)'

    switch (garment.id) {
      case 'tshirt':
        return '<svg viewBox="0 0 ' + w + ' ' + h + '" class="fc-mockup-svg" xmlns="http://www.w3.org/2000/svg">' +
          '<rect width="' + w + '" height="' + h + '" fill="transparent"/>' +
          '<path d="M80,50 L60,55 L30,100 L55,115 L75,85 L75,350 L245,350 L245,85 L265,115 L290,100 L260,55 L240,50 L210,70 C195,80 125,80 110,70 Z" fill="' + color + '" stroke="' + bc + '" stroke-width="1.5"/>' +
          '<path d="M110,70 C125,82 195,82 210,70 C200,58 120,58 110,70 Z" fill="' + darkenColor(color, 10) + '" stroke="' + bc + '" stroke-width="1"/>' +
          '</svg>'

      case 'hat':
        return '<svg viewBox="0 0 ' + w + ' ' + h + '" class="fc-mockup-svg" xmlns="http://www.w3.org/2000/svg">' +
          '<rect width="' + w + '" height="' + h + '" fill="transparent"/>' +
          '<path d="M60,200 Q80,80 160,70 Q240,80 260,200 Z" fill="' + color + '" stroke="' + bc + '" stroke-width="1.5"/>' +
          '<path d="M30,200 Q160,220 290,200 Q280,240 160,250 Q40,240 30,200 Z" fill="' + darkenColor(color, 15) + '" stroke="' + bc + '" stroke-width="1.5"/>' +
          '</svg>'

      case 'polo':
        return '<svg viewBox="0 0 ' + w + ' ' + h + '" class="fc-mockup-svg" xmlns="http://www.w3.org/2000/svg">' +
          '<rect width="' + w + '" height="' + h + '" fill="transparent"/>' +
          '<path d="M80,55 L55,60 L30,110 L60,120 L75,90 L75,350 L245,350 L245,90 L260,120 L290,110 L265,60 L240,55 L215,72 C200,82 120,82 105,72 Z" fill="' + color + '" stroke="' + bc + '" stroke-width="1.5"/>' +
          '<path d="M105,72 C120,84 200,84 215,72 L210,55 C195,65 125,65 110,55 Z" fill="' + darkenColor(color, 8) + '" stroke="' + bc + '" stroke-width="1"/>' +
          '<line x1="160" y1="72" x2="160" y2="140" stroke="' + bc + '" stroke-width="1"/>' +
          '<circle cx="160" cy="90" r="2.5" fill="' + bc + '"/>' +
          '<circle cx="160" cy="110" r="2.5" fill="' + bc + '"/>' +
          '</svg>'

      case 'tote':
        return '<svg viewBox="0 0 ' + w + ' ' + h + '" class="fc-mockup-svg" xmlns="http://www.w3.org/2000/svg">' +
          '<rect width="' + w + '" height="' + h + '" fill="transparent"/>' +
          '<path d="M100,60 Q100,30 130,30 L130,85" fill="none" stroke="' + color + '" stroke-width="8" stroke-linecap="round"/>' +
          '<path d="M220,60 Q220,30 190,30 L190,85" fill="none" stroke="' + color + '" stroke-width="8" stroke-linecap="round"/>' +
          '<rect x="60" y="80" width="200" height="280" rx="5" fill="' + color + '" stroke="' + bc + '" stroke-width="1.5"/>' +
          '</svg>'

      case 'hoodie':
        return '<svg viewBox="0 0 ' + w + ' ' + h + '" class="fc-mockup-svg" xmlns="http://www.w3.org/2000/svg">' +
          '<rect width="' + w + '" height="' + h + '" fill="transparent"/>' +
          '<path d="M80,65 L55,70 L25,130 L60,140 L72,100 L72,355 L248,355 L248,100 L260,140 L295,130 L265,70 L240,65 L210,80 C195,90 125,90 110,80 Z" fill="' + color + '" stroke="' + bc + '" stroke-width="1.5"/>' +
          '<path d="M110,80 C115,40 145,20 160,18 C175,20 205,40 210,80" fill="' + darkenColor(color, 8) + '" stroke="' + bc + '" stroke-width="1.5"/>' +
          '<path d="M105,240 L215,240 L215,290 Q160,300 105,290 Z" fill="' + darkenColor(color, 5) + '" stroke="' + bc + '" stroke-width="1"/>' +
          '<line x1="150" y1="80" x2="145" y2="130" stroke="' + bc + '" stroke-width="1.5"/>' +
          '<line x1="170" y1="80" x2="175" y2="130" stroke="' + bc + '" stroke-width="1.5"/>' +
          '</svg>'

      case 'apron':
        return '<svg viewBox="0 0 ' + w + ' ' + h + '" class="fc-mockup-svg" xmlns="http://www.w3.org/2000/svg">' +
          '<rect width="' + w + '" height="' + h + '" fill="transparent"/>' +
          '<path d="M120,50 Q160,30 200,50" fill="none" stroke="' + color + '" stroke-width="6" stroke-linecap="round"/>' +
          '<path d="M80,50 L80,320 Q160,340 240,320 L240,50 Q200,60 160,55 Q120,60 80,50 Z" fill="' + color + '" stroke="' + bc + '" stroke-width="1.5"/>' +
          '<path d="M80,180 L30,190" stroke="' + color + '" stroke-width="5" stroke-linecap="round"/>' +
          '<path d="M240,180 L290,190" stroke="' + color + '" stroke-width="5" stroke-linecap="round"/>' +
          '<rect x="110" y="220" width="100" height="70" rx="5" fill="' + darkenColor(color, 5) + '" stroke="' + bc + '" stroke-width="1"/>' +
          '</svg>'

      default:
        return '<div style="width:320px;height:400px;background:' + color + ';border-radius:8px;"></div>'
    }
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
    var sa = garment.svgArea
    var designWidthPct = fit.fitW > 0 ? (fit.fitW / garment.printArea.w) * 100 : 100
    var designHeightPct = fit.fitH > 0 ? (fit.fitH / garment.printArea.h) * 100 : 100

    var sizeLabel = fit.fitW > 0
      ? fit.fitW.toFixed(2) + 'in × ' + fit.fitH.toFixed(2) + 'in'
      : '—'

    var overlay = document.createElement('div')
    overlay.className = 'fc-zoom-overlay'
    overlay.innerHTML = [
      '<div class="fc-zoom-panel">',
      '  <div class="fc-zoom-header">',
      '    <span>' + garment.label + ' — ' + garment.placement + ' — ' + sizeLabel + '</span>',
      '    <button type="button" class="fc-zoom-close">×</button>',
      '  </div>',
      '  <div class="fc-zoom-body">',
      '    <div class="fc-garment fc-garment-zoom">',
             buildSVGMockup(garment, selectedColor),
      '      <div class="fc-design-overlay" style="',
      '        position:absolute;',
      '        top:' + sa.top + '%;left:' + sa.left + '%;',
      '        width:' + sa.width + '%;height:' + sa.height + '%;',
      '        display:flex;align-items:center;justify-content:center;">',
             designSrc ? '<img src="' + escapeAttr(designSrc) + '" alt="Design" style="max-width:' + designWidthPct.toFixed(1) + '%;max-height:' + designHeightPct.toFixed(1) + '%;object-fit:contain;filter:drop-shadow(0 2px 8px rgba(0,0,0,0.25));">' : '',
      '      </div>',
      '    </div>',
      '  </div>',
      '</div>',
    ].join('\n')

    document.body.appendChild(overlay)
    requestAnimationFrame(function () { overlay.classList.add('fc-zoom-visible') })
  }

  function closeZoom() {
    var existing = document.querySelector('.fc-zoom-overlay')
    if (existing) existing.remove()
  }

  /* ─────────────────────────────────────────────
     Save Mockup as PNG via Canvas
     ───────────────────────────────────────────── */
  function saveMockup(garmentId) {
    var card = document.querySelector('[data-fc-garment="' + garmentId + '"]')
    if (!card) return
    var garmentEl = card.querySelector('.fc-garment')
    if (!garmentEl) return

    var garment = getGarment(garmentId)
    if (!garment || !currentItem) return

    var canvas = document.createElement('canvas')
    var ctx = canvas.getContext('2d')
    var size = 800
    canvas.width = size
    canvas.height = size

    // Draw SVG as background
    var svgEl = garmentEl.querySelector('svg')
    if (!svgEl) return

    var svgData = new XMLSerializer().serializeToString(svgEl)
    var svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
    var svgUrl = URL.createObjectURL(svgBlob)

    var svgImg = new Image()
    svgImg.onload = function () {
      ctx.drawImage(svgImg, 0, 0, size, size)
      URL.revokeObjectURL(svgUrl)

      // Draw design overlay
      var designSrc = currentItem.thumbUrl || currentItem.originalUrl
      if (!designSrc) { downloadCanvas(canvas, garmentId); return }

      var designImg = new Image()
      designImg.crossOrigin = 'anonymous'
      designImg.onload = function () {
        var sa = garment.svgArea
        var fit = calcDesignFit(garment, currentItem.widthIn, currentItem.heightIn)
        var areaX = (sa.left / 100) * size
        var areaY = (sa.top / 100) * size
        var areaW = (sa.width / 100) * size
        var areaH = (sa.height / 100) * size

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
    svgImg.src = svgUrl
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

  function isLightColor(hex) {
    var r = parseInt(hex.slice(1, 3), 16)
    var g = parseInt(hex.slice(3, 5), 16)
    var b = parseInt(hex.slice(5, 7), 16)
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6
  }

  function darkenColor(hex, percent) {
    var r = parseInt(hex.slice(1, 3), 16)
    var g = parseInt(hex.slice(3, 5), 16)
    var b = parseInt(hex.slice(5, 7), 16)
    var f = 1 - percent / 100
    r = Math.round(r * f)
    g = Math.round(g * f)
    b = Math.round(b * f)
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)
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
    version: '2.0.0',
    activate: activate,
    GARMENTS: GARMENTS,
    COLORS: COLORS,
  }
})()
