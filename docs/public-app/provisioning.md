# Isolated public-app infrastructure — 2026-10-10

This is a **new demo/review environment**, not a highly available production platform. Resources were created through official DigitalOcean APIs and Cloudflare Wrangler, using the owner's authorized accounts. No existing droplet, tenant container, database, bucket, Caddyfile or DNS record was modified. Application publication, Shopify billing and App Store approval are separate verification gates.

## Created resources

| Resource | New identity / configuration |
| --- | --- |
| DigitalOcean project | `agsu-public` — `9c8f7d1d-84da-4809-80fd-69c9ef73dfed` |
| NYC3 VPC | `agsu-public-vpc` — `6b6cd509-e959-4b49-9f6b-9d178aff7c0c`, `10.108.16.0/24` |
| Web/worker host | `agsu-public-web` — droplet `607746803`, Ubuntu24.04, `s-8vcpu-32gb-amd`, 8vCPU / 32GiB / 400GB |
| Host addresses | `143.198.12.234` public, `10.108.16.2` private |
| New host firewall | `5fdd482d-af9e-4c8e-a599-9304bf3e27e4`: SSH only `31.223.87.18/32`, TCP80/443 public; app port3000 is loopback-only |
| PostgreSQL | `agsu-public-pg` — `00e966fb-f132-4af3-b9f4-d806d172cf0a`, PG16, 1vCPU / 2GiB / 30GiB, one node, database `public_app` |
| Queue | `agsu-public-queue` — `8985bc57-1d3f-4a7f-baea-a885f4d38ba1`, Valkey8, 1vCPU / 1GiB, one node, DB0 |
| New DNS record | `auto-gang-sheet.actualscope.com` A → `143.198.12.234`, DNS-only, TTL300, record `c5942dea67a8bf44af2744fe7bc98e57` |
| Private R2 | `auto-gang-sheet-public`, account `3b964e63af3f0e752c640e35dab68c9b`, ENAM location / default jurisdiction / Standard storage; created `2026-10-09T21:53:04.562Z` |

Both managed databases' trusted-source lists were read back and contain **only droplet607746803**. Application connections use the private VPC hostnames and TLS. All three billable compute/database resources were assigned to the new project and returned resource status `ok`.

The provisioner refuses unknown existing names, protected droplet IDs and ownership mismatches rather than adopting or overwriting them. Protected existing IDs include `595444296` and `601821519` (the live Upload Studio hosts). No forbidden tenant deployment script is called.

## Cost and resource budgets

Approved monthly base estimate, excluding tax, object storage/operations, optional extra backups, image registry/build costs and additional replicas:

| Resource | Estimated USD/month |
| --- | ---: |
| 32GiB / 8vCPU PremiumAMD host | 168.00 |
| PostgreSQL2GiB / 30GiB | 30.45 |
| Valkey1GiB | 15.00 |
| Base total | **213.45** |

