import {
  isWithinFinishedSheetLimit,
  normalizeFinishedSheet,
  validateFinishedSheetFit,
  type FinishedSheetWidthFailure,
} from './finishedSheetMeasurement'

export function variantIdsEqual(left: unknown, right: unknown): boolean {
  const normalize = (value: unknown) => {
    const text = String(value ?? '').trim()
    const gidMatch = text.match(/\/ProductVariant\/(\d+)$/)
    return gidMatch ? gidMatch[1] : text
  }

  const normalizedLeft = normalize(left)
  const normalizedRight = normalize(right)
  return normalizedLeft.length > 0 && normalizedLeft === normalizedRight
}

export interface ProductOptionDef {
  name: string
  values: string[]
}

export interface ProductVariantOption {
  name: string
  value: string
}

export interface ProductVariantDef {
  id: string
  title: string
  price: string | number | null
  available?: boolean
  availableForSale?: boolean
  option1?: string | null
  option2?: string | null
  option3?: string | null
  options?: string[]
  selectedOptions?: ProductVariantOption[]
}

export interface BuilderResolveConfig {
  sheetOptionName?: string | null
  widthOptionName?: string | null
  heightOptionName?: string | null
  modalOptionNames?: string[] | null
  /** The merchant-entered physical press limit. Nominal variant width is a label. */
  maxPrintableWidthIn?: number | null
  fitToleranceIn?: number | null
}

interface Measurement {
  widthInch: number
  heightInch: number
}

interface VariantFamily extends Measurement {
  key: string
  sheetValue: string
  displayName: string
  optionValuesByIndex: Record<number, string>
  variants: ProductVariantDef[]
}

interface VariantMatrix {
  optionDefs: ProductOptionDef[]
  dimensionMode: 'combined' | 'split'
  dimensionOptionIndexes: number[]
  sheetOptionIndex: number | null
  widthOptionIndex: number | null
  heightOptionIndex: number | null
  serviceOptionIndexes: number[]
  sheetFamilies: VariantFamily[]
}

interface FinishedSheetFit {
  efficiency: number
  placedWidthIn: number
  placedHeightIn: number
}

export interface SheetVariantResolution {
  selectedVariantId: string
  selectedVariantTitle: string
  selectedSheetLabel: string
  wholeSheetCopies: number
  requestedQuantity: number
  widthIn: number
  heightIn: number
  sheetWidthIn: number
  sheetHeightIn: number
  placedWidthIn: number
  placedHeightIn: number
}

function configuredPrintableWidth(config: BuilderResolveConfig): number | null {
  const maxPrintableWidthIn = Number(config.maxPrintableWidthIn)
  return Number.isFinite(maxPrintableWidthIn) && maxPrintableWidthIn > 0
    ? maxPrintableWidthIn
    : null
}

function configuredFitTolerance(config: BuilderResolveConfig): number {
  const fitToleranceIn = Number(config.fitToleranceIn)
  return Number.isFinite(fitToleranceIn) && fitToleranceIn >= 0 ? fitToleranceIn : 0
}

export function getFinishedSheetWidthFailure({
  widthIn,
  heightIn,
  config,
}: {
  widthIn: number
  heightIn: number
  config: BuilderResolveConfig
}): FinishedSheetWidthFailure | null {
  const maxPrintableWidthIn = configuredPrintableWidth(config)
  if (maxPrintableWidthIn == null) return null
  const result = validateFinishedSheetFit({
    widthIn,
    heightIn,
    maxPrintableWidthIn,
    fitToleranceIn: configuredFitTolerance(config),
  })
  return !result.ok && result.code === 'WIDTH_TOO_LARGE' ? result : null
}

function normalizeOptionName(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase()
}

