

(function() {
  'use strict';

  const CONFIG = {
    cutoffHour: 14,
    timezone: 'America/New_York',
    warehouseState: 'NJ',
    geoIPCacheDuration: 30 * 60 * 1000,
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

  function safeRemoveItem(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {

    }
  }

  const GEOIP_CACHE_KEY = 'deliveryGeoIP';

  function getCachedGeoIP() {
    const cached = safeGetItem(GEOIP_CACHE_KEY);
    if (!cached) return null;

    try {
      const data = JSON.parse(cached);
      if (Date.now() - data.timestamp < CONFIG.geoIPCacheDuration) {
        return data.location;
      }
    } catch (e) {

    }
    return null;
  }

  function setCachedGeoIP(location) {
    safeSetItem(GEOIP_CACHE_KEY, JSON.stringify({
      location,
      timestamp: Date.now()
    }));
  }

  function getStateFromZip(zip) {

    if (window.getStateFromZip) {
      return window.getStateFromZip(zip);
    }

    const prefix = String(zip || '').substring(0, 3);

    const COMMON_PREFIXES = {

      '070': 'NJ', '071': 'NJ', '072': 'NJ', '073': 'NJ', '074': 'NJ',
      '075': 'NJ', '076': 'NJ', '077': 'NJ', '078': 'NJ', '079': 'NJ',
      '080': 'NJ', '081': 'NJ', '082': 'NJ', '083': 'NJ', '084': 'NJ',
      '085': 'NJ', '086': 'NJ', '087': 'NJ', '088': 'NJ', '089': 'NJ',

      '100': 'NY', '101': 'NY', '102': 'NY', '103': 'NY', '104': 'NY',
      '110': 'NY', '111': 'NY', '112': 'NY', '113': 'NY', '114': 'NY',
      '115': 'NY', '116': 'NY', '117': 'NY', '118': 'NY', '119': 'NY',

      '150': 'PA', '151': 'PA', '152': 'PA', '153': 'PA', '154': 'PA',
      '190': 'PA', '191': 'PA', '192': 'PA', '193': 'PA', '194': 'PA',

      '900': 'CA', '901': 'CA', '902': 'CA', '903': 'CA', '904': 'CA',
      '905': 'CA', '906': 'CA', '907': 'CA', '908': 'CA', '910': 'CA',
      '920': 'CA', '921': 'CA', '922': 'CA', '923': 'CA', '924': 'CA',
      '950': 'CA', '951': 'CA', '952': 'CA', '953': 'CA', '954': 'CA',

      '750': 'TX', '751': 'TX', '752': 'TX', '753': 'TX', '754': 'TX',
      '760': 'TX', '761': 'TX', '762': 'TX', '763': 'TX', '764': 'TX',
      '770': 'TX', '772': 'TX', '773': 'TX', '774': 'TX', '775': 'TX',
      '780': 'TX', '781': 'TX', '782': 'TX', '783': 'TX', '784': 'TX',

      '320': 'FL', '321': 'FL', '322': 'FL', '323': 'FL', '324': 'FL',
      '325': 'FL', '326': 'FL', '327': 'FL', '328': 'FL', '329': 'FL',
      '330': 'FL', '331': 'FL', '332': 'FL', '333': 'FL', '334': 'FL'
    };

    return COMMON_PREFIXES[prefix] || CONFIG.warehouseState;
  }

  const ZONE_CONFIG = {

    zone1: ['NJ', 'NY', 'PA', 'CT', 'MA', 'RI', 'NH', 'VT', 'ME', 'DE', 'MD', 'DC'],
    zone2: ['VA', 'WV', 'NC', 'SC', 'GA', 'FL', 'OH', 'IN', 'MI', 'IL', 'WI', 'KY', 'TN', 'AL', 'MS'],
    zone3: ['MN', 'IA', 'MO', 'AR', 'LA', 'ND', 'SD', 'NE', 'KS', 'OK', 'TX'],
    zone4: ['MT', 'WY', 'CO', 'NM', 'ID', 'UT', 'AZ', 'NV', 'WA', 'OR', 'CA', 'AK', 'HI']
  };

  function getZone(state) {
    if (ZONE_CONFIG.zone1.includes(state)) return 1;
    if (ZONE_CONFIG.zone2.includes(state)) return 2;
    if (ZONE_CONFIG.zone3.includes(state)) return 3;
    if (ZONE_CONFIG.zone4.includes(state)) return 4;
    return 3;
  }

  function getBaseDaysForZone(zone) {
    switch (zone) {
      case 1: return 2;
      case 2: return 3;
      case 3: return 4;
      case 4: return 5;
      default: return 4;
    }
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

    if (isPastCutoff()) {
      result.setDate(result.getDate() + 1);
    }

    while (added < days) {
      result.setDate(result.getDate() + 1);
      if (!isWeekend(result)) {
        added++;
      }
    }

    return result;
  }

  function formatDate(date) {
    const options = { weekday: 'short', month: 'short', day: 'numeric' };
    return date.toLocaleDateString('en-US', options);
  }

  function formatFullDate(date) {
    const options = { weekday: 'long', month: 'long', day: 'numeric' };
    return date.toLocaleDateString('en-US', options);
  }

  let customerLocation = null;

  async function detectLocation() {

    const cached = getCachedGeoIP();
    if (cached) {
      customerLocation = cached;
      return cached;
    }

    if (window.Shopify && window.Shopify.customer) {
      const customer = window.Shopify.customer;
      if (customer.default_address) {
        const addr = customer.default_address;
        if (addr.zip) {
          const location = {
            zip: addr.zip,
            state: addr.province_code || getStateFromZip(addr.zip),
            country: 'US',
            source: 'shopify_customer'
          };
          customerLocation = location;
          setCachedGeoIP(location);
          return location;
        }
      }
    }

    const storedZip = safeGetItem('customerZip');
    if (storedZip) {
      const location = {
        zip: storedZip,
        state: getStateFromZip(storedZip),
        country: 'US',
        source: 'stored'
      };
      customerLocation = location;
      setCachedGeoIP(location);
      return location;
    }

    try {
      const response = await fetch('https://ipapi.co/json/', { timeout: 3000 });
      if (response.ok) {
        const data = await response.json();
        if (data.country_code === 'US' && data.postal) {
          const location = {
            zip: data.postal,
            state: data.region_code || getStateFromZip(data.postal),
            city: data.city,
            country: 'US',
            source: 'geoip'
          };
          customerLocation = location;
          setCachedGeoIP(location);
          return location;
        }
      }
    } catch (e) {

    }

    const defaultLocation = {
      zip: null,
      state: CONFIG.warehouseState,
      country: 'US',
      source: 'default'
    };
    customerLocation = defaultLocation;
    return defaultLocation;
  }

  function setCustomerZip(zip) {
    if (!zip) return;

    const location = {
      zip: zip,
      state: getStateFromZip(zip),
      country: 'US',
      source: 'user_input'
    };

    customerLocation = location;
    safeSetItem('customerZip', zip);
    setCachedGeoIP(location);

    document.dispatchEvent(new CustomEvent('deliveryLocationChanged', { detail: location }));
  }

  function calculateDeliveryEstimate(options = {}) {

    const state = options.state || (customerLocation ? customerLocation.state : null) || CONFIG.warehouseState;
    const zone = getZone(state);
    const baseDays = getBaseDaysForZone(zone);

    const totalDays = baseDays + 1;

    const minDate = addBusinessDays(new Date(), totalDays);
    const maxDate = addBusinessDays(new Date(), totalDays + 1);

    return {
      zone,
      baseDays,
      totalDays,
      minDate,
      maxDate,
      minDateFormatted: formatDate(minDate),
      maxDateFormatted: formatDate(maxDate),
      fullDateFormatted: formatFullDate(minDate),
      rangeText: `${formatDate(minDate)} - ${formatDate(maxDate)}`,
      isPastCutoff: isPastCutoff(),
      cutoffHour: CONFIG.cutoffHour,
      state,

      source: customerLocation ? customerLocation.source : 'default'
    };
  }

  function renderDeliveryBadge(container, options = {}) {
    if (!container) return;

    const estimate = calculateDeliveryEstimate(options);

    const html = `
      <div class="delivery-badge" data-zone="${estimate.zone}">
        <div class="delivery-badge__icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="1" y="3" width="15" height="13" rx="2"/>
            <path d="M16 8h4l3 3v5h-7V8z"/>
            <circle cx="5.5" cy="18.5" r="2.5"/>
            <circle cx="18.5" cy="18.5" r="2.5"/>
          </svg>
        </div>
        <div class="delivery-badge__content">
          <div class="delivery-badge__label">Estimated Delivery</div>
          <div class="delivery-badge__date">${estimate.rangeText}</div>
          ${estimate.isPastCutoff ?
            '<div class="delivery-badge__note">Order by 2 PM ET for faster delivery</div>' :
            '<div class="delivery-badge__note">Order now to get it by ' + estimate.minDateFormatted + '</div>'
          }
        </div>
      </div>
    `;

    container.innerHTML = html;
    return estimate;
  }

  function renderCompactBadge(container, options = {}) {
    if (!container) return;

    const estimate = calculateDeliveryEstimate(options);

    container.innerHTML = `
      <span class="delivery-compact">
        📦 Get it by <strong>${estimate.minDateFormatted}</strong>
      </span>
    `;

    return estimate;
  }

  function renderInlineBadge(container, options = {}) {
    if (!container) return;

    const estimate = calculateDeliveryEstimate(options);

    container.innerHTML = `
      <span class="delivery-inline">
        Arrives ${estimate.rangeText}
      </span>
    `;

    return estimate;
  }

  function renderZipInput(container, options = {}) {
    if (!container) return;

    const currentZip = (customerLocation ? customerLocation.zip : null) || '';

    const html = `
      <div class="delivery-zip-input">
        <label for="delivery-zip">Enter ZIP for delivery estimate:</label>
        <div class="delivery-zip-input__row">
          <input type="text"
                 id="delivery-zip"
                 name="delivery-zip"
                 placeholder="Enter ZIP code"
                 value="${currentZip}"
                 maxlength="5"
                 pattern="[0-9]*"
                 inputmode="numeric"
                 autocomplete="postal-code">
          <button type="button" class="delivery-zip-input__btn">Check</button>
        </div>
        <div class="delivery-zip-input__result"></div>
      </div>
    `;

    container.innerHTML = html;

    const input = container.querySelector('#delivery-zip');
    const btn = container.querySelector('.delivery-zip-input__btn');
    const result = container.querySelector('.delivery-zip-input__result');

    function updateResult() {
      const zip = input.value.trim();
      if (zip.length === 5 && /^\d+$/.test(zip)) {
        setCustomerZip(zip);
        const estimate = calculateDeliveryEstimate();
        result.innerHTML = `
          <div class="delivery-zip-result">
            📦 Delivers to <strong>${estimate.state}</strong>: ${estimate.rangeText}
          </div>
        `;
      } else if (zip.length > 0) {
        result.innerHTML = '<div class="delivery-zip-error">Please enter a valid 5-digit ZIP code</div>';
      } else {
        result.innerHTML = '';
      }
    }

    btn.addEventListener('click', updateResult);
    input.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') updateResult();
    });
    input.addEventListener('input', () => {

      if (input.value.length === 5) {
        updateResult();
      }
    });
  }

  async function initDeliveryBadges() {

    await detectLocation();

    document.querySelectorAll('[data-delivery-badge]').forEach(el => {
      const type = el.dataset.deliveryBadge || 'full';
      switch (type) {
        case 'compact':
          renderCompactBadge(el);
          break;
        case 'inline':
          renderInlineBadge(el);
          break;
        case 'zip-input':
          renderZipInput(el);
          break;
        default:
          renderDeliveryBadge(el);
      }
    });

    document.addEventListener('deliveryLocationChanged', () => {
      document.querySelectorAll('[data-delivery-badge]').forEach(el => {
        const type = el.dataset.deliveryBadge || 'full';
        if (type !== 'zip-input') {
          switch (type) {
            case 'compact':
              renderCompactBadge(el);
              break;
            case 'inline':
              renderInlineBadge(el);
              break;
            default:
              renderDeliveryBadge(el);
          }
        }
      });
    });
  }

  window.DeliveryBadge = {
    init: initDeliveryBadges,
    detectLocation,
    setCustomerZip,
    calculateEstimate: calculateDeliveryEstimate,
    renderBadge: renderDeliveryBadge,
    renderCompact: renderCompactBadge,
    renderInline: renderInlineBadge,
    renderZipInput,
    getLocation: () => customerLocation,
    getStateFromZip,
    getZone,
    config: CONFIG
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDeliveryBadges);
  } else {

    setTimeout(initDeliveryBadges, 0);
  }

  console.log('[DeliveryBadge] v2.0.0 loaded - GeoIP caching & province fallback fixed');
})();
