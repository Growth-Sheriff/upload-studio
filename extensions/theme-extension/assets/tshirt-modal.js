

console.log('[ULTShirtModal] Script loading...')
;(function () {
  'use strict'

  console.log('[ULTShirtModal] IIFE started')

  const ULTShirtModal = {

    isOpen: false,
    currentStep: 1,

    inheritedDesign: {
      uploadId: null,
      thumbnailUrl: null,
      originalUrl: null,
      name: null,
      dimensions: { width: 0, height: 0, dpi: 0 },
    },

    step1: {
      useInheritedDesign: false,
      newUpload: {
        status: 'idle',
        uploadId: null,
        thumbnailUrl: null,
        originalUrl: null,
        name: null,
        progress: 0,
      },
    },

    step2: {
      tshirtColor: '#FFFFFF',
      tshirtColorName: 'White',
      tshirtSize: 'M',
      locations: {
        front: { enabled: true, scale: 100, positionX: 0, positionY: 0, price: 0 },
        back: { enabled: false, scale: 100, positionX: 0, positionY: 0, price: 5 },
        left_sleeve: { enabled: false, scale: 100, positionX: 0, positionY: 0, price: 3 },
        right_sleeve: { enabled: false, scale: 100, positionX: 0, positionY: 0, price: 3 },
      },
      activeLocation: 'front',
      basePrice: 19.99,
      calculatedPrice: 19.99,
    },

    step3: {
      quantity: 1,
      extraAnswers: {},
      specialInstructions: '',
    },

    step4: {
      confirmationChecked: false,
    },

    three: {
      scene: null,
      camera: null,
      renderer: null,
      controls: null,
      tshirtModel: null,
      tshirtMesh: null,
      decals: {},
      animationId: null,

      isDragging: false,
      previousMouseX: 0,
      targetRotationY: 0,
      currentRotationY: 0,
    },

    currentTexture: null,

    textureCanvas: null,
    textureCtx: null,
    baseTextureSize: 2048,
    decalImage: null,

    shopDomain: null,

    product: {
      id: null,
      variants: [],
      colors: [],
      sizes: [],
    },

    config: {
      tshirtProductHandle: null,
      extraQuestions: [],
      sizePricing: { XS: 0, S: 0, M: 0, L: 2, XL: 2, '2XL': 5, '3XL': 5 },
      allowedPositions: ['front', 'back', 'left_sleeve', 'right_sleeve'],
    },

    el: {},

    UV_REGIONS: {
      front: {

        bounds: { uMin: 0.05, uMax: 0.45, vMin: 0.1, vMax: 0.5 },
        center: { u: 0.25, v: 0.3 },
        defaultSize: 0.55,
      },
      back: {

        bounds: { uMin: 0.5, uMax: 0.95, vMin: 0.1, vMax: 0.5 },
        center: { u: 0.72, v: 0.3 },
        defaultSize: 0.55,
      },
      left_sleeve: {

        bounds: { uMin: 0.0, uMax: 0.15, vMin: 0.0, vMax: 0.25 },
        center: { u: 0.2, v: 0.85 },
        defaultSize: 0.7,
      },
      right_sleeve: {

        bounds: { uMin: 0.45, uMax: 0.75, vMin: 0.7, vMax: 1.0 },
        center: { u: 0.6, v: 0.85 },
        defaultSize: 0.7,
      },
    },

    DECAL_LOCATIONS: {
      front: { position: { x: 0, y: 0.04, z: 0.12 }, rotation: { x: 0, y: 0, z: 0 } },
      back: { position: { x: 0, y: 0.04, z: -0.12 }, rotation: { x: 0, y: Math.PI, z: 0 } },
      left_sleeve: { position: { x: -0.18, y: 0.12, z: 0.05 }, rotation: { x: 0, y: 0, z: 0 } },
      right_sleeve: { position: { x: 0.18, y: 0.12, z: 0.05 }, rotation: { x: 0, y: 0, z: 0 } },
    },

    colorMap: {
      white: '#ffffff',
      black: '#1a1a1a',
      navy: '#1e3a5f',
      red: '#dc2626',
      blue: '#3b82f6',
      green: '#22c55e',
      gray: '#6b7280',
      grey: '#6b7280',
      pink: '#ec4899',
      yellow: '#eab308',
      orange: '#f97316',
      purple: '#a855f7',
      brown: '#92400e',
      maroon: '#7f1d1d',
      olive: '#556b2f',
      teal: '#14b8a6',
      coral: '#ff7f50',
      beige: '#f5f5dc',
      cream: '#fffdd0',
      burgundy: '#800020',
      charcoal: '#36454f',
      'heather gray': '#9ca3af',
      'heather grey': '#9ca3af',
      'light blue': '#93c5fd',
      'dark green': '#166534',
      'dark blue': '#1e40af',
      'royal blue': '#4169e1',
      'forest green': '#228b22',
      'sky blue': '#87ceeb',
      mint: '#98ff98',
      lavender: '#e6e6fa',
      natural: '#faebd7',
      sand: '#c2b280',
    },

    init() {
      try {
        console.log('[ULTShirtModal] Starting init...')
        this.cacheElements()
        console.log('[ULTShirtModal] Elements cached, overlay:', !!this.el.overlay)
        this.bindEvents()
        console.log('[ULTShirtModal] Events bound')
        this.createTextureCanvas()
        console.log('[ULTShirtModal] Texture canvas created')
        console.log('[ULTShirtModal] Initialized v5.0.0 - Texture Baking Strategy')
      } catch (err) {
        console.error('[ULTShirtModal] Init error:', err)
      }
    },

    createTextureCanvas() {

      const optimalSize = this.getOptimalTextureSize()
      this.baseTextureSize = optimalSize

      this.textureCanvas = document.createElement('canvas')
      this.textureCanvas.width = this.baseTextureSize
      this.textureCanvas.height = this.baseTextureSize
      this.textureCtx = this.textureCanvas.getContext('2d')
      console.log(
        '[ULTShirtModal] Texture canvas:',
        this.baseTextureSize + 'x' + this.baseTextureSize
      )
    },

    getOptimalTextureSize() {

      const fileSize =
        this.step1.newUpload?.fileSize ||
        this.inheritedDesign?.dimensions?.fileSize ||
        this.inheritedDesign?.fileSize ||
        0

      const sizeMB = fileSize / (1024 * 1024)

      if (sizeMB > 30) {
        console.log(
          '[ULTShirtModal] Large file detected (',
          sizeMB.toFixed(1),
          'MB), using 1K texture'
        )
        return 1024
      }
      if (sizeMB > 15) {
        console.log(
          '[ULTShirtModal] Medium-large file detected (',
          sizeMB.toFixed(1),
          'MB), using 1.5K texture'
        )
        return 1536
      }

      return 2048
    },

    cacheElements() {
      this.el = {
        overlay: document.getElementById('ul-tshirt-overlay'),
        closeBtn: document.getElementById('ul-tshirt-close'),
        toast: document.getElementById('ul-toast'),

        navBack: document.getElementById('ul-nav-back'),
        navNext: document.getElementById('ul-nav-next'),
        stepItems: document.querySelectorAll('.ul-step-item'),
        stepConnectors: document.querySelectorAll('.ul-step-connector'),
        stepPanels: document.querySelectorAll('.ul-step-panel'),

        inheritedSection: document.getElementById('ul-inherited-section'),
        inheritedThumb: document.getElementById('ul-inherited-thumb'),
        inheritedName: document.getElementById('ul-inherited-name'),
        inheritedMeta: document.getElementById('ul-inherited-meta'),
        inheritedDesign: document.getElementById('ul-inherited-design'),
        useInheritedBtn: document.getElementById('ul-use-inherited-btn'),
        uploadZone: document.getElementById('ul-tshirt-upload-zone'),
        fileInput: document.getElementById('ul-tshirt-file-input'),
        uploadProgress: document.getElementById('ul-tshirt-upload-progress'),
        progressFill: document.getElementById('ul-tshirt-progress-fill'),
        progressText: document.getElementById('ul-tshirt-progress-text'),
        newUploadPreview: document.getElementById('ul-new-upload-preview'),
        newUploadThumb: document.getElementById('ul-new-upload-thumb'),
        newUploadName: document.getElementById('ul-new-upload-name'),
        newUploadMeta: document.getElementById('ul-new-upload-meta'),

        canvas: document.getElementById('ul-3d-canvas'),
        loading3d: document.getElementById('ul-3d-loading'),
        colorGrid: document.getElementById('ul-color-grid'),
        sizeSelect: document.getElementById('ul-size-select'),
        locationList: document.getElementById('ul-location-list'),
        locationSettings: document.getElementById('ul-location-settings'),
        settingsLocationName: document.getElementById('ul-settings-location-name'),
        scaleSlider: document.getElementById('ul-scale-slider'),
        scaleValue: document.getElementById('ul-scale-value'),
        posXSlider: document.getElementById('ul-pos-x-slider'),
        posXValue: document.getElementById('ul-pos-x-value'),
        posYSlider: document.getElementById('ul-pos-y-slider'),
        posYValue: document.getElementById('ul-pos-y-value'),
        quickViewBtns: document.querySelectorAll('.ul-quick-view-btn'),
        priceBase: document.getElementById('ul-price-base'),
        priceLocations: document.getElementById('ul-price-locations'),
        priceLocationsRow: document.getElementById('ul-price-locations-row'),
        priceSize: document.getElementById('ul-price-size'),
        priceSizeRow: document.getElementById('ul-price-size-row'),
        priceTotal: document.getElementById('ul-price-total'),

        detailsTitle: document.getElementById('ul-details-title'),
        detailsMeta: document.getElementById('ul-details-meta'),
        detailsThumbs: document.getElementById('ul-details-thumbs'),
        qtyMinus: document.getElementById('ul-qty-minus'),
        qtyPlus: document.getElementById('ul-qty-plus'),
        qtyValue: document.getElementById('ul-qty-value'),
        extraQuestions: document.getElementById('ul-tshirt-extra-questions'),
        specialInstructions: document.getElementById('ul-special-instructions'),

        reviewColor: document.getElementById('ul-review-color'),
        reviewSize: document.getElementById('ul-review-size'),
        reviewQty: document.getElementById('ul-review-qty'),
        reviewLocations: document.getElementById('ul-review-locations'),
        reviewPriceBreakdown: document.getElementById('ul-review-price-breakdown'),
        reviewPriceBase: document.getElementById('ul-review-price-base'),
        reviewTotal: document.getElementById('ul-review-total'),
        reviewPreviewGrid: document.getElementById('ul-review-preview-grid'),
        confirmCheckbox: document.getElementById('ul-confirm-checkbox'),
        designAnotherBtn: document.getElementById('ul-design-another-btn'),
        checkoutBtn: document.getElementById('ul-checkout-btn'),
      }
    },

    bindEvents() {

      document.addEventListener('ul:openTShirtModal', (e) => {
        console.log('[ULTShirtModal] Received ul:openTShirtModal event:', e.detail)
        this.open(e.detail)
      })

      this.el.closeBtn?.addEventListener('click', () => this.close())
      this.el.overlay?.addEventListener('click', (e) => {
        if (e.target === this.el.overlay) this.close()
      })
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.isOpen) this.close()
      })

      this.el.navBack?.addEventListener('click', () => this.prevStep())
      this.el.navNext?.addEventListener('click', () => this.nextStep())

      this.el.useInheritedBtn?.addEventListener('click', () => this.useInheritedDesign())
      this.el.uploadZone?.addEventListener('click', () => this.el.fileInput?.click())
      this.el.uploadZone?.addEventListener('dragover', (e) => this.handleDragOver(e))
      this.el.uploadZone?.addEventListener('dragleave', () => this.handleDragLeave())
      this.el.uploadZone?.addEventListener('drop', (e) => this.handleDrop(e))
      this.el.fileInput?.addEventListener('change', (e) => this.handleFileSelect(e))

      this.el.sizeSelect?.addEventListener('change', (e) => this.setSize(e.target.value))
      this.el.scaleSlider?.addEventListener('input', (e) => this.setLocationScale(e.target.value))
      this.el.posXSlider?.addEventListener('input', (e) => this.setLocationPosX(e.target.value))
      this.el.posYSlider?.addEventListener('input', (e) => this.setLocationPosY(e.target.value))

      this.el.quickViewBtns?.forEach((btn) => {
        btn.addEventListener('click', () => this.setQuickView(btn.dataset.view))
      })

      document.querySelectorAll('.ul-location-checkbox').forEach((cb) => {
        cb.addEventListener('change', () => this.toggleLocation(cb.dataset.location))
      })

      this.el.qtyMinus?.addEventListener('click', () => this.adjustQuantity(-1))
      this.el.qtyPlus?.addEventListener('click', () => this.adjustQuantity(1))
      this.el.specialInstructions?.addEventListener('input', (e) => {
        this.step3.specialInstructions = e.target.value
      })

      this.el.confirmCheckbox?.addEventListener('change', (e) => {
        this.step4.confirmationChecked = e.target.checked
        this.updateActionButtons()
      })
      this.el.designAnotherBtn?.addEventListener('click', () => this.designAnother())
      this.el.checkoutBtn?.addEventListener('click', () => this.checkout())

      window.addEventListener('resize', () => this.handleResize())
    },

    open(detail = {}) {

      if (window.Shopify && window.Shopify.designMode) return

      const { uploadData, productId, config, shopDomain } = detail

      console.log('[ULTShirtModal] Opening with:', detail)

      if (shopDomain) {
        this.shopDomain = shopDomain
      }

      if (productId && uploadData) {
        try {
          const storedUpload = sessionStorage.getItem(`ul_upload_${productId}`)
          if (storedUpload) {
            const parsed = JSON.parse(storedUpload)

            if (parsed.uploadId !== (uploadData.id || uploadData.uploadId)) {
              console.warn('[ULTShirtModal] Upload from different tab detected')

              this.showToast('Using the most recent design from this tab.', 'info')
            }
          }
        } catch (e) {
          console.warn('[ULTShirtModal] Tab session check failed:', e)
        }
      }

      if (uploadData) {
        this.inheritedDesign = {
          uploadId: uploadData.id || uploadData.uploadId,
          thumbnailUrl: uploadData.thumbnailUrl || uploadData.url,
          originalUrl: uploadData.url || uploadData.originalUrl,
          blobUrl: uploadData.blobUrl || null, // FAZ 5 FIX: Store blobUrl from DTF uploader
          name: uploadData.name || 'Design',
          dimensions: uploadData.dimensions || { width: 0, height: 0, dpi: 0 },
        }

        if (!this.inheritedDesign.blobUrl && this.inheritedDesign.thumbnailUrl) {
          this.fetchAndCacheThumbnail(this.inheritedDesign.thumbnailUrl)
            .then((blobUrl) => {
              if (blobUrl) {
                this.inheritedDesign.blobUrl = blobUrl
                console.log('[ULTShirtModal] Cached inherited design as blobUrl')
              }
            })
            .catch((e) => console.warn('[ULTShirtModal] Could not cache thumbnail:', e))
        }

        this.showInheritedDesign()
      } else {
        this.hideInheritedDesign()
      }

      if (config) {
        Object.assign(this.config, config)
      }

      this.product.id = productId

      this.resetState()

      if (window.ULState) {
        window.ULState.set('tshirt.isModalOpen', true)
        window.ULState.set('tshirt.currentStep', 1)
        if (uploadData) {
          window.ULState.set('tshirt.useInheritedDesign', true)
        }
      }

      if (window.ULEvents) {
        window.ULEvents.emit('modalOpen', {
          source: 'tshirt-modal',
          productId,
          hasInheritedDesign: !!uploadData,
        })
      }

      if (window.ULAnalytics) {
        window.ULAnalytics.trackTShirtModalOpened({
          hasInheritedDesign: !!uploadData,
          source: 'tshirt-modal',
          productId,
        })
      }

      this.el.overlay?.classList.add('active')
      this.isOpen = true
      document.body.style.overflow = 'hidden'

      const restored = this.checkAndRestoreProgress(productId)

      if (!restored) {
        this.goToStep(1)
      }

      this.loadProductVariants()
    },

    close() {
      this.el.overlay?.classList.remove('active')
      this.isOpen = false
      document.body.style.overflow = ''

      if (window.ULAnalytics) {
        window.ULAnalytics.trackTShirtModalClosed({
          stepReached: this.currentStep,
          completed: this.currentStep === 4 && this.step4.confirmationChecked,
          productId: this.product.id,
        })
      }

      if (window.ULState) {
        window.ULState.set('tshirt.isModalOpen', false)
      }

      if (window.ULEvents) {
        window.ULEvents.emit('modalClose', { source: 'tshirt-modal' })
      }

      this.cleanupBlobUrls()

      this.cleanup3D()
    },

    async fetchAndCacheThumbnail(url) {
      if (!url || url.startsWith('blob:')) {
        return url
      }

      try {
        const response = await fetch(url, {
          mode: 'cors',
          credentials: 'omit',
          cache: 'force-cache',
        })

        if (!response.ok) {
          throw new Error(`Fetch failed: ${response.status}`)
        }

        const blob = await response.blob()
        const blobUrl = URL.createObjectURL(blob)
        console.log('[ULTShirtModal] Created cached blobUrl from:', url.substring(0, 50) + '...')
        return blobUrl
      } catch (e) {
        console.warn('[ULTShirtModal] fetchAndCacheThumbnail failed:', e.message)
        return null
      }
    },

    cleanupBlobUrls() {

      if (this.inheritedDesign.blobUrl) {
        try {
          URL.revokeObjectURL(this.inheritedDesign.blobUrl)
          console.log('[ULTShirtModal] Revoked inherited design blobUrl')
        } catch (e) {
          console.warn('[ULTShirtModal] Could not revoke inherited blobUrl:', e)
        }
        this.inheritedDesign.blobUrl = null
      }

      if (this.step1.newUpload.blobUrl) {
        try {
          URL.revokeObjectURL(this.step1.newUpload.blobUrl)
          console.log('[ULTShirtModal] Revoked new upload blobUrl')
        } catch (e) {
          console.warn('[ULTShirtModal] Could not revoke new upload blobUrl:', e)
        }
        this.step1.newUpload.blobUrl = null
      }

      if (this.step1.newUpload.thumbnailUrl?.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(this.step1.newUpload.thumbnailUrl)
        } catch (e) {

        }
        this.step1.newUpload.thumbnailUrl = null
      }
    },

    resetState() {
      this.currentStep = 1

      this.textureUpdateId = 0

      this.step1 = {
        useInheritedDesign: false,
        newUpload: {
          status: 'idle',
          uploadId: null,
          thumbnailUrl: null,
          originalUrl: null,
          name: null,
          progress: 0,
        },
      }

      this.step2 = {
        tshirtColor: '#FFFFFF',
        tshirtColorName: 'White',
        tshirtSize: 'M',
        locations: {
          front: { enabled: true, scale: 100, positionX: 0, positionY: 0, price: 0 },
          back: { enabled: false, scale: 100, positionX: 0, positionY: 0, price: 5 },
          left_sleeve: { enabled: false, scale: 100, positionX: 0, positionY: 0, price: 3 },
          right_sleeve: { enabled: false, scale: 100, positionX: 0, positionY: 0, price: 3 },
        },
        activeLocation: 'front',
        basePrice: 19.99,
        calculatedPrice: 19.99,
      }

      this.step3 = { quantity: 1, extraAnswers: {}, specialInstructions: '' }
      this.step4 = { confirmationChecked: false }

      if (this.el.confirmCheckbox) this.el.confirmCheckbox.checked = false
      if (this.el.qtyValue) this.el.qtyValue.textContent = '1'
      if (this.el.specialInstructions) this.el.specialInstructions.value = ''
      if (this.el.newUploadPreview) this.el.newUploadPreview.style.display = 'none'

      this.updateActionButtons()
    },

    goToStep(step) {
      const previousStep = this.currentStep
      this.currentStep = step

      if (step > previousStep && window.ULAnalytics) {
        window.ULAnalytics.trackTShirtStepCompleted({
          step: previousStep,
          stepName: this.getStepName(previousStep),
          nextStep: step,
          timeOnStep: this.stepStartTime ? Date.now() - this.stepStartTime : null,
        })
      }

      this.stepStartTime = Date.now()

      if (window.ULState) {
        window.ULState.set('tshirt.currentStep', step)
      }

      if (window.ULEvents) {
        window.ULEvents.emit('stepChange', { step, source: 'tshirt-modal' })
      }

      this.el.stepItems?.forEach((item, idx) => {
        const itemStep = idx + 1
        item.classList.remove('active', 'completed')
        if (itemStep === step) {
          item.classList.add('active')
        } else if (itemStep < step) {
          item.classList.add('completed')
        }
      })

      this.el.stepConnectors?.forEach((conn, idx) => {
        conn.classList.toggle('completed', idx < step - 1)
      })

      this.el.stepPanels?.forEach((panel, idx) => {
        panel.classList.toggle('active', idx + 1 === step)
      })

      this.updateNavButtons()

      if (step === 2) {
        this.initStep2()
      } else if (step === 3) {
        this.initStep3()
      } else if (step === 4) {
        this.initStep4()
      }

      this.saveProgress()
    },

    saveProgress() {
      try {
        const progress = {
          currentStep: this.currentStep,
          productId: this.product.id,
          inheritedDesign: this.inheritedDesign,
          step1: {
            useInheritedDesign: this.step1.useInheritedDesign,
            newUpload: this.step1.newUpload,
          },
          step2: {
            activeLocation: this.step2.activeLocation,
            tshirtColor: this.step2.tshirtColor,
            tshirtColorName: this.step2.tshirtColorName,
            tshirtSize: this.step2.tshirtSize,
            locations: this.step2.locations,
          },
          step3: {
            quantity: this.step3.quantity,
            extraAnswers: this.step3.extraAnswers,
          },
          timestamp: Date.now(),
        }
        sessionStorage.setItem('ul_tshirt_progress', JSON.stringify(progress))
      } catch (e) {
        console.warn('[ULTShirtModal] Failed to save progress:', e)
      }
    },

    checkAndRestoreProgress(productId) {
      try {
        const saved = sessionStorage.getItem('ul_tshirt_progress')
        if (!saved) return false

        const progress = JSON.parse(saved)

        const isValid =
          progress.productId === productId && Date.now() - progress.timestamp < 30 * 60 * 1000

        if (!isValid) {
          sessionStorage.removeItem('ul_tshirt_progress')
          return false
        }

        const restore = confirm(
          'You have a previous design in progress. Would you like to continue where you left off?'
        )

        if (restore) {

          if (progress.inheritedDesign) {
            this.inheritedDesign = progress.inheritedDesign
          }
          if (progress.step1) {
            Object.assign(this.step1, progress.step1)
          }
          if (progress.step2) {
            Object.assign(this.step2, progress.step2)
          }
          if (progress.step3) {
            Object.assign(this.step3, progress.step3)
          }

          this.goToStep(progress.currentStep)
          this.showToast('Progress restored!', 'success')
          return true
        } else {
          sessionStorage.removeItem('ul_tshirt_progress')
          return false
        }
      } catch (e) {
        console.warn('[ULTShirtModal] Failed to restore progress:', e)
        return false
      }
    },

    nextStep() {

      if (this.currentStep < 4 && this.validateStep() && this.canProceed()) {
        this.goToStep(this.currentStep + 1)
      }
    },

    prevStep() {
      if (this.currentStep > 1) {
        this.goToStep(this.currentStep - 1)
      }
    },

    canProceed() {
      switch (this.currentStep) {
        case 1:
          return this.step1.useInheritedDesign || this.step1.newUpload.status === 'complete'
        case 2:
          return this.getEnabledLocations().length > 0
        case 3:
          return this.step3.quantity > 0
        case 4:
          return this.step4.confirmationChecked
        default:
          return true
      }
    },

    validateStep() {
      const step = this.currentStep

      switch (step) {
        case 1:
          if (!this.step1.useInheritedDesign && this.step1.newUpload.status !== 'complete') {
            if (window.ULErrorHandler) {
              window.ULErrorHandler.show('VALIDATION_UPLOAD_REQUIRED')
            } else {
              this.showToast('Please upload your design first.', 'error')
            }
            return false
          }
          return true

        case 2:
          if (this.getEnabledLocations().length === 0) {
            if (window.ULErrorHandler) {
              window.ULErrorHandler.show('VALIDATION_LOCATION_REQUIRED')
            } else {
              this.showToast('Please select at least one print location.', 'error')
            }
            return false
          }
          return true

        case 3:
          if (this.step3.quantity < 1) {
            if (window.ULErrorHandler) {
              window.ULErrorHandler.show('VALIDATION_INVALID_INPUT', {
                fieldName: 'Quantity',
                hint: 'Please enter at least 1.',
              })
            }
            return false
          }
          return true

        case 4:
          if (!this.step4.confirmationChecked) {
            if (window.ULErrorHandler) {
              window.ULErrorHandler.show('VALIDATION_CONFIRMATION_REQUIRED')
            } else {
              this.showToast('Please confirm your order before proceeding.', 'error')
            }

            if (this.el.confirmCheckbox) {
              this.el.confirmCheckbox.closest('.ul-confirmation')?.classList.add('ul-error-shake')
              setTimeout(() => {
                this.el.confirmCheckbox
                  .closest('.ul-confirmation')
                  ?.classList.remove('ul-error-shake')
              }, 500)
            }
            return false
          }
          return true

        default:
          return true
      }
    },

    updateNavButtons() {

      if (this.el.navBack) {
        this.el.navBack.classList.toggle('hidden', this.currentStep === 1)
      }

      if (this.el.navNext) {
        const canProceed = this.canProceed()
        this.el.navNext.disabled = !canProceed

        const stepLabels = ['Upload', 'Design', 'Details', 'Review']
        if (this.currentStep < 4) {
          this.el.navNext.innerHTML = `Next: ${stepLabels[this.currentStep]} →`
          this.el.navNext.style.display = ''
        } else {
          this.el.navNext.style.display = 'none'
        }
      }
    },

    showInheritedDesign() {
      if (!this.el.inheritedSection) return

      this.el.inheritedSection.style.display = 'block'

      if (this.el.inheritedThumb) {
        this.el.inheritedThumb.src = this.inheritedDesign.thumbnailUrl
      }
      if (this.el.inheritedName) {
        this.el.inheritedName.textContent = this.inheritedDesign.name
      }
      if (this.el.inheritedMeta) {
        const d = this.inheritedDesign.dimensions
        if (d.width && d.height) {
          this.el.inheritedMeta.textContent = `${d.width} x ${d.height} px • ${d.dpi || 300} DPI`
        } else {
          this.el.inheritedMeta.textContent = 'Ready to use'
        }
      }
    },

    hideInheritedDesign() {
      if (this.el.inheritedSection) {
        this.el.inheritedSection.style.display = 'none'
      }
    },

    useInheritedDesign() {
      this.step1.useInheritedDesign = true

      if (this.el.inheritedDesign) {
        this.el.inheritedDesign.classList.add('selected')
      }
      if (this.el.useInheritedBtn) {
        this.el.useInheritedBtn.textContent = '✓ Using This Design'
        this.el.useInheritedBtn.classList.add('selected')
      }

      this.updateNavButtons()
    },

    handleDragOver(e) {
      e.preventDefault()
      e.stopPropagation()
      this.el.uploadZone?.classList.add('dragover')
    },

    handleDragLeave() {
      this.el.uploadZone?.classList.remove('dragover')
    },

    handleDrop(e) {
      e.preventDefault()
      e.stopPropagation()
      this.el.uploadZone?.classList.remove('dragover')

      const files = e.dataTransfer?.files
      if (files?.length > 0) {
        this.uploadFile(files[0])
      }
    },

    handleFileSelect(e) {
      const files = e.target?.files
      if (files?.length > 0) {
        this.uploadFile(files[0])
      }
    },

    async uploadFile(file) {

      const allowedTypes = [
        'image/png',
        'image/jpeg',
        'image/webp',
        'image/svg+xml',
        'image/tiff',
        'image/vnd.adobe.photoshop',
        'application/pdf',
        'application/postscript',
      ]

      if (!file.size || file.size === 0) {
        this.showToast('The selected file is empty (0 bytes). Please select a valid file.', 'error')
        console.error('[T-Shirt Modal] 0-byte file rejected:', file.name)
        return
      }

      const allowedExtensions = [
        'png',
        'jpg',
        'jpeg',
        'webp',
        'svg',
        'tiff',
        'tif',
        'psd',
        'pdf',
        'ai',
        'eps',
      ]
      const ext = file.name.split('.').pop()?.toLowerCase() || ''

      if (!allowedTypes.includes(file.type) && !allowedExtensions.includes(ext)) {
        this.showToast('Please upload PNG, JPG, WEBP, SVG, TIFF, PSD, PDF, AI, or EPS', 'error')
        return
      }

      if (file.size > 10240 * 1024 * 1024) {
        this.showToast('File size must be less than 10GB', 'error')
        return
      }

      this.step1.newUpload.status = 'uploading'
      this.step1.newUpload.name = file.name
      this.step1.useInheritedDesign = false

      if (this.el.inheritedDesign) {
        this.el.inheritedDesign.classList.remove('selected')
      }
      if (this.el.useInheritedBtn) {
        this.el.useInheritedBtn.textContent = '✓ Use This Design'
        this.el.useInheritedBtn.classList.remove('selected')
      }

      this.el.uploadZone?.classList.add('uploading')
      if (this.el.uploadProgress) this.el.uploadProgress.style.display = 'block'
      this.updateUploadProgress(0)

      const progressText = this.el.uploadProgress?.querySelector('.ul-progress-text')

      const progressCallback = (progress) => {
        if (progressText) {
          progressText.textContent = progress.text
        }
      }

      try {

        const uploadResult = await this.performUpload(file, progressCallback)

        this.step1.newUpload = {
          status: 'complete',
          uploadId: uploadResult.id,
          thumbnailUrl: uploadResult.thumbnailUrl || uploadResult.url,
          originalUrl: uploadResult.url,
          name: file.name,
          progress: 100,
          uploadDuration: uploadResult.uploadDuration,
        }

        if (this.el.newUploadPreview) {
          this.el.newUploadPreview.style.display = 'block'
        }
        if (this.el.newUploadThumb) {
          this.el.newUploadThumb.src = this.step1.newUpload.thumbnailUrl
        }
        if (this.el.newUploadName) {
          this.el.newUploadName.textContent = file.name
        }

        const durationEl = this.el.newUploadPreview?.querySelector('.ul-upload-duration')
        if (durationEl && uploadResult.uploadDuration) {
          durationEl.textContent = `Uploaded in ${uploadResult.uploadDuration}s`
          durationEl.style.display = 'block'
        }

        if (this.el.uploadProgress) this.el.uploadProgress.style.display = 'none'
        this.el.uploadZone?.classList.remove('uploading')

        this.updateNavButtons()
        this.showToast(`Design uploaded in ${uploadResult.uploadDuration}s!`, 'success')
      } catch (error) {
        console.error('[ULTShirtModal] Upload error:', error)
        this.step1.newUpload.status = 'error'
        if (this.el.uploadProgress) this.el.uploadProgress.style.display = 'none'
        this.el.uploadZone?.classList.remove('uploading')
        this.showToast(error.message || 'Upload failed. Please try again.', 'error')
      }
    },

    async performUpload(file, progressCallback) {

      const apiBase = '/apps/customizer'

      const uploadStartTime = Date.now()

      const customerId = window.ULCustomer?.id || null
      const customerEmail = window.ULCustomer?.email || null

      const shopDomain = this.getShopDomain()

      if (!shopDomain) {
        console.error('[ULTShirtModal] CRITICAL: shopDomain could not be determined')
        throw new Error('Shop configuration error. Please refresh the page and try again.')
      }

      console.log('[ULTShirtModal] performUpload - shopDomain:', shopDomain)

      if (progressCallback) {
        progressCallback({ phase: 'intent', percent: 0, text: 'Preparing...' })
      }

      const intentRes = await fetch(`${apiBase}/api/upload/intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopDomain,
          productId: this.product.id || null,
          mode: '3d_designer',
          fileName: file.name,
          contentType: file.type || 'application/octet-stream',
          fileSize: file.size,
          customerId: customerId ? String(customerId) : null,
          customerEmail: customerEmail,
        }),
      })

      if (!intentRes.ok) {
        const err = await intentRes.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to get upload URL')
      }

      const intentData = await intentRes.json()
      const {
        uploadId,
        itemId,
        uploadUrl,
        storageProvider,
        uploadMethod,
        uploadHeaders,
        publicUrl,
        key,
      } = intentData

      console.log('[ULTShirtModal] Intent response:', { uploadId, itemId, storageProvider })

      if (progressCallback) {
        progressCallback({ phase: 'upload', percent: 0, text: '0% • Starting...' })
      }

      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100)
            const elapsed = (Date.now() - uploadStartTime) / 1000
            const speed = e.loaded / elapsed / 1024 / 1024
            const remaining = elapsed > 0 ? (e.total - e.loaded) / (e.loaded / elapsed) : 0

            let speedText =
              speed >= 1 ? `${speed.toFixed(1)} MB/s` : `${(speed * 1024).toFixed(0)} KB/s`
            let remainingText =
              remaining < 60 ? `${Math.ceil(remaining)}s` : `${Math.ceil(remaining / 60)}m`

            this.updateUploadProgress(percent)

            if (progressCallback) {
              progressCallback({
                phase: 'upload',
                percent,
                text: `${percent}% • ${speedText} • ${remainingText} left`,
              })
            }
          }
        }

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve()
          } else {
            reject(new Error('Upload failed'))
          }
        }

        xhr.onerror = () => reject(new Error('Network error during upload'))

        if (storageProvider === 'bunny' || storageProvider === 'r2') {
          xhr.open('PUT', uploadUrl)
          xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
          if (uploadHeaders) {
            Object.entries(uploadHeaders).forEach(([k, v]) => xhr.setRequestHeader(k, v))
          }
          xhr.send(file)
        } else {

          const formData = new FormData()
          formData.append('file', file)
          formData.append('key', key)
          formData.append('uploadId', uploadId)
          formData.append('itemId', itemId)
          xhr.open('POST', uploadUrl)
          xhr.send(formData)
        }
      })

      if (progressCallback) {
        progressCallback({ phase: 'complete', percent: 100, text: 'Finalizing...' })
      }

      const uploadDurationMs = Date.now() - uploadStartTime
      const completeRes = await fetch(`${apiBase}/api/upload/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopDomain,
          uploadId,
          items: [
            {
              itemId,
              location: 'front',
              fileUrl: publicUrl || null,
              storageProvider: storageProvider || 'local',
              uploadDurationMs: uploadDurationMs,
            },
          ],
        }),
      })

      if (!completeRes.ok) {
        const err = await completeRes.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to complete upload')
      }

      const uploadDuration = (uploadDurationMs / 1000).toFixed(1)

      const NON_BROWSER_EXTENSIONS = ['psd', 'pdf', 'ai', 'eps', 'tiff', 'tif']
      const ext = file.name.split('.').pop()?.toLowerCase() || ''
      const isNonBrowserFormat = NON_BROWSER_EXTENSIONS.includes(ext)

      let thumbnailUrl
      if (isNonBrowserFormat) {

        console.log('[ULTShirtModal] Non-browser format detected, polling for thumbnail:', ext)
        thumbnailUrl = await this.pollForThumbnail(uploadId, uploadDuration, progressCallback)
      } else {

        thumbnailUrl = URL.createObjectURL(file)
      }

      const fullUrl = `${window.location.origin}${apiBase}/api/upload/file/${uploadId}`

      console.log('[ULTShirtModal] Upload complete:', {
        uploadId,
        thumbnailUrl,
        fullUrl,
        uploadDuration,
      })

      return {
        id: uploadId,
        url: fullUrl, // Full https:// URL for checkout
        thumbnailUrl,
        uploadDuration,
      }
    },

    async pollForThumbnail(uploadId, uploadDuration, progressCallback) {
      const apiBase = '/apps/customizer'
      const shopDomain = this.getShopDomain()
      const MAX_POLLS = 60
      let pollCount = 0

      if (progressCallback) {
        progressCallback({ phase: 'processing', percent: 100, text: 'Processing design...' })
      }

      return new Promise((resolve) => {
        const doPoll = async () => {
          pollCount++

          if (pollCount > MAX_POLLS) {
            console.log('[ULTShirtModal] Thumbnail polling timeout')

            resolve(
              'data:image/svg+xml,' +
                encodeURIComponent(`
              <svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 100 100">
                <rect width="100" height="100" fill="#f3f4f6"/>
                <text x="50" y="45" text-anchor="middle" fill="#6b7280" font-size="8">Preview</text>
                <text x="50" y="55" text-anchor="middle" fill="#6b7280" font-size="8">processing...</text>
              </svg>
            `)
            )
            return
          }

          try {
            const response = await fetch(
              `${apiBase}/api/upload/status/${uploadId}?shopDomain=${encodeURIComponent(shopDomain)}`
            )

            if (response.ok) {
              const data = await response.json()

              if (data.thumbnailUrl) {
                console.log('[ULTShirtModal] Thumbnail ready:', data.thumbnailUrl)

                if (progressCallback) {
                  progressCallback({
                    phase: 'complete',
                    percent: 100,
                    text: `Uploaded in ${uploadDuration}s`,
                  })
                }

                resolve(data.thumbnailUrl)
                return
              }
            }

            if (progressCallback && pollCount > 3) {
              progressCallback({
                phase: 'processing',
                percent: 100,
                text: `Processing design... ${pollCount}s`,
              })
            }

            setTimeout(doPoll, 1000)
          } catch (error) {
            console.warn('[ULTShirtModal] Thumbnail poll error:', error)
            setTimeout(doPoll, 1500)
          }
        }

        setTimeout(doPoll, 500)
      })
    },

    updateUploadProgress(percent) {
      this.step1.newUpload.progress = percent
      if (this.el.progressFill) {
        this.el.progressFill.style.width = `${percent}%`
      }
      if (this.el.progressText) {
        this.el.progressText.textContent =
          percent < 100 ? `Uploading... ${percent}%` : 'Processing...'
      }
    },

    initStep2() {

      this.renderColors()

      this.renderSizes()

      this.updateLocationSettingsUI()

      this.calculatePrice()

      this.waitForThreeJS()
    },

    waitForThreeJS(attempts = 0) {
      const maxAttempts = 20

      if (typeof THREE !== 'undefined') {
        console.log('[ULTShirtModal] Three.js loaded, initializing 3D')
        this.init3D()
        return
      }

      if (attempts >= maxAttempts) {
        console.warn('[ULTShirtModal] Three.js failed to load, using 2D fallback')
        this.initFallback2D()
        return
      }

      setTimeout(() => this.waitForThreeJS(attempts + 1), 100)
    },

    supports3D() {

      const canvas = document.createElement('canvas')
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')

      if (!gl) {
        console.log('[ULTShirtModal] WebGL not supported')
        return false
      }

      if (typeof THREE === 'undefined') {
        console.log('[ULTShirtModal] Three.js not yet loaded')
        return false
      }

      return true
    },

    initFallback2D() {
      console.log('[ULTShirtModal] Initializing 2D fallback mode')

      if (this.el.canvas) {
        this.el.canvas.style.display = 'none'
      }
      if (this.el.loading3d) {
        this.el.loading3d.style.display = 'none'
      }

      let fallback = document.getElementById('ul-3d-fallback')
      if (!fallback) {
        fallback = this.createFallbackUI()
      }
      fallback.classList.add('active')

      this.updateFallback2D()
    },

    createFallbackUI() {
      const container = document.createElement('div')
      container.id = 'ul-3d-fallback'
      container.className = 'ul-3d-fallback'

      this.fallbackSvgPaths = {
        front: `<path d="M100 20 L60 20 L40 60 L20 60 L20 100 L50 100 L50 220 L150 220 L150 100 L180 100 L180 60 L160 60 L140 20 L100 20 Z"
                      fill="${this.step2.tshirtColor}" stroke="#ccc" stroke-width="2"/>`,
        back: `<path d="M100 20 L60 20 L40 60 L20 60 L20 100 L50 100 L50 220 L150 220 L150 100 L180 100 L180 60 L160 60 L140 20 L100 20 Z"
                     fill="${this.step2.tshirtColor}" stroke="#999" stroke-width="2" stroke-dasharray="5,3"/>
               <text x="100" y="130" text-anchor="middle" fill="#999" font-size="14">BACK</text>`,
        left_sleeve: `<rect x="40" y="60" width="70" height="100" rx="8" fill="${this.step2.tshirtColor}" stroke="#ccc" stroke-width="2"/>
                      <text x="75" y="115" text-anchor="middle" fill="#999" font-size="10">LEFT</text>`,
        right_sleeve: `<rect x="90" y="60" width="70" height="100" rx="8" fill="${this.step2.tshirtColor}" stroke="#ccc" stroke-width="2"/>
                       <text x="125" y="115" text-anchor="middle" fill="#999" font-size="10">RIGHT</text>`,
      }

      this.fallbackOverlayPositions = {
        front: { top: '28%', left: '50%', width: '55%', maxWidth: '110px' },
        back: { top: '28%', left: '50%', width: '55%', maxWidth: '110px' },
        left_sleeve: { top: '45%', left: '50%', width: '35%', maxWidth: '50px' },
        right_sleeve: { top: '45%', left: '50%', width: '35%', maxWidth: '50px' },
      }

      container.innerHTML = `
        <div class="ul-3d-fallback-notice">
          <span>📱 2D Preview Mode</span>
        </div>
        <div class="ul-fallback-image-container">
          <svg class="ul-fallback-tshirt" id="ul-fallback-svg" viewBox="0 0 200 240" fill="currentColor">
            ${this.fallbackSvgPaths.front}
          </svg>
          <div class="ul-fallback-design-overlay" id="ul-fallback-design"></div>
        </div>
        <div class="ul-fallback-view-tabs">
          <button type="button" class="ul-fallback-view-tab active" data-view="front">Front</button>
          <button type="button" class="ul-fallback-view-tab" data-view="back">Back</button>
        </div>
      `

      const step2_3d = document.querySelector('.ul-step2-3d')
      if (step2_3d) {
        step2_3d.appendChild(container)
      }

      container.querySelectorAll('.ul-fallback-view-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
          container
            .querySelectorAll('.ul-fallback-view-tab')
            .forEach((t) => t.classList.remove('active'))
          tab.classList.add('active')
          this.step2.activeLocation = tab.dataset.view
          this.updateFallback2D()
        })
      })

      return container
    },

    updateFallback2D() {
      const designEl = document.getElementById('ul-fallback-design')
      const fallbackSvg = document.getElementById('ul-fallback-svg')

      if (!designEl) return

      const activeView = this.step2.activeLocation || 'front'

      if (fallbackSvg && this.fallbackSvgPaths) {

        const coloredPath = (
          this.fallbackSvgPaths[activeView] || this.fallbackSvgPaths.front
        ).replace(/fill="[^"]*"/g, `fill="${this.step2.tshirtColor}"`)
        fallbackSvg.innerHTML = coloredPath
      }

      const designUrl = this.step1.useInheritedDesign
        ? this.inheritedDesign.blobUrl || this.inheritedDesign.thumbnailUrl
        : this.step1.newUpload?.blobUrl || this.step1.newUpload?.thumbnailUrl || ''

      if (designUrl) {
        designEl.style.backgroundImage = `url(${designUrl})`
        designEl.style.display = 'block'

        const positions =
          this.fallbackOverlayPositions?.[activeView] || this.fallbackOverlayPositions?.front
        if (positions) {
          designEl.style.top = positions.top
          designEl.style.left = positions.left
          designEl.style.width = positions.width
          designEl.style.maxWidth = positions.maxWidth
        }

        const loc = this.step2.locations[activeView]
        if (loc && loc.enabled) {
          const scale = (loc.scale || 100) / 100
          const x = (loc.positionX || 0) / 2
          const y = (loc.positionY || 0) / 2
          designEl.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(${scale})`
        } else {
          designEl.style.display = 'none'
        }
      } else {
        designEl.style.display = 'none'
      }
    },

    async loadProductVariants() {
      const tshirtConfig = this.config.tshirtConfig

      if (tshirtConfig?.tshirtProductHandle) {
        const tshirtHandle = tshirtConfig.tshirtProductHandle

        try {
          const response = await fetch(`/products/${tshirtHandle}.js`)

          if (response.ok) {
            const product = await response.json()

            this.product.id = product.id
            this.product.title = product.title
            this.product.handle = product.handle
            this.product.variants = product.variants || []

            const availableColors = new Set()
            const availableSizes = new Set()

            product.variants.forEach((variant) => {
              if (variant.available !== false) {
                ;[variant.option1, variant.option2, variant.option3].forEach((opt) => {
                  if (opt) {
                    if (this.isSizeValue(opt)) {
                      availableSizes.add(opt)
                    } else {
                      availableColors.add(opt)
                    }
                  }
                })
              }
            })

            if (availableColors.size > 0) {
              this.product.colors = Array.from(availableColors).map((name) => ({
                name,
                hex: this.getColorHex(name),
              }))
              console.log('[ULTShirtModal] Colors from available variants:', availableColors.size)
            } else if (tshirtConfig.colorValues?.length > 0) {
              console.warn(
                '[ULTShirtModal] Using config colors - no available variants with colors found'
              )
              this.product.colors = tshirtConfig.colorValues.map((name) => ({
                name,
                hex: this.getColorHex(name),
              }))
            }

            if (availableSizes.size > 0) {
              this.product.sizes = Array.from(availableSizes)
              console.log('[ULTShirtModal] Sizes from available variants:', availableSizes.size)
            } else if (tshirtConfig.sizeValues?.length > 0) {
              console.warn(
                '[ULTShirtModal] Using config sizes - no available variants with sizes found'
              )
              this.product.sizes = tshirtConfig.sizeValues
            }

            if (tshirtConfig.positions?.length > 0) {
              this.config.allowedPositions = tshirtConfig.positions
              this.applyAllowedLocations()
            }

            console.log(
              '[ULTShirtModal] Loaded T-Shirt product:',
              product.title,
              '| Colors:',
              this.product.colors.length,
              '| Sizes:',
              this.product.sizes.length,
              '| Variants:',
              product.variants.length,
              '| Allowed Positions:',
              this.config.allowedPositions
            )
            return
          }
        } catch (error) {
          console.warn('[ULTShirtModal] Could not fetch configured T-Shirt product:', error)
        }
      }

      const fallbackHandles = ['basic-tshirt', 'tshirt', 't-shirt', 'custom-tshirt', 'blank-tshirt']

      for (const handle of fallbackHandles) {
        try {
          const response = await fetch(`/products/${handle}.js`)
          if (response.ok) {
            const product = await response.json()
            this.product.id = product.id
            this.product.title = product.title
            this.product.handle = product.handle
            this.product.variants = product.variants || []

            const colorSet = new Set()
            const sizeSet = new Set()

            product.variants.forEach((variant) => {
              if (variant.option1) {
                if (this.isSizeValue(variant.option1)) sizeSet.add(variant.option1)
                else colorSet.add(variant.option1)
              }
              if (variant.option2) {
                if (this.isSizeValue(variant.option2)) sizeSet.add(variant.option2)
                else colorSet.add(variant.option2)
              }
            })

            if (colorSet.size > 0) {
              this.product.colors = Array.from(colorSet).map((name) => ({
                name,
                hex: this.getColorHex(name),
              }))
            }

            if (sizeSet.size > 0) {
              this.product.sizes = Array.from(sizeSet)
            }

            console.log('[ULTShirtModal] Found T-Shirt product via fallback:', product.title)
            return
          }
        } catch (error) {
        }
      }

      console.error(
        '[ULTShirtModal] CRITICAL: No T-Shirt product found! Cannot proceed without product configuration.'
      )

      this.product.variants = []

      this.showConfigurationError()
    },

    showConfigurationError() {
      console.log('[ULTShirtModal] Showing configuration error screen')

      const overlay = document.querySelector('.ul-tshirt-modal')
      if (overlay) {
        overlay.classList.add('error-state')
      }

      const content = document.querySelector('.ul-modal-content')
      if (content) {
        content.innerHTML = `
          <div class="ul-config-error">
            <button type="button" class="ul-modal-close" onclick="window.ULTShirtModal.close()">×</button>
            <div class="ul-error-icon">⚠️</div>
            <h2>Configuration Required</h2>
            <p>The upload studio hasn't been set up yet for this store.</p>
            <p class="ul-error-detail">Please contact the store owner to configure the T-Shirt product in the admin panel.</p>
            <button type="button" onclick="window.ULTShirtModal.close()" class="ul-btn ul-btn-primary">
              Close
            </button>
          </div>
          <style>
            .ul-config-error {
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              padding: 60px 40px;
              text-align: center;
              min-height: 400px;
            }
            .ul-config-error .ul-error-icon {
              font-size: 64px;
              margin-bottom: 20px;
            }
            .ul-config-error h2 {
              font-size: 24px;
              margin: 0 0 16px 0;
              color: #333;
            }
            .ul-config-error p {
              font-size: 16px;
              color: #666;
              margin: 0 0 12px 0;
              max-width: 400px;
            }
            .ul-config-error .ul-error-detail {
              font-size: 14px;
              color: #999;
            }
            .ul-config-error .ul-btn {
              margin-top: 24px;
              padding: 12px 32px;
              font-size: 16px;
            }
            .ul-config-error .ul-modal-close {
              position: absolute;
              top: 16px;
              right: 16px;
              background: none;
              border: none;
              font-size: 28px;
              cursor: pointer;
              color: #666;
            }
          </style>
        `
      }

      if (window.ULAnalytics) {
        window.ULAnalytics.trackError({
          code: 'TSHIRT_NOT_CONFIGURED',
          step: 'loadProductVariants',
          productId: this.product.id || 'unknown',
          shopDomain: this.shopDomain || 'unknown',
        })
      }

      this.step1.configurationError = true
    },

    isSizeValue(value) {
      const sizes = [
        'xs',
        's',
        'm',
        'l',
        'xl',
        '2xl',
        '3xl',
        'xxl',
        'xxxl',
        'small',
        'medium',
        'large',
        'x-large',
        'xx-large',
      ]
      return sizes.includes(value.toLowerCase().trim())
    },

    getColorHex(colorName) {
      const colorMap = {
        white: '#ffffff',
        black: '#1a1a1a',
        navy: '#1e3a5f',
        red: '#dc2626',
        blue: '#3b82f6',
        green: '#22c55e',
        gray: '#6b7280',
        grey: '#6b7280',
        pink: '#ec4899',
        yellow: '#eab308',
        orange: '#f97316',
        purple: '#a855f7',
        brown: '#78350f',
        beige: '#d4c4a8',
        cream: '#fffdd0',
        maroon: '#800000',
        teal: '#14b8a6',
        olive: '#808000',
        coral: '#ff7f50',
        mint: '#98ff98',
        lavender: '#e6e6fa',
        burgundy: '#800020',
        charcoal: '#36454f',
        sand: '#c2b280',
        'sky blue': '#87ceeb',
        'forest green': '#228b22',
        'royal blue': '#4169e1',
        'heather gray': '#9a9a9a',
        'heather grey': '#9a9a9a',
      }

      const normalized = colorName.toLowerCase().trim()
      return colorMap[normalized] || '#cccccc'
    },

    getShopDomain() {
      const sources = [
        this.shopDomain,
        window.Shopify?.shop,
        document.querySelector('[data-shop-domain]')?.dataset?.shopDomain,
        document.querySelector('meta[name="shopify-shop"]')?.content,
        window.ulConfig?.shopDomain,
        window.location.hostname.includes('.myshopify.com') ? window.location.hostname : null,
      ]

      for (const source of sources) {
        if (
          source &&
          typeof source === 'string' &&
          source !== 'unknown' &&
          source.includes('.myshopify.com')
        ) {
          console.log('[ULTShirtModal] getShopDomain: Found myshopify domain:', source)
          return source
        }
      }

      for (const source of sources) {
        if (
          source &&
          typeof source === 'string' &&
          source !== 'unknown' &&
          source.length > 3 &&
          source.includes('.')
        ) {
          console.log('[ULTShirtModal] getShopDomain: Found custom domain:', source)
          return source
        }
      }

      console.error('[ULTShirtModal] getShopDomain: No valid shop domain found')
      return null
    },

    findMatchingVariant(color, size) {
      const variants = this.product.variants || []

      const sizeNormalize = {
        xs: ['xs', 'x-small', 'extra-small', 'extra small', 'xsmall'],
        s: ['s', 'sm', 'small'],
        m: ['m', 'md', 'medium', 'med'],
        l: ['l', 'lg', 'large'],
        xl: ['xl', 'x-large', 'extra-large', 'extra large', 'xlarge'],
        '2xl': ['2xl', 'xxl', 'xx-large', '2x', '2xlarge'],
        '3xl': ['3xl', 'xxxl', 'xxx-large', '3x', '3xlarge'],
        '4xl': ['4xl', 'xxxxl', '4x', '4xlarge'],
        36: ['36'],
        38: ['38'],
        40: ['40'],
        42: ['42'],
        44: ['44'],
        46: ['46'],
        48: ['48'],
        6: ['6'],
        8: ['8'],
        10: ['10'],
        12: ['12'],
        14: ['14'],
        16: ['16'],
      }

      const colorNormalize = {
        white: ['white', 'beyaz', 'weiß', 'weiss', 'blanco', 'bianco', 'blanc'],
        black: ['black', 'siyah', 'schwarz', 'negro', 'nero', 'noir'],
        red: ['red', 'kırmızı', 'kirmizi', 'rot', 'rojo', 'rosso', 'rouge'],
        blue: ['blue', 'mavi', 'blau', 'azul', 'blu', 'bleu'],
        navy: ['navy', 'lacivert', 'marine', 'navy blue', 'dark blue'],
        green: ['green', 'yeşil', 'yesil', 'grün', 'grun', 'verde', 'vert'],
        gray: ['gray', 'grey', 'gri', 'grau', 'gris', 'grigio'],
        pink: ['pink', 'pembe', 'rosa', 'rose'],
        yellow: ['yellow', 'sarı', 'sari', 'gelb', 'amarillo', 'giallo', 'jaune'],
        orange: ['orange', 'turuncu', 'naranja', 'arancione'],
        purple: ['purple', 'mor', 'lila', 'violett', 'morado', 'viola', 'violet'],
        brown: ['brown', 'kahverengi', 'braun', 'marrón', 'marron', 'marrone', 'brun'],
        beige: ['beige', 'bej', 'creme'],
        cream: ['cream', 'krem', 'creme'],
        burgundy: ['burgundy', 'bordo', 'bordeaux', 'wine'],
        teal: ['teal', 'petrol', 'türkis', 'turkis'],
        coral: ['coral', 'mercan', 'koralle'],
        mint: ['mint', 'nane', 'menthe'],
        lavender: ['lavender', 'lavanta'],
        charcoal: ['charcoal', 'antrasit', 'anthrazit'],
      }

      const normalizeValue = (value, map) => {
        if (!value) return ''
        const lower = value.toLowerCase().trim()
        for (const [key, aliases] of Object.entries(map)) {
          if (aliases.includes(lower) || aliases.some((a) => lower === a)) {
            return key
          }
        }
        return lower
      }

      const targetSize = normalizeValue(size, sizeNormalize)
      const targetColor = normalizeValue(color, colorNormalize)

      console.log('[ULTShirtModal] findMatchingVariant - Looking for:', { targetColor, targetSize })

      let match = variants.find((v) => {
        if (v.available === false) return false

        const opt1 = (v.option1 || '').toLowerCase().trim()
        const opt2 = (v.option2 || '').toLowerCase().trim()
        const opt3 = (v.option3 || '').toLowerCase().trim()

        const opt1SizeNorm = normalizeValue(opt1, sizeNormalize)
        const opt2SizeNorm = normalizeValue(opt2, sizeNormalize)
        const opt3SizeNorm = normalizeValue(opt3, sizeNormalize)

        const opt1ColorNorm = normalizeValue(opt1, colorNormalize)
        const opt2ColorNorm = normalizeValue(opt2, colorNormalize)
        const opt3ColorNorm = normalizeValue(opt3, colorNormalize)

        const sizeMatch =
          opt1SizeNorm === targetSize || opt2SizeNorm === targetSize || opt3SizeNorm === targetSize
        const colorMatch =
          opt1ColorNorm === targetColor ||
          opt2ColorNorm === targetColor ||
          opt3ColorNorm === targetColor

        return sizeMatch && colorMatch
      })

      if (match) {
        console.log('[ULTShirtModal] findMatchingVariant - Found exact match:', match.title)
        return match
      }

      match = variants.find((v) => {
        if (v.available === false) return false

        const opt1SizeNorm = normalizeValue(v.option1, sizeNormalize)
        const opt2SizeNorm = normalizeValue(v.option2, sizeNormalize)
        const opt3SizeNorm = normalizeValue(v.option3, sizeNormalize)

        return (
          opt1SizeNorm === targetSize || opt2SizeNorm === targetSize || opt3SizeNorm === targetSize
        )
      })

      if (match) {
        console.log('[ULTShirtModal] findMatchingVariant - Found size-only match:', match.title)
        return match
      }

      match = variants.find((v) => v.available !== false)

      if (match) {
        console.log(
          '[ULTShirtModal] findMatchingVariant - Using first available variant:',
          match.title
        )
        return match
      }

      console.warn(
        '[ULTShirtModal] findMatchingVariant - No available variants, using first:',
        variants[0]?.title
      )
      return variants[0] || null
    },

    renderColors() {
      if (!this.el.colorGrid) return

      this.el.colorGrid.innerHTML = ''

      this.product.colors.forEach((color, idx) => {
        const swatch = document.createElement('button')
        swatch.type = 'button'
        swatch.className = 'ul-color-swatch' + (idx === 0 ? ' active' : '')
        swatch.style.backgroundColor = color.hex
        swatch.title = color.name

        if (this.isLightColor(color.hex)) {
          swatch.classList.add('light')
        }

        swatch.addEventListener('click', () => this.setColor(color.name, color.hex))
        this.el.colorGrid.appendChild(swatch)
      })
    },

    renderSizes() {
      if (!this.el.sizeSelect) return

      this.el.sizeSelect.innerHTML = ''

      this.product.sizes.forEach((size) => {
        const option = document.createElement('option')
        option.value = size
        option.textContent = size
        if (size === this.step2.tshirtSize) {
          option.selected = true
        }
        this.el.sizeSelect.appendChild(option)
      })
    },

    setColor(name, hex) {
      const previousColor = this.step2.tshirtColorName
      this.step2.tshirtColor = hex
      this.step2.tshirtColorName = name

      if (window.ULState) {
        window.ULState.set('tshirt.color', { name, hex })
      }

      if (window.ULEvents) {
        window.ULEvents.emit('colorChange', { name, hex })
      }

      if (window.ULAnalytics && previousColor !== name) {
        window.ULAnalytics.trackTShirtColorChanged({
          colorName: name,
          colorHex: hex,
          previousColor,
        })
      }

      this.el.colorGrid?.querySelectorAll('.ul-color-swatch').forEach((s) => {
        s.classList.toggle('active', s.title === name)
      })

      if (this.supports3D()) {
        this.update3DColor(hex)
      } else {
        this.updateFallback2D()
      }
    },

    setSize(size) {
      const previousSize = this.step2.tshirtSize
      const previousPrice = this.step2.calculatedPrice
      this.step2.tshirtSize = size

      if (window.ULState) {
        window.ULState.set('tshirt.size', size)
      }

      if (window.ULEvents) {
        window.ULEvents.emit('sizeChange', { size })
      }

      this.calculatePrice()

      if (window.ULAnalytics && previousSize !== size) {
        window.ULAnalytics.trackTShirtSizeChanged({
          size,
          previousSize,
          priceDiff: this.step2.calculatedPrice - previousPrice,
        })
      }
    },

    toggleLocation(locationId) {
      const loc = this.step2.locations[locationId]
      if (!loc) return

      loc.enabled = !loc.enabled

      if (window.ULState) {
        window.ULState.set(`tshirt.locations.${locationId}.enabled`, loc.enabled)
      }

      if (window.ULEvents) {
        window.ULEvents.emit('locationToggle', { locationId, enabled: loc.enabled })
      }

      if (window.ULAnalytics) {
        window.ULAnalytics.trackTShirtLocationToggled({
          location: locationId,
          enabled: loc.enabled,
          totalLocations: this.getEnabledLocations().length,
        })
      }

      const item = document.querySelector(`.ul-location-item[data-location="${locationId}"]`)
      item?.classList.toggle('selected', loc.enabled)

      if (loc.enabled) {
        this.setActiveLocation(locationId)
      }

      if (this.supports3D()) {
        this.update3DDecal(locationId, loc.enabled)
      } else {
        this.updateFallback2D()
      }

      this.calculatePrice()

      this.updateNavButtons()
    },

    setActiveLocation(locationId) {
      this.step2.activeLocation = locationId

      if (window.ULState) {
        window.ULState.set('tshirt.activeLocation', locationId)
      }

      this.updateLocationSettingsUI()

      this.setQuickView(
        locationId.replace('_sleeve', '').replace('left', 'left').replace('right', 'right')
      )
    },

    selectLocation(locationId) {
      if (this.step2.locations[locationId] && !this.step2.locations[locationId].enabled) {
        this.step2.locations[locationId].enabled = true
      }

      this.setActiveLocation(locationId)

      const checkbox = document.querySelector(
        `.ul-location-checkbox[data-location="${locationId}"]`
      )
      if (checkbox) {
        checkbox.checked = true
      }

      const item = document.querySelector(`.ul-location-item[data-location="${locationId}"]`)
      if (item) {
        item.classList.add('selected')
      }

      if (this.supports3D()) {
        this.update3DDecal(locationId, true)
      } else {
        this.updateFallback2D()
      }

      console.log('[ULTShirtModal] selectLocation:', locationId)
    },

    updateLocationSettingsUI() {
      const loc = this.step2.locations[this.step2.activeLocation]
      if (!loc) return

      const nameMap = {
        front: 'Front',
        back: 'Back',
        left_sleeve: 'Left Sleeve',
        right_sleeve: 'Right Sleeve',
      }

      if (this.el.settingsLocationName) {
        this.el.settingsLocationName.textContent =
          nameMap[this.step2.activeLocation] || this.step2.activeLocation
      }

      if (this.el.scaleSlider) this.el.scaleSlider.value = loc.scale
      if (this.el.scaleValue) this.el.scaleValue.textContent = `${loc.scale}%`

      if (this.el.posXSlider) this.el.posXSlider.value = loc.positionX
      if (this.el.posXValue) this.el.posXValue.textContent = loc.positionX

      if (this.el.posYSlider) this.el.posYSlider.value = loc.positionY
      if (this.el.posYValue) this.el.posYValue.textContent = loc.positionY

      if (this.el.locationSettings) {
        this.el.locationSettings.classList.toggle('visible', loc.enabled)
      }
    },

    applyAllowedLocations() {
      const allowed = this.config.allowedPositions || [
        'front',
        'back',
        'left_sleeve',
        'right_sleeve',
      ]
      const allLocations = ['front', 'back', 'left_sleeve', 'right_sleeve']

      allLocations.forEach((loc) => {
        const item = document.querySelector(`.ul-location-item[data-location="${loc}"]`)
        if (item) {
          if (allowed.includes(loc)) {
            item.style.display = ''
          } else {
            item.style.display = 'none'
            if (this.step2.locations[loc]) {
              this.step2.locations[loc].enabled = false
            }
          }
        }
      })

      const firstAllowed = allowed[0] || 'front'
      if (!allowed.includes(this.step2.activeLocation)) {
        this.step2.activeLocation = firstAllowed
        this.step2.locations[firstAllowed].enabled = true
        this.selectLocation(firstAllowed)
      }

      console.log('[ULTShirtModal] Applied allowed locations:', allowed)
    },

    setLocationScale(value) {
      const loc = this.step2.locations[this.step2.activeLocation]
      if (!loc) return

      loc.scale = parseInt(value)
      if (this.el.scaleValue) this.el.scaleValue.textContent = `${value}%`

      if (this.supports3D()) {
        this.debouncedUpdateDecal()
      } else {
        this.updateFallback2D()
      }
    },

    setLocationPosX(value) {
      const loc = this.step2.locations[this.step2.activeLocation]
      if (!loc) return

      loc.positionX = parseInt(value)
      if (this.el.posXValue) this.el.posXValue.textContent = value

      if (this.supports3D()) {
        this.debouncedUpdateDecal()
      } else {
        this.updateFallback2D()
      }
    },

    setLocationPosY(value) {
      const loc = this.step2.locations[this.step2.activeLocation]
      if (!loc) return

      loc.positionY = parseInt(value)
      if (this.el.posYValue) this.el.posYValue.textContent = value

      if (this.supports3D()) {
        this.debouncedUpdateDecal()
      } else {
        this.updateFallback2D()
      }
    },

    debouncedUpdateDecal() {
      if (this._decalUpdateTimeout) {
        clearTimeout(this._decalUpdateTimeout)
      }

      this._decalUpdateTimeout = setTimeout(() => {
        this.updateBakedTexture()
      }, 50)
    },

    DEBUG_UV_GRID: false, // DISABLED for production

    drawDebugGrid() {
      if (!this.DEBUG_UV_GRID || !this.textureCtx) return

      const ctx = this.textureCtx
      const size = this.baseTextureSize
      const gridSize = 10
      const cellSize = size / gridSize

      ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)'
      ctx.lineWidth = 4

      for (let i = 0; i <= gridSize; i++) {
        ctx.beginPath()
        ctx.moveTo(i * cellSize, 0)
        ctx.lineTo(i * cellSize, size)
        ctx.stroke()

        ctx.beginPath()
        ctx.moveTo(0, i * cellSize)
        ctx.lineTo(size, i * cellSize)
        ctx.stroke()
      }

      ctx.font = 'bold 80px Arial'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      for (let row = 0; row < gridSize; row++) {
        for (let col = 0; col < gridSize; col++) {
          const x = col * cellSize + cellSize / 2
          const y = row * cellSize + cellSize / 2

          const u = (col + 0.5) / gridSize
          const v = (row + 0.5) / gridSize

          ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'
          ctx.fillRect(x - 60, y - 40, 120, 80)

          ctx.fillStyle = 'rgba(0, 0, 0, 0.9)'
          ctx.fillText(`${row},${col}`, x, y)
        }
      }

      ctx.font = 'bold 60px Arial'
      ctx.fillStyle = 'blue'

      ctx.fillText('U0,V0', 100, 50)
      ctx.fillText('U1,V0', size - 100, 50)
      ctx.fillText('U0,V1', 100, size - 50)
      ctx.fillText('U1,V1', size - 100, size - 50)

      console.log('[ULTShirtModal] Debug UV grid drawn - look for cell numbers on t-shirt')
      console.log('[ULTShirtModal] Grid format: row,col where row=V*10, col=U*10')
    },

    loadDecalImage(url) {
      return new Promise((resolve, reject) => {
        const img = new Image()

        if (!url.startsWith('blob:')) {
          img.crossOrigin = 'anonymous'
        }

        img.onload = () => {
          console.log('[ULTShirtModal] Decal image loaded:', img.width, 'x', img.height)
          this.decalImage = img
          resolve(img)
        }

        img.onerror = (err) => {
          console.error('[ULTShirtModal] Failed to load decal image:', err)
          reject(err)
        }

        img.src = url
      })
    },

    updateBakedTexture() {
      const updateId = ++this.textureUpdateId

      if (!this.textureCtx) {
        console.log('[ULTShirtModal] No texture context')
        return
      }

      const ctx = this.textureCtx
      const size = this.baseTextureSize

      console.log('[ULTShirtModal] Updating baked texture... (updateId:', updateId, ')')

      ctx.fillStyle = this.step2.tshirtColor
      ctx.fillRect(0, 0, size, size)

      this.drawDebugGrid()

      if (this.decalImage) {
        Object.entries(this.step2.locations).forEach(([locationId, loc]) => {
          if (loc.enabled) {
            this.drawDecalToTexture(locationId, loc)
          }
        })
      }

      if (updateId !== this.textureUpdateId) {
        console.log(
          '[ULTShirtModal] Texture update cancelled - newer update pending (updateId:',
          updateId,
          'current:',
          this.textureUpdateId,
          ')'
        )
        return
      }

      this.applyBakedTextureToMesh()

      console.log('[ULTShirtModal] Baked texture updated')
    },

    drawDecalToTexture(locationId, locSettings) {
      const ctx = this.textureCtx
      const size = this.baseTextureSize
      const region = this.UV_REGIONS[locationId]

      if (!region || !this.decalImage) {
        console.log('[ULTShirtModal] No region or decal for:', locationId)
        return
      }

      const regionWidth = (region.bounds.uMax - region.bounds.uMin) * size
      const regionHeight = (region.bounds.vMax - region.bounds.vMin) * size

      const scaleMultiplier = (locSettings.scale || 100) / 100
      const defaultSize = region.defaultSize * scaleMultiplier

      const aspectRatio = this.decalImage.width / this.decalImage.height
      let decalWidth, decalHeight

      if (aspectRatio > 1) {
        decalWidth = regionWidth * defaultSize
        decalHeight = decalWidth / aspectRatio
      } else {
        decalHeight = regionHeight * defaultSize
        decalWidth = decalHeight * aspectRatio
      }

      const offsetX = ((locSettings.positionX || 0) / 100) * regionWidth * 0.5
      const offsetY = ((locSettings.positionY || 0) / 100) * regionHeight * 0.5

      const centerX = region.center.u * size + offsetX
      const centerY = (1 - region.center.v) * size + offsetY

      const drawX = centerX - decalWidth / 2
      const drawY = centerY - decalHeight / 2

      console.log(`[ULTShirtModal] Drawing decal at ${locationId}:`, {
        x: Math.round(drawX),
        y: Math.round(drawY),
        w: Math.round(decalWidth),
        h: Math.round(decalHeight),
      })

      ctx.save()

      ctx.translate(centerX, centerY)
      ctx.scale(-1, -1)
      ctx.drawImage(this.decalImage, -decalWidth / 2, -decalHeight / 2, decalWidth, decalHeight)

      ctx.restore()
    },

    applyBakedTextureToMesh() {
      if (!this.three.tshirtMesh || typeof THREE === 'undefined') {
        console.log('[ULTShirtModal] No mesh or THREE not loaded')
        return
      }

      const texture = new THREE.CanvasTexture(this.textureCanvas)
      texture.flipY = true
      texture.needsUpdate = true

      if (texture.colorSpace !== undefined) {
        texture.colorSpace = THREE.SRGBColorSpace
      }

      const target = this.three.tshirtModel || this.three.tshirtMesh

      if (target.traverse) {
        target.traverse((child) => {
          if (child.isMesh && child.material) {
            if (child.material.map && child.material.map !== texture) {
              child.material.map.dispose()
            }

            child.material.map = texture
            child.material.needsUpdate = true
          }
        })
      } else if (target.material) {
        target.material.map = texture
        target.material.needsUpdate = true
      }

      console.log('[ULTShirtModal] Baked texture applied to mesh')
    },

    getEnabledLocations() {
      return Object.entries(this.step2.locations)
        .filter(([_, loc]) => loc.enabled)
        .map(([id, _]) => id)
    },

    calculatePrice() {
      let total = this.step2.basePrice

      const enabledLocs = this.getEnabledLocations()
      let locationTotal = 0
      enabledLocs.forEach((locId, idx) => {
        if (idx > 0) {
          locationTotal += this.step2.locations[locId].price
        }
      })

      const sizeModifier = this.config.sizePricing[this.step2.tshirtSize] || 0

      total += locationTotal + sizeModifier
      this.step2.calculatedPrice = total

      if (this.el.priceBase) this.el.priceBase.textContent = `$${this.step2.basePrice.toFixed(2)}`

      if (locationTotal > 0) {
        if (this.el.priceLocationsRow) this.el.priceLocationsRow.style.display = ''
        if (this.el.priceLocations)
          this.el.priceLocations.textContent = `+$${locationTotal.toFixed(2)}`
      } else {
        if (this.el.priceLocationsRow) this.el.priceLocationsRow.style.display = 'none'
      }

      if (sizeModifier > 0) {
        if (this.el.priceSizeRow) this.el.priceSizeRow.style.display = ''
        if (this.el.priceSize) this.el.priceSize.textContent = `+$${sizeModifier.toFixed(2)}`
      } else {
        if (this.el.priceSizeRow) this.el.priceSizeRow.style.display = 'none'
      }

      if (this.el.priceTotal) this.el.priceTotal.textContent = `$${total.toFixed(2)}`
    },

    setQuickView(view) {
      this.el.quickViewBtns?.forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.view === view)
      })

      this.moveCamera(view)
    },

    async init3D() {
      if (typeof THREE === 'undefined') {
        console.warn('[ULTShirtModal] Three.js not loaded, showing 2D fallback')

        if (window.ULErrorHandler) {
          window.ULErrorHandler.show('THREE_WEBGL_NOT_SUPPORTED')
        }

        this.show2DFallback()
        return
      }

      const canvas = this.el.canvas
      if (!canvas) return

      const container = canvas.parentElement
      const width = container.clientWidth
      const height = container.clientHeight

      try {
        this.three.scene = new THREE.Scene()
        this.three.scene.background = new THREE.Color(0xf0f0f0)

        this.three.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000)
        this.three.camera.position.set(0, 0, 3)

        this.three.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
        this.three.renderer.setSize(width, height)
        this.three.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

        const ambient = new THREE.AmbientLight(0xffffff, 0.6)
        this.three.scene.add(ambient)

        const dir1 = new THREE.DirectionalLight(0xffffff, 0.8)
        dir1.position.set(5, 5, 5)
        this.three.scene.add(dir1)

        const dir2 = new THREE.DirectionalLight(0xffffff, 0.3)
        dir2.position.set(-5, 5, -5)
        this.three.scene.add(dir2)

        await this.createTShirtMesh()

        await this.applyDesignTexture()

        if (this.el.loading3d) this.el.loading3d.style.display = 'none'

        this.setupMouseDragRotation(canvas)

        this.animate3D()
      } catch (error) {
        console.error('[ULTShirtModal] 3D init error:', error)

        if (window.ULErrorHandler) {
          window.ULErrorHandler.show('THREE_MODEL_LOAD_FAILED')
        }

        this.show2DFallback()
      }
    },

    async createTShirtMesh() {
      const color = parseInt(this.step2.tshirtColor.replace('#', '0x'))

      const waitForGLTFLoader = () => {
        return new Promise((resolve) => {
          let attempts = 0
          const check = () => {
            if (typeof THREE !== 'undefined' && typeof THREE.GLTFLoader !== 'undefined') {
              resolve(true)
            } else if (attempts < 50) {
              attempts++
              setTimeout(check, 50)
            } else {
              resolve(false)
            }
          }
          check()
        })
      }

      const glTFLoaderReady = await waitForGLTFLoader()

      if (glTFLoaderReady) {
        return new Promise((resolve) => {
          const loader = new THREE.GLTFLoader()
          const glbUrl = window.UL_TSHIRT_GLB_URL || '/apps/customizer/shirt_baked.glb'

          console.log('[ULTShirtModal] Loading GLB model from:', glbUrl)

          loader.load(
            glbUrl,
            (gltf) => {
              console.log('[ULTShirtModal] GLB model loaded successfully')

              this.three.tshirtModel = gltf.scene

              let actualMesh = null
              this.three.tshirtModel.traverse((child) => {
                if (child.isMesh) {
                  child.material = new THREE.MeshStandardMaterial({
                    color: color,
                    roughness: 0.8,
                    metalness: 0.0,
                    side: THREE.DoubleSide,
                  })
                  if (!actualMesh) {
                    actualMesh = child
                    console.log('[ULTShirtModal] Found T-shirt mesh:', child.name)
                  }
                }
              })

              this.three.tshirtMesh = actualMesh || this.three.tshirtModel

              this.three.tshirtModel.scale.set(2, 2, 2)
              this.three.tshirtModel.position.set(0, 0.1, 0)

              this.three.scene.add(this.three.tshirtModel)
              resolve()
            },
            (progress) => {
              if (progress.total) {
                const pct = Math.round((progress.loaded / progress.total) * 100)
                console.log('[ULTShirtModal] GLB loading:', pct + '%')
              }
            },
            (error) => {
              console.warn('[ULTShirtModal] GLB load failed, using fallback plane:', error)
              this.createFallbackPlane(color)
              resolve()
            }
          )
        })
      } else {
        console.log('[ULTShirtModal] GLTFLoader not available after waiting, using fallback plane')
        this.createFallbackPlane(color)
      }
    },

    createFallbackPlane(color) {
      const geometry = new THREE.PlaneGeometry(2, 2.8)
      const material = new THREE.MeshStandardMaterial({
        color: color,
        side: THREE.DoubleSide,
        roughness: 0.8,
      })

      this.three.tshirtMesh = new THREE.Mesh(geometry, material)
      this.three.scene.add(this.three.tshirtMesh)
    },

    async applyDesignTexture() {
      let designUrl

      if (this.step1.useInheritedDesign) {
        designUrl = this.inheritedDesign.blobUrl || this.inheritedDesign.thumbnailUrl
      } else {
        designUrl = this.step1.newUpload.blobUrl || this.step1.newUpload.thumbnailUrl
      }

      console.log(
        '[ULTShirtModal] Applying design texture (Texture Baking):',
        designUrl ? designUrl.substring(0, 50) + '...' : 'none'
      )

      if (!designUrl) {
        console.log('[ULTShirtModal] No design URL available')
        this.updateBakedTexture()
        return
      }

      try {
        await this.loadDecalImage(designUrl)
        console.log('[ULTShirtModal] Decal image loaded, updating baked texture...')

        this.updateBakedTexture()
      } catch (error) {
        console.error('[ULTShirtModal] Failed to load decal image:', error)

        try {
          const res = await fetch(designUrl, { mode: 'cors', credentials: 'omit' })
          if (!res.ok) throw new Error('Fetch failed: ' + res.status)

          const blob = await res.blob()
          const bitmap = await createImageBitmap(blob)

          const canvas = document.createElement('canvas')
          canvas.width = bitmap.width
          canvas.height = bitmap.height
          const ctx = canvas.getContext('2d')
          ctx.drawImage(bitmap, 0, 0)

          const img = new Image()
          img.src = canvas.toDataURL()
          await new Promise((resolve) => (img.onload = resolve))

          this.decalImage = img
          this.updateBakedTexture()
          console.log('[ULTShirtModal] Texture baking via fetch fallback successful')
        } catch (fetchErr) {
          console.error('[ULTShirtModal] Fetch fallback failed:', fetchErr.message)
          if (window.ULErrorHandler) {
            window.ULErrorHandler.show('THREE_TEXTURE_FAILED')
          }
          this.updateBakedTexture()
        }
      }
    },

    createDecalFromTexture(texture) {
      console.log('[ULTShirtModal] createDecalFromTexture called - using Texture Baking instead')
      this.currentTexture = texture
    },

    createDecalForLocation(texture, locationId, targetMesh) {
      console.log('[ULTShirtModal] createDecalForLocation called - using Texture Baking instead')
    },

    update3DColor(hex) {
      this.updateBakedTexture()
    },

    update3DDecal(locationId, enabled) {
      this.updateBakedTexture()
    },

    update3DDecalTransform() {
      this.updateBakedTexture()
    },

    moveCamera(view) {
      if (!this.three.camera) return

      const positions = {
        front: { x: 0, y: 0, z: 3 },
        back: { x: 0, y: 0, z: -3 },
        left: { x: -3, y: 0, z: 0 },
        right: { x: 3, y: 0, z: 0 },
      }

      const pos = positions[view] || positions.front

      this.three.camera.position.set(pos.x, pos.y, pos.z)
      this.three.camera.lookAt(0, 0, 0)

      this.three.targetRotationY = 0
      this.three.currentRotationY = 0
      const target = this.three.tshirtModel || this.three.tshirtMesh
      if (target) {
        target.rotation.y = 0
      }
    },

    setupMouseDragRotation(canvas) {
      const self = this

      canvas.addEventListener('mousedown', (e) => {
        self.three.isDragging = true
        self.three.previousMouseX = e.clientX
        canvas.style.cursor = 'grabbing'
      })

      canvas.addEventListener('mousemove', (e) => {
        if (!self.three.isDragging) return

        const deltaX = e.clientX - self.three.previousMouseX
        self.three.previousMouseX = e.clientX

        self.three.targetRotationY += deltaX * 0.01
      })

      canvas.addEventListener('mouseup', () => {
        self.three.isDragging = false
        canvas.style.cursor = 'grab'
      })

      canvas.addEventListener('mouseleave', () => {
        self.three.isDragging = false
        canvas.style.cursor = 'grab'
      })

      canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
          self.three.isDragging = true
          self.three.previousMouseX = e.touches[0].clientX
        }
      })

      canvas.addEventListener(
        'touchmove',
        (e) => {
          if (!self.three.isDragging || e.touches.length !== 1) return

          const deltaX = e.touches[0].clientX - self.three.previousMouseX
          self.three.previousMouseX = e.touches[0].clientX

          self.three.targetRotationY += deltaX * 0.01
          e.preventDefault()
        },
        { passive: false }
      )

      canvas.addEventListener('touchend', () => {
        self.three.isDragging = false
      })

      canvas.style.cursor = 'grab'

      console.log('[ULTShirtModal] Mouse drag rotation enabled')
    },

    animate3D() {
      if (!this.isOpen || this.currentStep !== 2) return

      this.three.animationId = requestAnimationFrame(() => this.animate3D())

      const target = this.three.tshirtModel || this.three.tshirtMesh
      if (target) {
        this.three.currentRotationY +=
          (this.three.targetRotationY - this.three.currentRotationY) * 0.1

        target.rotation.y = this.three.currentRotationY
      }

      this.three.renderer?.render(this.three.scene, this.three.camera)
    },

    show2DFallback() {
      if (this.el.loading3d) {
        this.el.loading3d.innerHTML = `
          <div style="text-align:center;">
            <img src="${this.step1.useInheritedDesign ? this.inheritedDesign.thumbnailUrl : this.step1.newUpload.thumbnailUrl}"
                 style="max-width:80%;max-height:300px;object-fit:contain;" alt="Design preview">
            <div style="margin-top:16px;color:#6b7280;">3D preview not available</div>
          </div>
        `
      }
    },

    cleanup3D() {
      if (this.three.animationId) {
        cancelAnimationFrame(this.three.animationId)
        this.three.animationId = null
      }

      Object.values(this.three.decals).forEach((decal) => {
        if (decal) {
          decal.geometry?.dispose()
          decal.material?.map?.dispose()
          decal.material?.dispose()
        }
      })

      if (this.three.renderer) {
        this.three.renderer.dispose()
      }

      this.currentTexture = null

      this.three = {
        scene: null,
        camera: null,
        renderer: null,
        controls: null,
        tshirtModel: null,
        tshirtMesh: null,
        decals: {},
        animationId: null,
        isDragging: false,
        previousMouseX: 0,
        targetRotationY: 0,
        currentRotationY: 0,
      }
    },

    handleResize() {
      if (!this.three.renderer || !this.three.camera || !this.isOpen) return

      const container = this.el.canvas?.parentElement
      if (!container) return

      const width = container.clientWidth
      const height = container.clientHeight

      this.three.camera.aspect = width / height
      this.three.camera.updateProjectionMatrix()
      this.three.renderer.setSize(width, height)
    },

    initStep3() {
      const enabledLocs = this.getEnabledLocations()
      const locNames = enabledLocs.map((id) => {
        const map = {
          front: 'Front',
          back: 'Back',
          left_sleeve: 'Left Sleeve',
          right_sleeve: 'Right Sleeve',
        }
        return map[id] || id
      })

      if (this.el.detailsTitle) {
        this.el.detailsTitle.textContent = `${this.step2.tshirtColorName} T-Shirt, ${this.step2.tshirtSize}`
      }
      if (this.el.detailsMeta) {
        this.el.detailsMeta.textContent = `Locations: ${locNames.join(', ')} • Subtotal: $${this.step2.calculatedPrice.toFixed(2)}`
      }

      this.renderTShirtQuestions()

      if (this.el.qtyValue) {
        this.el.qtyValue.textContent = this.step3.quantity.toString()
      }
    },

    renderTShirtQuestions() {
      const container =
        this.el.extraQuestions ||
        document.querySelector('.ul-step[data-step="3"] .ul-extra-questions')
      if (!container) {
        console.log('[ULTShirtModal] No extra questions container found')
        return
      }

      const questions = this.config.tshirtExtraQuestions || this.config.extraQuestions || []

      if (questions.length === 0) {
        container.style.display = 'none'
        return
      }

      console.log('[ULTShirtModal] Rendering', questions.length, 'extra questions')

      container.style.display = 'block'
      container.innerHTML = `
        <div class="ul-questions-header">Additional Information</div>
        <div class="ul-questions-list"></div>
      `

      const list = container.querySelector('.ul-questions-list')

      questions.forEach((q, index) => {
        const fieldId = `ul-tq-${q.id || index}`
        const fieldDiv = document.createElement('div')
        fieldDiv.className = 'ul-question-field'

        const existingAnswer = this.step3.extraAnswers[q.label] || ''

        let inputHtml = ''
        switch (q.type) {
          case 'text':
            inputHtml = `<input type="text" id="${fieldId}" value="${this.escapeHtml(existingAnswer)}" placeholder="${this.escapeHtml(q.placeholder || '')}">`
            break
          case 'textarea':
            inputHtml = `<textarea id="${fieldId}" placeholder="${this.escapeHtml(q.placeholder || '')}">${this.escapeHtml(existingAnswer)}</textarea>`
            break
          case 'select':
            inputHtml = `<select id="${fieldId}">
              <option value="">Select...</option>
              ${(q.options || []).map((opt) => `<option value="${this.escapeHtml(opt)}" ${existingAnswer === opt ? 'selected' : ''}>${this.escapeHtml(opt)}</option>`).join('')}
            </select>`
            break
          case 'checkbox':
            inputHtml = `<label class="ul-checkbox-label"><input type="checkbox" id="${fieldId}" ${existingAnswer === 'Yes' ? 'checked' : ''}> Yes</label>`
            break
          case 'number':
            inputHtml = `<input type="number" id="${fieldId}" value="${this.escapeHtml(existingAnswer)}" placeholder="${this.escapeHtml(q.placeholder || '')}">`
            break
          default:
            inputHtml = `<input type="text" id="${fieldId}" value="${this.escapeHtml(existingAnswer)}">`
        }

        fieldDiv.innerHTML = `
          <label for="${fieldId}">${this.escapeHtml(q.label)}${q.required ? ' <span class="ul-required">*</span>' : ''}</label>
          ${inputHtml}
        `

        const input = fieldDiv.querySelector('input, textarea, select')
        if (input) {
          const eventType = input.tagName === 'SELECT' ? 'change' : 'input'
          input.addEventListener(eventType, (e) => {
            if (e.target.type === 'checkbox') {
              this.step3.extraAnswers[q.label] = e.target.checked ? 'Yes' : 'No'
            } else {
              this.step3.extraAnswers[q.label] = e.target.value
            }
          })
        }

        list.appendChild(fieldDiv)
      })
    },

    escapeHtml(text) {
      if (!text) return ''
      const div = document.createElement('div')
      div.textContent = text
      return div.innerHTML
    },

    adjustQuantity(delta) {
      const newQty = Math.max(1, this.step3.quantity + delta)
      this.step3.quantity = newQty

      if (this.el.qtyValue) {
        this.el.qtyValue.textContent = newQty.toString()
      }

      if (this.el.qtyMinus) {
        this.el.qtyMinus.disabled = newQty <= 1
      }

      this.updateNavButtons()
    },

    initStep4() {
      const enabledLocs = this.getEnabledLocations()
      const locNames = enabledLocs.map((id) => {
        const map = {
          front: 'Front',
          back: 'Back',
          left_sleeve: 'Left Sleeve',
          right_sleeve: 'Right Sleeve',
        }
        return map[id] || id
      })

      this.generateLocationSnapshots(enabledLocs)

      if (this.el.reviewColor) this.el.reviewColor.textContent = this.step2.tshirtColorName
      if (this.el.reviewSize) this.el.reviewSize.textContent = this.step2.tshirtSize
      if (this.el.reviewQty) this.el.reviewQty.textContent = this.step3.quantity.toString()
      if (this.el.reviewLocations) this.el.reviewLocations.textContent = locNames.join(', ')

      const total = this.step2.calculatedPrice * this.step3.quantity
      if (this.el.reviewPriceBase) {
        this.el.reviewPriceBase.textContent = `$${this.step2.basePrice.toFixed(2)}`
      }
      if (this.el.reviewTotal) {
        this.el.reviewTotal.textContent = `$${total.toFixed(2)}`
      }

      this.updateReviewPriceBreakdown()

      this.updateActionButtons()
    },

    updateReviewPriceBreakdown() {
      if (!this.el.reviewPriceBreakdown) return

      let html = `
        <div class="ul-review-price-row">
          <span>Base T-Shirt (${this.step2.tshirtSize})</span>
          <span>$${this.step2.basePrice.toFixed(2)}</span>
        </div>
      `

      const enabledLocs = this.getEnabledLocations()
      enabledLocs.forEach((locId, idx) => {
        const loc = this.step2.locations[locId]
        const map = {
          front: 'Front',
          back: 'Back',
          left_sleeve: 'Left Sleeve',
          right_sleeve: 'Right Sleeve',
        }
        const price = idx === 0 ? 0 : loc.price
        html += `
          <div class="ul-review-price-row">
            <span>${map[locId]} Print</span>
            <span>${idx === 0 ? 'Included' : `$${price.toFixed(2)}`}</span>
          </div>
        `
      })

      const sizeModifier = this.config.sizePricing[this.step2.tshirtSize] || 0
      if (sizeModifier > 0) {
        html += `
          <div class="ul-review-price-row">
            <span>Size ${this.step2.tshirtSize} (+)</span>
            <span>$${sizeModifier.toFixed(2)}</span>
          </div>
        `
      }

      if (this.step3.quantity > 1) {
        html += `
          <div class="ul-review-price-row">
            <span>× ${this.step3.quantity} items</span>
            <span></span>
          </div>
        `
      }

      const total = this.step2.calculatedPrice * this.step3.quantity
      html += `
        <div class="ul-review-price-row total">
          <span>TOTAL</span>
          <span>$${total.toFixed(2)}</span>
        </div>
      `

      this.el.reviewPriceBreakdown.innerHTML = html
    },

    async generateLocationSnapshots(enabledLocs) {
      const grid = document.getElementById('ul-review-preview-grid')
      if (!grid) return

      const locNames = {
        front: 'Front',
        back: 'Back',
        left_sleeve: 'Left Sleeve',
        right_sleeve: 'Right Sleeve',
      }

      const cameraRotations = {
        front: 0,
        back: Math.PI,
        left_sleeve: -Math.PI / 2,
        right_sleeve: Math.PI / 2,
      }

      grid.innerHTML = ''

      if (!this.three.renderer || !this.three.scene || !this.three.camera) {
        enabledLocs.forEach((locId) => {
          const item = document.createElement('div')
          item.className = 'ul-review-preview-item'
          item.innerHTML = `
            <div class="ul-review-preview-label">${locNames[locId]}</div>
            <div class="ul-review-preview-box">👕</div>
          `
          grid.appendChild(item)
        })
        return
      }

      for (const locId of enabledLocs) {
        const targetRotation = cameraRotations[locId] || 0

        if (this.three.tshirtModel) {
          this.three.tshirtModel.rotation.y = targetRotation
        } else if (this.three.tshirtMesh) {
          this.three.tshirtMesh.rotation.y = targetRotation
        }

        await new Promise((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              this.three.renderer.render(this.three.scene, this.three.camera)
              resolve()
            })
          })
        })

        const dataUrl = this.three.renderer.domElement.toDataURL('image/png')

        this.step4.locationSnapshots = this.step4.locationSnapshots || {}
        this.step4.locationSnapshots[locId] = dataUrl

        const item = document.createElement('div')
        item.className = 'ul-review-preview-item'

        const label = document.createElement('div')
        label.className = 'ul-review-preview-label'
        label.textContent = locNames[locId]

        const box = document.createElement('div')
        box.className = 'ul-review-preview-box'
        box.title = 'Click to enlarge'

        const img = document.createElement('img')
        img.src = dataUrl
        img.alt = `${locNames[locId]} preview`
        img.style.cssText = 'width: 100%; height: 100%; object-fit: contain; border-radius: 8px;'

        box.addEventListener('click', () => {
          this.showLightbox(dataUrl, locNames[locId])
        })

        box.appendChild(img)
        item.appendChild(label)
        item.appendChild(box)
        grid.appendChild(item)

        await new Promise((r) => setTimeout(r, 100))
      }

      if (this.three.tshirtModel) {
        this.three.tshirtModel.rotation.y = 0
      } else if (this.three.tshirtMesh) {
        this.three.tshirtMesh.rotation.y = 0
      }
    },

    showLightbox(imageUrl, label) {
      this.closeLightbox()

      const overlay = document.createElement('div')
      overlay.className = 'ul-lightbox-overlay'
      overlay.id = 'ul-lightbox-overlay'

      const content = document.createElement('div')
      content.className = 'ul-lightbox-content'

      const closeBtn = document.createElement('button')
      closeBtn.className = 'ul-lightbox-close'
      closeBtn.innerHTML = '×'
      closeBtn.title = 'Close (ESC)'
      closeBtn.onclick = () => this.closeLightbox()

      const img = document.createElement('img')
      img.className = 'ul-lightbox-image'
      img.src = imageUrl
      img.alt = label

      const labelEl = document.createElement('div')
      labelEl.className = 'ul-lightbox-label'
      labelEl.textContent = label

      const hint = document.createElement('div')
      hint.className = 'ul-lightbox-hint'
      hint.textContent = 'Press ESC or click outside to close'

      content.appendChild(closeBtn)
      content.appendChild(img)
      content.appendChild(labelEl)
      content.appendChild(hint)
      overlay.appendChild(content)

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          this.closeLightbox()
        }
      })

      this._lightboxKeyHandler = (e) => {
        if (e.key === 'Escape') {
          this.closeLightbox()
        }
      }
      document.addEventListener('keydown', this._lightboxKeyHandler)

      document.body.appendChild(overlay)

      requestAnimationFrame(() => {
        overlay.classList.add('active')
      })
    },

    closeLightbox() {
      const overlay = document.getElementById('ul-lightbox-overlay')
      if (overlay) {
        overlay.classList.remove('active')
        setTimeout(() => overlay.remove(), 300)
      }
      if (this._lightboxKeyHandler) {
        document.removeEventListener('keydown', this._lightboxKeyHandler)
        this._lightboxKeyHandler = null
      }
    },

    updateActionButtons() {
      const enabled = this.step4.confirmationChecked

      if (this.el.designAnotherBtn) {
        this.el.designAnotherBtn.disabled = !enabled
      }
      if (this.el.checkoutBtn) {
        this.el.checkoutBtn.disabled = !enabled
      }
    },

    async addToCart() {
      const designData = this.step1.useInheritedDesign ? this.inheritedDesign : this.step1.newUpload

      const selectedSize = this.step2.tshirtSize
      const selectedColor = this.step2.tshirtColorName
      let variantId = null
      let selectedVariant = null

      if (this.product.variants && this.product.variants.length > 0) {
        selectedVariant = this.findMatchingVariant(selectedColor, selectedSize)
        variantId = selectedVariant?.id
        console.log(
          '[ULTShirtModal] Found T-Shirt variant:',
          selectedVariant?.title,
          'ID:',
          variantId
        )
      }

      if (!variantId) {
        console.error(
          '[ULTShirtModal] No T-Shirt variant found. Product variants:',
          this.product.variants
        )
        this.showToast('Error: T-Shirt product not configured. Please contact support.', 'error')
        return false
      }

      console.log(
        '[ULTShirtModal] Adding T-Shirt to cart - Variant:',
        variantId,
        'Size:',
        selectedSize,
        'Color:',
        selectedColor
      )

      const properties = {
        _ul_upload_id: designData.uploadId,
        _ul_tshirt_color: this.step2.tshirtColorName,
        _ul_tshirt_size: this.step2.tshirtSize,
        _ul_locations: this.getEnabledLocations().join(','),
        _ul_is_tshirt: 'true',
        'Uploaded File': designData.originalUrl || designData.thumbnailUrl,
        'Design Name': designData.name,
        'T-Shirt Color': this.step2.tshirtColorName,
        'T-Shirt Size': this.step2.tshirtSize,
        'Print Locations': this.getEnabledLocations().join(', '),
      }

      this.getEnabledLocations().forEach((locId) => {
        const loc = this.step2.locations[locId]
        properties[`_ul_${locId}_scale`] = loc.scale.toString()
        properties[`_ul_${locId}_pos_x`] = loc.positionX.toString()
        properties[`_ul_${locId}_pos_y`] = loc.positionY.toString()
      })

      if (this.step3.specialInstructions) {
        properties['_ul_special_instructions'] = this.step3.specialInstructions
      }

      const orderNote = this.generateOrderNote()

      const cartData = {
        items: [
          {
            id: variantId,
            quantity: this.step3.quantity,
            properties,
          },
        ],
      }

      try {
        const response = await fetch('/cart/add.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cartData),
        })

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))

          if (errorData.description?.includes('not available') || errorData.status === 422) {
            if (window.ULErrorHandler) {
              window.ULErrorHandler.show('CART_VARIANT_OUT_OF_STOCK')
            }
            throw new Error('This size is currently out of stock.')
          }

          throw new Error(errorData.description || 'Failed to add to cart')
        }

        await this.updateCartNote(orderNote)

        document.dispatchEvent(new CustomEvent('ul:cartUpdated'))
        document.dispatchEvent(new CustomEvent('cart:updated'))

        if (window.ULAnalytics) {
          const enabledLocations = Object.keys(this.step2.locations).filter(
            (k) => this.step2.locations[k].enabled
          )
          window.ULAnalytics.trackTShirtAddToCart({
            color: this.step2.tshirtColorName,
            colorHex: this.step2.tshirtColor,
            size: this.step2.tshirtSize,
            quantity: this.step3.quantity,
            locations: enabledLocations,
            locationCount: enabledLocations.length,
            hasDesign: !!this.inheritedDesign.uploadId,
            variantId: variantId,
            price: selectedVariant?.price || null,
          })
        }

        return true
      } catch (error) {
        console.error('[ULTShirtModal] Add to cart error:', error)

        if (window.ULErrorHandler) {
          const errorMsg = error.message || ''
          let errorCode = 'CART_ADD_FAILED'

          if (errorMsg.includes('stock')) {
            errorCode = 'CART_VARIANT_OUT_OF_STOCK'
          } else if (errorMsg.includes('session') || errorMsg.includes('expired')) {
            errorCode = 'CART_SESSION_EXPIRED'
          }

          window.ULErrorHandler.show(
            errorCode,
            {},
            {
              onRetry: () => this.addToCart(),
            }
          )
        } else {
          this.showToast('Failed to add to cart. Please try again.', 'error')
        }

        return false
      }
    },

    generateOrderNote() {
      const designData = this.step1.useInheritedDesign ? this.inheritedDesign : this.step1.newUpload
      const enabledLocs = this.getEnabledLocations()
      const now = new Date().toISOString()

      let note = `═══════════════════════════════════════\n`
      note += `🎨 T-SHIRT CUSTOMIZER ORDER\n`
      note += `═══════════════════════════════════════\n\n`

      note += `📋 ORDER DETAILS:\n`
      note += `─────────────────────────────────────\n`
      note += `• Size: ${this.step2.tshirtSize}\n`
      note += `• Color: ${this.step2.tshirtColorName} (${this.step2.tshirtColor})\n`
      note += `• Quantity: ${this.step3.quantity}\n`
      note += `• Timestamp: ${now}\n\n`

      note += `🖼️ DESIGN FILE:\n`
      note += `─────────────────────────────────────\n`
      note += `• Name: ${designData.name || 'Custom Design'}\n`
      note += `• Upload ID: ${designData.uploadId || 'N/A'}\n`
      if (designData.originalUrl) {
        note += `• File URL: ${designData.originalUrl}\n`
      }
      note += `\n`

      note += `📍 PRINT LOCATIONS (${enabledLocs.length}):\n`
      note += `─────────────────────────────────────\n`

      const locNames = {
        front: 'FRONT',
        back: 'BACK',
        left_sleeve: 'LEFT SLEEVE',
        right_sleeve: 'RIGHT SLEEVE',
      }

      const cameraRotations = {
        front: '0°',
        back: '180°',
        left_sleeve: '-90°',
        right_sleeve: '+90°',
      }

      enabledLocs.forEach((locId, index) => {
        const loc = this.step2.locations[locId]
        note += `\n  [${index + 1}] ${locNames[locId]}\n`
        note += `      • Scale: ${(loc.scale * 100).toFixed(0)}%\n`
        note += `      • Position X: ${loc.positionX.toFixed(3)}\n`
        note += `      • Position Y: ${loc.positionY.toFixed(3)}\n`
        note += `      • UV Center: u=${this.UV_REGIONS[locId].center.u}, v=${this.UV_REGIONS[locId].center.v}\n`
        note += `      • Camera Rotation: ${cameraRotations[locId]}\n`
      })

      note += `\n`

      if (this.step3.specialInstructions) {
        note += `📝 SPECIAL INSTRUCTIONS:\n`
        note += `─────────────────────────────────────\n`
        note += `${this.step3.specialInstructions}\n\n`
      }

      note += `⚙️ TECHNICAL INFO:\n`
      note += `─────────────────────────────────────\n`
      note += `• Canvas Size: 2048x2048px\n`
      note += `• Default Scale: ${this.UV_REGIONS.front.defaultSize || 0.55}\n`
      note += `• Texture Strategy: Baked UV Mapping\n`
      note += `═══════════════════════════════════════\n`

      return note
    },

    async updateCartNote(note) {
      const MAX_NOTE_LENGTH = 4800

      try {
        const cartResponse = await fetch('/cart.js')
        const cart = await cartResponse.json()

        let fullNote = cart.note || ''
        if (fullNote) {
          fullNote += '\n\n'
        }
        fullNote += note

        if (fullNote.length > MAX_NOTE_LENGTH) {
          console.warn('[ULTShirtModal] Cart note exceeds limit:', fullNote.length, 'chars')

          const separator = '═══════════════════════════════════════'
          const notes = fullNote.split(separator)
          let truncated = ''

          for (let i = notes.length - 1; i >= 0; i--) {
            const testNote =
              notes[i].trim() + (truncated ? '\n' + separator + '\n' + truncated : '')
            if (testNote.length <= MAX_NOTE_LENGTH) {
              truncated = testNote
            } else if (truncated) {
              break
            }
          }

          if (!truncated || truncated.length > MAX_NOTE_LENGTH) {
            truncated =
              note.substring(0, MAX_NOTE_LENGTH - 50) + '\n[Note truncated due to length limit]'
          }

          fullNote = truncated
          console.log('[ULTShirtModal] Cart note truncated to:', fullNote.length, 'chars')
        }

        await fetch('/cart/update.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note: fullNote }),
        })

        console.log('[ULTShirtModal] Order note added to cart')
      } catch (error) {
        console.warn('[ULTShirtModal] Failed to update cart note:', error)
      }
    },

    async designAnother() {
      const success = await this.addToCart()

      if (success) {
        this.showToast('✓ Added to cart! Design another item.', 'success')

        if (window.ULAnalytics) {
          window.ULAnalytics.trackTShirtDesignAnother({
            previousColor: this.step2.tshirtColorName,
            previousSize: this.step2.tshirtSize,
            previousLocations: Object.keys(this.step2.locations).filter(
              (k) => this.step2.locations[k].enabled
            ),
          })
        }

        this.resetState()

        if (this.inheritedDesign.uploadId) {
          this.showInheritedDesign()
        }

        this.goToStep(1)
      }
    },

    async checkout() {
      const success = await this.addToCart()

      if (success) {
        this.showToast('✓ Added to cart!', 'success')

        if (window.ULEvents) {
          window.ULEvents.emit('addToCart', {
            source: 'tshirt-modal',
            color: this.step2.tshirtColorName,
            size: this.step2.tshirtSize,
            quantity: this.step3.quantity,
            locations: Object.keys(this.step2.locations).filter(
              (k) => this.step2.locations[k].enabled
            ),
          })
        }

        if (window.ULAnalytics) {
          const enabledLocations = Object.keys(this.step2.locations).filter(
            (k) => this.step2.locations[k].enabled
          )
          window.ULAnalytics.trackTShirtCheckout({
            color: this.step2.tshirtColorName,
            colorHex: this.step2.tshirtColor,
            size: this.step2.tshirtSize,
            quantity: this.step3.quantity,
            locations: enabledLocations,
            locationCount: enabledLocations.length,
            hasDesign: !!this.inheritedDesign.uploadId,
            currentStep: this.currentStep,
          })
        }

        this.close()

        setTimeout(() => {
          window.location.href = '/cart'
        }, 300)
      }
    },

    getStepName(step) {
      const stepNames = {
        1: 'design',
        2: 'customize',
        3: 'quantity',
        4: 'confirm',
      }
      return stepNames[step] || `step_${step}`
    },

    isLightColor(hex) {
      const color = hex.replace('#', '')
      const r = parseInt(color.substr(0, 2), 16)
      const g = parseInt(color.substr(2, 2), 16)
      const b = parseInt(color.substr(4, 2), 16)
      const brightness = (r * 299 + g * 587 + b * 114) / 1000
      return brightness > 200
    },

    showToast(message, type = 'success') {
      if (!this.el.toast) return

      this.el.toast.textContent = message
      this.el.toast.className = 'ul-toast ' + type

      setTimeout(() => this.el.toast.classList.add('show'), 10)

      setTimeout(() => {
        this.el.toast.classList.remove('show')
      }, 3000)
    },
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ULTShirtModal.init())
  } else {
    ULTShirtModal.init()
  }

  window.ULTShirtModal = ULTShirtModal
})()
