/* Upload Studio — DTF + UV gang sheet upload block.
   One page sells two products. The customer picks DTF or UV at the top and
   every file uploaded there belongs to that product for its whole life.

   Each product runs its own copy of the main upload engine
   (main-product-upload-app.js, window.ULMainProductUpload) on a sub-root, so
   measuring, previews, special per-inch pricing, the cross-tab cart lock and
   cart verification are the same tested code as the single-product block.
   This file adds the product switch, one compact file list with per-file
   notes, and one Add to cart / Checkout for both products. Wholesale
   customers upload 20+ files at once, so a file is one dense row and the
   list scrolls inside itself instead of stretching the page. */
(function() {
  'use strict';

  var ROOT_SELECTOR = '[data-ul-dtf-uv-upload]';
  var SIDES = ['dtf', 'uv'];
  var SHORT_LABELS = { dtf: 'DTF', uv: 'UV' };
  var NOTE_MAX = 200;
  // Below this width the preview only opens on demand (matches the CSS).
  var NARROW_QUERY = '(max-width: 879px)';
  var PENCIL_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4Z"></path><path d="m13.5 6.5 4 4"></path></svg>';

  function isNarrow() {
    return Boolean(window.matchMedia && window.matchMedia(NARROW_QUERY).matches);
  }

  function hasFiles(event) {
    var types = event.dataTransfer && event.dataTransfer.types;
    return Boolean(types && Array.prototype.indexOf.call(types, 'Files') !== -1);
  }

  function parseJson(value, fallback) {
    try { return JSON.parse(value); } catch (_) { return fallback; }
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toNumber(value) {
    var n = Number(value);
    return isFinite(n) ? n : 0;
  }

  // en-US like the engine's price table, whatever the shopper's browser locale.
  function formatMoney(amount, currency) {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(amount);
    } catch (_) {
      return '$' + (Math.round(amount * 100) / 100).toFixed(2);
    }
  }

  function formatInches(value) {
    var n = Math.round(toNumber(value) * 100) / 100;
    return (n % 1 === 0 ? String(n) : n.toFixed(2)) + '"';
  }

  function readStore(key, fallback) {
    try { return parseJson(window.localStorage.getItem(key), fallback) || fallback; } catch (_) { return fallback; }
  }

  function writeStore(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  // The engine's own markup (blocks/main-product-upload-app.liquid) for one
  // product. Parts this block replaces (file list, buttons, totals, notes) are
  // hidden by CSS but stay in place because the engine binds to them.
  function engineMarkup(o) {
    return '' +
      '<div class="ump__shell">' +
        '<div class="ump__workspace">' +
          '<div class="ump__drop" data-ump-dropzone>' +
            '<input class="ump__input" data-ump-input type="file" accept="' + escapeHtml(o.accept) + '" multiple />' +
            '<div class="ump__drop-grid" aria-hidden="true"></div>' +
            '<div class="ump__drop-main">' +
              '<p class="ump__product-name">' + escapeHtml(o.label) + '</p>' +
              '<h2 class="ump__title">Upload your ' + escapeHtml(o.shortLabel) + ' gang sheets</h2>' +
              '<button class="ump__upload-btn ump__upload-btn--live" type="button" data-ump-upload-trigger>' +
                '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4"></path><path d="m6 10 6-6 6 6"></path><path d="M4 20h16"></path></svg>' +
                '<span>Upload ' + escapeHtml(o.shortLabel) + ' files</span>' +
                '<em>or drop them here</em>' +
              '</button>' +
              '<ul class="ump__specs" aria-label="Accepted files">' +
                '<li class="ump__spec--max-width">22.5&quot; maximum width</li>' +
                '<li>PNG</li><li>JPG</li><li>TIFF</li><li>PSD</li><li>PDF</li><li>AI</li><li>EPS</li><li>SVG</li>' +
              '</ul>' +
            '</div>' +
            '<div class="ump__drop-overlay" aria-hidden="true"><span>Drop to upload as ' + escapeHtml(o.shortLabel) + '</span></div>' +
          '</div>' +
          '<div class="ump__status" data-ump-status-panel hidden>' +
            '<div class="ump__file">' +
              '<img class="ump__thumb" data-ump-thumb alt="" width="48" height="48" hidden>' +
              '<div>' +
                '<p class="ump__file-name" data-ump-file-name></p>' +
                '<p class="ump__file-meta" data-ump-file-meta></p>' +
                '<div class="ump__file-pills" data-ump-file-pills hidden>' +
                  '<span class="ump__pill" data-ump-pill-size></span>' +
                  '<span class="ump__pill ump__pill--type" data-ump-pill-type></span>' +
                  '<span class="ump__pill ump__pill--multipart" data-ump-pill-multipart hidden>Parallel</span>' +
                '</div>' +
              '</div>' +
              '<div class="ump__file-actions">' +
                '<button class="ump__btn ump__btn--ghost ump__cancel" type="button" data-ump-cancel hidden>Cancel</button>' +
                '<button class="ump__btn ump__btn--primary ump__retry" type="button" data-ump-retry hidden>Try again</button>' +
              '</div>' +
            '</div>' +
            '<div class="ump__progress" data-ump-progress-wrap hidden><div class="ump__progress-bar" data-ump-progress></div></div>' +
            '<div class="ump__progress-text" data-ump-progress-text hidden></div>' +
            '<div class="ump__stage" data-ump-stage hidden>' +
              '<span class="ump__stage-dot" data-ump-stage-upload></span>' +
              '<span class="ump__stage-label" data-ump-stage-upload-label>Uploading</span>' +
              '<span class="ump__stage-sep" aria-hidden="true"></span>' +
              '<span class="ump__stage-dot" data-ump-stage-measure></span>' +
              '<span class="ump__stage-label" data-ump-stage-measure-label>Measuring</span>' +
              '<span class="ump__stage-sep" aria-hidden="true"></span>' +
              '<span class="ump__stage-dot" data-ump-stage-ready></span>' +
              '<span class="ump__stage-label" data-ump-stage-ready-label>Ready</span>' +
            '</div>' +
          '</div>' +
          '<div class="ump__files" data-ump-files hidden>' +
            '<div class="ump__files-head">' +
              '<h3 class="ump__card-title">Your files <span data-ump-files-count></span></h3>' +
              '<span class="ump__files-tools">' +
                '<button class="ump__btn ump__btn--ghost ump__btn--danger" type="button" data-ump-clear>Clear all</button>' +
                '<button class="ump__btn ump__btn--ghost" type="button" data-ump-replace>Add more</button>' +
              '</span>' +
            '</div>' +
            '<div class="ump__queue" data-ump-queue></div>' +
          '</div>' +
          '<div class="ump__price-table-wrap" data-ump-price-table hidden></div>' +
        '</div>' +
        '<aside class="ump__inspector" aria-live="polite">' +
          '<div class="ump__preview-card" data-ump-preview-card>' +
            '<div class="ump__preview-head">' +
              '<div><p class="ump__eyebrow">Measured size</p><h3 class="ump__size" data-ump-size>-- x --</h3></div>' +
              '<span class="ump__badge" data-ump-badge>Waiting</span>' +
              '<button class="ulx__preview-close" type="button" data-ulx-preview-close aria-label="Close preview">×</button>' +
            '</div>' +
            '<div class="ump__sheet" data-ump-sheet>' +
              '<div class="ump__ruler ump__ruler--top" data-ump-ruler-top></div>' +
              '<div class="ump__ruler ump__ruler--side" data-ump-ruler-side></div>' +
              '<div class="ump__sheet-plane" data-ump-sheet-plane>' +
                '<div class="ump__art" data-ump-art>' +
                  '<span class="ump__art-empty" data-ump-art-label>Your design appears here</span>' +
                  '<em class="ump__art-dim ump__art-dim--w" data-ump-art-dim-w hidden></em>' +
                  '<em class="ump__art-dim ump__art-dim--h" data-ump-art-dim-h hidden></em>' +
                '</div>' +
                '<span class="ump__sheet-cut" data-ump-sheet-cut hidden></span>' +
              '</div>' +
            '</div>' +
            '<div class="ump__facts" data-ump-facts>' +
              '<span class="ump__fact"><small>Sheet</small><strong data-ump-sheet-label>--</strong></span>' +
              '<span class="ump__fact"><small>Width</small><strong data-ump-width>--</strong></span>' +
              '<span class="ump__fact"><small>Length</small><strong data-ump-height>--</strong></span>' +
              '<span class="ump__fact ump__quality" data-ump-quality hidden>' +
                '<small>Quality</small>' +
                '<strong><i class="ump__quality-dot" aria-hidden="true"></i><span data-ump-quality-badge></span></strong>' +
                '<span class="ump__quality-text" data-ump-quality-text hidden></span>' +
              '</span>' +
            '</div>' +
            '<p class="ump__note" data-ump-note hidden></p>' +
          '</div>' +
          '<div class="ump__price-strip" data-ump-price-strip hidden></div>' +
          '<div class="ump__actions">' +
            '<button class="ump__btn ump__btn--primary ump__cart" type="button" data-ump-add data-gs-event="click" data-default-label="Add to cart" disabled><span>Add to cart</span></button>' +
            '<button class="ump__btn ump__btn--accent ump__checkout" type="button" data-ump-checkout data-gs-event="click" data-default-label="Checkout" disabled><span>Checkout</span></button>' +
          '</div>' +
          '<div class="ump__total" data-ump-total hidden>' +
            '<div class="ump__total-head">' +
              '<span class="ump__total-label">Cart total</span>' +
              '<span class="ump__total-meta" data-ump-total-meta></span>' +
              '<strong class="ump__total-value" data-ump-total-value></strong>' +
            '</div>' +
            '<ul class="ump__total-lines" data-ump-total-lines></ul>' +
          '</div>' +
          '<div class="ump__order-note" data-ump-order-note-wrap hidden>' +
            '<textarea class="ump__order-note-input" data-ump-order-note rows="2" maxlength="500" aria-hidden="true" tabindex="-1"></textarea>' +
          '</div>' +
          '<p class="ump__error" data-ump-error hidden></p>' +
        '</aside>' +
      '</div>';
  }

  function DualUpload(root) {
    this.root = root;
    var dataEl = root.querySelector('[data-ulx-products]');
    var products = parseJson(dataEl ? dataEl.textContent : '', {}) || {};
    this.products = {};
    SIDES.forEach(function(side) {
      if (products[side] && products[side].id) this.products[side] = products[side];
    }, this);
    this.sides = SIDES.filter(function(side) { return Boolean(this.products[side]); }, this);
    if (!this.sides.length) return;

    this.shopDomain = root.getAttribute('data-shop-domain') || '';
    this.customerId = String(root.getAttribute('data-customer-id') || '').replace(/\D/g, '');
    this.currency = root.getAttribute('data-currency') || 'USD';
    this.enableCheckout = root.getAttribute('data-enable-checkout') !== 'false';
    this.loginUrl = root.getAttribute('data-login-url') || '/account/login';
    var pageProductId = String(root.getAttribute('data-page-product-id') || '');
    this.active = this.sides.filter(function(side) {
      return String(this.products[side].id) === pageProductId;
    }, this)[0] || this.sides[0];

    this.notesKey = ['ulxNotes', this.shopDomain || 'shop', this.customerId || 'guest'].join(':');
    this.notes = readStore(this.notesKey, {});
    this.openNotes = {};
    this.generalOpen = Boolean(String(this.notes.__general || '').trim());
    this.previewOpen = false;
    this.busy = false;
    this.engines = {};
    this.panes = {};
    this.renderQueued = false;

    this.buildLayout();
    this.sides.forEach(this.mountEngine, this);
    this.bindEvents();
    this.render();
    this.watchBottomBar();
  }

  DualUpload.prototype.buildLayout = function() {
    var heading = this.root.getAttribute('data-heading') || 'Upload your gang sheets';
    var sides = this.sides.map(function(side) {
      return '' +
        '<button class="ulx__side ulx__side--' + side + '" type="button" role="tab" data-ulx-side="' + side + '">' +
          '<span class="ulx__side-long">' + escapeHtml(this.products[side].label || this.products[side].title) + '</span>' +
          '<span class="ulx__side-short" aria-hidden="true">' + SHORT_LABELS[side] + '</span>' +
          '<span class="ulx__side-rate" data-ulx-rate="' + side + '"></span>' +
          '<span class="ulx__side-count" data-ulx-count="' + side + '" hidden></span>' +
        '</button>';
    }, this).join('');
    var loginHref = this.loginUrl + (this.loginUrl.indexOf('?') === -1 ? '?' : '&') +
      'return_url=' + encodeURIComponent(window.location.pathname + window.location.search);

    // Layout: head, then the active product's drop bar (and, on wide
    // screens, its preview in a side column), then the file list and footer.
    this.root.innerHTML = '' +
      '<div class="ulx__head">' +
        '<h2 class="ulx__title">' + escapeHtml(heading) + '</h2>' +
        '<div class="ulx__switch' + (this.sides.length < 2 ? ' ulx__switch--single' : '') + '" role="tablist" aria-label="Print type">' + sides + '</div>' +
        (this.customerId ? '' :
          '<p class="ulx__login">Wholesale account? <a href="' + escapeHtml(loginHref) + '">Log in for your rate</a></p>') +
      '</div>' +
      '<div class="ulx__panes" data-ulx-panes></div>' +
      '<div class="ulx__order" data-ulx-order hidden>' +
        '<ul class="ulx__rows" data-ulx-rows aria-label="Your files"></ul>' +
        '<div class="ulx__general">' +
          '<button class="ulx__link" type="button" data-ulx-general-toggle aria-expanded="false"></button>' +
          '<textarea class="ulx__general-input" data-ulx-general-note rows="2" maxlength="500" aria-label="Order note" placeholder="Anything our production team should know about this order" hidden></textarea>' +
        '</div>' +
        '<div class="ulx__footer">' +
          '<div class="ulx__sums" data-ulx-subtotals aria-live="polite"></div>' +
          '<div class="ulx__grand" aria-live="polite">' +
            '<span class="ulx__grand-label">Total</span>' +
            '<strong class="ulx__grand-value" data-ulx-grand></strong>' +
          '</div>' +
          '<small class="ulx__grand-meta" data-ulx-grand-meta></small>' +
          '<div class="ulx__actions">' +
            '<button class="ulx__btn ulx__btn--primary" type="button" data-ulx-add data-gs-event="click" disabled>Add to cart</button>' +
            '<button class="ulx__btn ulx__btn--dark" type="button" data-ulx-checkout data-gs-event="click" disabled>Checkout</button>' +
          '</div>' +
          '<p class="ulx__status" data-ulx-status aria-live="polite" hidden></p>' +
          '<p class="ulx__error" data-ulx-error role="alert" hidden></p>' +
        '</div>' +
      '</div>';

    this.orderCard = this.root.querySelector('[data-ulx-order]');
    this.rowsEl = this.root.querySelector('[data-ulx-rows]');
    this.subtotalsEl = this.root.querySelector('[data-ulx-subtotals]');
    this.grandEl = this.root.querySelector('[data-ulx-grand]');
    this.grandMetaEl = this.root.querySelector('[data-ulx-grand-meta]');
    this.addBtn = this.root.querySelector('[data-ulx-add]');
    this.checkoutBtn = this.root.querySelector('[data-ulx-checkout]');
    this.statusEl = this.root.querySelector('[data-ulx-status]');
    this.errorEl = this.root.querySelector('[data-ulx-error]');
    this.generalToggle = this.root.querySelector('[data-ulx-general-toggle]');
    this.generalNote = this.root.querySelector('[data-ulx-general-note]');
    this.panesEl = this.root.querySelector('[data-ulx-panes]');
    this.generalNote.value = String(this.notes.__general || '');
  };

  DualUpload.prototype.mountEngine = function(side) {
    var product = this.products[side];
    var root = this.root;
    var pane = document.createElement('div');
    pane.className = 'ump ulx__engine ulx__engine--' + side;
    var attrs = {
      'data-section-id': (root.getAttribute('data-section-id') || 'ulx') + '-' + side,
      'data-product-id': String(product.id),
      'data-product-title': product.title || '',
      'data-current-variant-id': String(product.firstVariantId || ''),
      'data-product-variants': JSON.stringify(product.variants || []),
      'data-product-options': JSON.stringify(product.options || []),
      'data-currency': this.currency,
      'data-shop-domain': this.shopDomain,
      'data-customer-id': root.getAttribute('data-customer-id') || '',
      'data-customer-email': root.getAttribute('data-customer-email') || '',
      'data-customer-name': root.getAttribute('data-customer-name') || '',
      'data-api-base': root.getAttribute('data-api-base') || '/apps/customizer',
      'data-max-printable-width-in': '22.5',
      'data-accepted-files': root.getAttribute('data-accepted-files') || '',
      'data-enable-checkout': 'true',
      // The special per-inch rate is already net: automatic discounts must not
      // stack on it. Discount codes stay allowed at checkout.
      'data-accept-automatic-discounts': 'false',
      // This block writes one combined note; no per-engine file-name prefix.
      'data-order-note-files': 'false'
    };
    Object.keys(attrs).forEach(function(name) { pane.setAttribute(name, attrs[name]); });
    pane.setAttribute('role', 'tabpanel');
    // DTF keeps the block accent; UV uses its own colour throughout its pane.
    pane.style.cssText = side === 'uv' ? '--ump-accent: var(--ulx-uv);' : (root.getAttribute('style') || '');
    pane.innerHTML = engineMarkup({
      accept: attrs['data-accepted-files'],
      label: product.label || product.title,
      shortLabel: SHORT_LABELS[side]
    });
    this.panesEl.appendChild(pane);
    this.panes[side] = pane;
    var self = this;
    pane.addEventListener('ump:render', function() { self.scheduleRender(); });
    this.engines[side] = new window.ULMainProductUpload(pane);
  };

  DualUpload.prototype.bindEvents = function() {
    var self = this;
    // Row buttons never take focus on press: a note being typed keeps it until
    // the click handler releases it, so a re-render cannot swallow the click.
    this.rowsEl.addEventListener('mousedown', function(event) {
      if (event.target.closest('button')) event.preventDefault();
    });
    this.root.addEventListener('click', function(event) {
      var target = event.target;
      var sideBtn = target.closest('[data-ulx-side]');
      if (sideBtn) {
        self.setActive(sideBtn.getAttribute('data-ulx-side'));
        return;
      }
      if (target.closest('[data-ulx-preview-close]')) {
        self.previewOpen = false;
        self.render();
        return;
      }
      if (target.closest('[data-ulx-general-toggle]')) {
        self.toggleGeneralNote();
        return;
      }
      var row = target.closest('[data-ulx-row]');
      if (!row || !target.closest('button')) return;
      var side = row.getAttribute('data-side');
      var uploadId = row.getAttribute('data-ulx-row');
      var engine = self.engines[side];
      if (!engine) return;
      if (target.closest('[data-ulx-note-toggle]')) {
        self.toggleNote(uploadId);
        return;
      }
      self.releaseNoteFocus();
      if (target.closest('[data-ulx-remove]')) {
        delete self.openNotes[uploadId];
        delete self.notes[uploadId];
        self.saveNotes();
        engine.removeUploadItem(uploadId);
        return;
      }
      var step = target.closest('[data-ulx-step]');
      if (step) {
        var item = engine.findItem(uploadId);
        var next = Math.max(1, (Number(item && item.copies) || 1) + Number(step.getAttribute('data-ulx-step')));
        engine.setItemCopies(uploadId, next);
        return;
      }
      if (target.closest('[data-ulx-open]')) self.openPreview(side, uploadId);
    });
    this.root.addEventListener('input', function(event) {
      var note = event.target.closest('[data-ulx-note]');
      if (note) {
        self.notes[note.getAttribute('data-ulx-note')] = String(note.value || '').slice(0, NOTE_MAX);
        self.saveNotes();
        return;
      }
      if (event.target === self.generalNote) {
        self.notes.__general = String(self.generalNote.value || '').slice(0, 500);
        self.saveNotes();
      }
    });
    // Leaving a note folds it back into the row (its text shows in the row's
    // second line), and the rows skipped while typing catch up.
    this.rowsEl.addEventListener('focusout', function(event) {
      var note = event.target.closest && event.target.closest('[data-ulx-note]');
      if (!note) return;
      delete self.openNotes[note.getAttribute('data-ulx-note')];
      self.scheduleRender();
    });
    this.root.addEventListener('keydown', function(event) {
      if (event.key === 'Enter' && event.target.matches && event.target.matches('[data-ulx-note]')) {
        event.preventDefault();
        event.target.blur();
        return;
      }
      var tab = event.target.closest('[data-ulx-side]');
      if (!tab || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
      var index = self.sides.indexOf(tab.getAttribute('data-ulx-side'));
      var next = self.sides[(index + (event.key === 'ArrowRight' ? 1 : self.sides.length - 1)) % self.sides.length];
      self.setActive(next);
      var nextTab = self.root.querySelector('[data-ulx-side="' + next + '"]');
      if (nextTab) nextTab.focus();
    });
    this.bindDrop();
    this.addBtn.addEventListener('click', function() { self.submit('/cart'); });
    this.checkoutBtn.addEventListener('click', function() { self.submit('/checkout'); });
    window.addEventListener('pageshow', function(event) {
      if (!event.persisted) return;
      // Back from the cart: notes may have been forgotten on the way out.
      self.notes = readStore(self.notesKey, {});
      self.generalNote.value = String(self.notes.__general || '');
      self.generalOpen = Boolean(String(self.notes.__general || '').trim());
      self.busy = false;
      self.render();
    });
  };

  // Files dropped anywhere on the block go to the selected product, so the
  // slim upload bar is never a small target. Drops on the bar itself are
  // handled (and stopped) by the engine.
  DualUpload.prototype.bindDrop = function() {
    var self = this;
    var root = this.root;
    var clear = function() { root.classList.remove('is-dragging'); };
    root.addEventListener('dragover', function(event) {
      if (!hasFiles(event)) return;
      event.preventDefault();
      root.classList.add('is-dragging');
    });
    root.addEventListener('dragleave', function(event) {
      if (!event.relatedTarget || !root.contains(event.relatedTarget)) clear();
    });
    root.addEventListener('drop', clear, true);
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    root.addEventListener('drop', function(event) {
      if (!hasFiles(event) || self.busy) return;
      event.preventDefault();
      var files = Array.prototype.slice.call((event.dataTransfer && event.dataTransfer.files) || []);
      var engine = self.engines[self.active];
      if (files.length && engine) Promise.resolve(engine.startUploads(files)).catch(function() {});
    });
  };

  // Many themes pin their own menu bar to the bottom of phone screens. The
  // block's pinned footer sits above that bar instead of under it.
  DualUpload.prototype.watchBottomBar = function() {
    var self = this;
    var pending = false;
    var fixedBarTop = function(el) {
      for (; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
        if (self.root.contains(el)) return null;
        var position = window.getComputedStyle(el).position;
        if (position !== 'fixed' && position !== 'sticky') continue;
        var rect = el.getBoundingClientRect();
        var fullWidth = rect.width >= window.innerWidth * 0.6;
        return fullWidth && rect.bottom >= window.innerHeight - 4 ? rect.top : null;
      }
      return null;
    };
    var measure = function() {
      pending = false;
      var offset = 0;
      if (isNarrow() && typeof document.elementsFromPoint === 'function') {
        var stack = document.elementsFromPoint(window.innerWidth / 2, window.innerHeight - 2).slice(0, 6);
        for (var i = 0; i < stack.length; i += 1) {
          var top = fixedBarTop(stack[i]);
          if (top != null) {
            offset = Math.max(0, Math.round(window.innerHeight - top));
            break;
          }
        }
      }
      self.root.style.setProperty('--ulx-bottom', offset + 'px');
    };
    var schedule = function() {
      if (pending) return;
      pending = true;
      setTimeout(measure, 200);
    };
    measure();
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, { passive: true });
  };

  DualUpload.prototype.saveNotes = function() {
    writeStore(this.notesKey, this.notes);
  };

  DualUpload.prototype.focusedNote = function() {
    var focused = document.activeElement;
    return focused && focused.matches && focused.matches('[data-ulx-note]') && this.rowsEl.contains(focused)
      ? focused
      : null;
  };

  DualUpload.prototype.releaseNoteFocus = function() {
    var note = this.focusedNote();
    if (note) note.blur();
  };

  DualUpload.prototype.toggleNote = function(uploadId) {
    var open = !this.openNotes[uploadId];
    this.releaseNoteFocus();
    if (open) this.openNotes[uploadId] = true;
    else delete this.openNotes[uploadId];
    this.renderRows(this.collectRows());
    if (!open) return;
    var inputs = this.rowsEl.querySelectorAll('[data-ulx-note]');
    for (var i = 0; i < inputs.length; i += 1) {
      if (inputs[i].getAttribute('data-ulx-note') === String(uploadId)) {
        inputs[i].focus();
        break;
      }
    }
  };

  DualUpload.prototype.toggleGeneralNote = function() {
    this.generalOpen = !this.generalOpen;
    this.renderGeneral();
    if (this.generalOpen) this.generalNote.focus();
  };

  // Wide screens always show the preview beside the list; narrow ones open
  // it on demand above the list.
  DualUpload.prototype.openPreview = function(side, uploadId) {
    this.previewOpen = true;
    if (side !== this.active) this.setActive(side);
    this.engines[side].selectUploadItem(uploadId);
    this.render();
    if (!isNarrow()) return;
    var card = this.panes[side].querySelector('.ump__preview-card');
    if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  DualUpload.prototype.setActive = function(side) {
    if (!this.engines[side] || side === this.active) return;
    this.active = side;
    this.render();
    // The pane was hidden: let the engine measure its sheet preview again.
    this.engines[side].render();
  };

  DualUpload.prototype.scheduleRender = function() {
    if (this.renderQueued) return;
    this.renderQueued = true;
    var self = this;
    var run = function() {
      if (!self.renderQueued) return;
      self.renderQueued = false;
      self.render();
    };
    // A frame while the page is visible; the timer covers background tabs,
    // which get no frames while a long batch keeps uploading.
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(run);
    setTimeout(run, 120);
  };

  // ── Per-product state read from the engines ──────────────────────────────

  DualUpload.prototype.isExact = function(side) {
    var engine = this.engines[side];
    return Boolean(engine && engine.isExactMeasuredMode());
  };

  // Short text for the tab, long text for its tooltip.
  DualUpload.prototype.rateHint = function(side) {
    var engine = this.engines[side];
    var pricing = engine && engine.customerPricing;
    if (pricing && pricing.status === 'loading') return { short: '…', long: 'Checking your price' };
    if (this.isExact(side) && pricing && pricing.pricePerInch > 0) {
      var rate = formatMoney(pricing.pricePerInch, this.currency);
      return { short: rate + '/in', long: 'Your rate: ' + rate + ' per inch, billed by measured length' };
    }
    var first = engine ? engine.getVariantPrice(this.products[side].firstVariantId) : 0;
    var from = first > 0 ? 'from ' + formatMoney(first, this.currency) : '';
    return { short: from, long: from ? 'Sheets ' + from : '' };
  };

  DualUpload.prototype.exactQuoteItem = function(engine, uploadId) {
    var quote = engine.quote || {};
    if (quote.status !== 'ready' || !quote.data) return null;
    var items = Array.isArray(quote.data.items) ? quote.data.items : [];
    for (var i = 0; i < items.length; i += 1) {
      if (items[i] && String(items[i].uploadId) === String(uploadId)) return items[i];
    }
    return null;
  };

  // One summary row per file, with the price this product will charge.
  DualUpload.prototype.collectRows = function() {
    var rows = [];
    this.sides.forEach(function(side) {
      var engine = this.engines[side];
      var exact = this.isExact(side);
      engine.getQueueItems().forEach(function(item) {
        if (!item || !(item.uploadId || item.fileName)) return;
        var ready = engine.isCartReadyItem(item);
        var copies = Math.max(1, Number(item.copies) || 1);
        var row = {
          side: side,
          uploadId: item.uploadId || '',
          fileName: item.fileName || 'Gang sheet',
          thumb: item.thumbnailUrl || item.localPreviewUrl || '',
          widthIn: toNumber(item.widthIn),
          heightIn: toNumber(item.heightIn),
          copies: copies,
          ready: ready,
          failed: item.status === 'error',
          price: null,
          inches: 0,
          detail: ''
        };
        if (ready && exact) {
          var quoted = this.exactQuoteItem(engine, item.uploadId);
          if (quoted) {
            row.price = toNumber(quoted.totalPrice);
            row.inches = toNumber(quoted.billableLengthIn);
            row.detail = formatInches(row.inches) + ' billed · ' +
              formatMoney(toNumber(quoted.pricePerInch), this.currency) + '/in';
          } else {
            row.detail = 'Calculating your price…';
          }
        } else if (ready) {
          var line = engine.computeCartTotal([item]).lines[0];
          if (line) {
            row.price = toNumber(line.subtotal);
            var sheet = String(line.sheetLabel || '').trim();
            row.detail = (sheet ? 'Sheet ' + sheet : 'Sheet') + (copies > 1 ? ' × ' + copies : '');
            var sheetLength = sheet.match(/x\s*([\d.]+)/i);
            row.inches = sheetLength ? toNumber(sheetLength[1]) * line.sheets : 0;
          }
        }
        rows.push(row);
      }, this);
    }, this);
    return rows;
  };

  DualUpload.prototype.readySides = function() {
    return this.sides.filter(function(side) {
      return this.engines[side].getReadyItems().length > 0;
    }, this);
  };

  DualUpload.prototype.isWorking = function() {
    return this.sides.some(function(side) {
      return this.engines[side].state && this.engines[side].state.status === 'uploading';
    }, this);
  };

  DualUpload.prototype.composeNote = function(rows) {
    var lines = [];
    var general = String(this.notes.__general || '').trim();
    if (general) lines.push(general);
    rows.forEach(function(row) {
      if (!row.ready) return;
      var note = String(this.notes[row.uploadId] || '').trim();
      if (!note) return;
      lines.push('[' + SHORT_LABELS[row.side] + '] ' + row.fileName + ' (' +
        row.widthIn.toFixed(2) + ' x ' + row.heightIn.toFixed(2) + ' in' +
        (row.copies > 1 ? ' x' + row.copies : '') + '): ' + note);
    }, this);
    return lines.join('\n');
  };

  // ── Render ───────────────────────────────────────────────────────────────

  DualUpload.prototype.render = function() {
    var self = this;
    var rows = this.collectRows();
    var counts = {};
    rows.forEach(function(row) { counts[row.side] = (counts[row.side] || 0) + 1; });

    this.sides.forEach(function(side) {
      var tab = self.root.querySelector('[data-ulx-side="' + side + '"]');
      var isActive = side === self.active;
      var hint = self.rateHint(side);
      if (tab) {
        tab.classList.toggle('is-active', isActive);
        tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
        tab.setAttribute('tabindex', isActive ? '0' : '-1');
        tab.title = hint.long;
      }
      var rate = self.root.querySelector('[data-ulx-rate="' + side + '"]');
      if (rate) rate.textContent = hint.short;
      var count = self.root.querySelector('[data-ulx-count="' + side + '"]');
      if (count) {
        count.hidden = !counts[side];
        count.textContent = counts[side] ? String(counts[side]) : '';
        count.setAttribute('aria-label', counts[side] ? counts[side] + (counts[side] === 1 ? ' file' : ' files') : '');
      }
      self.panes[side].hidden = !isActive;
    });

    var hasRows = rows.length > 0;
    this.root.classList.toggle('has-rows', hasRows);
    this.root.classList.toggle('is-preview', hasRows && this.previewOpen);
    this.root.setAttribute('data-active', this.active);
    this.root.setAttribute('data-drop-label', 'Drop to upload as ' + SHORT_LABELS[this.active]);
    this.orderCard.hidden = !hasRows;
    // Never rebuild the rows under a customer who is typing a note.
    if (!this.focusedNote()) this.renderRows(rows);
    this.renderGeneral();
    this.renderTotals(rows);
    this.renderActions(rows);
  };

  // One dense row per file: thumb, name, size and billing on a second line,
  // copies, price, note and remove. The note field opens on demand.
  DualUpload.prototype.renderRows = function(rows) {
    var self = this;
    var activeState = this.engines[this.active] && this.engines[this.active].state;
    var selectedId = activeState ? String(activeState.uploadId || '') : '';
    this.rowsEl.innerHTML = rows.map(function(row) {
      var id = escapeHtml(row.uploadId);
      var name = escapeHtml(row.fileName);
      var size = row.widthIn && row.heightIn
        ? formatInches(row.widthIn) + ' × ' + formatInches(row.heightIn)
        : '';
      var state = row.failed
        ? 'Upload failed. Remove it and upload again.'
        : (row.ready ? row.detail : (row.uploadId ? 'Measuring…' : 'Uploading…'));
      var note = String(self.notes[row.uploadId] || '').trim();
      var canNote = row.ready && Boolean(row.uploadId);
      var noteOpen = canNote && Boolean(self.openNotes[row.uploadId]);
      var classes = 'ulx__row' +
        (row.failed ? ' is-failed' : (row.ready ? '' : ' is-busy')) +
        (row.side === self.active && row.uploadId && String(row.uploadId) === selectedId ? ' is-selected' : '') +
        (noteOpen ? ' is-noting' : '');
      var thumbStyle = row.thumb
        ? ' style="background-image:url(&quot;' + escapeHtml(row.thumb.replace(/"/g, '%22')) + '&quot;)"'
        : '';
      var open = row.ready ? '' : ' disabled';
      var meta = '<b class="ulx__badge ulx__badge--' + row.side + '">' + SHORT_LABELS[row.side] + '</b>' +
        (size ? '<span>' + escapeHtml(size) + '</span>' : '') +
        (state ? '<span>' + escapeHtml(state) + '</span>' : '') +
        (note && !noteOpen ? '<span class="ulx__row-note">“' + escapeHtml(note) + '”</span>' : '');
      var tools = row.ready
        ? '<span class="ulx__qty" role="group" aria-label="Copies of ' + name + '">' +
            '<button type="button" data-ulx-step="-1" aria-label="One copy less"' + (row.copies <= 1 ? ' disabled' : '') + '>−</button>' +
            '<span>' + row.copies + '</span>' +
            '<button type="button" data-ulx-step="1" aria-label="One copy more">+</button>' +
          '</span>' +
          '<strong class="ulx__price">' + (row.price != null ? escapeHtml(formatMoney(row.price, self.currency)) : '…') + '</strong>'
        : '';
      var noteBtn = canNote
        ? '<button class="ulx__icon ulx__note-btn' + (note ? ' has-note' : '') + '" type="button" data-ulx-note-toggle aria-expanded="' + noteOpen +
            '" aria-label="Note for ' + name + '" title="' + (note ? 'Edit note' : 'Add a note') + '">' + PENCIL_ICON + '</button>'
        : '';
      var noteInput = noteOpen
        ? '<input class="ulx__note" type="text" maxlength="' + NOTE_MAX + '" data-ulx-note="' + id + '" value="' +
            escapeHtml(self.notes[row.uploadId] || '') + '" placeholder="Note for this file" aria-label="Note for ' + name + '">'
        : '';
      return '' +
        '<li class="' + classes + '" data-ulx-row="' + id + '" data-side="' + row.side + '">' +
          '<button class="ulx__thumb" type="button" data-ulx-open' + open + thumbStyle + ' aria-label="Preview ' + name + '"></button>' +
          '<button class="ulx__file" type="button" data-ulx-open' + open + ' title="' + name + '">' + name + '</button>' +
          '<p class="ulx__meta">' + meta + '</p>' +
          tools + noteBtn +
          (row.uploadId ? '<button class="ulx__icon ulx__remove" type="button" data-ulx-remove aria-label="Remove ' + name + '">×</button>' : '') +
          noteInput +
        '</li>';
    }).join('');
  };

  DualUpload.prototype.renderGeneral = function() {
    var note = String(this.notes.__general || '').trim();
    this.generalNote.hidden = !this.generalOpen;
    this.generalToggle.setAttribute('aria-expanded', this.generalOpen ? 'true' : 'false');
    this.generalToggle.classList.toggle('has-note', Boolean(note) && !this.generalOpen);
    this.generalToggle.textContent = this.generalOpen
      ? 'Hide order note'
      : note ? 'Order note: ' + note : '+ Add an order note';
  };

  DualUpload.prototype.renderTotals = function(rows) {
    var self = this;
    var grand = 0;
    var pending = false;
    var files = 0;
    var parts = this.sides.map(function(side) {
      var sideRows = rows.filter(function(row) { return row.side === side && row.ready; });
      if (!sideRows.length) return '';
      var sum = 0;
      var inches = 0;
      sideRows.forEach(function(row) {
        if (row.price == null) pending = true;
        sum += row.price || 0;
        inches += row.inches || 0;
      });
      grand += sum;
      files += sideRows.length;
      return '' +
        '<span class="ulx__sum">' +
          '<b class="ulx__badge ulx__badge--' + side + '">' + SHORT_LABELS[side] + '</b>' +
          '<span>' + sideRows.length + (sideRows.length === 1 ? ' file' : ' files') +
            (inches > 0 ? ' · ' + escapeHtml(formatInches(inches)) : '') + '</span>' +
          '<strong>' + escapeHtml(formatMoney(sum, self.currency)) + '</strong>' +
        '</span>';
    }).join('');
    this.subtotalsEl.innerHTML = parts;
    this.grandEl.textContent = files ? (pending ? 'Calculating…' : formatMoney(grand, this.currency)) : '—';
    var exact = this.readySides().some(this.isExact, this);
    this.grandMetaEl.textContent = !files
      ? ''
      : exact
        ? 'Billed by measured length at your rate. Taxes and shipping at checkout.'
        : 'Taxes and shipping at checkout.';
    this.totalPending = pending;
  };

  DualUpload.prototype.renderActions = function(rows) {
    var ready = this.readySides();
    var modes = {};
    ready.forEach(function(side) { modes[this.isExact(side) ? 'exact' : 'standard'] = true; }, this);
    var mixed = Boolean(modes.exact && modes.standard);
    var exact = Boolean(modes.exact) && !mixed;
    var readyCount = rows.filter(function(row) { return row.ready; }).length;
    // Until each product's price context has loaded we do not know whether this
    // customer checks out at a special rate or through the normal cart.
    var pricingLoading = this.sides.some(function(side) {
      var pricing = this.engines[side].customerPricing;
      return !pricing || pricing.status === 'loading';
    }, this);
    var status = '';
    if (mixed) status = 'Your special rate covers only one of these products. Please check out DTF and UV separately, or contact us.';
    else if (this.isWorking()) status = 'Wait until every file is measured.';
    else if (readyCount && (pricingLoading || (exact && this.totalPending))) status = 'Calculating your price…';
    var blocked = this.busy || !readyCount || mixed || pricingLoading || this.isWorking() || (exact && this.totalPending);

    this.addBtn.hidden = exact;
    this.addBtn.disabled = blocked;
    this.addBtn.textContent = this.busy && !exact ? 'Adding…' : 'Add to cart';
    this.checkoutBtn.hidden = !exact && !this.enableCheckout;
    this.checkoutBtn.disabled = blocked;
    this.checkoutBtn.textContent = this.busy
      ? (exact ? 'Opening checkout…' : 'Checkout')
      : exact && readyCount
        ? 'Checkout ' + readyCount + (readyCount === 1 ? ' file' : ' files')
        : 'Checkout';
    this.statusEl.hidden = !status;
    this.statusEl.textContent = status;
  };

  DualUpload.prototype.showError = function(message) {
    this.errorEl.hidden = !message;
    this.errorEl.textContent = message || '';
  };

  DualUpload.prototype.engineError = function(side) {
    var engine = this.engines[side];
    var el = engine && engine.error;
    return el && !el.hidden ? String(el.textContent || '').trim() : '';
  };

  // ── One Add to cart / Checkout for both products ─────────────────────────

  DualUpload.prototype.submit = async function(target) {
    if (this.busy) return;
    var ready = this.readySides();
    if (!ready.length) return;
    var exact = ready.every(this.isExact, this);
    var mixed = !exact && ready.some(this.isExact, this);
    if (mixed) return;
    this.showError('');
    this.busy = true;
    this.render();
    var rows = this.collectRows();
    var note = this.composeNote(rows);
    var submittedIds = rows.filter(function(row) { return row.ready && row.uploadId; })
      .map(function(row) { return String(row.uploadId); });
    var navigating = false;
    try {
      navigating = exact
        ? await this.checkoutExact(ready, note)
        : await this.addStandard(ready, note, target);
    } catch (error) {
      this.showError(error && error.message ? error.message : 'Something went wrong. Please try again.');
    }
    // On success the page is already leaving: keep the buttons locked.
    if (navigating) {
      this.forgetSubmittedNotes(submittedIds);
      return;
    }
    this.busy = false;
    this.render();
  };

  // Mirrors the engine, which forgets uploads once the cart owns them: their
  // notes and the order note go too, so the next order starts clean. Uploads
  // the engine still lists keep their notes.
  DualUpload.prototype.forgetSubmittedNotes = function(submittedIds) {
    var listed = {};
    this.collectRows().forEach(function(row) {
      if (row.uploadId) listed[String(row.uploadId)] = true;
    });
    var forgotten = submittedIds.filter(function(id) { return !listed[id]; });
    if (!forgotten.length) return;
    forgotten.forEach(function(id) { delete this.notes[id]; }, this);
    delete this.notes.__general;
    this.saveNotes();
  };

  // Standard customers: each engine adds its own verified lines under the
  // shared cart lock; only the last one redirects. The composed note goes
  // with the first engine's add.
  DualUpload.prototype.addStandard = async function(ready, note, target) {
    ready.forEach(function(side, index) {
      var input = this.engines[side].orderNoteInput;
      if (input) input.value = index === 0 ? note : '';
    }, this);
    for (var i = 0; i < ready.length; i += 1) {
      var last = i === ready.length - 1;
      var ok = await this.engines[ready[i]].addToCart(target, last ? null : { noRedirect: true });
      if (!ok) {
        this.showError(this.engineError(ready[i]) || 'Some gang sheets could not be added to the cart. Please try again.');
        return false;
      }
    }
    return true;
  };

  // Special-rate customers: one Shopify draft-order checkout for every file of
  // both products. The saved exact cart is replaced by exactly what this
  // summary shows, so nothing saved elsewhere is billed by surprise.
  DualUpload.prototype.checkoutExact = async function(ready, note) {
    var entries = [];
    ready.forEach(function(side) {
      entries = entries.concat(this.engines[side].currentExactEntries());
    }, this);
    var engine = this.engines[ready[ready.length - 1]];
    if (ready.length > 1 && !engine.exactCartStorageEnabled) {
      this.showError('Your browser is blocking site storage, so DTF and UV cannot be checked out together. Please check out each product separately.');
      return false;
    }
    engine.writeExactCart(entries);
    engine.checkoutNoteOverride = note;
    await engine.handleExactMeasuredCheckout('/checkout');
    // The engine reports its own failures; with none, the invoice is opening.
    var failure = this.engineError(ready[ready.length - 1]);
    if (failure) this.showError(failure);
    return !failure;
  };

  function init() {
    if (typeof window.ULMainProductUpload !== 'function') return;
    document.querySelectorAll(ROOT_SELECTOR).forEach(function(root) {
      if (root.dataset.ulxInitialized === 'true') return;
      root.dataset.ulxInitialized = 'true';
      new DualUpload(root);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  // Both scripts are deferred in order; 'load' covers a theme that reorders them.
  window.addEventListener('load', init);
  document.addEventListener('shopify:section:load', init);
})();
