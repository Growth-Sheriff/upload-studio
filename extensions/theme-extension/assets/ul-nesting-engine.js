

(function () {
  'use strict';

  if (window.ULNestingEngine) return;

  var DEFAULT_CONFIG = {
    gapMm: 3,
    marginMm: 5,
    allowRotation: true,
    strategy: 'balanced',
  };

  function mmToInch(mm) {
    return mm / 25.4;
  }

  function calculateGridFit(design, sheet, config) {
    var gap = mmToInch(config.gapMm);
    var margin = mmToInch(config.marginMm);

    var usableWidth = sheet.widthInch - 2 * margin;
    var usableHeight = sheet.heightInch - 2 * margin;

    if (usableWidth <= 0 || usableHeight <= 0) {
      return { count: 0, placements: [], rotated: false };
    }

    var normalResult = fitGrid(
      design.widthInch,
      design.heightInch,
      usableWidth,
      usableHeight,
      gap,
      margin,
      false
    );

    var rotatedResult = { count: 0, placements: [], rotated: true };

    if (config.allowRotation && design.widthInch !== design.heightInch) {
      rotatedResult = fitGrid(
        design.heightInch,
        design.widthInch,
        usableWidth,
        usableHeight,
        gap,
        margin,
        true
      );
    }

    var mixedResult = { count: 0, placements: [], rotated: false };
    if (config.allowRotation && design.widthInch !== design.heightInch) {
      mixedResult = fitGridMixed(
        design.widthInch,
        design.heightInch,
        usableWidth,
        usableHeight,
        gap,
        margin
      );
    }

    if (mixedResult.count >= normalResult.count && mixedResult.count >= rotatedResult.count) {
      return mixedResult;
    }
    if (rotatedResult.count >= normalResult.count) {
      return rotatedResult;
    }
    return normalResult;
  }

  function fitGrid(dw, dh, uw, uh, gap, margin, rotated) {
    if (dw <= 0 || dh <= 0 || dw > uw || dh > uh) {
      return { count: 0, placements: [], rotated: rotated };
    }

    var cols = Math.floor((uw + gap) / (dw + gap));
    var rows = Math.floor((uh + gap) / (dh + gap));

    if (cols <= 0 || rows <= 0) {
      return { count: 0, placements: [], rotated: rotated };
    }

    var placements = [];
    var index = 0;

    for (var row = 0; row < rows; row++) {
      for (var col = 0; col < cols; col++) {
        placements.push({
          x: margin + col * (dw + gap),
          y: margin + row * (dh + gap),
          width: dw,
          height: dh,
          rotated: rotated,
          index: index++,
        });
      }
    }

    return {
      count: cols * rows,
      placements: placements,
      rotated: rotated,
    };
  }

  function fitGridMixed(dw, dh, uw, uh, gap, margin) {
    var placements = [];
    var index = 0;
    var y = 0;

    var normalCols = dw > 0 ? Math.floor((uw + gap) / (dw + gap)) : 0;
    var rotatedCols = dh > 0 ? Math.floor((uw + gap) / (dh + gap)) : 0;

    while (y < uh) {

      var normalFits = false;
      if (y + dh <= uh && normalCols > 0) {
        normalFits = true;
      }

      var rotatedFits = false;
      if (y + dw <= uh && rotatedCols > 0) {
        rotatedFits = true;
      }

      if (!normalFits && !rotatedFits) break;

      var useRotated = false;
      var rowHeight = dh;
      var rowCols = normalCols;

      if (normalFits && rotatedFits) {

        var normalDensity = normalCols / dh;
        var rotatedDensity = rotatedCols / dw;
        if (rotatedDensity > normalDensity) {
          useRotated = true;
          rowHeight = dw;
          rowCols = rotatedCols;
        }
      } else if (rotatedFits) {
        useRotated = true;
        rowHeight = dw;
        rowCols = rotatedCols;
      }

      var placedWidth = useRotated ? dh : dw;
      var placedHeight = useRotated ? dw : dh;

      for (var col = 0; col < rowCols; col++) {
        placements.push({
          x: margin + col * (placedWidth + gap),
          y: margin + y,
          width: placedWidth,
          height: placedHeight,
          rotated: useRotated,
          index: index++,
        });
      }

      y += rowHeight + gap;
    }

    return {
      count: placements.length,
      placements: placements,
      rotated: false,
    };
  }

  function nestDesigns(design, sheet, config) {
    config = Object.assign({}, DEFAULT_CONFIG, config || {});

    var gridResult = calculateGridFit(design, sheet, config);
    var designsPerSheet = gridResult.count;

    if (designsPerSheet === 0) {
      return {
        sheet: sheet,
        sheetsNeeded: 0,
        designsPerSheet: 0,
        totalDesigns: 0,
        wastePercent: 100,
        efficiency: 0,
        layouts: [],
        totalCost: 0,
        costPerDesign: Infinity,
        error: 'Design too large for this sheet',
      };
    }

    var quantity = design.quantity;
    var sheetsNeeded = Math.ceil(quantity / designsPerSheet);

    var layouts = [];
    var totalUsedArea = 0;
    var designArea = design.widthInch * design.heightInch;
    var sheetArea = sheet.widthInch * sheet.heightInch;

    for (var s = 0; s < sheetsNeeded; s++) {
      var designsOnThisSheet = Math.min(designsPerSheet, quantity - s * designsPerSheet);

      var sheetPlacements = [];
      for (var d = 0; d < designsOnThisSheet; d++) {
        var placement = Object.assign({}, gridResult.placements[d]);
        placement.index = s * designsPerSheet + d;
        sheetPlacements.push(placement);
      }

      var usedArea = designsOnThisSheet * designArea;
      totalUsedArea += usedArea;

      layouts.push({
        sheetIndex: s,
        placements: sheetPlacements,
        usedArea: parseFloat(usedArea.toFixed(2)),
        totalArea: parseFloat(sheetArea.toFixed(2)),
        efficiency: parseFloat(((usedArea / sheetArea) * 100).toFixed(1)),
      });
    }

    var avgEfficiency = totalUsedArea / (sheetsNeeded * sheetArea) * 100;
    var totalCost = sheetsNeeded * (sheet.price || 0);
    var costPerDesign = quantity > 0 ? totalCost / quantity : 0;

    return {
      sheet: sheet,
      sheetsNeeded: sheetsNeeded,
      designsPerSheet: designsPerSheet,
      totalDesigns: quantity,
      wastePercent: parseFloat((100 - avgEfficiency).toFixed(1)),
      efficiency: parseFloat(avgEfficiency.toFixed(1)),
      layouts: layouts,
      totalCost: parseFloat(totalCost.toFixed(2)),
      costPerDesign: parseFloat(costPerDesign.toFixed(2)),
    };
  }

  function nestAllVariants(design, sheets, config) {
    if (!design || !sheets || sheets.length === 0) {
      return [];
    }

    config = Object.assign({}, DEFAULT_CONFIG, config || {});

    var results = [];

    for (var i = 0; i < sheets.length; i++) {
      var result = nestDesigns(design, sheets[i], config);
      if (result.designsPerSheet > 0) {
        results.push(result);
      }
    }

    results.sort(function (a, b) {
      if (config.strategy === 'waste') {

        return a.wastePercent - b.wastePercent;
      }
      if (config.strategy === 'sheets') {

        if (a.sheetsNeeded !== b.sheetsNeeded) {
          return a.sheetsNeeded - b.sheetsNeeded;
        }
        return a.wastePercent - b.wastePercent;
      }

      var scoreA = a.sheetsNeeded * 2 + a.wastePercent * 0.5 + (a.totalCost || 0) * 0.1;
      var scoreB = b.sheetsNeeded * 2 + b.wastePercent * 0.5 + (b.totalCost || 0) * 0.1;
      return scoreA - scoreB;
    });

    if (results.length > 0) {
      results[0].recommended = true;
    }

    return results;
  }

  function parseSheetSize(variantName) {
    if (!variantName) return null;

    var cleaned = variantName
      .replace(/["""'']/g, '')
      .replace(/\binch(es)?\b/gi, '')
      .replace(/\bin\b/gi, '')
      .trim();

    var match = cleaned.match(/(\d+(?:\.\d+)?)\s*[x×X]\s*(\d+(?:\.\d+)?)/);
    if (match) {
      return {
        widthInch: parseFloat(match[1]),
        heightInch: parseFloat(match[2]),
      };
    }

    match = cleaned.match(/(\d+(?:\.\d+)?)\s*by\s*(\d+(?:\.\d+)?)/i);
    if (match) {
      return {
        widthInch: parseFloat(match[1]),
        heightInch: parseFloat(match[2]),
      };
    }

    match = cleaned.match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/);
    if (match) {
      return {
        widthInch: parseFloat(match[1]),
        heightInch: parseFloat(match[2]),
      };
    }

    match = cleaned.match(/(\d+(?:\.\d+)?)\s*[x×X]\s*(\d+(?:\.\d+)?)/i);
    if (match) {
      return {
        widthInch: parseFloat(match[1]),
        heightInch: parseFloat(match[2]),
      };
    }

    var numbers = cleaned.match(/(\d+(?:\.\d+)?)/g);
    if (numbers && numbers.length >= 2) {
      return {
        widthInch: parseFloat(numbers[0]),
        heightInch: parseFloat(numbers[1]),
      };
    }

    return null;
  }

  function variantsToSheets(variants) {
    if (!variants || !Array.isArray(variants)) return [];

    var sheets = [];

    for (var i = 0; i < variants.length; i++) {
      var v = variants[i];
      var name = v.title || v.option1 || '';
      var dims = parseSheetSize(name);

      if (!dims) continue;

      if (dims.widthInch < 1 || dims.heightInch < 1) continue;

      sheets.push({
        id: v.id ? String(v.id) : 'variant_' + i,
        name: dims.widthInch + '" × ' + dims.heightInch + '"',
        widthInch: dims.widthInch,
        heightInch: dims.heightInch,
        price: parseFloat(v.price || 0) / 100,
        variantId: v.id,
      });
    }

    return sheets;
  }

  function formatArea(sqInches) {
    return parseFloat(sqInches.toFixed(1)) + ' in²';
  }

  function getEfficiencyTier(efficiency) {
    if (efficiency >= 70) return 'high';
    if (efficiency >= 40) return 'medium';
    return 'low';
  }

  window.ULNestingEngine = {
    nestDesigns: nestDesigns,
    nestAllVariants: nestAllVariants,
    calculateGridFit: calculateGridFit,
    parseSheetSize: parseSheetSize,
    variantsToSheets: variantsToSheets,
    formatArea: formatArea,
    getEfficiencyTier: getEfficiencyTier,
    DEFAULT_CONFIG: DEFAULT_CONFIG,
  };
})();