function parseMeasurementValue(value: unknown): number | null {
  if (value == null || value === '') return null
  const cleaned = String(value)
    .replace(/["'′″]/g, '')
    .replace(/\binch(es)?\b/gi, '')
    .replace(/\bin\b/gi, '')
    .trim()
  const match = cleaned.match(/-?\d+(?:\.\d+)?/)
  if (!match) return null
  const parsed = parseFloat(match[0])
  return Number.isFinite(parsed) ? parsed : null
}

function parseSheetSize(value: unknown): Measurement | null {
  if (!value) return null

  const cleaned = String(value)
    .replace(/["'′″]/g, '')
    .replace(/\binch(es)?\b/gi, '')
    .replace(/\bin\b/gi, '')
    .trim()

  let match = cleaned.match(/(\d+(?:\.\d+)?)\s*[x×X]\s*(\d+(?:\.\d+)?)/)
  if (match) {
    return { widthInch: parseFloat(match[1]), heightInch: parseFloat(match[2]) }
  }

  match = cleaned.match(/(\d+(?:\.\d+)?)\s*by\s*(\d+(?:\.\d+)?)/i)
  if (match) {
    return { widthInch: parseFloat(match[1]), heightInch: parseFloat(match[2]) }
  }

  match = cleaned.match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/)
  if (match) {
    return { widthInch: parseFloat(match[1]), heightInch: parseFloat(match[2]) }
  }

  const numbers = cleaned.match(/(\d+(?:\.\d+)?)/g)
  if (numbers && numbers.length >= 2) {
    return { widthInch: parseFloat(numbers[0]), heightInch: parseFloat(numbers[1]) }
  }

  return null
}

function getOptionValue(variant: ProductVariantDef, optionIndex: number): string {
  const direct = variant[`option${optionIndex + 1}` as 'option1' | 'option2' | 'option3']
  if (typeof direct === 'string' && direct !== '') return direct
  if (variant.selectedOptions && variant.selectedOptions[optionIndex]) {
    return variant.selectedOptions[optionIndex].value || ''
  }
  if (Array.isArray(variant.options) && typeof variant.options[optionIndex] === 'string') {
    return variant.options[optionIndex] || ''
  }
  return ''
}

function findOptionIndexByName(optionDefs: ProductOptionDef[], optionName?: string | null): number {
  const normalized = normalizeOptionName(optionName)
  if (!normalized) return -1

  for (let i = 0; i < optionDefs.length; i += 1) {
    if (normalizeOptionName(optionDefs[i]?.name) === normalized) return i
  }
  return -1
}

function getOptionValueStats(optionDef: ProductOptionDef | undefined, index: number) {
  const values = Array.isArray(optionDef?.values) ? optionDef.values : []
  let parseableCount = 0
  let sheetSizeCount = 0
  const distinctValues: Record<string, true> = {}

  for (const value of values) {
    const measurement = parseMeasurementValue(value)
    if (measurement != null) {
      parseableCount += 1
      distinctValues[String(measurement)] = true
    }
    if (parseSheetSize(value)) {
      sheetSizeCount += 1
    }
  }

  return {
    index,
    name: optionDef?.name || `Option ${index + 1}`,
    parseableCount,
    sheetSizeCount,
    distinctCount: Object.keys(distinctValues).length,
    totalValues: values.length,
  }
}

function getDimensionNameScore(optionName: string, role: 'width' | 'height'): number {
  const normalized = normalizeOptionName(optionName)
  if (!normalized) return 0

  let score = 0
  if (role === 'width') {
    if (normalized.includes('width')) score += 20
    if (normalized.includes('wide')) score += 8
    if (normalized.includes('sheet')) score += 2
  } else {
    if (normalized.includes('height')) score += 20
    if (normalized.includes('length')) score += 16
    if (normalized.includes('long')) score += 8
    if (normalized.includes('sheet')) score += 2
  }
  if (normalized.includes('size')) score += 2
  return score
}

function detectCombinedDimensionOptionIndex(
  optionDefs: ProductOptionDef[],
  config: BuilderResolveConfig
): number {
  const configuredIndex = findOptionIndexByName(optionDefs, config.sheetOptionName)
  if (configuredIndex >= 0) {
    const configuredStats = getOptionValueStats(optionDefs[configuredIndex], configuredIndex)
    if (configuredStats.sheetSizeCount > 0) return configuredIndex
  }

  let bestIndex = -1
  let bestScore = -1

  for (let i = 0; i < optionDefs.length; i += 1) {
    const stats = getOptionValueStats(optionDefs[i], i)
    if (stats.sheetSizeCount <= 0) continue
    const score = stats.sheetSizeCount * 10 + stats.distinctCount
    if (score > bestScore) {
      bestScore = score
      bestIndex = i
    }
  }

  return bestIndex
}

function detectSplitDimensionOptionIndexes(
  optionDefs: ProductOptionDef[],
  config: BuilderResolveConfig
): { widthIndex: number; heightIndex: number } | null {
  const metas = optionDefs
    .map((optionDef, index) => getOptionValueStats(optionDef, index))
    .filter((meta) => meta.parseableCount > 0)

  if (metas.length < 2) return null

  const configuredWidthIndex = findOptionIndexByName(optionDefs, config.widthOptionName)
  const configuredHeightIndex = findOptionIndexByName(optionDefs, config.heightOptionName)

  let widthMeta = metas.find((meta) => meta.index === configuredWidthIndex) || null
  let heightMeta = metas.find((meta) => meta.index === configuredHeightIndex) || null

  if (!widthMeta) {
    widthMeta = metas
      .slice()
      .sort((a, b) => {
        const scoreA =
          getDimensionNameScore(a.name, 'width') * 100 + (100 - a.distinctCount) + a.parseableCount
        const scoreB =
          getDimensionNameScore(b.name, 'width') * 100 + (100 - b.distinctCount) + b.parseableCount
        return scoreB - scoreA
      })[0]
  }

  if (!heightMeta) {
    const remaining = metas.filter((meta) => !widthMeta || meta.index !== widthMeta.index)
    if (!remaining.length) return null
    heightMeta = remaining
      .slice()
      .sort((a, b) => {
        const scoreA =
          getDimensionNameScore(a.name, 'height') * 100 + a.distinctCount * 10 + a.parseableCount
        const scoreB =
          getDimensionNameScore(b.name, 'height') * 100 + b.distinctCount * 10 + b.parseableCount
        return scoreB - scoreA
      })[0]
  }

  if (!widthMeta || !heightMeta || widthMeta.index === heightMeta.index) return null

  return {
    widthIndex: widthMeta.index,
    heightIndex: heightMeta.index,
  }
}

function detectDimensionConfig(optionDefs: ProductOptionDef[], config: BuilderResolveConfig) {
  const configuredCombinedIndex = findOptionIndexByName(optionDefs, config.sheetOptionName)
  if (configuredCombinedIndex >= 0) {
    const configuredStats = getOptionValueStats(optionDefs[configuredCombinedIndex], configuredCombinedIndex)
    if (configuredStats.sheetSizeCount > 0) {
      return {
        mode: 'combined' as const,
        indexes: [configuredCombinedIndex],
        combinedIndex: configuredCombinedIndex,
      }
    }
  }

  const configuredSplit = detectSplitDimensionOptionIndexes(optionDefs, config)
  if (configuredSplit && (config.widthOptionName || config.heightOptionName)) {
    return {
      mode: 'split' as const,
      indexes: [configuredSplit.widthIndex, configuredSplit.heightIndex],
      widthIndex: configuredSplit.widthIndex,
      heightIndex: configuredSplit.heightIndex,
    }
  }

  const combinedIndex = detectCombinedDimensionOptionIndex(optionDefs, config)
  if (combinedIndex >= 0) {
    return {
      mode: 'combined' as const,
      indexes: [combinedIndex],
      combinedIndex,
    }
  }

  const splitIndexes = detectSplitDimensionOptionIndexes(optionDefs, config)
  if (splitIndexes) {
    return {
      mode: 'split' as const,
      indexes: [splitIndexes.widthIndex, splitIndexes.heightIndex],
      widthIndex: splitIndexes.widthIndex,
      heightIndex: splitIndexes.heightIndex,
    }
  }

  return null
}

function buildVariantMatrix(
  variants: ProductVariantDef[],
  optionDefs: ProductOptionDef[],
  config: BuilderResolveConfig
): VariantMatrix | null {
  if (!variants.length || !optionDefs.length) return null

  const dimensionConfig = detectDimensionConfig(optionDefs, config)
  if (!dimensionConfig || !dimensionConfig.indexes.length) return null

  const configuredModalNames = Array.isArray(config.modalOptionNames)
    ? config.modalOptionNames.map((name) => normalizeOptionName(name))
    : []

  const serviceOptionIndexes: number[] = []
  for (let i = 0; i < optionDefs.length; i += 1) {
    if (dimensionConfig.indexes.includes(i)) continue
    if (!configuredModalNames.length || configuredModalNames.includes(normalizeOptionName(optionDefs[i]?.name))) {
      serviceOptionIndexes.push(i)
    }
  }

  const familiesByKey: Record<string, VariantFamily> = {}

  for (const variant of variants) {
    const available = variant.available !== false && variant.availableForSale !== false
    if (!available) continue

    let dims: Measurement | null = null
    let familyLabel = ''
    const optionValuesByIndex: Record<number, string> = {}

    if (dimensionConfig.mode === 'combined') {
      const sheetValue = getOptionValue(variant, dimensionConfig.combinedIndex)
      dims = parseSheetSize(sheetValue)
      if (dims) {
        optionValuesByIndex[dimensionConfig.combinedIndex] = sheetValue
        familyLabel = sheetValue || `${dims.widthInch}" x ${dims.heightInch}"`
      }
    } else {
      const widthValue = getOptionValue(variant, dimensionConfig.widthIndex)
      const heightValue = getOptionValue(variant, dimensionConfig.heightIndex)
      const widthInch = parseMeasurementValue(widthValue)
      const heightInch = parseMeasurementValue(heightValue)
      if (widthInch != null && heightInch != null) {
        dims = { widthInch, heightInch }
        optionValuesByIndex[dimensionConfig.widthIndex] = widthValue
        optionValuesByIndex[dimensionConfig.heightIndex] = heightValue
        familyLabel = `${widthValue || widthInch}" x ${heightValue || heightInch}"`
      }
    }

    if (!dims || dims.widthInch < 0.01 || dims.heightInch < 0.01) continue

    const familyKey = `${dims.widthInch}x${dims.heightInch}`
    if (!familiesByKey[familyKey]) {
      familiesByKey[familyKey] = {
        key: familyKey,
        sheetValue: familyLabel,
        displayName: familyLabel || `${dims.widthInch}" x ${dims.heightInch}"`,
        widthInch: dims.widthInch,
        heightInch: dims.heightInch,
        optionValuesByIndex,
        variants: [],
      }
    }
    familiesByKey[familyKey].variants.push(variant)
  }

  return {
    optionDefs,
    dimensionMode: dimensionConfig.mode,
    dimensionOptionIndexes: dimensionConfig.indexes.slice(),
    sheetOptionIndex: dimensionConfig.mode === 'combined' ? dimensionConfig.combinedIndex : null,
    widthOptionIndex: dimensionConfig.mode === 'split' ? dimensionConfig.widthIndex : null,
    heightOptionIndex: dimensionConfig.mode === 'split' ? dimensionConfig.heightIndex : null,
    serviceOptionIndexes,
    sheetFamilies: Object.values(familiesByKey),
  }
}

function getSelectedServiceOptionValues(
  matrix: VariantMatrix,
  variants: ProductVariantDef[],
  selectedVariantId?: string | null
): Record<number, string> {
  const values: Record<number, string> = {}
  const selectedVariant = selectedVariantId
    ? variants.find((variant) => variantIdsEqual(variant.id, selectedVariantId))
    : null

  if (!selectedVariant) return values

  for (const optionIndex of matrix.serviceOptionIndexes) {
    const optionValue = getOptionValue(selectedVariant, optionIndex)
    if (optionValue) values[optionIndex] = optionValue
  }

  return values
}

function resolveVariantForFamily(
  family: VariantFamily,
  matrix: VariantMatrix,
  selectedServiceValues: Record<number, string>
): ProductVariantDef | null {
  for (const variant of family.variants) {
    let matched = true
    for (const optionIndex of matrix.serviceOptionIndexes) {
      const selectedValue = selectedServiceValues[optionIndex]
      if (selectedValue && getOptionValue(variant, optionIndex) !== selectedValue) {
        matched = false
        break
      }
    }
    if (matched) return variant
  }

  if (Object.keys(selectedServiceValues).length > 0) return null
  return family.variants[0] || null
}

function calculateFinishedSheetFit(
  design: Measurement,
  sheet: Measurement,
  fitToleranceIn: number,
  maxPrintableWidthIn: number | null
): FinishedSheetFit | null {
  // A gang-sheet upload is already the production sheet. Either edge may run
  // cross-roll as long as it stays within the printable width; the film the
  // shop actually consumes is the other edge. A 12 x 22 file therefore belongs
  // on a 22 x 12 sheet, not a 22 x 24 one — billing the long edge whenever it
  // also fits across the roll overcharged the customer for twice the film.
  const firstIn = Number(design.widthInch)
  const secondIn = Number(design.heightInch)
  if (!(firstIn > 0) || !(secondIn > 0)) return null
  if (!(sheet.widthInch > 0) || !(sheet.heightInch > 0)) return null

  const shortEdgeIn = Math.min(firstIn, secondIn)
  const longEdgeIn = Math.max(firstIn, secondIn)
  const orientations = [
    { crossRollIn: shortEdgeIn, alongRollIn: longEdgeIn },
    { crossRollIn: longEdgeIn, alongRollIn: shortEdgeIn },
  ]

  let chosen: { crossRollIn: number; alongRollIn: number } | null = null
  for (const orientation of orientations) {
    if (
      maxPrintableWidthIn != null &&
      !isWithinFinishedSheetLimit(orientation.crossRollIn, maxPrintableWidthIn, fitToleranceIn)
    ) {
      continue
    }
    if (!isWithinFinishedSheetLimit(orientation.alongRollIn, sheet.heightInch, fitToleranceIn)) {
      continue
    }
    // Prefer the orientation that consumes the least film.
    if (!chosen || orientation.alongRollIn < chosen.alongRollIn) chosen = orientation
  }
  if (!chosen) return null

  const designWidthIn = chosen.crossRollIn
  const designLengthIn = chosen.alongRollIn
  // Shopify sheet sizes retain their commercial width × length meaning. The
  // first value is the nominal product width and the second is the amount of
  // film sold. Only the uploaded file is orientation-normalized.
  const sheetWidthIn = sheet.widthInch
  const sheetLengthIn = sheet.heightInch

  const designArea = designWidthIn * designLengthIn
  const sheetArea = sheetWidthIn * sheetLengthIn
  return {
    efficiency: sheetArea > 0 ? designArea / sheetArea : 0,
    placedWidthIn: designWidthIn,
    placedHeightIn: designLengthIn,
  }
}

export function resolveSheetVariant({
  widthIn,
  heightIn,
  quantity,
  variants,
  optionDefs,
  selectedVariantId,
  config,
}: {
  widthIn: number
  heightIn: number
  quantity: number
  variants: ProductVariantDef[]
  optionDefs: ProductOptionDef[]
  selectedVariantId?: string | null
  config: BuilderResolveConfig
}): SheetVariantResolution | null {
  if (!(widthIn > 0) || !(heightIn > 0) || !(quantity > 0)) return null

  const matrix = buildVariantMatrix(variants, optionDefs, config)
  if (!matrix || !matrix.sheetFamilies.length) return null

  const selectedServiceValues = getSelectedServiceOptionValues(matrix, variants, selectedVariantId)
  const design = { widthInch: widthIn, heightInch: heightIn }
  const requestedQuantity = Math.max(1, Math.floor(quantity))
  // The short edge is the only cross-roll candidate. The merchant-visible
  // fit tolerance is the sole allowance; no alternate orientation can help.
  if (getFinishedSheetWidthFailure({ widthIn, heightIn, config })) return null

  const fitToleranceIn = configuredFitTolerance(config)
  const maxPrintableWidthIn = configuredPrintableWidth(config)

  const validResults = matrix.sheetFamilies
    .map((family) => {
      const variant = resolveVariantForFamily(family, matrix, selectedServiceValues)
      if (!variant) return null

      const sheetFit = calculateFinishedSheetFit(design, family, fitToleranceIn, maxPrintableWidthIn)
      if (!sheetFit) return null

      return {
        family,
        variant,
        sheetFit,
        efficiency: sheetFit.efficiency,
      }
    })
    .filter((result): result is NonNullable<typeof result> => Boolean(result))
    .sort((a, b) => {
      // Selection is physical, not a layout/cost optimization: choose the
      // smallest available sheet that contains one complete uploaded file.
      const lengthA = a.family.heightInch
      const lengthB = b.family.heightInch
      if (lengthA !== lengthB) return lengthA - lengthB
      const widthA = a.family.widthInch
      const widthB = b.family.widthInch
      if (widthA !== widthB) return widthA - widthB
      return b.efficiency - a.efficiency
    })

  if (!validResults.length) return null

  const selected = validResults[0]
  return {
    selectedVariantId: selected.variant.id,
    selectedVariantTitle: selected.variant.title,
    selectedSheetLabel: selected.family.displayName,
    wholeSheetCopies: requestedQuantity,
    requestedQuantity,
    widthIn: Math.min(widthIn, heightIn),
    heightIn: Math.max(widthIn, heightIn),
    sheetWidthIn: selected.family.widthInch,
    sheetHeightIn: selected.family.heightInch,
    placedWidthIn: selected.sheetFit.placedWidthIn,
    placedHeightIn: selected.sheetFit.placedHeightIn,
  }
}
