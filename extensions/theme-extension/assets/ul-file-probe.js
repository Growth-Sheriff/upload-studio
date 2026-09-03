/*
 * Upload Studio — client-side file probe.
 *
 * Reads only the first/last kilobytes of a File and extracts pixel size,
 * DPI and alpha flags so the storefront can show size, sheet and price the
 * moment a file is dropped — before a single byte finishes uploading. The
 * server measurement stays the source of truth and reconciles afterwards.
 *
 * Also computes a content fingerprint (size + SHA-256 of the first and last
 * 1 MB) used for instant re-upload dedupe and resumable upload sessions.
 *
 * Exposed as window.ULFileProbe; also CommonJS-exported for unit tests.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ULFileProbe = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var HEAD_BYTES = 256 * 1024;
  var TAIL_BYTES = 256 * 1024;
  var FINGERPRINT_SLICE = 1024 * 1024;

  function readSlice(file, start, end) {
    var blob = file.slice(start, end);
    if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsArrayBuffer(blob);
    });
  }

  function latin1(bytes, start, end) {
    var out = '';
    for (var i = start; i < end && i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    return out;
  }

  function inches(px, dpi) {
    return px > 0 && dpi > 0 ? Math.round((px / dpi) * 100) / 100 : 0;
  }

  function result(fields) {
    var r = {
      format: fields.format || 'unknown',
      widthPx: fields.widthPx || 0,
      heightPx: fields.heightPx || 0,
      dpi: fields.dpi || 0,
      dpiSource: fields.dpiSource || null,
      widthIn: fields.widthIn || 0,
      heightIn: fields.heightIn || 0,
      hasAlpha: Boolean(fields.hasAlpha),
      confident: Boolean(fields.confident)
    };
    if (!r.widthIn && r.widthPx && r.dpi) r.widthIn = inches(r.widthPx, r.dpi);
    if (!r.heightIn && r.heightPx && r.dpi) r.heightIn = inches(r.heightPx, r.dpi);
    return r;
  }

  // ── PNG: IHDR (w,h,colorType) + pHYs (pixels per metre) ──────────────────
  function parsePng(bytes) {
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 33 || view.getUint32(0) !== 0x89504e47) return null;
    var widthPx = view.getUint32(16);
    var heightPx = view.getUint32(20);
    var colorType = bytes[25];
    var hasAlpha = colorType === 4 || colorType === 6;
    var dpi = 0, dpiSource = null;
    var pos = 8;
    while (pos + 12 <= bytes.length) {
      var len = view.getUint32(pos);
      var type = latin1(bytes, pos + 4, pos + 8);
      if (type === 'pHYs' && pos + 8 + 9 <= bytes.length) {
        var ppuX = view.getUint32(pos + 8);
        var unit = bytes[pos + 16];
        if (unit === 1 && ppuX > 0) { dpi = Math.round(ppuX * 0.0254 * 100) / 100; dpiSource = 'png_phys'; }
        break;
      }
      if (type === 'IDAT' || type === 'IEND') break;
      pos += 12 + len;
    }
    return result({ format: 'PNG', widthPx: widthPx, heightPx: heightPx, dpi: dpi, dpiSource: dpiSource, hasAlpha: hasAlpha, confident: true });
  }

  // ── JPEG: SOFn for size, JFIF APP0 or EXIF XResolution for DPI ───────────
  function parseJpeg(bytes) {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var pos = 2, widthPx = 0, heightPx = 0, dpi = 0, dpiSource = null;
    while (pos + 4 <= bytes.length) {
      if (bytes[pos] !== 0xff) { pos++; continue; }
      var marker = bytes[pos + 1];
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { pos += 2; continue; }
      if (marker === 0xd9 || marker === 0xda) break;
      var segLen = view.getUint16(pos + 2);
      var segStart = pos + 4;
      if (marker === 0xe0 && latin1(bytes, segStart, segStart + 4) === 'JFIF' && segStart + 12 <= bytes.length) {
        var units = bytes[segStart + 7];
        var xd = view.getUint16(segStart + 8);
        if (units === 1 && xd > 0) { dpi = xd; dpiSource = 'jfif'; }
        else if (units === 2 && xd > 0) { dpi = Math.round(xd * 2.54); dpiSource = 'jfif_cm'; }
      } else if (marker === 0xe1 && latin1(bytes, segStart, segStart + 4) === 'Exif' && !dpi) {
        var tiffStart = segStart + 6;
        var exifDpi = readTiffResolution(bytes, tiffStart, segStart + segLen - 2);
        if (exifDpi > 0) { dpi = exifDpi; dpiSource = 'exif'; }
      } else if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        if (segStart + 5 <= bytes.length) {
          heightPx = view.getUint16(segStart + 1);
          widthPx = view.getUint16(segStart + 3);
        }
        break;
      }
      pos = segStart + segLen - 2;
    }
    if (!widthPx || !heightPx) return null;
    return result({ format: 'JPG', widthPx: widthPx, heightPx: heightPx, dpi: dpi, dpiSource: dpiSource, hasAlpha: false, confident: true });
  }

  // ── TIFF (and EXIF IFD0): 256/257 size, 282/283 resolution, 296 unit ─────
  function readTiffIfd(bytes, base, limit) {
    if (base + 8 > limit) return null;
    var le = bytes[base] === 0x49 && bytes[base + 1] === 0x49;
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    function u16(o) { return view.getUint16(o, le); }
    function u32(o) { return view.getUint32(o, le); }
    if (u16(base + 2) !== 42) return null;
    var ifd = base + u32(base + 4);
    if (ifd + 2 > limit) return null;
    var count = u16(ifd);
    var out = {};
    for (var i = 0; i < count; i++) {
      var e = ifd + 2 + i * 12;
      if (e + 12 > limit) break;
      var tag = u16(e), type = u16(e + 2), n = u32(e + 4);
      var valOff = e + 8;
      var value = null;
      if (type === 3) value = u16(valOff);
      else if (type === 4) value = u32(valOff);
      else if (type === 5) {
        var off = base + u32(valOff);
        if (off + 8 <= limit) { var num = u32(off), den = u32(off + 4); value = den ? num / den : 0; }
      }
      if (value != null) out[tag] = value;
    }
    return out;
  }

  function readTiffResolution(bytes, base, limit) {
    var ifd = readTiffIfd(bytes, base, limit);
    if (!ifd) return 0;
    var unit = ifd[296] || 2;
    var xres = ifd[282] || 0;
    if (!xres) return 0;
    return unit === 3 ? Math.round(xres * 2.54) : Math.round(xres);
  }

  function parseTiff(bytes) {
    if (bytes.length < 8) return null;
    var isLE = bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0;
    var isBE = bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0 && bytes[3] === 0x2a;
    if (!isLE && !isBE) return null;
    var ifd = readTiffIfd(bytes, 0, bytes.length);
    if (!ifd || !ifd[256] || !ifd[257]) return null;
    var dpi = readTiffResolution(bytes, 0, bytes.length);
    var samples = ifd[277] || 0;
    return result({ format: 'TIFF', widthPx: ifd[256], heightPx: ifd[257], dpi: dpi, dpiSource: dpi ? 'tiff_ifd' : null, hasAlpha: samples === 4, confident: true });
  }

  // ── PSD: header (v1/v2) + image resource 0x03ED (resolution) ─────────────
  function parsePsd(bytes) {
    if (bytes.length < 26 || latin1(bytes, 0, 4) !== '8BPS') return null;
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var channels = view.getUint16(12);
    var heightPx = view.getUint32(14);
    var widthPx = view.getUint32(18);
    var dpi = 0;
    var colorModeLen = view.getUint32(26);
    var resStart = 30 + colorModeLen;
    if (resStart + 4 <= bytes.length) {
      var resLen = view.getUint32(resStart);
      var pos = resStart + 4, end = Math.min(bytes.length, resStart + 4 + resLen);
      while (pos + 12 <= end) {
        if (latin1(bytes, pos, pos + 4) !== '8BIM') break;
        var id = view.getUint16(pos + 4);
        var nameLen = bytes[pos + 6];
        var namePad = (nameLen + 1) % 2 === 1 ? nameLen + 2 : nameLen + 1;
        var dataStart = pos + 6 + namePad;
        var dataLen = view.getUint32(dataStart);
        var dataPos = dataStart + 4;
        if (id === 0x03ed && dataPos + 4 <= end) {
          // hRes is a 32-bit fixed-point number (16.16) in pixels per inch.
          dpi = Math.round(view.getUint32(dataPos) / 65536);
          break;
        }
        pos = dataPos + dataLen + (dataLen % 2);
      }
    }
    return result({ format: 'PSD', widthPx: widthPx, heightPx: heightPx, dpi: dpi, dpiSource: dpi ? 'psd_resource' : null, hasAlpha: channels >= 4, confident: true });
  }

  // ── PDF: first MediaBox (points, 72/in) — first page in practice ─────────
  function parsePdf(head, tail) {
    if (latin1(head, 0, 5) !== '%PDF-') return null;
    var text = latin1(head, 0, head.length) + '\n' + latin1(tail, 0, tail.length);
    var m = text.match(/\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/);
    if (!m) return result({ format: 'PDF', confident: false });
    var w = Math.abs(parseFloat(m[3]) - parseFloat(m[1]));
    var h = Math.abs(parseFloat(m[4]) - parseFloat(m[2]));
    if (!(w > 0 && h > 0)) return result({ format: 'PDF', confident: false });
    return result({ format: 'PDF', widthPx: Math.round((w / 72) * 300), heightPx: Math.round((h / 72) * 300), dpi: 300, dpiSource: 'pdf_mediabox', widthIn: Math.round((w / 72) * 100) / 100, heightIn: Math.round((h / 72) * 100) / 100, hasAlpha: false, confident: true });
  }

  // ── EPS / AI: %%HiResBoundingBox or %%BoundingBox (points); DOS EPS wrapper ─
  function parseEps(head) {
    var start = 0;
    if (head[0] === 0xc5 && head[1] === 0xd0 && head[2] === 0xd3 && head[3] === 0xc6) {
      var view = new DataView(head.buffer, head.byteOffset, head.byteLength);
      var psOffset = view.getUint32(4, true);
      if (psOffset < head.length) start = psOffset;
      else return result({ format: 'EPS', confident: false });
    } else if (latin1(head, 0, 2) !== '%!' && latin1(head, 0, 5) !== '%PDF-') {
      return null;
    }
    var text = latin1(head, start, head.length);
    var m = text.match(/%%HiResBoundingBox:\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/) ||
            text.match(/%%BoundingBox:\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/);
    if (!m) return result({ format: 'EPS', confident: false });
    var w = parseFloat(m[3]) - parseFloat(m[1]);
    var h = parseFloat(m[4]) - parseFloat(m[2]);
    if (!(w > 0 && h > 0)) return result({ format: 'EPS', confident: false });
    return result({ format: 'EPS', widthPx: Math.round((w / 72) * 300), heightPx: Math.round((h / 72) * 300), dpi: 300, dpiSource: 'eps_bbox', widthIn: Math.round((w / 72) * 100) / 100, heightIn: Math.round((h / 72) * 100) / 100, hasAlpha: false, confident: true });
  }

  // ── SVG: width/height with units, else viewBox at 96 css px/in ───────────
  function parseSvg(head) {
    var text = latin1(head, 0, head.length);
    if (text.indexOf('<svg') === -1) return null;
    var tag = (text.match(/<svg[^>]*>/i) || [''])[0];
    function dim(attr) {
      var m = tag.match(new RegExp(attr + '\\s*=\\s*["\']\\s*([\\d.]+)\\s*(px|in|mm|cm|pt)?\\s*["\']', 'i'));
      if (!m) return 0;
      var v = parseFloat(m[1]), u = (m[2] || 'px').toLowerCase();
      if (u === 'in') return v;
      if (u === 'mm') return v / 25.4;
      if (u === 'cm') return v / 2.54;
      if (u === 'pt') return v / 72;
      return v / 96;
    }
    var wIn = dim('width'), hIn = dim('height');
    if (!(wIn > 0 && hIn > 0)) {
      var vb = tag.match(/viewBox\s*=\s*["']\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)\s*["']/i);
      if (vb) { wIn = parseFloat(vb[3]) / 96; hIn = parseFloat(vb[4]) / 96; }
    }
    if (!(wIn > 0 && hIn > 0)) return result({ format: 'SVG', confident: false });
    return result({ format: 'SVG', widthPx: Math.round(wIn * 300), heightPx: Math.round(hIn * 300), dpi: 300, dpiSource: 'svg_units', widthIn: Math.round(wIn * 100) / 100, heightIn: Math.round(hIn * 100) / 100, hasAlpha: true, confident: true });
  }

  function parseBytes(head, tail) {
    var bytes = new Uint8Array(head);
    var tailBytes = new Uint8Array(tail || new ArrayBuffer(0));
    return parsePng(bytes) || parseJpeg(bytes) || parseTiff(bytes) || parsePsd(bytes) ||
           parsePdf(bytes, tailBytes) || parseEps(bytes) || parseSvg(bytes) ||
           result({ format: 'unknown', confident: false });
  }

  async function probe(file) {
    var head = await readSlice(file, 0, Math.min(file.size, HEAD_BYTES));
    var tail = file.size > HEAD_BYTES ? await readSlice(file, Math.max(0, file.size - TAIL_BYTES), file.size) : new ArrayBuffer(0);
    var r = parseBytes(head, tail);
    r.fileSize = file.size;
    r.fileName = file.name;
    return r;
  }

  async function fingerprint(file) {
    try {
      if (!(window.crypto && window.crypto.subtle)) return null;
      var head = await readSlice(file, 0, Math.min(file.size, FINGERPRINT_SLICE));
      var tail = file.size > FINGERPRINT_SLICE ? await readSlice(file, file.size - FINGERPRINT_SLICE, file.size) : new ArrayBuffer(0);
      var joined = new Uint8Array(head.byteLength + tail.byteLength);
      joined.set(new Uint8Array(head), 0);
      joined.set(new Uint8Array(tail), head.byteLength);
      var digest = await window.crypto.subtle.digest('SHA-256', joined);
      var hex = Array.prototype.map.call(new Uint8Array(digest), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      return 'v1-' + file.size + '-' + hex;
    } catch (_) {
      return null;
    }
  }

  return { probe: probe, fingerprint: fingerprint, parseBytes: parseBytes };
});
