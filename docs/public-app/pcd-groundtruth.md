# Protected customer data: what is true, not just implemented

Audit:10October2026 (UTC observations below occurred9October). Public application only. This is an engineering evidence record, not legal advice or an assertion that Shopify approved this app. No questionnaire answers were submitted by this audit.

## Operator and agreement ground truth

The owner explicitly supplied **Actual Scope** as the operator/company display name. Use exactly that trading name and `info@actualscope.com`; no invented person, address, Ltd/Inc suffix or registration claim. Public `https://actualscope.com`, `/privacy`, `/terms` and `/contact` returned200 during this audit and identify that brand/mailbox, but not a registered legal entity or street address. Those website terms expressly do not themselves enter a software-service agreement. They cannot substitute for this product's merchant agreement.

[Shopify's privacy-policy guidance](https://shopify.dev/docs/apps/launch/privacy-requirements) calls for data/use/retention/location/contact transparency and notes that physical addresses are required in some jurisdictions. Neither that page nor the Level1 checklist establishes a universal compulsory street-address field. Therefore the implementation does not force a fabricated address. The operator's jurisdiction-specific identity/address obligations remain an owner/legal-review question; an email plus brand is **not** a universal legal-compliance certificate.

Before this change, `app/routes/app.setup.tsx` only saved product limits and pointed to Shopify billing; `app/lib/publicAuthPersistence.server.ts` installed the shop without any processing-terms acceptance. Neither OAuth scope consent nor Shopify's usage-billing consent proved a merchant agreement with this operator.

The new local code adds:

- Public `/legal/dpa`, accurate provider/location disclosures, and Terms/Privacy/DPA links in Setup.
- An unchecked explicit checkbox, verified Shopify session-token administrator subject, store, acceptance time, document version and operator-identity-bound hash. No fabricated staff identity, IP-address collection or buyer contact fields.
- Dedicated Shop receipt columns plus an atomic audit entry, fenced against erasure. Editing general JSON settings cannot forge or erase acceptance accidentally.
- Fail-closed upload-intent, first usage-charge and Shopify subscription-request gates. Previously sent unknown charge outcomes still reconcile against their original provider reference; missing legal acceptance never authorizes a new charge.
- `PUBLIC_LEGAL_ENTITY_NAME=Actual Scope`, optional authentic `PUBLIC_LEGAL_ENTITY_ADDRESS`, and `PUBLIC_LEGAL_REVIEW_APPROVED=false` by default. Setting the latter true makes this document version available for explicit acceptance; it does **not** certify provider agreements, statutory compliance or App Store approval. Name/address/material document changes invalidate prior receipts.

Migration:`20261010003000_public_merchant_processing_agreement`. Source:`app/lib/publicLegal.server.ts`, `publicLegalPolicy.ts`, `app/routes/app.setup.tsx`, `app/components/PublicLegalContent.tsx`, billing gates. At handoff these source changes require a fresh image and migration; do not describe the older deployed image as having this acceptance flow.

For a genuine development-store demo, deploy that migration/image, enable the reviewed terms under the supplied trading name, and have each authorized Shopify administrator accept them normally before approving Shopify's test subscription and uploading. No whitelist, fake receipt, assumed agreement or database backfill is necessary or permitted. This operational demo does not settle the launch gaps below.

## Nine review answers

Question labels follow [Shopify's Level1 requirements](https://shopify.dev/docs/apps/launch/protected-customer-data). “N/A” is a limited factual applicability explanation, not a blanket exemption. The table separates source capability from executed merchant/provider agreements and deployed proof.

| Question | Honest answer at this audit | Evidence and qualification |
| --- | --- | --- |
| Minimum necessary data | **Yes for the inspected API design; verify real traffic before submitting** | The GraphQL order snapshot requests identifiers, amounts/statuses, paid quantities and required properties, not buyer names/email/address/phone. Signed customerID selects merchant-entered rates and verified paid-sheet volume. Visitor profiling is removed. Artwork/filenames can themselves contain personal data; never claim the app cannot receive any. Merchant-admin session identities are separate from buyer API fields. |
| Merchant informed | **No for the previously deployed policy; source correction prepared** | At22:12UTC public `/legal/privacy` returned200 but still said “release draft” and that regions/subprocessors must be published. New content identifies DigitalOcean NYC3 and Cloudflare R2 limitations, paid-volume retention and explicit acceptance. Must deploy and observe the actual setup/policies; a local file is not merchant notification. |
| Purpose limited | **Yes for inspected runtime, conditional on final disclosed terms** | File measurement/preview/production delivery, order matching, merchant pricing and app-fee accounting have concrete call sites. No advertising, visitor enrichment, artwork sale or model-training code remains. Paid-volume history affects commercial discounts and must be disclosed rather than called anonymous aggregate analytics. |
| Customer consent decisions | **N/A to marketing/tracking consent; not “we implemented all consent APIs”** | No marketing/pixel/tracking service is present. Customer supplies the production file to fulfil their request. The merchant must determine lawful basis and any applicable consent for artwork and customer-specific pricing; privacy access/erasure is implemented. If lawful-basis review makes consent necessary for any optional purpose, the current essential-service reasoning is insufficient and that purpose must be gated or removed. |
| Sale/sharing opt-out | **N/A to sale/advertising sharing, with provider-contract review outstanding** | No sale, cross-context advertising, ad IDs or marketing recipients. Processors hosting requested service data are not automatically a sale, but their contracts and actual role matter. Do not claim a generic opt-out implementation or ignore the contractual chain. |
| Automated significant decisions | **N/A under the described finished-sheet service** | Printable fit and physical dimensions are technical file checks. Merchant-set commercial rates/ordinary returning-customer discounts are not credit, employment, insurance or another significant-life-impact scoring system. This is an applicability assessment, not proof that every future automated price feature is exempt. |
| Merchant privacy/data agreements | **No until executed; local acceptance mechanism now exists** | Original code had no DPA/acceptance. New versioned receipt is auditable only after a real verified merchant accepts. Public provider DPAs are available but this audit did not prove the actual operator/account-holder contractual chain, confidentiality commitments or transfer documentation. Never tickYes solely because a DPA page was written. |
| Necessary retention enforced | **Partial / not an unqualifiedYes** | Source applies unordered7d, ordered90d, upload logs30d, audit365d, ZIP24h, export7d, uninstall46h+61min drainage and retrying erasure. Minimal finance replay keys have a distinct exact-once purpose. PaidSheetVolume customerID linkage currently lasts the installation although the normal pricing window is12months; necessity for that longer customer linkage or a bounded unlink/purge policy remains unresolved. Local deletion tests are not proof of production R2 erasure, alarm delivery or restored-backup erasure replay. |
| Encrypted at rest and in transit | **Yes for verified live storage paths after cutover, not an unconditional historical attestation** | Managed PG/Valkey, private R2, strict database TLS and public HTTPS are documented/observed. NEW host now puts app env, Docker/containerd data, Caddy data and `/var/log` on encrypted DO block storage; worker `/tmp` is tmpfs and host has no swap. The OS root disk is still unencrypted. Its retired plaintext directories were logically deleted; physical SSD sanitization and pre-cutover credential invalidation were not proved. Rotate those credentials before launch and audit any new persistence path. |

## Actual provider/storage evidence

Read-only NEW-host check at `2026-10-09T22:12:29Z` showed root `/dev/vda1 ext4`, no dm-crypt guest layer, Docker `json-file` with no rotation defaults, and mode600 `public.env` on that disk. [DigitalOcean's own Droplet responsibility model](https://www.digitalocean.com/security/shared-responsibility-model-droplets) states local Droplet virtual disks are not encrypted at rest. Provider database encryption did not cover this gap.

Owner-authorized correction used only NEW droplet607746803. New40GiB `agsu-public-secure` volume `af20d117-c42e-11f1-a1c3-faccc92b5588`, filesystemUUID `2a60676d-c49c-4bd1-bd88-be326425fd57`, costs approximatelyUSD4/month. [DigitalOcean Volume documentation](https://docs.digitalocean.com/products/volumes/details/features/) describes provider-side encrypted storage and encrypted snapshots; an ext4 guest mount is expected and does not prove lack of provider encryption.

After the coordinated short maintenance at22:17UTC:

```text
/dev/sda[/app]        /opt/agsu-public     ext4
/dev/sda[/docker]     /var/lib/docker     ext4
/dev/sda[/containerd] /var/lib/containerd ext4
/dev/sda[/caddy]      /var/lib/caddy      ext4
/dev/sda[/logs]       /var/log            ext4
Docker json-file: max-size10m, max-file3
public.env:600 root:root
Six independent public-app containers up; web healthy
HTTPS /health: {"status":"healthy"}
findmnt --verify --tab-file /etc/fstab: no errors/warnings
```

Docker/containerd/Caddy have persistent `RequiresMountsFor` dependencies, so absent encrypted mounts fail closed on boot rather than silently storing app state on root. Effective final journald override is `zz-agsu-volatile.conf`:Storagevolatile, RuntimeMaxUse64M, RuntimeMaxFileSize8M, ForwardToSyslogno. Ubuntu's vendor `syslog.conf` sorts after an `agsu-*` name, so the final override intentionally sorts last.

The exact five retired plaintext directories were removed after healthy encrypted-path verification. They are no longer recoverable at those old paths; the working data remains on the encrypted volume and the immutable image can be re-pulled. This is **logical deletion, not certified physical sanitization**. No free-space wipe was performed. Existing app/DB/R2/capability secrets present before cutover should be rotated; new secret material must never be written back to root. No existing tenant host/container/Caddy/bucket was modified.

[Managed PostgreSQL](https://docs.digitalocean.com/products/databases/postgresql/details/features/) and [Valkey](https://docs.digitalocean.com/products/databases/valkey/details/features/) describe encrypted storage/TLS; PostgreSQL has seven-day point-in-time recovery. [R2 security](https://developers.cloudflare.com/r2/reference/data-security/) covers encryption of objects/metadata and TLS. Actual private endpoints, certificate verification and backup observations are recorded in `provisioning.md`. R2 ENAM is a placement hint, not a contractual geographic restriction or proof of all subprocessor processing locations.

[DigitalOcean's DPA](https://www.digitalocean.com/legal/data-processing-agreement) supplements its customer agreement. [Cloudflare's DPA](https://www.cloudflare.com/cloudflare-customer-dpa/) describes applicability to the actual counterparty, subprocessing and transfer safeguards. This proves available provider terms, **not** that this named operator has executed or is covered by all necessary agreements. Existing owner-authorized cloud accounts must have a documented lawful processing/authorization chain before an affirmative contractual attestation.

## Remaining launch evidence

1. Confirm the real contracting operator/jurisdiction, actual provider-account authority and any legally required address/representative. Display only supplied facts; do not invent a registered company.
2. Owner/legal review of the drafted merchant DPA and applicable provider/transfer/confidentiality agreements. Capture real per-store acceptance after deployment. Shopify scopes and billing approval remain separate.
3. Bound or justify installed-lifetime paid-volume **customer linkage** separately from immutable monetary replay facts. Do not silently erase pricing history or pretend the current12-month query itself deletes older personal associations.
4. Rotate credentials that existed on the pre-cutover OS disk, verify no remaining sensitive root persistence, and document restore/erasure replay and operational alerts. Encrypted current paths do not retroactively encrypt old physical blocks.
5. Run the actual three-store demo, real HMAC/R2 deletion/export and real Shopify test billing/cap workflows; record their observed outputs independently. Disposable fixtures do not prove provider publication, account agreements or production deletion.

## Tests at this source handoff

`npx prisma generate` succeeded. The final focused legal/upload/billing rerun passed25/25 across4files, including optional-address handling. `npx tsc --noEmit` exited0. Full local suite at01:20local (before the extra optional-address case):52files passed,6skipped;381tests passed,22skipped. Skips are opt-in localDB/Linux-tool fixtures, not proof they passed. Root owns the final isolated image build and deployed confirmation; no older build is claimed to contain these changes.
