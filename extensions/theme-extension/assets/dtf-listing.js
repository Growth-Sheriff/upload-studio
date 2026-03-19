/**
 * DTF Product Listing — Controller
 * ==================================
 * Handles "Upload Design" button clicks on the product listing grid.
 * Supports two upload modes per product:
 *   - dtf_by_size: Opens the DTF By Size modal (DtfUploadBlock)
 *   - dtf: Redirects to the product page (inline uploader)
 *
 * Version: 1.1.0
 */
;(function() {
  'use strict';

  function initListing() {
    var listingRoot = document.getElementById('dtf-listing-root');
    if (!listingRoot) return;

    var uploadBtns = listingRoot.querySelectorAll('.dtf-listing__upload-btn');
    if (!uploadBtns.length) return;

    for (var i = 0; i < uploadBtns.length; i++) {
      uploadBtns[i].addEventListener('click', handleUploadClick);
    }
  }

  function handleUploadClick(e) {
    e.preventDefault();
    var btn = e.currentTarget;
    var productId = btn.getAttribute('data-product-id');
    var productTitle = btn.getAttribute('data-product-title');
    var productHandle = btn.getAttribute('data-product-handle');
    var uploadMode = btn.getAttribute('data-upload-mode') || 'dtf_by_size';

    // Mode: dtf → redirect to product page
    if (uploadMode === 'dtf') {
      window.location.href = '/products/' + productHandle;
      return;
    }

    // Mode: dtf_by_size → open modal
    // Highlight active card
    var allCards = document.querySelectorAll('.dtf-listing__card');
    for (var c = 0; c < allCards.length; c++) {
      allCards[c].classList.remove('dtf-listing__card--active');
    }
    var card = btn.closest('.dtf-listing__card');
    if (card) card.classList.add('dtf-listing__card--active');

    // Update dtf-upload-root with selected product's data
    var root = document.getElementById('dtf-upload-root');
    if (!root) return;

    root.setAttribute('data-product-id', productId);
    root.setAttribute('data-product-title', productTitle || '');
    root.removeAttribute('data-initialized');

    // Destroy existing instance if any
    if (window.dtfBlock) {
      window.dtfBlock.files = [];
      window.dtfBlock.activeFileIndex = -1;
      window.dtfBlock.state = 'IDLE';
      window.dtfBlock = null;
    }

    // Re-init DtfUploadBlock with new product config
    var config = {
      productId: productId,
      productTitle: productTitle || '',
      shopDomain: root.getAttribute('data-shop-domain'),
      apiBase: root.getAttribute('data-api-base') || '/apps/customizer',
      maxWidth: parseFloat(root.getAttribute('data-max-width')) || 21.75,
      maxHeight: parseFloat(root.getAttribute('data-max-height')) || 35.75,
      minWidth: parseFloat(root.getAttribute('data-min-width')) || 1,
      minHeight: parseFloat(root.getAttribute('data-min-height')) || 1,
      maxFileMb: parseInt(root.getAttribute('data-max-file-mb'), 10) || 500,
      formats: root.getAttribute('data-formats'),
      tiers: root.getAttribute('data-tiers'),
      colorProfile: root.getAttribute('data-color-profile') || 'CMYK',
      currency: root.getAttribute('data-currency') || 'USD',
      enableFitcheck: root.getAttribute('data-enable-fitcheck') !== 'false'
    };

    if (typeof window.DtfUploadBlock !== 'undefined') {
      window.dtfBlock = new window.DtfUploadBlock(config);
      window.dtfBlock.fetchConfigFallback();
      // Open file picker immediately
      if (window.dtfBlock.fileInput) {
        window.dtfBlock.fileInput.click();
      }
    } else {
      console.error('[DTF Listing] DtfUploadBlock not found — dtf-upload.js not loaded');
    }
  }

  document.addEventListener('DOMContentLoaded', initListing);
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(initListing, 200);
  }
})();
