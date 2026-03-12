/**
 * Upload Studio - Cart Upload Display (v2 - Fixed)
 * Shows uploaded design info under cart line items
 * 
 * KEY FIX: Uses .cart-line-item with data-key attribute for matching
 */
(function() {
  'use strict';

  const CONFIG = {
    propertyKey: '_ul_upload_id',
    designFileKey: '_ul_design_file',
    pollInterval: 500,
    maxRetries: 20,
    apiBase: '/apps/customizer',
    debug: true
  };

  function log(...args) {
    if (CONFIG.debug) {
      console.log('[Upload Studio Cart]', ...args);
    }
  }

  const STYLES = `
    .ul-cart-upload-info {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 8px;
      padding: 10px 12px;
      background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
      border: 1px solid #bae6fd;
      border-radius: 8px;
      font-size: 13px;
    }
    .ul-cart-upload-info.processing {
      background: linear-gradient(135deg, #fefce8 0%, #fef9c3 100%);
      border-color: #fde047;
    }
    .ul-cart-upload-info.error {
      background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%);
      border-color: #fca5a5;
    }
    .ul-cart-upload-icon {
      width: 36px;
      height: 36px;
      border-radius: 6px;
      object-fit: cover;
      border: 1px solid rgba(0,0,0,0.1);
      flex-shrink: 0;
    }
    .ul-cart-upload-icon.placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      background: #e5e7eb;
      color: #6b7280;
    }
    .ul-cart-upload-details {
      flex: 1;
      min-width: 0;
    }
    .ul-cart-upload-filename {
      font-weight: 600;
      color: #1e40af;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      display: block;
    }
    .ul-cart-upload-status {
      font-size: 11px;
      color: #64748b;
      display: flex;
      align-items: center;
      gap: 4px;
      margin-top: 2px;
    }
    .ul-cart-upload-status .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #22c55e;
    }
    .ul-cart-upload-status .dot.processing {
      background: #eab308;
      animation: pulse 1.5s infinite;
    }
    .ul-cart-upload-status .dot.error {
      background: #ef4444;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .ul-cart-upload-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      background: #dbeafe;
      color: #1e40af;
      border-radius: 12px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
    }
  `;

  function injectStyles() {
    if (document.getElementById('ul-cart-upload-styles')) return;
    const style = document.createElement('style');
    style.id = 'ul-cart-upload-styles';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  async function getCartData() {
    try {
      const response = await fetch('/cart.js');
      if (!response.ok) throw new Error('Failed to fetch cart');
      return await response.json();
    } catch (error) {
      console.error('[Upload Studio Cart] Failed to get cart:', error);
      return null;
    }
  }

  async function getUploadStatus(uploadId, shopDomain) {
    try {
      const response = await fetch(`${CONFIG.apiBase}/api/upload/status/${uploadId}?shopDomain=${shopDomain}`);
      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      console.error('[Upload Studio Cart] Failed to get upload status:', error);
      return null;
    }
  }

  function createUploadInfoElement(uploadId, designFile, thumbnail) {
    const div = document.createElement('div');
    div.className = 'ul-cart-upload-info';
    div.dataset.uploadId = uploadId;
    
    const fileName = designFile || 'Custom Design';
    const shortName = fileName.length > 25 ? fileName.substring(0, 22) + '...' : fileName;
    
    const iconHtml = thumbnail 
      ? `<img class="ul-cart-upload-icon" src="${thumbnail}" alt="Design preview" onerror="this.style.display='none'">`
      : `<div class="ul-cart-upload-icon placeholder">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
            <polyline points="10 9 9 9 8 9"></polyline>
          </svg>
        </div>`;
    
    div.innerHTML = `
      ${iconHtml}
      <div class="ul-cart-upload-details">
        <span class="ul-cart-upload-filename" title="${fileName}">${shortName}</span>
        <div class="ul-cart-upload-status">
          <span class="dot"></span>
          <span class="status-text">Design attached</span>
        </div>
      </div>
      <span class="ul-cart-upload-badge">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        Custom
      </span>
    `;
    
    return div;
  }

  async function updateUploadInfo(element, uploadId) {
    const shopDomain = window.Shopify?.shop || document.querySelector('meta[name="shopify-domain"]')?.content;
    
    if (!shopDomain) {
      updateStatusDisplay(element, 'ready', 'Design attached');
      return;
    }

    const status = await getUploadStatus(uploadId, shopDomain);
    
    if (status) {
      const statusText = getStatusText(status.status);
      const statusClass = getStatusClass(status.status);
      updateStatusDisplay(element, statusClass, statusText);
      
      if (status.thumbnailUrl || status.previewUrl) {
        const iconEl = element.querySelector('.ul-cart-upload-icon');
        if (iconEl) {
          const img = document.createElement('img');
          img.className = 'ul-cart-upload-icon';
          img.src = status.thumbnailUrl || status.previewUrl;
          img.alt = 'Design preview';
          img.onerror = () => { img.style.display = 'none'; };
          iconEl.replaceWith(img);
        }
      }
    } else {
      updateStatusDisplay(element, 'ready', 'Design attached');
    }
  }

  function getStatusText(status) {
    const texts = {
      'pending': 'Ready for print',
      'processing': 'Ready for print',
      'ready': 'Ready for print',
      'completed': 'Ready for print',
      'approved': 'Approved',
      'blocked': 'Ready for print',
      'error': 'Ready for print'
    };
    return texts[status] || 'Design attached';
  }

  function getStatusClass(status) {
    if (['pending', 'processing'].includes(status)) return 'processing';
    // Always show green for customer - don't scare them away
    return 'ready';
  }

  function updateStatusDisplay(element, statusClass, statusText) {
    const dot = element.querySelector('.dot');
    const text = element.querySelector('.status-text');
    
    if (dot) dot.className = 'dot ' + statusClass;
    if (text) text.textContent = statusText;
    
    element.classList.remove('processing', 'error');
    if (statusClass !== 'ready') element.classList.add(statusClass);
  }

  // ============================================
  // FIND CART LINE ITEMS - Multi-theme support
  // ============================================
  
  function findCartLineItems() {
    // Priority ordered selectors - most specific first
    const selectors = [
      // THIS THEME - highest priority
      '.cart-line-item[data-key]',
      '.cart-line-item',
      
      // Dawn theme
      'cart-items .cart-item',
      '.cart-items .cart-item',
      '[data-cart-item]',
      
      // Common patterns
      '[data-cart-item-key]',
      '[data-line-item-key]',
      '[data-key][class*="cart"]',
      '[data-key][class*="line"]',
      
      // Other themes
      '.cart__row',
      '.cart-item',
      '.ajaxcart__product',
      '.cart__product',
      '[data-line-item]',
      '.line-item',
      'tr.cart-item',
      'tr[data-cart-item]',
      '.cart-drawer__item',
      '.cart-drawer-item',
      '.cart-item-row',
      '.cart__item',
      '.cart-product',
      '.cart__card',
      '.cart-template__item',
      '.cart__row--product',
      '.line-item--product',
      '.cart-item__wrapper',
      '.cart-item--product',
      '.cart__product-information',
      '.cart-item-container',
      '.cart__product-item',
      '.cart-item-block',
      '.cart-drawer__item--product',
      '.cart__item-row',
      '.cart__line-item',
      '.cart-item__container',
      '.cart-drawer-item__content',
      '.cart-item--full',
      '.cart-page__item',
      '.cart__line-product',
      '.cart-items__item'
    ];

    for (const selector of selectors) {
      try {
        const items = document.querySelectorAll(selector);
        if (items.length > 0) {
          log('Found items with selector:', selector, 'Count:', items.length);
          return Array.from(items);
        }
      } catch (e) {
        // Invalid selector, skip
      }
    }
    
    log('No cart items found with any selector');
    return [];
  }

  // Find where to append upload info within a line item
  function findAppendTarget(lineItem) {
    const selectors = [
      '.line-item-details',
      '.cart-line-item-details',
      '.line-item__details',
      '.cart-item__details',
      '.cart__product-information',
      '.cart-item__content',
      '.ajaxcart__product-meta',
      '.cart__meta',
      '.product-details',
      '.line-item__content',
      '.cart-item-details',
      '.cart-item__info',
      '.cart-product__info',
      '.cart__item-details',
      '.product-info',
      '.item-details',
      '[class*="details"]',
      '[class*="info"]:not(img):not(svg)'
    ];

    for (const selector of selectors) {
      const target = lineItem.querySelector(selector);
      if (target && target.offsetParent !== null) return target;
    }
    
    return lineItem;
  }

  // ============================================
  // MAIN PROCESSING - Simple key-based matching
  // ============================================

  async function processCart() {
    const cart = await getCartData();
    if (!cart || !cart.items || cart.items.length === 0) {
      log('No cart data or empty cart');
      return;
    }
    
    log('Processing cart with', cart.items.length, 'items');

    // Build a map of cart item KEY -> upload data
    const uploadsByKey = new Map();
    
    cart.items.forEach((item, index) => {
      const uploadId = item.properties?.[CONFIG.propertyKey] || 
                       item.properties?.['_ul_upload_id'];
      
      if (!uploadId) return;

      const designFile = item.properties?.[CONFIG.designFileKey] ||
                         item.properties?.['_ul_design_file'] ||
                         item.properties?.['_ul_file_name'] ||
                         item.properties?.['File Name'] ||
                         item.properties?.['Design Name'];
      
      const thumbnail = item.properties?.['_ul_thumbnail'] || 
                        item.properties?.['_ul_upload_url'] ||
                        item.properties?.['Uploaded File'];

      // Use item.key as the primary identifier
      uploadsByKey.set(item.key, {
        uploadId,
        designFile,
        thumbnail,
        cartIndex: index,
        key: item.key,
        variantId: String(item.variant_id)
      });
      
      log('Found upload:', item.key, '→', uploadId);
    });

    if (uploadsByKey.size === 0) {
      log('No upload items in cart');
      return;
    }
    
    log('Total uploads found:', uploadsByKey.size);

    // Find DOM elements
    const lineItemElements = findCartLineItems();
    if (lineItemElements.length === 0) {
      log('No cart line items found in DOM');
      return;
    }
    
    log('Found', lineItemElements.length, 'line item elements');

    // Match and apply
    let matchCount = 0;
    
    lineItemElements.forEach((lineItem, domIndex) => {
      // Skip if already processed
      if (lineItem.querySelector('.ul-cart-upload-info')) {
        return;
      }

      // Get the data-key attribute from the DOM element
      const domKey = lineItem.dataset.key || 
                     lineItem.dataset.lineItemKey ||
                     lineItem.dataset.cartItemKey ||
                     lineItem.getAttribute('data-key') ||
                     lineItem.getAttribute('data-line-item-key') ||
                     lineItem.querySelector('[data-key]')?.dataset.key;

      if (!domKey) {
        log(`DOM[${domIndex}] has no data-key attribute`);
        return;
      }

      // Look up upload by key
      const uploadData = uploadsByKey.get(domKey);
      
      if (uploadData) {
        log(`DOM[${domIndex}] MATCHED by key:`, domKey, '→', uploadData.uploadId);
        
        const target = findAppendTarget(lineItem);
        const infoEl = createUploadInfoElement(uploadData.uploadId, uploadData.designFile, uploadData.thumbnail);
        target.appendChild(infoEl);
        
        // Fetch status asynchronously
        updateUploadInfo(infoEl, uploadData.uploadId);
        matchCount++;
      } else {
        // This is normal for products without uploads
        log(`DOM[${domIndex}] key: ${domKey} - no upload (normal product)`);
      }
    });

    log(`Finished: ${matchCount} uploads matched out of ${uploadsByKey.size}`);
    
    // Warn about unmatched uploads
    if (matchCount < uploadsByKey.size) {
      const matchedKeys = new Set();
      lineItemElements.forEach(el => {
        const key = el.dataset.key;
        if (key && uploadsByKey.has(key)) matchedKeys.add(key);
      });
      
      const unmatchedUploads = Array.from(uploadsByKey.entries())
        .filter(([key]) => !matchedKeys.has(key));
      
      if (unmatchedUploads.length > 0) {
        log('WARNING: Unmatched uploads:', unmatchedUploads.map(([key, data]) => ({
          key,
          uploadId: data.uploadId
        })));
      }
    }
  }

  // ============================================
  // INITIALIZATION
  // ============================================

  function init() {
    const isCartPage = window.location.pathname.includes('/cart') ||
                       document.querySelector('[data-cart-form]') ||
                       document.querySelector('form[action="/cart"]') ||
                       document.querySelector('.cart-form') ||
                       document.querySelector('#cart') ||
                       document.querySelector('.cart__items') ||
                       document.querySelector('.cart-line-item');

    if (!isCartPage) return;

    log('Initializing cart display');
    injectStyles();
    
    let retries = 0;
    const tryProcess = () => {
      const items = findCartLineItems();
      if (items.length > 0 || retries >= CONFIG.maxRetries) {
        processCart();
      } else {
        retries++;
        setTimeout(tryProcess, CONFIG.pollInterval);
      }
    };
    
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', tryProcess);
    } else {
      setTimeout(tryProcess, 100);
    }

    // Watch for AJAX cart updates
    const observer = new MutationObserver((mutations) => {
      let shouldProcess = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === 1 && 
                (node.matches?.('.cart-line-item') ||
                 node.matches?.('[data-cart-item]') || 
                 node.querySelector?.('[data-cart-item]') ||
                 node.querySelector?.('.cart-line-item') ||
                 node.classList?.contains('cart-item'))) {
              shouldProcess = true;
              break;
            }
          }
        }
      }
      if (shouldProcess) {
        setTimeout(processCart, 200);
      }
    });

    observer.observe(document.body, { 
      childList: true, 
      subtree: true 
    });

    document.addEventListener('cart:updated', () => setTimeout(processCart, 200));
    document.addEventListener('ajaxCart:updated', () => setTimeout(processCart, 200));
    document.addEventListener('cart:refresh', () => setTimeout(processCart, 200));
  }

  init();
})();