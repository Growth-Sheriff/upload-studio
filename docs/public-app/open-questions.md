# Open evidence and external dependencies

Updated: 2026-10-10 (Europe/Istanbul).

## Release execution update

The numbered historical inventory below records the earlier pre-access state, not today's resource availability. Actual Scope organization239354566 and public app433768202241 are verified and the released extensions are installed in all three new development shops. The independent host, managed data services, private R2 credential, DNS and publicly trusted TLS are live. New private repository and Depot builds exist. Real R2 validation and24 hosted three-shop isolation assertions passed with exact fixture cleanup. See plan.md, registration.md, ci.md and hosted-isolation.md for current identities/evidence. No App Store submission or approval is claimed.


## Embedded navigation session drop — diagnosed and fixed 2026-10-10

The "earlier stale-page Support navigation" noted below is explained. Polaris
`Navigation` items are already Remix links (the SDK's `AppProvider` forces
`linkComponent: RemixPolarisLink`), but **before React hydrates a Remix `<Link>`
is still a plain `<a href>`**. A click that lands in that window leaves as a
full document navigation to `https://auto-gang-sheet.actualscope.com/app/<page>`
with no `id_token`, `host` or `embedded` parameter, so `authenticate.admin()`
cannot authenticate it and the merchant reaches
`/auth/login?returnTo=…` — the "Shopify could not authenticate this request"
card. It is intermittent, most reproducible on the first click after opening the
app from the admin's app-settings page, and does not affect Shopify's own
sidebar links, which App Bridge intercepts.

Reproduced on the hosted app on 2026-10-10 by clicking **Products** in the app's
own navigation: the page became the recovery card instead of the product list.
The same page reached from Shopify's sidebar rendered all six configured
products, so this was never missing configuration.

Fixed in `d7e686f`: `auth.login` now reopens the requested path inside Shopify
by itself once App Bridge reports the shop, showing a spinner instead of an
error. One attempt per requested path; a second failure falls through to the
existing manual button rather than bouncing between Shopify and the app. The
`/app` layout clears those markers when it renders, so the automatic retry is
available again for a later race. With `sessionStorage` unavailable the manual
button is shown unchanged.

Deployed as `ghcr.io/growth-sheriff/auto-gang-sheet-public@sha256:83ecedd22879a9e02a7355881e04a77955750242a92a6c8d0f9be45516f0594b`
(Depot build `m8kbrs5brj`, revision label independently confirmed as
`d7e686f71e6059d27f81d9f1edd3c682960fb1dc`). All six containers restarted on
droplet `607746803` only; external HTTPS `/health` returned 200. After the
deploy, Products opened from the app's own navigation and rendered
"6 of 6 products configured for upload".

**What this does not prove.** The failure was intermittent before the change, so
one passing navigation cannot distinguish "the race did not happen" from "it
happened and recovery worked". A deliberate pre-hydration click, the
second-failure fallback and the blocked-storage path still need their own
observations.

## Current unresolved gates — updated 10 October,05:18:58 UTC rollout

