/**
 * Upload Studio - Carousel Upload JavaScript
 * Version: 1.0.0
 *
 * Handles:
 * - Banner slider with auto-play
 * - 3D Carousel navigation and effects
 * - 4D tilt effect on product cards
 * - Upload modal with file handling
 * - Sheet size selection
 * - Quantity controls
 * - Add to Cart integration
 */

;(function () {
  'use strict'

  // ========================================
  // Configuration
  // ========================================
  const CONFIG = {
    apiBase: '/apps/customizer',
    // v4.5.0: Enterprise plan - 10GB file support
    maxFileSize: 10240 * 1024 * 1024, // 10GB - Enterprise plan (backend validates per plan)
    allowedTypes: [
      'image/png',
      'image/jpeg',
      'image/webp',
      'application/pdf',
      'image/svg+xml',
      'image/tiff',
      'image/vnd.adobe.photoshop',
      'application/postscript',
      'application/illustrator',
      'application/eps',
      'application/x-eps',
    ],
    allowedExtensions: [
      'png',
      'jpg',
      'jpeg',
      'webp',
      'svg',
      'pdf',
      'tiff',
      'tif',
      'psd',
      'ai',
      'eps',
    ],
    bannerAutoplayInterval: 5000,
    carouselItemsVisible: 5,
  }

  // Sheet sizes with prices
  const SHEET_SIZES = [
    { id: '22x6', name: '22" x 6"', price: 7.5, width: 22, height: 6 },
    { id: '22x12', name: '22" x 12"', price: 12.0, width: 22, height: 12 },
    { id: '22x24', name: '22" x 24"', price: 22.0, width: 22, height: 24 },
    { id: '22x60', name: '22" x 60"', price: 50.0, width: 22, height: 60 },
  ]

  // ========================================
  // State
  // ========================================
  const state = {
    currentBanner: 0,
    currentCarouselIndex: 0,
    bannerAutoplay: null,
    uploadedFile: null,
    uploadedFileUrl: null,
    selectedSize: '22x12',
    quantity: 1,
    currentProduct: null,
    modalOpen: false,
  }

  // ========================================
  // DOM Ready
  // ========================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }

  function init() {
    console.log('[UL Carousel] Initializing...')

    initBannerSlider()
    initCarousel3D()
    initProductCards()
    initUploadModal()
    initAmbientParticles()

    console.log('[UL Carousel] Initialized successfully')
  }

  // ========================================
  // Banner Slider
  // ========================================
  function initBannerSlider() {
    const wrapper = document.querySelector('.ul-banner-slider-wrapper')
    if (!wrapper) return

    const slides = wrapper.querySelectorAll('.ul-banner-slide')
    const dots = wrapper.querySelectorAll('.ul-banner-dot')
    const prevBtn = wrapper.querySelector('.ul-banner-prev')
    const nextBtn = wrapper.querySelector('.ul-banner-next')

    if (slides.length <= 1) return

    function showSlide(index) {
      state.currentBanner = ((index % slides.length) + slides.length) % slides.length

      slides.forEach((slide, i) => {
        slide.classList.toggle('active', i === state.currentBanner)
      })

      dots.forEach((dot, i) => {
        dot.classList.toggle('active', i === state.currentBanner)
      })
    }

    function nextSlide() {
      showSlide(state.currentBanner + 1)
    }

    function prevSlide() {
      showSlide(state.currentBanner - 1)
    }

    // Event listeners
    if (prevBtn)
      prevBtn.addEventListener('click', () => {
        stopAutoplay()
        prevSlide()
        startAutoplay()
      })
    if (nextBtn)
      nextBtn.addEventListener('click', () => {
        stopAutoplay()
        nextSlide()
        startAutoplay()
      })

    dots.forEach((dot, i) => {
      dot.addEventListener('click', () => {
        stopAutoplay()
        showSlide(i)
        startAutoplay()
      })
    })

    // Autoplay
    function startAutoplay() {
      const autoplay = wrapper.dataset.autoplay === 'true'
      if (autoplay && slides.length > 1) {
        state.bannerAutoplay = setInterval(nextSlide, CONFIG.bannerAutoplayInterval)
      }
    }

    function stopAutoplay() {
      if (state.bannerAutoplay) {
        clearInterval(state.bannerAutoplay)
        state.bannerAutoplay = null
      }
    }

    // Initialize
    showSlide(0)
    startAutoplay()

    // Pause on hover
    wrapper.addEventListener('mouseenter', stopAutoplay)
    wrapper.addEventListener('mouseleave', startAutoplay)
  }

  // ========================================
  // 3D Carousel
  // ========================================
  function initCarousel3D() {
    const wrapper = document.querySelector('.ul-carousel-3d-wrapper')
    if (!wrapper) return

    const carousel = wrapper.querySelector('.ul-carousel-3d')
    const items = wrapper.querySelectorAll('.ul-carousel-3d-item')
    const prevBtn = wrapper.querySelector('.ul-carousel-prev')
    const nextBtn = wrapper.querySelector('.ul-carousel-next')
    const dots = wrapper.querySelectorAll('.ul-carousel-dot')

    if (items.length === 0) return

    // Skip 3D effect on mobile
    if (window.innerWidth <= 768) {
      items.forEach((item) => {
        item.style.position = 'relative'
        item.style.transform = 'none'
        item.style.opacity = '1'
      })
      return
    }

    function updateCarousel() {
      const total = items.length
      const angleStep = 360 / Math.min(total, CONFIG.carouselItemsVisible)
      const radius = 400

      items.forEach((item, i) => {
        const offset = (((i - state.currentCarouselIndex) % total) + total) % total
        const normalizedOffset = offset > total / 2 ? offset - total : offset

        // Calculate 3D position
        const angle = normalizedOffset * angleStep
        const radian = (angle * Math.PI) / 180
        const z = Math.cos(radian) * radius
        const x = Math.sin(radian) * radius
        const scale = 0.6 + (0.4 * (z + radius)) / (2 * radius)
        const opacity = 0.3 + (0.7 * (z + radius)) / (2 * radius)

        item.style.transform = `translateX(${x}px) translateZ(${z}px) scale(${scale})`
        item.style.opacity = opacity
        item.style.zIndex = Math.round(z)
        item.style.filter = `blur(${Math.max(0, (1 - opacity) * 3)}px)`
      })

      // Update dots
      dots.forEach((dot, i) => {
        dot.classList.toggle('active', i === state.currentCarouselIndex)
      })
    }

    function navigate(direction) {
      state.currentCarouselIndex =
        (((state.currentCarouselIndex + direction) % items.length) + items.length) % items.length
      updateCarousel()
    }

    // Event listeners
    if (prevBtn) prevBtn.addEventListener('click', () => navigate(-1))
    if (nextBtn) nextBtn.addEventListener('click', () => navigate(1))

    dots.forEach((dot, i) => {
      dot.addEventListener('click', () => {
        state.currentCarouselIndex = i
        updateCarousel()
      })
    })

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') navigate(-1)
      if (e.key === 'ArrowRight') navigate(1)
    })

    // Initialize
    updateCarousel()
  }

  // ========================================
  // Product Cards
  // ========================================
  function initProductCards() {
    const cards = document.querySelectorAll('.ul-product-card-4d')

    cards.forEach((card) => {
      // 4D Tilt Effect
      card.addEventListener('mousemove', (e) => {
        if (window.innerWidth <= 768) return

        const rect = card.getBoundingClientRect()
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top
        const centerX = rect.width / 2
        const centerY = rect.height / 2

        const rotateX = ((y - centerY) / centerY) * -10
        const rotateY = ((x - centerX) / centerX) * 10

        card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`

        // Update glow position
        const glow = card.querySelector('.ul-image-glow')
        if (glow) {
          glow.style.background = `radial-gradient(circle at ${x}px ${y}px, rgba(115, 103, 240, 0.3), transparent 50%)`
          glow.style.opacity = '1'
        }
      })

      card.addEventListener('mouseleave', () => {
        card.style.transform = ''
        const glow = card.querySelector('.ul-image-glow')
        if (glow) glow.style.opacity = '0'
      })

      // Upload Button Click
      const uploadBtn = card.querySelector('.ul-upload-btn')
      if (uploadBtn) {
        uploadBtn.addEventListener('click', (e) => {
          e.preventDefault()
          e.stopPropagation()
          openUploadModal(card)
        })
      }

      // Wishlist Toggle
      const wishlistBtn = card.querySelector('.ul-wishlist-btn')
      if (wishlistBtn) {
        wishlistBtn.addEventListener('click', (e) => {
          e.preventDefault()
          e.stopPropagation()
          wishlistBtn.classList.toggle('active')
        })
      }

      // Add to Cart (without upload)
      const addToCartBtn = card.querySelector('.ul-add-to-cart-btn')
      if (addToCartBtn && !addToCartBtn.classList.contains('sold-out')) {
        addToCartBtn.addEventListener('click', (e) => {
          e.preventDefault()
          e.stopPropagation()

          const variantId = card.dataset.variantId
          if (variantId) {
            addToCart(variantId, 1, null, addToCartBtn)
          }
        })
      }
    })
  }

  // ========================================
  // Upload Modal
  // ========================================
  function initUploadModal() {
    const overlay = document.querySelector('.ul-upload-modal-overlay')
    if (!overlay) return

    const modal = overlay.querySelector('.ul-upload-modal')
    const closeBtn = overlay.querySelector('.ul-upload-modal-close')
    const uploadZone = overlay.querySelector('.ul-modal-upload-zone')
    const fileInput = overlay.querySelector('.ul-modal-file-input')
    const preview = overlay.querySelector('.ul-modal-upload-preview')
    const removeBtn = overlay.querySelector('.ul-modal-remove-upload')
    const sizeButtons = overlay.querySelectorAll('.ul-modal-size-btn')
    const qtyInput = overlay.querySelector('.ul-modal-qty-input')
    const qtyMinus = overlay.querySelector('.ul-modal-qty-minus')
    const qtyPlus = overlay.querySelector('.ul-modal-qty-plus')
    const addToCartBtn = overlay.querySelector('.ul-modal-add-cart')
    const checkoutBtn = overlay.querySelector('.ul-modal-checkout')

    // Close modal
    function closeModal() {
      state.modalOpen = false
      overlay.classList.remove('active')
      document.body.style.overflow = ''
      resetModalState()
    }

    function resetModalState() {
      state.uploadedFile = null
      state.uploadedFileUrl = null
      state.selectedSize = '22x12'
      state.quantity = 1
      state.currentProduct = null

      if (uploadZone) uploadZone.style.display = ''
      if (preview) preview.style.display = 'none'
      if (qtyInput) qtyInput.value = 1

      sizeButtons.forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.size === '22x12')
      })

      updateTotal()
    }

    // Close handlers
    if (closeBtn) closeBtn.addEventListener('click', closeModal)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal()
    })
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.modalOpen) closeModal()
    })

    // File upload
    if (uploadZone && fileInput) {
      uploadZone.addEventListener('click', () => fileInput.click())

      uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault()
        uploadZone.classList.add('dragover')
      })

      uploadZone.addEventListener('dragleave', () => {
        uploadZone.classList.remove('dragover')
      })

      uploadZone.addEventListener('drop', (e) => {
        e.preventDefault()
        uploadZone.classList.remove('dragover')
        const files = e.dataTransfer.files
        if (files.length > 0) handleFile(files[0])
      })

      fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) handleFile(e.target.files[0])
      })
    }

    function handleFile(file) {
      // 0-byte file protection: Reject empty files immediately
      if (!file.size || file.size === 0) {
        alert('The selected file is empty (0 bytes). Please select a valid file.')
        console.error('[Carousel Upload] 0-byte file rejected:', file.name)
        return
      }

      // Validate file type by MIME type or extension
      const ext = file.name.split('.').pop()?.toLowerCase() || ''
      const isValidType =
        CONFIG.allowedTypes.includes(file.type) || CONFIG.allowedExtensions.includes(ext)
      if (!isValidType) {
        alert('Invalid file type. Please upload PNG, JPG, WebP, TIFF, PSD, PDF, SVG, AI, or EPS.')
        return
      }

      // Validate file size (1GB limit)
      if (file.size > CONFIG.maxFileSize) {
        alert('File too large. Maximum size is 1GB.')
        return
      }

      state.uploadedFile = file

      // v4.3.0: Check if non-browser format (needs server-side thumbnail)
      const NON_BROWSER_EXTENSIONS = ['psd', 'pdf', 'ai', 'eps', 'tiff', 'tif']
      const isNonBrowserFormat = NON_BROWSER_EXTENSIONS.includes(ext)

      if (isNonBrowserFormat) {
        // Use spinner placeholder - actual thumbnail will come from server after upload
        state.uploadedFileUrl =
          'data:image/svg+xml,' +
          encodeURIComponent(`
          <svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 50 50">
            <circle cx="25" cy="25" r="20" fill="none" stroke="#e5e7eb" stroke-width="4"/>
            <circle cx="25" cy="25" r="20" fill="none" stroke="#3b82f6" stroke-width="4"
              stroke-dasharray="80" stroke-dashoffset="60">
              <animateTransform attributeName="transform" type="rotate" from="0 25 25" to="360 25 25" dur="1s" repeatCount="indefinite"/>
            </circle>
          </svg>
        `)
        console.log('[UL-Carousel] Non-browser format, using spinner:', ext)
      } else {
        state.uploadedFileUrl = URL.createObjectURL(file)
      }

      // Show preview
      if (uploadZone) uploadZone.style.display = 'none'
      if (preview) {
        const previewImg = preview.querySelector('img')
        const fileName = preview.querySelector('.ul-file-name')
        const fileSize = preview.querySelector('.ul-file-size')

        if (previewImg) {
          previewImg.src = state.uploadedFileUrl
          if (isNonBrowserFormat) {
            previewImg.dataset.waitingThumbnail = 'true'
          }
        }
        if (fileName) fileName.textContent = file.name
        if (fileSize) fileSize.textContent = formatFileSize(file.size)

        preview.style.display = ''
      }

      updateTotal()
    }

    // Remove upload
    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        if (state.uploadedFileUrl) {
          URL.revokeObjectURL(state.uploadedFileUrl)
        }
        state.uploadedFile = null
        state.uploadedFileUrl = null

        if (uploadZone) uploadZone.style.display = ''
        if (preview) preview.style.display = 'none'
        if (fileInput) fileInput.value = ''

        updateTotal()
      })
    }

    // Size selection
    sizeButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        sizeButtons.forEach((b) => b.classList.remove('active'))
        btn.classList.add('active')
        state.selectedSize = btn.dataset.size
        updateTotal()
      })
    })

    // Quantity controls
    if (qtyMinus) {
      qtyMinus.addEventListener('click', () => {
        if (state.quantity > 1) {
          state.quantity--
          if (qtyInput) qtyInput.value = state.quantity
          updateTotal()
        }
      })
    }

    if (qtyPlus) {
      qtyPlus.addEventListener('click', () => {
        if (state.quantity < 100) {
          state.quantity++
          if (qtyInput) qtyInput.value = state.quantity
          updateTotal()
        }
      })
    }

    if (qtyInput) {
      qtyInput.addEventListener('change', (e) => {
        let val = parseInt(e.target.value) || 1
        val = Math.max(1, Math.min(100, val))
        state.quantity = val
        qtyInput.value = val
        updateTotal()
      })
    }

    // Update total
    function updateTotal() {
      const totalEl = overlay.querySelector('.ul-modal-total-price')
      const size = SHEET_SIZES.find((s) => s.id === state.selectedSize)
      const sheetPrice = size ? size.price : 0
      const productPrice = state.currentProduct?.price || 0
      const total = (sheetPrice + productPrice) * state.quantity

      if (totalEl) {
        totalEl.textContent = formatMoney(total * 100)
      }

      // Enable/disable buttons
      const hasUpload = !!state.uploadedFile
      if (addToCartBtn) addToCartBtn.disabled = !hasUpload
      if (checkoutBtn) checkoutBtn.disabled = !hasUpload
    }

    // Add to cart
    if (addToCartBtn) {
      addToCartBtn.addEventListener('click', async () => {
        if (!state.uploadedFile || !state.currentProduct) return

        addToCartBtn.disabled = true
        if (checkoutBtn) checkoutBtn.disabled = true

        // Progress callback for button text
        const progressCallback = (progress) => {
          addToCartBtn.innerHTML = `<svg class="ul-spinner" width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" stroke-dasharray="60" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/></circle></svg> ${progress.text}`
        }

        addToCartBtn.innerHTML =
          '<svg class="ul-spinner" width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" stroke-dasharray="60" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/></circle></svg> Uploading...'

        try {
          // Upload file with progress tracking
          const uploadResult = await uploadFile(state.uploadedFile, progressCallback)

          // Build cart properties
          const size = SHEET_SIZES.find((s) => s.id === state.selectedSize)
          const properties = {
            // Hidden keys (internal use)
            _ul_upload_id: uploadResult.id,
            // Visible keys (shown in checkout)
            'Uploaded File': uploadResult.url,
            'Sheet Size': size?.name || state.selectedSize,
            'Upload Type': 'Custom Design',
          }

          addToCartBtn.innerHTML =
            '<svg class="ul-spinner" width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" stroke-dasharray="60" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/></circle></svg> Adding to cart...'

          // Add to cart
          await addToCart(state.currentProduct.variantId, state.quantity, properties, addToCartBtn)

          // Success - show with duration
          addToCartBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg> Added! (${uploadResult.uploadDuration}s)`
          addToCartBtn.classList.add('success')

          // Show duration on preview
          const preview = overlay.querySelector('.ul-modal-upload-preview')
          const durationEl = preview?.querySelector('.ul-upload-duration')
          if (durationEl) {
            durationEl.textContent = `Uploaded in ${uploadResult.uploadDuration}s`
            durationEl.style.display = 'block'
          }

          setTimeout(closeModal, 1500)
        } catch (error) {
          console.error('[UL Carousel] Error:', error)
          addToCartBtn.disabled = false
          if (checkoutBtn) checkoutBtn.disabled = false
          addToCartBtn.innerHTML =
            '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg> Try Again'
          alert('Failed to add to cart. Please try again.')
        }
      })
    }

    // Checkout
    if (checkoutBtn) {
      checkoutBtn.addEventListener('click', async () => {
        if (!state.uploadedFile || !state.currentProduct) return

        checkoutBtn.disabled = true
        if (addToCartBtn) addToCartBtn.disabled = true

        // Progress callback for button text
        const progressCallback = (progress) => {
          checkoutBtn.innerHTML = `<svg class="ul-spinner" width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" stroke-dasharray="60" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/></circle></svg> ${progress.text}`
        }

        checkoutBtn.innerHTML =
          '<svg class="ul-spinner" width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" stroke-dasharray="60" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/></circle></svg> Uploading...'

        try {
          // Upload file with progress tracking
          const uploadResult = await uploadFile(state.uploadedFile, progressCallback)

          // Build cart properties
          const size = SHEET_SIZES.find((s) => s.id === state.selectedSize)
          const properties = {
            // Hidden keys (internal use)
            _ul_upload_id: uploadResult.id,
            // Visible keys (shown in checkout)
            'Uploaded File': uploadResult.url,
            'Sheet Size': size?.name || state.selectedSize,
            'Upload Type': 'Custom Design',
          }

          checkoutBtn.innerHTML =
            '<svg class="ul-spinner" width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" stroke-dasharray="60" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/></circle></svg> Adding to cart...'

          // Add to cart
          await addToCartApi(state.currentProduct.variantId, state.quantity, properties)

          // Redirect to checkout
          window.location.href = '/checkout'
        } catch (error) {
          console.error('[UL Carousel] Error:', error)
          checkoutBtn.disabled = false
          if (addToCartBtn) addToCartBtn.disabled = false
          checkoutBtn.innerHTML =
            '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg> Try Again'
          alert('Failed to proceed to checkout. Please try again.')
        }
      })
    }
  }

  function openUploadModal(card) {
    // Prevent opening in Shopify theme editor
    if (window.Shopify && window.Shopify.designMode) return

    const overlay = document.querySelector('.ul-upload-modal-overlay')
    if (!overlay) return

    // Get product info from card
    const productId = card.dataset.productId
    const productHandle = card.dataset.productHandle
    const variantId = card.dataset.variantId
    const productTitle = card.querySelector('.ul-product-title')?.textContent || 'Product'
    const productPrice = card.querySelector('.ul-current-price')?.textContent || '$0.00'
    const productImage = card.querySelector('.ul-product-img')?.src || ''

    // Parse price
    const priceMatch = productPrice.match(/[\d.,]+/)
    const priceValue = priceMatch ? parseFloat(priceMatch[0].replace(',', '')) : 0

    state.currentProduct = {
      id: productId,
      handle: productHandle,
      variantId: variantId,
      title: productTitle,
      price: priceValue,
      image: productImage,
    }

    // Update modal product info
    const modalProductImage = overlay.querySelector('.ul-modal-product-image')
    const modalProductTitle = overlay.querySelector('.ul-modal-product-title')
    const modalProductPrice = overlay.querySelector('.ul-modal-product-price')

    if (modalProductImage) modalProductImage.src = productImage
    if (modalProductTitle) modalProductTitle.textContent = productTitle
    if (modalProductPrice) modalProductPrice.textContent = productPrice

    // Show modal
    state.modalOpen = true
    overlay.classList.add('active')
    document.body.style.overflow = 'hidden'

    // Update total
    const totalEl = overlay.querySelector('.ul-modal-total-price')
    const size = SHEET_SIZES.find((s) => s.id === state.selectedSize)
    const total = (size?.price || 0 + priceValue) * state.quantity
    if (totalEl) totalEl.textContent = formatMoney(total * 100)
  }

  // ========================================
  // File Upload API
  // ========================================
  async function uploadFile(file, progressCallback) {
    // Get API base from section settings
    const section = document.querySelector('.ul-carousel-section')
    const apiBase = section?.dataset.apiBase || CONFIG.apiBase
    const shopDomain = window.Shopify?.shop || getShopFromUrl()

    // Track upload start time
    const uploadStartTime = Date.now()

    // 1. Create upload intent
    if (progressCallback) {
      progressCallback({ phase: 'intent', percent: 0, text: 'Preparing...' })
    }

    const intentResponse = await fetch(`${apiBase}/api/upload/intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shopDomain,
        fileName: file.name,
        contentType: file.type,
        fileSize: file.size,
        mode: 'dtf',
      }),
    })

    if (!intentResponse.ok) {
      throw new Error('Failed to create upload intent')
    }

    const intentData = await intentResponse.json()
    const { uploadId, itemId, uploadUrl, storageProvider, uploadHeaders, publicUrl, key } =
      intentData

    // 2. Upload to storage with XHR for progress tracking
    if (progressCallback) {
      progressCallback({ phase: 'upload', percent: 0, text: '0% • Starting...' })
    }

    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()

      // Track progress
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && progressCallback) {
          const percent = Math.round((e.loaded / e.total) * 100)
          const elapsed = (Date.now() - uploadStartTime) / 1000
          const speed = e.loaded / elapsed / 1024 / 1024 // MB/s
          const remaining = elapsed > 0 ? (e.total - e.loaded) / (e.loaded / elapsed) : 0

          let speedText =
            speed >= 1 ? `${speed.toFixed(1)} MB/s` : `${(speed * 1024).toFixed(0)} KB/s`
          let remainingText =
            remaining < 60 ? `${Math.ceil(remaining)}s` : `${Math.ceil(remaining / 60)}m`

          progressCallback({
            phase: 'upload',
            percent,
            text: `${percent}% • ${speedText} • ${remainingText} left`,
          })
        }
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve()
        } else {
          reject(new Error('Failed to upload file'))
        }
      }

      xhr.onerror = () => reject(new Error('Network error during upload'))

      // Open and set headers based on provider
      if (storageProvider === 'bunny' || storageProvider === 'r2') {
        xhr.open('PUT', uploadUrl)
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
        if (uploadHeaders) {
          Object.entries(uploadHeaders).forEach(([k, v]) => xhr.setRequestHeader(k, v))
        }
        xhr.send(file)
      } else {
        // Local storage - POST with FormData
        const formData = new FormData()
        formData.append('file', file)
        formData.append('key', key)
        formData.append('uploadId', uploadId)
        formData.append('itemId', itemId)
        xhr.open('POST', uploadUrl)
        xhr.send(formData)
      }
    })

    // 3. Complete upload
    if (progressCallback) {
      progressCallback({ phase: 'complete', percent: 100, text: 'Finalizing...' })
    }

    // Calculate upload duration for analytics
    const uploadDurationMs = Date.now() - uploadStartTime

    const completeResponse = await fetch(`${apiBase}/api/upload/complete`, {
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

    if (!completeResponse.ok) {
      const errData = await completeResponse.json().catch(() => ({}))
      throw new Error(errData.error || 'Failed to complete upload')
    }

    // Calculate upload duration
    const uploadDuration = ((Date.now() - uploadStartTime) / 1000).toFixed(1)

    // Build full public URL with https://
    const fullUrl = publicUrl || `${window.location.origin}${apiBase}/api/upload/file/${uploadId}`

    return {
      id: uploadId,
      url: fullUrl,
      uploadDuration: uploadDuration,
    }
  }

  // ========================================
  // Cart API
  // ========================================
  async function addToCart(variantId, quantity, properties, buttonEl) {
    try {
      await addToCartApi(variantId, quantity, properties)

      if (buttonEl) {
        const originalHtml = buttonEl.innerHTML
        buttonEl.classList.add('success')
        buttonEl.innerHTML =
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg> Added!'

        setTimeout(() => {
          buttonEl.classList.remove('success')
          buttonEl.innerHTML = originalHtml
        }, 2000)
      }

      // Trigger cart update event
      document.dispatchEvent(new CustomEvent('cart:refresh'))

      // Update cart count if exists
      updateCartCount()
    } catch (error) {
      console.error('[UL Carousel] Add to cart error:', error)
      throw error
    }
  }

  async function addToCartApi(variantId, quantity, properties = null) {
    const body = {
      items: [
        {
          id: parseInt(variantId),
          quantity: quantity,
        },
      ],
    }

    if (properties) {
      body.items[0].properties = properties
    }

    const response = await fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error.description || 'Failed to add to cart')
    }

    return response.json()
  }

  async function updateCartCount() {
    try {
      const response = await fetch('/cart.js')
      const cart = await response.json()

      // Update common cart count selectors
      const selectors = [
        '.cart-count',
        '.cart-count-bubble',
        '[data-cart-count]',
        '.header__cart-count',
        '.site-header__cart-count',
      ]

      selectors.forEach((selector) => {
        const el = document.querySelector(selector)
        if (el) el.textContent = cart.item_count
      })
    } catch (e) {
      console.log('[UL Carousel] Could not update cart count')
    }
  }

  // ========================================
  // Ambient Particles
  // ========================================
  function initAmbientParticles() {
    const container = document.querySelector('.ul-ambient-particles')
    if (!container) return

    // Create particles dynamically
    for (let i = 0; i < 30; i++) {
      const particle = document.createElement('div')
      particle.className = 'ul-particle'
      particle.style.left = `${Math.random() * 100}%`
      particle.style.width = `${3 + Math.random() * 5}px`
      particle.style.height = particle.style.width
      particle.style.animationDuration = `${5 + Math.random() * 10}s`
      particle.style.animationDelay = `${Math.random() * 5}s`
      container.appendChild(particle)
    }
  }

  // ========================================
  // Utility Functions
  // ========================================
  function formatMoney(cents) {
    const amount = cents / 100
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount)
  }

  function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  function getShopFromUrl() {
    const hostname = window.location.hostname
    if (hostname.includes('.myshopify.com')) {
      return hostname
    }
    return hostname
  }
})()
