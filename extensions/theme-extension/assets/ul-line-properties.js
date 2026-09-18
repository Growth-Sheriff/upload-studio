(function() {
  'use strict';

  /**
   * Upload Studio — one source for cart line properties (and a minimal
   * uploader for the listing blocks).
   *
   * Every storefront block adds exactly three customer-visible properties:
   *   Print Ready     print-ready file URL
   *   Sheet Identity  https://<shop>/apps/customizer/i/<uploadId>
   *   DPI             measured DPI
   *
   * The server builds them (/api/cart/prepare) so the values are canonical.
   * Current purchase paths fail closed when that verification is unavailable;
   * `fallback` remains exported only for dormant legacy integrations.
   *
   *   const props = await window.ULLineProperties.build({ uploadId, fileUrl, dpi })
   *   const { uploadId, properties, cartInstruction } = await window.ULLineProperties.uploadAndBuild({ file, productId, variantId, line })
   */

  var API_BASE = '/apps/customizer';

  function shopDomain() {
    try {
      if (window.Shopify && window.Shopify.shop) return String(window.Shopify.shop);
    } catch (_) {}
    var meta = document.querySelector('[data-shop-domain]');
    return meta ? String(meta.getAttribute('data-shop-domain') || '') : '';
  }

  function identityUrl(uploadId) {
    var shop = shopDomain();
    return (shop ? 'https://' + shop : '') + API_BASE + '/i/' + uploadId;
  }

  function fallback(input) {
    var identity = identityUrl(input.uploadId);
    var dpi = Math.round(Number(input.dpi) || 0);
    return {
      'Print Ready': input.fileUrl || identity,
      'Sheet Identity': identity,
      'DPI': dpi > 0 ? String(dpi) : 'n/a'
    };
  }

  async function prepare(input) {
    input = input || {};
    if (!input.uploadId) return { properties: {}, cartInstruction: null };
    try {
      var response = await fetch(API_BASE + '/api/cart/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopDomain: shopDomain(),
          uploadIds: [input.uploadId],
          lines: input.line ? [Object.assign({ uploadId: input.uploadId }, input.line)] : []
        })
      });
      if (!response.ok) throw new Error('prepare failed: ' + response.status);
      var data = await response.json();
      var entry = data && Array.isArray(data.items) ? data.items[0] : null;
      if (entry && entry.found && entry.orderable === false) {
        var orderabilityError = new Error(entry.error || 'This design is still being checked. Please wait before adding it to cart.');
        orderabilityError.code = 'UPLOAD_NOT_ORDERABLE';
        throw orderabilityError;
      }
      if (entry && entry.found && entry.properties) {
        return {
          properties: entry.properties,
          cartInstruction: entry.cartInstruction || null
        };
      }
    } catch (error) {
      console.warn('[ULLineProperties] cart preparation failed:', error && error.message);
      if (error && error.code === 'UPLOAD_NOT_ORDERABLE') throw error;
      throw new Error('Upload status could not be verified. Please try again before adding to cart.');
    }
    throw new Error('Upload status could not be verified. Please try again before adding to cart.');
  }

  async function build(input) {
    var prepared = await prepare(input);
    return prepared.properties;
  }

  function customer() {
    var c = window.ULCustomer || {};
    return { id: c.id || null, email: c.email || null };
  }

  function putFile(intent, file) {
    return new Promise(function(resolve, reject) {
      var xhr = new XMLHttpRequest();
      var method = intent.uploadMethod || 'PUT';
      xhr.open(method, intent.uploadUrl, true);
      var headers = intent.uploadHeaders || {};
      Object.keys(headers).forEach(function(k) { if (k !== '__extraFields') xhr.setRequestHeader(k, headers[k]); });
      xhr.onload = function() { xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('Upload failed: HTTP ' + xhr.status)); };
      xhr.onerror = function() { reject(new Error('Network error during upload')); };
      if (method === 'POST') {
        var form = new FormData();
        form.append('key', intent.key || '');
        form.append('uploadId', intent.uploadId || '');
        form.append('itemId', intent.itemId || '');
        form.append('file', file);
        xhr.send(form);
      } else {
        xhr.send(file);
      }
    });
  }

  function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

  /** Upload a file through the app (intent → PUT → complete → measured) and
   *  return the canonical three line properties. Used by the listing blocks,
   *  which previously added fake ids to the cart without uploading. */
  async function uploadAndBuild(input) {
    var file = input.file;
    if (!file) throw new Error('Choose a file first.');
    var who = customer();
    var shop = shopDomain();
    var probePromise = window.ULFileProbe && window.ULFileProbe.probe
      ? window.ULFileProbe.probe(file).catch(function() { return null; })
      : Promise.resolve(null);
    var previewPromise = probePromise.then(function(probe) {
      if (!window.ULFileProbe || !window.ULFileProbe.createPreview) return null;
      return window.ULFileProbe.createPreview(file, probe).catch(function() { return null; });
    });
    var intentRes = await fetch(API_BASE + '/api/upload/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shopDomain: shop,
        productId: input.productId ? String(input.productId) : null,
        variantId: input.variantId ? String(input.variantId) : null,
        measurementPolicy: 'finished_sheet',
        mode: 'dtf',
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        fileSize: file.size,
        customerId: who.id,
        customerEmail: who.email
      })
    });
    var intent = await intentRes.json().catch(function() { return {}; });
    if (!intentRes.ok) throw new Error(intent.error || 'Could not start the upload.');

    var complete = null;
    if (!intent.deduplicated) {
      var previewUploadPromise = previewPromise.then(function(preview) {
        if (!preview || !window.ULFileProbe || !window.ULFileProbe.uploadPreview) return null;
        return window.ULFileProbe.uploadPreview(API_BASE, intent.uploadId, intent.itemId, preview)
          .finally(function() {
            if (preview.objectUrl) {
              try { URL.revokeObjectURL(preview.objectUrl); } catch (_) {}
            }
          });
      }).catch(function() { return null; });
      await putFile(intent, file);
      // A thumbnail must never delay authoritative header validation.
      void previewUploadPromise;
      var headerProbe = await probePromise;
      var completeRes = await fetch(API_BASE + '/api/upload/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopDomain: shop,
          uploadId: intent.uploadId,
          items: [{ itemId: intent.itemId, location: 'front', fileUrl: intent.publicUrl || null, storageProvider: intent.storageProvider || 'local', fileSize: file.size, headerProbe: headerProbe }]
        })
      });
      complete = await completeRes.json().catch(function() { return {}; });
      if (!completeRes.ok) {
        throw new Error(complete.error || 'Could not finish the upload.');
      }
    }

    // Wait up to eight minutes for authoritative measurement. Never turn a
    // pending upload into a cart line with provisional DPI or file facts.
    var fileUrl = intent.publicUrl || '';
    var dpi = 0;
    var measurementReady = false;
    var completedItem = complete && (complete.item || (complete.items && complete.items[0]));
    if (complete && complete.fastPath && completedItem) {
      if (completedItem.orderabilityStatus === 'blocked' || completedItem.measurementStatus === 'error') {
        throw new Error((completedItem.errors && completedItem.errors[0]) || 'This file cannot be printed. Please upload a different file.');
      }
      fileUrl = completedItem.originalUrl || fileUrl;
      dpi = Number(completedItem.effectiveDpi || completedItem.documentDpi || 0);
      measurementReady = true;
    }
    for (var attempt = 0; !measurementReady && attempt < 240; attempt += 1) {
      var st = await fetch(API_BASE + '/api/upload/status/' + encodeURIComponent(intent.uploadId) + '?shopDomain=' + encodeURIComponent(shop))
        .then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; });
      var item = st && st.items && st.items[0];
      if (item) {
        fileUrl = item.originalUrl || fileUrl;
        dpi = Number(item.effectiveDpi || item.documentDpi || item.dpi || 0);
        if (st.orderabilityStatus === 'blocked' || item.orderabilityStatus === 'blocked') {
          throw new Error((item.errors && item.errors[0]) || 'This file cannot be printed. Please upload a different file.');
        }
        if ((item.measurementStatus || 'pending') !== 'pending') {
          measurementReady = true;
          break;
        }
      }
      await sleep(2000);
    }

    if (!measurementReady) {
      throw new Error('This design is still being measured. Please try adding it to cart again in a moment.');
    }

    var prepared = await prepare({
      uploadId: intent.uploadId,
      fileUrl: fileUrl,
      dpi: dpi,
      line: input.line || null
    });
    return {
      uploadId: intent.uploadId,
      properties: prepared.properties,
      cartInstruction: prepared.cartInstruction,
      fileUrl: fileUrl,
      dpi: dpi
    };
  }

  window.ULLineProperties = { prepare: prepare, build: build, fallback: fallback, identityUrl: identityUrl, uploadAndBuild: uploadAndBuild };
})();
