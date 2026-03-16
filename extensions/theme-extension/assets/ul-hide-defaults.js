/* ul-hide-defaults.js - Dynamic Shopify default element hiding */
(function() {
  'use strict';
  var S = [
    'button[name="add"]',
    'button[type="submit"][form*="product"]',
    '.product-form button[type="submit"]',
    'form[action="/cart/add"] button',
    'form[action*="/cart/add"] button[type="submit"]',
    '.shopify-payment-button',
    'shopify-payment-button',
    'shopify-accelerated-checkout',
    '[data-shopify="payment-button"]',
    'variant-selects',
    'variant-radios',
    'variant-picker',
    '.variant-wrapper',
    '.product-form__input',
    '.selector-wrapper',
    'quantity-input',
    '.product-form__quantity'
  ];
  function h(el) {
    if (el && !el.dataset.ulHidden) {
      el.style.cssText = 'display:none!important;visibility:hidden!important;height:0!important;overflow:hidden!important;position:absolute!important;left:-9999px!important;';
      el.dataset.ulHidden = 'true';
    }
  }
  function run() {
    S.forEach(function(s) { try { document.querySelectorAll(s).forEach(h); } catch(e) {} });
    document.querySelectorAll('button, input[type="submit"]').forEach(function(btn) {
      var t = (btn.textContent || btn.value || '').toLowerCase();
      if (t.includes('add to cart') || t.includes('add to bag') || t.includes('buy now') || t.includes('buy it now') || t.includes('sepete ekle') || t.includes('satın al')) {
        if (!btn.closest('.ul-dtf-uploader') && !btn.closest('#ul-tshirt-modal')) h(btn);
      }
    });
    document.querySelectorAll('iframe[src*="shopify"]').forEach(function(f) {
      if (f.src.includes('payment') || f.src.includes('checkout')) h(f.parentElement);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
  window.addEventListener('load', function() {
    setTimeout(run, 100); setTimeout(run, 500); setTimeout(run, 1000);
  });
  var obs = new MutationObserver(function(m) {
    var add = false;
    m.forEach(function(mu) { if (mu.addedNodes.length) add = true; });
    if (add) { clearTimeout(window._ulHideTimeout); window._ulHideTimeout = setTimeout(run, 50); }
  });
  function startObs() { obs.observe(document.body, { childList: true, subtree: true }); }
  if (document.body) startObs();
  else document.addEventListener('DOMContentLoaded', startObs);
  window.ULHideShopifyDefaults = { hide: run, selectors: S };
})();
