import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./app', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // This is a production Remix route whose public URL is /api/storage/test,
    // not a Vitest suite. Importing it during discovery initializes Shopify
    // configuration and makes `npm test` depend on production-only env vars.
    exclude: [...configDefaults.exclude, 'app/routes/api.storage.test.tsx'],
  },
})
