/**
 * Upload Studio - Builder Upload v1.0.0
 * =======================================
 * Handles file upload via the existing signed-URL flow:
 *   POST /api/upload/intent  → get signed URL
 *   XHR PUT to signed URL    → direct storage upload
 *   POST /api/upload/complete → finalize
 *   GET  /api/upload/status   → poll for thumbnail
 *
 * Reuses the same backend endpoints as dtf-uploader.js
 * but with a simpler, callback-based interface for the builder.
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
   * @param {function} opts.onComplete - (result) => void
   * @param {function} opts.onError - (errorMessage) => void
   */
  function upload(file, opts) {
    var apiBase = opts.apiBase
    var shopDomain = opts.shopDomain
    var productId = opts.productId

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
    var provider = intentData.storageProvider || 'local'

    if (provider === 'bunny') {
      uploadXHR(file, intentData, opts, function onDone(uploadResult) {
        completeUpload(intentData, uploadResult, file, opts)
      })
    } else if (provider === 'r2' || provider === 'local') {
      // R2 and local also use PUT to signed URL
      uploadXHR(file, intentData, opts, function onDone(uploadResult) {
        completeUpload(intentData, uploadResult, file, opts)
      })
    } else {
      // Unknown provider - try XHR anyway
      uploadXHR(file, intentData, opts, function onDone(uploadResult) {
        completeUpload(intentData, uploadResult, file, opts)
      })
    }
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
        // Start polling for thumbnail / dimensions
        pollStatus(apiBase, shopDomain, intentData.uploadId, opts, 0)
      })
      .catch(function (err) {
        if (opts.onError) opts.onError(err.message || 'Finalize failed')
      })
  }

  /* ─────────────────────────────────────────────
     Poll Upload Status
     ───────────────────────────────────────────── */
  function pollStatus(apiBase, shopDomain, uploadId, opts, count) {
    if (count >= MAX_POLLS) {
      // Timeout but still return what we have
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
        if (data.status === 'ready' || data.status === 'approved' || data.status === 'uploaded') {
          var item = (data.items && data.items[0]) || {}
          var dpi = item.dpi || 300
          var widthPx = item.widthPx || item.width || 0
          var heightPx = item.heightPx || item.height || 0
          var widthIn = widthPx > 0 ? widthPx / dpi : 0
          var heightIn = heightPx > 0 ? heightPx / dpi : 0

          if (opts.onComplete) {
            opts.onComplete({
              uploadId: uploadId,
              thumbnailUrl: item.thumbnailUrl || data.thumbnailUrl || '',
              originalUrl: item.originalUrl || item.fileUrl || data.fileUrl || '',
              fileUrl: item.fileUrl || data.fileUrl || '',
              widthPx: widthPx,
              heightPx: heightPx,
              dpi: dpi,
              widthIn: parseFloat(widthIn.toFixed(2)),
              heightIn: parseFloat(heightIn.toFixed(2)),
            })
          }
        } else if (data.status === 'error' || data.status === 'rejected') {
          if (opts.onError) opts.onError(data.error || 'Processing failed')
        } else {
          // Still processing, poll again
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
    version: '1.0.0',
    upload: upload,
  }
})()
