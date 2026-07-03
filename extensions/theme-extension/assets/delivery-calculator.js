

(function() {
  'use strict';

  const CONFIG = {

    processingDays: 1,

    cutoffHour: 14,
    timezone: 'America/New_York',

    warehouseState: 'NJ',
    warehouseZip: '07001',

    defaultMethod: 'ground',

    debug: false
  };

  function safeGetItem(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function safeSetItem(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {

    }
  }

  const ZONES = {

    zone1: {
      states: ['NJ', 'NY', 'PA', 'CT', 'MA', 'RI', 'NH', 'VT', 'ME', 'DE', 'MD', 'DC'],
      transitDays: { ground: 2, express: 1, overnight: 1 },
      name: 'Northeast'
    },

    zone2: {
      states: ['VA', 'WV', 'NC', 'OH', 'MI', 'IN'],
      transitDays: { ground: 3, express: 2, overnight: 1 },
      name: 'Mid-Atlantic'
    },

    zone3: {
      states: ['SC', 'GA', 'FL', 'TN', 'KY', 'AL', 'MS', 'IL', 'WI', 'MN', 'IA', 'MO'],
      transitDays: { ground: 4, express: 2, overnight: 1 },
      name: 'Southeast/Midwest'
    },

    zone4: {
      states: ['AR', 'LA', 'TX', 'OK', 'KS', 'NE', 'SD', 'ND'],
      transitDays: { ground: 5, express: 3, overnight: 2 },
      name: 'Central'
    },

    zone5: {
      states: ['MT', 'WY', 'CO', 'NM', 'ID', 'UT', 'AZ', 'NV'],
      transitDays: { ground: 6, express: 3, overnight: 2 },
      name: 'Mountain'
    },

    zone6: {
      states: ['WA', 'OR', 'CA', 'AK', 'HI', 'PR', 'VI', 'GU'],
      transitDays: { ground: 7, express: 4, overnight: 2 },
      name: 'Pacific'
    }
  };

  function getStateFromZip(zip) {
    if (window.getStateFromZip) {
      return window.getStateFromZip(zip);
    }

    const prefix = String(zip || '').substring(0, 3);
    const COMMON = {
      '070': 'NJ', '071': 'NJ', '072': 'NJ', '073': 'NJ', '074': 'NJ',
      '100': 'NY', '101': 'NY', '102': 'NY', '111': 'NY', '112': 'NY',
      '150': 'PA', '151': 'PA', '190': 'PA', '191': 'PA',
      '900': 'CA', '901': 'CA', '902': 'CA', '950': 'CA', '951': 'CA',
      '750': 'TX', '751': 'TX', '770': 'TX', '772': 'TX',
      '330': 'FL', '331': 'FL', '332': 'FL', '333': 'FL'
    };
    return COMMON[prefix] || CONFIG.warehouseState;
  }

  function getZoneForState(state) {
    if (!state) return ZONES.zone3;

    const stateUpper = state.toUpperCase();

    for (const [zoneName, zoneData] of Object.entries(ZONES)) {
      if (zoneData.states.includes(stateUpper)) {
        return { ...zoneData, id: zoneName };
      }
    }

    return { ...ZONES.zone3, id: 'zone3' };
  }

  function getZoneForZip(zip) {
    const state = getStateFromZip(zip);
    return getZoneForState(state);
  }

  function getETHour() {
    try {
      const options = { timeZone: CONFIG.timezone, hour: 'numeric', hour12: false };
      return parseInt(new Date().toLocaleString('en-US', options));
    } catch (e) {
      return new Date().getHours();
    }
  }

  function isPastCutoff() {
    return getETHour() >= CONFIG.cutoffHour;
  }

  function isWeekend(date) {
    const day = date.getDay();
    return day === 0 || day === 6;
  }

  function addBusinessDays(startDate, days) {
    const result = new Date(startDate);
    let added = 0;

    while (added < days) {
      result.setDate(result.getDate() + 1);
      if (!isWeekend(result)) {
        added++;
      }
    }

    return result;
  }

  function formatDate(date) {
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  }

  function formatLongDate(date) {
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    });
  }

  class DeliveryCalculator {
    constructor(options = {}) {
      this.processingDays = options.processingDays || CONFIG.processingDays;
      this.debug = options.debug || CONFIG.debug;
    }

    log(...args) {
      if (this.debug) {
        console.log('[DeliveryCalculator]', ...args);
      }
    }

    async calculate(destination, options = {}) {
      const method = options.method || CONFIG.defaultMethod;

      let state, zip;
      if (typeof destination === 'string') {
        if (destination.length === 2) {
          state = destination.toUpperCase();
          zip = null;
        } else {
          zip = destination;
          state = getStateFromZip(zip);
        }
      } else if (destination && typeof destination === 'object') {
        state = destination.state || destination.province;
        zip = destination.zip || destination.postal;
        if (!state && zip) {
          state = getStateFromZip(zip);
        }
      } else {
        state = CONFIG.warehouseState;
        zip = null;
      }

      this.log('Calculating for:', { state, zip, method });

      if (zip && window.LiveShippingRates && options.preferLive !== false) {
        try {
          const liveRates = new window.LiveShippingRates({ debug: this.debug });
          const result = await liveRates.getRates(zip);

          if (result.success && result.rates.length > 0) {
            this.log('Using Shopify live rates');

            const rate = this.findMatchingRate(result.rates, method);
            if (rate) {
              return this.buildResultFromLiveRate(rate, state, zip);
            }
          }
        } catch (e) {
          this.log('Live rates failed, falling back to static:', e);
        }
      }

      return this.calculateStatic(state, zip, method);
    }

    findMatchingRate(rates, method) {
      const methodLower = method.toLowerCase();

      if (methodLower === 'overnight' || methodLower === 'next_day') {
        const overnight = rates.find(r => {
          const n = (r.name || '').toLowerCase();
          return n.includes('overnight') || n.includes('next day') || n.includes('1-day');
        });
        if (overnight) return overnight;
      }

      if (methodLower === 'express' || methodLower === '2day') {
        const express = rates.find(r => {
          const n = (r.name || '').toLowerCase();
          return n.includes('express') || n.includes('2 day') || n.includes('2-day');
        });
        if (express) return express;
      }

      return rates[0];
    }

    buildResultFromLiveRate(rate, state, zip) {
      return {
        method: rate.name,
        carrier: rate.carrier,
        price: rate.price,
        priceFormatted: rate.priceFormatted,
        isFree: rate.isFree,
        delivery: rate.delivery || {
          minDate: this.addBusinessDays(new Date(), 3),
          maxDate: this.addBusinessDays(new Date(), 5),
          minDateFormatted: formatDate(this.addBusinessDays(new Date(), 3)),
          maxDateFormatted: formatDate(this.addBusinessDays(new Date(), 5)),
          rangeText: `${formatDate(this.addBusinessDays(new Date(), 3))} - ${formatDate(this.addBusinessDays(new Date(), 5))}`
        },
        destination: { state, zip },
        source: 'shopify_live',
        timestamp: Date.now()
      };
    }

    calculateStatic(state, zip, method) {
      const zone = getZoneForState(state);
      const transitDays = zone.transitDays[method] || zone.transitDays.ground;

      let startDate = new Date();
      if (isPastCutoff()) {
        startDate.setDate(startDate.getDate() + 1);
      }

      while (isWeekend(startDate)) {
        startDate.setDate(startDate.getDate() + 1);
      }

      const totalDays = this.processingDays + transitDays;

      const minDate = addBusinessDays(startDate, totalDays);
      const maxDate = addBusinessDays(startDate, totalDays + 1);

      return {
        method: this.getMethodName(method),
        carrier: { name: 'Standard Carrier', icon: 'package' },
        price: null, // Static doesn't know price
        priceFormatted: null,
        isFree: null,
        delivery: {
          minDays: totalDays,
          maxDays: totalDays + 1,
          minDate,
          maxDate,
          minDateFormatted: formatDate(minDate),
          maxDateFormatted: formatDate(maxDate),
          fullDate: formatLongDate(minDate),
          rangeText: `${formatDate(minDate)} - ${formatDate(maxDate)}`,
          countdown: this.formatCountdown(totalDays)
        },
        zone: {
          id: zone.id,
          name: zone.name,
          transitDays
        },
        destination: { state, zip },
        processing: {
          days: this.processingDays,
          isPastCutoff: isPastCutoff(),
          cutoffHour: CONFIG.cutoffHour
        },
        source: 'static_calculation',
        timestamp: Date.now()
      };
    }

    getMethodName(method) {
      const names = {
        ground: 'Ground Shipping',
        express: 'Express Shipping',
        overnight: 'Overnight Shipping',
        '2day': '2-Day Shipping'
      };
      return names[method] || 'Standard Shipping';
    }

    formatCountdown(days) {
      if (days === 1) return 'Tomorrow';
      if (days === 2) return 'In 2 days';
      if (days <= 5) return `In ${days} days`;
      return `In about a week`;
    }

    addBusinessDays(startDate, days) {
      return addBusinessDays(startDate, days);
    }

    quickEstimate(state, method = 'ground') {
      return this.calculateStatic(state, null, method);
    }
  }

  const STATIC_PRICES = {
    zone1: { ground: 8.99, express: 14.99, overnight: 29.99 },
    zone2: { ground: 9.99, express: 16.99, overnight: 34.99 },
    zone3: { ground: 11.99, express: 19.99, overnight: 39.99 },
    zone4: { ground: 13.99, express: 24.99, overnight: 49.99 },
    zone5: { ground: 15.99, express: 29.99, overnight: 59.99 },
    zone6: { ground: 18.99, express: 34.99, overnight: 69.99 }
  };

  function estimatePrice(state, method = 'ground') {
    const zone = getZoneForState(state);
    const prices = STATIC_PRICES[zone.id] || STATIC_PRICES.zone3;
    return prices[method] || prices.ground;
  }

  window.DeliveryCalculator = DeliveryCalculator;
  window.deliveryCalculator = new DeliveryCalculator();

  window.getDeliveryZone = getZoneForState;
  window.getDeliveryZoneForZip = getZoneForZip;
  window.estimateDeliveryPrice = estimatePrice;
  window.DELIVERY_ZONES = ZONES;

  window.calculateDelivery = async function(destination, options = {}) {
    const calc = new DeliveryCalculator(options);
    return await calc.calculate(destination, options);
  };

  window.quickDeliveryEstimate = function(state, method = 'ground') {
    const calc = new DeliveryCalculator();
    return calc.quickEstimate(state, method);
  };

  console.log('[DeliveryCalculator] v2.0.0 loaded - Shopify live rates priority');
})();
