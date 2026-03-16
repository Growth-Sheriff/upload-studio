/**
 * Upload Studio - Builder Pricing v1.0.0
 * ========================================
 * Area-based pricing engine: price per square inch,
 * volume discount tiers, minimum charges.
 *
 * Pricing formula:
 *   base = widthIn × heightIn × ratePerSqIn
 *   line = base × quantity
 *   discount = volumeDiscount(totalQuantity)
 *   total = line × (1 - discount)
 *
 * Namespace: window.ULBuilderPricing
 *
 * Dependencies: none (standalone)
 */

;(function () {
  'use strict'

  if (window.ULBuilderPricing) return

  /* ─────────────────────────────────────────────
     Default Config (overridden by API response)
     ───────────────────────────────────────────── */
  var config = {
    // Area pricing tiers: array of { minSqIn, maxSqIn, ratePerSqIn (cents) }
    tiers: [
      { minSqIn: 0, maxSqIn: 25, ratePerSqIn: 15 },       // $0.15/in² for 0-25 in²
      { minSqIn: 25, maxSqIn: 100, ratePerSqIn: 12 },      // $0.12/in² for 25-100 in²
      { minSqIn: 100, maxSqIn: 500, ratePerSqIn: 10 },     // $0.10/in² for 100-500 in²
      { minSqIn: 500, maxSqIn: Infinity, ratePerSqIn: 8 },  // $0.08/in² for 500+ in²
    ],

    // Volume discount tiers: { minQty, discountPercent }
    volumeDiscounts: [
      { minQty: 1, discountPercent: 0 },
      { minQty: 10, discountPercent: 5 },
      { minQty: 25, discountPercent: 10 },
      { minQty: 50, discountPercent: 15 },
      { minQty: 100, discountPercent: 20 },
      { minQty: 250, discountPercent: 25 },
    ],

    // Minimum charge in cents
    minimumCharge: 500, // $5.00

    // Setup/handling fee in cents (optional)
    setupFee: 0,
  }

  /* ─────────────────────────────────────────────
     Set Config from Backend
     ───────────────────────────────────────────── */
  function setConfig(data) {
    if (data.tiers && Array.isArray(data.tiers)) {
      config.tiers = data.tiers
    }
    if (data.volumeDiscounts && Array.isArray(data.volumeDiscounts)) {
      config.volumeDiscounts = data.volumeDiscounts
    }
    if (typeof data.minimumCharge === 'number') {
      config.minimumCharge = data.minimumCharge
    }
    if (typeof data.setupFee === 'number') {
      config.setupFee = data.setupFee
    }
  }

  /* ─────────────────────────────────────────────
     Get Rate for Area
     ───────────────────────────────────────────── */
  function getRateForArea(sqIn) {
    for (var i = 0; i < config.tiers.length; i++) {
      var tier = config.tiers[i]
      if (sqIn >= tier.minSqIn && sqIn < tier.maxSqIn) {
        return tier.ratePerSqIn
      }
    }
    // Fallback to last tier
    return config.tiers[config.tiers.length - 1].ratePerSqIn
  }

  /* ─────────────────────────────────────────────
     Get Volume Discount
     ───────────────────────────────────────────── */
  function getVolumeDiscount(quantity) {
    var discount = 0
    for (var i = 0; i < config.volumeDiscounts.length; i++) {
      if (quantity >= config.volumeDiscounts[i].minQty) {
        discount = config.volumeDiscounts[i].discountPercent
      }
    }
    return discount
  }

  /* ─────────────────────────────────────────────
     Calculate Price (in cents)
     ───────────────────────────────────────────── */
  function calculate(widthIn, heightIn, quantity) {
    if (!widthIn || !heightIn || widthIn <= 0 || heightIn <= 0) return 0
    quantity = Math.max(1, Math.floor(quantity || 1))

    var area = widthIn * heightIn
    var rate = getRateForArea(area)
    var basePrice = area * rate // cents for 1 piece
    var lineTotal = basePrice * quantity

    // Volume discount
    var discountPct = getVolumeDiscount(quantity)
    var discountAmount = Math.round(lineTotal * discountPct / 100)
    var afterDiscount = lineTotal - discountAmount

    // Setup fee
    var total = afterDiscount + config.setupFee

    // Minimum charge
    if (total < config.minimumCharge && total > 0) {
      total = config.minimumCharge
    }

    return Math.round(total)
  }

  /* ─────────────────────────────────────────────
     Get Detailed Breakdown
     ───────────────────────────────────────────── */
  function getDetail(widthIn, heightIn, quantity) {
    if (!widthIn || !heightIn || widthIn <= 0 || heightIn <= 0) {
      return {
        area: 0,
        ratePerSqIn: 0,
        basePrice: 0,
        quantity: quantity || 1,
        lineTotal: 0,
        discountPercent: 0,
        discountAmount: 0,
        setupFee: config.setupFee,
        total: 0,
        minimumApplied: false,
      }
    }

    quantity = Math.max(1, Math.floor(quantity || 1))
    var area = widthIn * heightIn
    var rate = getRateForArea(area)
    var basePrice = area * rate
    var lineTotal = basePrice * quantity
    var discountPct = getVolumeDiscount(quantity)
    var discountAmount = Math.round(lineTotal * discountPct / 100)
    var afterDiscount = lineTotal - discountAmount
    var total = afterDiscount + config.setupFee
    var minimumApplied = false

    if (total < config.minimumCharge && total > 0) {
      total = config.minimumCharge
      minimumApplied = true
    }

    return {
      area: area,
      ratePerSqIn: rate,
      basePrice: Math.round(basePrice),
      quantity: quantity,
      lineTotal: Math.round(lineTotal),
      discountPercent: discountPct,
      discountAmount: discountAmount,
      setupFee: config.setupFee,
      total: Math.round(total),
      minimumApplied: minimumApplied,
    }
  }

  /* ─────────────────────────────────────────────
     Get Volume Discount Table (for display)
     ───────────────────────────────────────────── */
  function getVolumeTable() {
    return config.volumeDiscounts.map(function (d) {
      return { minQty: d.minQty, discountPercent: d.discountPercent }
    })
  }

  /* ─────────────────────────────────────────────
     Get Pricing Tiers (for display)
     ───────────────────────────────────────────── */
  function getTiersTable() {
    return config.tiers.map(function (t) {
      return {
        minSqIn: t.minSqIn,
        maxSqIn: t.maxSqIn === Infinity ? '∞' : t.maxSqIn,
        ratePerSqIn: t.ratePerSqIn,
      }
    })
  }

  /* ─────────────────────────────────────────────
     Public API
     ───────────────────────────────────────────── */
  window.ULBuilderPricing = {
    version: '1.0.0',
    setConfig: setConfig,
    calculate: calculate,
    getDetail: getDetail,
    getRateForArea: getRateForArea,
    getVolumeDiscount: getVolumeDiscount,
    getVolumeTable: getVolumeTable,
    getTiersTable: getTiersTable,
  }
})()
