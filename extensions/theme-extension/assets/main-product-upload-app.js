(function() {
  var ROOT_SELECTOR = '[data-ul-main-product-upload-app]';
  var POLICY = 'main_product_roll_width';

  function parseJson(value, fallback) {
    try {
      var parsed = JSON.parse(value || '');
      return parsed == null ? fallback : parsed;
    } catch (_) {
      return fallback;
    }
  }

  function toNumber(value) {
    var parsed = Number(value);
    return isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function formatInches(value) {
    var n = toNumber(value);
    if (!n) return '--';
    return Math.abs(n - Math.round(n)) < 0.01 ? String(Math.round(n)) + '"' : n.toFixed(2) + '"';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function parseSheetSize(label) {
    var match = String(label || '').match(/(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)/);
    if (!match) return null;
    var a = parseFloat(match[1]);
    var b = parseFloat(match[2]);
    if (!(a > 0) || !(b > 0)) return null;
    return { width: a, height: b };
  }

  function getField(payload, name) {
    if (!payload || typeof payload !== 'object') return null;
    if (payload[name] != null) return payload[name];
    if (payload.metadata && typeof payload.metadata === 'object' && payload.metadata[name] != null) {
      return payload.metadata[name];
    }
    return null;
  }

  function sendUploadXhr(url, method, file, headers, onProgress, onXhr) {
    return new Promise(function(resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open(method, url, true);
      xhr.onload = function() {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error('Upload request failed with ' + xhr.status));
      };
      xhr.onerror = function() { reject(new Error('Network error while uploading')); };
      xhr.onabort = function() { reject(new Error('Upload cancelled')); };
      xhr.upload.onprogress = function(event) {
        if (event.lengthComputable && typeof onProgress === 'function') {
          onProgress(event.loaded, event.total);
        }
      };
      if (typeof onXhr === 'function') onXhr(xhr);

      if (method === 'POST') {
        var form = new FormData();
        form.append('file', file);
        if (headers && headers.__extraFields) {
          Object.keys(headers.__extraFields).forEach(function(key) {
            form.append(key, headers.__extraFields[key]);
          });
        }
        xhr.send(form);
        return;
      }

      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      if (headers) {
        Object.keys(headers).forEach(function(key) {
          xhr.setRequestHeader(key, headers[key]);
        });
      }
      xhr.send(file);
    });
  }

  function sleep(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
  }

  function getStatusPollDelay(attempt) {
    if (attempt < 6) return 350;
    if (attempt < 14) return 700;
    if (attempt < 28) return 1000;
    return 1500;
  }

  function MainProductUpload(root) {
    this.root = root;
    this.apiBase = root.getAttribute('data-api-base') || '/apps/customizer';
    this.shopDomain = root.getAttribute('data-shop-domain') || '';
    this.productId = root.getAttribute('data-product-id') || '';
    this.productTitle = root.getAttribute('data-product-title') || '';
    this.customerId = root.getAttribute('data-customer-id') || '';
    this.customerEmail = root.getAttribute('data-customer-email') || '';
    this.rollWidthIn = toNumber(root.getAttribute('data-roll-width-in')) || 22;
    this.enableCheckout = root.getAttribute('data-enable-checkout') === 'true';
    this.variants = parseJson(root.getAttribute('data-product-variants'), []);
    this.productOptions = parseJson(root.getAttribute('data-product-options'), []);
    this.token = 0;
    this.state = {
      uploadId: '',
      itemId: '',
      fileName: '',
      localPreviewUrl: '',
      originalUrl: '',
      thumbnailUrl: '',
      widthIn: 0,
      heightIn: 0,
      widthPx: 0,
      heightPx: 0,
      effectiveDpi: 0,
      documentDpi: 0,
      sizingSource: '',
      selectedResult: null,
      selectedVariantId: '',
      status: 'idle',
      items: [],
      activeItemId: '',
      batchToken: 0
    };
    this.root.__umpUpload = this;
    this.bindDom();
    this.bindEvents();
    this.render();
  }

  MainProductUpload.prototype.bindDom = function() {
    this.dropzone = this.root.querySelector('[data-ump-dropzone]');
    this.input = this.root.querySelector('[data-ump-input]');
    this.trigger = this.root.querySelector('[data-ump-upload-trigger]');
    this.statusPanel = this.root.querySelector('[data-ump-status-panel]');
    this.fileName = this.root.querySelector('[data-ump-file-name]');
    this.fileMeta = this.root.querySelector('[data-ump-file-meta]');
    this.thumb = this.root.querySelector('[data-ump-thumb]');
    this.replace = this.root.querySelector('[data-ump-replace]');
    this.cancel = this.root.querySelector('[data-ump-cancel]');
    this.retry = this.root.querySelector('[data-ump-retry]');
    this.filePills = this.root.querySelector('[data-ump-file-pills]');
    this.pillSize = this.root.querySelector('[data-ump-pill-size]');
    this.pillType = this.root.querySelector('[data-ump-pill-type]');
    this.pillMultipart = this.root.querySelector('[data-ump-pill-multipart]');
    this.progressWrap = this.root.querySelector('[data-ump-progress-wrap]');
    this.progress = this.root.querySelector('[data-ump-progress]');
    this.progressText = this.root.querySelector('[data-ump-progress-text]');
    this.queue = this.root.querySelector('[data-ump-queue]');
    this.stage = this.root.querySelector('[data-ump-stage]');
    this.stageUpload = this.root.querySelector('[data-ump-stage-upload]');
    this.stageMeasure = this.root.querySelector('[data-ump-stage-measure]');
    this.stageReady = this.root.querySelector('[data-ump-stage-ready]');
    this.stageUploadLabel = this.root.querySelector('[data-ump-stage-upload-label]');
    this.stageMeasureLabel = this.root.querySelector('[data-ump-stage-measure-label]');
    this.stageReadyLabel = this.root.querySelector('[data-ump-stage-ready-label]');
    this.badge = this.root.querySelector('[data-ump-badge]');
    this.size = this.root.querySelector('[data-ump-size]');
    this.width = this.root.querySelector('[data-ump-width]');
    this.height = this.root.querySelector('[data-ump-height]');
    this.sheetLabel = this.root.querySelector('[data-ump-sheet-label]');
    this.quality = this.root.querySelector('[data-ump-quality]');
    this.qualityBadge = this.root.querySelector('[data-ump-quality-badge]');
    this.qualityText = this.root.querySelector('[data-ump-quality-text]');
    this.method = this.root.querySelector('[data-ump-method]');
    this.sheet = this.root.querySelector('[data-ump-sheet]');
    this.art = this.root.querySelector('[data-ump-art]');
    this.artLabel = this.root.querySelector('[data-ump-art-label]');
    this.rulerTop = this.root.querySelector('[data-ump-ruler-top]');
    this.rulerSide = this.root.querySelector('[data-ump-ruler-side]');
    this.addButton = this.root.querySelector('[data-ump-add]');
    this.checkoutButton = this.root.querySelector('[data-ump-checkout]');
    this.error = this.root.querySelector('[data-ump-error]');
  };

  MainProductUpload.prototype.bindEvents = function() {
    var self = this;
    this.trigger.addEventListener('click', function(event) {
      event.preventDefault();
      self.input.click();
    });
    this.replace.addEventListener('click', function(event) {
      event.preventDefault();
      self.input.click();
    });
    if (this.cancel) {
      this.cancel.addEventListener('click', function(event) {
        event.preventDefault();
        self.cancelUpload();
      });
    }
    if (this.retry) {
      this.retry.addEventListener('click', function(event) {
        event.preventDefault();
        if (self.state.lastFile) self.startUploads([self.state.lastFile]);
      });
    }
    if (this.queue) {
      this.queue.addEventListener('click', function(event) {
        var removeButton = event.target.closest('[data-ump-remove-item]');
        if (removeButton) {
          event.preventDefault();
          self.removeUploadItem(removeButton.getAttribute('data-ump-remove-item'));
          return;
        }
        var selectButton = event.target.closest('[data-ump-select-item]');
        if (selectButton) {
          event.preventDefault();
          self.selectUploadItem(selectButton.getAttribute('data-ump-select-item'));
        }
      });
    }
    this.dropzone.addEventListener('click', function(event) {
      if (event.target === self.trigger || self.trigger.contains(event.target)) return;
      self.input.click();
    });
    this.input.addEventListener('change', function(event) {
      var files = toFileArray(event.target.files);
      event.target.value = '';
      if (files.length) self.startUploads(files);
    });
    this.dropzone.addEventListener('dragover', function(event) {
      event.preventDefault();
      self.dropzone.classList.add('is-dragover');
    });
    this.dropzone.addEventListener('dragleave', function() {
      self.dropzone.classList.remove('is-dragover');
    });
    this.dropzone.addEventListener('drop', function(event) {
      event.preventDefault();
      self.dropzone.classList.remove('is-dragover');
      var files = toFileArray(event.dataTransfer.files);
      if (files.length) self.startUploads(files);
    });
    this.addButton.addEventListener('click', function() {
      self.addToCart('/cart');
    });
    if (this.checkoutButton) {
      this.checkoutButton.addEventListener('click', function() {
        self.addToCart('/checkout');
      });
    }
  };

  MainProductUpload.prototype.setError = function(message) {
    if (!this.error) return;
    if (!message) {
      this.error.hidden = true;
      this.error.textContent = '';
      return;
    }
    this.error.hidden = false;
    this.error.textContent = message;
  };

  MainProductUpload.prototype.setProgress = function(value) {
    if (!this.progress || !this.progressWrap) return;
    this.progressWrap.hidden = !(value > 0 && value < 100);
    this.progress.style.width = Math.max(0, Math.min(100, value)) + '%';
  };

  function formatBytes(n) {
    if (!(n > 0)) return '0 B';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
    return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  function formatEta(seconds) {
    if (!isFinite(seconds) || seconds <= 0) return '';
    if (seconds < 60) return '~' + Math.ceil(seconds) + 's left';
    if (seconds < 3600) return '~' + Math.ceil(seconds / 60) + 'm left';
    return '~' + Math.ceil(seconds / 3600) + 'h left';
  }

  function extFromName(name) {
    var i = String(name || '').lastIndexOf('.');
    return i >= 0 ? String(name).substring(i + 1).toLowerCase() : '';
  }

  function toFileArray(files) {
    if (!files) return [];
    return Array.prototype.slice.call(files).filter(function(file) {
      return file && file.name;
    });
  }

  function sameUploadId(a, b) {
    return String(a || '') === String(b || '');
  }

  MainProductUpload.prototype.setProgressText = function(loaded, total) {
    if (!this.progressText) return;
    if (!(loaded > 0) || !(total > 0)) {
      this.progressText.hidden = true;
      this.progressText.textContent = '';
      return;
    }
    if (window.ULUploadTelemetry && window.ULUploadTelemetry.create) {
      if (!this.state.uploadTelemetry) {
        this.state.uploadTelemetry = window.ULUploadTelemetry.create();
      }
      var snapshot = this.state.uploadTelemetry.tick(loaded, total);
      this.progressText.hidden = false;
      this.progressText.innerHTML =
        '<span><strong>' + snapshot.loadedText + '</strong> / ' + snapshot.totalText + '</span>' +
        '<span>Your internet speed: ' + snapshot.speedText + (snapshot.etaText ? ' â€¢ ' + snapshot.etaText : '') + '</span>' +
        (snapshot.advisory ? '<span>' + snapshot.advisory + '</span>' : '');
      return;
    }
    var elapsedSec = Math.max(0.001, (Date.now() - (this.state.uploadStartTime || Date.now())) / 1000);
    var speed = loaded / elapsedSec;
    var remaining = speed > 0 ? (total - loaded) / speed : 0;
    var speedMBs = (speed / (1024 * 1024)).toFixed(1);
    this.progressText.hidden = false;
    this.progressText.innerHTML =
      '<span><strong>' + formatBytes(loaded) + '</strong> / ' + formatBytes(total) + '</span>' +
      '<span>' + speedMBs + ' MB/s' + (formatEta(remaining) ? ' • ' + formatEta(remaining) : '') + '</span>';
  };

  MainProductUpload.prototype.setStage = function(activeStage) {
    if (!this.stage) return;
    if (!activeStage) { this.stage.hidden = true; return; }
    this.stage.hidden = false;
    var stages = ['upload', 'measure', 'ready'];
    var activeIdx = stages.indexOf(activeStage);
    var self = this;
    stages.forEach(function(s, i) {
      var dot = self['stage' + s.charAt(0).toUpperCase() + s.slice(1)];
      var lbl = self['stage' + s.charAt(0).toUpperCase() + s.slice(1) + 'Label'];
      if (!dot || !lbl) return;
      dot.classList.toggle('is-active', i === activeIdx);
      dot.classList.toggle('is-done', i < activeIdx);
      lbl.classList.toggle('is-active', i === activeIdx);
      lbl.classList.toggle('is-done', i < activeIdx);
    });
  };

  MainProductUpload.prototype.cancelUpload = function() {
    if (this.state.abort) {
      try { this.state.abort(); } catch (_) {}
    }
    this.token += 1; // invalidate in-flight callbacks
    this.state.batchToken = (this.state.batchToken || 0) + 1;
    this.state.status = 'idle';
    this.state.abort = null;
    this.setProgress(0);
    this.setProgressText(0, 0);
    this.setStage(null);
    this.setError('Upload cancelled.');
    this.render();
  };

  MainProductUpload.prototype.renderFilePills = function(file, isMultipart) {
    if (!this.filePills) return;
    if (!file) { this.filePills.hidden = true; return; }
    this.filePills.hidden = false;
    if (this.pillSize) this.pillSize.textContent = formatBytes(file.size);
    if (this.pillType) {
      var ext = extFromName(file.name) || (file.type && file.type.split('/')[1]) || 'file';
      this.pillType.textContent = ext.toUpperCase();
    }
    if (this.pillMultipart) this.pillMultipart.hidden = !isMultipart;
  };

  MainProductUpload.prototype.renderQuality = function() {
    if (!this.quality || !this.qualityBadge || !this.qualityText) return;
    var dpi = this.state.effectiveDpi || this.state.documentDpi || 0;
    if (!(dpi > 0)) { this.quality.hidden = true; return; }
    this.quality.hidden = false;
    var tone, label;
    if (dpi >= 250) { tone = 'excellent'; label = 'Excellent print quality'; }
    else if (dpi >= 150) { tone = 'good'; label = 'Good print quality'; }
    else if (dpi >= 100) { tone = 'warn'; label = 'Acceptable — may show some pixelation'; }
    else { tone = 'low'; label = 'Lower DPI — may pixelate when printed'; }
    this.quality.classList.remove('is-excellent', 'is-good', 'is-warn', 'is-low');
    this.quality.classList.add('is-' + tone);
    this.qualityBadge.textContent = Math.round(dpi) + ' DPI';
    this.qualityText.textContent = label;
  };

  MainProductUpload.prototype.resetMeasurement = function(file) {
    if (this.state.abort) {
      try { this.state.abort(); } catch (_) {}
    }
    this.token += 1;
    var savedItems = this.state.items || [];
    var savedBatchToken = this.state.batchToken || 0;
    var currentPreviewIsSaved = savedItems.some(function(item) {
      return item && item.localPreviewUrl === this.state.localPreviewUrl;
    }.bind(this));
    if (this.state.localPreviewUrl) {
      if (!currentPreviewIsSaved) {
        try { URL.revokeObjectURL(this.state.localPreviewUrl); } catch (_) {}
      }
    }
    this.state = {
      uploadId: '',
      itemId: '',
      fileName: file ? file.name : '',
      lastFile: file || null,
      localPreviewUrl: file && file.type && file.type.indexOf('image/') === 0 ? URL.createObjectURL(file) : '',
      originalUrl: '',
      thumbnailUrl: '',
      widthIn: 0,
      heightIn: 0,
      widthPx: 0,
      heightPx: 0,
      effectiveDpi: 0,
      documentDpi: 0,
      sizingSource: '',
      selectedResult: null,
      selectedVariantId: '',
      status: file ? 'uploading' : 'idle',
      abort: null,
      isMultipart: false,
      uploadStartTime: 0,
      uploadEndTime: 0,
      items: savedItems,
      activeItemId: '',
      batchToken: savedBatchToken
    };
  };

  MainProductUpload.prototype.applyMeasurement = function(payload) {
    var widthIn = toNumber(getField(payload, 'widthIn'));
    var heightIn = toNumber(getField(payload, 'heightIn'));
    if (!(widthIn > 0) || !(heightIn > 0)) return false;
    this.state.widthIn = widthIn;
    this.state.heightIn = heightIn;
    this.state.widthPx = toNumber(getField(payload, 'widthPx')) || this.state.widthPx;
    this.state.heightPx = toNumber(getField(payload, 'heightPx')) || this.state.heightPx;
    this.state.effectiveDpi = toNumber(getField(payload, 'effectiveDpi')) || this.state.effectiveDpi;
    this.state.documentDpi = toNumber(getField(payload, 'documentDpi')) || this.state.documentDpi;
    this.state.sizingSource = String(getField(payload, 'sizingSource') || this.state.sizingSource || '');
    return true;
  };

  MainProductUpload.prototype.createCurrentUploadItem = function() {
    var lastFile = this.state.lastFile
      ? { name: this.state.lastFile.name || this.state.fileName || '', size: this.state.lastFile.size || 0, type: this.state.lastFile.type || '' }
      : null;
    return {
      uploadId: this.state.uploadId,
      itemId: this.state.itemId,
      fileName: this.state.fileName,
      lastFile: lastFile,
      localPreviewUrl: this.state.localPreviewUrl,
      originalUrl: this.state.originalUrl,
      thumbnailUrl: this.state.thumbnailUrl,
      widthIn: this.state.widthIn,
      heightIn: this.state.heightIn,
      widthPx: this.state.widthPx,
      heightPx: this.state.heightPx,
      effectiveDpi: this.state.effectiveDpi,
      documentDpi: this.state.documentDpi,
      sizingSource: this.state.sizingSource,
      selectedResult: this.state.selectedResult,
      selectedVariantId: this.state.selectedVariantId,
      status: this.state.status,
      isMultipart: this.state.isMultipart,
      uploadStartTime: this.state.uploadStartTime,
      uploadEndTime: this.state.uploadEndTime
    };
  };

  MainProductUpload.prototype.isCartReadyItem = function(item) {
    return Boolean(item && item.uploadId && item.selectedResult && item.selectedVariantId);
  };

  MainProductUpload.prototype.rememberCurrentUpload = function() {
    if (!this.isCartReadyItem(this.state)) return;
    var snapshot = this.createCurrentUploadItem();
    var items = (this.state.items || []).slice();
    var replaced = false;
    for (var i = 0; i < items.length; i += 1) {
      if (sameUploadId(items[i].uploadId, snapshot.uploadId)) {
        items[i] = snapshot;
        replaced = true;
        break;
      }
    }
    if (!replaced) items.push(snapshot);
    this.state.items = items;
    this.state.activeItemId = snapshot.uploadId;
  };

  MainProductUpload.prototype.getReadyItems = function() {
    var ready = (this.state.items || []).filter(this.isCartReadyItem.bind(this));
    if (this.isCartReadyItem(this.state) && !ready.some(function(item) {
      return sameUploadId(item.uploadId, this.state.uploadId);
    }.bind(this))) {
      ready.push(this.createCurrentUploadItem());
    }
    return ready;
  };

  MainProductUpload.prototype.getQueueItems = function() {
    var items = (this.state.items || []).slice();
    var hasCurrent = this.state.uploadId && items.some(function(item) {
      return sameUploadId(item.uploadId, this.state.uploadId);
    }.bind(this));
    if ((this.state.uploadId || this.state.fileName) && !hasCurrent) {
      items.push(this.createCurrentUploadItem());
    }
    return items;
  };

  MainProductUpload.prototype.loadUploadItem = function(item) {
    if (!item) return;
    this.state.uploadId = item.uploadId || '';
    this.state.itemId = item.itemId || '';
    this.state.fileName = item.fileName || '';
    this.state.lastFile = item.lastFile || null;
    this.state.localPreviewUrl = item.localPreviewUrl || '';
    this.state.originalUrl = item.originalUrl || '';
    this.state.thumbnailUrl = item.thumbnailUrl || '';
    this.state.widthIn = toNumber(item.widthIn);
    this.state.heightIn = toNumber(item.heightIn);
    this.state.widthPx = toNumber(item.widthPx);
    this.state.heightPx = toNumber(item.heightPx);
    this.state.effectiveDpi = toNumber(item.effectiveDpi);
    this.state.documentDpi = toNumber(item.documentDpi);
    this.state.sizingSource = item.sizingSource || '';
    this.state.selectedResult = item.selectedResult || null;
    this.state.selectedVariantId = String(item.selectedVariantId || '');
    this.state.status = item.status || (this.isCartReadyItem(item) ? 'ready' : 'idle');
    this.state.isMultipart = Boolean(item.isMultipart);
    this.state.uploadStartTime = item.uploadStartTime || 0;
    this.state.uploadEndTime = item.uploadEndTime || 0;
    this.state.activeItemId = item.uploadId || '';
    this.state.abort = null;
  };

  MainProductUpload.prototype.selectUploadItem = function(uploadId) {
    var item = (this.state.items || []).find(function(candidate) {
      return sameUploadId(candidate.uploadId, uploadId);
    });
    if (!item) return;
    this.loadUploadItem(item);
    this.setProgress(0);
    this.setProgressText(0, 0);
    this.setStage(null);
    this.render();
  };

  MainProductUpload.prototype.removeUploadItem = function(uploadId) {
    var removed = null;
    var items = (this.state.items || []).filter(function(item) {
      var match = sameUploadId(item.uploadId, uploadId);
      if (match) removed = item;
      return !match;
    });
    if (removed && removed.localPreviewUrl) {
      try { URL.revokeObjectURL(removed.localPreviewUrl); } catch (_) {}
    }
    this.state.items = items;
    if (sameUploadId(this.state.uploadId, uploadId)) {
      if (items.length) {
        this.loadUploadItem(items[items.length - 1]);
      } else {
        this.resetMeasurement(null);
        this.state.items = [];
      }
    }
    this.render();
  };

  MainProductUpload.prototype.renderQueue = function() {
    if (!this.queue) return;
    var items = this.getQueueItems();
    if (!items.length) {
      this.queue.hidden = true;
      this.queue.innerHTML = '';
      return;
    }
    var readyCount = items.filter(this.isCartReadyItem.bind(this)).length;
    this.queue.hidden = false;
    this.queue.innerHTML =
      '<div class="ump__queue-head">' +
        '<span>Gang sheets</span>' +
        '<strong>' + readyCount + '/' + items.length + ' ready</strong>' +
      '</div>' +
      '<div class="ump__queue-list">' +
        items.map(function(item, index) {
          var isActive = sameUploadId(item.uploadId, this.state.activeItemId || this.state.uploadId);
          var isReady = this.isCartReadyItem(item);
          var statusLabel = isReady ? 'Ready' : (item.status === 'error' ? 'Error' : (item.status === 'uploading' ? 'Uploading' : 'Measuring'));
          var sheetLabel = item.selectedResult
            ? (item.selectedResult.selectedSheetLabel || item.selectedResult.selectedVariantTitle || '')
            : '';
          var sizeText = item.widthIn && item.heightIn
            ? formatInches(item.widthIn) + ' x ' + formatInches(item.heightIn)
            : 'Measuring';
          var thumbUrl = item.thumbnailUrl || item.localPreviewUrl || '';
          return '' +
            '<div class="ump__queue-item' + (isActive ? ' is-active' : '') + '">' +
              '<button class="ump__queue-main" type="button" data-ump-select-item="' + escapeHtml(item.uploadId || '') + '">' +
                '<span class="ump__queue-index">' + (index + 1) + '</span>' +
                (thumbUrl
                  ? '<span class="ump__queue-thumb" style="background-image:url(&quot;' + escapeHtml(thumbUrl.replace(/"/g, '%22')) + '&quot;)"></span>'
                  : '<span class="ump__queue-thumb"></span>') +
                '<span class="ump__queue-copy">' +
                  '<span class="ump__queue-name">' + escapeHtml(item.fileName || 'Gang sheet') + '</span>' +
                  '<span class="ump__queue-meta">' + escapeHtml(sizeText) + (sheetLabel ? ' / ' + escapeHtml(sheetLabel) : '') + '</span>' +
                '</span>' +
                '<span class="ump__queue-status' + (isReady ? ' is-ready' : '') + '">' + escapeHtml(statusLabel) + '</span>' +
              '</button>' +
              (isReady ? '<button class="ump__queue-remove" type="button" data-ump-remove-item="' + escapeHtml(item.uploadId || '') + '" aria-label="Remove ' + escapeHtml(item.fileName || 'gang sheet') + '">Remove</button>' : '') +
            '</div>';
        }.bind(this)).join('') +
      '</div>';
  };

  MainProductUpload.prototype.getMethodText = function() {
    var source = this.state.sizingSource;
    if (source === 'document_dpi') return 'Measured from embedded document resolution.';
    if (source === 'adobe_default_dpi') return 'Measured with Adobe-compatible no-DPI handling.';
    if (source === 'sheet_width_anchor') return 'Measured against the configured roll width.';
    return this.state.uploadId ? 'Server-confirmed print size.' : 'Upload required before this product can be added to cart.';
  };

  MainProductUpload.prototype.getFallbackVariantId = function() {
    for (var i = 0; i < this.variants.length; i += 1) {
      if (this.variants[i] && this.variants[i].available !== false) {
        return String(this.variants[i].id || '');
      }
    }
    return this.variants[0] ? String(this.variants[0].id || '') : '';
  };

  MainProductUpload.prototype.parseSelectedSheet = function() {
    var label = this.state.selectedResult
      ? (this.state.selectedResult.selectedSheetLabel || this.state.selectedResult.selectedVariantTitle || '')
      : '';
    var parsed = parseSheetSize(label) || { width: this.rollWidthIn, height: Math.max(this.rollWidthIn, this.state.heightIn || 12) };
    var designLandscape = this.state.widthIn >= this.state.heightIn;
    var sheetLong = Math.max(parsed.width, parsed.height);
    var sheetShort = Math.min(parsed.width, parsed.height);
    return designLandscape
      ? { width: sheetLong, height: sheetShort, label: label || '--' }
      : { width: sheetShort, height: sheetLong, label: label || '--' };
  };

  MainProductUpload.prototype.updatePreviewGeometry = function() {
    var hasSize = this.state.widthIn > 0 && this.state.heightIn > 0;
    var sheet = this.parseSelectedSheet();
    var sheetRatio = sheet.width > 0 && sheet.height > 0 ? sheet.width / sheet.height : 1.83;
    var artW = 58;
    var artH = 34;
    if (hasSize) {
      artW = Math.max(6, Math.min(100, (this.state.widthIn / sheet.width) * 100));
      artH = Math.max(6, Math.min(100, (this.state.heightIn / sheet.height) * 100));
    }
    this.root.style.setProperty('--ump-sheet-ratio', String(Math.max(0.45, Math.min(4.5, sheetRatio))));
    this.root.style.setProperty('--ump-art-w', artW.toFixed(2) + '%');
    this.root.style.setProperty('--ump-art-h', artH.toFixed(2) + '%');
    this.rulerTop.setAttribute('data-label', formatInches(sheet.width));
    this.rulerSide.setAttribute('data-label', formatInches(sheet.height));
  };

  MainProductUpload.prototype.render = function() {
    var readyItems = this.getReadyItems();
    var queueItems = this.getQueueItems();
    var hasBlockingWork = this.state.status === 'uploading' || this.state.status === 'error';
    var ready = readyItems.length > 0 && !hasBlockingWork;
    var hasUpload = Boolean(this.state.uploadId || this.state.fileName);
    this.statusPanel.hidden = !hasUpload;
    this.fileName.textContent = this.state.fileName || 'Waiting for file';

    var fileMetaText = 'Upload a file to detect the gang sheet size.';
    if (this.state.status === 'ready') {
      var dur = (this.state.uploadEndTime && this.state.uploadStartTime)
        ? ((this.state.uploadEndTime - this.state.uploadStartTime) / 1000).toFixed(1) + 's'
        : null;
      fileMetaText = 'Ready' + (dur ? ' in ' + dur : '') + '. ' + this.getMethodText();
    } else if (this.state.status === 'uploading') {
      fileMetaText = this.state.isMultipart
        ? 'Uploading in parallel chunks (R2 multipart)...'
        : 'Uploading and measuring...';
    } else if (this.state.status === 'error') {
      fileMetaText = 'Upload failed. You can try again or pick a different file.';
    }
    this.fileMeta.textContent = fileMetaText;

    var imageUrl = this.state.thumbnailUrl || this.state.localPreviewUrl || '';
    if (imageUrl) {
      this.thumb.hidden = false;
      this.thumb.src = imageUrl;
      this.art.classList.add('has-image');
      this.art.style.backgroundImage = 'url("' + imageUrl.replace(/"/g, '%22') + '")';
    } else {
      this.thumb.hidden = true;
      this.thumb.removeAttribute('src');
      this.art.classList.remove('has-image');
      this.art.style.backgroundImage = '';
    }

    this.renderFilePills(this.state.lastFile, this.state.isMultipart);
    this.renderQueue();

    if (this.cancel) this.cancel.hidden = this.state.status !== 'uploading';
    if (this.retry) this.retry.hidden = this.state.status !== 'error';
    if (this.replace) this.replace.textContent = queueItems.length ? 'Add more' : 'Replace';

    this.size.textContent = this.state.widthIn && this.state.heightIn
      ? formatInches(this.state.widthIn) + ' x ' + formatInches(this.state.heightIn)
      : '-- x --';
    this.width.textContent = formatInches(this.state.widthIn);
    this.height.textContent = formatInches(this.state.heightIn);
    this.sheetLabel.textContent = this.state.selectedResult
      ? (this.state.selectedResult.selectedSheetLabel || this.state.selectedResult.selectedVariantTitle || '--')
      : '--';
    this.renderQuality();
    this.method.textContent = this.getMethodText();

    var badgeLabel, badgeClass;
    if (ready) { badgeLabel = 'Ready'; badgeClass = 'is-ready'; }
    else if (this.state.status === 'uploading') {
      badgeLabel = this.state.uploadId ? 'Measuring' : 'Uploading';
      badgeClass = this.state.uploadId ? 'is-measuring' : 'is-uploading';
    } else if (this.state.status === 'error') {
      badgeLabel = 'Error'; badgeClass = '';
    } else {
      badgeLabel = 'Locked'; badgeClass = '';
    }
    this.badge.textContent = badgeLabel;
    this.badge.classList.remove('is-ready', 'is-uploading', 'is-measuring');
    if (badgeClass) this.badge.classList.add(badgeClass);

    this.addButton.disabled = !ready;
    if (this.addButton) {
      var addLabel = this.addButton.getAttribute('data-default-label') || 'Add to cart';
      this.addButton.textContent = readyItems.length > 1 ? 'Add ' + readyItems.length + ' gang sheets to cart' : addLabel;
    }
    if (this.checkoutButton) this.checkoutButton.disabled = !ready;
    if (this.checkoutButton) {
      var checkoutLabel = this.checkoutButton.getAttribute('data-default-label') || 'Checkout';
      this.checkoutButton.textContent = readyItems.length > 1 ? 'Checkout with ' + readyItems.length + ' gang sheets' : checkoutLabel;
    }
    if (this.artLabel) this.artLabel.textContent = this.state.fileName || 'Upload preview';
    this.updatePreviewGeometry();
    this.root.dispatchEvent(new CustomEvent('ump:render', { detail: { instance: this } }));
  };

  MainProductUpload.prototype.performUpload = async function(file, intent, onProgress) {
    var self = this;
    // Try parallel multipart upload first if intent advertises it (R2-only, large files)
    if (intent.multipart && window.ULMultipartUploader && window.ULMultipartUploader.tryUpload) {
      this.state.isMultipart = true;
      this.render();
      try {
        var mpResult = await window.ULMultipartUploader.tryUpload(file, intent, {
          onProgress: onProgress,
          shopDomain: this.shopDomain,
        });
        if (mpResult) {
          intent.publicUrl = mpResult.fileUrl || intent.publicUrl;
          intent.storageProvider = mpResult.storageProvider;
          return;
        }
      } catch (mpErr) {
        console.warn('[UMP] multipart failed, falling back to single-shot:', mpErr && mpErr.message);
        this.state.isMultipart = false;
        this.render();
      }
    }

    var storageProvider = intent.storageProvider || 'local';
    var method = intent.uploadMethod || (storageProvider === 'local' ? 'POST' : 'PUT');
    var headers = intent.uploadHeaders || null;
    if (method === 'POST') {
      headers = { __extraFields: { key: intent.key || '', uploadId: intent.uploadId || '', itemId: intent.itemId || '' } };
    }
    var retry = intent.retryConfig || { maxRetries: 3, retryDelayMs: 1000 };
    var maxRetries = Math.max(1, Number(retry.maxRetries) || 3);
    var delay = Math.max(250, Number(retry.retryDelayMs) || 1000);
    var lastError = null;

    for (var i = 0; i < maxRetries; i += 1) {
      try {
        await sendUploadXhr(intent.uploadUrl, method, file, headers, onProgress, function(xhr) {
          self.state.abort = function() { try { xhr.abort(); } catch (_) {} };
        });
        self.state.abort = null;
        return;
      } catch (error) {
        lastError = error;
        if (String(error && error.message).indexOf('cancelled') !== -1) throw error;
        if (i < maxRetries - 1) await sleep(delay * Math.pow(2, i));
      }
    }

    if (storageProvider !== 'local') {
      await sendUploadXhr(this.apiBase + '/api/upload/local', 'POST', file, {
        __extraFields: { key: intent.key || '', uploadId: intent.uploadId || '', itemId: intent.itemId || '' }
      }, onProgress, function(xhr) {
        self.state.abort = function() { try { xhr.abort(); } catch (_) {} };
      });
      self.state.abort = null;
      return;
    }

    throw lastError || new Error('Upload failed');
  };

  MainProductUpload.prototype.startUploads = async function(files) {
    var list = toFileArray(files);
    if (!list.length) return;
    var batchToken = (this.state.batchToken || 0) + 1;
    this.state.batchToken = batchToken;
    for (var i = 0; i < list.length; i += 1) {
      if (this.state.batchToken !== batchToken) return;
      await this.startUpload(list[i], batchToken);
      if (this.state.batchToken !== batchToken) return;
      if (this.state.status === 'error') return;
    }
  };

  MainProductUpload.prototype.startUpload = async function(file, batchToken) {
    this.resetMeasurement(file);
    this.state.batchToken = batchToken || this.state.batchToken || 0;
    var currentToken = this.token;
    this.state.uploadStartTime = Date.now();
    this.state.uploadTelemetry = window.ULUploadTelemetry && window.ULUploadTelemetry.create
      ? window.ULUploadTelemetry.create()
      : null;
    this.setError('');
    this.setProgress(8);
    this.setStage('upload');
    this.render();

    try {
      var intentResponse = await fetch(this.apiBase + '/api/upload/intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopDomain: this.shopDomain,
          productId: String(this.productId),
          variantId: this.getFallbackVariantId() || null,
          mode: 'dtf',
          fileName: file.name,
          contentType: file.type || 'application/octet-stream',
          fileSize: file.size,
          customerId: this.customerId || null,
          customerEmail: this.customerEmail || null
        })
      });
      var intent = await intentResponse.json().catch(function() { return {}; });
      if (!intentResponse.ok) throw new Error(intent.error || 'Failed to create upload intent.');
      if (currentToken !== this.token) return;

      this.state.uploadId = intent.uploadId;
      this.state.itemId = intent.itemId;
      this.state.isMultipart = Boolean(intent.multipart);
      this.setProgress(18);
      this.render();
      await this.performUpload(file, intent, function(loaded, total) {
        var ratio = total > 0 ? loaded / total : 0;
        this.setProgress(18 + ratio * 52);
        this.setProgressText(loaded, total);
      }.bind(this));
      if (currentToken !== this.token) return;
      this.setProgressText(0, 0);
      this.setStage('measure');

      this.setProgress(76);
      var completeResponse = await fetch(this.apiBase + '/api/upload/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopDomain: this.shopDomain,
          uploadId: intent.uploadId,
          items: [{
            itemId: intent.itemId,
            location: 'front',
            fileUrl: intent.publicUrl || null,
            storageProvider: intent.storageProvider || 'local',
            fileSize: file.size
          }]
        })
      });
      var complete = await completeResponse.json().catch(function() { return {}; });
      if (!completeResponse.ok) throw new Error(complete.error || 'Failed to finalize upload.');
      if (currentToken !== this.token) return;

      this.setProgress(86);
      await this.pollStatus(currentToken);
      if (currentToken !== this.token) return;
      this.rememberCurrentUpload();
      this.render();
    } catch (error) {
      if (currentToken !== this.token) return;
      this.state.status = 'error';
      this.state.abort = null;
      this.setProgress(0);
      this.setProgressText(0, 0);
      this.setStage(null);
      var msg = error && error.message ? error.message : 'Upload failed.';
      if (/file too large/i.test(msg)) msg = 'File too large for this storage tier. Try a smaller file or compress.';
      else if (/unsupported file type/i.test(msg)) msg = 'Unsupported file type. PNG, JPG, WEBP, TIFF, PSD, PDF, AI, EPS and SVG are accepted.';
      else if (/network/i.test(msg)) msg = 'Network issue while uploading. Check your connection and try again.';
      this.setError(msg);
      this.render();
    }
  };

  MainProductUpload.prototype.pollStatus = async function(currentToken) {
    for (var attempt = 0; attempt < 60; attempt += 1) {
      if (currentToken !== this.token) return;
      var response = await fetch(this.apiBase + '/api/upload/status/' + encodeURIComponent(this.state.uploadId) + '?shopDomain=' + encodeURIComponent(this.shopDomain));
      if (response.ok) {
        var data = await response.json();
        var item = data.items && data.items[0] ? data.items[0] : null;
        if (item) {
          this.state.thumbnailUrl = item.thumbnailUrl || data.thumbnailUrl || this.state.thumbnailUrl || '';
          this.state.originalUrl = item.originalUrl || data.downloadUrl || this.state.originalUrl || '';
          this.applyMeasurement(item);
          var measurementStatus = item.measurementStatus || 'pending';
          var blocked = data.orderabilityStatus === 'blocked' || item.orderabilityStatus === 'blocked' || data.status === 'error';
          if (blocked || measurementStatus === 'error') {
            throw new Error((item.errors && item.errors[0]) || (data.errors && data.errors[0]) || 'Upload could not be measured.');
          }
          if (this.state.widthIn && this.state.heightIn && measurementStatus !== 'pending') {
            await this.resolveProduct();
            this.state.status = 'ready';
            this.state.uploadEndTime = Date.now();
            this.setProgress(100);
            this.setStage('ready');
            setTimeout(function() {
              if (currentToken !== this.token) return;
              this.setProgress(0);
              this.setStage(null);
              this.render();
            }.bind(this), 1200);
            this.render();
            return;
          }
        }
      }
      this.setProgress(Math.min(94, 86 + attempt));
      this.render();
      await sleep(getStatusPollDelay(attempt));
    }
    throw new Error('Upload finished, but the server did not confirm print size in time.');
  };

  MainProductUpload.prototype.resolveProduct = async function() {
    var response = await fetch(this.apiBase + '/api/upload/resolve-product', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shopDomain: this.shopDomain,
        productId: String(this.productId),
        uploadId: this.state.uploadId,
        quantity: 1,
        selectedVariantId: this.getFallbackVariantId() || null,
        measurementPolicy: POLICY,
        rollWidthIn: this.rollWidthIn,
        maxUploadWidth: this.rollWidthIn
      })
    });
    var data = await response.json().catch(function() { return {}; });
    if (data && data.upload) this.applyMeasurement(data.upload);
    if (!response.ok) throw new Error(data.error || 'No product variant can fit this upload.');
    this.state.selectedResult = data.resolution || null;
    this.state.selectedVariantId = this.state.selectedResult ? String(this.state.selectedResult.selectedVariantId || '') : '';
    if (!this.state.selectedVariantId) throw new Error('No product variant can fit this upload.');
  };

  MainProductUpload.prototype.addToCart = async function(redirectTo) {
    var readyItems = this.getReadyItems();
    if (!readyItems.length) {
      this.setError('Please upload your design first.');
      return;
    }
    if (this.state.status === 'uploading') {
      this.setError('Please wait until every gang sheet is measured.');
      return;
    }
    this.setError('');
    this.addButton.disabled = true;
    if (this.checkoutButton) this.checkoutButton.disabled = true;

    try {
      var cartItems = readyItems.map(function(item, index) {
        var result = item.selectedResult || {};
        var variantId = parseInt(item.selectedVariantId, 10);
        if (!(variantId > 0)) throw new Error('A measured gang sheet has no matching variant.');
        var quantity = Math.max(1, Number(result.cartQuantity || result.sheetsNeeded) || 1);
        var sheetLabel = result.selectedSheetLabel || result.selectedVariantTitle || '';
        return {
          id: variantId,
          quantity: quantity,
          properties: {
            _ul_upload_id: item.uploadId,
            _ul_uploaded: 'true',
            'Print READY': item.originalUrl || '',
            'Design File': item.fileName || '',
            _ul_width_in: String(item.widthIn || 0),
            _ul_height_in: String(item.heightIn || 0),
            _ul_page_width_in: String(item.widthIn || 0),
            _ul_page_length_in: String(item.heightIn || 0),
            _ul_resolution_dpi: String(item.documentDpi || 0),
            _ul_effective_dpi: String(item.effectiveDpi || 0),
            _ul_sizing_source: String(item.sizingSource || ''),
            _ul_measurement_mode: 'full',
            _ul_mode: result.pricingMode === 'linear_inches'
              ? 'main_product_linear_inches_app_extension'
              : 'main_product_sheet_app_extension',
            _ul_pricing_mode: String(result.pricingMode || ''),
            _ul_billable_length_in: result.billableLengthIn != null ? String(result.billableLengthIn) : '',
            _ul_cart_quantity: String(quantity),
            _ul_price_per_inch: result.pricePerInch != null ? String(result.pricePerInch) : '',
            _ul_selected_variant_id: String(item.selectedVariantId || ''),
            _ul_selected_variant_title: result.selectedVariantTitle || '',
            _ul_selected_sheet_label: sheetLabel,
            _ul_sheet_name: sheetLabel,
            _ul_designs_per_sheet: String(result.designsPerSheet || ''),
            _ul_sheets_needed: String(result.sheetsNeeded || ''),
            _ul_multi_index: String(index + 1),
            _ul_multi_count: String(readyItems.length)
          }
        };
      });
      var response = await fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: cartItems })
      });
      var data = await response.json().catch(function() { return {}; });
      if (!response.ok) throw new Error(data.description || 'Failed to add to cart.');
      window.location.href = redirectTo || '/cart';
    } catch (error) {
      this.setError(error && error.message ? error.message : 'Failed to add to cart.');
      this.render();
    }
  };

  function init() {
    var roots = document.querySelectorAll(ROOT_SELECTOR);
    roots.forEach(function(root) {
      if (root.dataset.umpInitialized === 'true') return;
      root.dataset.umpInitialized = 'true';
      new MainProductUpload(root);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  document.addEventListener('shopify:section:load', init);
})();
