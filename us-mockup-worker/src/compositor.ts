
















import sharp from "sharp";

export interface PrintArea {

  topPct: number;

  leftPct: number;

  widthPct: number;

  maxHeightPct: number;
}

export interface CompositeOptions {

  templateBuffer: Buffer;

  artworkBuffer: Buffer;

  printArea: PrintArea;

  outputWidth?: number;

  quality?: number;

  garmentColor?: string;
}

export interface CompositeResult {

  buffer: Buffer;

  width: number;

  height: number;

  sizeBytes: number;
}




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


  const templateMeta = await sharp(templateBuffer).metadata();
  const tplW = templateMeta.width || 1000;
  const tplH = templateMeta.height || 1000;


  const areaX = Math.round((printArea.leftPct / 100) * tplW);
  const areaY = Math.round((printArea.topPct / 100) * tplH);
  const areaW = Math.round((printArea.widthPct / 100) * tplW);
  const areaH = Math.round((printArea.maxHeightPct / 100) * tplH);


  const artworkResized = await sharp(artworkBuffer)
    .resize(areaW, areaH, {
      fit: "inside",
      withoutEnlargement: false,
    })
    .png()
    .toBuffer();


  const artMeta = await sharp(artworkResized).metadata();
  const artW = artMeta.width || areaW;
  const artH = artMeta.height || areaH;


  const offsetX = areaX + Math.round((areaW - artW) / 2);
  const offsetY = areaY + Math.round((areaH - artH) / 2);


  let pipeline = sharp(templateBuffer);


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
        outputWidth: 800,
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



function hexToRgba(hex: string): { r: number; g: number; b: number; alpha: number } {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.substring(0, 2), 16),
    g: parseInt(clean.substring(2, 4), 16),
    b: parseInt(clean.substring(4, 6), 16),
    alpha: 1,
  };
}





export const DEFAULT_PRINT_AREAS: Record<string, PrintArea> = {
  tshirt: { topPct: 18, leftPct: 25, widthPct: 50, maxHeightPct: 40 },
  hoodie: { topPct: 22, leftPct: 25, widthPct: 50, maxHeightPct: 35 },
  polo: { topPct: 20, leftPct: 28, widthPct: 44, maxHeightPct: 35 },
  hat: { topPct: 25, leftPct: 20, widthPct: 60, maxHeightPct: 30 },
  totebag: { topPct: 15, leftPct: 20, widthPct: 60, maxHeightPct: 55 },
  apron: { topPct: 10, leftPct: 22, widthPct: 56, maxHeightPct: 45 },
};