- Registration, permanent-token403 and initial product loading are resolved; all three installed shops render the app and six demo configurations were saved through Polaris. Frozen source `7c072fd1a81081007e2da2312ce2b0d29f59ef40` passed fresh CI `hd0qj81n11`:69 files/440 tests,zero skips,eight migrations,full typecheck,zero release-blocking measurement regressions and all build/theme/extension gates. Sequential production `qmnklsgprn` produced index `sha256:e05e8990f9321a03464eda8bde3b415874ebdce6e062f3589de1cd96662e9121`;both commands exited0/provider `finished`,and registry source identity matched. The release owner confirmed this image deployed only on NEW607746803 at05:18:58 UTC:web healthy,five workers running,all restart0/OOMfalse;old hosts'17+14 inspect rows byte-identical before/after. Explicit public CLI released `agsu-review-7c072fd`,version1161996697601,in the correct Actual Scope app. ExternalHTTPS `/health` and post-release native UI checks remain pending,not inferred from container health. Live expired-background-token refresh and idle-session return-path regression still need actual observation;earlier stale-page Support navigation is not a proven universal failure.
- Both genuine paid TEST orders now linked and settled through normal scheduling:#1001 recovered from genuine delayed Shopify delivery and recorded one USD6 fee;#1002 recorded one USD0.82 fee excluding USD8 shipping. Provider/local total was USD6.82,not the earlier stale balance0. Two authorized known-recorded#1002 same-key provider replays,one with unread response body,added no record/amount and left its paid Commission immutable. Actual TEST50.01USD-against50USD provider rejection created no charge. See [order/replay audit](order-recovery-audit.md) and [cap evidence](billing-live-gaps.md). First-submission lost-response/unknown-Commission recovery,identical original webhook-event replay,application cap exhaustion/approved increase/next-period handling,CAD-order FX and hosted cancellation/refund negative cases remain unproven. These two demo orders are not real commerce in all three shops or real merchant invoices.
- Subsequent hosted compliance proof ran22:29:02–22:29:31 UTC against only three UUID-guarded synthetic fixtures: all three signed HTTP topics, replay, actual worker export/redaction and real R2 erasure passed with exact cleanup. See hosted-compliance.md. This is not a Shopify-origin delivery or an elapsed61-minute/48-hour SLA proof: only fixture clocks were advanced62minutes. Timely automatic uninstall cleanup and recovery after backup restoration still need evidence.
- Owner supplied operator name Actual Scope. No address/company suffix/person is supplied. Shopify's privacy requirements make a physical address jurisdiction-dependent, not universally mandatory. Do not fabricate it or claim jurisdiction review has happened. All three new shops actually accepted Actual Scope Terms/DPA version `2026-10-10.1:c769892b1216b191ec6f93d2` through the ordinary UI on2026-10-10, with separate owner approval and no receipt backfill. Screenshots: [demo](evidence/demo-processing-terms-accepted.jpg), [isolation two](evidence/isolation-two-processing-terms-accepted.jpg), [isolation three](evidence/isolation-three-processing-terms-accepted.jpg). The9/9 questionnaire is now saved as Draft,but operational/legal qualifications remain;development-shop acceptance is not Shopify protected-data approval or universal legal compliance.
- The actual Level1 form now shows **9 out of9 answers completed,still Draft**,with only Store management/App functionality purposes and no buyer name,email,phone/address fields selected. [Saved questionnaire evidence](protected-customer-data.md) is not Shopify approval or proof of untested operational safeguards. Pre-cutover secret rotation,access/MFA review,delivered alerts,backup restore/erasure replay and jurisdiction-specific legal questions remain qualified in security-readiness.md.
- Automatic Depot repository CI is not yet connected. Its Code Access organization installation requests organization secrets/runner permissions beyond the owner-approved new-repository-only access, so no such installation was submitted. Prefer a narrower official integration rather than broadening access silently. GitHub Actions' existing billing lock remains unchanged.
- The native demo remains unpublished theme189187817693 with all nine actual block bindings; six product settings and native/measured TEST checkouts are proved. The ready PNG became server-verified22.30×78 in/100 DPI in3.2 seconds; exact three cart properties persisted. Genuine variant retry recovery is now evidenced,not pending. Remaining uploader surfaces,staff production/identity,checkout extension and mobile/large-file fallback still need execution. The genuine18-run CLI mobile Lighthouse comparison is complete:weighted87.04→84.77 (**−2.27**),with zero removed app-tracking requests in those initial page loads. [Exact method/scope](performance-next.md) is paired custom-demo proof,not clean official Horizon/all-blocks/RUM;contrast/label warnings and full keyboard checks remain. The ordinary owned-store password workflow resolved performance-test access; a portable preview link is not an unresolved prerequisite for this completed proof. Optional Built for Shopify28-day field data does not require an ordinary-submission wait.
- Encrypted live mounts do not prove secure erasure of historical plaintext root-disk blocks. Before real merchant operation, rotate the new app/provider/runtime secrets affected by pre-cutover residency where supported, without touching old tenant credentials. Separately, credentials accidentally displayed earlier in tool history should be rotated through their respective owners; no values are repeated here.
- Single host is not HA. Managed PG has its provider backup window; Valkey snapshot recovery, lost-job rehydration, sustained multishop resource fairness and475MP peak-memory behavior remain unproven. Do not advertise thousand-shop capacity from startup health.
- App Store media and submission remain incomplete,but the icon,feature image and two native1600×900 variant/cart screenshots are now actually saved in the correct listing with alt text; their Shopify-hosted dimensions were observed,not inferred from file selection. The real form's remaining two media issues are the third screenshot and genuine English3–8-minute review screencast URL. Those and App Store submission remain **pending at this handoff**. `listing.md` records the saved state;raw capability URLs/staff PII must never appear in published media. The accidental empty wrong-account app remains quarantined;no existing Growth Sheriff Shopify app was altered. Exact-target cleanup remains separate.

## Historical pre-access blockers — superseded where stated above

