/**
 * Upload Studio - Builder Canvas v1.0.0
 * =======================================
 * Canvas tab: shows the uploaded design with marching-ants border,
 * green inch labels (W × H), dimension arrows, and reference squares.
 *
 * Namespace: window.ULBuilderCanvas
 *
 * Dependencies:
 *   - ul-builder-modal.js (window.ULBuilderModal)
 *   - ul-builder.css
 */

;(function () {
  'use strict'

  if (window.ULBuilderCanvas) return

  /* ─────────────────────────────────────────────
     Reference squares (industry standard sizes)
     ───────────────────────────────────────────── */
  var REF_SQUARES = [
    { label: '3" × 3"', w: 3, h: 3, px: 30 },
    { label: '5" × 5"', w: 5, h: 5, px: 50 },
    { label: '8" × 8"', w: 8, h: 8, px: 80 },
  ]

  var currentItem = null
  var animFrame = null
  var antOffset = 0

  /* ─────────────────────────────────────────────
     Activate Canvas for an item
     ───────────────────────────────────────────── */
  function activate(item) {
    currentItem = item
    var wrapper = document.querySelector('#ulb-canvas-wrapper')
    var empty = document.querySelector('#ulb-canvas-empty')

    if (!item || item.status !== 'ready') {
      if (wrapper) wrapper.style.display = 'none'
      if (empty) empty.style.display = 'flex'
      stopAnimation()
      return
    }

    if (empty) empty.style.display = 'none'
    if (wrapper) wrapper.style.display = 'flex'

    renderCanvas(item)
    startAnimation()
  }

  /* ─────────────────────────────────────────────
     Render Canvas Content
     ───────────────────────────────────────────── */
  function renderCanvas(item) {
    var wrapper = document.querySelector('#ulb-canvas-wrapper')
    if (!wrapper) return

    var imgSrc = item.thumbUrl || item.originalUrl || ''
    var wLabel = (item.widthIn || 0).toFixed(1) + '"'
    var hLabel = (item.heightIn || 0).toFixed(1) + '"'

    var html = [
      '<div class="ulb-canvas-img-container" id="ulb-canvas-img-container">',
      '  <canvas id="ulb-canvas-ants" class="ulb-canvas-ants-layer"></canvas>',
      '  <img class="ulb-canvas-img" id="ulb-canvas-img" src="' + escapeAttr(imgSrc) + '" alt="Design Preview">',

      // Dimension arrows
      '  <div class="ulb-canvas-arrow-w"></div>',
      '  <div class="ulb-canvas-arrow-h"></div>',

      // Inch labels
      '  <div class="ulb-canvas-label ulb-canvas-label-w" id="ulb-canvas-label-w">' + wLabel + '</div>',
      '  <div class="ulb-canvas-label ulb-canvas-label-h" id="ulb-canvas-label-h">' + hLabel + '</div>',

      // Remove button
      '  <button type="button" class="ulb-canvas-remove" data-action="remove-canvas" title="Remove design">×</button>',
      '</div>',

      // Reference squares
      buildRefSquaresHTML(item),
    ].join('\n')

    wrapper.innerHTML = html

    // Bind remove button
    var removeBtn = wrapper.querySelector('[data-action="remove-canvas"]')
    if (removeBtn) {
      removeBtn.addEventListener('click', function () {
        var modal = window.ULBuilderModal
        if (modal) {
          var idx = modal.getItems().indexOf(currentItem)
          if (idx >= 0) modal.removeItem(idx)
          activate(null)
        }
      })
    }

    // When image loads, set up the ants canvas
    var img = wrapper.querySelector('#ulb-canvas-img')
    if (img) {
      img.addEventListener('load', function () {
        setupAntsCanvas(img)
      })
      // If already cached
      if (img.complete && img.naturalWidth > 0) {
        setupAntsCanvas(img)
      }
    }
  }

  /* ─────────────────────────────────────────────
     Reference Squares HTML
     ───────────────────────────────────────────── */
  function buildRefSquaresHTML(item) {
    if (!item || !item.widthIn || !item.heightIn) return ''

    // Scale factor: how many pixels per inch on screen
    // We use a reasonable ratio based on the container
    var html = '<div class="ulb-ref-squares">'
    for (var i = 0; i < REF_SQUARES.length; i++) {
      var sq = REF_SQUARES[i]
      html += '<div class="ulb-ref-square">'
      html += '  <div class="ulb-ref-square-box" style="width:' + sq.px + 'px;height:' + sq.px + 'px;"></div>'
      html += '  <span>' + sq.label + '</span>'
      html += '</div>'
    }
    html += '</div>'
    return html
  }

  /* ─────────────────────────────────────────────
     Marching Ants Animation (Canvas overlay)
     ───────────────────────────────────────────── */
  function setupAntsCanvas(imgEl) {
    var container = document.querySelector('#ulb-canvas-img-container')
    var canvas = document.querySelector('#ulb-canvas-ants')
    if (!container || !canvas) return

    var rect = imgEl.getBoundingClientRect()
    var containerRect = container.getBoundingClientRect()

    // Position canvas over the image
    canvas.style.position = 'absolute'
    canvas.style.left = (rect.left - containerRect.left) + 'px'
    canvas.style.top = (rect.top - containerRect.top) + 'px'
    canvas.width = rect.width
    canvas.height = rect.height
    canvas.style.width = rect.width + 'px'
    canvas.style.height = rect.height + 'px'
    canvas.style.pointerEvents = 'none'
    canvas.style.zIndex = '2'
  }

  function drawAnts() {
    var canvas = document.querySelector('#ulb-canvas-ants')
    if (!canvas) return

    var ctx = canvas.getContext('2d')
    var w = canvas.width
    var h = canvas.height

    ctx.clearRect(0, 0, w, h)

    // Marching ants dashed rectangle
    ctx.strokeStyle = '#16a34a'
    ctx.lineWidth = 2
    ctx.setLineDash([6, 4])
    ctx.lineDashOffset = -antOffset
    ctx.strokeRect(1, 1, w - 2, h - 2)

    antOffset += 0.5
    if (antOffset > 20) antOffset = 0
  }

  function startAnimation() {
    stopAnimation()
    function loop() {
      drawAnts()
      animFrame = requestAnimationFrame(loop)
    }
    animFrame = requestAnimationFrame(loop)
  }

  function stopAnimation() {
    if (animFrame) {
      cancelAnimationFrame(animFrame)
      animFrame = null
    }
  }

  /* ─────────────────────────────────────────────
     Update Labels (called when dims change)
     ───────────────────────────────────────────── */
  function updateLabels(item) {
    if (!item) return
    var wLabel = document.querySelector('#ulb-canvas-label-w')
    var hLabel = document.querySelector('#ulb-canvas-label-h')
    if (wLabel) wLabel.textContent = (item.widthIn || 0).toFixed(1) + '"'
    if (hLabel) hLabel.textContent = (item.heightIn || 0).toFixed(1) + '"'
  }

  /* ─────────────────────────────────────────────
     Utility
     ───────────────────────────────────────────── */
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
  window.ULBuilderCanvas = {
    version: '1.0.0',
    activate: activate,
    updateLabels: updateLabels,
    stopAnimation: stopAnimation,
  }
})()
