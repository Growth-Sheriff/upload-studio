/**
 * DTF Transfer By Size — Upload + Modal + Price Calculator
 * =========================================================
 * Adapted from nosendgithubfortaslakexcentions taslak.
 * Upload pipeline: api.upload.intent → signed URL → api.upload.complete → poll status
 *
 * Version: 1.0.0
 */
(function() {
  if (window.DtfUploadBlockInitialized) return;
  window.DtfUploadBlockInitialized = true;

  /* ─────────────────────────────────────────────
     FitCheck Mockup SVG Data (from taslak)
     ───────────────────────────────────────────── */
  var FITCHECK_MOCKUPS = [
    {
      id: 'tshirt', name: 'T-Shirt', placement: 'Full Front',
      svg: '<svg viewBox="0 0 200 250" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"><defs><filter id="fabric-ts"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" result="noise" /><feColorMatrix type="matrix" values="0 0 0 0 0   0 0 0 0 0   0 0 0 0 0   0 0 0 0.05 0" in="noise" result="coloredNoise" /><feBlend in="SourceGraphic" in2="coloredNoise" mode="darken" /></filter><linearGradient id="ts-grad" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="#000" stop-opacity="0.3"/><stop offset="10%" stop-color="#fff" stop-opacity="0.1"/><stop offset="30%" stop-color="#000" stop-opacity="0.0"/><stop offset="70%" stop-color="#000" stop-opacity="0.0"/><stop offset="90%" stop-color="#fff" stop-opacity="0.1"/><stop offset="100%" stop-color="#000" stop-opacity="0.3"/></linearGradient></defs><g filter="url(#fabric-ts)"><path d="M60,20 C75,20 85,35 100,35 C115,35 125,20 140,20 L185,45 L170,95 L145,75 L145,230 C145,235 140,240 135,240 L65,240 C60,240 55,235 55,230 L55,75 L30,95 L15,45 Z" fill="currentColor"/><path d="M60,20 C75,20 85,35 100,35 C115,35 125,20 140,20 L185,45 L170,95 L145,75 L145,230 C145,235 140,240 135,240 L65,240 C60,240 55,235 55,230 L55,75 L30,95 L15,45 Z" fill="url(#ts-grad)"/><path d="M60,20 C75,35 125,35 140,20 C125,45 75,45 60,20 Z" fill="#000" opacity="0.2"/></g></svg>',
      printArea: { top: 25, left: 50, width: 35, maxInches: 12 }
    },
    {
      id: 'hat', name: 'Hat', placement: 'Front Panel',
      svg: '<svg viewBox="0 0 200 200" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"><defs><filter id="fabric-hat"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" result="noise" /><feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.05 0" in="noise" result="coloredNoise" /><feBlend in="SourceGraphic" in2="coloredNoise" mode="darken" /></filter><radialGradient id="hat-grad" cx="50%" cy="30%" r="70%"><stop offset="0%" stop-color="#fff" stop-opacity="0.4"/><stop offset="100%" stop-color="#000" stop-opacity="0.4"/></radialGradient></defs><g filter="url(#fabric-hat)"><path d="M40,120 C40,50 70,30 100,30 C130,30 160,50 160,120 Z" fill="currentColor"/><path d="M40,120 C40,50 70,30 100,30 C130,30 160,50 160,120 Z" fill="url(#hat-grad)"/><path d="M15,120 C60,90 140,90 185,120 C195,145 160,170 100,170 C40,170 5,145 15,120 Z" fill="currentColor"/><path d="M40,120 C70,105 130,105 160,120" fill="none" stroke="#000" stroke-opacity="0.3" stroke-width="2"/><circle cx="100" cy="30" r="6" fill="currentColor"/><circle cx="100" cy="30" r="6" fill="#000" opacity="0.2"/></g></svg>',
      printArea: { top: 35, left: 50, width: 25, maxInches: 5 }
    },
    {
      id: 'polo', name: 'Polo', placement: 'Left Chest',
      svg: '<svg viewBox="0 0 200 250" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"><defs><filter id="fabric-polo"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" result="noise" /><feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.06 0" in="noise" result="coloredNoise" /><feBlend in="SourceGraphic" in2="coloredNoise" mode="darken" /></filter></defs><g filter="url(#fabric-polo)"><path d="M60,25 C75,25 85,40 100,40 C115,40 125,25 140,25 L185,50 L170,100 L145,80 L145,235 C145,240 140,245 135,245 L65,245 C60,245 55,240 55,235 L55,80 L30,100 L15,50 Z" fill="currentColor"/><path d="M60,25 L85,40 L100,20 L115,40 L140,25 Z" fill="currentColor"/><path d="M60,25 L85,40 L100,20 L115,40 L140,25 Z" fill="#fff" opacity="0.1"/><circle cx="100" cy="55" r="2.5" fill="#fff" stroke="#000" stroke-width="0.5"/><circle cx="100" cy="75" r="2.5" fill="#fff" stroke="#000" stroke-width="0.5"/></g></svg>',
      printArea: { top: 30, left: 65, width: 15, maxInches: 4 }
    },
    {
      id: 'tote', name: 'Tote Bag', placement: 'Center',
      svg: '<svg viewBox="0 0 200 250" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"><defs><filter id="fabric-tote"><feTurbulence type="fractalNoise" baseFrequency="1.2" numOctaves="4" result="noise" /><feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.08 0" in="noise" result="coloredNoise" /><feBlend in="SourceGraphic" in2="coloredNoise" mode="darken" /></filter></defs><g filter="url(#fabric-tote)"><path d="M70,80 C70,5 130,5 130,80" fill="none" stroke="currentColor" stroke-width="8"/><path d="M35,80 L165,80 L175,230 C175,235 170,240 165,240 L35,240 C30,240 25,235 25,230 Z" fill="currentColor"/><path d="M70,80 C70,15 130,15 130,80" fill="none" stroke="currentColor" stroke-width="8"/><path d="M70,80 C70,15 130,15 130,80" fill="none" stroke="#fff" stroke-opacity="0.2" stroke-width="8"/></g></svg>',
      printArea: { top: 45, left: 50, width: 40, maxInches: 10 }
    },
    {
      id: 'hoodie', name: 'Hoodie', placement: 'Full Front',
      svg: '<svg viewBox="0 0 200 250" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"><defs><filter id="fabric-hoodie"><feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="3" result="noise" /><feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.05 0" in="noise" result="coloredNoise" /><feBlend in="SourceGraphic" in2="coloredNoise" mode="darken" /></filter></defs><g filter="url(#fabric-hoodie)"><path d="M65,40 C65,10 135,10 135,40 L185,65 L170,115 L145,95 L145,225 C145,230 140,235 135,235 L65,235 C60,235 55,230 55,225 L55,95 L30,115 L15,65 Z" fill="currentColor"/><path d="M80,15 C80,35 120,35 120,15 C100,0 80,15 80,15 Z" fill="#000" opacity="0.4"/><path d="M65,40 C80,60 120,60 135,40 C120,5 80,5 65,40 Z" fill="currentColor"/><path d="M65,40 C80,60 120,60 135,40" fill="none" stroke="#000" stroke-opacity="0.3" stroke-width="2.5"/><path d="M85,55 Q80,100 85,110" fill="none" stroke="#000" stroke-opacity="0.2" stroke-width="3"/><path d="M115,55 Q120,100 115,110" fill="none" stroke="#000" stroke-opacity="0.2" stroke-width="3"/></g></svg>',
      printArea: { top: 35, left: 50, width: 30, maxInches: 12 }
    },
    {
      id: 'apron', name: 'Apron', placement: 'Center',
      svg: '<svg viewBox="0 0 200 250" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"><defs><filter id="fabric-apron"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" result="noise" /><feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.06 0" in="noise" result="coloredNoise" /><feBlend in="SourceGraphic" in2="coloredNoise" mode="darken" /></filter></defs><g filter="url(#fabric-apron)"><path d="M70,40 C70,0 130,0 130,40" fill="none" stroke="currentColor" stroke-width="5"/><path d="M55,90 C25,90 5,130 5,130" fill="none" stroke="currentColor" stroke-width="5"/><path d="M145,90 C175,90 195,130 195,130" fill="none" stroke="currentColor" stroke-width="5"/><path d="M70,40 L130,40 L145,90 L165,230 C165,235 160,240 155,240 L45,240 C40,240 35,235 35,230 L55,90 Z" fill="currentColor"/><path d="M65,140 L135,140 L135,195 L65,195 Z" fill="currentColor"/><path d="M65,140 L135,140 L135,195 L65,195 Z" fill="#000" opacity="0.05"/></g></svg>',
      printArea: { top: 40, left: 50, width: 35, maxInches: 10 }
    }
  ];

  var MOCKUP_COLORS = [
    '#ffffff', '#111827', '#6b7280', '#ef4444', '#f97316',
    '#eab308', '#22c55e', '#a7f3d0', '#3b82f6', '#a855f7'
  ];

  /* ─────────────────────────────────────────────
     DtfUploadBlock Class
     ───────────────────────────────────────────── */
  function DtfUploadBlock(config) {
    this.config = config;
    this.state = 'IDLE';
    this.files = [];
    this.activeFileIndex = -1;
    this.currentTab = 'canvas';
    this.mockupColor = '#ffffff';

    this.initDOM();
    this.bindEvents();
  }

  DtfUploadBlock.prototype.initDOM = function() {
    this.root = document.getElementById('dtf-upload-root');
    this.dropzone = document.getElementById('dtf-trigger-zone');
    this.triggerBtn = this.root.querySelector('.dtf-upload-trigger');
    this.modal = document.getElementById('dtf-modal');
    this.modalBody = document.getElementById('dtf-modal-body');
    this.closeBtn = this.modal.querySelector('.dtf-modal__close');
    this.uploadsBtn = this.modal.querySelector('.dtf-modal__uploads-btn');
    this.addToCartBtn = this.modal.querySelector('.dtf-modal__add-to-cart');

    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    try {
      var formats = JSON.parse(this.config.formats || '[]');
      this.fileInput.accept = formats.map(function(f) { return '.' + f.toLowerCase(); }).join(',');
    } catch(e) {
      this.fileInput.accept = '.png,.jpg,.jpeg,.svg,.pdf,.ai,.psd,.eps';
    }
    this.fileInput.style.display = 'none';
    document.body.appendChild(this.fileInput);
  };

  DtfUploadBlock.prototype.bindEvents = function() {
    var self = this;

    this.triggerBtn.addEventListener('click', function() {
      if (self.files.length > 0) {
        self.openModal();
        self.renderState();
      } else {
        self.fileInput.click();
      }
    });

    this.dropzone.addEventListener('click', function(e) {
      if (e.target !== self.triggerBtn && !self.triggerBtn.contains(e.target)) {
        if (self.files.length > 0) {
          self.openModal();
          self.renderState();
        } else {
          self.fileInput.click();
        }
      }
    });

    this.dropzone.addEventListener('dragover', function(e) {
      e.preventDefault();
      self.dropzone.classList.add('dtf-dropzone--dragover');
    });
    this.dropzone.addEventListener('dragleave', function() {
      self.dropzone.classList.remove('dtf-dropzone--dragover');
    });
    this.dropzone.addEventListener('drop', function(e) {
      e.preventDefault();
      self.dropzone.classList.remove('dtf-dropzone--dragover');
      if (e.dataTransfer.files.length) {
        self.handleFileSelect(e.dataTransfer.files[0]);
      }
    });

    this.fileInput.addEventListener('change', function(e) {
      if (e.target.files.length) {
        self.handleFileSelect(e.target.files[0]);
        e.target.value = ''; // reset for re-upload
      }
    });

    this.closeBtn.addEventListener('click', function() { self.closeModal(); });
    this.modal.querySelector('.dtf-modal__backdrop').addEventListener('click', function() { self.closeModal(); });

    // ESC to close
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && !self.modal.hidden) {
        self.closeModal();
      }
    });

    this.addToCartBtn.addEventListener('click', function() { self.addToCart(); });

    // Uploads button — open file picker for new upload
    this.uploadsBtn.addEventListener('click', function() { self.fileInput.click(); });
  };

  /* ─────────────────────────────────────────────
     Modal Open / Close
     ───────────────────────────────────────────── */
  DtfUploadBlock.prototype.openModal = function() {
    this.modal.hidden = false;
    document.body.style.overflow = 'hidden';
    this.renderState();
  };

  DtfUploadBlock.prototype.closeModal = function() {
    this.modal.hidden = true;
    document.body.style.overflow = '';
  };

  DtfUploadBlock.prototype.renderState = function() {
    if (this.state === 'UPLOADING') {
      this.modalBody.innerHTML =
        '<div class="dtf-uploading">' +
          '<div class="dtf-uploading-box">' +
            '<p style="font-size:48px;margin:0 0 16px 0;">⬆️</p>' +
            '<h3 style="margin:0 0 8px 0;">Uploading your file...</h3>' +
            '<p id="dtf-progress-pct" style="margin:0 0 16px 0;color:var(--dtf-color-text-subdued);">0%</p>' +
            '<div class="dtf-progress"><div class="dtf-progress-bar" id="dtf-progress-bar"></div></div>' +
          '</div>' +
        '</div>';
      this.addToCartBtn.disabled = true;
    } else if (this.state === 'EDITOR' && this.files.length > 0) {
      this.renderEditor();
    } else {
      this.modalBody.innerHTML =
        '<div class="dtf-uploading">' +
          '<div class="dtf-uploading-box">' +
            '<p style="font-size:48px;margin:0 0 16px 0;">📁</p>' +
            '<h3 style="margin:0 0 8px 0;">Upload a file to get started</h3>' +
            '<p style="margin:0;color:var(--dtf-color-text-subdued);">Drag & drop or click to upload</p>' +
          '</div>' +
        '</div>';
    }
  };

  DtfUploadBlock.prototype.renderToggle = function(label, key, checked) {
    var id = 'dtf-toggle-' + key;
    return '<div class="dtf-toggle">' +
      '<span class="dtf-toggle__label">' + label + '</span>' +
      '<label class="dtf-toggle__switch">' +
        '<input type="checkbox" id="' + id + '" data-key="' + key + '"' + (checked ? ' checked' : '') + '>' +
        '<span class="dtf-toggle__track"></span>' +
        '<span class="dtf-toggle__thumb"></span>' +
      '</label>' +
    '</div>';
  };

  /* ─────────────────────────────────────────────
     File Handling — REAL upload pipeline
     Uses: api.upload.intent → signed URL PUT → api.upload.complete → poll status
     ───────────────────────────────────────────── */
  DtfUploadBlock.prototype.handleFileSelect = function(file) {
    var self = this;

    // Client-side validations
    if (file.size > this.config.maxFileMb * 1024 * 1024) {
      alert('File exceeds ' + this.config.maxFileMb + 'MB limit.');
      return;
    }

    this.openModal();
    this.state = 'UPLOADING';
    this.renderState();

    // Read preview for client-side display
    this.readFileAsDataURL(file).then(function(previewUrl) {
      // Read dimensions from image
      self.readClientDimensions(file, previewUrl, function(dims) {
        // Start real upload
        self.startRealUpload(file, previewUrl, dims);
      });
    });
  };

  DtfUploadBlock.prototype.readFileAsDataURL = function(file) {
    return new Promise(function(resolve) {
      // Only read as data URL for supported preview formats
      var previewable = /\.(png|jpe?g|webp|svg|gif)$/i.test(file.name);
      if (!previewable) {
        resolve(null);
        return;
      }
      var reader = new FileReader();
      reader.onload = function(e) { resolve(e.target.result); };
      reader.readAsDataURL(file);
    });
  };

  DtfUploadBlock.prototype.readClientDimensions = function(file, previewUrl, callback) {
    if (!previewUrl) {
      callback({ widthPx: 0, heightPx: 0, dpi: 300, widthIn: 0, heightIn: 0 });
      return;
    }
    var img = new Image();
    img.onload = function() {
      var dpi = 300; // assume 300 DPI default, will be corrected by preflight
      var widthIn = parseFloat((img.naturalWidth / dpi).toFixed(2));
      var heightIn = parseFloat((img.naturalHeight / dpi).toFixed(2));
      callback({
        widthPx: img.naturalWidth,
        heightPx: img.naturalHeight,
        dpi: dpi,
        widthIn: widthIn,
        heightIn: heightIn
      });
    };
    img.onerror = function() {
      callback({ widthPx: 0, heightPx: 0, dpi: 300, widthIn: 0, heightIn: 0 });
    };
    img.src = previewUrl;
  };

  DtfUploadBlock.prototype.startRealUpload = function(file, previewUrl, dims) {
    var self = this;
    var apiBase = this.config.apiBase || '/apps/customizer';
    var shopDomain = this.config.shopDomain;

    // Step 1: Get upload intent (signed URL)
    var intentBody = {
      shopDomain: shopDomain,
      productId: String(this.config.productId),
      mode: 'dtf',
      contentType: file.type || 'application/octet-stream',
      fileName: file.name,
      fileSize: file.size
    };

    // Add customer info if available
    if (window.ULCustomer) {
      if (window.ULCustomer.id) intentBody.customerId = String(window.ULCustomer.id);
      if (window.ULCustomer.email) intentBody.customerEmail = window.ULCustomer.email;
    }

    // Add visitor info if available
    if (window.ULVisitor) {
      if (window.ULVisitor.visitorId) intentBody.visitorId = window.ULVisitor.visitorId;
      if (window.ULVisitor.sessionId) intentBody.sessionId = window.ULVisitor.sessionId;
    }

    fetch(apiBase + '/api/upload/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(intentBody)
    })
    .then(function(res) {
      if (!res.ok) throw new Error('Intent failed: ' + res.status);
      return res.json();
    })
    .then(function(intent) {
      // Step 2: PUT file to signed URL with XHR for progress
      self.uploadToSignedUrl(intent, file, previewUrl, dims);
    })
    .catch(function(err) {
      console.error('[DTF Upload] Intent error:', err);
      alert('Upload failed: ' + err.message);
      self.state = 'IDLE';
      self.renderState();
    });
  };

  DtfUploadBlock.prototype.uploadToSignedUrl = function(intent, file, previewUrl, dims) {
    var self = this;
    var xhr = new XMLHttpRequest();
    var apiBase = this.config.apiBase || '/apps/customizer';

    xhr.upload.addEventListener('progress', function(e) {
      if (e.lengthComputable) {
        var pct = Math.round((e.loaded / e.total) * 100);
        var bar = document.getElementById('dtf-progress-bar');
        var pctEl = document.getElementById('dtf-progress-pct');
        if (bar) bar.style.width = pct + '%';
        if (pctEl) pctEl.textContent = pct + '%';
      }
    });

    xhr.addEventListener('load', function() {
      if (xhr.status >= 200 && xhr.status < 400) {
        // Step 3: Notify server upload is complete
        fetch(apiBase + '/api/upload/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uploadId: intent.uploadId,
            itemId: intent.itemId,
            key: intent.key
          })
        })
        .then(function() {
          // Create file entry with client-side dimensions
          var ratio = dims.widthIn > 0 && dims.heightIn > 0
            ? dims.widthIn / dims.heightIn
            : 1;

          self.files.push({
            file: file,
            fileName: file.name,
            previewUrl: previewUrl,
            cdnUrl: intent.publicUrl || '',
            storageKey: intent.key || '',
            uploadId: intent.uploadId,
            itemId: intent.itemId,
            widthPx: dims.widthPx,
            heightPx: dims.heightPx,
            dpi: dims.dpi,
            widthIn: dims.widthIn || 12.5,
            heightIn: dims.heightIn || 7.94,
            quantity: 1,
            removeBg: false,
            upscale: false,
            halftone: false,
            keepRatio: true,
            ratio: ratio || 1.57
          });
          self.activeFileIndex = self.files.length - 1;
          self.state = 'EDITOR';
          self.renderState();

          // Step 4: Poll for preflight results (DPI, real dimensions)
          self.pollPreflight(intent.uploadId, self.files.length - 1);
        })
        .catch(function(err) {
          console.error('[DTF Upload] Complete notify error:', err);
          // Still show editor — upload is done, preflight may come later
          self.files.push({
            file: file, fileName: file.name, previewUrl: previewUrl,
            cdnUrl: intent.publicUrl || '', uploadId: intent.uploadId,
            itemId: intent.itemId,
            widthPx: dims.widthPx, heightPx: dims.heightPx, dpi: dims.dpi,
            widthIn: dims.widthIn || 12.5, heightIn: dims.heightIn || 7.94,
            quantity: 1, removeBg: false, upscale: false, halftone: false,
            keepRatio: true, ratio: (dims.widthIn / dims.heightIn) || 1.57
          });
          self.activeFileIndex = self.files.length - 1;
          self.state = 'EDITOR';
          self.renderState();
        });
      } else {
        alert('Upload failed (HTTP ' + xhr.status + ')');
        self.state = 'IDLE';
        self.renderState();
      }
    });

    xhr.addEventListener('error', function() {
      alert('Upload failed. Please check your connection.');
      self.state = 'IDLE';
      self.renderState();
    });

    // Use upload method from intent (PUT for Bunny, POST for local)
    var method = intent.uploadMethod || 'PUT';
    xhr.open(method, intent.uploadUrl, true);

    // Set headers from intent
    if (intent.uploadHeaders) {
      var headers = intent.uploadHeaders;
      for (var key in headers) {
        if (headers.hasOwnProperty(key)) {
          xhr.setRequestHeader(key, headers[key]);
        }
      }
    }

    // Set content type
    if (method === 'PUT') {
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    }

    xhr.send(file);
  };

  /* ─────────────────────────────────────────────
     Poll Preflight — get real DPI + dimensions from worker
     ───────────────────────────────────────────── */
  DtfUploadBlock.prototype.pollPreflight = function(uploadId, fileIndex) {
    var self = this;
    var apiBase = this.config.apiBase || '/apps/customizer';
    var attempts = 0;
    var maxAttempts = 40; // 40 × 3s = 2 min timeout

    var interval = setInterval(function() {
      attempts++;
      if (attempts > maxAttempts) {
        clearInterval(interval);
        console.warn('[DTF Upload] Preflight polling timed out for', uploadId);
        return;
      }

      fetch(apiBase + '/api/upload/status/' + uploadId)
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (!data || !data.items || !data.items.length) return;

          var item = data.items[0]; // first item
          var fileEntry = self.files[fileIndex];
          if (!fileEntry) { clearInterval(interval); return; }

          // Update with server data if available
          if (item.preflightStatus && item.preflightStatus !== 'pending') {
            clearInterval(interval);

            // Update dimensions from preflight
            if (item.widthPx && item.widthPx > 0) fileEntry.widthPx = item.widthPx;
            if (item.heightPx && item.heightPx > 0) fileEntry.heightPx = item.heightPx;
            if (item.dpi && item.dpi > 0) fileEntry.dpi = item.dpi;

            // Recalculate inch dimensions with real DPI
            if (fileEntry.widthPx > 0 && fileEntry.dpi > 0) {
              fileEntry.widthIn = parseFloat((fileEntry.widthPx / fileEntry.dpi).toFixed(2));
              fileEntry.heightIn = parseFloat((fileEntry.heightPx / fileEntry.dpi).toFixed(2));
              fileEntry.ratio = fileEntry.widthIn / fileEntry.heightIn;
            }

            // Update thumbnail URL if available
            if (item.thumbnailUrl) fileEntry.previewUrl = item.thumbnailUrl;
            if (item.originalUrl) fileEntry.cdnUrl = item.originalUrl;

            // Re-render if this file is currently selected
            if (self.activeFileIndex === fileIndex && self.state === 'EDITOR') {
              self.renderEditor();
            }

            console.log('[DTF Upload] Preflight done:', fileEntry.widthIn + 'x' + fileEntry.heightIn + 'in @' + fileEntry.dpi + 'DPI');

            // Step 5: Trigger server-side mockup generation
            if (fileEntry.cdnUrl && fileEntry.uploadId) {
              self.requestMockups(fileEntry);
            }
          }
        })
        .catch(function() { /* ignore poll errors */ });
    }, 3000);
  };

  /* ─────────────────────────────────────────────
     Request Mockup Generation — enqueue job on worker
     ───────────────────────────────────────────── */
  DtfUploadBlock.prototype.requestMockups = function(file) {
    var self = this;
    var apiBase = this.config.apiBase || '/apps/customizer';
    var shopDomain = this.config.shopDomain;

    fetch(apiBase + '/api/mockup/generate?shop=' + encodeURIComponent(shopDomain), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uploadId: file.uploadId,
        shopDomain: shopDomain,
        artworkUrl: file.cdnUrl,
        artworkKey: file.storageKey || '',
        garmentTypes: ['tshirt', 'hoodie', 'polo', 'hat', 'totebag', 'apron'],
        garmentColor: this.mockupColor || '#6b7280'
      })
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.jobId) {
        console.log('[DTF Upload] Mockup job queued:', data.jobId);
        file._mockupJobId = data.jobId;
        // Poll for mockup results
        self.pollMockups(file);
      }
    })
    .catch(function(err) {
      console.warn('[DTF Upload] Mockup request failed:', err.message);
      // Non-critical — FitCheck SVGs still work as fallback
    });
  };

  DtfUploadBlock.prototype.pollMockups = function(file) {
    var self = this;
    var apiBase = this.config.apiBase || '/apps/customizer';
    var attempts = 0;
    var maxAttempts = 30; // 30 × 5s = 2.5min

    var interval = setInterval(function() {
      attempts++;
      if (attempts > maxAttempts) {
        clearInterval(interval);
        console.warn('[DTF Upload] Mockup polling timed out');
        return;
      }

      fetch(apiBase + '/api/upload/status/' + file.uploadId)
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (data && data.preflightSummary && data.preflightSummary.mockups) {
            clearInterval(interval);
            file._serverMockups = data.preflightSummary.mockups;
            console.log('[DTF Upload] Server mockups ready:', file._serverMockups.length);
            // Re-render FitCheck if active
            if (self.currentTab === 'fitcheck' && self.state === 'EDITOR') {
              self.renderEditor();
            }
          }
        })
        .catch(function() { /* ignore */ });
    }, 5000);
  };

  /* ─────────────────────────────────────────────
     Pricing — from taslak (client-side, no API)
     ───────────────────────────────────────────── */
  DtfUploadBlock.prototype.getActiveTier = function(qty) {
    var tiers = [];
    try {
      tiers = JSON.parse(this.config.tiers || '[]');
    } catch(e) {}
    if (!tiers.length) return { price_per_sqin: 0.06 };
    var found = null;
    for (var i = 0; i < tiers.length; i++) {
      var t = tiers[i];
      if (qty >= t.min_qty && (t.max_qty === null || qty <= t.max_qty)) {
        found = t;
        break;
      }
    }
    return found || tiers[0];
  };

  DtfUploadBlock.prototype.calculatePrice = function(widthIn, heightIn, qty) {
    var area = widthIn * heightIn;
    var tier = this.getActiveTier(qty);
    var unitPrice = tier.price_per_sqin;
    var total = area * qty * unitPrice;

    return {
      area: area.toFixed(2),
      unitPrice: unitPrice.toFixed(4),
      subtotal: (area * unitPrice).toFixed(2),
      total: total.toFixed(2),
      formula: area.toFixed(2) + ' in\u00B2 \u00D7 ' + qty + ' \u00D7 $' + unitPrice.toFixed(4) + ' /in\u00B2 = $' + total.toFixed(2)
    };
  };

  /* ─────────────────────────────────────────────
     Editor Renderer (from taslak — with focus preservation)
     ───────────────────────────────────────────── */
  DtfUploadBlock.prototype.renderEditor = function() {
    // Preserve focus state
    var activeEl = document.activeElement;
    var activeId = activeEl ? activeEl.id : null;
    var selStart = null, selEnd = null;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
      try { selStart = activeEl.selectionStart; selEnd = activeEl.selectionEnd; } catch(e) {}
    }

    var file = this.files[this.activeFileIndex];
    if (!file) return;

    var priceData = this.calculatePrice(file.widthIn, file.heightIn, file.quantity);

    // Validation
    var errors = [];
    if (file.widthIn > this.config.maxWidth) errors.push('Width should be less than ' + this.config.maxWidth + 'in');
    if (file.heightIn > this.config.maxHeight) errors.push('Height should be less than ' + this.config.maxHeight + 'in');
    if (file.widthIn < this.config.minWidth) errors.push('Width should be at least ' + this.config.minWidth + 'in');
    if (file.heightIn < this.config.minHeight) errors.push('Height should be at least ' + this.config.minHeight + 'in');

    this.addToCartBtn.disabled = errors.length > 0;

    // Build HTML
    var leftContent = '';
    if (this.currentTab === 'canvas') {
      leftContent =
        '<div class="dtf-canvas-wrapper">' +
          '<div class="dtf-canvas-dim-top">' + file.widthIn + 'in</div>' +
          '<div class="dtf-canvas-dim-left">' + file.heightIn + 'in</div>' +
          '<div class="dtf-canvas-box">' +
            (file.previewUrl
              ? '<img src="' + file.previewUrl + '" class="dtf-canvas-img" />'
              : '<div style="width:300px;height:200px;display:flex;align-items:center;justify-content:center;font-size:48px;">📄</div>') +
          '</div>' +
        '</div>';
    } else {
      // FitCheck — Progressive Enhancement
      // Priority: 1) Server mockups (real composites) → 2) SVG with artwork overlay (fallback)
      var self = this;
      var serverMockups = file._serverMockups || [];
      var isMockupLoading = file._mockupJobId && !serverMockups.length;
      var mockupCards = '';

      // Map server mockup garmentType → FITCHECK_MOCKUPS id for matching
      var serverMockupMap = {};
      for (var sm = 0; sm < serverMockups.length; sm++) {
        var sMockup = serverMockups[sm];
        // Normalize: server uses 'totebag', SVG array uses 'tote'
        var normalizedType = sMockup.garmentType === 'totebag' ? 'tote' : sMockup.garmentType;
        serverMockupMap[normalizedType] = sMockup;
      }

      for (var m = 0; m < FITCHECK_MOCKUPS.length; m++) {
        var mockup = FITCHECK_MOCKUPS[m];
        var serverMatch = serverMockupMap[mockup.id];

        if (serverMatch && serverMatch.url) {
          // ═══ SERVER MOCKUP (real composite from worker) ═══
          mockupCards +=
            '<div class="dtf-mockup-card dtf-mockup-card--server">' +
              '<div class="dtf-mockup-image-container">' +
                '<img src="' + serverMatch.url + '" ' +
                     'alt="' + mockup.name + ' mockup" ' +
                     'class="dtf-mockup-server-img" ' +
                     'loading="lazy" ' +
                     'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'block\';" />' +
                // Hidden SVG fallback (shows if img fails)
                '<div class="dtf-mockup-base" style="display:none;color:' + this.mockupColor + ';">' + mockup.svg + '</div>' +
              '</div>' +
              '<div class="dtf-mockup-info">' +
                '<h4>' + mockup.name + '</h4>' +
                '<p>' + mockup.placement + '</p>' +
                '<div class="dtf-mockup-dims">' + file.widthIn + 'in \u00D7 ' + file.heightIn + 'in</div>' +
                '<span class="dtf-mockup-badge-server">HD</span>' +
              '</div>' +
            '</div>';
        } else {
          // ═══ SVG FALLBACK (inline mockup + artwork overlay) ═══
          var artworkWidth = Math.min((file.widthIn / mockup.printArea.maxInches) * 100, 100);
          mockupCards +=
            '<div class="dtf-mockup-card' + (isMockupLoading ? ' dtf-mockup-card--loading' : '') + '">' +
              '<div class="dtf-mockup-image-container" style="color:' + this.mockupColor + ';">' +
                '<div class="dtf-mockup-base">' + mockup.svg + '</div>' +
                '<div class="dtf-mockup-print-area" style="top:' + mockup.printArea.top + '%;left:' + mockup.printArea.left + '%;width:' + mockup.printArea.width + '%;">' +
                  (file.previewUrl
                    ? '<img src="' + file.previewUrl + '" class="dtf-mockup-artwork" style="width:' + artworkWidth + '%;" />'
                    : '') +
                '</div>' +
                // Loading shimmer overlay when mockups are being generated
                (isMockupLoading
                  ? '<div class="dtf-mockup-shimmer"><div class="dtf-mockup-shimmer-bar"></div></div>'
                  : '') +
              '</div>' +
              '<div class="dtf-mockup-info">' +
                '<h4>' + mockup.name + '</h4>' +
                '<p>' + mockup.placement + '</p>' +
                '<div class="dtf-mockup-dims">' + file.widthIn + 'in \u00D7 ' + file.heightIn + 'in</div>' +
                (isMockupLoading
                  ? '<span class="dtf-mockup-badge-loading">Generating...</span>'
                  : '') +
              '</div>' +
            '</div>';
        }
      }

      var colorSwatches = '';
      for (var c = 0; c < MOCKUP_COLORS.length; c++) {
        var color = MOCKUP_COLORS[c];
        colorSwatches += '<button type="button" class="dtf-color-swatch' + (this.mockupColor === color ? ' active' : '') + '" style="background-color:' + color + ';" data-color="' + color + '"></button>';
      }

      var regenBtn = serverMockups.length > 0
        ? '<button type="button" class="dtf-fitcheck-regen" id="dtf-regen-mockups">\u21BB Regenerate with ' + this.mockupColor + '</button>'
        : '';

      leftContent =
        '<div class="dtf-fitcheck-layout">' +
          '<div class="dtf-fitcheck-grid">' + mockupCards + '</div>' +
          '<div class="dtf-fitcheck-colors">' +
            '<p>Change your preview items to any color below:</p>' +
            '<div class="dtf-color-swatches">' + colorSwatches + '</div>' +
            regenBtn +
          '</div>' +
        '</div>';
    }

    // Error banners
    var errorHtml = '';
    for (var e = 0; e < errors.length; e++) {
      errorHtml += '<div class="dtf-error-banner" role="alert">\u26A0 ' + errors[e] + '</div>';
    }

    // Thumbnails
    var thumbsHtml = '<button class="dtf-thumb-add" id="dtf-add-more">+</button>';
    for (var t = 0; t < this.files.length; t++) {
      var f = this.files[t];
      var tPrice = this.calculatePrice(f.widthIn, f.heightIn, f.quantity);
      var tActive = t === this.activeFileIndex ? ' active' : '';
      thumbsHtml +=
        '<div class="dtf-thumb' + tActive + '" data-file-index="' + t + '">' +
          (f.previewUrl
            ? '<img src="' + f.previewUrl + '">'
            : '<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:24px;">📄</div>') +
          '<span class="dtf-thumb-badge">' + f.quantity + '</span>' +
          '<div class="dtf-thumb-price">$' + tPrice.subtotal + '</div>' +
        '</div>';
    }

    this.modalBody.innerHTML =
      '<div class="dtf-editor-layout">' +
        '<div class="dtf-editor-left">' +
          '<div class="dtf-tabs">' +
            '<span style="font-size:13px;">Resolution: <strong>' + (file.dpi || 300) + ' DPI</strong></span>' +
            '<div class="dtf-tab-group">' +
              '<button class="dtf-tab' + (this.currentTab === 'canvas' ? ' active' : '') + '" data-tab="canvas">Canvas</button>' +
              '<button class="dtf-tab' + (this.currentTab === 'fitcheck' ? ' active' : '') + '" data-tab="fitcheck">FitCheck</button>' +
            '</div>' +
          '</div>' +
          '<div class="dtf-canvas-container' + (this.currentTab === 'fitcheck' ? ' is-fitcheck' : '') + '">' +
            leftContent +
          '</div>' +
        '</div>' +
        '<div class="dtf-editor-right">' +
          '<div class="dtf-toggles">' +
            this.renderToggle('Remove Background', 'removeBg', file.removeBg) +
            this.renderToggle('Upscale Quality', 'upscale', file.upscale) +
            this.renderToggle('Halftone', 'halftone', file.halftone) +
            this.renderToggle('Keep Aspect Ratio (' + file.ratio.toFixed(2) + ') \u267B', 'keepRatio', file.keepRatio) +
          '</div>' +
          '<div class="dtf-inputs">' +
            '<div class="dtf-input-group">' +
              '<label>WIDTH (IN)</label>' +
              '<input type="number" id="dtf-input-w" value="' + file.widthIn + '" step="0.01"' + (file.widthIn > this.config.maxWidth ? ' class="error"' : '') + '>' +
              '<span class="dtf-hint">Max is ' + this.config.maxWidth + ' in</span>' +
            '</div>' +
            '<div class="dtf-input-group">' +
              '<label>HEIGHT (IN)</label>' +
              '<input type="number" id="dtf-input-h" value="' + file.heightIn + '" step="0.01"' + (file.heightIn > this.config.maxHeight ? ' class="error"' : '') + '>' +
              '<span class="dtf-hint">Max is ' + this.config.maxHeight + ' in</span>' +
            '</div>' +
            '<div class="dtf-input-group">' +
              '<label>QUANTITY</label>' +
              '<input type="number" id="dtf-input-q" value="' + file.quantity + '" min="1" step="1">' +
            '</div>' +
          '</div>' +
          '<div class="dtf-errors">' + errorHtml + '</div>' +
          '<div class="dtf-thumbnails">' + thumbsHtml + '</div>' +
          '<div class="dtf-price-calc">' +
            '<div class="dtf-price-row"><span>Price / in\u00B2:</span> <span>$' + priceData.unitPrice + '</span></div>' +
            '<div class="dtf-price-row"><span>Total Area:</span> <span>' + priceData.area + ' in\u00B2</span></div>' +
            '<div class="dtf-price-row"><span>Price:</span> <span>' + priceData.formula + '</span></div>' +
            '<div class="dtf-price-divider"></div>' +
            '<div class="dtf-price-row dtf-price-total"><span>Total Price:</span> <span>$' + priceData.total + '</span></div>' +
          '</div>' +
        '</div>' +
      '</div>';

    this.bindEditorEvents();

    // Restore focus
    if (activeId) {
      var el = document.getElementById(activeId);
      if (el) {
        el.focus();
        if (selStart !== null) {
          try { el.setSelectionRange(selStart, selEnd); } catch(ex) {}
        }
      }
    }
  };

  /* ─────────────────────────────────────────────
     Editor Event Bindings
     ───────────────────────────────────────────── */
  DtfUploadBlock.prototype.bindEditorEvents = function() {
    var self = this;
    var file = this.files[this.activeFileIndex];
    if (!file) return;

    // Width/Height/Quantity inputs
    var inputW = document.getElementById('dtf-input-w');
    var inputH = document.getElementById('dtf-input-h');
    var inputQ = document.getElementById('dtf-input-q');

    if (inputW) inputW.addEventListener('input', function(e) {
      file.widthIn = parseFloat(e.target.value) || 0;
      if (file.keepRatio && file.ratio > 0) {
        file.heightIn = parseFloat((file.widthIn / file.ratio).toFixed(2));
      }
      self.renderEditor();
    });

    if (inputH) inputH.addEventListener('input', function(e) {
      file.heightIn = parseFloat(e.target.value) || 0;
      if (file.keepRatio && file.ratio > 0) {
        file.widthIn = parseFloat((file.heightIn * file.ratio).toFixed(2));
      }
      self.renderEditor();
    });

    if (inputQ) inputQ.addEventListener('input', function(e) {
      file.quantity = parseInt(e.target.value, 10) || 1;
      self.renderEditor();
    });

    // Tab switching
    var tabs = this.modalBody.querySelectorAll('.dtf-tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function(e) {
        self.currentTab = e.target.getAttribute('data-tab');
        self.renderEditor();
      });
    }

    // Color swatches
    var swatches = this.modalBody.querySelectorAll('.dtf-color-swatch');
    for (var s = 0; s < swatches.length; s++) {
      swatches[s].addEventListener('click', function(e) {
        self.mockupColor = e.target.getAttribute('data-color');
        self.renderEditor();
      });
    }

    // Toggles
    var toggles = this.modalBody.querySelectorAll('input[type="checkbox"][data-key]');
    for (var t = 0; t < toggles.length; t++) {
      toggles[t].addEventListener('change', function(e) {
        var key = e.target.getAttribute('data-key');
        file[key] = e.target.checked;
        if (key === 'keepRatio' && file.keepRatio && file.widthIn > 0 && file.heightIn > 0) {
          file.ratio = file.widthIn / file.heightIn;
        }
        // Trigger remove background when toggled ON
        if (key === 'removeBg' && file.removeBg && file.cdnUrl) {
          self.removeBackground(file);
        }
        self.renderEditor();
      });
    }

    // Add more button
    var addMore = document.getElementById('dtf-add-more');
    if (addMore) {
      addMore.addEventListener('click', function() { self.fileInput.click(); });
    }

    // Thumbnail selection
    var thumbItems = this.modalBody.querySelectorAll('[data-file-index]');
    for (var ti = 0; ti < thumbItems.length; ti++) {
      thumbItems[ti].addEventListener('click', function(e) {
        var idx = parseInt(e.currentTarget.getAttribute('data-file-index'), 10);
        if (!isNaN(idx) && idx >= 0 && idx < self.files.length) {
          self.activeFileIndex = idx;
          self.renderEditor();
        }
      });
    }

    // Regenerate mockups button
    var regenBtn = document.getElementById('dtf-regen-mockups');
    if (regenBtn) {
      regenBtn.addEventListener('click', function() {
        var file = self.files[self.activeFileIndex];
        if (file) {
          file._serverMockups = null;
          file._mockupJobId = null;
          self.requestMockups(file);
          self.renderEditor();
        }
      });
    }
  };

  /* ─────────────────────────────────────────────
     Add to Cart — Shopify /cart/add.js
     Uses variant from page, line item properties per spec
     ───────────────────────────────────────────── */
  DtfUploadBlock.prototype.addToCart = function() {
    var self = this;
    var readyFiles = this.files.filter(function(f) {
      return f.widthIn > 0 && f.heightIn > 0;
    });
    if (readyFiles.length === 0) return;

    this.addToCartBtn.disabled = true;
    this.addToCartBtn.innerHTML = 'Adding...';

    // Find variant ID from page
    var variantId = this.findVariantId();
    if (!variantId) {
      alert('Could not determine product variant. Please refresh the page.');
      this.addToCartBtn.disabled = false;
      this.addToCartBtn.innerHTML = 'Add To Cart';
      return;
    }

    var items = readyFiles.map(function(item) {
      return {
        id: variantId,
        quantity: item.quantity,
        properties: {
          '_file_url': item.cdnUrl || '',
          '_file_name': item.fileName,
          '_width_in': String(item.widthIn),
          '_height_in': String(item.heightIn),
          '_total_area_sqin': String((item.widthIn * item.heightIn).toFixed(2)),
          '_price_per_sqin': String(self.getActiveTier(item.quantity).price_per_sqin),
          '_remove_background': String(item.removeBg),
          '_upscale_quality': String(item.upscale),
          '_halftone': String(item.halftone),
          '_color_profile': self.config.colorProfile || 'CMYK',
          '_resolution_dpi': String(item.dpi || 300),
          '_upload_id': item.uploadId || '',
          '_mode': 'dtf_by_size'
        }
      };
    });

    fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: items })
    })
    .then(function(res) {
      if (!res.ok) throw new Error('Cart add failed');
      return res.json();
    })
    .then(function() {
      self.showToast('Added to cart!', 'success');
      self.refreshCartCount();
      self.closeModal();
    })
    .catch(function(err) {
      alert('Failed to add to cart: ' + err.message);
    })
    .finally(function() {
      self.addToCartBtn.disabled = false;
      self.addToCartBtn.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg> ' +
        'Add To Cart';
    });
  };

  DtfUploadBlock.prototype.findVariantId = function() {
    // 1. Product JSON on page
    var jsonEl = document.querySelector(
      '[data-product-json], script[type="application/json"][data-product-json], ' +
      'script#ProductJson-product-template'
    );
    if (jsonEl) {
      try {
        var data = JSON.parse(jsonEl.textContent);
        var product = data.product || data;
        var variants = product.variants || [];
        if (variants.length > 0) {
          // Check URL param
          var urlVariant = new URLSearchParams(window.location.search).get('variant');
          if (urlVariant) {
            for (var i = 0; i < variants.length; i++) {
              if (String(variants[i].id) === urlVariant) return variants[i].id;
            }
          }
          return variants[0].id;
        }
      } catch(e) {}
    }

    // 2. Hidden form input
    var hiddenInput = document.querySelector(
      'form[action*="/cart/add"] input[name="id"][type="hidden"], ' +
      'form[action*="/cart/add"] select[name="id"]'
    );
    if (hiddenInput && hiddenInput.value) {
      return parseInt(hiddenInput.value, 10);
    }

    // 3. URL parameter
    var urlParam = new URLSearchParams(window.location.search).get('variant');
    if (urlParam) return parseInt(urlParam, 10);

    return null;
  };

  /* ─────────────────────────────────────────────
     Utilities
     ───────────────────────────────────────────── */
  DtfUploadBlock.prototype.showToast = function(message, type) {
    var toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;top:20px;right:20px;z-index:999999;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:500;color:#fff;background:' + (type === 'success' ? '#22c55e' : '#ef4444') + ';box-shadow:0 4px 12px rgba(0,0,0,0.15);transition:opacity 300ms;';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(function() {
      toast.style.opacity = '0';
      setTimeout(function() { toast.remove(); }, 300);
    }, 3000);
  };

  DtfUploadBlock.prototype.refreshCartCount = function() {
    fetch('/cart.js')
      .then(function(r) { return r.json(); })
      .then(function(cart) {
        var els = document.querySelectorAll('.cart-count, .cart-count-bubble, [data-cart-count], .js-cart-count');
        for (var i = 0; i < els.length; i++) {
          els[i].textContent = cart.item_count;
        }
      })
      .catch(function() {});
  };

  /* ─────────────────────────────────────────────
     Remove Background — calls backend proxy
     ───────────────────────────────────────────── */
  DtfUploadBlock.prototype.removeBackground = function(file) {
    var self = this;
    var apiBase = this.config.apiBase || '/apps/customizer';

    if (!file.cdnUrl && !file.previewUrl) {
      this.showToast('No image URL available for background removal.', 'error');
      return;
    }

    // Store original for undo
    if (!file._originalPreviewUrl) {
      file._originalPreviewUrl = file.previewUrl;
      file._originalCdnUrl = file.cdnUrl;
    }

    file._removingBg = true;
    this.showToast('Removing background...', 'info');

    fetch(apiBase + '/api/remove-bg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl: file.cdnUrl || file.previewUrl })
    })
    .then(function(res) {
      if (!res.ok) throw new Error('Remove BG failed (HTTP ' + res.status + ')');
      return res.json();
    })
    .then(function(data) {
      file._removingBg = false;
      if (data.resultUrl) {
        file.previewUrl = data.resultUrl;
        self.showToast('Background removed!', 'success');
      } else {
        self.showToast('Background removal returned no result.', 'error');
      }
      self.renderEditor();
    })
    .catch(function(err) {
      file._removingBg = false;
      file.removeBg = false;
      console.error('[DTF Upload] Remove BG error:', err);
      self.showToast('Background removal failed: ' + err.message, 'error');
      self.renderEditor();
    });
  };

  /* ─────────────────────────────────────────────
     Fetch config fallback — get tiers from API if metafields empty
     ───────────────────────────────────────────── */
  DtfUploadBlock.prototype.fetchConfigFallback = function() {
    var self = this;
    var apiBase = this.config.apiBase || '/apps/customizer';
    var shopDomain = this.config.shopDomain;
    var productId = this.config.productId;

    // Only fetch if tiers are missing
    var hasTiers = false;
    try {
      var parsed = JSON.parse(this.config.tiers || '[]');
      hasTiers = parsed && parsed.length > 0;
    } catch(e) {}

    if (hasTiers) return; // metafields already provided tiers

    fetch(apiBase + '/api/storefront/config?shopDomain=' + encodeURIComponent(shopDomain) + '&productId=' + encodeURIComponent(productId))
      .then(function(res) { return res.json(); })
      .then(function(data) {
        // Check for DTF product config with builderConfig
        if (data && data.product && data.product.pricing) {
          // Legacy support
        }

        // Try product-config endpoint for builderConfig
        return fetch(apiBase + '/api/product-config/' + encodeURIComponent(productId) + '?shop=' + encodeURIComponent(shopDomain));
      })
      .then(function(res) { return res.json(); })
      .then(function(config) {
        if (config && config.builderConfig) {
          var bc = config.builderConfig;
          if (bc.maxWidthIn) self.config.maxWidth = bc.maxWidthIn;
          if (bc.maxHeightIn) self.config.maxHeight = bc.maxHeightIn;
          if (bc.minWidthIn) self.config.minWidth = bc.minWidthIn;
          if (bc.minHeightIn) self.config.minHeight = bc.minHeightIn;
          if (bc.colorProfile) self.config.colorProfile = bc.colorProfile;
          if (bc.maxFileSizeMb) self.config.maxFileMb = bc.maxFileSizeMb;
          if (bc.volumeDiscountTiers && bc.volumeDiscountTiers.length > 0) {
            self.config.tiers = JSON.stringify(bc.volumeDiscountTiers);
          }
          console.log('[DTF Upload] Config loaded from API:', bc);
        }
      })
      .catch(function(err) {
        console.warn('[DTF Upload] Config fallback failed:', err);
      });
  };

  /* ─────────────────────────────────────────────
     Initialization (from taslak — reads data attributes)
     ───────────────────────────────────────────── */
  function init() {
    var root = document.getElementById('dtf-upload-root');
    if (root && !root.dataset.initialized) {
      root.dataset.initialized = 'true';
      var config = {
        productId: root.dataset.productId,
        productTitle: root.dataset.productTitle || '',
        shopDomain: root.dataset.shopDomain,
        apiBase: root.dataset.apiBase || '/apps/customizer',
        maxWidth: parseFloat(root.dataset.maxWidth) || 21.75,
        maxHeight: parseFloat(root.dataset.maxHeight) || 35.75,
        minWidth: parseFloat(root.dataset.minWidth) || 1,
        minHeight: parseFloat(root.dataset.minHeight) || 1,
        maxFileMb: parseInt(root.dataset.maxFileMb, 10) || 500,
        formats: root.dataset.formats,
        tiers: root.dataset.tiers,
        colorProfile: root.dataset.colorProfile || 'CMYK',
        currency: root.dataset.currency || 'USD',
        enableFitcheck: root.dataset.enableFitcheck !== 'false'
      };
      window.dtfBlock = new DtfUploadBlock(config);
      // Fetch config from API as fallback if metafields are empty
      window.dtfBlock.fetchConfigFallback();
    }
  }

  document.addEventListener('DOMContentLoaded', init);
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 100);
  }
})();
