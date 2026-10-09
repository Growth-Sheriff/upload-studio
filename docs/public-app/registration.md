# Independent app and development stores

Verified 2026-10-10, Europe/Istanbul. Browser profile: Actual Scope; Shopify user info@actualscope.com. Dev Dashboard organization239354566 maps to Partner Dashboard5236223. The existing Gang Sheet Editor application and its pending-review shops are not test targets for this app.

| Resource | Verified identity |
| --- | --- |
| Public app | Auto Gang Sheet Upload, Dashboard app433768202241 |
| Client ID | 8822c01b1f0be2280240cfab7d4e9a79 |
| App URL | https://auto-gang-sheet.actualscope.com |
| Review demo | auto-gang-sheet-demo.myshopify.com, development Plus/US |
| Isolation two | auto-gang-sheet-isolation-two.myshopify.com, development Basic/US |
| Isolation three | auto-gang-sheet-isolation-three.myshopify.com, development Basic/CA |

Executed global CLI **auth/store only**: `shopify auth login --alias info@actualscope.com --no-input --json`; `shopify store list --organization-id239354566 --json`; then three explicit `store create dev --organization-id239354566 --no-demo-data` calls. Store creation returned Actual Scope each time. Application commands use pinned3.88.1. Native CLI initialization created the public registration outside the protected checkout; only the separately named public TOML receives its identity. Fresh extension UIDs were assigned by the pinned public-config environment pull.

Browser proof: https://dev.shopify.com/dashboard/239354566/apps/433768202241 visibly lists Auto Gang Sheet Upload, the exact client ID and Actual Scope. Public distribution selected in its own Partner page. Credentials were pulled to an ACL-restricted directory outside Git; this document intentionally contains no secret.

## Wrong-account empty registration

The first CLI initialization used its cached info@techifyboost.com identity rather than Chrome's Actual Scope identity. It created a new empty Auto Gang Sheet Upload record with client IDc6e9d208e609819fa7c6c54a004def38 in the wrong organization. This record is quarantined: never deployed, never installed, no scopes or extensions and no payment collection. No pre-existing application was edited. After explicit account switching, pinned app-info against that record returned403 "not a member of the requested organization", and the correct Actual Scope app was created and independently verified. Cleanup of only the accidental empty record remains outstanding; do not delete a similarly named existing app or use it as a deployment target.

Creation of three stores and a registration is not installation, live-commerce verification or App Store submission. Those gates remain explicit in verification.md.
