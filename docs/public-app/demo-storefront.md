# Review-demo storefront

This is an isolated demonstration, not a new production printing business. Prices are illustrative, orders use the demo shop's test payment flow, and nothing is physically fulfilled. Existing merchant shops and themes are outside this work.

## Latest executed state — 9 October,23:13UTC

The historical provisioning steps below retain their own observations. All six real demo product configurations have now been loaded and saved through actual Polaris UI: four variant products,two measured-length products at0.30/in,width22.5,length240,tolerance0.02. They were not imported through a database writer. Real fractional-input rejection was reproduced and fixed; successful saves are shown in evidence/demo-setup-decimal-rate-saved.jpg and demo-mod2-configured.jpg. All three installed development shops render the embedded app. The nine canonical block bindings remain in unpublished theme189187817693; Horizon189187457245 remains live.

Actual375px home and variant-product checks showed no horizontal overflow; keyboard menu navigation worked. Those snapshots are not a full accessibility or Lighthouse pass. Source9c4b466 is hosted in the independent public deployment,and both extensions remain Active version1161844129793 (server-only support follow-up). Merchant processing-terms acceptance is still unchecked/pending action-time owner approval. Browser file-upload access and a portable official theme-preview URL are pending owner handoff. Consequently no real buyer upload/cart/order/usage/cap or review-video proof is claimed. Do not turn the source manifest or product publication into a claim that those flows ran.

## What this store sells

A finished gang sheet is one production file. The customer has already arranged the artwork. The app measures the page, checks the configured press limit, and either selects a listed sheet length or quotes measured length. Quantity prints the complete uploaded file that many times. There is no nesting, layout service, or invented production instruction.

Every demo product explicitly uses maximum printable width **22.5 in** and export tolerance **0.02 in**. Measured products also explicitly use maximum length **240 in** and **$0.30/in**. Variant products use the actual listed variant length and price; a 22.3 × 78 file selects the 22 × 80 variant. The least-film orientation policy is unchanged. DTF variants cost $0.50 per listed inch; UV variants use an illustrative $0.65 per listed inch. No hidden discount or account rate is added.

The inventory in `demo/storefront/inventory.json` is a source manifest and contains no credential. The separate create-only `demo/storefront/provision.mjs` tool is limited to the three newly created public-app development shops, verifies Shopify's actual domain, development status and USD currency, defaults to a read-only plan, and requires `--apply` before any mutation. Shopify's mandatory single default variant on a measured product is not a sheet-size ladder or an inch carrier. Its catalog reference is the per-inch rate; the server-generated custom checkout supplies the actual measured sheet price. Generic catalog blocks intentionally exclude these measured products so a $0.30 rate cannot masquerade as a full-sheet price.

## Native block map

Public source contains **nine** blocks. The formerly tenth block was visitor tracking and was deleted; it must not be reintroduced for a demo.

| Native file / editor label | Purpose | Demo destination |
| --- | --- | --- |
| `main-product-upload-app` / Variant Gang Sheet Upload | Automatic smallest-fitting variant, finished-sheet upload | `/products/ready-dtf-gang-sheets`, `product.ags-variant` |
| `main-product-upload-pro` / Custom Price Sheet Upload | Measured-length checkout; multi-format Studio view | `/products/measured-dtf-gang-sheets`, `product.ags-measured` |
| `custom-price-upload-mod2` / Custom Price Upload Mod 2 | PNG-only full product page and measured quote | `/products/measured-dtf-png-sheets`, `product.ags-mod2`; sole product UI, no duplicate native buy buttons |
| `dtf-transfer` / Main Product Upload | Customer manually picks a variant; server verifies exact selected sheet | `/products/manual-dtf-gang-sheets`, `product.ags-manual`; `tshirtEnabled=false` |
| `dtf-uv-gang-sheet-upload` / DTF + UV Gang Sheets | Two product handles, separate pricing/ownership per file | `/products/dtf-uv-upload-desk` and `/products/uv-gang-sheets`, `product.ags-dual`; one desk, no material combining |
| `dtf-listing` / DTF Product Listing | Link cards, not an uploader | Home catalog; product-picker contains the four variant products |
| `showcase-bar` / Product Showcase | Collection-backed link cards, not an uploader | `/pages/block-gallery`; `ready-sheet-examples` collection |
| `carousel-3d` / 3D Product Listing | Collection-backed scrollable cards; “3D” is CSS presentation, not a product designer | `/pages/block-gallery`; same real collection |
| `cart-upload-display` / Cart Upload Display | Body app embed, not a product section | Enabled globally; inspect upload identity/preview on the real cart |

