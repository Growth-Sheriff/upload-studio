const MIN_MARGIN_IN = 0

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
  artboardMarginIn?: number | null
  imageMarginIn?: number | null
  fitToleranceIn?: number | null
  /** Maximum cross-roll artwork width. Rotation may make the uploaded height
   * the cross-roll edge. */
  maxDesignWidthIn?: number | null
  /** Maximum physical roll/sheet short edge offered by this shop. */
  maxSheetWidthIn?: number | null
  selectionStrategy?: 'lowest_total_cost' | 'smallest_fitting_sheet' | null
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

interface FitGridResult {
  count: number
  efficiency: number
  placementMode: 'normal' | 'rotated' | 'mixed'
  rotationApplied: boolean
  rotationRequired: boolean
  toleranceApplied: boolean
  placedWidthIn: number
  placedHeightIn: number
}

export interface SheetVariantResolution {
  selectedVariantId: string
  selectedVariantTitle: string
  selectedSheetLabel: string
  designsPerSheet: number
  sheetsNeeded: number
  requestedQuantity: number
  widthIn: number
  heightIn: number
  sheetWidthIn: number
  sheetHeightIn: number
  placementMode: 'normal' | 'rotated' | 'mixed'
  rotationApplied: boolean
  rotationRequired: boolean
  toleranceApplied: boolean
  placedWidthIn: number
  placedHeightIn: number
  productionNote: string | null
}

function normalizeMarginIn(value: number | null | undefined): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < MIN_MARGIN_IN) return MIN_MARGIN_IN
  return parsed
}

function normalizeToleranceIn(value: number | null | undefined): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return 0
  return parsed
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

