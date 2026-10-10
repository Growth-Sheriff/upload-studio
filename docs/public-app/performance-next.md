# CLI storefront performance gate — 10 October 2026

This is a bounded audit of the **owned development shop**
`auto-gang-sheet-demo.myshopify.com`. No live theme, existing tenant, app
configuration, storefront protection or provider state is changed. The
authenticated Actual Scope Chrome profile, its cookies and debugging
connection are not inputs to this work.

## Actual findings

At 02:24 UTC the pinned Shopify CLI 3.88.1 read-only theme list returned:

| Theme | ID | Actual role |
| --- | --- | --- |
| Horizon | 189187457245 | live; excluded |
| Auto Gang Sheet Demo | 189187817693 | unpublished; app enabled |
| meticulous-backdrop | 189188636893 | unpublished; baseline |

The three intended audit paths are `/`,
`/products/ready-dtf-gang-sheets` and
`/collections/ready-sheet-examples`. Ordinary preview URLs are **not**
passwordless links. Six unauthenticated HTTP requests, with the exact theme
ID and `pb=0`, produced the following access checks:

| UTC | Theme | Page | HTTP result | Elapsed ms |
| --- | --- | --- | --- | ---: |
| 02:24:47.613 | baseline | home | 429 | 156 |
| 02:24:48.172 | baseline | product | 200, final `/password`, password form | 559 |
| 02:24:48.258 | baseline | collection | 429 | 86 |
| 02:24:48.459 | app enabled | home | 429 | 201 |
| 02:24:48.979 | app enabled | product | 200, final `/password`, password form | 520 |
| 02:24:49.049 | app enabled | collection | 429 | 70 |

These are access-failure timings, **not** page TTFB, Lighthouse scores or
evidence that the real storefront makes no tracking requests. Failed
requests were not repeatedly retried. A noninteractive read-only
`theme profile` attempt exited 1 because a storefront password was needed;
Liquid profiling is not a substitute for Lighthouse in any event.

The exact CLI password store
`%APPDATA%/shopify-cli-theme-store-password-nodejs/Config/config.json`
contained **no entry** for the demo domain. The separately protected public
app files contain app/runtime credentials, not the ordinary storefront
password. Unrelated Shopify account credentials were not used. Passwords,
cookies, account tokens and raw authentication headers were not printed.

## Pair integrity was checked against both remote drafts

At 02:29:12.682 UTC, independent read-only full theme pulls into
`C:/Users/mhmmd/.codex/demo-theme-backups/performance-readonly-20261010-0230/`
returned 38 files per theme. Thirty-four files were byte-identical. The
differences were exactly:

- `config/settings_data.json`: cart embed's `disabled` flag.
- `templates/index.json`: catalog section's `disabled` flag.
- `templates/product.ags-variant.json`: uploader section's `disabled` flag.
- `assets/ags-demo.css`: the app-enabled copy additionally contains the
  194-byte comment and `.ags-cart .ul-cart-upload-info:not(.processing):not(.error){display:none}`
  rule introduced after the baseline was assembled.

Remote CSS SHA256:

```text
baseline:    01863FF94D75556ACAEE6D43B9393BE4F5A67790485591C0C0BBAAB0AE98F115
app enabled: F53910E7DD2F0FA34CE2DEC834E294D68D71CD33A85BA0DF72508ADED9173AC2
```

The extra rule targets only `/cart`, not any audited page. Nevertheless,
an assertion that the remote themes differ *only* in three enablement flags
would currently be false. A one-file CSS sync to the **baseline draft only**
would restore that strict pairing. This audit did not push it. The existing
three-file overlay test proves source enablement flags, not remote asset
identity after subsequent theme changes.

## Supported execution route

The installed Chrome binary is 154.0.8037.57. Registry metadata on this date
returned Lighthouse 13.5.0 (Node >=22.19) and puppeteer-core 25.13.0 (Node
>=22.12); the installed Node 24.19 satisfies both. No repository dependency
change is required for a disposable command-line audit.

The owner has authorized an **isolated fresh** performance-test session
using this owned shop's ordinary password. The supported route is:

