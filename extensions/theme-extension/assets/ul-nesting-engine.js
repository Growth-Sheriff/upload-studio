;(function() {
  'use strict';

  var RETIREMENT_CODE = 'LEGACY_LAYOUT_RETIRED';
  var RETIREMENT_MESSAGE = 'Automatic layout is retired. Upload the finished gang sheet on its product page.';

  function retiredGridResult() {
    return {
      count: 0,
      cols: 0,
      rows: 0,
      rotated: false,
      placements: [],
      error: RETIREMENT_CODE,
      message: RETIREMENT_MESSAGE,
      retired: true,
    };
  }

  function retiredNestingResult() {
    return {
      sheetsNeeded: 0,
      designsPerSheet: 0,
      totalCost: 0,
      layouts: [],
      placements: [],
      recommended: false,
      error: RETIREMENT_CODE,
      message: RETIREMENT_MESSAGE,
      retired: true,
    };
  }

  function calculateGridFit() {
    return retiredGridResult();
  }

  function nestDesigns() {
    return retiredNestingResult();
  }

  function nestAllVariants() {
    return [];
  }

  function parseSheetSize(variantName) {
    if (!variantName) return null;
    var cleaned = String(variantName)
      .replace(/["'']/g, '')
      .replace(/\binch(es)?\b/gi, '')
      .replace(/\bin\b/gi, '')
      .trim();
    var match = cleaned.match(/(\d+(?:\.\d+)?)\s*(?:[x×]|by)\s*(\d+(?:\.\d+)?)/i);
    if (!match) {
      var numbers = cleaned.match(/(\d+(?:\.\d+)?)/g);
      if (!numbers || numbers.length < 2) return null;
      match = [numbers[0] + 'x' + numbers[1], numbers[0], numbers[1]];
    }
    return { widthInch: parseFloat(match[1]), heightInch: parseFloat(match[2]) };
  }

  function variantsToSheets(variants) {
    if (!Array.isArray(variants)) return [];
    var sheets = [];
    for (var i = 0; i < variants.length; i++) {
      var variant = variants[i] || {};
      var dimensions = parseSheetSize(variant.title || variant.option1 || '');
      if (!dimensions || dimensions.widthInch < 1 || dimensions.heightInch < 1) continue;
      sheets.push({
        id: variant.id ? String(variant.id) : 'variant_' + i,
        name: dimensions.widthInch + '" × ' + dimensions.heightInch + '"',
        widthInch: dimensions.widthInch,
        heightInch: dimensions.heightInch,
        price: parseFloat(variant.price || 0) / 100,
        variantId: variant.id,
      });
    }
    return sheets;
  }

  function formatArea(squareInches) {
    var value = Number(squareInches);
    return (Number.isFinite(value) ? parseFloat(value.toFixed(1)) : 0) + ' in²';
  }

  function getEfficiencyTier() {
    return 'retired';
  }

  window.ULNestingEngine = {
    nestDesigns: nestDesigns,
    nestAllVariants: nestAllVariants,
    calculateGridFit: calculateGridFit,
    parseSheetSize: parseSheetSize,
    variantsToSheets: variantsToSheets,
    formatArea: formatArea,
    getEfficiencyTier: getEfficiencyTier,
    DEFAULT_CONFIG: { retired: true },
    RETIREMENT_CODE: RETIREMENT_CODE,
    retired: true,
  };
})();
