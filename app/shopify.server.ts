import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from '~/lib/prismaSessionStorage.server';
import { enterTenantContext } from '~/lib/tenantContext.server';
import { persistVerifiedShopInstallation } from '~/lib/publicAuthPersistence.server';
import prisma from "~/lib/prisma.server";


const sessionStorage = new PrismaSessionStorage(prisma, { requireExpiringOfflineTokens: true });
export const apiVersion = '2026-10' as ApiVersion;
export const PUBLIC_SCOPES = ['read_products', 'write_products', 'read_orders', 'write_draft_orders', 'write_app_proxy'];



const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY || "",
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion,
  scopes: PUBLIC_SCOPES,
  appUrl: process.env.SHOPIFY_APP_URL || 'http://localhost:3000',
  authPathPrefix: "/auth",
  sessionStorage,
  distribution: AppDistribution.AppStore,
  isEmbeddedApp: true,
  hooks: {
    afterAuth: async ({ session }) => {
      // One declarative public app config owns every subscription. Reinstall
      // may cancel the scheduled uninstall purge, never an erasure in progress.
      await persistVerifiedShopInstallation(prisma, session);
    },
  },
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    expiringOfflineAccessTokens: true,
  },
});

export default shopify;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
async function bindVerifiedShop(domain: string) {
  const shop = await prisma.shop.findUnique({ where: { shopDomain: domain }, select: { id: true, billingStatus: true, erasureStartedAt: true } });
  if (!shop) throw new Response('Shop installation not found', { status: 401 });
  if (shop.erasureStartedAt || ['erasing', 'uninstalled'].includes(shop.billingStatus)) throw new Response('Shop installation inactive', { status: 403 });
  enterTenantContext(shop.id);
}
export const authenticate = {
  ...shopify.authenticate,
  admin: async (...args: Parameters<typeof shopify.authenticate.admin>) => {
    const result = await shopify.authenticate.admin(...args);
    await bindVerifiedShop(result.session.shop);
    return result;
  },
  webhook: async (...args: Parameters<typeof shopify.authenticate.webhook>) => {
    const result = await shopify.authenticate.webhook(...args);
    const installed = await prisma.shop.findUnique({ where: { shopDomain: result.shop }, select: { id: true } });
    if (installed) enterTenantContext(installed.id);
    return result;
  },
  public: {
    ...shopify.authenticate.public,
    appProxy: async (...args: Parameters<typeof shopify.authenticate.public.appProxy>) => {
      const result = await shopify.authenticate.public.appProxy(...args);
      const domain = result.session?.shop || new URL(args[0].url).searchParams.get('shop');
      if (!domain) throw new Response('Missing signed shop', { status: 401 });
      await bindVerifiedShop(domain);
      return result;
    },
  },
};
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
