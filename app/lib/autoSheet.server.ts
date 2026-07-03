








import prisma from '~/lib/prisma.server';




export interface AutoSheetConfig {
  enabled: boolean;
  gapMm: number;
  marginMm: number;
  allowRotation: boolean;
  strategy: 'waste' | 'sheets' | 'balanced' | 'cost';
  showSimulator: boolean;
  showAlternatives: boolean;
  showComparison: boolean;
  showQuantitySuggestion: boolean;
}




export const DEFAULT_AUTO_SHEET_CONFIG: AutoSheetConfig = {
  enabled: false,
  gapMm: 3,
  marginMm: 5,
  allowRotation: true,
  strategy: 'balanced',
  showSimulator: true,
  showAlternatives: true,
  showComparison: true,
  showQuantitySuggestion: true,
};








export async function getAutoSheetConfig(
  shopDomain: string
): Promise<AutoSheetConfig> {
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { settings: true },
  });

  if (!shop) {
    return { ...DEFAULT_AUTO_SHEET_CONFIG };
  }

  const settings = (shop.settings as Record<string, unknown>) || {};
  const autoSheet = (settings.autoSheet as Partial<AutoSheetConfig>) || {};

  return {
    enabled: typeof autoSheet.enabled === 'boolean' ? autoSheet.enabled : DEFAULT_AUTO_SHEET_CONFIG.enabled,
    gapMm: typeof autoSheet.gapMm === 'number' ? autoSheet.gapMm : DEFAULT_AUTO_SHEET_CONFIG.gapMm,
    marginMm: typeof autoSheet.marginMm === 'number' ? autoSheet.marginMm : DEFAULT_AUTO_SHEET_CONFIG.marginMm,
    allowRotation: typeof autoSheet.allowRotation === 'boolean' ? autoSheet.allowRotation : DEFAULT_AUTO_SHEET_CONFIG.allowRotation,
    strategy: isValidStrategy(autoSheet.strategy) ? autoSheet.strategy! : DEFAULT_AUTO_SHEET_CONFIG.strategy,
    showSimulator: typeof autoSheet.showSimulator === 'boolean' ? autoSheet.showSimulator : DEFAULT_AUTO_SHEET_CONFIG.showSimulator,
    showAlternatives: typeof autoSheet.showAlternatives === 'boolean' ? autoSheet.showAlternatives : DEFAULT_AUTO_SHEET_CONFIG.showAlternatives,
    showComparison: typeof autoSheet.showComparison === 'boolean' ? autoSheet.showComparison : DEFAULT_AUTO_SHEET_CONFIG.showComparison,
    showQuantitySuggestion: typeof autoSheet.showQuantitySuggestion === 'boolean' ? autoSheet.showQuantitySuggestion : DEFAULT_AUTO_SHEET_CONFIG.showQuantitySuggestion,
  };
}









export async function saveAutoSheetConfig(
  shopDomain: string,
  config: Partial<AutoSheetConfig>
): Promise<AutoSheetConfig> {
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true, settings: true },
  });

  if (!shop) {
    throw new Error(`Shop not found: ${shopDomain}`);
  }

  const existingSettings = (shop.settings as Record<string, unknown>) || {};
  const existingAutoSheet = (existingSettings.autoSheet as Partial<AutoSheetConfig>) || {};


  const sanitized: Partial<AutoSheetConfig> = {};

  if (typeof config.enabled === 'boolean') {
    sanitized.enabled = config.enabled;
  }

  if (typeof config.gapMm === 'number' && config.gapMm >= 0 && config.gapMm <= 50) {
    sanitized.gapMm = config.gapMm;
  }

  if (typeof config.marginMm === 'number' && config.marginMm >= 0 && config.marginMm <= 50) {
    sanitized.marginMm = config.marginMm;
  }

  if (typeof config.allowRotation === 'boolean') {
    sanitized.allowRotation = config.allowRotation;
  }

  if (isValidStrategy(config.strategy)) {
    sanitized.strategy = config.strategy!;
  }

  if (typeof config.showSimulator === 'boolean') {
    sanitized.showSimulator = config.showSimulator;
  }

  if (typeof config.showAlternatives === 'boolean') {
    sanitized.showAlternatives = config.showAlternatives;
  }

  if (typeof config.showComparison === 'boolean') {
    sanitized.showComparison = config.showComparison;
  }

  if (typeof config.showQuantitySuggestion === 'boolean') {
    sanitized.showQuantitySuggestion = config.showQuantitySuggestion;
  }


  const mergedAutoSheet = {
    ...DEFAULT_AUTO_SHEET_CONFIG,
    ...existingAutoSheet,
    ...sanitized,
  };


  await prisma.shop.update({
    where: { id: shop.id },
    data: {
      settings: {
        ...existingSettings,
        autoSheet: mergedAutoSheet,
      },
    },
  });

  return mergedAutoSheet;
}




function isValidStrategy(
  strategy: string | undefined | null
): strategy is 'waste' | 'sheets' | 'balanced' | 'cost' {
  return ['waste', 'sheets', 'balanced', 'cost'].includes(strategy as string);
}








export function extractAutoSheetFromSettings(
  settings: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const raw = (settings || {}) as Record<string, unknown>;
  const autoSheet = (raw.autoSheet as Partial<AutoSheetConfig>) || {};

  return {
    enabled: typeof autoSheet.enabled === 'boolean' ? autoSheet.enabled : DEFAULT_AUTO_SHEET_CONFIG.enabled,
    gapMm: typeof autoSheet.gapMm === 'number' ? autoSheet.gapMm : DEFAULT_AUTO_SHEET_CONFIG.gapMm,
    marginMm: typeof autoSheet.marginMm === 'number' ? autoSheet.marginMm : DEFAULT_AUTO_SHEET_CONFIG.marginMm,
    allowRotation: typeof autoSheet.allowRotation === 'boolean' ? autoSheet.allowRotation : DEFAULT_AUTO_SHEET_CONFIG.allowRotation,
    strategy: isValidStrategy(autoSheet.strategy) ? autoSheet.strategy! : DEFAULT_AUTO_SHEET_CONFIG.strategy,
    showSimulator: typeof autoSheet.showSimulator === 'boolean' ? autoSheet.showSimulator : DEFAULT_AUTO_SHEET_CONFIG.showSimulator,
    showAlternatives: typeof autoSheet.showAlternatives === 'boolean' ? autoSheet.showAlternatives : DEFAULT_AUTO_SHEET_CONFIG.showAlternatives,
    showComparison: typeof autoSheet.showComparison === 'boolean' ? autoSheet.showComparison : DEFAULT_AUTO_SHEET_CONFIG.showComparison,
    showQuantitySuggestion: typeof autoSheet.showQuantitySuggestion === 'boolean' ? autoSheet.showQuantitySuggestion : DEFAULT_AUTO_SHEET_CONFIG.showQuantitySuggestion,
  };
}








export async function getAutoSheetStorefrontConfig(
  shopDomain: string
): Promise<Record<string, unknown>> {
  const config = await getAutoSheetConfig(shopDomain);

  return {
    enabled: config.enabled,
    gapMm: config.gapMm,
    marginMm: config.marginMm,
    allowRotation: config.allowRotation,
    strategy: config.strategy,
    showSimulator: config.showSimulator,
    showAlternatives: config.showAlternatives,
    showComparison: config.showComparison,
    showQuantitySuggestion: config.showQuantitySuggestion,
  };
}
