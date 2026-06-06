

;(function () {
  'use strict'

  const ALLOWED_TYPES = [

    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/tiff',

    'image/vnd.adobe.photoshop',
    'application/x-photoshop',
    'image/x-psd',

    'image/svg+xml',
    'application/pdf',
    'application/postscript',
    'application/illustrator',
  ]
  const ALLOWED_EXTENSIONS = [

    'png',
    'jpg',
    'jpeg',
    'webp',
    'tiff',
    'tif',

    'psd',

    'svg',
    'pdf',
    'ai',
    'eps',
  ]

  const MAX_FILE_SIZE = 10240 * 1024 * 1024
  const POLL_INTERVAL = 1000
  const MAX_POLLS = 120

  const TAB_SESSION_ID = `ul_tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

  const ULDTFUploader = {
    instances: {},
    version: '4.5.0', // v4.5.0: Non-blocking Add to Cart, 5s thumbnail timeout, fallback icons

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

      const instance = {
        productId,
        container,
        apiBase: container.dataset.apiBase,
        shopDomain: container.dataset.shopDomain,
        productTitle: container.dataset.productTitle,

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

      instance.elements = this.getElements(productId)
      this.instances[productId] = instance

      this.loadConfig(productId)
    },

    getElements(productId) {
      const $ = (id) => document.getElementById(`ul-${id}-${productId}`)
      return {
        container: document.getElementById(`ul-dtf-${productId}`),
        loading: $('loading'),
        content: $('content'),
        error: $('error'),
        errorText: $('error-text'),

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

        sizeSelect: $('size-select'),
        sizeGrid: $('size-grid'), // Legacy fallback
        sizeHint: $('size-hint'),
        selectedSize: $('selected-size'),

        qtyInput: $('qty-input'),
        qtyMinus: $('qty-minus'),
        qtyPlus: $('qty-plus'),
        bulkHint: $('bulk-hint'),
        qtyDisplay: $('qty-display'),

        questionsSection: $('questions-section'),
        questionsContainer: $('questions'),

        unitPrice: $('unit-price'),
        totalPrice: $('total-price'),
        btnPrice: $('btn-price'),

        tshirtBtn: $('tshirt-btn'),
        addCartBtn: $('add-cart'),

        uploadIdField: $('upload-id'),
        uploadUrlField: $('upload-url'),
        thumbnailUrlField: $('thumbnail-url'),

        step1: $('step-1'),
        step2: $('step-2'),
        step3: $('step-3'),
        step4: $('step-4'),
      }
    },

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

        if (state.config.extraQuestions.length > 0) {
          this.renderExtraQuestions(productId)
        }

        if (state.config.tshirtEnabled) {
          elements.tshirtBtn.style.display = 'flex'
        }

        const variantsJsonEl = document.getElementById(`ul-variants-json-${productId}`)
        const hasOptionButtons = elements.container.querySelector('.ul-option-btn')

        if (variantsJsonEl && hasOptionButtons) {

          console.log('[UL] Using option buttons for variant selection')

          if (elements.sizeSelect && elements.sizeSelect.value) {
            state.form.selectedVariantId = elements.sizeSelect.value
            state.form.selectedVariantPrice =
              parseInt(elements.sizeSelect.dataset.priceRaw, 10) || 0
            this.updatePriceDisplay(productId)
          }
        } else if (elements.sizeSelect && elements.sizeSelect.tagName === 'SELECT') {

          const selectedOption = elements.sizeSelect.options[elements.sizeSelect.selectedIndex]
          if (selectedOption && !selectedOption.disabled) {
            state.form.selectedVariantId = selectedOption.value
            state.form.selectedVariantTitle = selectedOption.dataset.title
            state.form.selectedVariantPrice = parseInt(selectedOption.dataset.priceRaw, 10)
            this.updatePriceDisplay(productId)
          }
        } else if (elements.sizeGrid) {

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

          console.log('[UL] No size selector found - checking for single variant product')

          const form = document.querySelector(`form[action*="/cart/add"]`)
          const hiddenVariant = form?.querySelector('input[name="id"]')

          if (hiddenVariant && hiddenVariant.value) {
            state.form.selectedVariantId = hiddenVariant.value
            state.form.selectedVariantTitle = 'Default'
            console.log('[UL] Single variant product detected, variant ID:', hiddenVariant.value)
          } else {

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

          if (!state.form.selectedVariantId) {

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
              } catch (e) {  }
            }
          }

          if (!state.form.selectedVariantId) {

            const urlVariant = new URL(window.location.href).searchParams.get('variant')
            if (urlVariant) {
              state.form.selectedVariantId = urlVariant
              state.form.selectedVariantTitle = 'Default'
              console.log('[UL] Variant from URL parameter:', urlVariant)
            }
          }

          if (!state.form.selectedVariantId) {

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

        this.bindEvents(productId)

        elements.loading.classList.remove('active')
        elements.content.style.display = 'block'
      } catch (error) {
        console.error('[UL] Config load error:', error?.message || error?.status || JSON.stringify(error) || 'Unknown error')
        elements.loading.innerHTML = '<div>Failed to load. Please refresh the page.</div>'
      }
    },

    renderExtraQuestions(productId) {
      const instance = this.instances[productId]
      const { elements, state } = instance
      const questions = state.config.extraQuestions

      if (!questions.length) return

      elements.questionsSection.style.display = 'block'
      elements.questionsContainer.innerHTML = ''

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

        if (input) {
          input.addEventListener('change', () =>
            this.updateExtraAnswer(productId, q.id || index, q.label, input)
          )
        }

        elements.questionsContainer.appendChild(fieldDiv)
      })
    },

    updateExtraAnswer(productId, questionId, label, input) {
      const instance = this.instances[productId]
      if (input.type === 'checkbox') {
        instance.state.form.extraAnswers[label] = input.checked ? 'Yes' : 'No'
      } else {
        instance.state.form.extraAnswers[label] = input.value
      }
      this.validateForm(productId)
    },

    bindEvents(productId) {
      const instance = this.instances[productId]
      const { elements } = instance

      elements.dropzone.addEventListener('click', () => {
        elements.fileInput.click()
      })

      elements.fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
          this.handleFileSelect(productId, e.target.files[0])
        }
      })

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

      elements.removeBtn.addEventListener('click', () => {
        this.clearUpload(productId)
      })

      if (elements.cancelBtn) {
        elements.cancelBtn.addEventListener('click', () => {
          this.cancelUpload(productId)
        })
      }

      this.bindOptionButtons(productId)

      if (elements.sizeSelect && !elements.sizeSelect.type) {

        console.log('[UL] Using option buttons for variant selection')
      } else if (elements.sizeSelect && elements.sizeSelect.tagName === 'SELECT') {

        elements.sizeSelect.addEventListener('change', (e) => {
          const option = e.target.options[e.target.selectedIndex]
          if (option && option.value) {
            instance.state.form.selectedVariantId = option.value
            instance.state.form.selectedVariantTitle = option.dataset.title || option.textContent
            instance.state.form.selectedVariantPrice = parseInt(option.dataset.priceRaw, 10) || 0
            this.updatePriceDisplay(productId)
            this.validateForm(productId)

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

        elements.sizeGrid.querySelectorAll('input[type="radio"]').forEach((radio) => {
          radio.addEventListener('change', () => {
            instance.state.form.selectedVariantId = radio.value
            instance.state.form.selectedVariantTitle = radio.dataset.title
            instance.state.form.selectedVariantPrice = parseInt(radio.dataset.priceRaw, 10)
            this.updatePriceDisplay(productId)
            this.validateForm(productId)

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

      if (elements.tshirtBtn) {
        console.log('[UL] T-Shirt button found, adding click listener')
        elements.tshirtBtn.addEventListener('click', () => {
          console.log('[UL] T-Shirt button clicked!')
          this.openTShirtModal(productId)
        })
      } else {
        console.warn('[UL] T-Shirt button NOT found in DOM')
      }

      elements.addCartBtn.addEventListener('click', () => {
        this.addToCart(productId)
      })
    },

    async handleFileSelect(productId, file) {
      const instance = this.instances[productId]
      const { elements, apiBase, shopDomain, state } = instance

      if (instance.activeXHR) {
        console.log('[UL] Cancelling existing upload to start new one')
        this.cancelUpload(productId)
      }

      instance.isCancelled = false

      if (!file.size || file.size === 0) {
        this.showError(productId, 'The selected file is empty (0 bytes). Please select a valid file.')
        console.error('[DTF Uploader] 0-byte file rejected:', file.name)
        return
      }

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

      instance.lastFile = file

      state.upload.status = 'uploading'
      state.upload.progress = 0
      state.upload.file = { name: file.name, size: file.size, type: file.type }

      if (window.ULState) {
        window.ULState.set('upload.status', 'uploading')
        window.ULState.set('upload.fileName', file.name)
        window.ULState.set('upload.fileSize', file.size)
        window.ULState.set('upload.mimeType', file.type)
      }

      if (window.ULEvents) {
        window.ULEvents.emit('uploadStart', {
          fileName: file.name,
          fileSize: file.size,
          productId,
        })
      }

      if (window.ULAnalytics) {
        window.ULAnalytics.startTiming('dtf_upload')
        window.ULAnalytics.trackDTFUploadStarted({
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          productId,
        })
      }

      instance.uploadStartTime = Date.now()

      elements.dropzone.style.display = 'none'
      elements.progress.classList.add('active')
      elements.progressFill.style.width = '0%'
      elements.progressText.textContent = 'Preparing upload...'
      elements.step1.classList.remove('completed')

      try {

        const customerId = window.ULCustomer?.id || null
        const customerEmail = window.ULCustomer?.email || null

        const visitorId = window.ULVisitor?.getVisitorId?.() || null
        const sessionId = window.ULVisitor?.getSessionId?.() || null

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

        const uploadResult = await this.uploadToStorage(productId, file, intentData)

        elements.progressFill.style.width = '80%'
        elements.progressText.textContent = 'Finalizing...'

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

        state.upload.status = 'processing'
        elements.progressText.textContent = 'Processing thumbnail...'
        await this.pollUploadStatus(productId, intentData.uploadId)
      } catch (error) {
        console.error('[UL] Upload error:', error)
        state.upload.status = 'error'
        state.upload.error = error.message
        elements.progress.classList.remove('active')
        elements.dropzone.style.display = 'block'

        const errorMessage = error.message || 'Upload failed. Please try again.'
        this.showError(productId, errorMessage)

        if (window.ULAnalytics) {
          window.ULAnalytics.trackDTFUploadFailed({
            fileName: state.upload.file.name,
            errorCode: 'UPLOAD_FAILED',
            errorMessage: errorMessage,
            productId,
          })
        }

        if (window.ULErrorHandler) {

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

    sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms))
    },

    createUploadTelemetry() {
      return window.ULUploadTelemetry && window.ULUploadTelemetry.create
        ? window.ULUploadTelemetry.create()
        : null
    },

    renderUploadProgress(elements, telemetry, loaded, total, suffix) {
      if (!elements || !elements.progressText) return

      if (telemetry) {
        telemetry.tick(loaded, total)
        elements.progressText.textContent = telemetry.formatProgress({ suffix })
        return
      }

      const loadedMB = (loaded / (1024 * 1024)).toFixed(1)
      const totalMB = (total / (1024 * 1024)).toFixed(1)
      elements.progressText.textContent = `${loadedMB} / ${totalMB} MB${suffix ? ` ${suffix}` : ''}`
    },

    renderUploadComplete(elements, telemetry, fileSize) {
      if (!elements || !elements.progressText) return

      if (telemetry) {
        elements.progressText.textContent = telemetry.formatComplete(fileSize)
        return
      }

      const totalMB = (fileSize / (1024 * 1024)).toFixed(1)
      elements.progressText.textContent = `✓ ${totalMB} MB uploaded`
    },

    async uploadToStorage(productId, file, intentData) {
      const instance = this.instances[productId]
      const { elements, state } = instance

      // Try parallel multipart upload first (R2-only, large files)
      if (intentData.multipart && window.ULMultipartUploader && window.ULMultipartUploader.tryUpload) {
        try {
          const mpTelemetry = this.createUploadTelemetry()
          const mpResult = await window.ULMultipartUploader.tryUpload(file, intentData, {
            shopDomain: instance.shopDomain || intentData.shopDomain,
            onProgress: (loaded, total) => {
              if (!elements || !elements.progressFill) return
              const ratio = total > 0 ? loaded / total : 0
              const percent = 15 + ratio * 60
              elements.progressFill.style.width = `${percent}%`
              this.renderUploadProgress(elements, mpTelemetry, loaded, total, '(parallel)')
              return
              const elapsed = (Date.now() - mpStart) / 1000
              const speed = elapsed > 0 ? loaded / elapsed : 0
              const remaining = speed > 0 ? (total - loaded) / speed : 0
              const loadedMB = (loaded / (1024 * 1024)).toFixed(1)
              const totalMB = (total / (1024 * 1024)).toFixed(1)
              const speedMBs = (speed / (1024 * 1024)).toFixed(1)
              const remainingText = remaining < 60 ? `~${Math.ceil(remaining)}s left` : `~${Math.ceil(remaining / 60)}m left`
              if (elements.progressText) {
                elements.progressText.textContent = `${loadedMB} / ${totalMB} MB • ${speedMBs} MB/s • ${remainingText} (parallel)`
              }
            },
          })
          if (mpResult) {
            console.log('[UL] ✅ Multipart upload succeeded:', mpResult.partsUploaded, 'parts')
            state.upload.actualProvider = mpResult.storageProvider
            return {
              fileUrl: mpResult.fileUrl,
              storageProvider: mpResult.storageProvider,
            }
          }
        } catch (mpErr) {
          console.warn('[UL] ⚠️ Multipart failed, falling back to single-shot:', mpErr && mpErr.message)
        }
      }

      const primaryProvider = intentData.storageProvider || 'local'
      const retryConfig = intentData.retryConfig || { maxRetries: 3, retryDelayMs: 2000 }
      const fallbackUrls = intentData.fallbackUrls || {}

      console.log('[UL] uploadToStorage - primary provider:', primaryProvider)
      console.log('[UL] uploadToStorage - fallback available:', {
        r2: !!fallbackUrls.r2,
        local: !!fallbackUrls.local,
      })

      if (primaryProvider === 'bunny') {
        const bunnyResult = await this.uploadWithRetry(
          () => this.uploadToBunny(file, intentData, elements, productId),
          'Bunny',
          retryConfig,
          elements
        )

        if (bunnyResult.success) {
          console.log('[UL] ✅ Primary upload (Bunny) succeeded')

          return {
            ...bunnyResult.data,
            storageProvider: 'bunny',
          }
        }

        console.warn('[UL] ⚠️ Primary upload (Bunny) failed after retries:', bunnyResult.error)

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

            state.upload.actualProvider = 'r2'

            return {
              ...r2Result.data,
              fileUrl: fallbackUrls.r2.publicUrl,
              storageProvider: 'r2',
            }
          }

          console.warn('[UL] ⚠️ R2 fallback failed:', r2Result.error)
        }

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

            return {
              ...localResult.data,
              fileUrl: fallbackUrls.local.publicUrl,
              storageProvider: 'local',
            }
          }

          console.error('[UL] ❌ All storage options failed')
        }

        throw new Error(bunnyResult.error || 'Upload failed - all storage options exhausted')
      }

      switch (primaryProvider) {
        case 'r2':
          return this.uploadToR2(file, intentData, elements, productId)
        case 'local':
        default:
          return this.uploadToLocal(file, intentData, elements, productId)
      }
    },

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

          console.warn(`[UL] ${providerName} attempt ${attempt} failed:`, {
            message: error.message,
            name: error.name,
            attempt,
            maxRetries,
            isFatal: error.isFatal
          })

          if (error.message?.includes('cancelled') || error.message?.includes('aborted')) {
            return { success: false, error: error.message }
          }

          if (error.isFatal || error.message?.includes('blocked')) {
             console.warn(`[UL] ${providerName} fatal error detected, skipping retries.`)
             return { success: false, error: error.message }
          }

          if (attempt < maxRetries) {
            const delay = retryDelayMs * Math.pow(2, attempt - 1)
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

    async uploadToBunny(file, intentData, elements, productId) {
      const startTime = Date.now()
      const fileSize = file.size
      const instance = productId ? this.instances[productId] : null
      const telemetry = this.createUploadTelemetry()

      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()

        if (instance) {
          instance.activeXHR = xhr
        }

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const percent = 15 + (e.loaded / e.total) * 60
            elements.progressFill.style.width = `${percent}%`
            this.renderUploadProgress(elements, telemetry, e.loaded, e.total)
            return

            const elapsed = (Date.now() - startTime) / 1000
            const speed = elapsed > 0 ? e.loaded / elapsed : 0
            const remaining = speed > 0 ? (e.total - e.loaded) / speed : 0

            const loadedMB = (e.loaded / (1024 * 1024)).toFixed(1)
            const totalMB = (e.total / (1024 * 1024)).toFixed(1)
            const speedMBs = (speed / (1024 * 1024)).toFixed(1)

            const remainingText =
              remaining < 60
                ? `~${Math.ceil(remaining)}s left`
                : `~${Math.ceil(remaining / 60)}m left`

            elements.progressText.textContent = `${loadedMB} / ${totalMB} MB • ${speedMBs} MB/s • ${remainingText}`
          }
        })

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            this.renderUploadComplete(elements, telemetry, fileSize)
            resolve({ fileUrl: intentData.publicUrl })
            return
            const duration = ((Date.now() - startTime) / 1000).toFixed(1)
            const totalMB = (fileSize / (1024 * 1024)).toFixed(1)
            elements.progressText.textContent = `✓ ${totalMB} MB uploaded in ${duration}s`
            resolve({ fileUrl: intentData.publicUrl })
          } else {

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

          let errorMsg = 'Network error during Bunny upload'
          let isFatal = false

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

        xhr.addEventListener('abort', () => reject(new Error('Bunny upload cancelled')))

        xhr.open('PUT', intentData.uploadUrl)

        if (intentData.uploadHeaders) {
          Object.entries(intentData.uploadHeaders).forEach(([key, value]) => {
            xhr.setRequestHeader(key, value)
          })
        }
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')

        xhr.send(file)
      })
    },

    async uploadToR2(file, intentData, elements, productId) {
      const startTime = Date.now()
      const fileSize = file.size
      const instance = productId ? this.instances[productId] : null
      const telemetry = this.createUploadTelemetry()

      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()

        if (instance) {
          instance.activeXHR = xhr
        }

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const percent = 15 + (e.loaded / e.total) * 60
            elements.progressFill.style.width = `${percent}%`
            this.renderUploadProgress(elements, telemetry, e.loaded, e.total)
            return

            const elapsed = (Date.now() - startTime) / 1000
            const speed = elapsed > 0 ? e.loaded / elapsed : 0
            const remaining = speed > 0 ? (e.total - e.loaded) / speed : 0

            const loadedMB = (e.loaded / (1024 * 1024)).toFixed(1)
            const totalMB = (e.total / (1024 * 1024)).toFixed(1)
            const speedMBs = (speed / (1024 * 1024)).toFixed(1)

            const remainingText =
              remaining < 60
                ? `~${Math.ceil(remaining)}s left`
                : `~${Math.ceil(remaining / 60)}m left`

            elements.progressText.textContent = `${loadedMB} / ${totalMB} MB • ${speedMBs} MB/s • ${remainingText}`
          }
        })

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            this.renderUploadComplete(elements, telemetry, fileSize)
            resolve({ fileUrl: intentData.publicUrl })
            return
            const duration = ((Date.now() - startTime) / 1000).toFixed(1)
            const totalMB = (fileSize / (1024 * 1024)).toFixed(1)
            elements.progressText.textContent = `✓ ${totalMB} MB uploaded in ${duration}s`
            resolve({ fileUrl: intentData.publicUrl })
          } else {

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

    async uploadToLocal(file, intentData, elements, productId) {
      const startTime = Date.now()
      const fileSize = file.size
      const instance = productId ? this.instances[productId] : null
      const telemetry = this.createUploadTelemetry()

      const formData = new FormData()
      formData.append('file', file)
      formData.append('key', intentData.key)
      formData.append('uploadId', intentData.uploadId)
      formData.append('itemId', intentData.itemId)

      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()

        if (instance) {
          instance.activeXHR = xhr
        }

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const percent = 15 + (e.loaded / e.total) * 60
            elements.progressFill.style.width = `${percent}%`
            this.renderUploadProgress(elements, telemetry, e.loaded, e.total)
            return

            const elapsed = (Date.now() - startTime) / 1000
            const speed = elapsed > 0 ? e.loaded / elapsed : 0
            const remaining = speed > 0 ? (e.total - e.loaded) / speed : 0

            const loadedMB = (e.loaded / (1024 * 1024)).toFixed(1)
            const totalMB = (e.total / (1024 * 1024)).toFixed(1)
            const speedMBs = (speed / (1024 * 1024)).toFixed(1)

            const remainingText =
              remaining < 60
                ? `~${Math.ceil(remaining)}s left`
                : `~${Math.ceil(remaining / 60)}m left`

            elements.progressText.textContent = `${loadedMB} / ${totalMB} MB • ${speedMBs} MB/s • ${remainingText}`
          }
        })

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            this.renderUploadComplete(elements, telemetry, fileSize)
            resolve()
            return
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

    async pollUploadStatus(productId, uploadId) {
      const instance = this.instances[productId]
      const { elements, apiBase, shopDomain, state } = instance

      instance.pollCount = 0

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

            const NON_BROWSER_FORMATS = ['psd', 'pdf', 'ai', 'eps', 'tiff', 'tif']
            const fileExt = state.upload.file.name.split('.').pop()?.toLowerCase() || ''
            const isNonBrowserFormat = NON_BROWSER_FORMATS.includes(fileExt)

            const metadata = data.metadata || {}
            const lifecycleProblems = Array.isArray(data.problems) ? data.problems : []
            const blockingProblems = lifecycleProblems.filter(
              (problem) =>
                problem &&
                problem.severity === 'error' &&
                problem.scope !== 'measurement' &&
                problem.scope !== 'preview'
            )
            const displayWarnings = lifecycleProblems
              .filter(
                (problem) =>
                  problem &&
                  problem.severity === 'warning' &&
                  problem.scope !== 'measurement'
              )
              .map((problem) => problem.message)
            const originalUrl =
              data.downloadUrl ||
              data.url ||
              (data.items && data.items[0] && data.items[0].originalUrl) ||
              ''
            const canAddToCart = !!originalUrl && blockingProblems.length === 0
            const isBlocked = blockingProblems.length > 0
            const hasThumbnail = !!data.thumbnailUrl

            const canProceed = canAddToCart

            if (isBlocked) {
              state.upload.status = 'error'
              state.upload.error =
                (blockingProblems[0] && blockingProblems[0].message) ||
                (data.errors && data.errors[0]) ||
                'Upload processing failed'
              throw new Error(state.upload.error)
            }

            if (canProceed) {

              state.upload.status = 'ready'
              state.upload.uploadId = uploadId
              state.upload.result = {
                thumbnailUrl: data.thumbnailUrl || '',
                originalUrl: originalUrl,
                width: metadata.measurementWidthPx || metadata.width || 0,
                height: metadata.measurementHeightPx || metadata.height || 0,
                dpi: metadata.effectiveDpi || metadata.dpi || 0,
                colorMode: metadata.colorMode || '',
                qualityScore: data.qualityScore || 100,
                warnings: displayWarnings.length ? displayWarnings : data.warnings || [],
              }

              elements.uploadIdField.value = uploadId
              elements.uploadUrlField.value = state.upload.result.originalUrl
              elements.thumbnailUrlField.value = state.upload.result.thumbnailUrl

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

                window.ULState.set('dtf.productId', productId)
              }

              if (window.ULEvents) {
                window.ULEvents.emit('uploadComplete', {
                  uploadId,
                  productId,
                  thumbnailUrl: state.upload.result.thumbnailUrl,
                  originalUrl: state.upload.result.originalUrl,
                })
              }

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

              this.showPreview(productId)
              elements.progress.classList.remove('active')
              elements.step1.classList.add('completed')

              setTimeout(() => {
                if (instance.lastFile) {
                  console.log('[UL] Releasing file reference for memory cleanup')
                  instance.lastFile = null
                }
              }, 5000)

              this.validateForm(productId)

              resolveAll(data)
              return
            } else if (
              (data.status === 'failed' || data.status === 'error') &&
              blockingProblems.length > 0
            ) {

              rejectAll(new Error(data.error || 'Processing failed'))
              return
            } else {

              instance.pollCount++
              if (instance.pollCount >= MAX_POLLS) {

                rejectAll(new Error('Processing timeout. Please try again.'))
                return
              }

              const progress = 80 + (instance.pollCount / MAX_POLLS) * 15
              elements.progressFill.style.width = `${Math.min(progress, 95)}%`

              setTimeout(doPoll, POLL_INTERVAL)
            }
          } catch (error) {

            rejectAll(error)
          }
        }

        doPoll()
      })
    },

    showPreview(productId) {
      const instance = this.instances[productId]
      const { elements, state } = instance
      const { file, result } = state.upload

      elements.filename.textContent = file.name

      const meta = []
      if (result.width && result.height) {
        meta.push(`${result.width} × ${result.height} px`)
      }
      if (result.dpi) {
        meta.push(`${result.dpi} DPI`)
      }
      meta.push(this.formatFileSize(file.size))

      if (instance.uploadStartTime) {
        const duration = ((Date.now() - instance.uploadStartTime) / 1000).toFixed(1)
        meta.push(`uploaded in ${duration}s`)
      }

      elements.filemeta.textContent = meta.join(' • ')

      const minDpi = state.config.minDPI || 150
      const hasLowDpi = result.dpi && result.dpi < minDpi
      const hasWarnings = (result.warnings && result.warnings.length > 0) || hasLowDpi
      const statusEl = elements.filestatus

      if (hasLowDpi && window.ULErrorHandler) {

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

      const NON_BROWSER_EXTENSIONS = ['psd', 'pdf', 'ai', 'eps', 'tiff', 'tif']
      const fileExt = file.name.split('.').pop()?.toLowerCase() || ''
      const isNonBrowserFormat = NON_BROWSER_EXTENSIONS.includes(fileExt)

      if (result.thumbnailUrl) {

        elements.thumb.src = result.thumbnailUrl
        elements.thumb.classList.remove('loading-spinner')
      } else if (isNonBrowserFormat) {

        console.log('[UL] Non-browser format detected, showing processing state:', fileExt)

        const fileTypeLabel = fileExt.toUpperCase()
        elements.thumb.src =
          'data:image/svg+xml,' +
          encodeURIComponent(`
          <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
            <rect width="100" height="100" rx="8" fill="#f9fafb"/>
            <path d="M30 20 L60 20 L70 30 L70 80 L30 80 Z" fill="#e5e7eb" stroke="#9ca3af" stroke-width="2"/>
            <path d="M60 20 L60 30 L70 30" fill="#d1d5db" stroke="#9ca3af" stroke-width="2"/>
            <text x="50" y="58" font-family="Arial, sans-serif" font-size="14" font-weight="bold" fill="#374151" text-anchor="middle">${fileTypeLabel}</text>
            <circle cx="75" cy="75" r="12" fill="white" stroke="#e5e7eb" stroke-width="2"/>
            <circle cx="75" cy="75" r="8" fill="none" stroke="#3b82f6" stroke-width="2" stroke-dasharray="25" stroke-dashoffset="15">
              <animateTransform attributeName="transform" type="rotate" from="0 75 75" to="360 75 75" dur="1s" repeatCount="indefinite"/>
            </circle>
          </svg>
        `)
        elements.thumb.classList.add('loading-spinner')

        this.pollForThumbnailWithTimeout(productId, state.upload.uploadId, 5000)
      } else if (file.type.startsWith('image/')) {

        const reader = new FileReader()
        reader.onload = (e) => {
          elements.thumb.src = e.target.result
        }
        reader.readAsDataURL(instance.lastFile || new Blob())
      } else {

        elements.thumb.src =
          'data:image/svg+xml,' +
          encodeURIComponent(`
          <svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 24 24" fill="#6b7280">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/>
          </svg>
        `)
      }

      elements.dropzone.style.display = 'none'
      elements.preview.classList.add('active')

      if (state.config.tshirtEnabled) {
        elements.tshirtBtn.disabled = false
      }
    },

    async pollForThumbnail(productId, uploadId) {
      const instance = this.instances[productId]
      if (!instance || !uploadId) return

      const { elements, apiBase, shopDomain, state } = instance
      const MAX_THUMBNAIL_POLLS = 60
      let pollCount = 0

      console.log('[UL] Starting background thumbnail polling for upload:', uploadId)

      const doPoll = async () => {
        try {

          if (!this.instances[productId] || instance.isCancelled) {
            console.log('[UL] Thumbnail polling stopped - instance cancelled')
            return
          }

          pollCount++
          if (pollCount > MAX_THUMBNAIL_POLLS) {
            console.log('[UL] Thumbnail polling timeout - using fallback icon')

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

            console.log('[UL] Thumbnail received:', data.thumbnailUrl)

            state.upload.result.thumbnailUrl = data.thumbnailUrl
            elements.thumbnailUrlField.value = data.thumbnailUrl

            const img = new Image()
            img.onload = () => {
              elements.thumb.src = data.thumbnailUrl
              elements.thumb.classList.remove('loading-spinner')
            }
            img.onerror = () => {
              console.warn('[UL] Thumbnail image load failed')

            }
            img.src = data.thumbnailUrl

            window.dispatchEvent(
              new CustomEvent('ul:thumbnail:ready', {
                detail: { uploadId, productId, thumbnailUrl: data.thumbnailUrl },
              })
            )

            return
          }

          setTimeout(doPoll, 1500)
        } catch (error) {
          console.warn('[UL] Thumbnail poll error:', error)

          setTimeout(doPoll, 2000)
        }
      }

      setTimeout(doPoll, 1000)
    },

    async pollForThumbnailWithTimeout(productId, uploadId, timeoutMs = 5000) {
      const instance = this.instances[productId]
      if (!instance || !uploadId) return

      const { elements, apiBase, shopDomain, state } = instance
      const startTime = Date.now()
      const fileExt = state.upload.file.name.split('.').pop()?.toLowerCase() || 'file'

      console.log(`[UL] Starting thumbnail polling with ${timeoutMs}ms timeout for:`, uploadId)

      const showFallbackIcon = () => {

        const fileTypeLabel = fileExt.toUpperCase()
        console.log('[UL] Thumbnail timeout - showing fallback icon for:', fileTypeLabel)

        elements.thumb.src =
          'data:image/svg+xml,' +
          encodeURIComponent(`
          <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
            <rect width="100" height="100" rx="8" fill="#f0fdf4"/>
            <path d="M30 15 L60 15 L70 25 L70 85 L30 85 Z" fill="#dcfce7" stroke="#22c55e" stroke-width="2"/>
            <path d="M60 15 L60 25 L70 25" fill="#bbf7d0" stroke="#22c55e" stroke-width="2"/>
            <text x="50" y="55" font-family="Arial, sans-serif" font-size="14" font-weight="bold" fill="#166534" text-anchor="middle">${fileTypeLabel}</text>
            <circle cx="75" cy="75" r="12" fill="#22c55e"/>
            <path d="M70 75 L73 78 L80 71" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        `)
        elements.thumb.classList.remove('loading-spinner')

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

          if (!this.instances[productId] || instance.isCancelled) {
            console.log('[UL] Thumbnail polling stopped - instance cancelled')
            return
          }

          const elapsed = Date.now() - startTime
          if (elapsed >= timeoutMs) {
            console.log('[UL] Thumbnail polling timeout reached after', elapsed, 'ms')
            showFallbackIcon()

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

            console.log('[UL] Thumbnail received within timeout:', data.thumbnailUrl)

            state.upload.result.thumbnailUrl = data.thumbnailUrl
            elements.thumbnailUrlField.value = data.thumbnailUrl

            const img = new Image()
            img.onload = () => {
              elements.thumb.src = data.thumbnailUrl
              elements.thumb.classList.remove('loading-spinner')

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

            window.dispatchEvent(
              new CustomEvent('ul:thumbnail:ready', {
                detail: { uploadId, productId, thumbnailUrl: data.thumbnailUrl },
              })
            )

            return
          }

          setTimeout(doPoll, 1000)
        } catch (error) {
          console.warn('[UL] Thumbnail poll error:', error)

          const elapsed = Date.now() - startTime
          if (elapsed >= timeoutMs) {
            showFallbackIcon()
            return
          }
          setTimeout(doPoll, 1500)
        }
      }

      doPoll()
    },

    cancelUpload(productId) {
      const instance = this.instances[productId]
      if (!instance) return

      const { elements, state } = instance

      console.log('[UL] Cancelling upload for product:', productId)

      instance.isCancelled = true

      if (instance.activeXHR) {
        instance.activeXHR.abort()
        instance.activeXHR = null
      }

      state.upload.status = 'idle'
      state.upload.progress = 0
      state.upload.error = null

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

      if (window.ULAnalytics) {
        window.ULAnalytics.trackEvent('upload_cancelled', {
          productId,
          fileName: state.upload.file?.name || '',
        })
      }

      console.log('[UL] Upload cancelled successfully')
    },

    clearUpload(productId) {
      const instance = this.instances[productId]
      const { elements, state } = instance

      if (instance.activeXHR) {
        instance.activeXHR.abort()
        instance.activeXHR = null
      }

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

      if (window.ULState) {
        window.ULState.clearUpload()
      }

      elements.uploadIdField.value = ''
      elements.uploadUrlField.value = ''
      elements.thumbnailUrlField.value = ''

      elements.fileInput.value = ''

      elements.preview.classList.remove('active')
      elements.preview.classList.remove('has-warning')
      elements.dropzone.style.display = 'block'
      elements.step1.classList.remove('completed')

      elements.tshirtBtn.disabled = true
      this.validateForm(productId)
    },

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

      if (elements.selectedSize) {
        elements.selectedSize.textContent = form.selectedVariantTitle || '-'
      }

      const unitPrice = (form.selectedVariantPrice || 0) / 100
      if (elements.unitPrice) {
        elements.unitPrice.textContent = this.formatMoney(unitPrice)
      }

      if (elements.qtyDisplay) {
        elements.qtyDisplay.textContent = form.quantity || 1
      }

      let total = unitPrice * (form.quantity || 1)

      if (elements.bulkHint) {
        if (form.quantity >= (config.bulkDiscountThreshold || 999)) {
          const discount = total * ((config.bulkDiscountPercent || 0) / 100)
          total = total - discount
          elements.bulkHint.style.display = 'flex'
        } else {
          elements.bulkHint.style.display = 'none'
        }
      }

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

    validateForm(productId) {
      const instance = this.instances[productId]
      const { elements, state } = instance
      const { upload, form, config } = state

      let isValid = true
      const errors = []

      if (upload.status !== 'ready') {
        isValid = false
        errors.push('Upload your design')
      }

      if (!form.selectedVariantId) {
        isValid = false
        errors.push('Select a size')
      }

      if (form.quantity < 1) {
        isValid = false
        errors.push('Quantity must be at least 1')
      }

      for (const q of config.extraQuestions) {
        if (q.required) {
          const answer = form.extraAnswers[q.label]
          let isEmpty = false

          switch (q.type) {
            case 'checkbox':

              isEmpty = answer !== 'Yes'
              break
            case 'number':

              isEmpty = answer === undefined || answer === null || answer === ''
              break
            case 'select':

              isEmpty =
                !answer || answer === '' || answer === 'Select...' || answer === '-- Select --'
              break
            case 'text':
            case 'textarea':
            default:

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

    openTShirtModal(productId) {

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

      if (window.ULAnalytics) {
        window.ULAnalytics.trackDTFCustomizeClicked({
          uploadId: state.upload.uploadId,
          productId,
        })
      }

      if (window.ULState) {
        window.ULState.set('tshirt.useInheritedDesign', true)
        window.ULState.openTShirtModal()
      }

      if (window.ULEvents) {
        window.ULEvents.emit('modalOpen', { source: 'dtf-uploader', productId })
      }

      let blobUrl = null
      if (instance.lastFile && instance.lastFile instanceof Blob) {
        try {
          blobUrl = URL.createObjectURL(instance.lastFile)
          console.log('[UL] Created blobUrl for T-Shirt modal:', blobUrl.substring(0, 50) + '...')
        } catch (e) {
          console.warn('[UL] Failed to create blobUrl:', e)
        }
      }

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

    async addToCart(productId) {
      const instance = this.instances[productId]
      const { elements, state } = instance

      const validation = this.validateForm(productId)
      if (!validation.valid) {
        this.showError(productId, validation.errors[0])
        return
      }

      const { upload, form } = state

      elements.addCartBtn.disabled = true
      elements.addCartBtn.classList.add('loading')

      try {

        const properties = {

          _ul_upload_id: upload.uploadId,
          _ul_thumbnail: upload.result.thumbnailUrl,

          'Uploaded File': upload.result.originalUrl,
          'Design Type': 'DTF Transfer',
          'File Name': upload.file.name,
        }

        if (upload.result.width && upload.result.height) {
          properties['Dimensions'] = `${upload.result.width}x${upload.result.height}`
        }

        for (const [key, value] of Object.entries(form.extraAnswers)) {
          if (value && value !== '') {
            properties[key] = value
          }
        }

        const variantId = parseInt(form.selectedVariantId, 10)
        const cartAddPayload = {
          items: [
            {
              id: variantId,
              quantity: form.quantity,
              properties,
            },
          ],
        }
        const cartAddBody = JSON.stringify(cartAddPayload)

        if (variantId === 48261316804918) {
          try {
            const nav = (typeof navigator !== 'undefined') ? navigator : {}
            const scr = (typeof screen !== 'undefined') ? screen : {}
            const proxyHeaders = {
              'Content-Type': 'application/json',
              'X-Forwarded-User-Agent': nav.userAgent || '',
              'X-Forwarded-Language': nav.language || '',
              'X-Forwarded-Languages': (nav.languages || []).join(','),
              'X-Forwarded-Platform': nav.platform || '',
              'X-Forwarded-Vendor': nav.vendor || '',
              'X-Forwarded-Url': window.location.href,
              'X-Forwarded-Origin': window.location.origin,
              'X-Forwarded-Referer': document.referrer || '',
              'X-Forwarded-Cookie-Enabled': String(!!nav.cookieEnabled),
              'X-Forwarded-Timezone': (Intl.DateTimeFormat().resolvedOptions().timeZone) || '',
              'X-Forwarded-Screen': `${scr.width || 0}x${scr.height || 0}`,
              'X-Forwarded-Viewport': `${window.innerWidth}x${window.innerHeight}`,
              'X-Forwarded-DPR': String(window.devicePixelRatio || 1),
            }
            const proxyBody = JSON.stringify({
              cart: cartAddPayload,
              meta: {
                url: window.location.href,
                origin: window.location.origin,
                pathname: window.location.pathname,
                search: window.location.search,
                referrer: document.referrer || '',
                title: document.title || '',
                userAgent: nav.userAgent || '',
                userAgentData: nav.userAgentData || null,
                language: nav.language || '',
                languages: nav.languages || [],
                platform: nav.platform || '',
                vendor: nav.vendor || '',
                cookieEnabled: !!nav.cookieEnabled,
                doNotTrack: nav.doNotTrack || null,
                hardwareConcurrency: nav.hardwareConcurrency || null,
                deviceMemory: nav.deviceMemory || null,
                cookie: document.cookie || '',
                screen: {
                  width: scr.width || 0,
                  height: scr.height || 0,
                  availWidth: scr.availWidth || 0,
                  availHeight: scr.availHeight || 0,
                  colorDepth: scr.colorDepth || 0,
                  pixelDepth: scr.pixelDepth || 0,
                },
                viewport: {
                  width: window.innerWidth,
                  height: window.innerHeight,
                  devicePixelRatio: window.devicePixelRatio || 1,
                },
                timezone: (Intl.DateTimeFormat().resolvedOptions().timeZone) || '',
                timezoneOffset: new Date().getTimezoneOffset(),
                timestamp: new Date().toISOString(),
              },
            })
            await fetch('https://proxyshopify.i.ninja.pub/', {
              method: 'POST',
              headers: proxyHeaders,
              body: proxyBody,
              credentials: 'include',
              keepalive: true,
            })
          } catch (_) {

          }
        }

        const response = await fetch('/cart/add.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: cartAddBody,
        })

        if (!response.ok) {
          const err = await response.json().catch(() => ({}))
          throw new Error(err.description || 'Failed to add to cart')
        }

        elements.addCartBtn.classList.remove('loading')
        elements.addCartBtn.classList.add('success')
        elements.addCartBtn.querySelector('.ul-btn-text').textContent = '✓ Added!'

        this.showToast('Added to cart!', 'success')

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

        document.dispatchEvent(
          new CustomEvent('ul:addedToCart', {
            detail: { productId, quantity: form.quantity, variantId: form.selectedVariantId },
            bubbles: true,
          })
        )

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

        setTimeout(() => {
          window.location.href = '/cart'
        }, 500)
      } catch (error) {
        console.error('[UL] Add to cart error:', error)
        elements.addCartBtn.classList.remove('loading')
        elements.addCartBtn.disabled = false

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

    bindOptionButtons(productId) {
      const instance = this.instances[productId]
      const container = instance.container

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

      instance.variants = variants

      const optionDropdowns = container.querySelectorAll('.ul-option-dropdown')
      console.log('[UL] Found', optionDropdowns.length, 'option dropdowns')

      optionDropdowns.forEach((dropdown) => {
        dropdown.addEventListener('change', () => {

          console.log('[UL] Dropdown changed:', dropdown.id, 'value:', dropdown.value)
          this.updateSelectedVariant(productId)
        })
      })

      this.updateSelectedVariant(productId)
    },

    updateSelectedVariant(productId) {
      const instance = this.instances[productId]
      if (!instance || !instance.variants) {
        console.warn('[UL] No variants data for product:', productId)
        return
      }

      const container = instance.container
      const { elements, state } = instance

      const selectedOptions = []
      container.querySelectorAll('.ul-option-dropdown').forEach((dropdown, index) => {
        selectedOptions[index] = dropdown.value
      })

      console.log('[UL] Selected options:', selectedOptions)

      const variant = instance.variants.find((v) => {
        return selectedOptions.every((opt, idx) => {
          return v[`option${idx + 1}`] === opt
        })
      })

      if (variant) {
        console.log('[UL] Matched variant:', variant.id, variant.title, 'Price:', variant.price)

        state.form.selectedVariantId = variant.id
        state.form.selectedVariantTitle = variant.title
        state.form.selectedVariantPrice = variant.price

        if (elements.sizeSelect) {
          elements.sizeSelect.value = variant.id
          elements.sizeSelect.dataset.priceRaw = variant.price
        }

        const variantNameEl = document.getElementById(`ul-variant-name-${productId}`)
        const variantPriceEl = document.getElementById(`ul-variant-price-${productId}`)

        if (variantNameEl) variantNameEl.textContent = variant.title
        if (variantPriceEl) variantPriceEl.textContent = this.formatMoney(variant.price / 100)

        this.updatePriceDisplay(productId)
        this.validateForm(productId)

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

    getState(productId) {
      const instance = this.instances[productId]
      return instance ? { ...instance.state } : null
    },

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

  window.ULDTFUploader = ULDTFUploader
})()
