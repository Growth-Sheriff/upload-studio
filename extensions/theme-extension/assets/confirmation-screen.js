(function() {
  'use strict';
  const ULConfirmation = {
    isOpen: false,
    cartData: null,
    el: {},
    init() {
      this.cacheElements();
      this.bindEvents();
      if (window.ULState) {
        window.ULState.subscribe('ui.confirmationOpen', (isOpen) => {
          if (isOpen && !this.isOpen) {
            this.show({});
          } else if (!isOpen && this.isOpen) {
            this.close();
          }
        });
      }
    },
    cacheElements() {
      this.el = {
        overlay: document.getElementById('ul-confirm-overlay'),
        subtitle: document.getElementById('ul-confirm-subtitle'),
        cartCount: document.getElementById('ul-confirm-cart-count'),
        itemsContainer: document.getElementById('ul-confirm-items'),
        emptyState: document.getElementById('ul-confirm-empty'),
        totalContainer: document.getElementById('ul-confirm-total'),
        totalValue: document.getElementById('ul-confirm-total-value'),
        checkoutBtn: document.getElementById('ul-confirm-checkout'),
        continueBtn: document.getElementById('ul-confirm-continue')
      };
    },
    bindEvents() {
      document.addEventListener('ul:showConfirmation', (e) => {
        this.show(e.detail);
      });
      this.el.checkoutBtn?.addEventListener('click', () => {
        this.proceedToCheckout();
      });
      this.el.continueBtn?.addEventListener('click', () => {
        this.close();
      });
      this.el.overlay?.addEventListener('click', (e) => {
        if (e.target === this.el.overlay) {
          this.close();
        }
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.isOpen) {
          this.close();
        }
      });
    },
    async show(detail = {}) {
      if (window.Shopify && window.Shopify.designMode) return;
      if (this.isOpen) return;
      this.isOpen = true;
      if (!this._lastFetch || Date.now() - this._lastFetch > 2000) {
        await this.fetchCart();
        this._lastFetch = Date.now();
      }
      if (window.ULState && this.cartData) {
        window.ULState.set('cart.items', this.cartData.items);
        window.ULState.set('cart.itemCount', this.cartData.item_count);
        window.ULState.set('cart.totalPrice', this.cartData.total_price);
      }
      if (window.ULAnalytics && this.cartData) {
        window.ULAnalytics.trackConfirmationShown({
          source: detail.source || 'unknown',
          itemCount: this.cartData.item_count,
          cartTotal: this.cartData.total_price,
          hasUploadLiftItems: this.cartData.items.some(item =>
            item.properties && (item.properties['Sheet Identity'] || item.properties['_ul_upload_id'] || item.properties['_ul_is_tshirt'])
          )
        });
      }
      this.render();
      this.el.overlay?.classList.add('active');
      document.body.style.overflow = 'hidden';
    },
    close() {
      if (!this.isOpen) return;
      this.el.overlay?.classList.remove('active');
      this.isOpen = false;
      document.body.style.overflow = '';
      if (window.ULState) {
        window.ULState.set('ui.confirmationOpen', false);
      }
      if (window.ULAnalytics) {
        window.ULAnalytics.trackContinueShopping({
          itemCount: this.cartData?.item_count || 0,
          cartTotal: this.cartData?.total_price || 0
        });
      }
      if (window.ULEvents) {
        window.ULEvents.emit('hideConfirmation', {});
      }
    },
    async fetchCart() {
      try {
        const response = await fetch('/cart.js', {
          headers: { 'Accept': 'application/json' }
        });
        if (!response.ok) throw new Error('Failed to fetch cart');
        this.cartData = await response.json();
      } catch (error) {
        console.error('[ULConfirmation] Cart fetch error:', error);
        this.cartData = { items: [], total_price: 0, item_count: 0 };
      }
    },
    render() {
      if (!this.cartData) return;
      const { items, total_price, item_count } = this.cartData;
      if (this.el.cartCount) {
        this.el.cartCount.textContent = item_count;
      }
      if (this.el.subtitle) {
        this.el.subtitle.textContent = item_count === 1
          ? '1 item in your cart'
          : `${item_count} items in your cart`;
      }
      if (this.el.itemsContainer) {
        if (items.length === 0) {
          this.el.itemsContainer.style.display = 'none';
          this.el.emptyState.style.display = 'block';
          this.el.totalContainer.style.display = 'none';
        } else {
          this.el.itemsContainer.style.display = 'flex';
          this.el.emptyState.style.display = 'none';
          this.el.totalContainer.style.display = 'flex';
          this.el.itemsContainer.innerHTML = items.map(item => this.renderItem(item)).join('');
        }
      }
      if (this.el.totalValue) {
        this.el.totalValue.textContent = this.formatMoney(total_price);
      }
    },
    renderItem(item) {
      const isUploadLift = item.properties && (
        item.properties['Sheet Identity'] ||
        item.properties['Print Ready'] ||
        item.properties['_ul_upload_id'] ||
        item.properties['_ul_is_tshirt'] ||
        item.properties['_upload_id'] ||
        item.properties['Uploaded File']
      );
      const isTShirt = item.properties && item.properties['_ul_is_tshirt'] === 'true';
      const icon = isTShirt ? '👕' : (isUploadLift ? '🖼️' : '📦');
      let meta = `Qty: ${item.quantity}`;
      if (isTShirt) {
        const color = item.properties['_ul_tshirt_color'] || item.properties['T-Shirt Color'] || '';
        const size = item.properties['_ul_tshirt_size'] || item.properties['T-Shirt Size'] || '';
        const locations = item.properties['_ul_locations'] || item.properties['Print Locations'] || 'front';
        if (color || size) {
          meta = `${color}${color && size ? ', ' : ''}${size} • Qty: ${item.quantity}`;
        }
        const locNames = locations.split(',').map(l => {
          const map = { front: 'Front', back: 'Back', left_sleeve: 'L.Sleeve', right_sleeve: 'R.Sleeve' };
          return map[l.trim()] || l;
        });
        meta += ` • ${locNames.join(' + ')}`;
      }
      if (item.variant_title && item.variant_title !== 'Default Title') {
        meta = `${item.variant_title} • Qty: ${item.quantity}`;
      }
      return `
        <div class="ul-confirm-item">
          <div class="ul-confirm-item-icon">${icon}</div>
          <div class="ul-confirm-item-info">
            <div class="ul-confirm-item-name">${this.escapeHtml(item.product_title)}</div>
            <div class="ul-confirm-item-meta">${meta}</div>
          </div>
          <div class="ul-confirm-item-price">${this.formatMoney(item.final_line_price)}</div>
        </div>
      `;
    },
    formatMoney(cents) {
      const dollars = (cents / 100).toFixed(2);
      return `$${dollars}`;
    },
    escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    },
    proceedToCheckout() {
      if (window.ULAnalytics) {
        window.ULAnalytics.trackProceedCheckout({
          itemCount: this.cartData?.item_count || 0,
          cartTotal: this.cartData?.total_price || 0,
          hasUploadLiftItems: this.cartData?.items?.some(item =>
            item.properties && (item.properties['_ul_upload_id'] || item.properties['_ul_is_tshirt'])
          ) || false
        });
      }
      this.close();
      window.location.href = '/checkout';
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ULConfirmation.init());
  } else {
    ULConfirmation.init();
  }
  window.ULConfirmation = ULConfirmation;
})();
