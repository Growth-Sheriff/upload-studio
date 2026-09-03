(function() {
  'use strict';

  /**
   * Upload Studio - R2 Multipart Uploader (shared helper)
   *
   * Exposed as window.ULMultipartUploader.
   *
   * Usage:
   *   const result = await window.ULMultipartUploader.tryUpload(file, intent, {
   *     onProgress: (loaded, total) => { ... },
   *     onPartDone: (partNumber, etag) => { ... },   // persist for resume
   *     resume: { uploadedParts: [{partNumber, etag}], parts: [{partNumber, url}] },
   *     concurrency: 6,
   *     shopDomain: '<shop>',
   *   });
   *   if (result) { ... multipart succeeded ... } else { ... no multipart in intent ... }
   *
   * Throws Error on multipart failure (after part retries exhausted).
   * With `resume`, parts R2 already holds are skipped and the fresh presigned
   * URLs from /api/upload/multipart-resume replace the expired ones.
   */

  var DEFAULT_CONCURRENCY = 6;
  var PART_RETRY_MAX = 4;
  var PART_RETRY_DELAY_MS = 1200;

  function sleep(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
  }

  function putPart(url, blob, onProgress) {
    return new Promise(function(resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('PUT', url, true);
      xhr.upload.onprogress = function(ev) {
        if (ev.lengthComputable && typeof onProgress === 'function') onProgress(ev.loaded);
      };
      xhr.onload = function() {
        if (xhr.status >= 200 && xhr.status < 300) {
          var etag = xhr.getResponseHeader('ETag') || xhr.getResponseHeader('etag');
          if (!etag) { reject(new Error('R2 part response missing ETag header')); return; }
          resolve(etag.replace(/^"|"$/g, ''));
        } else {
          var err = new Error('Part upload failed: HTTP ' + xhr.status + ' ' + xhr.statusText);
          err.status = xhr.status;
          reject(err);
        }
      };
      xhr.onerror = function() { reject(new Error('Network error during part upload')); };
      xhr.onabort = function() { reject(new Error('Part upload aborted')); };
      xhr.send(blob);
    });
  }

  async function putPartWithRetry(part, blob, onProgress, maxRetries) {
    var attempt = 0;
    var lastErr = null;
    var partProgressLast = 0;
    while (attempt < maxRetries) {
      try {
        if (typeof onProgress === 'function' && partProgressLast > 0) {
          onProgress(-partProgressLast);
          partProgressLast = 0;
        }
        var trackedOnProgress = function(loaded) {
          var delta = loaded - partProgressLast;
          partProgressLast = loaded;
          if (typeof onProgress === 'function' && delta !== 0) onProgress(delta);
        };
        return await putPart(part.url, blob, trackedOnProgress);
      } catch (err) {
        attempt += 1;
        lastErr = err;
        // A 403 means the presigned URL expired — retrying the same URL is
        // pointless; let the caller resume with fresh URLs.
        if (err && err.status === 403) break;
        if (attempt >= maxRetries) break;
        await sleep(PART_RETRY_DELAY_MS * Math.pow(2, attempt - 1));
      }
    }
    throw lastErr || new Error('Part ' + part.partNumber + ' failed after retries');
  }

  async function abortMultipart(opts) {
    try {
      await fetch(opts.abortUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopDomain: opts.shopDomain, key: opts.key, multipartUploadId: opts.uploadId }),
      });
    } catch (_) {}
  }

  async function tryUpload(file, intent, options) {
    if (!intent || !intent.multipart) return null;
    var mp = intent.multipart;
    options = options || {};
    var resumedCount = options.resume && options.resume.uploadedParts ? options.resume.uploadedParts.length : 0;
    if (!mp.uploadId || !mp.completeUrl || ((!mp.parts || !mp.parts.length) && !resumedCount)) {
      console.warn('[ULMultipart] Malformed multipart info in intent, falling back');
      return null;
    }
    if (!mp.parts) mp.parts = [];
    var shopDomain = options.shopDomain || intent.shopDomain || '';
    var onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    var onPartDone = typeof options.onPartDone === 'function' ? options.onPartDone : null;
    var partSize = mp.partSize;
    var fileSize = file.size;

    // Resume: parts R2 already has are counted as done; missing parts use the
    // fresh URLs provided by the resume endpoint.
    var doneMap = {};
    var partList = mp.parts.slice();
    if (options.resume) {
      (options.resume.uploadedParts || []).forEach(function(p) { doneMap[p.partNumber] = p.etag; });
      if (options.resume.parts && options.resume.parts.length) {
        var freshByNumber = {};
        options.resume.parts.forEach(function(p) { freshByNumber[p.partNumber] = p.url; });
        partList = partList.map(function(p) {
          return freshByNumber[p.partNumber] ? { partNumber: p.partNumber, url: freshByNumber[p.partNumber] } : p;
        });
      }
    }

    var pending = partList.filter(function(p) { return !doneMap[p.partNumber]; });
    var concurrency = Math.max(1, Math.min(options.concurrency || DEFAULT_CONCURRENCY, Math.max(1, pending.length)));

    var startedAt = Date.now();
    var alreadyLoaded = 0;
    Object.keys(doneMap).forEach(function(n) {
      var start = (Number(n) - 1) * partSize;
      alreadyLoaded += Math.max(0, Math.min(start + partSize, fileSize) - start);
    });
    var totalLoaded = alreadyLoaded;
    if (onProgress) onProgress(totalLoaded, fileSize);
    var progressTick = function(delta) {
      totalLoaded = Math.max(0, totalLoaded + delta);
      if (onProgress) onProgress(totalLoaded, fileSize);
    };

    var queueIdx = 0;
    var etags = {};
    Object.keys(doneMap).forEach(function(n) { etags[n] = { partNumber: Number(n), etag: doneMap[n] }; });
    var firstError = null;

    async function worker() {
      while (true) {
        if (firstError) return;
        var idx = queueIdx++;
        if (idx >= pending.length) return;
        var part = pending[idx];
        var start = (part.partNumber - 1) * partSize;
        var end = Math.min(start + partSize, fileSize);
        var blob = file.slice(start, end);
        try {
          var etag = await putPartWithRetry(part, blob, progressTick, PART_RETRY_MAX);
          etags[part.partNumber] = { partNumber: part.partNumber, etag: etag };
          if (onPartDone) { try { onPartDone(part.partNumber, etag); } catch (_) {} }
        } catch (err) {
          if (!firstError) firstError = err;
          return;
        }
      }
    }

    var workers = [];
    for (var i = 0; i < concurrency; i++) workers.push(worker());
    await Promise.all(workers);

    if (firstError) {
      // Do NOT abort on failure: the parts that landed stay on R2 so the
      // caller can resume. The caller aborts explicitly when giving up.
      var resumable = new Error(firstError.message || 'Part upload failed');
      resumable.resumable = true;
      resumable.status = firstError.status;
      throw resumable;
    }

    var partsArray = Object.keys(etags).map(function(n) { return etags[n]; }).sort(function(a, b) { return a.partNumber - b.partNumber; });
    var completeRes = await fetch(mp.completeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shopDomain: shopDomain,
        uploadId: intent.uploadId,
        key: mp.key,
        multipartUploadId: mp.uploadId,
        parts: partsArray,
      }),
    });
    if (!completeRes.ok) {
      var errBody = await completeRes.json().catch(function() { return {}; });
      var msg = errBody.error || ('multipart complete failed: HTTP ' + completeRes.status);
      console.warn('[ULMultipart] Complete failure -> aborting multipart', msg);
      await abortMultipart({
        abortUrl: mp.abortUrl || mp.completeUrl.replace('multipart-complete', 'multipart-abort'),
        shopDomain: shopDomain,
        key: mp.key,
        uploadId: mp.uploadId,
      });
      throw new Error(msg);
    }

    var elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log('[ULMultipart] Done in ' + elapsed + 's: ' + partsArray.length + ' parts (' + pending.length + ' sent, ' + Object.keys(doneMap).length + ' resumed), concurrency=' + concurrency);

    return {
      fileUrl: mp.publicUrl,
      storageProvider: 'r2',
      partsUploaded: partsArray.length,
    };
  }

  window.ULMultipartUploader = {
    tryUpload: tryUpload,
    abort: abortMultipart,
    DEFAULT_CONCURRENCY: DEFAULT_CONCURRENCY,
  };
})();
