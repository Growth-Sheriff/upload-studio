(function(){

  if (window.Shopify && window.Shopify.designMode) {
    console.log('[UL Carousel] Disabled in theme editor');
    return;
  }

  window.ul3dData = window.ul3dData || {};

  window.slideUL3D = function(id, dir) {
    var t = document.getElementById('ulTrack-' + id);
    if (t) t.scrollBy({left: dir * 300, behavior: 'smooth'});
  };

  window.openUL3DModal = function(btn) {

    if (window.Shopify && window.Shopify.designMode) return;

    if (!btn) return;

    var c = btn.closest('.ul-carousel-card');
    var sec = btn.closest('.ul-carousel-section');

    if (!c || !sec) return;

    if (sec.dataset.designMode === 'true') return;

    var bid = sec.dataset.blockId;
    if (!bid) return;

    var modal = document.getElementById('ulModal-' + bid);
    if (!modal) return;

    if (modal.classList.contains('active')) return;

    ul3dData[bid] = {
      vid: c.dataset.variantId,
      file: null,
      size: '22x12',
      price: 12
    };

    var img = document.getElementById('ulModalImg-' + bid);
    var title = document.getElementById('ulModalTitle-' + bid);
    var price = document.getElementById('ulModalPrice-' + bid);

    if (img) img.src = c.dataset.productImage;
    if (title) title.textContent = c.dataset.productTitle;
    if (price) price.textContent = c.dataset.productPrice;

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  };

  window.closeUL3DModal = function(bid) {
    var modal = document.getElementById('ulModal-' + bid);
    if (modal) {
      modal.classList.remove('active');
    }
    document.body.style.overflow = '';
  };

  window.handleUL3DFile = function(e, bid) {
    var f = e.target.files[0];
    if (!f) return;

    if (!ul3dData[bid]) ul3dData[bid] = {};
    ul3dData[bid].file = f;

    var zone = document.getElementById('ulUploadZone-' + bid);
    var preview = document.getElementById('ulPreviewZone-' + bid);
    var previewImg = document.getElementById('ulPreviewImg-' + bid);
    var cartBtn = document.getElementById('ulCartBtn-' + bid);

    if (zone) zone.style.display = 'none';
    if (preview) preview.style.display = 'block';
    if (previewImg) previewImg.src = URL.createObjectURL(f);
    if (cartBtn) {
      cartBtn.disabled = false;
      cartBtn.textContent = 'Add to Cart';
    }
  };

  window.removeUL3DFile = function(bid) {
    if (ul3dData[bid]) ul3dData[bid].file = null;

    var zone = document.getElementById('ulUploadZone-' + bid);
    var preview = document.getElementById('ulPreviewZone-' + bid);
    var fileInput = document.getElementById('ulFileInput-' + bid);
    var cartBtn = document.getElementById('ulCartBtn-' + bid);

    if (zone) zone.style.display = '';
    if (preview) preview.style.display = 'none';
    if (fileInput) fileInput.value = '';
    if (cartBtn) {
      cartBtn.disabled = true;
      cartBtn.textContent = 'Upload design to continue';
    }
  };

  window.selectUL3DSize = function(sel, bid) {
    if (!ul3dData[bid]) ul3dData[bid] = {};
    ul3dData[bid].size = sel.value;
    ul3dData[bid].price = parseFloat(sel.options[sel.selectedIndex].dataset.price);
  };

  window.changeUL3DQty = function(bid, d) {
    var i = document.getElementById('ulQtyInput-' + bid);
    if (!i) return;
    var v = parseInt(i.value) + d;
    if (v < 1) v = 1;
    i.value = v;
  };

  window.addUL3DToCart = function(bid) {
    var btn = document.getElementById('ulCartBtn-' + bid);
    var qtyInput = document.getElementById('ulQtyInput-' + bid);

    if (!btn || !ul3dData[bid]) return;

    var qty = parseInt(qtyInput ? qtyInput.value : 1) || 1;

    btn.disabled = true;
    btn.textContent = 'Adding...';

    fetch('/cart/add.js', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        items: [{
          id: ul3dData[bid].vid,
          quantity: qty,
          properties: {

            '_ul_upload_id': 'carousel_' + Date.now(),

            'File Name': ul3dData[bid].file ? ul3dData[bid].file.name : '',
            'Sheet Size': ul3dData[bid].size,
            'Unit Price': '$' + ul3dData[bid].price,
            'Design Type': 'DTF Transfer'
          }
        }]
      })
    })
    .then(function(r) { return r.json(); })
    .then(function() {
      btn.textContent = '✓ Added!';
      setTimeout(function() {
        closeUL3DModal(bid);
        window.location.href = '/cart';
      }, 800);
    })
    .catch(function() {
      btn.disabled = false;
      btn.textContent = 'Add to Cart';
    });
  };

  document.addEventListener('click', function(e) {
    if (e.target && e.target.classList && e.target.classList.contains('ul-modal-overlay')) {
      var id = e.target.id;
      if (id && id.startsWith('ulModal-')) {
        closeUL3DModal(id.replace('ulModal-', ''));
      }
    }
  });
})();
