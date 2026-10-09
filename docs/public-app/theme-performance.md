# Storefront delivery checks

The public branch no longer loads the Tailwind play-CDN compiler on Mod 2. Its existing utility layout is covered by a native stylesheet scoped to `[data-ul-custom-price-mod2]`; merchant font/color variables remain in Liquid. Component styles keep their higher specificity. The obsolete CDN-config asset is deleted. Keyboard focus remains visible and reduced-motion users do not receive the pulse/transition effects.

Product and upload images declare width/height; gallery thumbnails lazy-load. Empty preview `src` attributes were removed (the uploader supplies the actual URL later). The confirmation asset is deferred. The t-shirt module imports the pinned THREE core and official geometry/loader/control addons before importing the unchanged modal, replacing the old mixed UMD/module/fallback ordering and hand-copied addons. The cart embed includes its script once, not both directly and through its schema.

On 2026-10-09, the pinned CLI 3.88.1 executed:

```
npx shopify theme check --path extensions/theme-extension --output json
[]

npx shopify app build --config auto-gang-sheet-upload
checkout-upload-display successfully built
Auto Gang Sheet Upload built!
```

German, Spanish and Turkish include the missing size-uploader keys. This is a local extension build and a zero-offense static theme check, not publication or a Lighthouse result.

Read-only byte/gzip measurements of the local shipped assets:

| Asset | Raw bytes | gzip bytes |
| --- | ---: | ---: |
| cart-upload-display.js | 31,192 | 8,482 |
| custom-price-upload-mod2.js | 212,587 | 40,689 |
| main-product-upload-app.js | 161,849 | 38,168 |
| tshirt-modal.js | 111,089 | 24,818 |
| custom-price-upload-mod2-utilities.css | 23,843 | 3,885 |

Method: Node `readFileSync` plus `gzipSync`, without modifying assets. These are source transfer estimates, not CDN response sizes or execution timings. The heavy uploader/3D assets still need real storefront measurement and a review for splitting/lazy loading. THREE remains a pinned remote module dependency. No live storefront, browser performance trace, accessibility interaction test, visual comparison or passing Web Vitals claim is made here; those need the independent demo app/store to be installed and reachable.
