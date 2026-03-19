/**
 * ═══════════════════════════════════════════════════════════
 * Mockup Compositor — Sharp-based PSD/PNG Template Compositing
 * ═══════════════════════════════════════════════════════════
 * 
 * Takes a garment template image + customer artwork
 * → Resizes artwork to fit print area
 * → Composites onto garment
 * → Returns PNG buffer
 * 
 * Supports:
 *   - PNG templates (recommended for speed)
 *   - Configurable print area (top, left, width, height as % or px)
 *   - Aspect ratio preservation
 *   - Multiple garment types (tshirt, hoodie, hat, polo, tote, apron)
 */

import sharp from "sharp";

export interface PrintArea {
  /** Top offset as percentage of template height (0-100) */
  topPct: number;
  /** Left offset as percentage of template width (0-100) */
  leftPct: number;
  /** Width as percentage of template width (0-100) */
  widthPct: number;
  /** Max height as percentage of template height (0-100) */
  maxHeightPct: number;
}

export interface CompositeOptions {
  /** Template image buffer (PNG) */
  templateBuffer: Buffer;
  /** Customer artwork buffer (PNG/JPG/WebP) */
  artworkBuffer: Buffer;
  /** Print area definition */
  printArea: PrintArea;
  /** Output width (default: template width) */
  outputWidth?: number;
  /** Output quality (1-100, default: 90) */
  quality?: number;
  /** Background color behind artwork (for transparent templates) */
  garmentColor?: string;
}

export interface CompositeResult {
  /** Generated mockup as PNG buffer */
  buffer: Buffer;
  /** Width of output */
  width: number;
  /** Height of output */
  height: number;
  /** Size in bytes */
  sizeBytes: number;
}

/**
 * Composite artwork onto a garment template
 */
export async function compositeOnTemplate(
  options: CompositeOptions
): Promise<CompositeResult> {
  const {
    templateBuffer,
    artworkBuffer,
    printArea,
    outputWidth,
    quality = 90,
    garmentColor,
  } = options;

  // Get template dimensions
  const templateMeta = await sharp(templateBuffer).metadata();
  const tplW = templateMeta.width || 1000;
  const tplH = templateMeta.height || 1000;

  // Calculate print area in pixels
  const areaX = Math.round((printArea.leftPct / 100) * tplW);
  const areaY = Math.round((printArea.topPct / 100) * tplH);
  const areaW = Math.round((printArea.widthPct / 100) * tplW);
  const areaH = Math.round((printArea.maxHeightPct / 100) * tplH);

  // Resize artwork to fit within print area (maintain aspect ratio)
  const artworkResized = await sharp(artworkBuffer)
    .resize(areaW, areaH, {
      fit: "inside",
      withoutEnlargement: false,
    })
    .png()
    .toBuffer();

  // Get resized artwork dimensions for centering
  const artMeta = await sharp(artworkResized).metadata();
  const artW = artMeta.width || areaW;
  const artH = artMeta.height || areaH;

  // Center artwork within print area
  const offsetX = areaX + Math.round((areaW - artW) / 2);
  const offsetY = areaY + Math.round((areaH - artH) / 2);

  // Build composite pipeline
  let pipeline = sharp(templateBuffer);

  // If garment color is specified, create a colored background first
  if (garmentColor) {
    const coloredBg = await sharp({
      create: {
        width: tplW,
        height: tplH,
        channels: 4,
        background: hexToRgba(garmentColor),
      },
    })
      .png()
      .toBuffer();

    pipeline = sharp(coloredBg).composite([
      { input: templateBuffer, blend: "over" },
    ]);
  }

  // Composite artwork onto template
  const result = await pipeline
    .composite([
      {
        input: artworkResized,
        left: offsetX,
        top: offsetY,
        blend: "over",
      },
    ])
    .resize(outputWidth || tplW, undefined, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .png({ quality })
    .toBuffer();

  const resultMeta = await sharp(result).metadata();

  return {
    buffer: result,
    width: resultMeta.width || tplW,
    height: resultMeta.height || tplH,
    sizeBytes: result.length,
  };
}

/**
 * Generate mockups for all garment types at once
 */
export async function generateAllMockups(
  artworkBuffer: Buffer,
  templates: Array<{
    garmentType: string;
    templateBuffer: Buffer;
    printArea: PrintArea;
  }>,
  garmentColor?: string
): Promise<
  Array<{
    garmentType: string;
    result: CompositeResult;
  }>
> {
  const results = [];

  for (const tpl of templates) {
    try {
      const result = await compositeOnTemplate({
        templateBuffer: tpl.templateBuffer,
        artworkBuffer,
        printArea: tpl.printArea,
        garmentColor,
        outputWidth: 800, // Optimized size for previews
        quality: 85,
      });
      results.push({ garmentType: tpl.garmentType, result });
    } catch (err) {
      console.error(
        `[compositor] Failed for ${tpl.garmentType}:`,
        err
      );
    }
  }

  return results;
}

// ─── Helpers ────────────────────────────────────────────

function hexToRgba(hex: string): { r: number; g: number; b: number; alpha: number } {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.substring(0, 2), 16),
    g: parseInt(clean.substring(2, 4), 16),
    b: parseInt(clean.substring(4, 6), 16),
    alpha: 1,
  };
}

/**
 * Default print areas for common garment types
 * These are used when seller hasn't uploaded custom PSD templates
 */
export const DEFAULT_PRINT_AREAS: Record<string, PrintArea> = {
  tshirt: { topPct: 18, leftPct: 25, widthPct: 50, maxHeightPct: 40 },
  hoodie: { topPct: 22, leftPct: 25, widthPct: 50, maxHeightPct: 35 },
  polo: { topPct: 20, leftPct: 28, widthPct: 44, maxHeightPct: 35 },
  hat: { topPct: 25, leftPct: 20, widthPct: 60, maxHeightPct: 30 },
  totebag: { topPct: 15, leftPct: 20, widthPct: 60, maxHeightPct: 55 },
  apron: { topPct: 10, leftPct: 22, widthPct: 56, maxHeightPct: 45 },
};
