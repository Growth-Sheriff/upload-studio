/**
 * Default Templates — Real garment photos for mockup compositing
 *
 * Loads pre-generated garment template PNGs from disk.
 * These are photorealistic base images used when the seller
 * hasn't uploaded custom PSD/PNG templates.
 */

import { readFile } from "fs/promises";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Cache loaded templates in memory
const templateCache = new Map<string, Buffer>();

// Resolve path relative to this file's directory
const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, "../templates");

/**
 * Get a default template buffer for a garment type
 */
export async function getDefaultTemplateBuffer(
  garmentType: string
): Promise<Buffer> {
  const cached = templateCache.get(garmentType);
  if (cached) return cached;

  const filename = `${garmentType}.png`;
  const filepath = resolve(TEMPLATES_DIR, filename);

  try {
    const buffer = await readFile(filepath);
    console.log(
      `[templates] Loaded ${garmentType} template: ${(buffer.length / 1024).toFixed(0)}KB`
    );
    templateCache.set(garmentType, buffer);
    return buffer;
  } catch (err) {
    console.warn(
      `[templates] Template not found for ${garmentType}: ${filepath}, using fallback`
    );
    // Fallback: generate a simple gray rectangle so compositing doesn't fail
    const sharp = (await import("sharp")).default;
    const fallback = await sharp({
      create: {
        width: 800,
        height: 1000,
        channels: 4,
        background: { r: 240, g: 240, b: 240, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    templateCache.set(garmentType, fallback);
    return fallback;
  }
}
