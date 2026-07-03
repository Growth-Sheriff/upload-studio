

(function() {
  'use strict';

  const ERROR_CODES = {

    UPLOAD_FILE_TOO_LARGE: {
      code: 101,
      type: 'error',
      title: 'File Too Large',
      message: 'File exceeds {maxSize} limit. Please compress or use a smaller file.',
      recoverable: true,
      action: 'retry'
    },
    UPLOAD_INVALID_TYPE: {
      code: 102,
      type: 'error',
      title: 'Invalid File Type',
      message: 'This file type is not supported. Please use {allowedTypes}.',
      recoverable: true,
      action: 'retry'
    },
    UPLOAD_FAILED: {
      code: 103,
      type: 'error',
      title: 'Upload Failed',
      message: 'Upload failed. Please check your connection and try again.',
      recoverable: true,
      action: 'retry'
    },
    UPLOAD_PROCESSING_FAILED: {
      code: 104,
      type: 'error',
      title: 'Processing Failed',
      message: 'We couldn\'t process this file. Please try a different file.',
      recoverable: true,
      action: 'retry'
    },
    UPLOAD_LOW_DPI: {
      code: 105,
      type: 'warning',
      title: 'Low Resolution',
      message: 'This image is {actualDpi} DPI. For best print quality, use at least {minDpi} DPI.',
      recoverable: false,
      action: 'continue'
    },
    UPLOAD_NETWORK_ERROR: {
      code: 106,
      type: 'error',
      title: 'Connection Error',
      message: 'Network error occurred. Please check your internet connection.',
      recoverable: true,
      action: 'retry'
    },
    UPLOAD_TIMEOUT: {
      code: 107,
      type: 'error',
      title: 'Upload Timeout',
      message: 'Upload took too long. Please try again with a smaller file or check your connection.',
      recoverable: true,
      action: 'retry'
    },

    THREE_MODEL_LOAD_FAILED: {
      code: 201,
      type: 'warning',
      title: '3D Preview Unavailable',
      message: '3D preview unavailable. You can still complete your order.',
      recoverable: false,
      action: 'fallback'
    },
    THREE_TEXTURE_FAILED: {
      code: 202,
      type: 'warning',
      title: 'Design Preview Failed',
      message: 'Design preview failed. Your design will still print correctly.',
      recoverable: false,
      action: 'continue'
    },
    THREE_WEBGL_NOT_SUPPORTED: {
      code: 203,
      type: 'info',
      title: '3D Not Supported',
      message: 'Your device doesn\'t support 3D preview. Using 2D preview instead.',
      recoverable: false,
      action: 'fallback'
    },
    THREE_RENDER_ERROR: {
      code: 204,
      type: 'warning',
      title: 'Rendering Error',
      message: '3D rendering encountered an issue. Switching to 2D preview.',
      recoverable: false,
      action: 'fallback'
    },

    CART_ADD_FAILED: {
      code: 301,
      type: 'error',
      title: 'Add to Cart Failed',
      message: 'Couldn\'t add to cart. Please try again.',
      recoverable: true,
      action: 'retry'
    },
    CART_VARIANT_OUT_OF_STOCK: {
      code: 302,
      type: 'error',
      title: 'Out of Stock',
      message: 'This size is currently out of stock. Please select another.',
      recoverable: true,
      action: 'select'
    },
    CART_SESSION_EXPIRED: {
      code: 303,
      type: 'error',
      title: 'Session Expired',
      message: 'Your session has expired. Please refresh the page.',
      recoverable: true,
      action: 'refresh'
    },
    CART_QUANTITY_EXCEEDED: {
      code: 304,
      type: 'error',
      title: 'Quantity Limit',
      message: 'Maximum quantity is {maxQty}. Please reduce the quantity.',
      recoverable: true,
      action: 'adjust'
    },
    CART_PRICE_CHANGED: {
      code: 305,
      type: 'warning',
      title: 'Price Updated',
      message: 'Price has been updated. Please review before adding to cart.',
      recoverable: false,
      action: 'continue'
    },

    VALIDATION_REQUIRED: {
      code: 401,
      type: 'error',
      title: 'Required Field',
      message: 'This field is required.',
      recoverable: true,
      action: 'focus'
    },
    VALIDATION_INVALID_INPUT: {
      code: 402,
      type: 'error',
      title: 'Invalid Input',
      message: '{fieldName} is not valid. {hint}',
      recoverable: true,
      action: 'focus'
    },
    VALIDATION_CONFIRMATION_REQUIRED: {
      code: 403,
      type: 'error',
      title: 'Confirmation Required',
      message: 'Please confirm your order before proceeding.',
      recoverable: true,
      action: 'focus'
    },
    VALIDATION_UPLOAD_REQUIRED: {
      code: 404,
      type: 'error',
      title: 'Design Required',
      message: 'Please upload your design first.',
      recoverable: true,
      action: 'focus'
    },
    VALIDATION_SIZE_REQUIRED: {
      code: 405,
      type: 'error',
      title: 'Size Required',
      message: 'Please select a size before adding to cart.',
      recoverable: true,
      action: 'focus'
    },
    VALIDATION_LOCATION_REQUIRED: {
      code: 406,
      type: 'error',
      title: 'Location Required',
      message: 'Please select at least one print location.',
      recoverable: true,
      action: 'focus'
    },

    API_SERVER_ERROR: {
      code: 501,
      type: 'error',
      title: 'Server Error',
      message: 'Something went wrong on our end. Please try again later.',
      recoverable: true,
      action: 'retry'
    },
    API_RATE_LIMITED: {
      code: 502,
      type: 'warning',
      title: 'Too Many Requests',
      message: 'Please wait a moment before trying again.',
      recoverable: true,
      action: 'wait'
    },
    API_UNAUTHORIZED: {
      code: 503,
      type: 'error',
      title: 'Access Denied',
      message: 'You don\'t have permission to perform this action.',
      recoverable: false,
      action: 'none'
    },

    UNKNOWN_ERROR: {
      code: 999,
      type: 'error',
      title: 'Something Went Wrong',
      message: 'An unexpected error occurred. Please try again.',
      recoverable: true,
      action: 'retry'
    }
  };

  const ULErrorHandler = {
    version: '4.1.0',

    history: [],
    maxHistory: 50,

    retryAttempts: {},

    toastEl: null,
    toastTimeout: null,

    show(errorCode, params = {}, options = {}) {
      const errorDef = ERROR_CODES[errorCode] || ERROR_CODES.UNKNOWN_ERROR;
      const message = this.interpolate(errorDef.message, params);

      this.log(errorCode, params, errorDef);

      this.emitError(errorCode, errorDef, params);

      this.showToast(message, errorDef.type, {
        title: errorDef.title,
        action: errorDef.action,
        onRetry: options.onRetry,
        duration: options.duration || this.getDuration(errorDef.type),
        ...options
      });

      return {
        code: errorDef.code,
        type: errorDef.type,
        message,
        recoverable: errorDef.recoverable,
        action: errorDef.action
      };
    },

    showInline(element, errorCode, params = {}) {
      if (!element) return;

      const errorDef = ERROR_CODES[errorCode] || ERROR_CODES.UNKNOWN_ERROR;
      const message = this.interpolate(errorDef.message, params);

      element.classList.add('ul-has-error');
      element.classList.remove('ul-has-warning', 'ul-has-success');

      if (errorDef.type === 'warning') {
        element.classList.remove('ul-has-error');
        element.classList.add('ul-has-warning');
      }

      let errorEl = element.querySelector('.ul-inline-error');
      if (!errorEl) {
        errorEl = document.createElement('div');
        errorEl.className = 'ul-inline-error';
        element.appendChild(errorEl);
      }

      errorEl.innerHTML = `
        <svg class="ul-inline-error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          ${errorDef.type === 'warning'
            ? '<path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>'
            : '<circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/>'}
        </svg>
        <span class="ul-inline-error-text">${message}</span>
      `;
      errorEl.style.display = 'flex';

      this.log(errorCode, params, errorDef);

      return { element, message };
    },

    clearInline(element) {
      if (!element) return;

      element.classList.remove('ul-has-error', 'ul-has-warning');

      const errorEl = element.querySelector('.ul-inline-error');
      if (errorEl) {
        errorEl.style.display = 'none';
      }
    },

    clearAllInline(container) {
      if (!container) return;

      container.querySelectorAll('.ul-has-error, .ul-has-warning').forEach(el => {
        el.classList.remove('ul-has-error', 'ul-has-warning');
      });

      container.querySelectorAll('.ul-inline-error').forEach(el => {
        el.style.display = 'none';
      });
    },

    showSuccess(message, options = {}) {
      this.showToast(message, 'success', {
        title: options.title || 'Success',
        duration: options.duration || 3000,
        ...options
      });
    },

    showWarning(message, options = {}) {
      this.showToast(message, 'warning', {
        title: options.title || 'Warning',
        duration: options.duration || 5000,
        ...options
      });
    },

    async retry(asyncFn, options = {}) {
      const {
        maxRetries = 3,
        baseDelay = 1000,
        maxDelay = 10000,
        onRetry = null,
        retryId = null
      } = options;

      const id = retryId || `retry_${Date.now()}`;
      this.retryAttempts[id] = 0;

      let lastError;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const result = await asyncFn();
          delete this.retryAttempts[id];
          return result;
        } catch (error) {
          lastError = error;
          this.retryAttempts[id] = attempt + 1;

          if (attempt < maxRetries) {
            const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);

            if (onRetry) {
              onRetry(attempt + 1, maxRetries, delay);
            }

            console.log(`[ULErrorHandler] Retry ${attempt + 1}/${maxRetries} in ${delay}ms`);
            await this.sleep(delay);
          }
        }
      }

      delete this.retryAttempts[id];
      throw lastError;
    },

    isRetrying(retryId) {
      return this.retryAttempts[retryId] > 0;
    },

    getRetryCount(retryId) {
      return this.retryAttempts[retryId] || 0;
    },

    validateFile(file, config = {}) {

      const {
        maxSize = 10240 * 1024 * 1024, // 10GB - Enterprise plan (backend validates per plan)
        allowedTypes = [
          'image/png', 'image/jpeg', 'image/webp', 'image/tiff',
          'image/vnd.adobe.photoshop', 'application/x-photoshop', 'image/x-psd',
          'image/svg+xml', 'application/pdf', 'application/postscript'
        ],
        allowedExtensions = ['png', 'jpg', 'jpeg', 'webp', 'tiff', 'tif', 'psd', 'svg', 'pdf', 'ai', 'eps'],
        minDpi = 150
      } = config;

      const errors = [];

      if (file.size > maxSize) {
        errors.push({
          code: 'UPLOAD_FILE_TOO_LARGE',
          params: { maxSize: this.formatFileSize(maxSize) }
        });
      }

      const ext = file.name.split('.').pop()?.toLowerCase();
      const isValidType = allowedTypes.includes(file.type) || allowedExtensions.includes(ext);

      if (!isValidType) {
        errors.push({
          code: 'UPLOAD_INVALID_TYPE',
          params: { allowedTypes: allowedExtensions.join(', ').toUpperCase() }
        });
      }

      return {
        valid: errors.length === 0,
        errors,
        file: {
          name: file.name,
          size: file.size,
          type: file.type,
          extension: ext
        }
      };
    },

    validateForm(fields) {
      const errors = [];
      const values = {};

      for (const [name, field] of Object.entries(fields)) {
        values[name] = field.value;

        if (field.required && !field.value) {
          errors.push({
            field: name,
            code: 'VALIDATION_REQUIRED',
            params: { fieldName: field.label || name }
          });
          continue;
        }

        if (field.validate && field.value) {
          const result = field.validate(field.value);
          if (result !== true) {
            errors.push({
              field: name,
              code: 'VALIDATION_INVALID_INPUT',
              params: {
                fieldName: field.label || name,
                hint: typeof result === 'string' ? result : ''
              }
            });
          }
        }
      }

      return {
        valid: errors.length === 0,
        errors,
        values
      };
    },

    showToast(message, type = 'info', options = {}) {

      let toast = document.getElementById('ul-error-toast');

      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'ul-error-toast';
        toast.className = 'ul-error-toast';
        toast.innerHTML = `
          <div class="ul-toast-icon"></div>
          <div class="ul-toast-content">
            <div class="ul-toast-title"></div>
            <div class="ul-toast-message"></div>
          </div>
          <button class="ul-toast-close" aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12" stroke-linecap="round"/>
            </svg>
          </button>
          <button class="ul-toast-action" style="display: none;">Retry</button>
        `;
        document.body.appendChild(toast);

        toast.querySelector('.ul-toast-close').addEventListener('click', () => {
          this.hideToast();
        });
      }

      this.toastEl = toast;

      if (this.toastTimeout) {
        clearTimeout(this.toastTimeout);
      }

      const titleEl = toast.querySelector('.ul-toast-title');
      const messageEl = toast.querySelector('.ul-toast-message');
      const iconEl = toast.querySelector('.ul-toast-icon');
      const actionEl = toast.querySelector('.ul-toast-action');

      titleEl.textContent = options.title || '';
      titleEl.style.display = options.title ? 'block' : 'none';
      messageEl.textContent = message;

      iconEl.innerHTML = this.getToastIcon(type);

      if (options.action === 'retry' && options.onRetry) {
        actionEl.textContent = 'Retry';
        actionEl.style.display = 'block';
        actionEl.onclick = () => {
          this.hideToast();
          options.onRetry();
        };
      } else if (options.action === 'refresh') {
        actionEl.textContent = 'Refresh';
        actionEl.style.display = 'block';
        actionEl.onclick = () => {
          window.location.reload();
        };
      } else {
        actionEl.style.display = 'none';
      }

      toast.className = `ul-error-toast active ${type}`;

      const duration = options.duration || this.getDuration(type);
      if (duration > 0) {
        this.toastTimeout = setTimeout(() => {
          this.hideToast();
        }, duration);
      }
    },

    hideToast() {
      if (this.toastEl) {
        this.toastEl.classList.remove('active');
      }
      if (this.toastTimeout) {
        clearTimeout(this.toastTimeout);
        this.toastTimeout = null;
      }
    },

    getToastIcon(type) {
      switch (type) {
        case 'success':
          return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        case 'warning':
          return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>';
        case 'error':
          return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6m0-6l6 6" stroke-linecap="round"/></svg>';
        case 'info':
        default:
          return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4m0-4h.01"/></svg>';
      }
    },

    getDuration(type) {
      switch (type) {
        case 'error': return 6000;
        case 'warning': return 5000;
        case 'success': return 3000;
        case 'info': default: return 4000;
      }
    },

    interpolate(template, params) {
      return template.replace(/\{(\w+)\}/g, (match, key) => {
        return params[key] !== undefined ? params[key] : match;
      });
    },

    formatFileSize(bytes) {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    },

    sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    },

    log(errorCode, params, errorDef) {
      const entry = {
        timestamp: new Date().toISOString(),
        code: errorCode,
        type: errorDef.type,
        params,
        url: window.location.href
      };

      this.history.unshift(entry);

      if (this.history.length > this.maxHistory) {
        this.history = this.history.slice(0, this.maxHistory);
      }

      const logMethod = errorDef.type === 'error' ? 'error' : errorDef.type === 'warning' ? 'warn' : 'log';
      console[logMethod](`[ULError] ${errorCode}:`, params);
    },

    emitError(errorCode, errorDef, params) {

      if (window.ULEvents) {
        window.ULEvents.emit('ul:error', {
          code: errorCode,
          type: errorDef.type,
          title: errorDef.title,
          params,
          timestamp: Date.now()
        });
      }

      document.dispatchEvent(new CustomEvent('ul:error', {
        detail: {
          code: errorCode,
          type: errorDef.type,
          params
        }
      }));
    },

    getError(errorCode) {
      return ERROR_CODES[errorCode] || ERROR_CODES.UNKNOWN_ERROR;
    },

    getHistory() {
      return [...this.history];
    },

    clearHistory() {
      this.history = [];
    }
  };

  window.ULErrorHandler = ULErrorHandler;

  window.UL_ERROR_CODES = ERROR_CODES;

  console.log('[ULErrorHandler] Initialized v4.1.0');

})();
