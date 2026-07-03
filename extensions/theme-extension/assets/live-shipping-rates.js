

(function() {
  'use strict';

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

  function normalizePrice(price) {
    if (price === null || price === undefined || price === '') return 0;

    const strPrice = String(price);
    const numPrice = parseFloat(price);

    if (isNaN(numPrice)) return 0;

    if (strPrice.includes('.')) {
      return numPrice;
    }

    if (numPrice >= 1000) {
      return numPrice / 100;
    }

    if (numPrice >= 100) {
      return numPrice / 100;
    }

    if (numPrice === 0) {
      return 0;
    }

    return numPrice / 100;
  }

  function formatPrice(price) {
    const normalized = normalizePrice(price);
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(normalized);
  }

  function getStateFromZip(zip) {
    if (window.getStateFromZip) {
      return window.getStateFromZip(zip);
    }

    const ZIP_PREFIXES = {
      '0': 'NJ', '1': 'NY', '2': 'VA', '3': 'FL', '4': 'KY',
      '5': 'IA', '6': 'IL', '7': 'TX', '8': 'CO', '9': 'CA'
    };
    const prefix = String(zip || '').charAt(0);
    return ZIP_PREFIXES[prefix] || 'NJ';
  }

  const CACHE_KEY = 'liveShippingRates';
  const CACHE_DURATION = 5 * 60 * 1000;

  function getCachedRates(zip) {
    const cached = safeGetItem(CACHE_KEY);
    if (!cached) return null;

    try {
      const data = JSON.parse(cached);
      if (data.zip === zip && Date.now() - data.timestamp < CACHE_DURATION) {
        return data.rates;
      }
    } catch (e) {

    }
    return null;
  }

  function setCachedRates(zip, rates) {
    safeSetItem(CACHE_KEY, JSON.stringify({
      zip,
      rates,
      timestamp: Date.now()
    }));
  }

  class LiveShippingRates {
    constructor(options = {}) {
      this.debug = options.debug || false;
      this.timeout = options.timeout || 6000;
      this.useCache = options.useCache !== false;
    }

    log(...args) {
      if (this.debug) {
        console.log('[LiveShippingRates]', ...args);
      }
    }

    async getRates(zip, options = {}) {
      if (!zip) {
        return { success: false, error: 'ZIP code required', rates: [] };
      }

      this.log('Getting rates for ZIP:', zip);

      if (this.useCache && !options.skipCache) {
        const cached = getCachedRates(zip);
        if (cached) {
          this.log('Returning cached rates');
          return { success: true, rates: cached, cached: true };
        }
      }

      const state = options.state || getStateFromZip(zip);
      this.log('Resolved state:', state);

      const address = {
        zip: zip,
        province: state,
        country: 'United States'
      };

      try {

        if (window.ShopifyLiveShipping) {
          const client = new window.ShopifyLiveShipping({ debug: this.debug });
          const result = await client.getShippingRates(address);

          if (result.success && result.rates.length > 0) {

            if (this.useCache) {
              setCachedRates(zip, result.rates);
            }
            return result;
          }
        }

        return await this.fetchDirectRates(address);
      } catch (error) {
        this.log('Error getting rates:', error);
        return { success: false, error: error.message, rates: [] };
      }
    }

    async fetchDirectRates(address) {
      const { zip, province, country } = address;

      const prepareUrl = `/cart/prepare_shipping_rates.json?shipping_address[zip]=${encodeURIComponent(zip)}&shipping_address[country]=${encodeURIComponent(country)}&shipping_address[province]=${encodeURIComponent(province)}`;

      try {
        await fetch(prepareUrl, { method: 'POST' });
      } catch (e) {
        this.log('Prepare failed:', e);
      }

      await new Promise(resolve => setTimeout(resolve, 500));

      const fetchUrl = `/cart/shipping_rates.json?shipping_address[zip]=${encodeURIComponent(zip)}&shipping_address[country]=${encodeURIComponent(country)}&shipping_address[province]=${encodeURIComponent(province)}`;

      const response = await fetch(fetchUrl);
      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}`, rates: [] };
      }

      const data = await response.json();
      if (!data.shipping_rates || data.shipping_rates.length === 0) {
        return { success: false, error: 'No rates', rates: [] };
      }

      const rates = data.shipping_rates.map(rate => this.processRate(rate));
      rates.sort((a, b) => a.price - b.price);

      if (rates.length > 0) {
        rates[0].isCheapest = true;
      }

      if (this.useCache) {
        setCachedRates(address.zip, rates);
      }

      return { success: true, rates };
    }

    processRate(rate) {
      const normalized = normalizePrice(rate.price);

      return {
        name: rate.name,
        code: rate.code,
        price: normalized,
        priceFormatted: formatPrice(rate.price),
        isFree: normalized === 0,
        original: rate
      };
    }

    async getCheapestRate(zip) {
      const result = await this.getRates(zip);
      if (result.success && result.rates.length > 0) {
        return result.rates[0];
      }
      return null;
    }

    async getExpressRates(zip) {
      const result = await this.getRates(zip);
      if (result.success) {
        return result.rates.filter(r => {
          const name = (r.name || '').toLowerCase();
          return name.includes('express') ||
                 name.includes('next day') ||
                 name.includes('overnight') ||
                 name.includes('2 day') ||
                 name.includes('2-day');
        });
      }
      return [];
    }
  }

  window.LiveShippingRates = LiveShippingRates;
  window.normalizeShippingPrice = normalizePrice;
  window.formatShippingPrice = formatPrice;

  window.liveShipping = new LiveShippingRates({ debug: false });

  console.log('[LiveShippingRates] v2.0.0 loaded - Price normalization fixed');
})();
