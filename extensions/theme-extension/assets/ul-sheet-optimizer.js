;(function() {
  'use strict';

  var RETIREMENT_CODE = 'LEGACY_LAYOUT_RETIRED';
  var RETIREMENT_MESSAGE = 'Automatic layout is retired. Upload the finished gang sheet on its product page.';

  function retiredOptimization() {
    return {
      recommended: null,
      alternatives: [],
      comparison: { headers: [], rows: [] },
      savings: null,
      error: RETIREMENT_CODE,
      message: RETIREMENT_MESSAGE,
      retired: true,
    };
  }

  function optimize() {
    return retiredOptimization();
  }

  function isSuboptimal() {
    return false;
  }

  function formatCost(amount) {
    var value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return '-';
    if (window.Shopify && typeof window.Shopify.formatMoney === 'function') {
      try {
        return window.Shopify.formatMoney(value * 100, window.Shopify.money_format || '${{amount}}');
      } catch (_error) {
        // Formatting must not reactivate recommendation behavior.
      }
    }
    return '$' + value.toFixed(2);
  }

  function formatPercent(percent) {
    var value = Number(percent);
    return (Number.isFinite(value) ? value.toFixed(1) : '0.0') + '%';
  }

  function getSummaryText() {
    return RETIREMENT_MESSAGE;
  }

  function suggestQuantityAdjust() {
    return null;
  }

  window.ULSheetOptimizer = {
    optimize: optimize,
    isSuboptimal: isSuboptimal,
    formatCost: formatCost,
    formatPercent: formatPercent,
    getSummaryText: getSummaryText,
    suggestQuantityAdjust: suggestQuantityAdjust,
    WEIGHTS: { retired: true },
    RETIREMENT_CODE: RETIREMENT_CODE,
    retired: true,
  };
})();
