






const fs = require('fs')
const path = require('path')


const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || 'fastdtftransfer.myshopify.com'
const ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN

if (!ACCESS_TOKEN) {
  console.error('❌ SHOPIFY_ADMIN_ACCESS_TOKEN environment variable required')
  console.log('\nSet it in your terminal:')
  console.log('  $env:SHOPIFY_ADMIN_ACCESS_TOKEN = "shpat_xxxxx"')
  process.exit(1)
}

const THEME_SNIPPETS_DIR = path.join(__dirname, '..', 'theme-snippets')


const FILES = [
  { local: 'assets/shopify-live-shipping.js', remote: 'assets/shopify-live-shipping.js' },
  { local: 'assets/live-shipping-rates.js', remote: 'assets/live-shipping-rates.js' },
  { local: 'assets/delivery-badge-ui.js', remote: 'assets/delivery-badge-ui.js' },
  { local: 'assets/delivery-calculator.js', remote: 'assets/delivery-calculator.js' },
  { local: 'snippets/delivery-scripts.liquid', remote: 'snippets/delivery-scripts.liquid' },
]

async function getThemes() {
  const response = await fetch(`https://${STORE_DOMAIN}/admin/api/2024-01/themes.json`, {
    headers: {
      'X-Shopify-Access-Token': ACCESS_TOKEN,
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to get themes: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  return data.themes
}

async function uploadAsset(themeId, key, content) {
  const response = await fetch(
    `https://${STORE_DOMAIN}/admin/api/2024-01/themes/${themeId}/assets.json`,
    {
      method: 'PUT',
      headers: {
        'X-Shopify-Access-Token': ACCESS_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        asset: {
          key: key,
          value: content,
        },
      }),
    }
  )

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to upload ${key}: ${response.status} - ${error}`)
  }

  return await response.json()
}

async function main() {
  console.log('🚀 Shopify Theme Asset Uploader\n')
  console.log(`Store: ${STORE_DOMAIN}`)

  try {

    console.log('\n📋 Getting themes...')
    const themes = await getThemes()


    const liveTheme = themes.find((t) => t.role === 'main')
    if (!liveTheme) {
      throw new Error('No live theme found')
    }

    console.log(`✅ Live theme: "${liveTheme.name}" (ID: ${liveTheme.id})\n`)


    for (const file of FILES) {
      const localPath = path.join(THEME_SNIPPETS_DIR, file.local)

      if (!fs.existsSync(localPath)) {
        console.log(`⚠️  Skip: ${file.local} (not found)`)
        continue
      }

      const content = fs.readFileSync(localPath, 'utf8')
      console.log(`📤 Uploading: ${file.remote}...`)

      await uploadAsset(liveTheme.id, file.remote, content)
      console.log(`   ✅ Done (${content.length} bytes)`)
    }

    console.log('\n🎉 All files uploaded successfully!')
    console.log('\nNext steps:')
    console.log('1. Go to Shopify Admin → Online Store → Themes → Edit Code')
    console.log('2. Find the product page template (sections/main-product.liquid or similar)')
    console.log("3. Add: {% render 'delivery-scripts' %}")
    console.log('4. Add: <div data-delivery-badge="full"></div> where you want the badge')
  } catch (error) {
    console.error('\n❌ Error:', error.message)
    process.exit(1)
  }
}

main()