function normalizeVariantPriceToDollars(rawPrice: string | number | null): number {
  if (rawPrice == null || rawPrice === '') return 0
  if (typeof rawPrice === 'string') {
    if (rawPrice.includes('.')) return parseFloat(rawPrice) || 0
    const asInt = parseInt(rawPrice, 10)
    return Number.isFinite(asInt) ? asInt / 100 : 0
  }
  const numeric = Number(rawPrice)
  return Number.isFinite(numeric) ? numeric / 100 : 0
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

interface OrientationFit {
  count: number
  placedWidthIn: number
  placedHeightIn: number
  toleranceApplied: boolean
}

function clampWithinTolerance(value: number, limit: number, tolerance: number) {
  if (!(value > 0) || !(limit > 0)) return { value, fits: false, clamped: false }
  if (value <= limit) return { value, fits: true, clamped: false }
  if (value <= limit + tolerance) return { value: limit, fits: true, clamped: true }
  return { value, fits: false, clamped: false }
}

function fitOrientation(
  designWidth: number,
  designHeight: number,
  usableWidth: number,
  usableHeight: number,
  gap: number,
  tolerance: number,
  maxDesignWidth: number | null
): OrientationFit {
  const crossRollLimit = maxDesignWidth && maxDesignWidth > 0
    ? Math.min(usableWidth, maxDesignWidth)
    : usableWidth
  const width = clampWithinTolerance(designWidth, crossRollLimit, tolerance)
  const height = clampWithinTolerance(designHeight, usableHeight, tolerance)
  if (!width.fits || !height.fits) {
    return {
      count: 0,
      placedWidthIn: designWidth,
      placedHeightIn: designHeight,
      toleranceApplied: false,
    }
  }

  const cols = Math.floor((usableWidth + gap) / (width.value + gap))
  const rows = Math.floor((usableHeight + gap) / (height.value + gap))
  return {
    count: cols > 0 && rows > 0 ? cols * rows : 0,
    placedWidthIn: width.value,
    placedHeightIn: height.value,
    toleranceApplied: width.clamped || height.clamped,
  }
}

function fitGridMixed(
  normal: OrientationFit,
  rotated: OrientationFit,
  usableWidth: number,
  usableHeight: number,
  gap: number
): number {
  if (normal.count <= 0 || rotated.count <= 0) return 0
  const normalCols = Math.floor((usableWidth + gap) / (normal.placedWidthIn + gap))
  const rotatedCols = Math.floor((usableWidth + gap) / (rotated.placedWidthIn + gap))
  if (normalCols <= 0 || rotatedCols <= 0) return 0

  // A per-row density choice is not globally optimal because the final strip
  // can fit rows of the other orientation. Enumerate the bounded number of
  // normal rows and fill the remaining height with rotated rows.
  const maxNormalRows = Math.floor(
    (usableHeight + gap) / (normal.placedHeightIn + gap)
  )
  let bestCount = 0
  for (let normalRows = 0; normalRows <= maxNormalRows; normalRows += 1) {
    const normalHeight =
      normalRows * normal.placedHeightIn + Math.max(0, normalRows - 1) * gap
    const remainingHeight = usableHeight - normalHeight
    const rotatedRows =
      normalRows > 0
        ? Math.max(0, Math.floor((remainingHeight + 1e-9) / (rotated.placedHeightIn + gap)))
        : Math.max(
            0,
            Math.floor((remainingHeight + gap + 1e-9) / (rotated.placedHeightIn + gap))
          )
    bestCount = Math.max(
      bestCount,
      normalRows * normalCols + rotatedRows * rotatedCols
    )
  }
  return bestCount
}

function calculateGridFit(
  design: Measurement,
  sheet: Measurement,
  config: BuilderResolveConfig
): FitGridResult {
  const gap = normalizeMarginIn(config.imageMarginIn)
  const margin = normalizeMarginIn(config.artboardMarginIn)
  // Treat the short sheet edge as cross-roll regardless of how a merchant's
  // variant title happens to order its dimensions.
  const usableWidth = Math.min(sheet.widthInch, sheet.heightInch) - 2 * margin
  const usableHeight = Math.max(sheet.widthInch, sheet.heightInch) - 2 * margin
  const tolerance = normalizeToleranceIn(config.fitToleranceIn)
  const configuredMaxDesignWidth = Number(config.maxDesignWidthIn)
  const maxDesignWidth = Number.isFinite(configuredMaxDesignWidth) && configuredMaxDesignWidth > 0
    ? configuredMaxDesignWidth
    : null

  if (usableWidth <= 0 || usableHeight <= 0) {
    return {
      count: 0,
      efficiency: 0,
      placementMode: 'normal',
      rotationApplied: false,
      rotationRequired: false,
      toleranceApplied: false,
      placedWidthIn: design.widthInch,
      placedHeightIn: design.heightInch,
    }
  }

  const normal = fitOrientation(
    design.widthInch,
    design.heightInch,
    usableWidth,
    usableHeight,
    gap,
    tolerance,
    maxDesignWidth
  )
  const rotated = design.widthInch !== design.heightInch
    ? fitOrientation(
        design.heightInch,
        design.widthInch,
        usableWidth,
        usableHeight,
        gap,
        tolerance,
        maxDesignWidth
      )
    : { ...normal, count: 0 }
  const mixedCount = design.widthInch !== design.heightInch
    ? fitGridMixed(normal, rotated, usableWidth, usableHeight, gap)
    : 0

  const candidates = [
    { mode: 'normal' as const, ...normal },
    { mode: 'rotated' as const, ...rotated },
    {
      mode: 'mixed' as const,
      count: mixedCount,
      placedWidthIn: normal.placedWidthIn,
      placedHeightIn: normal.placedHeightIn,
      toleranceApplied: normal.toleranceApplied || rotated.toleranceApplied,
    },
  ].sort((a, b) => b.count - a.count)
  const selected = candidates[0]
  if (selected.count <= 0) {
    return {
      count: 0,
      efficiency: 0,
      placementMode: 'normal',
      rotationApplied: false,
      rotationRequired: false,
      toleranceApplied: false,
      placedWidthIn: design.widthInch,
      placedHeightIn: design.heightInch,
    }
  }

  const designArea = design.widthInch * design.heightInch
  const sheetArea = sheet.widthInch * sheet.heightInch
  const efficiency = sheetArea > 0 ? (selected.count * designArea) / sheetArea : 0

  return {
    count: selected.count,
    efficiency,
    placementMode: selected.mode,
    rotationApplied: selected.mode !== 'normal',
    rotationRequired: normal.count <= 0 && selected.mode !== 'normal',
    toleranceApplied: selected.toleranceApplied,
    placedWidthIn: selected.placedWidthIn,
    placedHeightIn: selected.placedHeightIn,
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
  const configuredMaxSheetWidth = Number(config.maxSheetWidthIn)
  const maxSheetWidth = Number.isFinite(configuredMaxSheetWidth) && configuredMaxSheetWidth > 0
    ? configuredMaxSheetWidth
    : null

  const validResults = matrix.sheetFamilies
    .map((family) => {
      if (maxSheetWidth && Math.min(family.widthInch, family.heightInch) > maxSheetWidth + 0.001) {
        return null
      }
      const variant = resolveVariantForFamily(family, matrix, selectedServiceValues)
      if (!variant) return null

      const gridFit = calculateGridFit(design, family, config)
      if (gridFit.count <= 0) return null

      const sheetsNeeded = Math.ceil(requestedQuantity / gridFit.count)
      const variantPrice = normalizeVariantPriceToDollars(variant.price)
      const totalCost = sheetsNeeded * variantPrice

      return {
        family,
        variant,
        gridFit,
        designsPerSheet: gridFit.count,
        sheetsNeeded,
        totalCost,
        efficiency: gridFit.efficiency,
      }
    })
    .filter((result): result is NonNullable<typeof result> => Boolean(result))
    .sort((a, b) => {
      if (config.selectionStrategy === 'smallest_fitting_sheet') {
        const areaA = a.family.widthInch * a.family.heightInch
        const areaB = b.family.widthInch * b.family.heightInch
        if (areaA !== areaB) return areaA - areaB
        if (a.sheetsNeeded !== b.sheetsNeeded) return a.sheetsNeeded - b.sheetsNeeded
        if (a.totalCost !== b.totalCost) return a.totalCost - b.totalCost
        return b.efficiency - a.efficiency
      }
      if (a.totalCost !== b.totalCost) return a.totalCost - b.totalCost
      if (a.sheetsNeeded !== b.sheetsNeeded) return a.sheetsNeeded - b.sheetsNeeded
      return b.efficiency - a.efficiency
    })

  if (!validResults.length) return null

  const selected = validResults[0]
  const notes: string[] = []
  if (selected.gridFit.placementMode === 'rotated') notes.push('Rotate artwork 90°')
  if (selected.gridFit.placementMode === 'mixed') notes.push('Use mixed normal/rotated placement')
  if (selected.gridFit.toleranceApplied) {
    notes.push(
      `Fit tolerance applied at ${selected.gridFit.placedWidthIn.toFixed(2)}" × ${selected.gridFit.placedHeightIn.toFixed(2)}"`
    )
  }
  return {
    selectedVariantId: selected.variant.id,
    selectedVariantTitle: selected.variant.title,
    selectedSheetLabel: selected.family.displayName,
    designsPerSheet: selected.designsPerSheet,
    sheetsNeeded: selected.sheetsNeeded,
    requestedQuantity,
    widthIn,
    heightIn,
    sheetWidthIn: selected.family.widthInch,
    sheetHeightIn: selected.family.heightInch,
    placementMode: selected.gridFit.placementMode,
    rotationApplied: selected.gridFit.rotationApplied,
    rotationRequired: selected.gridFit.rotationRequired,
    toleranceApplied: selected.gridFit.toleranceApplied,
    placedWidthIn: selected.gridFit.placedWidthIn,
    placedHeightIn: selected.gridFit.placedHeightIn,
    productionNote: notes.length ? notes.join('; ') : null,
  }
}
