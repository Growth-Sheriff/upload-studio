// Offline synthetic customer files, not an app layout feature or product photos.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { parsePngJpegHeader } from '../../app/lib/preflight.server.ts';
import { validateFinishedSheetFit } from '../../app/lib/finishedSheetMeasurement.ts';

const output = 'C:/Users/mhmmd/.codex/demo-artwork/auto-gang-sheet-public';
const fixtures = [
  { name: 'ready-sheet-22.3x78-100dpi.png', width: 2230, height: 7800, bottom: 7700, fits: true },
  { name: 'overflow-sheet-23.91x80-100dpi.png', width: 2391, height: 8000, bottom: 7900, fits: false },
];
const pixelsPerMetre = Math.round(100 / 0.0254);

// Pure PNG chunk/CRC logic reused from preflight.measurementOverride.server.test.ts.
function chunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([name, data])) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, name, data, checksum]);
}

function makePng({ width, height, bottom }) {
  const stride = 1 + width * 4;
  const pixels = Buffer.alloc(stride * height); // Filter 0, transparent RGBA page.
  const teal = 0x1b625bff;
  const coral = 0xef967eff;
  const gold = 0xe6b344ff;
  function rectangle(x, y, w, h, rgba) {
    assert.ok(x >= 0 && y >= 0 && x + w <= width && y + h <= height);
    for (let row = y; row < y + h; row++) {
      for (let col = x; col < x + w; col++) pixels.writeUInt32BE(rgba, row * stride + 1 + col * 4);
    }
  }
  // These positions were authored here explicitly. No fitting, packing or copy count.
  rectangle(40, 40, 180, 12, teal);
  rectangle(40, 40, 12, 180, teal);
  rectangle(180, 300, 1800, 140, teal);
  rectangle(300, 900, 360, 360, coral);
  rectangle(950, 900, 360, 360, gold);
  rectangle(1600, 900, 360, 360, teal);
  rectangle(180, 2300, 1400, 80, coral);
  rectangle(180, 2460, 1000, 80, gold);
  rectangle(180, 2620, 600, 80, teal);
  rectangle(300, 4200, 180, 600, teal);
  rectangle(700, 4400, 600, 180, gold);
  rectangle(1600, 4200, 180, 600, coral);
  rectangle(180, 6200, 1800, 140, teal);
  rectangle(40, bottom, 180, 12, teal);
  rectangle(40, bottom - 168, 12, 180, teal);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const phys = Buffer.alloc(9);
  phys.writeUInt32BE(pixelsPerMetre);
  phys.writeUInt32BE(pixelsPerMetre, 4);
  phys[8] = 1;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('pHYs', phys),
    chunk('tEXt', Buffer.from('Description\0Original synthetic ready-sheet demo. Predetermined geometric marks; no real customer artwork.')),
    chunk('IDAT', deflateSync(pixels, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

await mkdir(output, { recursive: true });
for (const fixture of fixtures) {
  const file = join(output, fixture.name);
  const bytes = makePng(fixture);
  let existing;
  try { existing = await readFile(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing) assert.ok(existing.equals(bytes), `Refusing to overwrite a different existing file: ${file}`);
  else await writeFile(file, bytes, { flag: 'wx' });

  // Read the written file back through the real app's pure header parser.
  const saved = await readFile(file);
  const header = parsePngJpegHeader(saved.subarray(0, 64 * 1024));
  assert.ok(header);
  assert.equal(header.width, fixture.width);
  assert.equal(header.height, fixture.height);
  assert.equal(header.hasAlpha, true);
  assert.equal(header.dpiSource, 'png_phys');
  assert.ok(Math.abs(header.dpi - 100) < 0.001);
  const fit = validateFinishedSheetFit({ widthIn: header.width / header.dpi,
    heightIn: header.height / header.dpi, maxPrintableWidthIn: 22.5,
    maxPrintableLengthIn: 240, fitToleranceIn: 0.02 });
  assert.equal(fit.ok, fixture.fits);
  if (!fixture.fits) assert.equal(fit.code, 'WIDTH_TOO_LARGE');
  console.log(JSON.stringify({ file, bytes: saved.length,
    sha256: createHash('sha256').update(saved).digest('hex'),
    widthPx: header.width, heightPx: header.height, dpi: header.dpi,
    widthIn: header.width / header.dpi, lengthIn: header.height / header.dpi,
    fit: fit.ok ? 'fits' : fit.message }));
}