1. Obtain the demo's ordinary storefront password through Shopify's normal
   Online Store preferences, or an existing protected password file. Keep it
   outside Git and command-line arguments. Do not guess it or substitute an
   account password, app token, existing browser cookie or private endpoint.
2. Make the normal URL-encoded `POST /password` with `form_type=storefront_password`,
   `utf8` and `password`. Keep only the returned shop-scoped cookie in memory;
   reject incorrect-password, 429, challenge and unexpected-origin responses.
3. Launch a **new** headless Chrome through the official Lighthouse/Puppeteer
   interface, with its own disposable profile. Seed only the owned shop's
   cookie jar and pass that new page to Lighthouse. Never connect to an
   existing browser/profile/debugging port. Do not use a global `Cookie`
   extra-header for every request: third-party/CDN requests must not receive
   the shop's authentication cookie.
4. Confirm the requested theme's real page, not `/password`, before accepting
   a report. Audit all three paths with `preview_theme_id=<exact draft ID>`,
   `_fd=0` and `pb=0`. Alternate baseline/app runs, with mobile simulated
   throttling and identical settings, three times per page. Record medians
   and every individual run, including failures.
5. Derive a redacted request list from that **fresh test session's** Lighthouse
   artifacts: method, host, pathname, resource type and status only, with no
   cookie/header/body or capability query strings. Check both actual scripts
   and requests for removed app visitor/session/upload-telemetry endpoints.
   Distinguish Shopify's own platform instrumentation from this app's removed
   person-tracking layer. This covers page load, not every subsequent upload
   interaction.
6. Close the dedicated browser and remove its exact temporary profile and any
   temporary credential files. Keep redacted reports locally; do not upload
   authenticated raw artifacts to temporary public Lighthouse storage.

The remaining authentication prerequisite is the **ordinary demo storefront
password**, not a new permission, new app, theme upload or disabled password.
If that password cannot be supplied, the other supported route is a separate
official `shopifypreview.com` link for each existing draft, copied through
Shopify's normal preview-bar link action. Neither credential is invented.

## Why the tempting CLI shortcuts are excluded

- Pinned `theme open` and its `themePreviewUrl` implementation return only
  `https://<shop>?preview_theme_id=<id>`, not a portable passwordless token.
- `theme dev` uploads/replaces a development theme; `theme share` uploads an
  unpublished theme. Neither is a read-only way to audit these exact drafts.
- Shopify's complete Lighthouse CI action wrapper pushes a development
  theme and deletes it during cleanup. Its ordinary password login is a
  useful documented pattern; running the whole wrapper violates this audit's
  no-upload/no-delete boundary.
- No Lighthouse score from a password page, access error or static asset-size
  estimate counts toward the release gate.

## Primary sources and interpretation

- [Shopify performance testing](https://shopify.dev/docs/storefronts/themes/best-practices/performance/testing-for-performance):
  three page types, preview-bar suppression, repeated comparable lab runs and
  passwordless preview-link workflow. A development-store lab result is not
  field Web Vitals. Shopify's **Theme Store** minimum is not automatically the
  public app's acceptance criterion.
- [Shopify Lighthouse CI](https://shopify.dev/docs/storefronts/themes/tools/lighthouse-ci)
  and its [official implementation](https://github.com/Shopify/lighthouse-ci-action/blob/main/entrypoint.sh):
  storefront password authentication is supported, but the complete wrapper
  also writes/deletes a theme.
- [Lighthouse authenticated-page guidance](https://github.com/GoogleChrome/lighthouse/blob/main/docs/authenticated-pages.md)
  and [Puppeteer integration](https://github.com/GoogleChrome/lighthouse/blob/main/docs/puppeteer.md):
  fresh scripted login/cookies and an explicitly supplied new page are
  supported. Existing-user-profile reuse is unnecessary.
- [Shopify theme dev](https://shopify.dev/docs/api/shopify-cli/theme/theme-dev)
  and [theme profile](https://shopify.dev/docs/api/shopify-cli/theme/theme-profile)
  document their different jobs and authentication inputs.

**Current gate:** no genuine Lighthouse page score, before/after delta or
live no-tracking network proof is claimed by the access checks above.