The six product records deliberately demonstrate presentation choices rather than pretend to be six different film grades. The two measured product descriptions say they are alternative views of the same finished-sheet service. The dual desk's page product is a real DTF variant product; its UV tab points to a separate UV product. No dummy hub product is sold.

## Store story and design

Light warm background, near-black ink, restrained teal and coral accents, generous space, and close-up sheet imagery. Do not use fake ratings, reviews, customer logos, countdowns, sales counters, turnaround promises, wash guarantees, or a design-builder mockup. The isolated native theme is in `demo/theme`; FAL-generated photographs are explicitly described as demo illustrations, not physical sample tests. The Sites presentation-design guide influenced the narrative progression and accessibility; Shopify, not Sites hosting, remains the target.

Home progression:

1. Thin permanent demo notice: “Review demo — test orders only. Nothing is printed or shipped.”
2. Hero: **“Your sheet. Exactly as you made it.”** Supporting line: “Upload a finished gang sheet. See its size and price. Choose how many complete copies you need.” Primary action opens the automatic-variant product; secondary action opens measured pricing.
3. Plain product-choice cards: “Pick a sheet size” versus “Pay by measured length,” then a smaller manual-variant and DTF + UV option. Rates must include `/in`; full-sheet variant prices say “from.”
4. Three steps: “Upload your finished file” → “Review size and price” → “Choose copies and checkout.”
5. Native DTF Product Listing of real variant products; no empty placeholders.
6. Short file guide and FAQ, then support and demo disclosure.

Product pages show the app uploader as the only buying UI. A brief theme-owned introduction explains pricing mode and limits. Variant pages may show normal product imagery/details above the uploader; Mod 2 already supplies its own full page and gets no duplicate title/image/form. The cart retains Shopify's normal checkout and the three app properties: Print Ready, Sheet Identity, DPI.

## Concise FAQ / file guide

**Do you arrange my logos?** No. Upload the finished production sheet you prepared. Artwork is not nested, combined, or rearranged.

**What does quantity mean?** Complete printed copies of that same uploaded sheet. Three copies means the entire file is printed three times.

**Why is the variant called 22 inches if the limit is 22.5?** The variant name describes the commercial sheet size. This demo's explicitly configured printable press limit is 22.5 inches. The app still checks your file's real dimensions.

**How is the price calculated?** Variant pricing uses the smallest listed length that covers the file. Measured pricing uses the server-confirmed billable length times the displayed per-inch rate and number of copies. Review the quote before checkout.

**What happens if a file is too large?** Genuine width overflow is rejected with the measured width and configured limit. Variant files longer than every listed sheet are rejected. Measured files longer than 240 inches are rejected, not split.

**Which file should I upload?** Start with a ready PNG with the intended page size and embedded resolution. The Studio/variant uploader also lists its supported formats; the detailed PNG presentation accepts PNG only. A transparent background is retained; the app does not add or remove artwork for you.

**What if my file has no resolution metadata?** Review the measured dimensions carefully. Depending on the source, the inherited Adobe-resolution or printable-width fallback can apply. Do not promise that every file is silently treated as 300 DPI.

**Why can a preview take longer?** PNG/JPEG dimensions are validated from stored headers. Large images and other formats may need a server-rendered preview. A waiting thumbnail does not authorize an unverified file for checkout.

**Will this demo ship an order?** No. It is a review environment with illustrative prices and test checkout. No physical fulfillment, shipping guarantee, or material durability claim is made.

## Honest block settings

Mod 2: account desk off for guests, vendor off, pricing table off for measured mode, upload label “Upload finished PNG.” Override its feature grid with “Finished-sheet uploads,” “PNG file preview,” “Quantity means copies,” and “Price before checkout.” Accordion text uses the guide above, not generic shipping/returns or wash claims.

Showcase: header “READY SHEET EXAMPLES,” subtitle “Explore the finished-sheet product views,” no compare-at prices. Carousel: header “DEMO COLLECTION,” title “Finished sheets, different views,” no limited-time claim. Existing hardcoded `4D` badges and inert wishlist buttons are not genuine capabilities: the demo theme must omit those decorations, and must not market them as implemented functionality. Mod 2's hardcoded “Works with Any Design” and stock wording need honest theme presentation; decorative omissions must not change pricing or suppress an error.

