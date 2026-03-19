/**
 * Upload Studio - Builder Upload v1.1.0
 * =======================================
 * Handles file upload via the existing signed-URL flow:
 *   POST /api/upload/intent  → get signed URL
 *   XHR PUT to signed URL    → direct storage upload
 *   POST /api/upload/complete → finalize
 *   GET  /api/upload/status   → poll for thumbnail + preflight
 *
 * v1.1.0 Changes:
 *   - Poll waits for preflightStatus (not just upload status)
 *   - Client-side dimension reading for browser-supported formats
 *   - Better thumbnailUrl extraction from response
 *
 * Namespace: window.ULBuilderUpload
 *
 * Dependencies: none (standalone, uses fetch + XHR)
 */

;(function () {
  'use strict'

  if (window.ULBuilderUpload) return

  var POLL_INTERVAL = 1500
  var MAX_POLLS = 80 // 2 minutes max

  // Browser-supported image types for client-side dimension reading
  var BROWSER_IMAGE_TYPES = [
    'image/png', 'image/jpeg', 'image/jpg', 'image/webp',
    'image/gif', 'image/bmp', 'image/svg+xml',
  ]

  /* ─────────────────────────────────────────────
     Client-side dimension reading
     For browser-supported formats, read w/h immediately
     ───────────────────────────────────────────── */
  function readClientDimensions(file, callback) {
    // Only works for browser-supported image types
    var type = (file.type || '').toLowerCase()
    var ext = (file.name || '').split('.').pop().toLowerCase()

    var isBrowserImage = BROWSER_IMAGE_TYPES.indexOf(type) >= 0 ||
      ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'].indexOf(ext) >= 0

    if (!isBrowserImage) {
      callback(null)
      return
    }

    try {
      var url = URL.createObjectURL(file)
      var img = new Image()
      img.onload = function () {
        var result = {
          widthPx: img.naturalWidth,
          heightPx: img.naturalHeight,
          dpi: 72, // Browser default — server will provide actual DPI
        }
        URL.revokeObjectURL(url)
        callback(result)
      }
      img.onerror = function () {
        URL.revokeObjectURL(url)
        callback(null)
      }
      img.src = url
    } catch (e) {
      callback(null)
    }
  }

  /* ─────────────────────────────────────────────
     Upload Entry Point
     ───────────────────────────────────────────── */

  /**
   * Upload a file through the signed-URL pipeline.
   *
   * @param {File} file - The File object to upload
   * @param {Object} opts
   * @param {string} opts.apiBase - e.g. "https://tenant.customizerapp.dev"
   * @param {string} opts.shopDomain - e.g. "my-store.myshopify.com"
   * @param {string} opts.productId - Shopify product ID
   * @param {string} opts.itemId - internal item ID (for tracking)
   * @param {function} opts.onProgress - (percentFloat, speedText) => void
   * @param {function} opts.onDimensions - (dims) => void  [NEW: early dimensions]
   * @param {function} opts.onComplete - (result) => void
   * @param {function} opts.onError - (errorMessage) => void
   */
  function upload(file, opts) {
    var apiBase = opts.apiBase
    var shopDomain = opts.shopDomain
    var productId = opts.productId

    // Start client-side dimension reading in parallel
    readClientDimensions(file, function (dims) {
      if (dims && opts.onDimensions) {
        opts.onDimensions(dims)
      }
    })

    // Step 1: Intent
    fetch(apiBase + '/api/upload/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shopDomain: shopDomain,
        productId: productId,
        mode: 'builder',
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        fileSize: file.size,
        visitorId: getVisitorId(),
        sessionId: getSessionId(),
      }),
    })
      .then(function (r) {
        if (!r.ok) {
          return r.json().catch(function () { return {} }).then(function (data) {
            throw new Error(data.error || 'Upload intent failed: ' + r.status)
          })
        }
        return r.json()
      })
      .then(function (intentData) {
        // Step 2: Upload to storage
        uploadToStorage(file, intentData, opts)
      })
      .catch(function (err) {
        if (opts.onError) opts.onError(err.message || 'Upload failed')
      })
  }

  /* ─────────────────────────────────────────────
     Upload to Storage (Provider-aware)
     ───────────────────────────────────────────── */
  function uploadToStorage(file, intentData, opts) {
    uploadXHR(file, intentData, opts, function onDone(uploadResult) {
      completeUpload(intentData, uploadResult, file, opts)
    })
  }

  /* ─────────────────────────────────────────────
     XHR Upload (Direct PUT to signed URL)
     ───────────────────────────────────────────── */
  function uploadXHR(file, intentData, opts, onDone) {
    var startTime = Date.now()
    var xhr = new XMLHttpRequest()

    xhr.upload.addEventListener('progress', function (e) {
      if (e.lengthComputable && opts.onProgress) {
        var pct = (e.loaded / e.total) * 100
        var elapsed = (Date.now() - startTime) / 1000
        var speed = elapsed > 0 ? e.loaded / elapsed : 0
        var speedText = (speed / (1024 * 1024)).toFixed(1) + ' MB/s'
        opts.onProgress(pct, speedText)
      }
    })

    xhr.addEventListener('load', function () {
      if (xhr.status >= 200 && xhr.status < 300) {
        onDone({
          fileUrl: intentData.publicUrl || null,
          storageProvider: intentData.storageProvider || 'local',
        })
      } else {
        // Try fallback if primary fails
        console.warn('[ULBuilderUpload] Primary upload failed (' + xhr.status + '), checking fallback')
        if (intentData.fallbackUrl) {
          uploadXHRFallback(file, intentData, opts, onDone)
        } else {
          if (opts.onError) opts.onError('Upload failed: HTTP ' + xhr.status)
        }
      }
    })

    xhr.addEventListener('error', function () {
      if (intentData.fallbackUrl) {
        console.warn('[ULBuilderUpload] Network error on primary, trying fallback')
        uploadXHRFallback(file, intentData, opts, onDone)
      } else {
        if (opts.onError) opts.onError('Network error during upload')
      }
    })

    xhr.addEventListener('abort', function () {
      if (opts.onError) opts.onError('Upload cancelled')
    })

    xhr.open('PUT', intentData.uploadUrl)

    // Set upload headers from intent response
    if (intentData.uploadHeaders) {
      var headers = intentData.uploadHeaders
      var keys = Object.keys(headers)
      for (var i = 0; i < keys.length; i++) {
        xhr.setRequestHeader(keys[i], headers[keys[i]])
      }
    }
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')

    xhr.send(file)
  }

  /* ─────────────────────────────────────────────
     Fallback Upload
     ───────────────────────────────────────────── */
  function uploadXHRFallback(file, intentData, opts, onDone) {
    var xhr = new XMLHttpRequest()
    var startTime = Date.now()

    xhr.upload.addEventListener('progress', function (e) {
      if (e.lengthComputable && opts.onProgress) {
        var pct = (e.loaded / e.total) * 100
        var elapsed = (Date.now() - startTime) / 1000
        var speed = elapsed > 0 ? e.loaded / elapsed : 0
        var speedText = (speed / (1024 * 1024)).toFixed(1) + ' MB/s'
        opts.onProgress(pct, speedText)
      }
    })

    xhr.addEventListener('load', function () {
      if (xhr.status >= 200 && xhr.status < 300) {
        onDone({
          fileUrl: intentData.fallbackPublicUrl || intentData.publicUrl || null,
          storageProvider: intentData.fallbackProvider || 'local',
        })
      } else {
        if (opts.onError) opts.onError('Fallback upload failed: HTTP ' + xhr.status)
      }
    })

    xhr.addEventListener('error', function () {
      if (opts.onError) opts.onError('Network error on fallback upload')
    })

    xhr.open('PUT', intentData.fallbackUrl)
    if (intentData.fallbackHeaders) {
      var headers = intentData.fallbackHeaders
      var keys = Object.keys(headers)
      for (var i = 0; i < keys.length; i++) {
        xhr.setRequestHeader(keys[i], headers[keys[i]])
      }
    }
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    xhr.send(file)
  }

  /* ─────────────────────────────────────────────
     Complete Upload + Poll
     ───────────────────────────────────────────── */
  function completeUpload(intentData, uploadResult, file, opts) {
    var apiBase = opts.apiBase
    var shopDomain = opts.shopDomain
    var uploadDurationMs = Date.now() - (opts._startTime || Date.now())

    fetch(apiBase + '/api/upload/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shopDomain: shopDomain,
        uploadId: intentData.uploadId,
        items: [
          {
            itemId: intentData.itemId,
            location: 'front',
            fileUrl: uploadResult.fileUrl,
            storageProvider: uploadResult.storageProvider,
            uploadDurationMs: uploadDurationMs,
          },
        ],
      }),
    })
      .then(function (r) {
        if (!r.ok) throw new Error('Complete failed: ' + r.status)
        return r.json()
      })
      .then(function () {
        // Start polling for thumbnail / dimensions / preflight
        pollStatus(apiBase, shopDomain, intentData.uploadId, opts, 0)
      })
      .catch(function (err) {
        if (opts.onError) opts.onError(err.message || 'Finalize failed')
      })
  }

  /* ─────────────────────────────────────────────
     Poll Upload Status
     v1.1.0: Now waits for preflightStatus to complete
     ───────────────────────────────────────────── */
  function pollStatus(apiBase, shopDomain, uploadId, opts, count) {
    if (count >= MAX_POLLS) {
      // Timeout but still return what we have
      console.warn('[ULBuilderUpload] Polling timeout after ' + count + ' attempts')
      if (opts.onComplete) {
        opts.onComplete({
          uploadId: uploadId,
          thumbnailUrl: '',
          originalUrl: '',
          widthPx: 0,
          heightPx: 0,
          dpi: 300,
          widthIn: 0,
          heightIn: 0,
          preflightTimedOut: true,
        })
      }
      return
    }

    var url =
      apiBase +
      '/api/upload/status/' +
      encodeURIComponent(uploadId) +
      '?shopDomain=' +
      encodeURIComponent(shopDomain)

    fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error('Status poll failed')
        return r.json()
      })
      .then(function (data) {
        // v1.1.0: Check BOTH upload status AND preflight status
        var uploadDone = data.status === 'ready' || data.status === 'approved' ||
          data.status === 'uploaded' || data.status === 'needs_review' ||
          data.status === 'pending_approval' || data.status === 'blocked'

        var item = (data.items && data.items[0]) || {}

        // Preflight is done when status is not 'pending'
        var preflightDone = item.preflightStatus === 'ok' ||
          item.preflightStatus === 'warning' ||
          item.preflightStatus === 'error'

        if (data.status === 'error' || data.status === 'rejected') {
          // Fatal error
          if (opts.onError) opts.onError(data.error || 'Processing failed')
          return
        }

        if (uploadDone && preflightDone) {
          // Both upload and preflight are done — extract all data
          var dpi = item.dpi || 300
          var widthPx = item.widthPx || item.width || 0
          var heightPx = item.heightPx || item.height || 0
          var widthIn = widthPx > 0 ? widthPx / dpi : 0
          var heightIn = heightPx > 0 ? heightPx / dpi : 0

          // v1.1.0: Better thumbnailUrl extraction
          // Try item-level first, then top-level
          var thumbnailUrl = item.thumbnailUrl || data.thumbnailUrl || ''
          var originalUrl = item.originalUrl || item.fileUrl || data.downloadUrl || data.fileUrl || ''

          if (opts.onComplete) {
            opts.onComplete({
              uploadId: uploadId,
              thumbnailUrl: thumbnailUrl,
              originalUrl: originalUrl,
              fileUrl: originalUrl,
              widthPx: widthPx,
              heightPx: heightPx,
              dpi: dpi,
              widthIn: parseFloat(widthIn.toFixed(2)),
              heightIn: parseFloat(heightIn.toFixed(2)),
              preflightStatus: item.preflightStatus,
              preflightResult: item.preflightResult,
            })
          }
        } else {
          // Still processing — poll again
          setTimeout(function () {
            pollStatus(apiBase, shopDomain, uploadId, opts, count + 1)
          }, POLL_INTERVAL)
        }
      })
      .catch(function () {
        // Network error, retry
        setTimeout(function () {
          pollStatus(apiBase, shopDomain, uploadId, opts, count + 1)
        }, POLL_INTERVAL)
      })
  }

  /* ─────────────────────────────────────────────
     Helpers
     ───────────────────────────────────────────── */
  function getVisitorId() {
    if (window.ULVisitor && window.ULVisitor.getVisitorId) {
      return window.ULVisitor.getVisitorId()
    }
    return null
  }

  function getSessionId() {
    if (window.ULVisitor && window.ULVisitor.getSessionId) {
      return window.ULVisitor.getSessionId()
    }
    return null
  }

  /* ─────────────────────────────────────────────
     Public API
     ───────────────────────────────────────────── */
  window.ULBuilderUpload = {
    version: '1.1.0',
    upload: upload,
    readClientDimensions: readClientDimensions,
  }
})()
