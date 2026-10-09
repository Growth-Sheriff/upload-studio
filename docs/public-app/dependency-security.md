# Dependency security — public branch only

Executed 10 October 2026, not inferred from GitHub's warning about the separate default branch. `pnpm audit --prod --json` initially returned 65 advisory entries: 2 critical, 30 high, 27 moderate and 6 low.

## Compatible corrections

- Remove the unused direct `@remix-run/serve` dependency. The public request path is the native bounded server.mjs, not Express; this removes unnecessary production Express/proxy/compression/logging dependencies.
- Keep the existing Remix2 architecture but pin node/react/dev and all server-runtime copies to2.17.5. The Shopify adapter otherwise retains its older2.17.2 runtime. This fixes the enabled manifest-discovery DoS and upstream CSRF/SSR fixes without forcing a different routing API.
- Pin nanoid5.1.16. Use published same-major overrides for fast-xml-parser5.11.2, undici6.29.0, lodash4.18.1, minimatch5.1.8/9.0.7, brace-expansion2.1.7, picomatch2.3.2 and Router1.23.4/React Router6.30.6. The XML parser handles R2/S3 protocol responses, not image pixel data.
- Keep Shopify CLI exactly3.88.1 as instructed. No tenant configuration is normalized or deployed.

Latest executed production audit: **0 critical, 2 high, 3 moderate, 0 low**. This is **not** a clean audit and does not describe every development tool copied into the current image.

## Remaining advisories and conditions

| Package / advisory | Current evidence | Release action |
| --- | --- | --- |
| turbo-stream2.4.1, high [single-fetch DoS](https://github.com/advisories/GHSA-rxv8-25v2-qmq8) | v3_singleFetch is explicitly false. Remix2.17.5 deliberately pins this serialization version. | Do not force turbo-stream3 into an incompatible protocol. Preserve disabled feature; resolve during supported framework migration and verify error/deferred-response flows. |
| braces3.0.3, high [stack exhaustion](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | Only extension tooling's ts-morph/fast-glob chain was found; no app/worker import or customer-controlled glob input. Upstream says no patched version; audit's suggested3.0.4 is unpublished. | Recheck upstream and tooling before release. Do not run untrusted glob patterns; do not claim a nonexistent version fixes it. |
| React Router6.30.6, moderate [hydration constructor injection](https://github.com/advisories/GHSA-337j-9hxr-rhxg) | Applies to normal SSR too. Production sanitizes actual Error instances; no attacker-shaped raw error throw/hydration assignment was found in this application. Latent vulnerable dependency remains. | Resolve on a supported framework update. Keep production error sanitization, never emit untrusted __type/__subType objects, and verify the final installed app. |
| React Router6.30.6, moderate [backslash navigation](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6) | Inspected internal navigation targets are fixed app paths; external preview links are ordinary external anchors. No exploitable target was demonstrated. | Do not pass unsanitized external input to Link/useNavigate. Do not force React Router7 into Remix2 just to silence the audit. |
| uuid10/11.1.0, moderate [optional buffer bounds](https://github.com/advisories/GHSA-w5hq-g745-h8pq) | svix/Resend and BullMQ dependencies; no application use of affected v3/v5/v6 buffer overloads found. | Reconcile vendor updates; no blanket major override without compatibility evidence. |

Review these conditions again after adding new code or enabling a feature. Lack of a found exploit is not a proof of safety or App Store acceptance. Public release requires a documented security disposition and actual browser/provider verification. The Docker image includes development tooling for source-worker/Prisma execution; production-only audit must not be represented as whole-image certification.

Registry metadata and upstream advisory pages were read before selecting versions. The first install correctly rejected unpublished lodash4.17.24; the actual published compatible release4.18.1 is used. No audit --fix or automated source rewriting was used.
