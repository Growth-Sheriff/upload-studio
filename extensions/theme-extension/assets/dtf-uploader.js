/**
 * Product 3D Customizer - DTF Uploader v4.5.0
 * ======================
 * FAZ 1: Core DTF Upload Widget
 * FAZ 4: Global State Integration
 *
 * Features:
 * - File upload with drag & drop
 * - Shopify Variants for size selection
 * - Quantity control
 * - Extra questions from merchant config
 * - Add to Cart with line item properties
 * - T-Shirt modal integration (FAZ 2)
 * - Global state sync (FAZ 4)
 * - Non-blocking thumbnail for PSD/PDF/AI/EPS/TIFF (v4.3.0)
 * - v4.4.1: Add to Cart enabled immediately after upload (no thumbnail wait)
 * - v4.5.0: 5s timeout for thumbnail, fallback icon, better UX messages
 *
 * State Management Architecture:
 * - Each product has its own isolated state
 * - State changes trigger UI updates
 * - Events dispatched for external integrations
 * - Syncs with ULState global store (FAZ 4)
 *
 * Prepared for:
 * - FAZ 2: T-Shirt Modal (event: ul:openTShirtModal)
 * - FAZ 3: Confirmation Screen
 * - FAZ 4: Global State sync ✓
 */

;(function () {
  'use strict'

  // ===== CONSTANTS =====
  const ALLOWED_TYPES = [
    // 🟢 Raster - Temel
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/tiff', // TIFF support
    // 🟢 Profesyonel Raster
    'image/vnd.adobe.photoshop', // PSD
    'application/x-photoshop', // PSD alternative MIME
    'image/x-psd', // PSD alternative MIME
    // 🟡 Vektör
    'image/svg+xml',
    'application/pdf',
    'application/postscript', // AI, EPS
    'application/illustrator',
  ]
  const ALLOWED_EXTENSIONS = [
    // 🟢 Raster - Temel
    'png',
    'jpg',
    'jpeg',
    'webp',
    'tiff',
    'tif',
    // 🟢 Profesyonel Raster
    'psd',
    // 🟡 Vektör
    'svg',
    'pdf',
    'ai',
    'eps',
  ]
  // v4.5.0: Enterprise plan - 10GB file support
  const MAX_FILE_SIZE = 10240 * 1024 * 1024 // 10GB - Enterprise plan (backend validates per plan)
  const POLL_INTERVAL = 1000 // 1 second
  const MAX_POLLS = 120 // 120 seconds max wait for large files

  // FAZ 3 - EDGE-001: Tab-specific session ID for multi-tab isolation
  const TAB_SESSION_ID = `ul_tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

  // ===== GLOBAL NAMESPACE =====
  const ULDTFUploader = {
    instances: {},
    version: '4.5.0', // v4.5.0: Non-blocking Add to Cart, 5s thumbnail timeout, fallback icons

    /**
     * Initialize uploader for a product
     * @param {string} productId - Shopify product ID
     */
    init(productId) {
      if (this.instances[productId]) {
        console.warn(`[UL] Uploader already initialized for product ${productId}`)
        return
      }

      const container = document.getElementById(`ul-dtf-${productId}`)
      if (!container) {
        console.error(`[UL] Container not found for product ${productId}`)
        return
      }

      // Create instance with initial state
      const instance = {
        productId,
        container,
        apiBase: container.dataset.apiBase,
        shopDomain: container.dataset.shopDomain,
        productTitle: container.dataset.productTitle,

        // FAZ 1 State (matches architecture doc)
        state: {
          upload: {
            status: 'idle', // idle | uploading | processing | ready | error
            progress: 0,
            uploadId: null,
            file: { name: '', size: 0, type: '' },
            result: {
              thumbnailUrl: '',
              originalUrl: '',
              width: 0,
              height: 0,
              dpi: 0,
              colorMode: '',
              qualityScore: 0,
              warnings: [],
            },
            error: null,
          },
          form: {
            selectedVariantId: null,
            selectedVariantTitle: '',
            selectedVariantPrice: 0,
            quantity: 1,
            extraAnswers: {},
            isValid: false,
          },
          config: {
            uploadEnabled: true,
            tshirtEnabled: false,
            allowedFileTypes: ALLOWED_EXTENSIONS,
            maxFileSizeMB: 1024, // 1GB default, backend validates per plan
            minDPI: 150,
            extraQuestions: [],
            bulkDiscountThreshold: 10,
            bulkDiscountPercent: 10,
          },
        },

        elements: null,
        pollCount: 0,
        activeXHR: null, // v4.2.0: Track active XHR for cancel support
        isCancelled: false, // v4.2.0: Track if upload was cancelled
      }

      // Get DOM elements
      instance.elements = this.getElements(productId)
      this.instances[productId] = instance

      // Load config and initialize
      this.loadConfig(productId)
    },

    /**
     * Get all DOM elements for a product
     */
    getElements(productId) {
      const $ = (id) => document.getElementById(`ul-${id}-${productId}`)
      return {
        container: document.getElementById(`ul-dtf-${productId}`),
        loading: $('loading'),
        content: $('content'),
        error: $('error'),
        errorText: $('error-text'),

        // Upload
        dropzone: $('dropzone'),
        fileInput: $('file-input'),
        progress: $('progress'),
        progressFill: $('progress-fill'),
        progressText: $('progress-text'),
        cancelBtn: $('cancel-upload'), // v4.2.0: Cancel upload button
        preview: $('preview'),
        thumb: $('thumb'),
        filename: $('filename'),
        filemeta: $('filemeta'),
        filestatus: $('filestatus'),
        removeBtn: $('remove'),

        // Size (dropdown version)
        sizeSelect: $('size-select'),
        sizeGrid: $('size-grid'), // Legacy fallback
        sizeHint: $('size-hint'),
        selectedSize: $('selected-size'),

        // Quantity
        qtyInput: $('qty-input'),
        qtyMinus: $('qty-minus'),
        qtyPlus: $('qty-plus'),
        bulkHint: $('bulk-hint'),
        qtyDisplay: $('qty-display'),

        // Questions
        questionsSection: $('questions-section'),
        questionsContainer: $('questions'),

        // Price
        unitPrice: $('unit-price'),
        totalPrice: $('total-price'),
        btnPrice: $('btn-price'),

        // Buttons
        tshirtBtn: $('tshirt-btn'),
        addCartBtn: $('add-cart'),

        // Hidden fields
        uploadIdField: $('upload-id'),
        uploadUrlField: $('upload-url'),
        thumbnailUrlField: $('thumbnail-url'),

        // Steps
        step1: $('step-1'),
        step2: $('step-2'),
        step3: $('step-3'),
        step4: $('step-4'),
      }
    },

    /**
     * Load product configuration from API
     */
    async loadConfig(productId) {
      const instance = this.instances[productId]
      const { elements, apiBase, shopDomain, state } = instance

      try {
        const response = await fetch(
          `${apiBase}/api/product-config/${productId}?shop=${encodeURIComponent(shopDomain)}`
        )

        if (!response.ok) {
          throw new Error('Failed to load configuration')
        }

        const config = await response.json()

        // Update state with config
        Object.assign(state.config, {
          uploadEnabled: config.uploadEnabled !== false,
          tshirtEnabled: config.tshirtEnabled === true,
          tshirtConfig: config.tshirtConfig || null,
          extraQuestions: config.extraQuestions || [],
        })

        if (!state.config.uploadEnabled) {
          elements.container.style.display = 'none'
          return
        }

        // Render extra questions if any
        if (state.config.extraQuestions.length > 0) {
          this.renderExtraQuestions(productId)
        }

        // Show T-Shirt button if enabled
        if (state.config.tshirtEnabled) {
          elements.tshirtBtn.style.display = 'flex'
        }

        // Initialize selected variant
        // v4.3.0: Check for option buttons first (new system)
        const variantsJsonEl = document.getElementById(`ul-variants-json-${productId}`)
        const hasOptionButtons = elements.container.querySelector('.ul-option-btn')

        if (variantsJsonEl && hasOptionButtons) {
          // New option buttons system - variant will be set by bindOptionButtons
          console.log('[UL] Using option buttons for variant selection')
          // Get initial variant from hidden input
          if (elements.sizeSelect && elements.sizeSelect.value) {
            state.form.selectedVariantId = elements.sizeSelect.value
            state.form.selectedVariantPrice =
              parseInt(elements.sizeSelect.dataset.priceRaw, 10) || 0
            this.updatePriceDisplay(productId)
          }
        } else if (elements.sizeSelect && elements.sizeSelect.tagName === 'SELECT') {
          // Legacy dropdown
          const selectedOption = elements.sizeSelect.options[elements.sizeSelect.selectedIndex]
          if (selectedOption && !selectedOption.disabled) {
            state.form.selectedVariantId = selectedOption.value
            state.form.selectedVariantTitle = selectedOption.dataset.title
            state.form.selectedVariantPrice = parseInt(selectedOption.dataset.priceRaw, 10)
            this.updatePriceDisplay(productId)
          }
        } else if (elements.sizeGrid) {
          // Legacy fallback for radio grid
          const firstVariant = elements.sizeGrid.querySelector(
            'input[type="radio"]:not(:disabled):checked'
          )
          if (firstVariant) {
            state.form.selectedVariantId = firstVariant.value
            state.form.selectedVariantTitle = firstVariant.dataset.title
            state.form.selectedVariantPrice = parseInt(firstVariant.dataset.priceRaw, 10)
            this.updatePriceDisplay(productId)
          }
        } else {
          // FAZ 2 - DTF-002: Single variant product - no size selector visible
          console.log('[UL] No size selector found - checking for single variant product')

          // Try to find hidden variant input in cart form
          const form = document.querySelector(`form[action*="/cart/add"]`)
          const hiddenVariant = form?.querySelector('input[name="id"]')

          if (hiddenVariant && hiddenVariant.value) {
            state.form.selectedVariantId = hiddenVariant.value
            state.form.selectedVariantTitle = 'Default'
            console.log('[UL] Single variant product detected, variant ID:', hiddenVariant.value)
          } else {
            // Last resort: try data attribute on product form
            const productForm = document.querySelector('[data-product-form]')
            const variantId =
              productForm?.dataset.variantId ||
              document.querySelector('[data-variant-id]')?.dataset.variantId

            if (variantId) {
              state.form.selectedVariantId = variantId
              state.form.selectedVariantTitle = 'Default'
              console.log('[UL] Variant from data attribute:', variantId)
            }
          }

          // Universal fallbacks if still no variant ID
          if (!state.form.selectedVariantId) {
            // Try Shopify product JSON script tag (works on most themes)
            const productJsonEl = document.querySelector('[data-product-json], script[type="application/json"][data-product-json], #ProductJson-product-template, .product-json')
            if (productJsonEl) {
              try {
                const productData = JSON.parse(productJsonEl.textContent)
                const variants = productData?.variants || productData?.product?.variants
                if (variants?.[0]) {
                  state.form.selectedVariantId = String(variants[0].id)
                  state.form.selectedVariantTitle = variants[0].title || 'Default'
                  console.log('[UL] Variant from product JSON:', state.form.selectedVariantId)
                }
              } catch (e) { /* invalid JSON, skip */ }
            }
          }

          if (!state.form.selectedVariantId) {
            // Try URL ?variant= parameter
            const urlVariant = new URL(window.location.href).searchParams.get('variant')
            if (urlVariant) {
              state.form.selectedVariantId = urlVariant
              state.form.selectedVariantTitle = 'Default'
              console.log('[UL] Variant from URL parameter:', urlVariant)
            }
          }

          if (!state.form.selectedVariantId) {
            // Try any input with variant in the name within product form
            const anyVariantInput = document.querySelector('select[name="id"], input[name="id"][type="hidden"], input[name="variant_id"]')
            if (anyVariantInput?.value) {
              state.form.selectedVariantId = anyVariantInput.value
              state.form.selectedVariantTitle = 'Default'
              console.log('[UL] Variant from generic input:', anyVariantInput.value)
            }
          }

          if (!state.form.selectedVariantId) {
            console.warn('[UL] Could not determine variant ID - add to cart may fail')
          }
        }

        // Bind events
        this.bindEvents(productId)

        // Show content
        elements.loading.classList.remove('active')
        elements.content.style.display = 'block'
      } catch (error) {
        console.error('[UL] Config load error:', error?.message || error?.status || JSON.stringify(error) || 'Unknown error')
        elements.loading.innerHTML = '<div>Failed to load. Please refresh the page.</div>'
      }
    },

    /**
     * Render extra questions from config
     */
    renderExtraQuestions(productId) {
      const instance = this.instances[productId]
      const { elements, state } = instance
      const questions = state.config.extraQuestions

      if (!questions.length) return

      elements.questionsSection.style.display = 'block'
      elements.questionsContainer.innerHTML = ''

      // Update step numbers (questions become step 4, steps 2-3 stay same)
      if (elements.step4) elements.step4.textContent = '4'

      questions.forEach((q, index) => {
        const fieldId = `ul-q-${productId}-${q.id || index}`
        const fieldDiv = document.createElement('div')
        fieldDiv.className = q.type === 'checkbox' ? 'ul-field checkbox' : 'ul-field'

        const label = document.createElement('label')
        label.setAttribute('for', fieldId)
        label.textContent = q.label
        if (q.required) {
          const req = document.createElement('span')
          req.className = 'required'
          req.textContent = ' *'
          label.appendChild(req)
        }

        let input
        switch (q.type) {
          case 'textarea':
            input = document.createElement('textarea')
            input.id = fieldId
            input.name = `properties[${q.label}]`
            if (q.required) input.required = true
            if (q.placeholder) input.placeholder = q.placeholder
            fieldDiv.appendChild(label)
            fieldDiv.appendChild(input)
            break

          case 'select':
            input = document.createElement('select')
            input.id = fieldId
            input.name = `properties[${q.label}]`
            if (q.required) input.required = true

            const defOpt = document.createElement('option')
            defOpt.value = ''
            defOpt.textContent = 'Select...'
            input.appendChild(defOpt)
            ;(q.options || []).forEach((opt) => {
              const option = document.createElement('option')
              option.value = typeof opt === 'string' ? opt : opt.value
              option.textContent = typeof opt === 'string' ? opt : opt.label
              input.appendChild(option)
            })
            fieldDiv.appendChild(label)
            fieldDiv.appendChild(input)
            break

          case 'checkbox':
            input = document.createElement('input')
            input.type = 'checkbox'
            input.id = fieldId
            input.name = `properties[${q.label}]`
            input.value = 'Yes'
            fieldDiv.appendChild(input)
            fieldDiv.appendChild(label)
            break

          case 'number':
            input = document.createElement('input')
            input.type = 'number'
            input.id = fieldId
            input.name = `properties[${q.label}]`
            if (q.required) input.required = true
            if (q.min !== undefined) input.min = q.min
            if (q.max !== undefined) input.max = q.max
            fieldDiv.appendChild(label)
            fieldDiv.appendChild(input)
            break

          default: // text
            input = document.createElement('input')
            input.type = 'text'
            input.id = fieldId
            input.name = `properties[${q.label}]`
            if (q.required) input.required = true
            if (q.placeholder) input.placeholder = q.placeholder
            fieldDiv.appendChild(label)
            fieldDiv.appendChild(input)
        }

        // Add change listener for validation
        if (input) {
          input.addEventListener('change', () =>
            this.updateExtraAnswer(productId, q.id || index, q.label, input)
          )
        }

        elements.questionsContainer.appendChild(fieldDiv)
      })
    },

    /**
     * Update extra answer in state
     */
    updateExtraAnswer(productId, questionId, label, input) {
      const instance = this.instances[productId]
      if (input.type === 'checkbox') {
        instance.state.form.extraAnswers[label] = input.checked ? 'Yes' : 'No'
      } else {
        instance.state.form.extraAnswers[label] = input.value
      }
      this.validateForm(productId)
    },

    /**
     * Bind all event handlers
     */
    bindEvents(productId) {
      const instance = this.instances[productId]
      const { elements } = instance

      // Dropzone click
      elements.dropzone.addEventListener('click', () => {
        elements.fileInput.click()
      })

      // File input change
      elements.fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
          this.handleFileSelect(productId, e.target.files[0])
        }
      })

      // Drag & drop
      elements.dropzone.addEventListener('dragover', (e) => {
        e.preventDefault()
        elements.dropzone.classList.add('dragover')
      })

      elements.dropzone.addEventListener('dragleave', (e) => {
        e.preventDefault()
        elements.dropzone.classList.remove('dragover')
      })

      elements.dropzone.addEventListener('drop', (e) => {
        e.preventDefault()
        elements.dropzone.classList.remove('dragover')
        if (e.dataTransfer.files.length > 0) {
          this.handleFileSelect(productId, e.dataTransfer.files[0])
        }
      })

      // Remove file
      elements.removeBtn.addEventListener('click', () => {
        this.clearUpload(productId)
      })

      // v4.2.0: Cancel upload button
      if (elements.cancelBtn) {
        elements.cancelBtn.addEventListener('click', () => {
          this.cancelUpload(productId)
        })
      }

      // Size selection - Option buttons (v4.3.0), Dropdown fallback, or legacy grid
      this.bindOptionButtons(productId)

      if (elements.sizeSelect && !elements.sizeSelect.type) {
        // Hidden input (new option buttons system) - already handled by bindOptionButtons
        console.log('[UL] Using option buttons for variant selection')
      } else if (elements.sizeSelect && elements.sizeSelect.tagName === 'SELECT') {
        // Legacy dropdown fallback
        elements.sizeSelect.addEventListener('change', (e) => {
          const option = e.target.options[e.target.selectedIndex]
          if (option && option.value) {
            instance.state.form.selectedVariantId = option.value
            instance.state.form.selectedVariantTitle = option.dataset.title || option.textContent
            instance.state.form.selectedVariantPrice = parseInt(option.dataset.priceRaw, 10) || 0
            this.updatePriceDisplay(productId)
            this.validateForm(productId)

            // FAZ 8: Track size selection
            if (window.ULAnalytics) {
              window.ULAnalytics.trackDTFSizeSelected({
                size: option.dataset.title || option.textContent,
                variantId: option.value,
                price: instance.state.form.selectedVariantPrice / 100,
                productId,
              })
            }
          }
        })
      } else if (elements.sizeGrid) {
        // Legacy radio grid fallback
        elements.sizeGrid.querySelectorAll('input[type="radio"]').forEach((radio) => {
          radio.addEventListener('change', () => {
            instance.state.form.selectedVariantId = radio.value
            instance.state.form.selectedVariantTitle = radio.dataset.title
            instance.state.form.selectedVariantPrice = parseInt(radio.dataset.priceRaw, 10)
            this.updatePriceDisplay(productId)
            this.validateForm(productId)

            // FAZ 8: Track size selection
            if (window.ULAnalytics) {
              window.ULAnalytics.trackDTFSizeSelected({
                size: radio.dataset.title,
                variantId: radio.value,
                price: instance.state.form.selectedVariantPrice / 100,
                productId,
              })
            }
          })
        })
      }

      // Quantity controls
      elements.qtyMinus.addEventListener('click', () => {
        const current = parseInt(elements.qtyInput.value, 10) || 1
        if (current > 1) {
          elements.qtyInput.value = current - 1
          instance.state.form.quantity = current - 1
          this.updatePriceDisplay(productId)
        }
      })

      elements.qtyPlus.addEventListener('click', () => {
        const current = parseInt(elements.qtyInput.value, 10) || 1
        if (current < 999) {
          elements.qtyInput.value = current + 1
          instance.state.form.quantity = current + 1
          this.updatePriceDisplay(productId)
        }
      })

      elements.qtyInput.addEventListener('change', () => {
        let val = parseInt(elements.qtyInput.value, 10) || 1
        val = Math.max(1, Math.min(999, val))
        elements.qtyInput.value = val
        instance.state.form.quantity = val
        this.updatePriceDisplay(productId)
      })

      // T-Shirt button
      if (elements.tshirtBtn) {
        console.log('[UL] T-Shirt button found, adding click listener')
        elements.tshirtBtn.addEventListener('click', () => {
          console.log('[UL] T-Shirt button clicked!')
          this.openTShirtModal(productId)
        })
      } else {
        console.warn('[UL] T-Shirt button NOT found in DOM')
      }

      // Add to Cart button
      elements.addCartBtn.addEventListener('click', () => {
        this.addToCart(productId)
      })
    },

    /**
     * Handle file selection
     * FAZ 7: Enhanced error handling with ULErrorHandler
     */
    async handleFileSelect(productId, file) {
      const instance = this.instances[productId]
      const { elements, apiBase, shopDomain, state } = instance

      // v4.2.0: Cancel any existing upload before starting new one
      if (instance.activeXHR) {
        console.log('[UL] Cancelling existing upload to start new one')
        this.cancelUpload(productId)
      }

      // Reset cancelled flag for new upload
      instance.isCancelled = false

      // 0-byte file protection: Reject empty files immediately
      if (!file.size || file.size === 0) {
        this.showError(productId, 'The selected file is empty (0 bytes). Please select a valid file.')
        console.error('[DTF Uploader] 0-byte file rejected:', file.name)
        return
      }

      // FAZ 7: Use ULErrorHandler for file validation
      if (window.ULErrorHandler) {
        const validation = window.ULErrorHandler.validateFile(file, {
          maxSize: MAX_FILE_SIZE,
          allowedExtensions: ALLOWED_EXTENSIONS,
        })

        if (!validation.valid) {
          const err = validation.errors[0]
          window.ULErrorHandler.show(err.code, err.params, {
            onRetry: () => elements.fileInput.click(),
          })
          this.showError(
            productId,
            window.ULErrorHandler.getError(err.code)
              .message.replace('{maxSize}', err.params.maxSize || '1.4GB')
              .replace(
                '{allowedTypes}',
                err.params.allowedTypes || ALLOWED_EXTENSIONS.join(', ').toUpperCase()
              )
          )
          return
        }
      } else {
        // Fallback validation
        const ext = file.name.split('.').pop().toLowerCase()
        if (!ALLOWED_EXTENSIONS.includes(ext)) {
          this.showError(
            productId,
            `Invalid file type. Allowed: ${ALLOWED_EXTENSIONS.join(', ').toUpperCase()}`
          )
          return
        }

        if (file.size > MAX_FILE_SIZE) {
          this.showError(productId, 'File too large. Maximum size is 1.4GB.')
          return
        }
      }

      this.hideError(productId)

      // FAZ 1 - DTF-001: Store file reference for preview
      instance.lastFile = file

      // Update state
      state.upload.status = 'uploading'
      state.upload.progress = 0
      state.upload.file = { name: file.name, size: file.size, type: file.type }

      // Sync with global state (FAZ 4)
      if (window.ULState) {
        window.ULState.set('upload.status', 'uploading')
        window.ULState.set('upload.fileName', file.name)
        window.ULState.set('upload.fileSize', file.size)
        window.ULState.set('upload.mimeType', file.type)
      }

      // Emit global event (FAZ 4)
      if (window.ULEvents) {
        window.ULEvents.emit('uploadStart', {
          fileName: file.name,
          fileSize: file.size,
          productId,
        })
      }

      // FAZ 8: Track upload started
      if (window.ULAnalytics) {
        window.ULAnalytics.startTiming('dtf_upload')
        window.ULAnalytics.trackDTFUploadStarted({
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          productId,
        })
      }

      // Store upload start time for duration display
      instance.uploadStartTime = Date.now()

      // Show progress UI
      elements.dropzone.style.display = 'none'
      elements.progress.classList.add('active')
      elements.progressFill.style.width = '0%'
      elements.progressText.textContent = 'Preparing upload...'
      elements.step1.classList.remove('completed')

      try {
        // Get customer info if logged in
        const customerId = window.ULCustomer?.id || null
        const customerEmail = window.ULCustomer?.email || null

        // Get visitor tracking info (from ul-visitor.js)
        const visitorId = window.ULVisitor?.getVisitorId?.() || null
        const sessionId = window.ULVisitor?.getSessionId?.() || null

        // Step 1: Get signed URL from API
        const intentResponse = await fetch(`${apiBase}/api/upload/intent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shopDomain,
            productId,
            mode: 'dtf',
            fileName: file.name,
            contentType: file.type || 'application/octet-stream',
            fileSize: file.size,
            customerId: customerId ? String(customerId) : null,
            customerEmail: customerEmail,
            visitorId: visitorId,
            sessionId: sessionId,
          }),
        })

        if (!intentResponse.ok) {
          const err = await intentResponse.json().catch(() => ({}))
          throw new Error(err.error || 'Failed to prepare upload')
        }

        const intentData = await intentResponse.json()
        state.upload.uploadId = intentData.uploadId

        elements.progressFill.style.width = '15%'
        elements.progressText.textContent = 'Uploading...'

        // Step 2: Upload file directly to storage (provider-aware)
        // uploadToStorage returns result with fileUrl for CDN uploads
        const uploadResult = await this.uploadToStorage(productId, file, intentData)

        elements.progressFill.style.width = '80%'
        elements.progressText.textContent = 'Finalizing...'

        // Step 3: Complete upload
        // CRITICAL FIX: Use uploadResult's provider/URL when fallback was used
        // Calculate upload duration for analytics
        const uploadDurationMs = Date.now() - instance.uploadStartTime
        const actualStorageProvider = uploadResult?.storageProvider || intentData.storageProvider || 'local'
        const actualFileUrl = uploadResult?.fileUrl || intentData.publicUrl || null
        
        console.log('[UL] Completing upload with:', {
          provider: actualStorageProvider,
          fileUrl: actualFileUrl?.substring(0, 80),
          fallbackUsed: actualStorageProvider !== (intentData.storageProvider || 'local'),
        })
        
        const completeResponse = await fetch(`${apiBase}/api/upload/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shopDomain: shopDomain,
            uploadId: intentData.uploadId,
            items: [
              {
                itemId: intentData.itemId,
                location: 'front',
                fileUrl: actualFileUrl,
                storageProvider: actualStorageProvider,
                uploadDurationMs: uploadDurationMs,
              },
            ],
          }),
        })

        if (!completeResponse.ok) {
          const errData = await completeResponse.json().catch(() => ({}))
          throw new Error(errData.error || 'Failed to finalize upload')
        }

        // Step 4: Poll for processing status
        state.upload.status = 'processing'
        elements.progressText.textContent = 'Processing thumbnail...'
        await this.pollUploadStatus(productId, intentData.uploadId)
      } catch (error) {
        console.error('[UL] Upload error:', error)
        state.upload.status = 'error'
        state.upload.error = error.message
        elements.progress.classList.remove('active')
        elements.dropzone.style.display = 'block'

        // FAZ 7: Enhanced error handling
        const errorMessage = error.message || 'Upload failed. Please try again.'
        this.showError(productId, errorMessage)

        // FAZ 8: Track upload failed
        if (window.ULAnalytics) {
          window.ULAnalytics.trackDTFUploadFailed({
            fileName: state.upload.file.name,
            errorCode: 'UPLOAD_FAILED',
            errorMessage: errorMessage,
            productId,
          })
        }

        if (window.ULErrorHandler) {
          // Determine error type
          let errorCode = 'UPLOAD_FAILED'
          if (error.message?.includes('network') || error.message?.includes('connection')) {
            errorCode = 'UPLOAD_NETWORK_ERROR'
          } else if (error.message?.includes('timeout')) {
            errorCode = 'UPLOAD_TIMEOUT'
          } else if (error.message?.includes('process')) {
            errorCode = 'UPLOAD_PROCESSING_FAILED'
          }

          window.ULErrorHandler.show(
            errorCode,
            {},
            {
              onRetry: () => {
                this.hideError(productId)
                elements.fileInput.click()
              },
            }
          )
        }
      }
    },

    /**
     * Sleep helper for retry delays
     */
    sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms))
    },

    /**
     * Upload file to storage with BULLETPROOF retry + fallback
     * MULTI-STORAGE v3.0: Bunny → R2 → Local fallback chain
     *
     * Retry Strategy:
     * 1. Try primary storage (Bunny) up to 3 times with exponential backoff
     * 2. If all retries fail, try R2 fallback (if available)
     * 3. If R2 fails, try Local fallback
     * 4. If all fail, report error to user
     */
    async uploadToStorage(productId, file, intentData) {
      const instance = this.instances[productId]
      const { elements, state } = instance

      const primaryProvider = intentData.storageProvider || 'local'
      const retryConfig = intentData.retryConfig || { maxRetries: 3, retryDelayMs: 2000 }
      const fallbackUrls = intentData.fallbackUrls || {}

      console.log('[UL] uploadToStorage - primary provider:', primaryProvider)
      console.log('[UL] uploadToStorage - fallback available:', {
        r2: !!fallbackUrls.r2,
        local: !!fallbackUrls.local,
      })

      // Try primary provider with retries
      if (primaryProvider === 'bunny') {
        const bunnyResult = await this.uploadWithRetry(
          () => this.uploadToBunny(file, intentData, elements, productId),
          'Bunny',
          retryConfig,
          elements
        )

        if (bunnyResult.success) {
          console.log('[UL] ✅ Primary upload (Bunny) succeeded')
          // Return with provider info for api/upload/complete
          return {
            ...bunnyResult.data,
            storageProvider: 'bunny',
          }
        }

        console.warn('[UL] ⚠️ Primary upload (Bunny) failed after retries:', bunnyResult.error)

        // Try R2 fallback
        if (fallbackUrls.r2) {
          elements.progressText.textContent = 'Switching to backup storage...'

          const r2IntentData = {
            ...intentData,
            uploadUrl: fallbackUrls.r2.url,
            publicUrl: fallbackUrls.r2.publicUrl,
            storageProvider: 'r2',
          }

          const r2Result = await this.uploadWithRetry(
            () => this.uploadToR2(file, r2IntentData, elements, productId),
            'R2',
            { maxRetries: 2, retryDelayMs: 1000 },
            elements
          )

          if (r2Result.success) {
            console.log('[UL] ✅ R2 fallback succeeded')
            // Update state with new provider info
            state.upload.actualProvider = 'r2'
            // Return with correct URL and provider for api/upload/complete
            return {
              ...r2Result.data,
              fileUrl: fallbackUrls.r2.publicUrl,
              storageProvider: 'r2',
            }
          }

          console.warn('[UL] ⚠️ R2 fallback failed:', r2Result.error)
        }

        // Try Local fallback
        if (fallbackUrls.local) {
          elements.progressText.textContent = 'Switching to local storage...'

          const localIntentData = {
            ...intentData,
            uploadUrl: fallbackUrls.local.url,
            publicUrl: fallbackUrls.local.publicUrl,
            storageProvider: 'local',
          }

          const localResult = await this.uploadWithRetry(
            () => this.uploadToLocal(file, localIntentData, elements, productId),
            'Local',
            { maxRetries: 1, retryDelayMs: 500 },
            elements
          )

          if (localResult.success) {
            console.log('[UL] ✅ Local fallback succeeded')
            state.upload.actualProvider = 'local'
            // Return with correct URL and provider for api/upload/complete
            return {
              ...localResult.data,
              fileUrl: fallbackUrls.local.publicUrl,
              storageProvider: 'local',
            }
          }

          console.error('[UL] ❌ All storage options failed')
        }

        // All failed - throw the original error
        throw new Error(bunnyResult.error || 'Upload failed - all storage options exhausted')
      }

      // Non-bunny primary providers (r2, local) - single attempt with fallback
      switch (primaryProvider) {
        case 'r2':
          return this.uploadToR2(file, intentData, elements, productId)
        case 'local':
        default:
          return this.uploadToLocal(file, intentData, elements, productId)
      }
    },

    /**
     * Retry wrapper with exponential backoff
     * @param {Function} uploadFn - The upload function to retry
     * @param {string} providerName - Provider name for logging
     * @param {Object} config - Retry configuration
     * @param {Object} elements - UI elements for progress updates
     * @returns {Promise<{success: boolean, data?: any, error?: string}>}
     */
    async uploadWithRetry(uploadFn, providerName, config, elements) {
      const { maxRetries, retryDelayMs } = config
      let lastError = null

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`[UL] ${providerName} upload attempt ${attempt}/${maxRetries}`)

          const result = await uploadFn()
          return { success: true, data: result }
        } catch (error) {
          lastError = error

          // Log detailed error info
          console.warn(`[UL] ${providerName} attempt ${attempt} failed:`, {
            message: error.message,
            name: error.name,
            attempt,
            maxRetries,
            isFatal: error.isFatal
          })

          // Don't retry on user cancellation
          if (error.message?.includes('cancelled') || error.message?.includes('aborted')) {
            return { success: false, error: error.message }
          }

          // Research Fix: Don't retry on fatal network errors (blocked connection)
          if (error.isFatal || error.message?.includes('blocked')) {
             console.warn(`[UL] ${providerName} fatal error detected, skipping retries.`)
             return { success: false, error: error.message }
          }

          // If not last attempt, wait and retry
          if (attempt < maxRetries) {
            const delay = retryDelayMs * Math.pow(2, attempt - 1) // Exponential backoff
            elements.progressText.textContent = `Retrying (${attempt}/${maxRetries})... Please wait ${Math.ceil(delay / 1000)}s`

            await this.sleep(delay)
          }
        }
      }

      return {
        success: false,
        error: lastError?.message || `${providerName} upload failed after ${maxRetries} attempts`,
      }
    },

    /**
     * Upload to Bunny.net Storage (Direct PUT)
     */
    async uploadToBunny(file, intentData, elements, productId) {
      const startTime = Date.now()
      const fileSize = file.size
      const instance = productId ? this.instances[productId] : null

      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()

        // v4.2.0: Store XHR reference for cancel support
        if (instance) {
          instance.activeXHR = xhr
        }

        // v4.4.0: No timeout - large files (200MB+) need unlimited time
        // R2 fallback will handle if connection completely stalls

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const percent = 15 + (e.loaded / e.total) * 60
            elements.progressFill.style.width = `${percent}%`

            // Calculate speed and remaining time
            const elapsed = (Date.now() - startTime) / 1000
            const speed = elapsed > 0 ? e.loaded / elapsed : 0
            const remaining = speed > 0 ? (e.total - e.loaded) / speed : 0

            // Format sizes
            const loadedMB = (e.loaded / (1024 * 1024)).toFixed(1)
            const totalMB = (e.total / (1024 * 1024)).toFixed(1)
            const speedMBs = (speed / (1024 * 1024)).toFixed(1)

            // Format remaining time
            const remainingText =
              remaining < 60
                ? `~${Math.ceil(remaining)}s left`
                : `~${Math.ceil(remaining / 60)}m left`

            elements.progressText.textContent = `${loadedMB} / ${totalMB} MB • ${speedMBs} MB/s • ${remainingText}`
          }
        })

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            const duration = ((Date.now() - startTime) / 1000).toFixed(1)
            const totalMB = (fileSize / (1024 * 1024)).toFixed(1)
            elements.progressText.textContent = `✓ ${totalMB} MB uploaded in ${duration}s`
            resolve({ fileUrl: intentData.publicUrl })
          } else {
            // Enhanced error logging
            const errorDetails = {
              status: xhr.status,
              statusText: xhr.statusText,
              responseText: xhr.responseText?.substring(0, 500) || '',
              url: intentData.uploadUrl?.substring(0, 100) || '',
            }
            console.error('[UL] Bunny upload HTTP error:', errorDetails)
            reject(new Error(`Bunny upload failed: HTTP ${xhr.status} - ${xhr.statusText}`))
          }
        })

        xhr.addEventListener('error', (event) => {
          // Enhanced network error logging
          const errorDetails = {
            type: 'network_error',
            readyState: xhr.readyState,
            status: xhr.status,
            statusText: xhr.statusText,
            responseType: xhr.responseType,
            withCredentials: xhr.withCredentials,
            url: intentData.uploadUrl?.substring(0, 100) || '',
            fileSize: file.size,
            elapsed: Date.now() - startTime,
          }
          console.error('[UL] Bunny network error details:', errorDetails)
          
          // Try to provide more specific error message
          let errorMsg = 'Network error during Bunny upload'
          let isFatal = false

          // Research Fix: Detect blocking (Status 0)
          if (xhr.status === 0) {
            errorMsg = 'Connection blocked (Firewall/CORS) - failing over'
            isFatal = true
          } else if (xhr.readyState < 4) {
            errorMsg = `Connection interrupted at state ${xhr.readyState}`
          }
          
          const error = new Error(errorMsg)
          if (isFatal) error.isFatal = true
          reject(error)
        })

        // v4.4.0: Timeout disabled - this listener kept for future use if needed
        // xhr.addEventListener('timeout', () => {
        //   console.error('[UL] Bunny upload timeout after', Date.now() - startTime, 'ms')
        //   reject(new Error('Upload timeout - connection too slow'))
        // })

        xhr.addEventListener('abort', () => reject(new Error('Bunny upload cancelled')))

        xhr.open('PUT', intentData.uploadUrl)

        // Set Bunny headers
        if (intentData.uploadHeaders) {
          Object.entries(intentData.uploadHeaders).forEach(([key, value]) => {
            xhr.setRequestHeader(key, value)
          })
        }
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')

        xhr.send(file)
      })
    },

    /**
     * Upload to R2 (Presigned PUT)
     */
    async uploadToR2(file, intentData, elements, productId) {
      const startTime = Date.now()
      const fileSize = file.size
      const instance = productId ? this.instances[productId] : null

      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()

        // v4.2.0: Store XHR reference for cancel support
        if (instance) {
          instance.activeXHR = xhr
        }

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const percent = 15 + (e.loaded / e.total) * 60
            elements.progressFill.style.width = `${percent}%`

            // Calculate speed and remaining time
            const elapsed = (Date.now() - startTime) / 1000
            const speed = elapsed > 0 ? e.loaded / elapsed : 0
            const remaining = speed > 0 ? (e.total - e.loaded) / speed : 0

            // Format sizes
            const loadedMB = (e.loaded / (1024 * 1024)).toFixed(1)
            const totalMB = (e.total / (1024 * 1024)).toFixed(1)
            const speedMBs = (speed / (1024 * 1024)).toFixed(1)

            // Format remaining time
            const remainingText =
              remaining < 60
                ? `~${Math.ceil(remaining)}s left`
                : `~${Math.ceil(remaining / 60)}m left`

            elements.progressText.textContent = `${loadedMB} / ${totalMB} MB • ${speedMBs} MB/s • ${remainingText}`
          }
        })

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            const duration = ((Date.now() - startTime) / 1000).toFixed(1)
            const totalMB = (fileSize / (1024 * 1024)).toFixed(1)
            elements.progressText.textContent = `✓ ${totalMB} MB uploaded in ${duration}s`
            resolve({ fileUrl: intentData.publicUrl })
          } else {
            // Enhanced error logging for R2
            const errorDetails = {
              status: xhr.status,
              statusText: xhr.statusText,
              responseText: xhr.responseText?.substring(0, 500) || '',
            }
            console.error('[UL] R2 upload HTTP error:', errorDetails)
            reject(new Error(`R2 upload failed: HTTP ${xhr.status} - ${xhr.statusText}`))
          }
        })

        xhr.addEventListener('error', (event) => {
          const errorDetails = {
            type: 'network_error',
            readyState: xhr.readyState,
            status: xhr.status,
            fileSize: file.size,
            elapsed: Date.now() - startTime,
          }
          console.error('[UL] R2 network error details:', errorDetails)
          reject(new Error('Network error during R2 upload - check CORS'))
        })

        xhr.addEventListener('abort', () => reject(new Error('R2 upload cancelled')))

        xhr.open('PUT', intentData.uploadUrl)
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
        xhr.send(file)
      })
    },

    /**
     * Upload to Local Server (POST with FormData)
     */
    async uploadToLocal(file, intentData, elements, productId) {
      const startTime = Date.now()
      const fileSize = file.size
      const instance = productId ? this.instances[productId] : null

      const formData = new FormData()
      formData.append('file', file)
      formData.append('key', intentData.key)
      formData.append('uploadId', intentData.uploadId)
      formData.append('itemId', intentData.itemId)

      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()

        // v4.2.0: Store XHR reference for cancel support
        if (instance) {
          instance.activeXHR = xhr
        }

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const percent = 15 + (e.loaded / e.total) * 60
            elements.progressFill.style.width = `${percent}%`

            // Calculate speed and remaining time
            const elapsed = (Date.now() - startTime) / 1000
            const speed = elapsed > 0 ? e.loaded / elapsed : 0
            const remaining = speed > 0 ? (e.total - e.loaded) / speed : 0

            // Format sizes
            const loadedMB = (e.loaded / (1024 * 1024)).toFixed(1)
            const totalMB = (e.total / (1024 * 1024)).toFixed(1)
            const speedMBs = (speed / (1024 * 1024)).toFixed(1)

            // Format remaining time
            const remainingText =
              remaining < 60
                ? `~${Math.ceil(remaining)}s left`
                : `~${Math.ceil(remaining / 60)}m left`

            elements.progressText.textContent = `${loadedMB} / ${totalMB} MB • ${speedMBs} MB/s • ${remainingText}`
          }
        })

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            const duration = ((Date.now() - startTime) / 1000).toFixed(1)
            const totalMB = (fileSize / (1024 * 1024)).toFixed(1)
            elements.progressText.textContent = `✓ ${totalMB} MB uploaded in ${duration}s`
            resolve()
          } else {
            reject(new Error(`Local upload failed (${xhr.status})`))
          }
        })

        xhr.addEventListener('error', () => reject(new Error('Network error during upload')))
        xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')))

        xhr.open('POST', intentData.uploadUrl)
        xhr.send(formData)
      })
    },

    /**
     * Poll upload status until processing complete
     * FAZ 1 - DTF-005: Proper Promise wrapper for setTimeout error handling
     */
    async pollUploadStatus(productId, uploadId) {
      const instance = this.instances[productId]
      const { elements, apiBase, shopDomain, state } = instance

      instance.pollCount = 0

      // FAZ 1 - DTF-005: Wrap in Promise to properly handle setTimeout errors
      return new Promise((resolveAll, rejectAll) => {
        const doPoll = async () => {
          try {
            const response = await fetch(
              `${apiBase}/api/upload/status/${uploadId}?shopDomain=${encodeURIComponent(shopDomain)}`
            )

            if (!response.ok) {
              throw new Error('Failed to check status')
            }

            const data = await response.json()

            // v4.4.1: NON-BLOCKING thumbnail - Add to Cart should work immediately
            // Don't wait for thumbnail, proceed when upload is finished
            const NON_BROWSER_FORMATS = ['psd', 'pdf', 'ai', 'eps', 'tiff', 'tif']
            const fileExt = state.upload.file.name.split('.').pop()?.toLowerCase() || ''
            const isNonBrowserFormat = NON_BROWSER_FORMATS.includes(fileExt)

            // Accept all "finished" statuses - including blocked/warning (DPI issues etc.)
            const finishedStatuses = ['ready', 'completed', 'blocked', 'needs_review', 'uploaded']
            const isFinished = finishedStatuses.includes(data.status)
            const hasThumbnail = !!data.thumbnailUrl

            // v4.4.1: Proceed immediately when upload is finished
            // Thumbnail will be polled in background - don't block Add to Cart
            const canProceed = isFinished

            if (canProceed) {
              // Success - upload processing complete (may have warnings)
              state.upload.status = 'ready'
              state.upload.uploadId = uploadId // CRITICAL: Set uploadId for addToCart
              state.upload.result = {
                thumbnailUrl: data.thumbnailUrl || '',
                originalUrl: data.downloadUrl || data.url || '',
                width: data.metadata?.width || 0,
                height: data.metadata?.height || 0,
                dpi: data.metadata?.dpi || 0,
                colorMode: data.metadata?.colorMode || '',
                qualityScore: data.qualityScore || 100,
                warnings: data.warnings || [],
              }

              // Update hidden fields
              elements.uploadIdField.value = uploadId
              elements.uploadUrlField.value = state.upload.result.originalUrl
              elements.thumbnailUrlField.value = state.upload.result.thumbnailUrl

              // Sync with global state (FAZ 4)
              if (window.ULState) {
                window.ULState.setUploadComplete({
                  id: uploadId,
                  thumbnailUrl: state.upload.result.thumbnailUrl,
                  url: state.upload.result.originalUrl,
                  name: state.upload.file.name,
                  size: state.upload.file.size,
                  mimeType: state.upload.file.type,
                  dimensions: {
                    width: state.upload.result.width,
                    height: state.upload.result.height,
                    dpi: state.upload.result.dpi,
                  },
                })

                // Update DTF state
                window.ULState.set('dtf.productId', productId)
              }

              // Emit global event (FAZ 4)
              if (window.ULEvents) {
                window.ULEvents.emit('uploadComplete', {
                  uploadId,
                  productId,
                  thumbnailUrl: state.upload.result.thumbnailUrl,
                  originalUrl: state.upload.result.originalUrl,
                })
              }

              // Visitor Tracking: Dispatch ul:upload:complete event for ULVisitor integration
              window.dispatchEvent(
                new CustomEvent('ul:upload:complete', {
                  detail: {
                    uploadId,
                    productId,
                    thumbnailUrl: state.upload.result.thumbnailUrl,
                    originalUrl: state.upload.result.originalUrl,
                    fileName: state.upload.file.name,
                    fileSize: state.upload.file.size,
                  },
                })
              )

              // FAZ 3 - EDGE-001: Store upload in sessionStorage with tab session ID
              try {
                sessionStorage.setItem(
                  `ul_upload_${productId}`,
                  JSON.stringify({
                    tabSessionId: TAB_SESSION_ID,
                    uploadId: uploadId,
                    thumbnailUrl: state.upload.result.thumbnailUrl,
                    originalUrl: state.upload.result.originalUrl,
                    fileName: state.upload.file.name,
                    timestamp: Date.now(),
                  })
                )
              } catch (e) {
                console.warn('[UL] Failed to save upload to sessionStorage:', e)
              }

              // FAZ 8: Track upload completed
              if (window.ULAnalytics) {
                const uploadDuration = window.ULAnalytics.endTiming('dtf_upload')
                window.ULAnalytics.trackDTFUploadCompleted({
                  uploadId,
                  fileName: state.upload.file.name,
                  fileSize: state.upload.file.size,
                  width: state.upload.result.width,
                  height: state.upload.result.height,
                  dpi: state.upload.result.dpi,
                  duration: uploadDuration,
                  productId,
                })
              }

              // Show preview
              this.showPreview(productId)
              elements.progress.classList.remove('active')
              elements.step1.classList.add('completed')

              // FAZ 3 - DTF-006: Release file reference after successful upload to prevent memory leak
              setTimeout(() => {
                if (instance.lastFile) {
                  console.log('[UL] Releasing file reference for memory cleanup')
                  instance.lastFile = null
                }
              }, 5000) // 5 second delay to allow preview to complete

              // Enable buttons
              this.validateForm(productId)

              // FAZ 1 - DTF-005: Resolve promise on success
              resolveAll(data)
              return
            } else if (data.status === 'failed' || data.status === 'error') {
              // FAZ 1 - DTF-005: Reject promise on error
              rejectAll(new Error(data.error || 'Processing failed'))
              return
            } else {
              // Still processing - continue polling
              instance.pollCount++
              if (instance.pollCount >= MAX_POLLS) {
                // FAZ 1 - DTF-005: Reject promise on timeout
                rejectAll(new Error('Processing timeout. Please try again.'))
                return
              }

              const progress = 80 + (instance.pollCount / MAX_POLLS) * 15
              elements.progressFill.style.width = `${Math.min(progress, 95)}%`

              // FAZ 1 - DTF-005: Continue polling with doPoll (not poll)
              setTimeout(doPoll, POLL_INTERVAL)
            }
          } catch (error) {
            // FAZ 1 - DTF-005: Reject promise on any error
            rejectAll(error)
          }
        }

        // Start polling
        doPoll()
      }) // End Promise wrapper
    },

    /**
     * Show file preview after successful upload
     * FAZ 7: Enhanced DPI warning with ULErrorHandler
     */
    showPreview(productId) {
      const instance = this.instances[productId]
      const { elements, state } = instance
      const { file, result } = state.upload

      // Set filename
      elements.filename.textContent = file.name

      // Set metadata with upload duration
      const meta = []
      if (result.width && result.height) {
        meta.push(`${result.width} × ${result.height} px`)
      }
      if (result.dpi) {
        meta.push(`${result.dpi} DPI`)
      }
      meta.push(this.formatFileSize(file.size))

      // Add upload duration if available
      if (instance.uploadStartTime) {
        const duration = ((Date.now() - instance.uploadStartTime) / 1000).toFixed(1)
        meta.push(`uploaded in ${duration}s`)
      }

      elements.filemeta.textContent = meta.join(' • ')

      // FAZ 7: Check for low DPI warning
      const minDpi = state.config.minDPI || 150
      const hasLowDpi = result.dpi && result.dpi < minDpi
      const hasWarnings = (result.warnings && result.warnings.length > 0) || hasLowDpi
      const statusEl = elements.filestatus

      if (hasLowDpi && window.ULErrorHandler) {
        // Show DPI warning toast
        window.ULErrorHandler.show('UPLOAD_LOW_DPI', {
          actualDpi: result.dpi,
          minDpi: minDpi,
        })
      }

      if (hasWarnings) {
        elements.preview.classList.add('has-warning')
        statusEl.classList.add('warning')

        const warningText = hasLowDpi
          ? `Low resolution: ${result.dpi} DPI (recommended: ${minDpi}+ DPI)`
          : result.warnings[0]

        statusEl.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
          </svg>
          <span>${warningText}</span>
        `
      } else {
        elements.preview.classList.remove('has-warning')
        statusEl.classList.remove('warning')
        // v4.4.1: Different message for non-browser formats
        const NON_BROWSER_CHECK = ['psd', 'pdf', 'ai', 'eps', 'tiff', 'tif']
        const extCheck = file.name.split('.').pop()?.toLowerCase() || ''
        const isNonBrowser = NON_BROWSER_CHECK.includes(extCheck)

        statusEl.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span>${isNonBrowser ? 'Ready for Order - Thumbnail Processing' : 'Ready for print'}</span>
        `
      }

      // Set thumbnail - v4.4.1: Non-blocking thumbnail for PSD/PDF/AI/EPS/TIFF
      const NON_BROWSER_EXTENSIONS = ['psd', 'pdf', 'ai', 'eps', 'tiff', 'tif']
      const fileExt = file.name.split('.').pop()?.toLowerCase() || ''
      const isNonBrowserFormat = NON_BROWSER_EXTENSIONS.includes(fileExt)

      if (result.thumbnailUrl) {
        // Thumbnail ready from server
        elements.thumb.src = result.thumbnailUrl
        elements.thumb.classList.remove('loading-spinner')
      } else if (isNonBrowserFormat) {
        // v4.4.1: Non-browser format - Show processing message and file type icon
        // Add to Cart is already enabled - thumbnail is non-blocking
        console.log('[UL] Non-browser format detected, showing processing state:', fileExt)

        // Show file type specific icon with spinner overlay
        const fileTypeLabel = fileExt.toUpperCase()
        elements.thumb.src =
          'data:image/svg+xml,' +
          encodeURIComponent(`
          <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
            <!-- Background -->
            <rect width="100" height="100" rx="8" fill="#f9fafb"/>
            <!-- File icon -->
            <path d="M30 20 L60 20 L70 30 L70 80 L30 80 Z" fill="#e5e7eb" stroke="#9ca3af" stroke-width="2"/>
            <path d="M60 20 L60 30 L70 30" fill="#d1d5db" stroke="#9ca3af" stroke-width="2"/>
            <!-- File type label -->
            <text x="50" y="58" font-family="Arial, sans-serif" font-size="14" font-weight="bold" fill="#374151" text-anchor="middle">${fileTypeLabel}</text>
            <!-- Spinner ring -->
            <circle cx="75" cy="75" r="12" fill="white" stroke="#e5e7eb" stroke-width="2"/>
            <circle cx="75" cy="75" r="8" fill="none" stroke="#3b82f6" stroke-width="2" stroke-dasharray="25" stroke-dashoffset="15">
              <animateTransform attributeName="transform" type="rotate" from="0 75 75" to="360 75 75" dur="1s" repeatCount="indefinite"/>
            </circle>
          </svg>
        `)
        elements.thumb.classList.add('loading-spinner')

        // Start background polling for thumbnail (non-blocking)
        // 5 second timeout: if no thumbnail after 5s, show fallback icon
        this.pollForThumbnailWithTimeout(productId, state.upload.uploadId, 5000)
      } else if (file.type.startsWith('image/')) {
        // Browser-supported image: Use FileReader for instant preview
        const reader = new FileReader()
        reader.onload = (e) => {
          elements.thumb.src = e.target.result
        }
        reader.readAsDataURL(instance.lastFile || new Blob())
      } else {
        // Generic file icon
        elements.thumb.src =
          'data:image/svg+xml,' +
          encodeURIComponent(`
          <svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 24 24" fill="#6b7280">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/>
          </svg>
        `)
      }

      // Show preview, hide dropzone
      elements.dropzone.style.display = 'none'
      elements.preview.classList.add('active')

      // Enable T-Shirt button if config allows
      if (state.config.tshirtEnabled) {
        elements.tshirtBtn.disabled = false
      }
    },

    /**
     * v4.3.0: Poll for thumbnail in background (non-blocking)
     * Used for PSD/PDF/AI/EPS/TIFF files that need server-side thumbnail generation
     */
    async pollForThumbnail(productId, uploadId) {
      const instance = this.instances[productId]
      if (!instance || !uploadId) return

      const { elements, apiBase, shopDomain, state } = instance
      const MAX_THUMBNAIL_POLLS = 60 // 60 seconds max for thumbnail
      let pollCount = 0

      console.log('[UL] Starting background thumbnail polling for upload:', uploadId)

      const doPoll = async () => {
        try {
          // Check if upload was cancelled or instance destroyed
          if (!this.instances[productId] || instance.isCancelled) {
            console.log('[UL] Thumbnail polling stopped - instance cancelled')
            return
          }

          pollCount++
          if (pollCount > MAX_THUMBNAIL_POLLS) {
            console.log('[UL] Thumbnail polling timeout - using fallback icon')
            // Keep spinner, user can still proceed with cart
            return
          }

          const response = await fetch(
            `${apiBase}/api/upload/status/${uploadId}?shopDomain=${encodeURIComponent(shopDomain)}`
          )

          if (!response.ok) {
            setTimeout(doPoll, 1500)
            return
          }

          const data = await response.json()

          if (data.thumbnailUrl) {
            // Thumbnail ready!
            console.log('[UL] Thumbnail received:', data.thumbnailUrl)

            // Update state
            state.upload.result.thumbnailUrl = data.thumbnailUrl
            elements.thumbnailUrlField.value = data.thumbnailUrl

            // Update image smoothly
            const img = new Image()
            img.onload = () => {
              elements.thumb.src = data.thumbnailUrl
              elements.thumb.classList.remove('loading-spinner')
            }
            img.onerror = () => {
              console.warn('[UL] Thumbnail image load failed')
              // Keep spinner as fallback
            }
            img.src = data.thumbnailUrl

            // Emit event for other components
            window.dispatchEvent(
              new CustomEvent('ul:thumbnail:ready', {
                detail: { uploadId, productId, thumbnailUrl: data.thumbnailUrl },
              })
            )

            return // Success - stop polling
          }

          // No thumbnail yet, continue polling
          setTimeout(doPoll, 1500)
        } catch (error) {
          console.warn('[UL] Thumbnail poll error:', error)
          // Continue polling on error
          setTimeout(doPoll, 2000)
        }
      }

      // Start polling after short delay (give preflight time to start)
      setTimeout(doPoll, 1000)
    },

    /**
     * v4.4.1: Poll for thumbnail with timeout - shows fallback after timeout
     * Used for PSD/PDF/AI/EPS/TIFF files that need server-side thumbnail generation
     * After timeout, shows a nice fallback icon so user can continue with Add to Cart
     */
    async pollForThumbnailWithTimeout(productId, uploadId, timeoutMs = 5000) {
      const instance = this.instances[productId]
      if (!instance || !uploadId) return

      const { elements, apiBase, shopDomain, state } = instance
      const startTime = Date.now()
      const fileExt = state.upload.file.name.split('.').pop()?.toLowerCase() || 'file'

      console.log(`[UL] Starting thumbnail polling with ${timeoutMs}ms timeout for:`, uploadId)

      const showFallbackIcon = () => {
        // Show a nice file type icon when thumbnail generation takes too long
        const fileTypeLabel = fileExt.toUpperCase()
        console.log('[UL] Thumbnail timeout - showing fallback icon for:', fileTypeLabel)

        elements.thumb.src =
          'data:image/svg+xml,' +
          encodeURIComponent(`
          <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
            <!-- Background -->
            <rect width="100" height="100" rx="8" fill="#f0fdf4"/>
            <!-- File icon -->
            <path d="M30 15 L60 15 L70 25 L70 85 L30 85 Z" fill="#dcfce7" stroke="#22c55e" stroke-width="2"/>
            <path d="M60 15 L60 25 L70 25" fill="#bbf7d0" stroke="#22c55e" stroke-width="2"/>
            <!-- File type label -->
            <text x="50" y="55" font-family="Arial, sans-serif" font-size="14" font-weight="bold" fill="#166534" text-anchor="middle">${fileTypeLabel}</text>
            <!-- Checkmark badge -->
            <circle cx="75" cy="75" r="12" fill="#22c55e"/>
            <path d="M70 75 L73 78 L80 71" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        `)
        elements.thumb.classList.remove('loading-spinner')

        // Update status message
        const statusEl = elements.filestatus
        if (statusEl) {
          statusEl.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span>Ready for Order and Print - Continue to Add to Cart</span>
          `
        }
      }

      const doPoll = async () => {
        try {
          // Check if upload was cancelled or instance destroyed
          if (!this.instances[productId] || instance.isCancelled) {
            console.log('[UL] Thumbnail polling stopped - instance cancelled')
            return
          }

          // Check timeout
          const elapsed = Date.now() - startTime
          if (elapsed >= timeoutMs) {
            console.log('[UL] Thumbnail polling timeout reached after', elapsed, 'ms')
            showFallbackIcon()
            // Continue polling in background to update later if thumbnail becomes available
            this.pollForThumbnail(productId, uploadId)
            return
          }

          const response = await fetch(
            `${apiBase}/api/upload/status/${uploadId}?shopDomain=${encodeURIComponent(shopDomain)}`
          )

          if (!response.ok) {
            setTimeout(doPoll, 1000)
            return
          }

          const data = await response.json()

          if (data.thumbnailUrl) {
            // Thumbnail ready!
            console.log('[UL] Thumbnail received within timeout:', data.thumbnailUrl)

            // Update state
            state.upload.result.thumbnailUrl = data.thumbnailUrl
            elements.thumbnailUrlField.value = data.thumbnailUrl

            // Update image smoothly
            const img = new Image()
            img.onload = () => {
              elements.thumb.src = data.thumbnailUrl
              elements.thumb.classList.remove('loading-spinner')

              // Update status to "Ready for print"
              const statusEl = elements.filestatus
              if (statusEl && !statusEl.classList.contains('warning')) {
                statusEl.innerHTML = `
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                  <span>Ready for print</span>
                `
              }
            }
            img.onerror = () => {
              console.warn('[UL] Thumbnail image load failed, using fallback')
              showFallbackIcon()
            }
            img.src = data.thumbnailUrl

            // Emit event for other components
            window.dispatchEvent(
              new CustomEvent('ul:thumbnail:ready', {
                detail: { uploadId, productId, thumbnailUrl: data.thumbnailUrl },
              })
            )

            return // Success - stop polling
          }

          // No thumbnail yet, continue polling (faster interval for initial period)
          setTimeout(doPoll, 1000)
        } catch (error) {
          console.warn('[UL] Thumbnail poll error:', error)
          // Check if we should show fallback due to repeated errors
          const elapsed = Date.now() - startTime
          if (elapsed >= timeoutMs) {
            showFallbackIcon()
            return
          }
          setTimeout(doPoll, 1500)
        }
      }

      // Start polling immediately
      doPoll()
    },

    /**
     * v4.2.0: Cancel active upload
     */
    cancelUpload(productId) {
      const instance = this.instances[productId]
      if (!instance) return

      const { elements, state } = instance

      console.log('[UL] Cancelling upload for product:', productId)

      // Set cancelled flag
      instance.isCancelled = true

      // Abort active XHR if exists
      if (instance.activeXHR) {
        instance.activeXHR.abort()
        instance.activeXHR = null
      }

      // Reset upload state
      state.upload.status = 'idle'
      state.upload.progress = 0
      state.upload.error = null

      // Reset UI
      if (elements.progress) {
        elements.progress.classList.remove('active')
      }
      if (elements.dropzone) {
        elements.dropzone.style.display = 'block'
      }
      if (elements.progressFill) {
        elements.progressFill.style.width = '0%'
      }
      if (elements.progressText) {
        elements.progressText.textContent = 'Upload cancelled'
      }

      // Track cancellation
      if (window.ULAnalytics) {
        window.ULAnalytics.trackEvent('upload_cancelled', {
          productId,
          fileName: state.upload.file?.name || '',
        })
      }

      console.log('[UL] Upload cancelled successfully')
    },

    /**
     * Clear upload and reset to initial state
     */
    clearUpload(productId) {
      const instance = this.instances[productId]
      const { elements, state } = instance

      // v4.2.0: Cancel any active upload first
      if (instance.activeXHR) {
        instance.activeXHR.abort()
        instance.activeXHR = null
      }

      // Reset state
      state.upload = {
        status: 'idle',
        progress: 0,
        uploadId: null,
        file: { name: '', size: 0, type: '' },
        result: {
          thumbnailUrl: '',
          originalUrl: '',
          width: 0,
          height: 0,
          dpi: 0,
          colorMode: '',
          qualityScore: 0,
          warnings: [],
        },
        error: null,
      }

      // Sync with global state (FAZ 4)
      if (window.ULState) {
        window.ULState.clearUpload()
      }

      // Reset hidden fields
      elements.uploadIdField.value = ''
      elements.uploadUrlField.value = ''
      elements.thumbnailUrlField.value = ''

      // Reset file input
      elements.fileInput.value = ''

      // Hide preview, show dropzone
      elements.preview.classList.remove('active')
      elements.preview.classList.remove('has-warning')
      elements.dropzone.style.display = 'block'
      elements.step1.classList.remove('completed')

      // Disable buttons
      elements.tshirtBtn.disabled = true
      this.validateForm(productId)
    },

    /**
     * Update price display
     */
    updatePriceDisplay(productId) {
      const instance = this.instances[productId]
      if (!instance) {
        console.warn('[UL] No instance for updatePriceDisplay:', productId)
        return
      }

      const { elements, state } = instance
      const { form, config } = state

      console.log('[UL] updatePriceDisplay called:', {
        productId,
        variantId: form.selectedVariantId,
        variantTitle: form.selectedVariantTitle,
        variantPrice: form.selectedVariantPrice,
        quantity: form.quantity,
      })

      // Update selected size display
      if (elements.selectedSize) {
        elements.selectedSize.textContent = form.selectedVariantTitle || '-'
      }

      // Format unit price - price is in cents from Shopify
      const unitPrice = (form.selectedVariantPrice || 0) / 100
      if (elements.unitPrice) {
        elements.unitPrice.textContent = this.formatMoney(unitPrice)
      }

      // Update quantity display
      if (elements.qtyDisplay) {
        elements.qtyDisplay.textContent = form.quantity || 1
      }

      // Calculate total (with potential bulk discount)
      let total = unitPrice * (form.quantity || 1)

      // Check for bulk discount
      if (elements.bulkHint) {
        if (form.quantity >= (config.bulkDiscountThreshold || 999)) {
          const discount = total * ((config.bulkDiscountPercent || 0) / 100)
          total = total - discount
          elements.bulkHint.style.display = 'flex'
        } else {
          elements.bulkHint.style.display = 'none'
        }
      }

      // Update total display
      if (elements.totalPrice) {
        elements.totalPrice.textContent = this.formatMoney(total)
      }
      if (elements.btnPrice) {
        elements.btnPrice.textContent = `• ${this.formatMoney(total)}`
      }

      console.log(
        '[UL] Price updated - Unit:',
        this.formatMoney(unitPrice),
        'Qty:',
        form.quantity,
        'Total:',
        this.formatMoney(total)
      )
    },

    /**
     * Validate form and update button states
     */
    validateForm(productId) {
      const instance = this.instances[productId]
      const { elements, state } = instance
      const { upload, form, config } = state

      let isValid = true
      const errors = []

      // Check upload
      if (upload.status !== 'ready') {
        isValid = false
        errors.push('Upload your design')
      }

      // Check variant selection
      if (!form.selectedVariantId) {
        isValid = false
        errors.push('Select a size')
      }

      // Check quantity
      if (form.quantity < 1) {
        isValid = false
        errors.push('Quantity must be at least 1')
      }

      // Check required extra questions
      // FAZ 2 - DTF-004: Type-specific validation
      for (const q of config.extraQuestions) {
        if (q.required) {
          const answer = form.extraAnswers[q.label]
          let isEmpty = false

          switch (q.type) {
            case 'checkbox':
              // Checkbox: only 'Yes' is valid for required
              isEmpty = answer !== 'Yes'
              break
            case 'number':
              // Number: 0 is valid, undefined/null/empty is not
              isEmpty = answer === undefined || answer === null || answer === ''
              break
            case 'select':
              // Select: check for empty or placeholder values
              isEmpty =
                !answer || answer === '' || answer === 'Select...' || answer === '-- Select --'
              break
            case 'text':
            case 'textarea':
            default:
              // Text types: check for empty or whitespace-only
              isEmpty = !answer || answer.toString().trim() === ''
              break
          }

          if (isEmpty) {
            isValid = false
            errors.push(`Fill in "${q.label}"`)
          }
        }
      }

      form.isValid = isValid
      elements.addCartBtn.disabled = !isValid

      return { valid: isValid, errors }
    },

    /**
     * Open T-Shirt modal (FAZ 2 integration)
     */
    openTShirtModal(productId) {
      // Prevent opening in Shopify theme editor
      if (window.Shopify && window.Shopify.designMode) return

      console.log('[UL] openTShirtModal called with productId:', productId)
      const instance = this.instances[productId]
      const { state } = instance

      console.log('[UL] Upload status:', state.upload.status)
      if (state.upload.status !== 'ready') {
        console.warn('[UL] Upload not ready, showing error')
        this.showError(productId, 'Please upload your design first.')
        return
      }

      // FAZ 8: Track customize clicked
      if (window.ULAnalytics) {
        window.ULAnalytics.trackDTFCustomizeClicked({
          uploadId: state.upload.uploadId,
          productId,
        })
      }

      // Update global state (FAZ 4)
      if (window.ULState) {
        window.ULState.set('tshirt.useInheritedDesign', true)
        window.ULState.openTShirtModal()
      }

      // Emit global event (FAZ 4)
      if (window.ULEvents) {
        window.ULEvents.emit('modalOpen', { source: 'dtf-uploader', productId })
      }

      // FAZ 5 FIX: Create blobUrl from lastFile if available (prevents CORS/signed URL expiry issues)
      let blobUrl = null
      if (instance.lastFile && instance.lastFile instanceof Blob) {
        try {
          blobUrl = URL.createObjectURL(instance.lastFile)
          console.log('[UL] Created blobUrl for T-Shirt modal:', blobUrl.substring(0, 50) + '...')
        } catch (e) {
          console.warn('[UL] Failed to create blobUrl:', e)
        }
      }

      // Dispatch event for tshirt-modal.js (FAZ 2)
      const event = new CustomEvent('ul:openTShirtModal', {
        detail: {
          productId,
          shopDomain: instance.shopDomain, // Pass shopDomain for API calls
          uploadData: {
            uploadId: state.upload.uploadId,
            thumbnailUrl: state.upload.result.thumbnailUrl,
            originalUrl: state.upload.result.originalUrl,
            blobUrl: blobUrl, // FAZ 5 FIX: Pass blobUrl for CORS-free texture loading
            dimensions: {
              width: state.upload.result.width,
              height: state.upload.result.height,
              dpi: state.upload.result.dpi,
            },
          },
          config: state.config,
        },
        bubbles: true,
      })
      document.dispatchEvent(event)
    },

    /**
     * Add item to Shopify cart
     */
    async addToCart(productId) {
      const instance = this.instances[productId]
      const { elements, state } = instance

      // Validate first
      const validation = this.validateForm(productId)
      if (!validation.valid) {
        this.showError(productId, validation.errors[0])
        return
      }

      const { upload, form } = state

      // Disable button and show loading
      elements.addCartBtn.disabled = true
      elements.addCartBtn.classList.add('loading')

      try {
        // Build cart item with properties
        const properties = {
          // Hidden keys (internal use)
          _ul_upload_id: upload.uploadId,
          _ul_thumbnail: upload.result.thumbnailUrl,
          // Visible keys (shown in checkout)
          'Uploaded File': upload.result.originalUrl,
          'Design Type': 'DTF Transfer',
          'File Name': upload.file.name,
        }

        // Add dimensions if available
        if (upload.result.width && upload.result.height) {
          properties['Dimensions'] = `${upload.result.width}x${upload.result.height}`
        }

        // Add extra answers
        for (const [key, value] of Object.entries(form.extraAnswers)) {
          if (value && value !== '') {
            properties[key] = value
          }
        }

        // Add to cart via Shopify AJAX API
        const response = await fetch('/cart/add.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: [
              {
                id: parseInt(form.selectedVariantId, 10),
                quantity: form.quantity,
                properties,
              },
            ],
          }),
        })

        if (!response.ok) {
          const err = await response.json().catch(() => ({}))
          throw new Error(err.description || 'Failed to add to cart')
        }

        // Success!
        elements.addCartBtn.classList.remove('loading')
        elements.addCartBtn.classList.add('success')
        elements.addCartBtn.querySelector('.ul-btn-text').textContent = '✓ Added!'

        // Show toast
        this.showToast('Added to cart!', 'success')

        // FAZ 8: Track add to cart
        if (window.ULAnalytics) {
          window.ULAnalytics.trackDTFAddToCart({
            uploadId: upload.uploadId,
            variantId: form.selectedVariantId,
            size: form.selectedVariantTitle,
            quantity: form.quantity,
            price: (form.selectedVariantPrice * form.quantity) / 100,
            productId,
          })
        }

        // Dispatch event for cart update (theme may listen)
        document.dispatchEvent(
          new CustomEvent('ul:addedToCart', {
            detail: { productId, quantity: form.quantity, variantId: form.selectedVariantId },
            bubbles: true,
          })
        )

        // Visitor Tracking: Dispatch ul:cart:add event for ULVisitor integration
        window.dispatchEvent(
          new CustomEvent('ul:cart:add', {
            detail: {
              productId,
              quantity: form.quantity,
              variantId: form.selectedVariantId,
              uploadId: upload.uploadId,
            },
          })
        )

        // Redirect to Shopify cart page after short delay
        setTimeout(() => {
          window.location.href = '/cart'
        }, 500)
      } catch (error) {
        console.error('[UL] Add to cart error:', error)
        elements.addCartBtn.classList.remove('loading')
        elements.addCartBtn.disabled = false

        // FAZ 7: Enhanced cart error handling
        const errorMsg = error.message || ''

        if (window.ULErrorHandler) {
          let errorCode = 'CART_ADD_FAILED'

          if (errorMsg.includes('stock') || errorMsg.includes('available')) {
            errorCode = 'CART_VARIANT_OUT_OF_STOCK'
          } else if (errorMsg.includes('session') || errorMsg.includes('expired')) {
            errorCode = 'CART_SESSION_EXPIRED'
          }

          window.ULErrorHandler.show(
            errorCode,
            {},
            {
              onRetry: () => this.addToCart(productId),
            }
          )
        }

        this.showError(productId, errorMsg || 'Failed to add to cart. Please try again.')
      }
    },

    // ===== UTILITY METHODS =====

    showError(productId, message) {
      const { elements } = this.instances[productId]
      elements.errorText.textContent = message
      elements.error.classList.add('active')
    },

    hideError(productId) {
      const { elements } = this.instances[productId]
      elements.error.classList.remove('active')
    },

    showToast(message, type = 'success') {
      const toast = document.getElementById('ul-toast')
      const text = document.getElementById('ul-toast-text')
      if (toast && text) {
        text.textContent = message
        toast.className = `ul-toast active ${type}`
        setTimeout(() => {
          toast.classList.remove('active')
        }, 3000)
      }
    },

    formatFileSize(bytes) {
      if (bytes === 0) return '0 B'
      const k = 1024
      const sizes = ['B', 'KB', 'MB', 'GB']
      const i = Math.floor(Math.log(bytes) / Math.log(k))
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
    },

    formatMoney(amount) {
      return '$' + amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    },

    /**
     * Bind option dropdown changes (v4.3.0 - separate dropdowns for each option)
     * Handles Size, Color, Material etc. as separate dropdowns
     */
    bindOptionButtons(productId) {
      const instance = this.instances[productId]
      const container = instance.container

      // Get variants JSON data
      const variantsJsonEl = document.getElementById(`ul-variants-json-${productId}`)
      if (!variantsJsonEl) {
        console.log('[UL] No variants JSON found - using legacy selector')
        return
      }

      let variants
      try {
        variants = JSON.parse(variantsJsonEl.textContent)
        console.log('[UL] Loaded', variants.length, 'variants for product', productId)
      } catch (e) {
        console.error('[UL] Failed to parse variants JSON:', e)
        return
      }

      // Store variants for later use
      instance.variants = variants

      // Get all option dropdowns
      const optionDropdowns = container.querySelectorAll('.ul-option-dropdown')
      console.log('[UL] Found', optionDropdowns.length, 'option dropdowns')

      optionDropdowns.forEach((dropdown) => {
        dropdown.addEventListener('change', () => {
          // Always trigger update for this product's dropdowns
          console.log('[UL] Dropdown changed:', dropdown.id, 'value:', dropdown.value)
          this.updateSelectedVariant(productId)
        })
      })

      // Initialize with current selection
      this.updateSelectedVariant(productId)
    },

    /**
     * Update selected variant based on all option dropdown selections
     */
    updateSelectedVariant(productId) {
      const instance = this.instances[productId]
      if (!instance || !instance.variants) {
        console.warn('[UL] No variants data for product:', productId)
        return
      }

      const container = instance.container
      const { elements, state } = instance

      // Collect selected options from dropdowns
      const selectedOptions = []
      container.querySelectorAll('.ul-option-dropdown').forEach((dropdown, index) => {
        selectedOptions[index] = dropdown.value
      })

      console.log('[UL] Selected options:', selectedOptions)

      // Find matching variant
      const variant = instance.variants.find((v) => {
        return selectedOptions.every((opt, idx) => {
          return v[`option${idx + 1}`] === opt
        })
      })

      if (variant) {
        console.log('[UL] Matched variant:', variant.id, variant.title, 'Price:', variant.price)

        // Update state with CORRECT price (Shopify returns price in cents)
        state.form.selectedVariantId = variant.id
        state.form.selectedVariantTitle = variant.title
        state.form.selectedVariantPrice = variant.price // Already in cents from Shopify

        // Update hidden input
        if (elements.sizeSelect) {
          elements.sizeSelect.value = variant.id
          elements.sizeSelect.dataset.priceRaw = variant.price
        }

        // Update variant display - price is in cents, convert to dollars
        const variantNameEl = document.getElementById(`ul-variant-name-${productId}`)
        const variantPriceEl = document.getElementById(`ul-variant-price-${productId}`)

        if (variantNameEl) variantNameEl.textContent = variant.title
        if (variantPriceEl) variantPriceEl.textContent = this.formatMoney(variant.price / 100)

        // Update price display (this handles unit price, quantity, and total)
        this.updatePriceDisplay(productId)
        this.validateForm(productId)

        // FAZ 8: Track selection
        if (window.ULAnalytics) {
          window.ULAnalytics.trackDTFSizeSelected({
            size: variant.title,
            variantId: variant.id,
            price: variant.price / 100,
            productId,
          })
        }
      } else {
        console.warn('[UL] No matching variant found for options:', selectedOptions)
        // Fallback: use first available variant
        if (instance.variants.length > 0) {
          const fallback = instance.variants.find((v) => v.available) || instance.variants[0]
          console.log('[UL] Using fallback variant:', fallback.id, fallback.title)

          state.form.selectedVariantId = fallback.id
          state.form.selectedVariantTitle = fallback.title
          state.form.selectedVariantPrice = fallback.price

          if (elements.sizeSelect) {
            elements.sizeSelect.value = fallback.id
            elements.sizeSelect.dataset.priceRaw = fallback.price
          }

          this.updatePriceDisplay(productId)
          this.validateForm(productId)
        }
      }
    },

    /**
     * Get state for external access (FAZ 2, FAZ 4)
     */
    getState(productId) {
      const instance = this.instances[productId]
      return instance ? { ...instance.state } : null
    },

    /**
     * Get upload data for T-Shirt modal (FAZ 2)
     */
    getUploadData(productId) {
      const instance = this.instances[productId]
      if (!instance || instance.state.upload.status !== 'ready') {
        return null
      }
      return {
        uploadId: instance.state.upload.uploadId,
        thumbnailUrl: instance.state.upload.result.thumbnailUrl,
        originalUrl: instance.state.upload.result.originalUrl,
        fileName: instance.state.upload.file.name,
        dimensions: {
          width: instance.state.upload.result.width,
          height: instance.state.upload.result.height,
          dpi: instance.state.upload.result.dpi,
        },
      }
    },
  }

  // Expose globally
  window.ULDTFUploader = ULDTFUploader
})()
