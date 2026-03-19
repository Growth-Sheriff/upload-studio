/**
 * Default Templates — Built-in garment templates
 * 
 * Generates simple garment silhouette PNGs using Sharp.
 * These are fallbacks when seller hasn't uploaded custom PSD templates.
 * 
 * Each template is an 800x1000 PNG with a transparent background
 * and a garment silhouette rendered from SVG paths.
 */

import sharp from "sharp";

// Cache generated templates in memory
const templateCache = new Map<string, Buffer>();

/**
 * Get a default template buffer for a garment type
 */
export async function getDefaultTemplateBuffer(
  garmentType: string
): Promise<Buffer> {
  const cached = templateCache.get(garmentType);
  if (cached) return cached;

  const svg = getGarmentSvg(garmentType);
  const buffer = await sharp(Buffer.from(svg))
    .resize(800, 1000, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  templateCache.set(garmentType, buffer);
  return buffer;
}

/**
 * SVG garment silhouettes
 * currentColor allows tinting via garmentColor
 */
function getGarmentSvg(type: string): string {
  const svgs: Record<string, string> = {
    tshirt: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000" width="800" height="1000">
      <rect width="800" height="1000" fill="none"/>
      <path d="M200,80 L100,180 L160,240 L220,180 L220,900 L580,900 L580,180 L640,240 L700,180 L600,80 L520,120 Q400,160,280,120 Z" 
            fill="#e5e7eb" stroke="#d1d5db" stroke-width="2"/>
    </svg>`,

    hoodie: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000" width="800" height="1000">
      <rect width="800" height="1000" fill="none"/>
      <path d="M180,100 L80,220 L150,280 L210,200 L210,900 L590,900 L590,200 L650,280 L720,220 L620,100 L540,140 Q400,200,260,140 Z" 
            fill="#e5e7eb" stroke="#d1d5db" stroke-width="2"/>
      <path d="M330,100 Q400,50,470,100 L470,250 Q400,320,330,250 Z" 
            fill="#d1d5db" stroke="#9ca3af" stroke-width="1"/>
    </svg>`,

    polo: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000" width="800" height="1000">
      <rect width="800" height="1000" fill="none"/>
      <path d="M220,80 L120,180 L180,230 L230,180 L230,900 L570,900 L570,180 L620,230 L680,180 L580,80 L520,110 Q400,150,280,110 Z" 
            fill="#e5e7eb" stroke="#d1d5db" stroke-width="2"/>
      <path d="M350,80 L380,200 L400,200 L420,200 L450,80" fill="none" stroke="#9ca3af" stroke-width="3"/>
    </svg>`,

    hat: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000" width="800" height="1000">
      <rect width="800" height="1000" fill="none"/>
      <path d="M150,550 Q150,200,400,180 Q650,200,650,550 L700,600 Q400,650,100,600 Z" 
            fill="#e5e7eb" stroke="#d1d5db" stroke-width="2"/>
      <path d="M100,600 Q400,700,700,600 L720,620 Q400,740,80,620 Z" 
            fill="#d1d5db" stroke="#9ca3af" stroke-width="2"/>
    </svg>`,

    totebag: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000" width="800" height="1000">
      <rect width="800" height="1000" fill="none"/>
      <rect x="150" y="200" width="500" height="700" rx="10" fill="#e5e7eb" stroke="#d1d5db" stroke-width="2"/>
      <path d="M280,200 Q280,80,400,80 Q520,80,520,200" fill="none" stroke="#9ca3af" stroke-width="8"/>
    </svg>`,

    apron: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000" width="800" height="1000">
      <rect width="800" height="1000" fill="none"/>
      <path d="M250,100 Q400,60,550,100 L600,300 L600,850 Q400,900,200,850 L200,300 Z" 
            fill="#e5e7eb" stroke="#d1d5db" stroke-width="2"/>
      <path d="M250,100 L180,60 M550,100 L620,60" stroke="#9ca3af" stroke-width="6" fill="none"/>
      <rect x="280" y="550" width="240" height="200" rx="8" fill="#d1d5db" stroke="#9ca3af" stroke-width="1"/>
    </svg>`,
  };

  return svgs[type] || svgs.tshirt;
}
