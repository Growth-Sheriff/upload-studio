# Auto Gang Sheet Upload — listing and review draft

Not submitted. Contact/support: info@actualscope.com. Register only under the verified Actualscope account, never the existing Growth Sheriff Shopify organization.

## Listing copy

Subtitle: Measure ready-to-print gang sheets and match your sheet prices.

Description: Let customers upload their finished DTF gang sheet on your product page. Validate printable dimensions, select a fitting Shopify sheet variant or calculate a merchant-configured measured-length price, and keep the print file attached to the order. Staff can inspect the sheet identity and download the customer's production file. Quantity prints the complete file again: no automatic nesting, arrangement or redesign is implied.

- Product-specific printable limits and visible export-rounding tolerance.
- Variant-sheet matching or server-authoritative per-inch checkout.
- Large-file uploads with resumable transfer and bounded processing.
- Print Ready, Sheet Identity and DPI on the order line.
- Shopify-billed usage: 3.5% of app-served captured merchandise, max US$6 per order.

Pricing display: Free to install; additional charges may apply. No monthly base fee. Usage fees and the merchant-approved 30-day cap must be displayed in the pricing section with the exact billing terms. Cancelled/unpaid/full-refunded-before-collection orders incur no fee. Recorded adjustments require Shopify credit review; link the policy. Do not market this as a free plan without disclosing usage.

Checkout display requires Plus on checkout steps and is optional; ordinary upload/cart/production functionality is not Plus-only. List supported formats actually verified by worker tests, not hypothetical file types. No inflated reviews, price saving claims or artificial counters.

## Review procedure and screenshots (pending live demo)

`assets/icon-draft.svg` is the editable native vector source. The actual new-app settings request1200×1200 PNG/JPG, at most1MB; assets/icon-1200.png is its visually inspected1200×1200/56,034-byte PNG export. It has not been uploaded: Chrome's extension lacks file-URL access and the owner must enable that permission. Product screenshots and review video must come from the real demo, not a fabricated UI mockup.

Create three independent development stores, install this one public app in all, approve provider test usage billing and configure products in Setup. Demo A uses variants 22x12/22x24/22x80; B uses measured-length rate0.30 in store currency, width22.5 and max length240; C proves data separation. Product configuration is self-service; do not write products_config rows by hand.

Run a real test checkout and capture: setup/visible settings, product uploader with authoritative measurement, cart showing exactly three properties, Shopify order with the correct print link, admin production identity, usage billing record and duplicate delivery proof. Use only synthetic artwork and demo identities in screenshots. Capture the cap approval and cap-exceeded state. Include keyboard navigation, mobile upload/server-preview fallback and large-file failure/retry evidence.

Provide a review video/credentials for the demo only, published policy/help links on the actual public host, icon and real screenshots. Registration, demo credentials, actual application URLs and screenshots cannot be fabricated from local tests. No listing images or review materials are represented as live evidence in this run.

Review notes: finished-sheet orientation chooses the printable direction consuming the least film; copy quantity is never nesting. PNG/JPEG cheap server header validation protects the price from tampered browser dimensions. Other formats use time/memory-bounded image workers. Three privacy topics have durable HMAC acceptance and actual cleanup. External merchant card collection and visitor tracking have been deleted.