1. Actualscope Partner/Dev Dashboard registration: the available browser automation did not expose the requested Chrome profile; native browser inspection stopped because it could not confidently identify the current page URL. No more UI interaction was attempted after that stop. Therefore account info@actualscope.com, organization identity and creation of the app are unverified. Complete only in Actualscope, not Growth Sheriff. Until verified, the new TOML retains a deliberately non-deployable client ID and example URLs.
2. Independent hosting/storage: no new host, public PostgreSQL/Redis or R2 bucket was provisioned. The available DigitalOcean login is an existing account; its ownership/use for the new public project is not an authenticated Actualscope registration. Provisioning an idle host without a real app identity/secrets does not prove deployment. Use the independent manifests and fresh credentials; neither live droplet is a staging host.
3. Protected customer data: the level-1 justification and minimized GraphQL snapshot are prepared, but permission approval and real order deliveries are not. No read_customers or buyer contact fields are requested. Verify actual API version headers, order/draft queries and webhook topic authorization in the new app.
4. Live commerce proof: three real demo stores, a real test checkout, Shopify consent/usage record, duplicate signed order delivery, cap rejection/approval and next-period handling have not happened. Local real-database/mocked-provider tests do not establish these facts.
5. Storage/privacy proof: actual R2 pagination/multipart erasure, presigned headers, wildcard non-credentialed CORS, expired capability behavior and 48-hour unattended deletion/retry alerts need the new provider account. Local file deletion and mocked R2 transport are not this proof. Confirm storage backups expire after 30 days and restore procedures reapply erasure tombstones. An absent Shop currently completes as `noStoredShop` without sweeping objects; unexpected row loss requires an independently tested orphan-prefix inventory/recovery procedure.
6. Credits and financial operations: usage records cannot be undone. BillingCredit records queue owner review; Partner API/provider credit issuance, its audit reference and reconciliation procedure are not implemented/proven as an unattended workflow. Verify account revenue-share eligibility and tax treatment. Unsupported/stale FX safely blocks fee collection and needs an operator resolution path.
7. Legal/support readiness: actual legal entity/address, hosting region, processor agreements and a working info@actualscope.com mailbox have not been authenticated. Policy/listing copy and the editable icon are release drafts, not legal approval or submission assets.
8. Storefront/admin release evidence: extension builds and static checks pass locally; extensions are not published to a new app and no real storefront Network panel, keyboard/visual checks, review video, screenshots or Lighthouse comparison exists yet.
9. GitHub Actions: public-app push created the public checks run, but no test step started. GitHub's annotation states, "The job was not started because your account is locked due to a billing issue." Existing organization billing was not changed. Local executed results are not a green hosted CI claim.
10. Dependency disposition: compatible updates reduce the production audit from2critical/30high/27moderate/6low to0critical/2high/3moderate/0low. Remaining framework/tooling advisories and their actual exposure conditions are in dependency-security.md. Supported upstream updates and final release review remain necessary; audit exclusions or unsafe major overrides were not used to manufacture a clean result.

## Deliberate boundaries

- The public schema is fresh. No custom tenant data, visitor tables, billing ledger or existing cart is migrated. Signed capabilities are public-app-specific; old custom links remain on their existing deployments.
- New explicit rates and the central least-film policy are preserved; an inherited duplicate Math.max calculation was corrected on the public branch only. Paid-volume eligibility must use immutable accepted units and real paid order quantities, never reinterpret historical charges.
- The Prisma guard is application isolation, not PostgreSQL RLS. Dedicated role permissions, TLS, statement_timeout, backups and reviewed administrative access are launch requirements.
- Per-shop image concurrency and process/container limits are implemented. A peak-RSS/OOM test with real large files and several shops under sustained load has not been performed; do not extrapolate the 200ms child cancellation test into memory capacity claims.
- Public proxy settings currently validate /apps/name. Other allowed Shopify prefixes require explicit compatibility work rather than silently issuing an incorrect endpoint.

Ordinary [App Store performance](https://shopify.dev/docs/apps/build/performance/storefront) requires the mobile before/after Lighthouse impact to stay within10 points, using home17%, product40% and collection43% weighting. The completed paired custom-demo measurement was−2.27;its clean-theme/all-blocks/field-data limitations remain explicit rather than calling the measurement missing. The28-day field Web Vitals criteria are [Built for Shopify](https://shopify.dev/docs/apps/launch/built-for-shopify/requirements), not an ordinary submission gate. The unresolved commerce/review gates prevent declaring the user's eleven release criteria complete; they do not authorize reusing any live custom app or weakening its isolation.
