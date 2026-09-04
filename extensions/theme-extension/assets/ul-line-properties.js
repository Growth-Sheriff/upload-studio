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
   * The server builds them (/api/cart/prepare) so the values are canonical;
   * when the app API is unreachable the same three keys are built locally.
   *
   *   const props = await window.ULLineProperties.build({ uploadId, fileUrl, dpi })
   *   const { uploadId, properties } = await window.ULLineProperties.uploadAndBuild({ file, productId, variantId })
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

  async function build(input) {
    input = input || {};
    if (!input.uploadId) return {};
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
      if (entry && entry.found && entry.properties) return entry.properties;
    } catch (error) {
      console.warn('[ULLineProperties] using local fallback:', error && error.message);
    }
    return fallback(input);
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
    var intentRes = await fetch(API_BASE + '/api/upload/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shopDomain: shop,
        productId: input.productId ? String(input.productId) : null,
        variantId: input.variantId ? String(input.variantId) : null,
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

    if (!intent.deduplicated) {
      await putFile(intent, file);
      var completeRes = await fetch(API_BASE + '/api/upload/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopDomain: shop,
          uploadId: intent.uploadId,
          items: [{ itemId: intent.itemId, location: 'front', fileUrl: intent.publicUrl || null, storageProvider: intent.storageProvider || 'local', fileSize: file.size }]
        })
      });
      if (!completeRes.ok) {
        var c = await completeRes.json().catch(function() { return {}; });
        throw new Error(c.error || 'Could not finish the upload.');
      }
    }

    // Wait (up to ~45 s) for the measurement so DPI and the print-ready URL are real.
    var fileUrl = intent.publicUrl || '';
    var dpi = 0;
    for (var attempt = 0; attempt < 30; attempt += 1) {
      var st = await fetch(API_BASE + '/api/upload/status/' + encodeURIComponent(intent.uploadId) + '?shopDomain=' + encodeURIComponent(shop))
        .then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; });
      var item = st && st.items && st.items[0];
      if (item) {
        fileUrl = item.originalUrl || fileUrl;
        dpi = Number(item.effectiveDpi || item.documentDpi || item.dpi || 0);
        if (st.orderabilityStatus === 'blocked' || item.orderabilityStatus === 'blocked') {
          throw new Error((item.errors && item.errors[0]) || 'This file cannot be printed. Please upload a different file.');
        }
        if ((item.measurementStatus || 'pending') !== 'pending') break;
      }
      await sleep(1500);
    }

    var properties = await build({ uploadId: intent.uploadId, fileUrl: fileUrl, dpi: dpi });
    return { uploadId: intent.uploadId, properties: properties, fileUrl: fileUrl, dpi: dpi };
  }

  window.ULLineProperties = { build: build, fallback: fallback, identityUrl: identityUrl, uploadAndBuild: uploadAndBuild };
})();
