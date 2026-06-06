(function() {
  'use strict';

  var MB = 1024 * 1024;
  var DEFAULTS = {
    minSampleMs: 5000,
    windowMs: 15000,
    slowMBps: 0.5,
    verySlowMBps: 0.15,
    stallMs: 12000,
    minWarnBytes: 10 * MB,
  };

  function now() {
    return Date.now();
  }

  function clampNumber(value, fallback) {
    var n = Number(value);
    return isFinite(n) && n >= 0 ? n : fallback;
  }

  function formatBytes(bytes) {
    var n = clampNumber(bytes, 0);
    if (n < 1024) return Math.round(n) + ' B';
    if (n < MB) return (n / 1024).toFixed(0) + ' KB';
    if (n < 1024 * MB) return (n / MB).toFixed(1) + ' MB';
    return (n / (1024 * MB)).toFixed(2) + ' GB';
  }

  function formatEta(seconds) {
    if (!isFinite(seconds) || seconds <= 0) return '';
    if (seconds < 60) return '~' + Math.ceil(seconds) + 's left';
    if (seconds < 3600) return '~' + Math.ceil(seconds / 60) + 'm left';
    return '~' + Math.ceil(seconds / 3600) + 'h left';
  }

  function mergeOptions(options) {
    var merged = {};
    Object.keys(DEFAULTS).forEach(function(key) { merged[key] = DEFAULTS[key]; });
    options = options || {};
    Object.keys(options).forEach(function(key) {
      if (options[key] != null) merged[key] = options[key];
    });
    return merged;
  }

  function UploadTelemetry(options) {
    this.options = mergeOptions(options);
    this.reset();
  }

  UploadTelemetry.prototype.reset = function(total) {
    this.startedAt = now();
    this.total = clampNumber(total, 0);
    this.samples = [];
    this.lastLoaded = 0;
    this.lastProgressAt = this.startedAt;
    this.completeSummary = null;
  };

  UploadTelemetry.prototype.tick = function(loaded, total) {
    var t = now();
    var safeLoaded = clampNumber(loaded, 0);
    var safeTotal = clampNumber(total, this.total || 0);
    if (safeTotal > 0) this.total = safeTotal;
    if (safeLoaded < this.lastLoaded) this.samples = [];

    this.lastLoaded = safeLoaded;
    this.lastProgressAt = t;
    this.samples.push({ time: t, loaded: safeLoaded });

    var cutoff = t - this.options.windowMs;
    while (this.samples.length > 2 && this.samples[0].time < cutoff) {
      this.samples.shift();
    }

    return this.getSnapshot();
  };

  UploadTelemetry.prototype.getSnapshot = function() {
    var t = now();
    var total = this.total || 0;
    var loaded = this.lastLoaded || 0;
    var elapsedSec = Math.max(0.001, (t - this.startedAt) / 1000);
    var overallSpeed = loaded / elapsedSec;
    var windowSpeed = overallSpeed;

    if (this.samples.length >= 2) {
      var first = this.samples[0];
      var last = this.samples[this.samples.length - 1];
      var deltaMs = Math.max(1, last.time - first.time);
      var deltaBytes = Math.max(0, last.loaded - first.loaded);
      windowSpeed = deltaBytes / (deltaMs / 1000);
      if (!(windowSpeed > 0)) windowSpeed = overallSpeed;
    }

    var remaining = windowSpeed > 0 && total > loaded ? (total - loaded) / windowSpeed : 0;
    var speedMBps = windowSpeed / MB;
    var elapsedMs = t - this.startedAt;
    var stalled = loaded > 0 && t - this.lastProgressAt > this.options.stallMs;
    var severity = 'normal';
    var advisory = '';

    if (stalled) {
      severity = 'stalled';
      advisory = 'Connection stalled briefly. Upload is still waiting.';
    } else if (elapsedMs >= this.options.minSampleMs && total >= this.options.minWarnBytes) {
      if (speedMBps > 0 && speedMBps < this.options.verySlowMBps) {
        severity = 'very_slow';
        advisory = 'Very slow internet detected. Keep this tab open.';
      } else if (speedMBps > 0 && speedMBps < this.options.slowMBps) {
        severity = 'slow';
        advisory = 'Your internet connection is slow. Upload is still continuing.';
      }
    }

    return {
      loaded: loaded,
      total: total,
      elapsedSec: elapsedSec,
      remainingSec: remaining,
      speedBytesPerSec: windowSpeed,
      speedMBps: speedMBps,
      speedText: speedMBps >= 1 ? speedMBps.toFixed(1) + ' MB/s' : Math.max(0, speedMBps).toFixed(2) + ' MB/s',
      etaText: formatEta(remaining),
      loadedText: formatBytes(loaded),
      totalText: formatBytes(total),
      severity: severity,
      advisory: advisory,
      stalled: stalled,
    };
  };

  UploadTelemetry.prototype.formatProgress = function(options) {
    options = options || {};
    var s = this.getSnapshot();
    var suffix = options.suffix ? ' ' + options.suffix : '';
    var main = s.total > 0
      ? s.loadedText + ' / ' + s.totalText + ' • Your internet speed: ' + s.speedText
      : s.loadedText + ' uploaded • Your internet speed: ' + s.speedText;
    if (s.etaText) main += ' • ' + s.etaText;
    main += suffix;
    return s.advisory ? main + ' • ' + s.advisory : main;
  };

  UploadTelemetry.prototype.formatComplete = function(totalBytes) {
    var elapsed = Math.max(0.001, (now() - this.startedAt) / 1000);
    var total = clampNumber(totalBytes, this.total || this.lastLoaded || 0);
    var avg = total / elapsed;
    this.completeSummary = {
      totalBytes: total,
      elapsedSec: elapsed,
      avgMBps: avg / MB,
    };
    return '✓ ' + formatBytes(total) + ' uploaded in ' + elapsed.toFixed(1) + 's • avg ' + (avg / MB).toFixed(1) + ' MB/s';
  };

  function create(options) {
    return new UploadTelemetry(options);
  }

  window.ULUploadTelemetry = {
    create: create,
    formatBytes: formatBytes,
    formatEta: formatEta,
  };
})();
