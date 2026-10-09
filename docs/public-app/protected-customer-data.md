# Protected customer data submission draft

Request **level 1** order/customer-associated data, without level 2 buyer contact fields. This is a submission draft, not approval. Production shops require approval for this purpose. Shopify permits development-store testing after the distribution method and required data are selected in the Dashboard, without completing review: [official development exception](https://shopify.dev/docs/apps/launch/protected-customer-data). Never use that exception to install on a production tenant.

| Scope | Required purpose |
| --- | --- |
| read_products | Read the merchant's selected product/options/variant dimensions and retail prices to match the uploaded finished sheet. |
| write_products | Merchant-operated compatible product/variant setup and price synchronization in the existing product editor. |
| read_orders | Associate production files with paid Shopify lines and evaluate capture, cancellation and refund facts before recording a fee. |
| write_draft_orders | Create the server-priced measured-length checkout requested by the buyer, rather than trust a client price. |
| write_app_proxy | Serve Shopify-signed storefront upload/config/cart requests through the installed app proxy. |

No read_customers, read_all_orders, write_orders, read_files or write_files. Customer lookup/tag/email rules were removed. The app does not edit orders: the three line properties and its own orders_link table cover identity, so duplicate order-metafield writes were removed rather than request write_orders. Artwork resides in the independent R2 bucket, not Shopify Files. No pixel, visitor profiling, advertising attribution, IP geolocation or session replay.

Minimal order facts: shop/order/line/product/variant IDs, line quantities and discounted merchandise money, capture/cancellation/refund/fulfillment status, and the three file identity properties. Signed customer ID is used only for upload ownership, merchant-entered special-rate assignments and stored paid-inch eligibility. GraphQL order snapshots explicitly do not select buyer name, address, email or phone. Webhook payloads are not persisted wholesale; privacy payloads are minimized before durable storage. Staff online-session identity is separate merchant authentication information.

Safeguards: Shopify HMAC/session-token/app-proxy verification; request-bound shop isolation for every tenant delegate and relation-owned item; owner-checked jobs; signed file/identity and guest-checkout capabilities; separate isolated worker resource pools; HTTPS ingress; provider encryption/backups; no logs of raw webhook bodies or full buyer contacts. Session/API secrets stay server-side. Public production configuration cannot be inferred from tenant secrets.

Data is used only for the documented app function, not sold/shared for advertising or AI training. The retention/erasure implementation and durations are in data-retention.md. Shopify privacy requests are durably deduplicated, exported or erased, including derived ZIPs and R2 multipart/orphan objects. Exports are merchant-authenticated, expire after seven days and require the merchant to deliver them through a verified requester channel.

Before submission: enter actual legal operator identity/address and hosting region/subprocessors, complete the Partner security questionnaire, confirm account access and support mailbox operation, test data request/redact/shop-redact against the newly provisioned R2 bucket, and verify request processing/alerting meets the policy. Do not claim SQL database RLS: isolation here is mandatory application-level scoped queries, tested across three shops.
