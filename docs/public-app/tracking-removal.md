# Data minimization: tracking removed

Public branch only. Visitor and session collection endpoints, person reports,
attribution/cohort analysis, geolocation provider, tracking embed, analytics globals,
consent banner for the retired tracking feature, upload telemetry helper and remote
telemetry worker are deleted. Upload/order lifecycle no longer writes counters or
links records to browser identities. Staff see uploads and order/production facts;
the dashboard retains only shop-scoped operational totals.

Two additional collectors were found during dependency review and removed:

- Remote console interception sent console payloads, full page URL, user agent and
  IP to `api/debug/log`. Both sender and endpoint are deleted.
- Hardcoded Sentry browser tracing/session replay and its test pages are deleted.
  Server logging changes are handled by the public runtime workstream.
- Automatic `ipapi.co` lookup in the delivery badge is deleted. The shipping helper
  uses the shopper's chosen postal destination or the configured warehouse estimate.
  Its new cache key cannot reuse old IP-inferred location data.

## Pricing identity and operational UI

Signed Shopify customer IDs can select an explicit merchant-entered account
rate. The public app neither queries the customer directory nor matches email,
name or tags. The old profile search/CSV/tag editor is replaced by a small ID
assignment, per-product rate and volume-tier editor. Existing product overrides,
measurement policy, rates and unknown configuration keys round-trip unchanged;
contact fields are stripped on account saves. Saved paid sheet volume remains
the operational basis of optional eligibility, not a visitor profile.

The product editor/onboarding can explicitly configure a public measured-length
base rate with `builderConfig.publicPricingMode = measured_length` and positive
`pricePerInch`. Guests and standard accounts get this rate without a private
assignment or inch-carrier variant; an explicit account/volume custom price wins.
Native cart-property preparation refuses these products, so a failed account
context request cannot silently substitute a variant price. The guest/session
holder receives a clear re-upload message when its checkout token is missing.
Signed-in uploads retain exact customer-ID ownership. A guest upload requires a
separate shop-and-upload checkout capability issued with its upload intent or a
verified multipart resume. Public status/identity links never issue this token.
It is upload possession, not a persistent browser identity. Missing tokens on an
old guest session require a fresh upload; an existing order remains immutable.

## Storefront connection and honest product information

All uploader blocks and the cart embed expose their storefront app proxy path;
the default remains `/apps/customizer`. A merchant who renames the Shopify proxy
must enter the same `/apps/name` value in each uploader block/cart embed. Values
are validated as local paths, never arbitrary remote endpoints.
Multipart complete/abort requests also use that validated local path, rather
than the old storage helper's fixed `/apps/customizer` URLs. Merchant-authored
per-inch rates display in the Liquid shop currency until the authoritative quote
confirms it, rather than silently assuming USD or a Markets presentment currency.
The public blocks currently support customized `/apps/name` paths; other Shopify
proxy prefixes require a deliberate follow-up validation change.
The listing and
showcase blocks link to product pages and make no upload API requests. Synthetic
review counts, hardcoded stars and the unused fake-review setting are removed;
these blocks do not claim customer reviews the merchant never supplied.

## Public measured-price correction

An inherited second computation used `Math.max(widthIn, heightIn)` after the
central finished-sheet policy already supported turning a short sheet to consume
less film. This disagreed with the client and the owner's newest model. The
measured quote and its volume-tier input now use the central orientation chooser
with the configured printable width/tolerance. At a 22.5-inch press limit,
22×6 and 6×22 both bill 6 inches: at $0.30/in, $6.60 becomes $1.80. An 80×22 file
still bills 80 inches. At a 10-inch limit the 22×6 file bills 22 inches. This is an
explicit approved public-branch correction, not an unnoticed price difference.
No orientation chooser, embedded-DPI rule or deployed custom app is changed.

## Direct file-write capabilities and retired external services

Local/Bunny upload URLs use a short-lived v2 signature covering shop ID,
provider, exact object key, byte size and expiry. Direct requests bind the signed
tenant before any guarded query, verify the object's canonical prefix against
the persisted shop domain, and refuse an erasing shop or a redacted/non-draft
upload. A caller cannot select a different shop using URL/body parameters or
change a token's shop ID. Public deployment starts fresh, so legacy unscoped
upload tokens are deliberately not accepted.