All upload blocks and the cart embed use the same visible signed app-proxy path (`/apps/customizer` unless the verified demo app is configured otherwise). Never invent a `shopify://apps/...` UUID: take the installed public theme extension identity from the verified app/theme state.

## External safety boundary

Only after parent verifies the Actualscope-owned development shop: obtain a read-only theme backup, select an isolated unpublished demo theme, then apply these native files/templates and demo products. Preserve the backup. No existing production theme, merchant product, tenant config, or infrastructure is a target. Screenshots and a real test checkout come after app installation, proxy configuration, product config, test payment, and published extension identity are actually known.

Confirmed dedicated target: **auto-gang-sheet-demo.myshopify.com**, newly created under Actual Scope organization 239354566. The pending-review Gang Sheet Editor store is deliberately not reused. A read-only CLI list returned Horizon theme **189187457245**; CLI pull completed into `C:\Users\mhmmd\.codex\demo-theme-backups\auto-gang-sheet-demo`. That backup remains outside Git and untouched. Fresh theme templates currently contain empty app slots; `demo/storefront/block-settings.json` maps the settings to apply when the installed extension UUID is actually known. No fake ID is substituted.

The new isolated **Auto Gang Sheet Demo** theme **189187817693** was uploaded **unpublished** with explicit shop/path and strict theme validation. No `--live`, `--publish`, or `--allow-live` flag was used; Horizon remained live. [Preview](https://auto-gang-sheet-demo.myshopify.com?preview_theme_id=189187817693) currently reaches the development-store password page. This proves only upload, not a successful visual or uploader check. Storefront-password access and installed app identity are the remaining dependencies; protection is not disabled to obtain a screenshot.

Local verification: pinned Shopify CLI 3.88.1 `theme check --path demo/theme --fail-level error --output json` returned `[]` (zero errors or warnings). A read-only source check confirmed settings in `block-settings.json` exactly match each of the nine native schemas and all collection handles exist in the six-product inventory. The source manifest is not a statement that those Shopify products or app blocks have already been installed.

Architecture sources checked for this theme: [Shopify theme structure](https://shopify.dev/docs/storefronts/themes/architecture), [app-block wrapper requirements](https://shopify.dev/docs/storefronts/themes/architecture/blocks/app-blocks), and [the installed app-block type format](https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration). This is a focused review-demo theme, not a Shopify Theme Store submission; it intentionally supplies no alternate native product purchase form that bypasses the uploader's price authority.

## Create-only demo provisioning

Run `node demo/storefront/provision.mjs --shop auto-gang-sheet-demo.myshopify.com` for a read-only plan; add `--apply` only for the dedicated demo. This uses the official global CLI's **store** commands, never global **app** commands, and pins every Admin GraphQL operation to 2026-10. It uses separately authorized demo-admin `write_products`, `write_content` and `write_publications`; these are not additions to the public app's minimal scope list. Neither CLI auth, access tokens, signed upload parameters, account contacts nor customer records are printed. No environment database URL is read.

Preflight checks all existing handle collisions before any write. Products and the collection carry an exact manifest hash; an existing owned product with changed prices, variants, title or template is rejected rather than reset. Pages with conflicting content are also preserved. Shopify seeded a blank `/pages/contact`; it remains untouched, and the demo creates `/pages/demo-support` instead. Unknown mutation outcomes are not automatically retried: rerun the read-only plan to reconcile the exact handle first. Re-running a fully successful apply may reassert the same Online Store publication but does not recreate or reprice products.

Local generated JPEGs are staged directly with Shopify and attached to each new product, with explicit AI-demo alt text. Catalog membership is exactly the four variant-priced products; a measured-length rate never appears as a complete sheet price. Publication is selected by the verified `online_store` channel handle, not its localized display name or the first returned publication.

The tool emits actual product GIDs and explicit `/app/setup` form values. Apply those through the app's real Polaris onboarding; there is deliberately no direct database writer or hidden settings import. Product creation is not evidence that onboarding, installed app blocks, test payment, order delivery or app billing has succeeded.

Current API decisions were checked against [productSet](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/productSet), [stagedUploadsCreate](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/stagedUploadsCreate), [pageCreate](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/pageCreate), [CollectionCreateInput](https://shopify.dev/docs/api/admin-graphql/2026-10/input-objects/CollectionCreateInput), [explicit collection inclusion](https://shopify.dev/docs/api/admin-graphql/2026-10/input-objects/CollectionInclusionProductSelectionInput), and [Publication channels](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/Publication). In particular, the new `collection`/`sources` input is used instead of deprecated `input`/`ruleSet`; productSet is create-only because supplied list fields can replace existing lists.

### Confirmed demo objects — 2026-10-09 22:14:43 UTC

Shopify verified shop `85933588701`, USD and `partnerDevelopment=true`. The apply completed only on `auto-gang-sheet-demo.myshopify.com`:

| Product handle | Shopify Product GID suffix | Polaris setup mode | Per-inch rate |
| --- | --- | --- | --- |
| `ready-dtf-gang-sheets` | `15425159135453` | variant | 0 / not used |
| `measured-dtf-gang-sheets` | `15425159397597` | measured_length | 0.30 |
| `measured-dtf-png-sheets` | `15425159495901` | measured_length | 0.30 |
| `manual-dtf-gang-sheets` | `15425159561437` | variant | 0 / not used |
| `dtf-uv-upload-desk` | `15425159692509` | variant | 0 / not used |
| `uv-gang-sheets` | `15425159725277` | variant | 0 / not used |

All six forms explicitly use `maxPrintableWidthIn=22.5`, `maxPrintableLengthIn=240`, `fitToleranceIn=0.02`. Product IDs must be full `gid://shopify/Product/<suffix>` values. These are a handoff to actual Polaris setup, not proof that the forms have already been saved.

Collection `512861110493` contains exactly the four variant-priced products. New pages: `file-guide` (`165189517533`), `block-gallery` (`165189550301`), `demo-support` (`165189583069`). The original blank Contact page (`165188960477`) is untouched. Online Store publication is `225358938333` (`online_store` channel); a read-only `publishedOnPublication` query confirms true. The development shop currently returns `onlineStoreUrl=null`, which is not presented as a successful public-storefront check. All six image records subsequently reached `READY`, 1024 × 1024, retaining their AI-demo alt text.

Reproducible post-apply read-only command above returned `createProducts: []`, `createPages: []`, `createCollection: false`. `pnpm exec vitest run demo/storefront/provision-model.test.ts` passed four focused tests: target isolation, rate/variant separation, collision/catalog protection and CLI/HTML round-trip handling. The other two newly created isolation shops were not provisioned or otherwise written by this tool.

### Canonical installed extension and draft binding

The installed public app's actual extension identity was proven by adding and saving its native variant block through the Shopify theme editor on the dedicated **draft**, then pulling that one template outside Git. Its canonical type is `shopify://apps/auto-gang-sheet-upload/blocks/main-product-upload-app/01a122b4-5d9a-7c7b-bf41-7485e57ad484`; this is not the CLI registration UID or an invented ID. The source now binds eight app-section blocks plus the global enabled cart embed with that identity. The variant block occupies the original `uploader` section; template order remains `intro, uploader, faq`, with no appended duplicate Apps section.

Validation: six focused demo tests passed, `pnpm run typecheck` exited 0, and pinned CLI theme check returned `[]`. The explicit strict push targeted only draft **189187817693**. A subsequent CLI list still reported Horizon **189187457245** live and Auto Gang Sheet Demo **189187817693** unpublished. Read-only pull into `C:\Users\mhmmd\.codex\demo-theme-backups\bound-nine-blocks` confirmed all eight remote section blocks and the enabled cart embed match the source manifest, including `/apps/customizer` wherever applicable.

The authenticated owner browser can now preview the password-protected draft without disabling its protection. Home, the variant uploader and both gallery catalogs visibly render actual demo product images, variant prices and truthful copy. The empty uploader shows its 22.50-inch limit and disables cart/checkout until a file is accepted. Browser-use visual inspection influenced only this verification; it did not publish the theme or create a test order. Screenshot evidence: `evidence/demo-home-draft.jpg`, `evidence/demo-variant-draft.jpg`, `evidence/demo-gallery-draft.jpg`. These screenshots prove appearance, not checkout or billing.
