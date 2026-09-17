;(function() {
  'use strict';

  var RETIREMENT_CODE = 'LEGACY_LAYOUT_RETIRED';
  var NOTICE_ID = 'ul-legacy-upload-retired-notice';

  function productIdOf(value) {
    return value == null ? '' : String(value);
  }

  function productPath(value) {
    if (!value || typeof value !== 'string') return null;
    var candidate = value.trim();
    if (!candidate) return null;
    if (candidate.indexOf('/products/') === 0) return candidate;

    try {
      var parsed = new URL(candidate, window.location && window.location.href ? window.location.href : undefined);
      if (parsed.pathname.indexOf('/products/') !== 0) return null;
      if (window.location && window.location.origin && parsed.origin !== window.location.origin) return null;
      return parsed.pathname + parsed.search + parsed.hash;
    } catch (_error) {
      return null;
    }
  }

  function productPathFromRecord(record, productId) {
    if (!record || typeof record !== 'object') return null;
    var target = record.target && typeof record.target === 'object' ? record.target : record;
    if (productId && productIdOf(target.id) !== productId) return null;
    return productPath(target.url || target.productUrl) ||
      (target.handle ? '/products/' + encodeURIComponent(String(target.handle)) : null);
  }

  function productPathFromPageData(productId) {
    if (!document || typeof document.querySelectorAll !== 'function') return null;
    var scripts = document.querySelectorAll('#dtf-listing-products, script[id^="ul-hero-slot-data-"]');
    for (var i = 0; i < scripts.length; i++) {
      try {
        var records = JSON.parse(scripts[i].textContent || '[]');
        if (!Array.isArray(records)) continue;
        for (var j = 0; j < records.length; j++) {
          var found = productPathFromRecord(records[j], productId);
          if (found) return found;
        }
      } catch (_error) {
        // Invalid legacy page data must fail closed.
      }
    }
    return null;
  }

  function findCanonicalRoot(productId) {
    if (!document || typeof document.querySelectorAll !== 'function') return null;
    var roots = document.querySelectorAll('[data-ul-main-product-upload-app]');
    for (var i = 0; i < roots.length; i++) {
      var rootId = productIdOf(roots[i].getAttribute && roots[i].getAttribute('data-product-id'));
      if (!productId || !rootId || rootId === productId) return roots[i];
    }
    return null;
  }

  function productPathFromDom(productId) {
    if (!document || typeof document.querySelectorAll !== 'function') return null;
    var nodes = document.querySelectorAll('[data-product-id]');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (productId && productIdOf(node.getAttribute && node.getAttribute('data-product-id')) !== productId) continue;
      var direct = productPath(
        (node.getAttribute && (node.getAttribute('data-product-url') || node.getAttribute('href'))) || ''
      );
      if (direct) return direct;
      var handle = node.getAttribute && node.getAttribute('data-product-handle');
      if (handle) return '/products/' + encodeURIComponent(String(handle));
      var link = null;
      if (typeof node.closest === 'function') link = node.closest('a[href*="/products/"]');
      if (!link && typeof node.querySelector === 'function') link = node.querySelector('a[href*="/products/"]');
      var linkedPath = productPath(link && link.getAttribute ? link.getAttribute('href') : '');
      if (linkedPath) return linkedPath;
    }
    return null;
  }

  function resolveProductPath(config) {
    config = config || {};
    var productId = productIdOf(config.productId || config.id);
    var direct = productPath(config.productUrl || config.url);
    if (direct) return direct;
    if (config.productHandle || config.handle) {
      return '/products/' + encodeURIComponent(String(config.productHandle || config.handle));
    }
    return productPathFromPageData(productId) || productPathFromDom(productId);
  }

  function showNotice(productUrl) {
    if (!document || typeof document.createElement !== 'function') {
      return { status: RETIREMENT_CODE, productUrl: productUrl || null };
    }
    var notice = typeof document.getElementById === 'function' ? document.getElementById(NOTICE_ID) : null;
    if (!notice) {
      notice = document.createElement('div');
      notice.id = NOTICE_ID;
      notice.setAttribute('role', 'status');
      notice.setAttribute('aria-live', 'polite');
      notice.setAttribute('tabindex', '-1');
      notice.style.cssText = [
        'position:fixed',
        'left:50%',
        'bottom:24px',
        'transform:translateX(-50%)',
        'z-index:2147483647',
        'max-width:560px',
        'padding:16px 20px',
        'border-radius:10px',
        'background:#17202a',
        'color:#fff',
        'box-shadow:0 12px 36px rgba(0,0,0,.28)',
        'font:600 15px/1.4 system-ui,sans-serif'
      ].join(';');
      var parent = document.body || document.documentElement;
      if (parent && typeof parent.appendChild === 'function') parent.appendChild(notice);
    }
    notice.textContent = 'This uploader has moved. Open the product page to upload your finished gang sheet.';
    if (productUrl) {
      var spacer = document.createTextNode ? document.createTextNode(' ') : null;
      var link = document.createElement('a');
      link.href = productUrl;
      link.textContent = 'Open product page';
      link.style.cssText = 'color:#fff;text-decoration:underline;white-space:nowrap';
      if (spacer) notice.appendChild(spacer);
      notice.appendChild(link);
    }
    if (typeof notice.focus === 'function') notice.focus();
    return { status: RETIREMENT_CODE, productUrl: productUrl || null };
  }

  function handoff(config, openPicker) {
    config = config || {};
    var productId = productIdOf(config.productId || config.id);
    var root = findCanonicalRoot(productId);
    if (root) {
      if (typeof root.scrollIntoView === 'function') root.scrollIntoView({ behavior: 'smooth', block: 'center' });
      var trigger = typeof root.querySelector === 'function'
        ? root.querySelector('[data-ump-upload-trigger]') || root.querySelector('[data-ump-input]')
        : null;
      if (trigger && typeof trigger.focus === 'function') trigger.focus();
      if (openPicker && trigger && typeof trigger.click === 'function') trigger.click();
      return { status: 'CANONICAL_UPLOADER', productUrl: null };
    }

    var productUrl = resolveProductPath(config);
    var currentPath = window.location && window.location.pathname ? window.location.pathname : '';
    if (productUrl && currentPath !== productUrl.split(/[?#]/)[0]) {
      if (window.location && typeof window.location.assign === 'function') window.location.assign(productUrl);
      else if (window.location) window.location.href = productUrl;
      return { status: 'REDIRECTED_TO_PRODUCT', productUrl: productUrl };
    }
    return showNotice(productUrl);
  }

  function createSafeTrigger(block) {
    if (document && typeof document.createElement === 'function') {
      var trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.hidden = true;
      trigger.setAttribute('aria-hidden', 'true');
      trigger.addEventListener('click', function() { handoff(block.config, true); });
      return trigger;
    }
    return { click: function() { return handoff(block.config, true); } };
  }

  function DtfUploadBlock(config) {
    this.config = config || {};
    this.files = [];
    this.activeFileIndex = -1;
    this.state = 'RETIRED';
    this.retired = true;
    this.fileInput = createSafeTrigger(this);
  }

  DtfUploadBlock.prototype.fetchConfigFallback = function() {
    return Promise.resolve(this.config);
  };
  DtfUploadBlock.prototype.applyBuilderConfig = function(config) {
    if (config && typeof config === 'object') {
      for (var key in config) {
        if (Object.prototype.hasOwnProperty.call(config, key)) this.config[key] = config[key];
      }
    }
    return this.config;
  };
  DtfUploadBlock.prototype.openModal = function() { return handoff(this.config, true); };
  DtfUploadBlock.prototype.addToCart = function() { return handoff(this.config, false); };
  DtfUploadBlock.prototype.renderState = function() { return showNotice(resolveProductPath(this.config)); };

  function init() {
    if (!document || typeof document.getElementById !== 'function') return;
    var root = document.getElementById('dtf-upload-root');
    if (!root || (root.dataset && root.dataset.initialized)) return;
    if (root.dataset) root.dataset.initialized = 'true';
    window.dtfBlock = new DtfUploadBlock({
      productId: root.dataset ? root.dataset.productId : '',
      productTitle: root.dataset ? root.dataset.productTitle : '',
      productHandle: root.dataset ? root.dataset.productHandle : ''
    });
  }

  window.ULLegacyUploadRetirement = {
    code: RETIREMENT_CODE,
    handoff: handoff,
    showNotice: showNotice,
  };
  window.DtfUploadBlockInitialized = true;
  window.DtfUploadBlockRetired = true;
  window.DtfUploadBlock = DtfUploadBlock;

  if (document && typeof document.addEventListener === 'function') document.addEventListener('DOMContentLoaded', init);
  if (document && (document.readyState === 'complete' || document.readyState === 'interactive')) setTimeout(init, 0);
})();
