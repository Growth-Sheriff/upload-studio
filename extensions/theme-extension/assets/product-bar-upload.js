/**
 * Upload Studio - Product Bar JavaScript
 * Version: 1.0.0
 *
 * Handles:
 * - Upload modal functionality
 * - File upload with preview
 * - Sheet size selection
 * - Quantity controls
 * - Add to Cart integration
 * - 3D T-Shirt viewer initialization
 * - Floating cart button
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
      'image/svg+xml',
      'image/tiff',
      'image/vnd.adobe.photoshop',
      'application/pdf',
      'application/postscript',
    ],
    allowedExtensions: [
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
    ],
  }

  // Sheet sizes with prices
  const SHEET_SIZES = [
    { id: '22x6', name: '22" x 6"', price: 7.5 },
    { id: '22x12', name: '22" x 12"', price: 12.0 },
    { id: '22x24', name: '22" x 24"', price: 22.0 },
    { id: '22x60', name: '22" x 60"', price: 50.0 },
  ]

  // ========================================
  // State
  // ========================================
  const state = {
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
    console.log('[UL Product Bar] Initializing...')

    initUploadTriggers()
    initUploadModal()
    initAddToCartButtons()
    initFloatingCart()
    initMiniTshirtViewers()

    console.log('[UL Product Bar] Initialized successfully')
  }

  // ========================================
  // Upload Triggers
  // ========================================
  function initUploadTriggers() {
    const triggers = document.querySelectorAll('.ul-upload-trigger-btn')

    triggers.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()

        const card = btn.closest('.ul-product-bar-item')
        if (card) {
          openUploadModal(card)
        }
      })
    })
  }

  // ========================================
  // Upload Modal
  // ========================================
  function initUploadModal() {
    const overlays = document.querySelectorAll('.ul-upload-modal-overlay')

    overlays.forEach((overlay) => {
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
        resetModalState(overlay)
      }

      // Close handlers
      if (closeBtn) {
        closeBtn.addEventListener('click', closeModal)
      }

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal()
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
          if (files.length > 0) handleFile(files[0], overlay)
        })

        fileInput.addEventListener('change', (e) => {
          if (e.target.files.length > 0) handleFile(e.target.files[0], overlay)
        })
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

          updateTotal(overlay)
        })
      }

      // Size selection
      sizeButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
          sizeButtons.forEach((b) => b.classList.remove('active'))
          btn.classList.add('active')
          state.selectedSize = btn.dataset.size
          updateTotal(overlay)
        })
      })

      // Quantity controls
      if (qtyMinus) {
        qtyMinus.addEventListener('click', () => {
          if (state.quantity > 1) {
            state.quantity--
            if (qtyInput) qtyInput.value = state.quantity
            updateTotal(overlay)
          }
        })
      }

      if (qtyPlus) {
        qtyPlus.addEventListener('click', () => {
          if (state.quantity < 100) {
            state.quantity++
            if (qtyInput) qtyInput.value = state.quantity
            updateTotal(overlay)
          }
        })
      }

      if (qtyInput) {
        qtyInput.addEventListener('change', (e) => {
          let val = parseInt(e.target.value) || 1
          val = Math.max(1, Math.min(100, val))
          state.quantity = val
          qtyInput.value = val
          updateTotal(overlay)
        })
      }

      // Add to cart
      if (addToCartBtn) {
        addToCartBtn.addEventListener('click', async () => {
          if (!state.uploadedFile || !state.currentProduct) return

          addToCartBtn.disabled = true
          if (checkoutBtn) checkoutBtn.disabled = true

          // Progress callback for button text
          const progressCallback = (progress) => {
            addToCartBtn.innerHTML = `<svg class="ul-spinner" width="18" height="18" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" stroke-dasharray="60" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/></circle></svg> ${progress.text}`
          }

          addToCartBtn.innerHTML =
            '<svg class="ul-spinner" width="18" height="18" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" stroke-dasharray="60" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/></circle></svg> Uploading...'

          try {
            // Upload file with progress tracking
            const uploadResult = await uploadFile(state.uploadedFile, progressCallback)

            // Update preview with upload duration
            const preview = overlay.querySelector('.ul-modal-upload-preview')
            if (preview) {
              const fileSize = preview.querySelector('.ul-file-size')
              if (fileSize) {
                fileSize.textContent = `${formatFileSize(state.uploadedFile.size)} • Uploaded in ${uploadResult.uploadDuration}s`
              }
            }

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
              '<svg class="ul-spinner" width="18" height="18" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" stroke-dasharray="60" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/></circle></svg> Adding to cart...'

            // Add to cart
            await addToCartApi(state.currentProduct.variantId, state.quantity, properties)

            // Success
            addToCartBtn.innerHTML =
              '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg> Added!'
            addToCartBtn.classList.add('success')

            // Update cart count
            updateCartCount()

            setTimeout(closeModal, 1500)
          } catch (error) {
            console.error('[UL Product Bar] Error:', error)
            addToCartBtn.disabled = false
            if (checkoutBtn) checkoutBtn.disabled = false
            addToCartBtn.innerHTML =
              '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg> Try Again'
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
            checkoutBtn.innerHTML = `<svg class="ul-spinner" width="18" height="18" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" stroke-dasharray="60" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/></circle></svg> ${progress.text}`
          }

          checkoutBtn.innerHTML =
            '<svg class="ul-spinner" width="18" height="18" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" stroke-dasharray="60" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/></circle></svg> Uploading...'

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
              '<svg class="ul-spinner" width="18" height="18" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" stroke-dasharray="60" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/></circle></svg> Adding to cart...'

            // Add to cart
            await addToCartApi(state.currentProduct.variantId, state.quantity, properties)

            // Redirect to checkout
            window.location.href = '/checkout'
          } catch (error) {
            console.error('[UL Product Bar] Error:', error)
            checkoutBtn.disabled = false
            if (addToCartBtn) addToCartBtn.disabled = false
            checkoutBtn.innerHTML =
              '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg> Try Again'
            alert('Failed to proceed to checkout. Please try again.')
          }
        })
      }
    })

    // Global escape key handler
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.modalOpen) {
        const activeOverlay = document.querySelector('.ul-upload-modal-overlay.active')
        if (activeOverlay) {
          activeOverlay.classList.remove('active')
          document.body.style.overflow = ''
          state.modalOpen = false
        }
      }
    })
  }

  function openUploadModal(card) {
    // Prevent opening in Shopify theme editor
    if (window.Shopify && window.Shopify.designMode) return

    // Find the modal in the same section
    const section = card.closest('.ul-product-bar')
    const overlay = section?.querySelector('.ul-upload-modal-overlay')

    if (!overlay) {
      console.error('[UL Product Bar] Modal not found')
      return
    }

    // Get product info from card
    const productId = card.dataset.productId
    const productHandle = card.dataset.productHandle
    const variantId = card.dataset.variantId
    const productTitle = card.dataset.productTitle || 'Product'
    const productPrice = card.dataset.productPrice || '$0.00'
    const productImage = card.dataset.productImage || ''

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

    // Reset state
    resetModalState(overlay)

    // Show modal
    state.modalOpen = true
    overlay.classList.add('active')
    document.body.style.overflow = 'hidden'

    // Update total
    updateTotal(overlay)
  }

  function resetModalState(overlay) {
    state.uploadedFile = null
    state.uploadedFileUrl = null
    state.selectedSize = '22x12'
    state.quantity = 1

    const uploadZone = overlay.querySelector('.ul-modal-upload-zone')
    const preview = overlay.querySelector('.ul-modal-upload-preview')
    const qtyInput = overlay.querySelector('.ul-modal-qty-input')
    const sizeButtons = overlay.querySelectorAll('.ul-modal-size-btn')
    const addToCartBtn = overlay.querySelector('.ul-modal-add-cart')
    const checkoutBtn = overlay.querySelector('.ul-modal-checkout')

    if (uploadZone) uploadZone.style.display = ''
    if (preview) preview.style.display = 'none'
    if (qtyInput) qtyInput.value = 1

    sizeButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.size === '22x12')
    })

    if (addToCartBtn) {
      addToCartBtn.disabled = true
      addToCartBtn.innerHTML =
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg> Add to Cart'
      addToCartBtn.classList.remove('success')
    }

    if (checkoutBtn) {
      checkoutBtn.disabled = true
      checkoutBtn.innerHTML =
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg> Checkout'
    }
  }

  function handleFile(file, overlay) {
    // 0-byte file protection: Reject empty files immediately
    if (!file.size || file.size === 0) {
      alert('The selected file is empty (0 bytes). Please select a valid file.')
      console.error('[Product Bar Upload] 0-byte file rejected:', file.name)
      return
    }

    // Validate file type - check both MIME type and extension
    const ext = file.name.split('.').pop()?.toLowerCase() || ''
    if (!CONFIG.allowedTypes.includes(file.type) && !CONFIG.allowedExtensions.includes(ext)) {
      alert('Invalid file type. Please upload PNG, JPG, WebP, TIFF, PSD, PDF, SVG, AI, or EPS.')
      return
    }

    // Validate file size
    if (file.size > CONFIG.maxFileSize) {
      alert('File too large. Maximum size is 1.4GB.')
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
      console.log('[UL-ProductBar] Non-browser format, using spinner:', ext)
    } else {
      state.uploadedFileUrl = URL.createObjectURL(file)
    }

    // Show preview
    const uploadZone = overlay.querySelector('.ul-modal-upload-zone')
    const preview = overlay.querySelector('.ul-modal-upload-preview')

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

    updateTotal(overlay)
  }

  function updateTotal(overlay) {
    const totalEl = overlay.querySelector('.ul-modal-total-price')
    const addToCartBtn = overlay.querySelector('.ul-modal-add-cart')
    const checkoutBtn = overlay.querySelector('.ul-modal-checkout')

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

  // ========================================
  // Add to Cart Buttons (without upload)
  // ========================================
  function initAddToCartButtons() {
    const buttons = document.querySelectorAll('.ul-product-bar-item .ul-add-to-cart-btn')

    buttons.forEach((btn) => {
      if (btn.classList.contains('ul-sold-out')) return

      btn.addEventListener('click', async (e) => {
        e.preventDefault()
        e.stopPropagation()

        const variantId = btn.dataset.variantId
        if (!variantId) return

        const originalHtml = btn.innerHTML
        btn.disabled = true
        btn.innerHTML =
          '<svg class="ul-spinner" width="18" height="18" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" stroke-dasharray="60" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/></circle></svg>'

        try {
          await addToCartApi(variantId, 1)

          btn.classList.add('success')
          btn.innerHTML =
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg> Added!'

          updateCartCount()

          setTimeout(() => {
            btn.classList.remove('success')
            btn.innerHTML = originalHtml
            btn.disabled = false
          }, 2000)
        } catch (error) {
          console.error('[UL Product Bar] Add to cart error:', error)
          btn.innerHTML = originalHtml
          btn.disabled = false
          alert('Failed to add to cart. Please try again.')
        }
      })
    })
  }

  // ========================================
  // Floating Cart
  // ========================================
  function initFloatingCart() {
    const floatingBtns = document.querySelectorAll('.ul-floating-cart-btn')

    floatingBtns.forEach((btn) => {
      // Periodic shake
      setInterval(() => {
        btn.classList.add('shake')
        setTimeout(() => {
          btn.classList.remove('shake')
        }, 600)
      }, 5000)
    })
  }

  // ========================================
  // 3D T-Shirt Viewers
  // ========================================
  function initMiniTshirtViewers() {
    const canvases = document.querySelectorAll('.ul-mini-tshirt-canvas')
    if (canvases.length === 0) return

    // Check if Three.js is loaded
    if (typeof THREE === 'undefined') {
      console.log('[UL Product Bar] Three.js not loaded, retrying...')
      setTimeout(initMiniTshirtViewers, 500)
      return
    }

    if (typeof THREE.GLTFLoader === 'undefined') {
      console.log('[UL Product Bar] GLTFLoader not loaded, retrying...')
      setTimeout(initMiniTshirtViewers, 500)
      return
    }

    console.log('[UL Product Bar] Three.js ready, initializing 3D viewers...')

    // Get model path from Shopify assets
    const section = document.querySelector('.ul-product-bar')
    const modelPath = section?.dataset.modelPath || '/apps/product-3d-customizer/shirt_baked.glb'

    const lightColors = ['#7dd3fc', '#f472b6', '#fbbf24', '#86efac', '#a5b4fc', '#fca5a5']

    canvases.forEach((canvas, index) => {
      const container = canvas.parentElement
      const containerWidth = container.clientWidth || 200

      // Scene
      const scene = new THREE.Scene()
      scene.background = new THREE.Color(0xf0f0f8)

      // Camera
      const camera = new THREE.PerspectiveCamera(25, 1, 0.1, 100)
      camera.position.set(0, 0, 2.5)

      // Renderer
      const renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        antialias: true,
        alpha: false,
      })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.setSize(containerWidth, containerWidth)
      renderer.outputEncoding = THREE.sRGBEncoding

      // Lighting
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.5)
      scene.add(ambientLight)

      const keyLight = new THREE.DirectionalLight(0xffffff, 0.8)
      keyLight.position.set(3, 5, 5)
      scene.add(keyLight)

      const fillLight = new THREE.DirectionalLight(0xffffff, 0.4)
      fillLight.position.set(-3, 3, 3)
      scene.add(fillLight)

      // Color for this card
      const colorIndex = index % lightColors.length
      const shirtColor = new THREE.Color(lightColors[colorIndex])

      // Load model
      const loader = new THREE.GLTFLoader()

      loader.load(
        modelPath,
        function (gltf) {
          console.log('[UL Product Bar] Mini shirt loaded for card', index)
          const model = gltf.scene

          model.traverse(function (child) {
            if (child.isMesh) {
              child.material = new THREE.MeshStandardMaterial({
                color: shirtColor,
                roughness: 0.85,
                metalness: 0,
              })
            }
          })

          scene.add(model)

          let rotation = 0
          function animate() {
            requestAnimationFrame(animate)
            rotation += 0.01
            model.rotation.y = rotation
            renderer.render(scene, camera)
          }
          animate()
        },
        undefined,
        function (error) {
          console.error('[UL Product Bar] Mini shirt load error:', error)
          // Fallback - create simple box
          const geometry = new THREE.BoxGeometry(0.6, 0.8, 0.2)
          const material = new THREE.MeshStandardMaterial({ color: shirtColor, roughness: 0.85 })
          const fallback = new THREE.Mesh(geometry, material)
          scene.add(fallback)

          let rotation = 0
          function animate() {
            requestAnimationFrame(animate)
            rotation += 0.01
            fallback.rotation.y = rotation
            renderer.render(scene, camera)
          }
          animate()
        }
      )
    })
  }

  // ========================================
  // File Upload API with Progress Tracking
  // ========================================
  async function uploadFile(file, progressCallback) {
    const section = document.querySelector('.ul-product-bar')
    const apiBase = section?.dataset.apiBase || CONFIG.apiBase
    const shopDomain = window.Shopify?.shop || getShopFromUrl()

    // Get customer info if logged in
    const customerId = window.ULCustomer?.id || null
    const customerEmail = window.ULCustomer?.email || null

    // Track upload start time
    const uploadStartTime = Date.now()

    // 1. Create upload intent
    if (progressCallback)
      progressCallback({ phase: 'intent', percent: 5, text: 'Getting upload URL...' })

    const intentResponse = await fetch(`${apiBase}/api/upload/intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shopDomain,
        fileName: file.name,
        contentType: file.type,
        fileSize: file.size,
        mode: 'dtf',
        customerId: customerId ? String(customerId) : null,
        customerEmail: customerEmail,
      }),
    })

    if (!intentResponse.ok) {
      throw new Error('Failed to create upload intent')
    }

    const intentData = await intentResponse.json()
    const { uploadId, itemId, uploadUrl, storageProvider, uploadHeaders, publicUrl, key } =
      intentData

    // 2. Upload to storage with XHR for progress tracking
    if (progressCallback)
      progressCallback({ phase: 'upload', percent: 10, text: 'Uploading... 0%' })

    const xhrStartTime = Date.now()

    const uploadResponse = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && progressCallback) {
          const percent = Math.round((e.loaded / e.total) * 100)
          const elapsed = (Date.now() - xhrStartTime) / 1000
          const speed = elapsed > 0 ? e.loaded / elapsed : 0
          const remaining = speed > 0 ? (e.total - e.loaded) / speed : 0

          const speedMB = (speed / (1024 * 1024)).toFixed(1)
          const remainingSec = Math.ceil(remaining)

          let text
          if (remainingSec > 60) {
            text = `Uploading... ${percent}% • ${speedMB} MB/s • ~${Math.ceil(remainingSec / 60)}m remaining`
          } else if (remainingSec > 0) {
            text = `Uploading... ${percent}% • ${speedMB} MB/s • ~${remainingSec}s remaining`
          } else {
            text = `Uploading... ${percent}%`
          }

          // Progress bar: 10% to 80% range for upload phase
          progressCallback({ phase: 'upload', percent: 10 + percent * 0.7, text })
        }
      }

      xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status })
      xhr.onerror = () => reject(new Error('Network error during upload'))
      // v4.4.0: No timeout for large file uploads
      // xhr.ontimeout = () => reject(new Error('Upload timeout'))

      if (storageProvider === 'bunny' || storageProvider === 'r2') {
        // Direct PUT to CDN storage
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

    if (!uploadResponse.ok) {
      throw new Error('Failed to upload file')
    }

    // 3. Complete upload
    if (progressCallback)
      progressCallback({ phase: 'complete', percent: 85, text: 'Finalizing...' })

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

    // Calculate total upload duration
    const uploadDuration = (uploadDurationMs / 1000).toFixed(1)

    if (progressCallback)
      progressCallback({ phase: 'done', percent: 100, text: `Uploaded in ${uploadDuration}s` })

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
        '.ul-floating-cart-count',
      ]

      selectors.forEach((selector) => {
        document.querySelectorAll(selector).forEach((el) => {
          el.textContent = cart.item_count
        })
      })

      // Trigger cart refresh event
      document.dispatchEvent(new CustomEvent('cart:refresh'))
    } catch (e) {
      console.log('[UL Product Bar] Could not update cart count')
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
    return hostname
  }
})()
