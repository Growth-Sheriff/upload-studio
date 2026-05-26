(function() {
  'use strict';

  /**
   * Upload Studio - R2 Multipart Uploader (shared helper)
   *
   * Exposed as window.ULMultipartUploader.
   *
   * Usage from existing uploaders:
   *   const result = await window.ULMultipartUploader.tryUpload(file, intent, {
   *     onProgress: (loaded, total) => { ... },
   *     concurrency: 4,
   *     shopDomain: '<shop>',
   *   });
   *   if (result) {
   *     // multipart succeeded -> { fileUrl, storageProvider:'r2', partsUploaded }
   *   } else {
   *     // intent did not include multipart info -> use existing single-shot path
   *   }
   *
   * Throws Error on multipart failure (after part retries exhausted).
   * Caller may catch and fall back to single-shot path.
   */

  var DEFAULT_CONCURRENCY = 4;
  var PART_RETRY_MAX = 3;
  var PART_RETRY_DELAY_MS = 1500;

  function sleep(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
  }

  function putPart(url, blob, onProgress) {
    return new Promise(function(resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('PUT', url, true);

      xhr.upload.onprogress = function(ev) {
        if (ev.lengthComputable && typeof onProgress === 'function') {
          onProgress(ev.loaded);
        }
      };
      xhr.onload = function() {
        if (xhr.status >= 200 && xhr.status < 300) {
          var etag = xhr.getResponseHeader('ETag') || xhr.getResponseHeader('etag');
          if (!etag) {
            reject(new Error('R2 part response missing ETag header'));
            return;
          }
          // ETag is wrapped in quotes by R2/S3; keep as-is, backend re-wraps if needed.
          resolve(etag.replace(/^"|"$/g, ''));
        } else {
          reject(new Error('Part upload failed: HTTP ' + xhr.status + ' ' + xhr.statusText));
        }
      };
      xhr.onerror = function() {
        reject(new Error('Network error during part upload'));
      };
      xhr.onabort = function() {
        reject(new Error('Part upload aborted'));
      };
      xhr.send(blob);
      // Return xhr via the promise mechanism by stashing on resolved value? Not needed for now.
    });
  }

  async function putPartWithRetry(part, blob, onProgress, maxRetries) {
    var attempt = 0;
    var lastErr = null;
    var partProgressLast = 0;
    while (attempt < maxRetries) {
      try {
        // reset progress contribution from previous failed attempt
        if (typeof onProgress === 'function' && partProgressLast > 0) {
          onProgress(-partProgressLast);
          partProgressLast = 0;
        }
        var trackedOnProgress = function(loaded) {
          var delta = loaded - partProgressLast;
          partProgressLast = loaded;
          if (typeof onProgress === 'function' && delta !== 0) {
            onProgress(delta);
          }
        };
        return await putPart(part.url, blob, trackedOnProgress);
      } catch (err) {
        attempt += 1;
        lastErr = err;
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
        body: JSON.stringify({
          shopDomain: opts.shopDomain,
          key: opts.key,
          multipartUploadId: opts.uploadId,
        }),
      });
    } catch (_) {
      // best-effort cleanup; R2 lifecycle rule will GC eventually
    }
  }

  /**
   * tryUpload: if intent.multipart is present, runs the parallel multipart upload.
   * Returns { fileUrl, storageProvider, partsUploaded } on success.
   * Returns null if intent has no multipart info (caller continues single-shot path).
   * Throws on multipart-specific failure (after retries).
   */
  async function tryUpload(file, intent, options) {
    if (!intent || !intent.multipart) return null;
    var mp = intent.multipart;
    if (!mp.parts || !mp.parts.length || !mp.uploadId || !mp.completeUrl) {
      console.warn('[ULMultipart] Malformed multipart info in intent, falling back');
      return null;
    }
    options = options || {};
    var concurrency = Math.max(1, Math.min(options.concurrency || DEFAULT_CONCURRENCY, mp.parts.length));
    var shopDomain = options.shopDomain || intent.shopDomain || '';
    var onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    var partSize = mp.partSize;

    var startedAt = Date.now();
    var totalLoaded = 0;
    var fileSize = file.size;
    var progressTick = function(delta) {
      totalLoaded = Math.max(0, totalLoaded + delta);
      if (onProgress) onProgress(totalLoaded, fileSize);
    };

    // Build worker pool over parts
    var queueIdx = 0;
    var etags = new Array(mp.parts.length);
    var firstError = null;

    async function worker() {
      while (true) {
        if (firstError) return;
        var idx = queueIdx++;
        if (idx >= mp.parts.length) return;
        var part = mp.parts[idx];
        var start = (part.partNumber - 1) * partSize;
        var end = Math.min(start + partSize, fileSize);
        var blob = file.slice(start, end);
        try {
          var etag = await putPartWithRetry(part, blob, progressTick, PART_RETRY_MAX);
          etags[idx] = { partNumber: part.partNumber, etag: etag };
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
      console.warn('[ULMultipart] Part failure -> aborting multipart', firstError);
      await abortMultipart({
        abortUrl: mp.abortUrl || mp.completeUrl.replace('multipart-complete', 'multipart-abort'),
        shopDomain: shopDomain,
        key: mp.key,
        uploadId: mp.uploadId,
      });
      throw firstError;
    }

    // All parts uploaded; tell backend to complete
    var completeRes = await fetch(mp.completeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shopDomain: shopDomain,
        uploadId: intent.uploadId,
        key: mp.key,
        multipartUploadId: mp.uploadId,
        parts: etags,
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
    console.log('[ULMultipart] Done in ' + elapsed + 's: ' + mp.parts.length + ' parts, concurrency=' + concurrency);

    return {
      fileUrl: mp.publicUrl,
      storageProvider: 'r2',
      partsUploaded: mp.parts.length,
    };
  }

  window.ULMultipartUploader = {
    tryUpload: tryUpload,
    DEFAULT_CONCURRENCY: DEFAULT_CONCURRENCY,
  };
})();
