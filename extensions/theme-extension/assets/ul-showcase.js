(function(){

  if (window.Shopify && window.Shopify.designMode) {
    console.log('[UL Showcase] Disabled in theme editor');
    return;
  }

  window.ulShowcaseData = window.ulShowcaseData || {};

  window.openULShowcaseModal = function(btn) {

    if (window.Shopify && window.Shopify.designMode) return;

    if (!btn) return;

    var c = btn.closest('.ul-showcase-card');
    var sec = btn.closest('.ul-showcase-section');

    if (!c || !sec) return;

    if (sec.dataset.designMode === 'true') return;

    var bid = sec.dataset.blockId;
    if (!bid) return;

    var modal = document.getElementById('ulShowcaseModal-' + bid);
    if (!modal) return;

    if (modal.classList.contains('active')) return;

    ulShowcaseData[bid] = {
      pid: c.dataset.productId,
      vid: c.dataset.variantId,
      file: null,
      size: '22x12',
      price: 12
    };

    var img = document.getElementById('ulShowcaseImg-' + bid);
    var title = document.getElementById('ulShowcaseTitle-' + bid);
    var price = document.getElementById('ulShowcasePrice-' + bid);

    if (img) img.src = c.dataset.productImage;
    if (title) title.textContent = c.dataset.productTitle;
    if (price) price.textContent = c.dataset.productPrice;

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  };

  window.closeULShowcaseModal = function(bid) {
    var modal = document.getElementById('ulShowcaseModal-' + bid);
    if (modal) {
      modal.classList.remove('active');
    }
    document.body.style.overflow = '';
  };

  window.handleULShowcaseFile = function(e, bid) {
    var f = e.target.files[0];
    if (!f) return;

    if (!ulShowcaseData[bid]) ulShowcaseData[bid] = {};
    ulShowcaseData[bid].file = f;

    var zone = document.getElementById('ulShowcaseZone-' + bid);
    var preview = document.getElementById('ulShowcasePreview-' + bid);
    var previewImg = document.getElementById('ulShowcasePreviewImg-' + bid);
    var cartBtn = document.getElementById('ulShowcaseCartBtn-' + bid);

    if (zone) zone.style.display = 'none';
    if (preview) preview.style.display = 'block';
    if (previewImg) previewImg.src = URL.createObjectURL(f);
    if (cartBtn) {
      cartBtn.disabled = false;
      cartBtn.textContent = 'Add to Cart';
    }
  };

  window.removeULShowcaseFile = function(bid) {
    if (ulShowcaseData[bid]) ulShowcaseData[bid].file = null;

    var zone = document.getElementById('ulShowcaseZone-' + bid);
    var preview = document.getElementById('ulShowcasePreview-' + bid);
    var fileInput = document.getElementById('ulShowcaseFile-' + bid);
    var cartBtn = document.getElementById('ulShowcaseCartBtn-' + bid);

    if (zone) zone.style.display = '';
    if (preview) preview.style.display = 'none';
    if (fileInput) fileInput.value = '';
    if (cartBtn) {
      cartBtn.disabled = true;
      cartBtn.textContent = 'Upload design to continue';
    }
  };

  window.selectULShowcaseSize = function(sel, bid) {
    if (!ulShowcaseData[bid]) ulShowcaseData[bid] = {};
    ulShowcaseData[bid].size = sel.value;
    ulShowcaseData[bid].price = parseFloat(sel.options[sel.selectedIndex].dataset.price);
  };

  window.changeULShowcaseQty = function(bid, d) {
    var i = document.getElementById('ulShowcaseQty-' + bid);
    if (!i) return;
    var v = parseInt(i.value) + d;
    if (v < 1) v = 1;
    i.value = v;
  };

  window.addULShowcaseToCart = function(bid) {
    var btn = document.getElementById('ulShowcaseCartBtn-' + bid);
    var qtyInput = document.getElementById('ulShowcaseQty-' + bid);

    if (!btn || !ulShowcaseData[bid]) return;

    var qty = parseInt(qtyInput ? qtyInput.value : 1) || 1;

    if (!ulShowcaseData[bid].file) { alert('Please choose a design file first.'); return; }
    if (!window.ULLineProperties || !window.ULLineProperties.uploadAndBuild) { alert('Upload service is not available. Please refresh the page.'); return; }

    btn.disabled = true;
    btn.textContent = 'Uploading...';

    // Real upload through the app, then the same three line properties every
    // block writes (Print Ready, Sheet Identity, DPI).
    window.ULLineProperties.uploadAndBuild({
      file: ulShowcaseData[bid].file,
      productId: ulShowcaseData[bid].pid,
      variantId: ulShowcaseData[bid].vid
    })
    .then(function(result) {
      btn.textContent = 'Adding...';
      return fetch('/cart/add.js', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          items: [{
            id: ulShowcaseData[bid].vid,
            quantity: qty,
            properties: result.properties
          }]
        })
      });
    })
    .then(function(r) { return r.json(); })
    .then(function() {
      btn.textContent = '✓ Added!';
      setTimeout(function() {
        closeULShowcaseModal(bid);
        window.location.href = '/cart';
      }, 800);
    })
    .catch(function() {
      btn.disabled = false;
      btn.textContent = 'Add to Cart';
    });
  };

  document.addEventListener('click', function(e) {
    if (e.target && e.target.classList && e.target.classList.contains('ul-sh-modal-overlay')) {
      var id = e.target.id;
      if (id && id.startsWith('ulShowcaseModal-')) {
        closeULShowcaseModal(id.replace('ulShowcaseModal-', ''));
      }
    }
  });
})();
