# Auto Gang Sheet Upload — public application

This `public-app` branch starts at `origin/main` commit `76113c193d7da789df9b2d3ea1ad7947af48b334`. It is an independent Shopify App Store product, not a migration of the custom tenant deployment.

**Never merge or cherry-pick this branch into `main` or `custom-container-upload-studio-app`.** Changes may flow from main into this branch only. Existing Shopify tenant configuration files remain unchanged.

The public application uses one Shopify application, one isolated PostgreSQL database, one Redis database, and independently provisioned web and worker services. No existing droplet, tenant container, Caddy configuration, database, queue, or storage credentials may be used for public deployment. Deployment identity and actual URLs are recorded in `docs/public-app/verification.md`; until provisioning is verified, deployment is pending.

The only public Shopify configuration is `shopify.app.auto-gang-sheet-upload.toml`. Every Shopify app command must use the repository's pinned CLI; every deploy must explicitly select this configuration.

Do not run `scripts/generate-tenant-envs.sh`, `deploy/deploy.sh`, or any Compose command with `--remove-orphans`.

See `docs/public-app/plan.md` for work order and release evidence.
