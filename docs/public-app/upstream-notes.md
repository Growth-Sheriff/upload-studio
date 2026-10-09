# Shopify upstream decisions (checked 2026-10-09)

These are primary-source findings, not assumptions inherited from the custom deployment.

| Area | Verified upstream fact | Repository consequence |
| --- | --- | --- |
| API | `2026-10` is latest stable; quarterly versions overlap, unsupported calls fall forward. The schedule lists the 2025-10 accessibility deadline as 2026-10-16. | Public runtime and extension/config API targets use 2026-10; keep tenant TOMLs unchanged. Monitor actual response version and deprecations. |
| Billing | App Store app charges must use Shopify Billing API or Shopify App Pricing. Usage-only subscriptions are supported. | Delete direct merchant card/vault collection from public runtime. |
| New public API | REST Admin became legacy 2024-10-01; new public apps must exclusively use GraphQL Admin since 2025-04-01. | Replace REST order snapshots with minimal GraphQL snapshots; reject truncated financial/attribution data instead of guessing. |
| Cap | A usage record exceeding the approved billing-interval cap returns user errors. Updating the cap returns a merchant confirmation URL. | Do not mark a failed or merely requested usage record paid. Do not increase an effective cap before provider confirmation. |
| Idempotency | `appUsageRecordCreate` accepts a client key up to 255 characters; it deduplicates repeated logical requests. | Persist the shop/order logical key and reuse it after timeouts. Event delivery IDs are not charge keys. |
| Privacy | All public apps need customers/data_request, customers/redact and shop/redact. Invalid HMAC must get 401. Shopify sends shop/redact 48 hours after uninstall. | Authenticate raw body, durably accept work, and perform real export/erasure including objects. |
| Protected data | Order/customer-associated data needs level 1 approval. Name, address, phone or email raises this to level 2. | Request only order attribution and payment/refund facts; remove buyer contact/name/address storage and usage where possible. |
| Auth | Embedded apps must work with session tokens without third-party cookie/local-storage dependence; current embedded flows use managed installation/token exchange. | Persistent multishop session storage; no single-tenant fallback secrets/domains. App Bridge script comes before other app scripts. |
| Proxy | Proxy requests are signed; merchants may customize proxy prefix/subpath; cookies are stripped. | Resolve shop from authenticated proxy/token rather than hostname/default tenant. Avoid cookie-based storefront authorization. |
| Theme | Theme app extensions use app blocks/embeds and avoid direct theme code modifications. | Keep upload blocks, load assets only where needed, remove tracking embed/assets. |
| Checkout | Information/shipping/payment-step UI extensions require Plus. Modern extension UI uses Polaris web components, not retired React component APIs. | Checkout enhancement is optional; product/cart/production workflow must work without Plus. |
| Webhooks | HMAC verifies sender; X-Shopify-Event-Id correlates a merchant action across subscription deliveries. Delivery/order is not exactly-once. HTTPS connection timeout is 1 second, whole-request timeout 5 seconds, retry 8 times over 4 hours. | Durable inbox dedupe by shop/topic/event; prompt acknowledgment then retryable processing/reconciliation. Do not dedupe refunds/cancellations by order alone. |
| Webhook chronology | Shopify recommends X-Shopify-Triggered-At or payload updated_at for delivery ordering. Header names are case-insensitive. | A delayed uninstall cannot deactivate a more recently authenticated installation. Purge payloads retain the exact uninstall instance; reinstallation and erasure compete through one serialized Shop row. |
| Performance | Storefront Lighthouse score reduction must be no more than 10 points. Admin p75 LCP <=2.5s and CLS <=0.1 over 28 days. | Measure before/after on demo storefront; a local Lighthouse run cannot prove field Web Vitals. |
| Revenue | Standard eligible accounts keep first USD 1m gross app revenue (since 2025-01-01), then pay 15% share; 2.9% processing applies separately. Large-company/account rules differ. | Document both net scenarios; account eligibility must be checked rather than assumed. |

## Sources

- [Versioning and retirement schedule](https://shopify.dev/docs/api/usage/versioning)
- [REST Admin legacy/new-public-app rule](https://shopify.dev/docs/api/admin-rest)
- [App Store requirements](https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements)
- [Create usage subscription](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/appSubscriptionCreate)
- [Usage record and idempotency](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/appUsageRecordCreate)
- [Merchant-approved cap update](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/appSubscriptionLineItemUpdate)
- [Privacy-law webhooks](https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance)
- [Protected customer data](https://shopify.dev/docs/apps/launch/protected-customer-data)
- [Access tokens](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens)
- [Verify webhook deliveries](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries)
- [Delivery headers and chronology](https://shopify.dev/docs/apps/build/webhooks/delivery-structure)
- [App proxies](https://shopify.dev/docs/apps/build/online-store/app-proxies)
- [Theme app extensions](https://shopify.dev/docs/apps/build/online-store/theme-app-extensions)
- [Checkout UI extensions](https://shopify.dev/docs/api/checkout-ui-extensions/latest)
- [Admin performance](https://shopify.dev/docs/apps/build/performance/admin-installation-oauth)
- [Storefront performance](https://shopify.dev/docs/apps/build/performance)
- [Revenue share and processing fees](https://shopify.dev/docs/apps/launch/distribution/revenue-share)
