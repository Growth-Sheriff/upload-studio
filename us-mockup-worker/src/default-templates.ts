







import { readFile } from "fs/promises";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";


const templateCache = new Map<string, Buffer>();


const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, "../templates");




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
