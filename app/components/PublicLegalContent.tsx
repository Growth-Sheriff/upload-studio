export type LegalSection = 'privacy' | 'terms' | 'gdpr' | 'docs' | 'contact' | 'changelog'
export const legalTitles: Record<LegalSection, string> = {
  privacy: 'Privacy policy', terms: 'Terms of service', gdpr: 'Privacy requests',
  docs: 'Getting started', contact: 'Support', changelog: 'Release notes',
}
const content: Record<LegalSection, Array<[string, string]>> = {
  privacy: [
    ['Purpose and operator', 'Auto Gang Sheet Upload, operated by Actualscope, measures finished print files, links them to Shopify orders and calculates the merchant app fee. Contact info@actualscope.com for privacy questions.'],
    ['Data we need', 'We store uploaded artwork and filenames, dimensions, DPI, product configuration, the store domain, authenticated merchant sessions and access tokens, and order/customer identifiers needed to associate a file with a purchase. Order amounts, capture/refund status and fee records support billing. Buyer names, email addresses, postal addresses and phone numbers are not requested.'],
    ['No visitor profiling', 'There are no browser fingerprints, persistent visitor IDs, visitor sessions, advertising attribution, geolocation collection or session replay. Local upload-resume state and file-content hashes are used only to avoid uploading the same bytes again.'],
    ['Retention', 'Unordered files are deleted after 7 days; ordered files and their upload associations after 90 days from upload creation. Operational upload logs expire after 30 days. A minimal fee ledger and its idempotency keys remain while the app is installed so delayed order replays cannot charge twice. Customer export packages expire after 7 days. Uninstall disables processing immediately and schedules full erasure within 48 hours when the deletion worker and storage are available; failures remain visible and retryable.'],
    ['Recipients and security', 'Shopify authenticates installation and collects app fees. PostgreSQL stores app records, Redis carries transient work and Cloudflare R2 stores files in the independent public deployment. No artwork is sold or used to train models. Tenant-scoped queries and signed download capabilities restrict access; TLS and provider encryption protect transfer and storage. Actual hosting region and contractual subprocessors must be published before launch.'],
    ['Your rights', 'Ask the merchant or info@actualscope.com for access or erasure. Shopify privacy webhooks trigger durable export and deletion work, including stored files. Minimum financial records can remain while an accounting dispute is unresolved; they contain order identifiers and amounts rather than buyer contact details. We do not knowingly solicit children’s personal information.'],
  ],
  terms: [
    ['What the service does', 'The upload is a finished production sheet. The app measures and prices it; it does not rearrange, nest or combine designs. Quantity is the number of copies printed. The merchant is responsible for printable limits, variant sizes, rates and production quality.'],
    ['App charges', 'The merchant pays 3.5% of attributable captured net merchandise per order, capped at USD 6 per order, through Shopify usage billing. Taxes, shipping and unrelated items are excluded. There is no fixed monthly subscription charge, trial fee or external card collection. A merchant-approved 30-day spending limit applies; an increase requires Shopify approval.'],
    ['Cancellations and refunds', 'Unpaid or cancelled orders are not charged. A full refund before fee collection voids the fee. Already submitted Shopify usage records are not reversible: eligible cancellation/refund cases become auditable credit-review requests. Partial refunds are reviewed manually. Unknown provider outcomes are quarantined, never blindly charged with a new key.'],
    ['Artwork and access', 'Upload only artwork you may lawfully print. You retain ownership and grant the limited permission needed to store, measure, preview and supply it to the merchant. Keep the print and identity links private: they are bearer capabilities. Files are not permanent archives; download production files within the retention period.'],
    ['Service limitations', 'Large or unsupported files may require processing or manual review. No unmeasurable or non-printable file should be orderable through the app. The merchant remains the seller of the physical product and handles shipping, print disputes and buyer refunds. Contact support for app errors or disputed app fees.'],
  ],
  gdpr: [
    ['Request access', 'Contact your merchant or info@actualscope.com. Shopify customers/data_request events create an export of the stored customer-associated file and order records, available to the authenticated merchant for 7 days.'],
    ['Request erasure', 'customers/redact blocks the affected uploads, waits for existing direct-upload capabilities to expire, then deletes associated files and records. shop/redact removes the store prefix, incomplete multipart uploads, sessions and store records. Processing failures are retained for retry rather than acknowledged as completed.'],
    ['Merchant visibility', 'The Privacy requests page shows queued, processing, completed or retrying requests and downloadable exports. No customer email is needed to locate a request: Shopify supplies the signed customer/order identifiers.'],
  ],
  docs: [
    ['1. Configure a product', 'Open Setup, select an existing Shopify product, choose variant sheets or measured-length pricing and enter the printable width. The visible defaults are 22.5 inches wide, 240 inches maximum length for custom pricing, and 0.02 inch export tolerance. Custom pricing requires your own per-inch rate.'],
    ['2. Approve billing and enable the block', 'Approve the Shopify usage subscription on Billing, then add the matching app block in the Shopify theme editor on the product template. No theme file edits or external account are required. The app proxy is /apps/customizer by default; if you change it in Shopify, update the block API-path setting.'],
    ['3. Print the customer’s file', 'Upload, measurement, sheet/price confirmation and cart preparation preserve the three order properties: Print Ready, Sheet Identity and DPI. Use Print Ready for production; use Sheet Identity to inspect the measurement. Checkout display is optional, and the checkout-step target requires Shopify Plus.'],
    ['Measurement', 'The existing finished-sheet orientation policy chooses the printable orientation that consumes the least film. PNG/JPEG headers are validated on the server before price authority accepts them. Other formats use bounded image workers. A file over the printable width or length ceiling is rejected, not split or nested.'],
  ],
  contact: [['Contact support', 'Email info@actualscope.com with your shop domain, upload or Shopify order number and a brief description. Do not send customer payment details or unnecessary personal data. Support messages are used only to resolve your request.']],
  changelog: [['Public application branch — 9 October 2026', 'Independent single-app architecture, durable multishop sessions, mandatory row isolation, bounded fair workers, Shopify usage billing, removal of visitor tracking and durable privacy workflows. This page describes the public branch; registration, hosted deployment and App Store review remain separate release gates.']],
}

export function PublicLegalContent({ section }: { section: LegalSection }) {
  return <article>
    <h1>{legalTitles[section]}</h1>
    <p>Auto Gang Sheet Upload · Effective release draft, 9 October 2026</p>
    {content[section].map(([title, body]) => <section key={title} style={{ marginBlock: '1.5rem' }}><h2>{title}</h2><p style={{ lineHeight: 1.65 }}>{body}</p></section>)}
    <p><a href="mailto:info@actualscope.com">info@actualscope.com</a></p>
  </article>
}
