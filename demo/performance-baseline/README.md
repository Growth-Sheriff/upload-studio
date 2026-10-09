# Three-page app-free performance baseline

Only the new dedicated demo shop is a target:
`auto-gang-sheet-demo.myshopify.com`. The parent created the independent
unpublished draft **meticulous-backdrop**, ID **189188636893**, as an exact
copy of `demo/theme` at commit `058a9ee`. Neither the live Horizon theme
`189187457245` nor the app-enabled demo theme `189187817693` is modified.

This directory is a three-file overlay, not a standalone theme or a second
copy of native assets. Differences from the app-enabled source are exactly:

- `templates/index.json`: `sections.catalog.disabled=true`.
- `templates/product.ags-variant.json`: `sections.uploader.disabled=true`.
- `config/settings_data.json`: cart embed `disabled=true`.

Native hero, product intro, FAQ, navigation, product data, generated images,
CSS and all other theme files are identical. The native collection template
is unchanged. The three audited pages are `/`,
`/products/ready-dtf-gang-sheets` and `/collections/ready-sheet-examples`.
These pages have no enabled app blocks/embed in this baseline; **other
templates still contain their original app blocks**. This is not an app-free
claim about the whole theme or Shopify's own scripts.

## Reproduce safely

Verify the exact draft's ID/name/unpublished role first, with pinned CLI:

```powershell
pnpm.cmd exec shopify theme list --store auto-gang-sheet-demo.myshopify.com --json
```

Create a fresh staging directory outside Git, copy `demo/theme` there, then
copy these three native overlay files to their corresponding paths. Do not
change the tracked app-enabled theme or reuse an unknown staging directory.
The executed staging directory was:
`C:\Users\mhmmd\.codex\demo-theme-backups\performance-baseline-189188636893`.
Check the assembled theme, then push **only** the three overrides:

```powershell
pnpm.cmd exec shopify theme check --path C:/Users/mhmmd/.codex/demo-theme-backups/performance-baseline-189188636893 --output json
pnpm.cmd exec shopify theme push --store auto-gang-sheet-demo.myshopify.com --theme 189188636893 --path C:/Users/mhmmd/.codex/demo-theme-backups/performance-baseline-189188636893 --only templates/index.json --only templates/product.ags-variant.json --only config/settings_data.json --nodelete --strict --json
```

No publish/live flags, remote deletion, API-scope expansion or app deploy.
The actual strict push completed successfully on 9 October 2026 UTC; result:

```json
{"theme":{"id":189188636893,"name":"meticulous-backdrop","role":"unpublished","shop":"auto-gang-sheet-demo.myshopify.com","editor_url":"https://auto-gang-sheet-demo.myshopify.com/admin/themes/189188636893/editor","preview_url":"https://auto-gang-sheet-demo.myshopify.com?preview_theme_id=189188636893"}}
```

Read-only remote pull of the three overrides plus `templates/collection.json`
to `C:\Users\mhmmd\.codex\demo-theme-backups\performance-baseline-verified-189188636893`
confirmed parsed JSON equality to the source overlays and unchanged native
collection. All 37 assembled local theme files were compared: only those
three files differed. A focused test proves each overlay differs only in its
single enablement flag, while the existing nine-block binding tests still
pass: **3 tests green**. Theme check returned `[]` (no errors/warnings).
Read-only theme list afterward still showed Horizon live and both demos
unpublished.

## Passwordless Lighthouse URL: supported path and limitation

The pinned CLI 3.88.1's `theme share` delegates to theme push. Its inspected
`themePreviewUrl` implementation returns the ordinary store URL with
`?preview_theme_id=...`; it does not generate a password-bypassing
`shopifypreview.com` domain. The actual push above returned that ordinary
preview URL. It is **not** evidence that an unauthenticated Lighthouse browser
can access the protected development store.

The current documented
[2026-10 OnlineStoreTheme fields](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/OnlineStoreTheme)
do not expose a preview-link/token field. A read-only official Store CLI
2026-10 product query, with existing product-read authorization and no new
scope, returned `onlineStorePreviewUrl` as the ordinary
`https://auto-gang-sheet-demo.myshopify.com/products/ready-dtf-gang-sheets`,
not a passwordless preview domain (`onlineStoreUrl` was null).

Shopify's official
[performance-testing instructions](https://shopify.dev/docs/storefronts/themes/best-practices/performance/testing-for-performance)
say to copy the `shopifypreview.com` link from the storefront preview bar.
That supported link is still needed for the actual Lighthouse run, separately
for the intended app-enabled theme and this baseline. No private endpoint,
browser/CDP workaround, broad token, password removal or guessed preview
domain was used. No owner request was repeated. No Lighthouse score or app
performance delta is claimed by this baseline setup alone.