Repository-wide caller search found no storefront or admin caller for the old
`api.remove-bg` endpoint. It accepted arbitrary image URLs and spent a global
paid-provider credential without authentication. The orphan endpoint is removed
from the public app; finished-sheet uploads are printed as supplied and do not
require background removal.

The orphan `api.mockup.generate`/`api.mockup.callback` routes are also removed.
No shipped UI calls them. Their queue targeted a separately deployed legacy
`us-mockup-worker` using a custom Redis namespace, not the public worker runtime;
its callback supplied no authentication or persisted owner identity. We do not
silently connect the new public app to that legacy service. The standalone legacy
worker sources and client-side garment previews remain untouched. Reintroducing
server garment compositing would require a public-owned queue, tenant-bound
job authorization, authenticated callbacks and storage-retention coverage.

Static scan of the freshly compiled `build/client` found no collector globals,
tracking endpoint paths, `sendBeacon`, browser replay/tracing hooks or IP
geolocation call. This is compiled-source evidence, not a claim of a live
storefront Network-panel verification.

## Permitted search matches

Reproduce with:

```powershell
rg -n -i 'visitor|fingerprint|utm_|gclid|telemetry|analytics' app extensions prisma
```

Every retained `fingerprint` in these locations represents file bytes, not a device:

- `app/lib/uploadFingerprint.ts` and its tests: validates the versioned content hash;
  sampled hashes resume transport but cannot skip file transfer; full hashes can.
- `app/routes/api.upload.intent.tsx`: same shop, signed logged-in customer and full
  content hash are required before reusing a previously measured file.
- `app/routes/api.upload.multipart-resume.tsx`: resumes the selected file's upload.
- `extensions/theme-extension/assets/ul-file-probe.js`: hashes file byte samples.
- `main-product-upload-app.js` and `custom-price-upload-mod2.js`: per-file multipart
  progress in local storage, cleared on completion/expiry; no browser identity.
- `prisma/schema.prisma` and `prisma/add_cart_token.sql`: UploadItem content hash
  column/index. The obsolete visitor models and Upload identity relations are removed
  by the dedicated public schema migration.

The `factFingerprint` in `orderReconciler.server.ts` is a deterministic snapshot of
payment/cancellation/refund facts used to deduplicate order review records. It neither
identifies a browser nor profiles a person; order/provider accounting idempotency stays.

Privacy-policy text and removal tests may name the retired tracking categories to
state their absence or prevent reintroduction. Migration DROP statements may name
the retired models to remove them. These are not runtime collection exceptions.

## Evidence boundary

Local focused run on 2026-10-09:

```text
npx vitest run app/lib/publicCustomerPricingEditor.test.ts app/lib/customerPricingRuntime.server.test.ts app/lib/publicTrackingRemoval.test.ts app/lib/uploadFingerprint.test.ts app/lib/publicStorefrontProxy.test.ts app/lib/uploadCheckoutCapability.server.test.ts app/lib/customerPricingModel.server.test.ts app/lib/customerPricing.server.test.ts
8 test files passed; 46 tests passed.
npx vitest run app/lib/publicMeasuredCheckout.server.test.ts
1 test file passed; 3 tests passed.
```

The checkout test constructs a guest 22×6 PNG with no product variants and two
copies at $0.30/in: quote $3.60, 12 billable inches, no linked carrier variant.
It also proves that guessing an upload ID without a capability fails, and that
a guest token cannot bypass a signed-in upload owner's ID. Every extension asset
was parsed with `node --check`; every block schema was parsed as JSON. Typecheck
was green for the changed files after fixes to inherited dashboard Grid/JSON and
file-response/GraphQL response typing. The root workstream records the complete
suite, build and regression-harness evidence separately.

Source deletion and asset syntax checks can be proven locally. This document does
not claim a live browser Network check: that requires the independent public app's
demo storefront, which must be recorded separately in verification.md. Existing
custom deployments, database rows and tenant configurations were not changed.
