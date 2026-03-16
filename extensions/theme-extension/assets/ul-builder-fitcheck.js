/**
 * Upload Studio - Builder FitCheck v1.0.0
 * =========================================
 * FitCheck tab: shows uploaded design overlaid on 6 product mockups
 * (T-Shirt, Hat, Polo, Tote Bag, Hoodie, Apron). Includes a
 * 14-color picker to change the mockup product color.
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
     Product Mockups
     ───────────────────────────────────────────── */
  var PRODUCTS = [
    {
      id: 'tshirt',
      label: 'T-Shirt',
      icon: '👕',
      // Design placement area (percent of mockup image)
      designArea: { top: 22, left: 25, width: 50, height: 40 },
    },
    {
      id: 'hat',
      label: 'Hat',
      icon: '🧢',
      designArea: { top: 15, left: 20, width: 60, height: 35 },
    },
    {
      id: 'polo',
      label: 'Polo',
      icon: '👔',
      designArea: { top: 24, left: 28, width: 44, height: 38 },
    },
    {
      id: 'tote',
      label: 'Tote Bag',
      icon: '👜',
      designArea: { top: 15, left: 15, width: 70, height: 55 },
    },
    {
      id: 'hoodie',
      label: 'Hoodie',
      icon: '🧥',
      designArea: { top: 25, left: 22, width: 56, height: 38 },
    },
    {
      id: 'apron',
      label: 'Apron',
      icon: '🍳',
      designArea: { top: 18, left: 22, width: 56, height: 42 },
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
  var selectedProduct = 'tshirt'
  var selectedColor = '#FFFFFF'

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
      content.style.gap = '16px'
      content.style.flex = '1'
    }

    renderFitCheck(item)
  }

  /* ─────────────────────────────────────────────
     Render FitCheck Content
     ───────────────────────────────────────────── */
  function renderFitCheck(item) {
    var content = document.querySelector('#ulb-fitcheck-content')
    if (!content) return

    content.innerHTML = [
      // Preview area with mockup + design overlay
      '<div class="ulb-fitcheck-preview" id="ulb-fitcheck-preview">',
        buildMockupHTML(item),
      '</div>',

      // Product selector grid (6 items: 3 per row mobile, 6 desktop)
      '<div class="ulb-fitcheck-products" id="ulb-fitcheck-products">',
        buildProductSelectorHTML(),
      '</div>',

      // Color picker
      '<div class="ulb-fitcheck-colors" id="ulb-fitcheck-colors">',
        buildColorPickerHTML(),
      '</div>',
    ].join('\n')

    bindFitCheckEvents(content)
  }

  /* ─────────────────────────────────────────────
     Build Mockup Preview HTML
     ───────────────────────────────────────────── */
  function buildMockupHTML(item) {
    var product = getProduct(selectedProduct)
    if (!product) return ''

    var designSrc = item.thumbUrl || item.originalUrl || ''
    var area = product.designArea

    return [
      '<div class="ulb-fitcheck-mockup" id="ulb-fitcheck-mockup">',
      // SVG-based mockup (no external images needed)
        buildSVGMockup(product, selectedColor),
      // Design overlay positioned via percentages
      '  <div class="ulb-fitcheck-design-overlay" style="',
      '    position:absolute;',
      '    top:' + area.top + '%;',
      '    left:' + area.left + '%;',
      '    width:' + area.width + '%;',
      '    height:' + area.height + '%;',
      '    display:flex;align-items:center;justify-content:center;',
      '  ">',
      '    <img src="' + escapeAttr(designSrc) + '" alt="Design" style="max-width:100%;max-height:100%;object-fit:contain;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.15));">',
      '  </div>',
      '</div>',
    ].join('\n')
  }

  /* ─────────────────────────────────────────────
     SVG Mockup Generator (no external assets)
     ───────────────────────────────────────────── */
  function buildSVGMockup(product, color) {
    var w = 320
    var h = 400
    var borderColor = isLightColor(color) ? '#e5e7eb' : 'rgba(255,255,255,0.1)'

    switch (product.id) {
      case 'tshirt':
        return '<svg viewBox="0 0 ' + w + ' ' + h + '" class="ulb-fitcheck-mockup-img" xmlns="http://www.w3.org/2000/svg">' +
          '<rect width="' + w + '" height="' + h + '" fill="transparent"/>' +
          // T-shirt shape
          '<path d="M80,50 L60,55 L30,100 L55,115 L75,85 L75,350 L245,350 L245,85 L265,115 L290,100 L260,55 L240,50 L210,70 C195,80 125,80 110,70 Z" ' +
          'fill="' + color + '" stroke="' + borderColor + '" stroke-width="1.5"/>' +
          // Collar
          '<path d="M110,70 C125,82 195,82 210,70 C200,58 120,58 110,70 Z" ' +
          'fill="' + darkenColor(color, 10) + '" stroke="' + borderColor + '" stroke-width="1"/>' +
          '</svg>'

      case 'hat':
        return '<svg viewBox="0 0 ' + w + ' ' + h + '" class="ulb-fitcheck-mockup-img" xmlns="http://www.w3.org/2000/svg">' +
          '<rect width="' + w + '" height="' + h + '" fill="transparent"/>' +
          // Hat crown
          '<path d="M60,200 Q80,80 160,70 Q240,80 260,200 Z" ' +
          'fill="' + color + '" stroke="' + borderColor + '" stroke-width="1.5"/>' +
          // Brim
          '<path d="M30,200 Q160,220 290,200 Q280,240 160,250 Q40,240 30,200 Z" ' +
          'fill="' + darkenColor(color, 15) + '" stroke="' + borderColor + '" stroke-width="1.5"/>' +
          '</svg>'

      case 'polo':
        return '<svg viewBox="0 0 ' + w + ' ' + h + '" class="ulb-fitcheck-mockup-img" xmlns="http://www.w3.org/2000/svg">' +
          '<rect width="' + w + '" height="' + h + '" fill="transparent"/>' +
          // Polo body
          '<path d="M80,55 L55,60 L30,110 L60,120 L75,90 L75,350 L245,350 L245,90 L260,120 L290,110 L265,60 L240,55 L215,72 C200,82 120,82 105,72 Z" ' +
          'fill="' + color + '" stroke="' + borderColor + '" stroke-width="1.5"/>' +
          // Collar (polo style)
          '<path d="M105,72 C120,84 200,84 215,72 L210,55 C195,65 125,65 110,55 Z" ' +
          'fill="' + darkenColor(color, 8) + '" stroke="' + borderColor + '" stroke-width="1"/>' +
          // Button placket
          '<line x1="160" y1="72" x2="160" y2="140" stroke="' + borderColor + '" stroke-width="1"/>' +
          '<circle cx="160" cy="90" r="2.5" fill="' + borderColor + '"/>' +
          '<circle cx="160" cy="110" r="2.5" fill="' + borderColor + '"/>' +
          '</svg>'

      case 'tote':
        return '<svg viewBox="0 0 ' + w + ' ' + h + '" class="ulb-fitcheck-mockup-img" xmlns="http://www.w3.org/2000/svg">' +
          '<rect width="' + w + '" height="' + h + '" fill="transparent"/>' +
          // Handles
          '<path d="M100,60 Q100,30 130,30 L130,85" fill="none" stroke="' + color + '" stroke-width="8" stroke-linecap="round"/>' +
          '<path d="M220,60 Q220,30 190,30 L190,85" fill="none" stroke="' + color + '" stroke-width="8" stroke-linecap="round"/>' +
          // Bag
          '<rect x="60" y="80" width="200" height="280" rx="5" ' +
          'fill="' + color + '" stroke="' + borderColor + '" stroke-width="1.5"/>' +
          '</svg>'

      case 'hoodie':
        return '<svg viewBox="0 0 ' + w + ' ' + h + '" class="ulb-fitcheck-mockup-img" xmlns="http://www.w3.org/2000/svg">' +
          '<rect width="' + w + '" height="' + h + '" fill="transparent"/>' +
          // Hoodie body with hood
          '<path d="M80,65 L55,70 L25,130 L60,140 L72,100 L72,355 L248,355 L248,100 L260,140 L295,130 L265,70 L240,65 L210,80 C195,90 125,90 110,80 Z" ' +
          'fill="' + color + '" stroke="' + borderColor + '" stroke-width="1.5"/>' +
          // Hood
          '<path d="M110,80 C115,40 145,20 160,18 C175,20 205,40 210,80" ' +
          'fill="' + darkenColor(color, 8) + '" stroke="' + borderColor + '" stroke-width="1.5"/>' +
          // Front pocket
          '<path d="M105,240 L215,240 L215,290 Q160,300 105,290 Z" ' +
          'fill="' + darkenColor(color, 5) + '" stroke="' + borderColor + '" stroke-width="1"/>' +
          // Drawstrings
          '<line x1="150" y1="80" x2="145" y2="130" stroke="' + borderColor + '" stroke-width="1.5"/>' +
          '<line x1="170" y1="80" x2="175" y2="130" stroke="' + borderColor + '" stroke-width="1.5"/>' +
          '</svg>'

      case 'apron':
        return '<svg viewBox="0 0 ' + w + ' ' + h + '" class="ulb-fitcheck-mockup-img" xmlns="http://www.w3.org/2000/svg">' +
          '<rect width="' + w + '" height="' + h + '" fill="transparent"/>' +
          // Neck strap
          '<path d="M120,50 Q160,30 200,50" fill="none" stroke="' + color + '" stroke-width="6" stroke-linecap="round"/>' +
          // Apron body
          '<path d="M80,50 L80,320 Q160,340 240,320 L240,50 Q200,60 160,55 Q120,60 80,50 Z" ' +
          'fill="' + color + '" stroke="' + borderColor + '" stroke-width="1.5"/>' +
          // Waist ties
          '<path d="M80,180 L30,190" stroke="' + color + '" stroke-width="5" stroke-linecap="round"/>' +
          '<path d="M240,180 L290,190" stroke="' + color + '" stroke-width="5" stroke-linecap="round"/>' +
          // Pocket
          '<rect x="110" y="220" width="100" height="70" rx="5" ' +
          'fill="' + darkenColor(color, 5) + '" stroke="' + borderColor + '" stroke-width="1"/>' +
          '</svg>'

      default:
        return '<div style="width:320px;height:400px;background:' + color + ';border-radius:8px;"></div>'
    }
  }

  /* ─────────────────────────────────────────────
     Product Selector HTML
     ───────────────────────────────────────────── */
  function buildProductSelectorHTML() {
    var html = ''
    for (var i = 0; i < PRODUCTS.length; i++) {
      var p = PRODUCTS[i]
      var selClass = p.id === selectedProduct ? ' ulb-fitcheck-selected' : ''
      html += '<button type="button" class="ulb-fitcheck-product' + selClass + '" data-fitcheck-product="' + p.id + '">'
      html += '  <span class="ulb-fitcheck-product-icon">' + p.icon + '</span>'
      html += '  <span>' + p.label + '</span>'
      html += '</button>'
    }
    return html
  }

  /* ─────────────────────────────────────────────
     Color Picker HTML
     ───────────────────────────────────────────── */
  function buildColorPickerHTML() {
    var html = ''
    for (var i = 0; i < COLORS.length; i++) {
      var c = COLORS[i]
      var activeClass = c.hex === selectedColor ? ' ulb-color-active' : ''
      var borderStyle = c.hex === '#FFFFFF'
        ? 'border-color:#d1d5db;'
        : ''
      html += '<button type="button" class="ulb-fitcheck-color' + activeClass + '" '
      html += 'data-fitcheck-color="' + c.hex + '" '
      html += 'title="' + c.name + '" '
      html += 'style="background:' + c.hex + ';' + borderStyle + '">'
      html += '</button>'
    }
    return html
  }

  /* ─────────────────────────────────────────────
     Event Binding
     ───────────────────────────────────────────── */
  function bindFitCheckEvents(container) {
    // Product selector
    container.addEventListener('click', function (e) {
      var productBtn = e.target.closest('[data-fitcheck-product]')
      if (productBtn) {
        e.preventDefault()
        selectedProduct = productBtn.dataset.fitcheckProduct
        // Update selector highlighting
        var allBtns = container.querySelectorAll('[data-fitcheck-product]')
        for (var i = 0; i < allBtns.length; i++) {
          allBtns[i].classList.toggle('ulb-fitcheck-selected', allBtns[i] === productBtn)
        }
        updatePreview()
        return
      }

      var colorBtn = e.target.closest('[data-fitcheck-color]')
      if (colorBtn) {
        e.preventDefault()
        selectedColor = colorBtn.dataset.fitcheckColor
        // Update color highlighting
        var allColors = container.querySelectorAll('[data-fitcheck-color]')
        for (var j = 0; j < allColors.length; j++) {
          allColors[j].classList.toggle('ulb-color-active', allColors[j] === colorBtn)
        }
        updatePreview()
      }
    })
  }

  function updatePreview() {
    if (!currentItem) return
    var preview = document.querySelector('#ulb-fitcheck-preview')
    if (preview) {
      preview.innerHTML = buildMockupHTML(currentItem)
    }
  }

  /* ─────────────────────────────────────────────
     Color Utilities
     ───────────────────────────────────────────── */
  function isLightColor(hex) {
    var r = parseInt(hex.slice(1, 3), 16)
    var g = parseInt(hex.slice(3, 5), 16)
    var b = parseInt(hex.slice(5, 7), 16)
    var luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    return luminance > 0.6
  }

  function darkenColor(hex, percent) {
    var r = parseInt(hex.slice(1, 3), 16)
    var g = parseInt(hex.slice(3, 5), 16)
    var b = parseInt(hex.slice(5, 7), 16)
    var factor = 1 - percent / 100
    r = Math.round(r * factor)
    g = Math.round(g * factor)
    b = Math.round(b * factor)
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
    version: '1.0.0',
    activate: activate,
    PRODUCTS: PRODUCTS,
    COLORS: COLORS,
  }
})()
