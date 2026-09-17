;(function() {
  'use strict';

  var RETIREMENT_CODE = 'LEGACY_LAYOUT_RETIRED';
  var NOTICE_ID = 'ul-legacy-upload-retired-notice';

  function productIdOf(value) {
    return value == null ? '' : String(value);
  }

  function safeProductPath(value) {
    if (!value || typeof value !== 'string') return null;
    var candidate = value.trim();
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

  function findCanonicalRoot(productId) {
    if (!document || typeof document.querySelectorAll !== 'function') return null;
    var roots = document.querySelectorAll('[data-ul-main-product-upload-app]');
    for (var i = 0; i < roots.length; i++) {
      var rootId = productIdOf(roots[i].getAttribute && roots[i].getAttribute('data-product-id'));
      if (!productId || !rootId || rootId === productId) return roots[i];
    }
    return null;
  }

  function pageDataPath(productId) {
    if (!document || typeof document.querySelectorAll !== 'function') return null;
    var scripts = document.querySelectorAll('#dtf-listing-products, script[id^="ul-hero-slot-data-"]');
    for (var i = 0; i < scripts.length; i++) {
      try {
        var records = JSON.parse(scripts[i].textContent || '[]');
        if (!Array.isArray(records)) continue;
        for (var j = 0; j < records.length; j++) {
          var target = records[j] && records[j].target ? records[j].target : records[j];
          if (!target || (productId && productIdOf(target.id) !== productId)) continue;
          var path = safeProductPath(target.url || target.productUrl);
          if (path) return path;
          if (target.handle) return '/products/' + encodeURIComponent(String(target.handle));
        }
      } catch (_error) {
        // Invalid legacy page data must fail closed.
      }
    }
    return null;
  }

  function domPath(productId) {
    if (!document || typeof document.querySelectorAll !== 'function') return null;
    var nodes = document.querySelectorAll('[data-product-id]');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (productId && productIdOf(node.getAttribute && node.getAttribute('data-product-id')) !== productId) continue;
      var handle = node.getAttribute && node.getAttribute('data-product-handle');
      if (handle) return '/products/' + encodeURIComponent(String(handle));
      var path = safeProductPath(node.getAttribute && (node.getAttribute('data-product-url') || node.getAttribute('href')));
      if (path) return path;
    }
    return null;
  }

  function resolveProductPath(options) {
    options = options || {};
    var direct = safeProductPath(options.productUrl || options.url);
    if (direct) return direct;
    if (options.productHandle || options.handle) {
      return '/products/' + encodeURIComponent(String(options.productHandle || options.handle));
    }
    var productId = productIdOf(options.productId || options.id);
    return pageDataPath(productId) || domPath(productId);
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
      notice.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;max-width:560px;padding:16px 20px;border-radius:10px;background:#17202a;color:#fff;box-shadow:0 12px 36px rgba(0,0,0,.28);font:600 15px/1.4 system-ui,sans-serif';
      var parent = document.body || document.documentElement;
      if (parent && typeof parent.appendChild === 'function') parent.appendChild(notice);
    }
    notice.textContent = 'Automatic layout has moved. Open the product page to upload your finished gang sheet.';
    if (productUrl) {
      var link = document.createElement('a');
      link.href = productUrl;
      link.textContent = ' Open product page';
      link.style.cssText = 'color:#fff;text-decoration:underline;white-space:nowrap';
      notice.appendChild(link);
    }
    if (typeof notice.focus === 'function') notice.focus();
    return { status: RETIREMENT_CODE, productUrl: productUrl || null };
  }

  function localHandoff(options, openPicker) {
    options = options || {};
    var productId = productIdOf(options.productId || options.id);
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
    var productUrl = resolveProductPath(options);
    var currentPath = window.location && window.location.pathname ? window.location.pathname : '';
    if (productUrl && currentPath !== productUrl.split(/[?#]/)[0]) {
      if (window.location && typeof window.location.assign === 'function') window.location.assign(productUrl);
      else if (window.location) window.location.href = productUrl;
      return { status: 'REDIRECTED_TO_PRODUCT', productUrl: productUrl };
    }
    return showNotice(productUrl);
  }

  function handoff(options, openPicker) {
    var helper = window.ULLegacyUploadRetirement;
    if (helper && typeof helper.handoff === 'function') return helper.handoff(options || {}, openPicker);
    return localHandoff(options, openPicker);
  }

  if (!window.ULLegacyUploadRetirement) {
    window.ULLegacyUploadRetirement = {
      code: RETIREMENT_CODE,
      handoff: localHandoff,
      showNotice: showNotice,
    };
  }

  window.ULAutoSheet = {
    retired: true,
    RETIREMENT_CODE: RETIREMENT_CODE,
    isEnabled: function() { return false; },
    init: function() { return false; },
    openModal: function(options) {
      // Never invoke options.onSelect: copied snippets use it to create legacy cart lines.
      return handoff(options || {}, true);
    },
    closeModal: function() { return true; },
  };
})();
