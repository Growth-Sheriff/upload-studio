# Auto Gang Sheet Upload — actual AI self-review

Reviewed 10 October 2026, on `public-app` only. This is a requirement-by-requirement source and existing-evidence review, not Shopify approval, a new live test, or a security certification. No browser, deployment, billing, queue, production-data or provider mutation was performed by this review. Only this document is its output.

## Canonical list and reviewed revision

The complete official [App Store AI self-review requirements](https://shopify.dev/docs/apps/launch/app-store-review/app-store-ai-self-review-requirements) were fetched successfully through Shopify CLI, not reconstructed from memory or a web-search substitute:

```powershell
npx.cmd --yes --package @shopify/cli@4.8.0 shopify doc fetch --url https://shopify.dev/docs/apps/launch/app-store-review/app-store-ai-self-review-requirements --output C:\Users\mhmmd\.codex\tmp\agsu-ai-review-20261010\requirements.md --no-color
```

This is a permitted `doc` command, not a 4.x `app` command. The fetched file has 449 lines and 100 numbered requirements; SHA256 `8344CF11677E42569E83F4CA5C94317EAD3ABAECE18AB3AAE21C0F6CFC5488D0`. It contains sections 1, 2, 3 and category-specific section 5; a missing section 4 was not silently invented. All 100 IDs are accounted for below: 40 in the general/theme/checkout tables and 60 in explicitly excluded category groups.

Source baseline inspected: `7c072fd1a81081007e2da2312ce2b0d29f59ef40`; local HEAD at the initial audit was `1d8f6a633b0a89aaa34c8fa3338eb8ae368bd854`, with no `app/` or `extensions/` source difference from that baseline. The release owner records actual deployment of 7c072fd on only NEW droplet 607746803 at 05:18:58 UTC and extension version `1161996697601`. The clean CI has 440 passing tests/zero skips; these do not certify all live UI paths. The exact subsequent source-only remediation `4caec32e64cf2931c42800c117ef0005fbb76efc` was independently reread before finalizing this document; its deployment/live verification is not yet evidenced here. See [verification](verification.md).

Result meanings:

- **PASS**: the specifically stated source condition or cited actual evidence satisfies this check. Source-only passes are labeled; they are not claimed live interaction tests.
- **FAIL**: a concrete contradiction was found in the reviewed source, described with its narrow scope.
- **NEEDS REVIEW**: implementation evidence exists, but an applicable acceptance condition lacks real proof or needs a disposition.
- **N/A**: the particular feature/scope/category does not exist; the reason is explicit.

## Concrete findings and release boundary

Two source findings were raised immediately to the release owner. A separate agent implemented the owner-authorized narrow fixes in `4caec32e64cf2931c42800c117ef0005fbb76efc`; this review independently reread its exact three-file diff and does not itself edit runtime source:

1. **2.3.1 — manual shop entry, initially FAIL; now source-remediated.** In 7c072fd, `app/routes/auth.login.tsx:88-105` rendered a top-level **Shop domain** form when no embedded/recovery context existed. Embedded recovery was already Shopify-directed, but the canonical rule prohibits prompting for manual shop-domain entry. The final diff removes the form/input and always renders the existing Shopify-admin recovery link; loader/action SDK OAuth behavior is unchanged. A direct `/auth/login` visit reproduces the original source branch without installation, but no new browser observation is claimed here.
2. **1.1.4 — inaccurate link-lifetime claim, initially FAIL; now source-remediated.** `app/components/PublicLegalContent.tsx:15,29` described signed links as short-lived/expiring. `app/lib/uploadCapability.server.ts:12-29` signs shop/upload IDs with no expiry, and `app/lib/uploadUrls.server.ts:18,72,81` gives file wrappers a 365-day TTL. The final text now distinguishes durable production/identity bearer links from separately expiring direct-storage URLs. Access policy, retention, token TTLs, existing legal version and receipts are unchanged.

Final reviewed-source tally: **22 PASS, 6 NEEDS REVIEW, 72 N/A; 0 unresolved source FAIL** in the 100-ID canonical list. The original two FAIL findings remain recorded above and in the row explanations; the deployed 7c baseline still contains them until the separate remediation is released. The remediation agent reports 15 focused tests and typecheck passing; this review read the diff rather than rerunning them. A source fix alone is not deployed or live verified, and a zero source-failure count does not convert the six unknown acceptance conditions to passes.

## 1. Policy

| ID | Result | What was actually evaluated; limit or next proof |
| --- | --- | --- |
| 1.1.1 | NEEDS REVIEW | `app/shopify.server.ts:14-40,53-76` uses embedded session-token authentication, token exchange and expiring offline tokens; Prisma sessions are server-side. No app-client localStorage/cookie authentication consumer was found. Legacy `app/lib/session.server.ts` still defines cookie helpers but has no imports/callers. Actual Chrome incognito/blocked-third-party-storage operation is not evidenced. |
| 1.1.2 | PASS | Variant flow uses Shopify cart/checkout; measured flow obtains `draftOrderCreate.invoiceUrl` (`api.vip.checkout.tsx:297-358`). Real Shopify TEST orders #1001/#1002 and automatic app usage exist. No external buyer payment checkout or order-creation bypass was found. Test payment is not real-money fulfillment. |
| 1.1.3 | PASS | Source-only: runtime has no Theme API/theme-download installer or theme-write scope. Theme app extensions are enabled by the merchant. Offline `demo/` theme preparation/strict CLI pushes are operator review setup, not a merchant theme-downloading feature. |
| 1.1.4 | PASS | Source-only after independently rereading 4caec32: the concrete Privacy/DPA link-lifetime mismatch is corrected as recorded above. No fake review/rating/sales-counter generator was found in shipped blocks; random values found are upload/tab identifiers, not social proof. Demo illustrations/test checkout are labeled. Original 7c deployed copy is not silently reclassified as corrected. |
| 1.1.6 | PASS | Source-only: independent shop records and mandatory shop predicates serve separate merchant stores. There is no seller registration, multi-seller storefront, classifieds or payout splitting. Multiple app installations are not a buyer-facing marketplace. |
| 1.1.7 | N/A | Not a payment gateway: no payment extension/payment-gateway scopes or external merchant card collector. Shopify app usage billing does not make this a payment gateway. |
| 1.1.8 | N/A | No POS integration or third-party POS sync was found. |
| 1.1.9 | NEEDS REVIEW | Finished-sheet quantity/price is shown before the buyer adds the file; app fees are merchant billing, not buyer surcharges. Checkout extension cannot alter totals. Legacy optional garment-location selection in `tshirt-modal.js` has explicit controls, a price review and confirmation checkbox, but its actual displayed-cost/consent path has not been run in this review. Do not infer all optional-charge UX from two finished-sheet orders. |
| 1.1.10 | PASS | Source-only: checkout extension does not reorder/select shipping. Storefront shipping-estimate helpers sort returned rates ascending (`live-shipping-rates.js:181`, `shopify-live-shipping.js:389`), not a more expensive default checkout method. No shipping customization function exists. |
| 1.1.13 | N/A | No cross-store product copying/import feature. Product setup queries the authenticated merchant's own Shopify catalog and verifies ownership before saving (`app.setup.tsx:21-62`). Demo provisioning targets only the owner's dedicated demo shop. |
| 1.1.14 | PASS | Source-only: support connects to Actual Scope, the app's operator; there is no outside agency/freelancer marketplace. |
| 1.1.15 | PASS | Source-only: no buyer cash-wallet/gift-card refund processor. Buyer refunds remain the merchant's Shopify operation. App-fee relief is a separate Shopify credit/refund review; the owner CLI only records a provider-confirmed outcome and cannot transfer money. [Credit/refund runbook](credit-refund-runbook.md) requires the original Shopify charge/provider, not an external substitute. Actual provider relief rehearsal remains unproved. |
| 1.1.16 | N/A | No lending, advances, receivables purchase or financing feature. |
| 1.2.1 | PASS | `shopifyBilling.server.ts:67-111` creates Shopify usage subscriptions and order-linked usage records. Direct Stripe/PayPal merchant collection is absent from `app/`. Two actual TEST usage nodes total USD6.82: USD6 cap on #1001, USD0.82 on #1002. This proves recorded usage, not paid merchant invoices. |
| 1.2.2 | NEEDS REVIEW | Actual separately approved ACTIVE test subscriptions exist for all three shops; pending confirmation is not treated as consent. The UI handles provider errors/inactive state. Real merchant decline, uninstall/reinstall and subsequent billing reapproval have not been demonstrated; unit/database tests are not that proof. |
| 1.2.3 | N/A | There is one usage plan, not multiple fixed-price plans. USD50/200/500/1,000 are merchant-approved interval limits, not monthly plan prices. Higher limits have an in-app Shopify approval path; actual exhausted-limit/increase UX is still an independent billing follow-up. |

## 2. Functionality and installation

| ID | Result | What was actually evaluated; limit or next proof |
| --- | --- | --- |
| 2.2.1 | PASS | The app uses Shopify authentication, authenticated catalog queries, native cart/draft checkout, order webhooks and Shopify usage billing. Merchants are not asked to create their own custom app or enter app API keys; independent install and two commerce paths are evidenced. |
| 2.2.3 | NEEDS REVIEW | Normal `app/root.tsx:23` loads current CDN `app-bridge.js` as the first script; `@shopify/app-bridge-react` is used and no legacy `@shopify/app-bridge` package is declared. Root `ErrorBoundary` (`:41-61`) emits Remix Scripts without App Bridge; the embedded error-document/reconnect behavior needs a narrow disposition/live check. Normal-page success does not establish that exceptional path. |
| 2.2.4 | PASS | Source-only: Shopify Admin calls are GraphQL. The `/admin/api/2026-10/graphql.json` URLs in `app/lib/shopify.server.ts`, compatibility/flow/status/tshirt-size callers are GraphQL, not REST resource requests. No general REST Admin resource client/endpoint was found. Shopify Ajax `/cart/*.js` and R2 APIs are not REST Admin API usage. |
| 2.2.6 | N/A | No admin block/action/link extension. The embedded Polaris admin app is not an Admin UI extension; shipped extensions are theme and checkout UI only. |
| 2.2.7 | PASS | Source-only: no Max modal/fullscreen API found. Ordinary Polaris detail/status dialogs open from explicit upload/status buttons (`app.queue.tsx:493,557-560`), not automatic navigation. |
| 2.3.1 | PASS | Source-only after independently rereading 4caec32: no manual Shop domain form/input remains; the top-level route always points to Shopify admin/reopen-app recovery. Existing loader/action SDK OAuth is unchanged. The old deployed 7c route contained the original FAIL; actual post-release top-level/embedded recovery still needs the native smoke check. |
| 2.3.2 | PASS | `auth.$.tsx:9` authenticates before redirect; `/app` and product/setup loaders/actions call `authenticate.admin`. `shopify.server.ts` uses the new public app's own credentials/AppStore distribution, not tenant app credentials. Three actual installs and authenticated UI entry are recorded. Public legal/health pages intentionally remain public; they are not unauthenticated merchant configuration. |
| 2.3.3 | PASS | Auth callback redirects to `/app`; three installed public-app shops rendered their merchant UI and completed actual Setup/terms/billing approval. This is existing evidence, not an additional callback test executed by this audit. |
| 2.3.4 | NEEDS REVIEW | `publicAuthPersistence.server.ts:16-45` updates an existing shop and cancels a still-pending uninstall purge; `PrismaSessionStorage` upserts sessions. Begun privacy erasure deliberately cannot be reopened. Real reinstall/OAuth/UI/billing reapproval after uninstall remains unproved; do not substitute the local race tests. |

## 3. Security and scopes

| ID | Result | What was actually evaluated; limit or next proof |
| --- | --- | --- |
| 3.1.1 | PASS | Public application/config/proxy/redirects use `https://auto-gang-sheet.actualscope.com`. Actual trusted HTTPS200 and production Let's Encrypt certificate issuance are documented in [provisioning](provisioning.md); PG/Valkey TLS is separately evidenced. The 7c rollout's new external health/native smoke check was still pending at this audit cutoff, not replaced by container health. The development-only localhost default is not a production HTTP endpoint. |
| 3.2.1 | N/A | `read_all_orders` is not requested; there is no historical Shopify-order backfill beyond the standard window. Stored paid-volume facts are not a justification to add this scope. |
| 3.2.2 | N/A | No `write_payment_mandate` or deferred-payment selling plan. |
| 3.2.3 | N/A | `write_checkout_extensions_apis` is absent. Ordinary read-only checkout/thank-you cart-line UI is not a post-purchase offer extension needing this scope. |
| 3.2.4 | N/A | No `read_advanced_dom_pixel_events`, web pixel, heatmap or session recording. Visitor tracking was deleted, not switched off. |
| 3.2.5 | N/A | No `read_checkout_extensions_chat` or checkout chat feature. |

The complete public scope list is `read_products,write_products,read_orders,write_draft_orders,write_app_proxy` in both the public TOML and `app/shopify.server.ts:16`. Existing tenant TOMLs are not public app requirements or deployment targets. Scope purpose/protected-data minimization is qualified in [protected customer data](protected-customer-data.md), not inferred from the absence of buyer contact fields alone.

## 5. Applicable categories

### 5.1 Online store

Applies: `extensions/theme-extension/shopify.extension.toml:5` declares `type = "theme"`.

| ID | Result | What was actually evaluated; limit or next proof |
| --- | --- | --- |
| 5.1.1 | PASS | Source-only: storefront delivery is via the declared theme app extension, nine planned shopper/staff surfaces and merchant-controlled cart embed. No runtime ScriptTag/Theme/Asset API injection or merchant code-paste installation is required. Maintainer demo-theme source/push is separate review infrastructure. |
| 5.1.3 | NEEDS REVIEW | Actual UI includes Setup and its Setup guide, explicit block names for variant/Mod2, theme editor instructions and proxy-path guidance (`app.setup.tsx:102`, `PublicLegalContent.tsx:40-44`). This is not “no onboarding.” However, instructions do not walk through product-template assignment/save or the secondary block/embed choices, and no theme-editor activation deep link is provided. Have an unfamiliar merchant complete the intended setup; tighten that guide if it is not sufficient. |
| 5.1.5 | PASS | Source-only plus existing linked-order evidence: uploads, filenames/previews, dimensions/status, print/identity links and real Shopify order names are available in authenticated Uploads/Production/detail views. Privacy requests/exports are available in-app, not only an external service. No visitor-profile data is collected for a merchant to retrieve. Latest production UI corrections still require the release owner's native smoke check. |

### 5.6 Checkout customization

Applies: `extensions/checkout-upload-display/shopify.extension.toml:10,16,21` declares `ui_extension` targeting checkout and thank-you cart lines. The underscore spelling does not make a clearly checkout-targeted UI extension nonapplicable. `purchase.thank-you.cart-line-item.render-after` is not a `checkout_post_purchase` offer extension.

| ID | Result | What was actually evaluated; limit or next proof |
| --- | --- | --- |
| 5.6.2 | PASS | Source-only: `CheckoutLineItem.jsx` displays the line's design filename/type/preview and its own production/identity link. No unrelated promotional content exists for a merchant to disable. Live checkout rendering is not established merely by the successful extension build/release. |
| 5.6.3 | PASS | Source-only: no app-brand advertising, related-app links or review solicitation. Console diagnostic labels are not a rendered self-promotion, though their sensitive attribute logging is separately noted below. |
| 5.6.5 | PASS | Source-only: display-only code reads `shopify.target.value` and renders components; it has no `applyCartLinesChange`, discount, surcharge, payment or total-change API. No checkout optional price change requires consent here. |
| 5.6.6 | PASS | Source-only: no countdown, deadline or urgency display in this extension. Storefront processing timeouts are not checkout urgency timers. |
| 5.6.7 | N/A | No Chat UI component or chat scope; this extension displays uploaded production-file information. |
| 5.6.9 | PASS | Source-only: no payment-card/bank/password input or payment information request. Only design display and a relevant external production/identity link are rendered. |

## 5. Explicitly nonapplicable groups — all remaining 60 IDs

| Group | IDs accounted for | Reason for exclusion, checked against source/config |
| --- | --- | --- |
| 5.2 Payment | 5.2.4, 5.2.5, 5.2.6, 5.2.7, 5.2.10, 5.2.11, 5.2.12, 5.2.13 | No payment extension, payment gateway, payment methods or payment-gateway scopes. Shopify usage billing is merchant app billing, not payment processing. |
| 5.3 Payment facilitator | 5.3.3 | Canonical group is opt-in; no payment facilitator feature or user request to build one. |
| 5.4 Purchase option | 5.4.2, 5.4.3, 5.4.5, 5.4.6, 5.4.7, 5.4.8, 5.4.9, 5.4.10, 5.4.12, 5.4.13, 5.4.14, 5.4.15, 5.4.16, 5.4.17, 5.4.18, 5.4.19 | No SellingPlanGroup, buyer subscription contract, preorder, try-before-you-buy or customer-payment-method/mandate scopes. A merchant app usage subscription does not make the product a buyer purchase-option app. |
| 5.5 Product sourcing | 5.5.1, 5.5.2, 5.5.5 | Canonical group is opt-in; not dropshipping/sourcing/POD fulfillment. The app delivers a merchant's customer's already-finished file; it does not supply products, request fulfillment or mark unpaid orders fulfilled. |
| 5.7 Sales channel | 5.7.2, 5.7.4, 5.7.5, 5.7.6, 5.7.7, 5.7.8, 5.7.9, 5.7.10, 5.7.11, 5.7.12, 5.7.13, 5.7.15, 5.7.16, 5.7.17 | No `channel_config`, external marketplace, publishing channel/account or channel sales attribution. It extends each merchant's existing online store. Normal app billing/terms are still reviewed under applicable general criteria. |
| 5.8 Post purchase | 5.8.1, 5.8.2, 5.8.3, 5.8.4, 5.8.5, 5.8.6, 5.8.7, 5.8.8, 5.8.9, 5.8.10 | No `checkout_post_purchase`, offer/upsell flow or selling plan. Read-only thank-you cart-line display is a different target; it remains evaluated under 5.6. |
| 5.9 Mobile app builders | 5.9.2, 5.9.3 | Canonical opt-in group; no native merchant-mobile-app generation/submission feature. Mobile-responsive storefront upload is not a mobile app builder. |
| 5.10 Donation | 5.10.1, 5.10.2, 5.10.3, 5.10.5, 5.10.6, 5.10.7 | Canonical opt-in group; no donation product, fundraising, donation distribution or donation charge. |

## Real remaining evidence, outside a static pass

1. Release/verify the exact source fixes in 4caec32 before declaring their live versions corrected. Independent final diff review is complete; a work assignment or source commit alone does not establish runtime correction.
2. Real Chrome incognito and idle/error-session recovery; billing-decline handling; uninstall/reinstall/reauthorization and billing reapproval. Existing session/erasure race tests are useful but do not replace these merchant interactions.
3. Actual optional checkout-extension render, keyboard/mobile behavior and the secondary uploader/garment paths. Nine bindings, an extension build and two buyer orders do not demonstrate every block/format/consent path. The root ErrorBoundary App Bridge condition and minimal setup instructions need a narrow disposition.
4. The saved listing currently lacks its third genuine screenshot and English real-flow screencast. [Listing](listing.md) and [media plan](media-plan.md) distinguish actual assets from drafts. Do not fake a video or publish signed file URLs/staff identity. This audit is not a listing submission, and the canonical fetched list is not the entire App Store form/media checklist.
5. Paired Lighthouse proof exists: 18 valid mobile runs, weighted impact −2.27 points, below the documented 10-point impact budget. It is a custom-demo comparison, not a Built for Shopify badge, clean official-theme/all-nine-block benchmark or 28-day field INP evidence. Contrast/name and manual accessibility checks remain. See [performance evidence](performance-next.md).
6. [Security readiness](security-readiness.md) still qualifies unproved credential rotation, alarm delivery, backup restore/erasure replay and operating-access controls. HMAC privacy originals/replay/export/R2 deletion are real but used synthetic fixtures and a simulated drain clock, not an unattended SLA test. No questionnaire answer is invented here.

Additional source caution, not a newly invented canonical requirement: `CheckoutLineItem.jsx:31` logs all line attributes to the buyer console, potentially including bearer file links. It is not evidence of external tracking, but production diagnostics should not need full sensitive attributes. No logging change or token value is included in this review.

## Reproducible audit checks

Read-only checks included the complete canonical CLI output, both extension TOMLs, public app TOML, root/auth/session/onboarding/billing/checkout source, public setup guide, upload/production views, existing privacy/isolation/order/performance evidence and targeted searches for REST resources, external payment collectors, theme injection, Max modals, cookie/localStorage auth, fabricated reviews/sales and checkout total mutation. General Admin `.json` matches were inspected, not mechanically declared REST failures. No fresh tests/build were run solely to make a static review look verified; the independently executed 440-test CI is cited with its actual scope.

This document records an actual AI review, including failures and unresolved acceptance conditions. Completing a self-review checkbox is not a claim that every item passed or that Shopify has accepted this app.
