import '@shopify/ui-extensions/preact'
import { render } from 'preact'









export default function extension() {
  console.log('[UL-Checkout] Static line item extension starting...')
  render(<UploadLineDisplay />, document.body)
}

function UploadLineDisplay() {

  const line = shopify.target?.value

  console.log('[UL-Checkout] Line item extension mounted')
  console.log('[UL-Checkout] Target line:', line?.id, line?.merchandise?.title)

  if (!line) {
    console.log('[UL-Checkout] No line available')
    return null
  }


  const attrs = line.attributes || []
  console.log('[UL-Checkout] Line attributes:', JSON.stringify(attrs))

  const uploadId = extractUploadId(attrs)


  if (!uploadId) {
    console.log('[UL-Checkout] No upload on this line item')
    return null
  }


  const designFileUrl = findAttr(attrs, 'Design File')
  const identityUrl = findAttr(attrs, 'Design Identity')
  const uploadUrl = designFileUrl || findAttr(attrs, '_ul_upload_url')
  const thumbnail = findAttr(attrs, '_ul_thumbnail')
  const fileName =
    findAttr(attrs, '_ul_file_name') ||
    fileNameFromUrl(designFileUrl) ||
    'Custom Design'
  const designType = findAttr(attrs, '_ul_design_type') || 'DTF'

  const imageUrl = thumbnail || uploadUrl
  const linkUrl = identityUrl || uploadUrl || thumbnail

  console.log('[UL-Checkout] Rendering upload info:', { uploadId, fileName, designType })


  return (
    <s-stack direction="block" gap="tight" padding="tight">
      <s-stack direction="inline" gap="tight" blockAlignment="center">
        {imageUrl && <s-image source={imageUrl} alt="Design preview" aspectRatio={1} fit="cover" />}
        <s-stack direction="block" gap="extraTight">
          <s-text size="small" emphasis="bold">
            🎨 {fileName}
          </s-text>
          <s-text size="extraSmall" appearance="subdued">
            Type: {designType.toUpperCase()}
          </s-text>
          {linkUrl && (
            <s-link to={linkUrl} external>
              View Design ↗
            </s-link>
          )}
        </s-stack>
      </s-stack>
    </s-stack>
  )
}

function findAttr(attrs, key) {
  if (!attrs || !Array.isArray(attrs)) return null
  const found = attrs.find((a) => a.key === key)
  return found?.value || null
}

// Upload id carriers, most direct first: hidden legacy id, then the
// Design Identity link (/i/<uploadId>), then any attribute value holding an
// identity URL (survives attribute-key rewrites by third-party cart apps).
function extractUploadId(attrs) {
  const direct = findAttr(attrs, '_ul_upload_id')
  if (typeof direct === 'string' && /^[a-z0-9]{16,40}$/.test(direct)) return direct
  if (!Array.isArray(attrs)) return null
  for (const attr of attrs) {
    const value = attr?.value
    if (typeof value !== 'string') continue
    const match = value.match(/\/i\/([a-z0-9]{16,40})(?:\.json)?(?:[?#]|$)/)
    if (match) return match[1]
  }
  return null
}

function fileNameFromUrl(value) {
  if (typeof value !== 'string' || value.indexOf('/') === -1) return null
  try {
    const path = /^https?:\/\//.test(value) ? new URL(value).pathname : value.split('?')[0]
    const segment = decodeURIComponent(path.split('/').filter(Boolean).pop() || '')
    return segment && segment.indexOf('.') > 0 ? segment : null
  } catch (_e) {
    return null
  }
}