Host pricing was read from `GET /v2/sizes` (`price_monthly:168`, `price_hourly:0.25`). Database estimates use the [current official price list](https://www.digitalocean.com/pricing/managed-databases). Billing is usage-based; this is an estimate, not an invoice. The host's OS reports 31GiB available physical memory, with no swap. The checked-in Compose file caps web at1GiB, three image workers at4GiB each, billing/privacy at512MiB each:14GiB aggregate configured memory ceilings, plus OS/container overhead. Worker CPU ceilings total8vCPU, so concurrency still requires real workload observation. A replica increase must be budgeted, not silently fit onto this host.

[R2 Standard rates](https://developers.cloudflare.com/r2/pricing/) are $0.015/GB-month, $4.50/million ClassA operations and $0.36/million ClassB operations, with free egress. Account-wide free allowances are shared with existing buckets and must not be assumed unused by this app.

## Database roles, TLS and credential handling

Provider-created accounts `agsu_migrate` and `agsu_app` have independent generated passwords. `agsu_migrate` owns the `public` schema and is used **only for migrations**. `agsu_app` gets CONNECT, schemaUSAGE, table SELECT/INSERT/UPDATE/DELETE and sequence USAGE/SELECT; no schemaCREATE, databaseCREATE, TEMP, superuser, role creation, replication or RLS bypass. Default privileges apply to future objects created by `agsu_migrate`, so a migration must not use `doadmin`. The application still requires its tenant row guard: these SQL grants are not per-shop row-level security.

Runtime per-database limits are `statement_timeout=30s`, `lock_timeout=10s`, `idle_in_transaction_session_timeout=30s`. The SQL bootstrap refuses any database/user other than `public_app`/`doadmin` on the verified new host. The check connected as `agsu_app` using `sslmode=verify-full` and the new cluster CA, then returned:

```text
current_database | current_user | statement_timeout | runtime_schema_create | runtime_database_create
public_app       | agsu_app     | 30s               | f                     | f
ssl | version
t   | TLSv1.3
```

Secrets are outside Git in `C:\Users\mhmmd\.codex\secrets\agsu-public`, with inheritance removed and access limited to the current Windows user and SYSTEM. `digitalocean.clixml` stores provider passwords as DPAPI-encrypted SecureStrings; fields are `PgMigration`, `PgRuntime`, `PgPrivate` (setup admin) and `QueuePrivate`. `pg-ca.pem` is the downloaded public cluster certificate. New SSH key `id_ed25519` and a dedicated `known_hosts` file are in the same restricted directory. Passwords are sent to bootstrap only over SSH stdin, never in command-line arguments. Its root-only temporary password file is removed on exit; the post-run `/tmp/agsu-pgpass.*` check returned no leftovers.

For deployment, mount the CA read-only as `/run/secrets/pg-ca.pem`. Runtime uses `PgRuntime`, and the migration invocation separately overrides with `PgMigration`. Do not copy `doadmin` into the application's environment or reuse live tenant credentials. Prisma's engine-specific TLS parameters must also require strict certificate verification; the libpq bootstrap proof does not prove the application's connection configuration.

## Files, privacy and backup limits

R2 `r2.dev` access is disabled and no custom public bucket domain is bound. `R2_PUBLIC_URL` must remain empty: originals are served only through owner-bound signed application links, not a public CDN. The new bucket's verified CORS permits non-credentialed GET/HEAD/PUT from any shop origin, exposes ETag and caches preflight for3600s. This supports future custom storefront domains but is **not authorization**. Signed URLs still bind the object, owner, size and expiry. `r2-cors.wrangler.json` is the CLI/API representation of the existing S3-format policy; no private bucket credentials go to browsers.

The verified lifecycle rule aborts incomplete multipart uploads after one day across all prefixes. The provider's untouched default seven-day abort rule also exists; the earlier one-day rule applies first. No expiry of finished artwork was added at bucket level: the application's retention/redaction worker controls related file and row erasure.

PostgreSQL reports one provider backup at this point. Official [managed PostgreSQL backup policy](https://docs.digitalocean.com/products/databases/postgresql/how-to/restore-from-backups/) is daily backups retained seven days with point-in-time restore into a **new** cluster. No restore drill has been run. The previously documented30-day encrypted supplementary backup requirement is **not yet configured or verified**; do not claim30-day coverage. Database backups containing erased data expire under this provider schedule; restored data must be reconciled against erasure records before serving traffic.

Valkey configuration was read back as `valkey_ssl:true`, `frequent_snapshots:true`, `valkey_persistence:rdb`, `valkey_maxmemory_policy:noeviction`. DigitalOcean [documents](https://docs.digitalocean.com/reference/api/reference/databases/) ten-minute RDB snapshots; this is weaker than [BullMQ's one-second AOF recommendation](https://docs.bullmq.io/guide/going-to-production). Pending jobs can be lost across a crash. A queue-loss/rehydration proof from durable upload, privacy and commission rows is a launch gate, not solved by claiming that managed Valkey is durable enough.

A read-only OpenSSL handshake from the new host to the queue's private endpoint returned `TLSv1.3` and `Verification: OK` using default system roots. The [Valkey connection guide](https://docs.digitalocean.com/products/databases/valkey/how-to/connect/) confirms that its Let'sEncrypt certificate needs no separately downloaded CA. Keep `rediss://` certificate checks enabled; never disable verification to get a worker online.

[Standard PostgreSQL plan restrictions](https://docs.digitalocean.com/products/databases/postgresql/details/pricing/) change on15Oct2026 for new accounts and30Nov2026 for all accounts. Future larger/HA production must reassess AdvancedEdition or another independently provisioned database. Current single-node databases and one host are explicitly for demo/review; none are claimed HA.

## Reproduction and current publication gates

From the isolated `public-app` worktree, `deploy/public/provision-digitalocean.ps1 -Phase Status` reads only owned new resource metadata. `Create` and `Finish` are mutating, scoped/idempotent setup phases, **not read-only inspection commands**. `DatabaseRoles` creates only the new database roles and applies the checked-in SQL; rerunning it preserves existing provider passwords. Do not run any phase against tenant infrastructure.

```powershell
.\deploy\public\provision-digitalocean.ps1 -Phase Status
```

Wrangler was run with the existing OAuth login rather than the inherited restricted API token, only in a child shell. The OAuth account can manage this new bucket; it is not proof of runtimeS3 key access. Verification commands were `wrangler r2 bucket info`, `cors list`, `lifecycle list` and `dev-url get` for **only `auto-gang-sheet-public`**.

New-host package evidence: cloud-init `done`, Docker29.1.3, Compose2.40.3, Caddy2.11.7. Ubuntu initially supplied Caddy2.6.2. The official Cloudsmith apt repository returnedHTTP402; only that newly added source was disabled, and the [official GitHub2.11.7 release](https://github.com/caddyserver/caddy/releases/tag/v2.11.7) was installed with SHA256 `a22b914ffd1958da42bc7ab13b7b62c6100634e0798ab594891d2d61d53ba749` verified before installation. `/etc/caddy/Caddyfile` was validated. No existing Caddy process was touched.

At `2026-10-09T22:01:57Z`, HTTP redirected308 to HTTPS. TLS certificate issuance was pending an automatic Let'sEncrypt retry: early boot before DNS caused failed authorization rate limiting, with the provider's explicit retry-after `2026-10-09T22:04:35Z`. Do not bypass that limit or mistake HTTP redirect for validTLS.

At this provisioning handoff no application containers were running, no migrations were applied by this helper, and no Shopify/provider billing calls were made. The root release workflow must separately verify TLS, deploy the independent image, apply new-database migrations, supply new-bucketS3 credentials, then prove real demo upload/cart/order/usage-record flows. Existing invalid inventoryS3 credentials and successful OAuth bucket creation do not prove applicationR2 access. App Store approval and three-store live isolation remain separate gates.

### Later deployment observation — 22:09:06 UTC

The root release workflow subsequently started six containers on **only droplet607746803**. The read-only snapshot at `2026-10-09T22:09:06Z` found web/measure/preview/export/billing/privacy all up for seven seconds (web healthcheck still starting). An ordinary certificate-verifying HTTPS request to `https://auto-gang-sheet.actualscope.com/health` returned **HTTP/2 200**. Caddy's `22:09:05` log confirmed `certificate obtained successfully` from the production `acme-v02.api.letsencrypt.org-directory` issuer. This clears the DNS/TLS/basic runtime-health gate, not the commerce, billing, privacy or App Store review gates. No insecure TLS flag, ACME account reset or rate-limit workaround was used.
