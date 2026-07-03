

(function () {
  'use strict';

  if (window.ULDimensionReader) return;

  const DEFAULT_DPI = 300;

  const MIN_PRINT_DPI = 72;

  async function readDimensions(file) {
    if (!file || !file.type) {
      throw new Error('Invalid file provided');
    }

    const format = detectFormat(file);

    if (format === 'png') {
      return readPngDimensions(file);
    }

    if (format === 'jpeg') {
      return readJpegDimensions(file);
    }

    if (format === 'webp') {
      return readImageElementDimensions(file, 'webp');
    }

    return readImageElementDimensions(file, format);
  }

  function detectFormat(file) {
    const type = file.type.toLowerCase();
    if (type === 'image/png') return 'png';
    if (type === 'image/jpeg' || type === 'image/jpg') return 'jpeg';
    if (type === 'image/webp') return 'webp';
    if (type === 'image/tiff') return 'tiff';

    const ext = (file.name || '').split('.').pop().toLowerCase();
    if (ext === 'png') return 'png';
    if (ext === 'jpg' || ext === 'jpeg') return 'jpeg';
    if (ext === 'webp') return 'webp';
    if (ext === 'pdf') return 'pdf';
    if (ext === 'ai' || ext === 'eps') return 'vector';
    if (ext === 'psd') return 'psd';
    if (ext === 'tiff' || ext === 'tif') return 'tiff';

    return 'unknown';
  }

  async function readPngDimensions(file) {
    const buffer = await readFileAsArrayBuffer(file);
    const view = new DataView(buffer);

    if (view.getUint32(0) !== 0x89504E47 || view.getUint32(4) !== 0x0D0A1A0A) {

      return readImageElementDimensions(file, 'png');
    }

    const widthPx = view.getUint32(16);
    const heightPx = view.getUint32(20);

    let dpi = DEFAULT_DPI;
    let dpiFromExif = false;
    let source = 'assumed';

    let offset = 8;
    while (offset < buffer.byteLength - 12) {
      const chunkLength = view.getUint32(offset);
      const chunkType = getChunkType(view, offset + 4);

      if (chunkType === 'pHYs') {

        const dataOffset = offset + 8;
        const pxPerUnitX = view.getUint32(dataOffset);
        const pxPerUnitY = view.getUint32(dataOffset + 4);
        const unit = view.getUint8(dataOffset + 8);

        if (unit === 1) {

          const dpiX = Math.round(pxPerUnitX * 0.0254);
          const dpiY = Math.round(pxPerUnitY * 0.0254);
          dpi = Math.max(dpiX, dpiY);
          if (dpi >= MIN_PRINT_DPI) {
            dpiFromExif = true;
            source = 'png_phys';
          } else {
            dpi = DEFAULT_DPI;
          }
        } else if (pxPerUnitX > 0) {

          if (pxPerUnitX >= MIN_PRINT_DPI && pxPerUnitX <= 2400) {
            dpi = pxPerUnitX;
            dpiFromExif = true;
            source = 'png_phys';
          }
        }
        break;
      }

      if (chunkType === 'IDAT' || chunkType === 'IEND') {

        break;
      }

      offset += 4 + 4 + chunkLength + 4;
    }

    return buildResult(widthPx, heightPx, dpi, dpiFromExif, source, 'png');
  }

  function getChunkType(view, offset) {
    return String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );
  }

  async function readJpegDimensions(file) {
    const buffer = await readFileAsArrayBuffer(file);
    const view = new DataView(buffer);

    if (view.getUint16(0) !== 0xFFD8) {
      return readImageElementDimensions(file, 'jpeg');
    }

    let dpi = DEFAULT_DPI;
    let dpiFromExif = false;
    let source = 'assumed';
    let widthPx = 0;
    let heightPx = 0;

    let offset = 2;

    while (offset < buffer.byteLength - 4) {

      if (view.getUint8(offset) !== 0xFF) {
        offset++;
        continue;
      }

      const marker = view.getUint8(offset + 1);

      if (marker === 0xDA) break;

      if (
        (marker >= 0xC0 && marker <= 0xC3) ||
        (marker >= 0xC5 && marker <= 0xC7) ||
        (marker >= 0xC9 && marker <= 0xCB) ||
        (marker >= 0xCD && marker <= 0xCF)
      ) {

        heightPx = view.getUint16(offset + 5);
        widthPx = view.getUint16(offset + 7);
      }

      if (marker === 0xE0) {
        const segLength = view.getUint16(offset + 2);

        if (
          segLength >= 16 &&
          view.getUint8(offset + 4) === 0x4A &&
          view.getUint8(offset + 5) === 0x46 &&
          view.getUint8(offset + 6) === 0x49 &&
          view.getUint8(offset + 7) === 0x46
        ) {
          const densityUnits = view.getUint8(offset + 11);
          const xDensity = view.getUint16(offset + 12);
          const yDensity = view.getUint16(offset + 14);

          if (densityUnits === 1 && xDensity >= MIN_PRINT_DPI) {

            dpi = Math.max(xDensity, yDensity);
            dpiFromExif = true;
            source = 'exif';
          } else if (densityUnits === 2 && xDensity >= 1) {

            dpi = Math.round(Math.max(xDensity, yDensity) * 2.54);
            dpiFromExif = true;
            source = 'exif';
          }
        }
      }

      if (marker === 0xE1) {
        const exifDpi = parseExifDpi(view, offset);
        if (exifDpi && exifDpi >= MIN_PRINT_DPI) {
          dpi = exifDpi;
          dpiFromExif = true;
          source = 'exif';
        }
      }

      const segmentLength = view.getUint16(offset + 2);
      offset += 2 + segmentLength;
    }

    if (widthPx === 0 || heightPx === 0) {
      const imgResult = await readImageElementDimensions(file, 'jpeg');
      widthPx = imgResult.widthPx;
      heightPx = imgResult.heightPx;
    }

    return buildResult(widthPx, heightPx, dpi, dpiFromExif, source, 'jpeg');
  }

  function parseExifDpi(view, markerOffset) {
    try {
      const segLength = view.getUint16(markerOffset + 2);
      if (segLength < 14) return null;

      const exifOffset = markerOffset + 4;
      if (
        view.getUint8(exifOffset) !== 0x45 ||
        view.getUint8(exifOffset + 1) !== 0x78 ||
        view.getUint8(exifOffset + 2) !== 0x69 ||
        view.getUint8(exifOffset + 3) !== 0x66
      ) {
        return null;
      }

      const tiffOffset = exifOffset + 6;

      const byteOrder = view.getUint16(tiffOffset);
      const isLittleEndian = byteOrder === 0x4949;

      const magic = view.getUint16(tiffOffset + 2, isLittleEndian);
      if (magic !== 42) return null;

      const ifdOffset = view.getUint32(tiffOffset + 4, isLittleEndian);
      const ifdStart = tiffOffset + ifdOffset;

      const entryCount = view.getUint16(ifdStart, isLittleEndian);

      let xRes = null;
      let yRes = null;
      let resUnit = 2;

      for (let i = 0; i < entryCount && i < 50; i++) {
        const entryOffset = ifdStart + 2 + i * 12;
        if (entryOffset + 12 > view.byteLength) break;

        const tag = view.getUint16(entryOffset, isLittleEndian);
        const type = view.getUint16(entryOffset + 2, isLittleEndian);
        const valueOffset = view.getUint32(entryOffset + 8, isLittleEndian);

        if (tag === 0x011A && type === 5) {
          const ratioOffset = tiffOffset + valueOffset;
          if (ratioOffset + 8 <= view.byteLength) {
            const num = view.getUint32(ratioOffset, isLittleEndian);
            const den = view.getUint32(ratioOffset + 4, isLittleEndian);
            if (den > 0) xRes = num / den;
          }
        }

        if (tag === 0x011B && type === 5) {
          const ratioOffset = tiffOffset + valueOffset;
          if (ratioOffset + 8 <= view.byteLength) {
            const num = view.getUint32(ratioOffset, isLittleEndian);
            const den = view.getUint32(ratioOffset + 4, isLittleEndian);
            if (den > 0) yRes = num / den;
          }
        }

        if (tag === 0x0128) {
          resUnit = view.getUint16(entryOffset + 8, isLittleEndian);
        }
      }

      let resolvedDpi = null;
      const rawDpi = Math.max(xRes || 0, yRes || 0);

      if (rawDpi > 0) {
        if (resUnit === 2) {

          resolvedDpi = Math.round(rawDpi);
        } else if (resUnit === 3) {

          resolvedDpi = Math.round(rawDpi * 2.54);
        } else {

          resolvedDpi = Math.round(rawDpi);
        }
      }

      return resolvedDpi;
    } catch (e) {
      console.warn('[ULDimensionReader] EXIF parse error:', e.message);
      return null;
    }
  }

  function readImageElementDimensions(file, format) {
    return new Promise(function (resolve, reject) {

      if (!file.type.startsWith('image/')) {

        resolve({
          widthPx: 0,
          heightPx: 0,
          dpi: DEFAULT_DPI,
          widthInch: 0,
          heightInch: 0,
          widthCm: 0,
          heightCm: 0,
          dpiFromExif: false,
          source: 'unknown',
          format: format,
          error: 'Cannot read dimensions from this file type client-side',
        });
        return;
      }

      var url = URL.createObjectURL(file);
      var img = new Image();

      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve(
          buildResult(img.naturalWidth, img.naturalHeight, DEFAULT_DPI, false, 'assumed', format)
        );
      };

      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image for dimension reading'));
      };

      img.src = url;
    });
  }

  function readFileAsArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();

      var slice = file.slice(0, Math.min(file.size, 65536));

      reader.onload = function () {
        resolve(reader.result);
      };

      reader.onerror = function () {
        reject(new Error('Failed to read file'));
      };

      reader.readAsArrayBuffer(slice);
    });
  }

  function buildResult(widthPx, heightPx, dpi, dpiFromExif, source, format) {
    var safeDpi = dpi > 0 ? dpi : DEFAULT_DPI;
    var widthInch = widthPx / safeDpi;
    var heightInch = heightPx / safeDpi;

    return {
      widthPx: widthPx,
      heightPx: heightPx,
      dpi: safeDpi,
      widthInch: parseFloat(widthInch.toFixed(2)),
      heightInch: parseFloat(heightInch.toFixed(2)),
      widthCm: parseFloat((widthInch * 2.54).toFixed(2)),
      heightCm: parseFloat((heightInch * 2.54).toFixed(2)),
      dpiFromExif: dpiFromExif,
      source: source,
      format: format,
    };
  }

  function getThumbnail(file, maxSize) {
    maxSize = maxSize || 120;
    return new Promise(function (resolve, reject) {
      if (!file.type.startsWith('image/')) {
        resolve('');
        return;
      }

      var url = URL.createObjectURL(file);
      var img = new Image();

      img.onload = function () {
        URL.revokeObjectURL(url);
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d');
        var scale = Math.min(maxSize / img.naturalWidth, maxSize / img.naturalHeight, 1);
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      };

      img.onerror = function () {
        URL.revokeObjectURL(url);
        resolve('');
      };

      img.src = url;
    });
  }

  function formatDimensions(dims, unit) {
    if (!dims || dims.widthPx === 0) return 'Unknown';

    if (unit === 'cm') {
      return dims.widthCm + ' × ' + dims.heightCm + ' cm';
    }

    return dims.widthInch + '" × ' + dims.heightInch + '"';
  }

  function formatPixels(dims) {
    if (!dims || dims.widthPx === 0) return 'Unknown';
    return dims.widthPx + ' × ' + dims.heightPx + ' px';
  }

  window.ULDimensionReader = {
    readDimensions: readDimensions,
    getThumbnail: getThumbnail,
    formatDimensions: formatDimensions,
    formatPixels: formatPixels,
    DEFAULT_DPI: DEFAULT_DPI,
    MIN_PRINT_DPI: MIN_PRINT_DPI,
  };
})();
