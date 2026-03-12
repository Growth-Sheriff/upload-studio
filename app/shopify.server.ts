import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
  DeliveryMethod,
  BillingInterval,
} from "@shopify/shopify-app-remix/server";
import { RedisSessionStorage } from "@shopify/shopify-app-session-storage-redis";
import prisma from "~/lib/prisma.server";

// Redis session storage
const redisSessionStorage = new RedisSessionStorage(
  process.env.REDIS_URL || "redis://localhost:6379"
);

// ===== BILLING PLANS v2.0 =====
// Two-tier usage-based pricing model
const BILLING_PLANS = {
  STARTER: {
    amount: 9,
    currencyCode: "USD",
    interval: BillingInterval.Every30Days,
    trialDays: 7,
    // Usage charges handled via AppUsageRecord API
    // 20 free orders, then $0.05/order
  },
  PRO: {
    amount: 19,
    currencyCode: "USD",
    interval: BillingInterval.Every30Days,
    trialDays: 7,
    // Usage charges handled via AppUsageRecord API
    // 30 free orders, then $0.06/order
  },
};

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY || "",
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October25,
  scopes: process.env.SHOPIFY_SCOPES?.split(",") || [
    "read_products",
    "write_products",
    "read_orders",
    "write_orders",
    "read_customers",
  ],
  appUrl: process.env.SHOPIFY_APP_URL!,
  authPathPrefix: "/auth",
  sessionStorage: redisSessionStorage,
  distribution: AppDistribution.AppStore,
  isEmbeddedApp: true,
  billing: BILLING_PLANS,
  webhooks: {
    APP_UNINSTALLED: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/app-uninstalled",
    },
    ORDERS_CREATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/orders-create",
    },
    ORDERS_PAID: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/orders-paid",
    },
    ORDERS_CANCELLED: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/orders-cancelled",
    },
    ORDERS_FULFILLED: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/orders-fulfilled",
    },
    PRODUCTS_UPDATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/products-update",
    },
    PRODUCTS_DELETE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/products-delete",
    },
  },
  hooks: {
    afterAuth: async ({ session }) => {
      // Register webhooks after auth
      shopify.registerWebhooks({ session });

      // Sync shop to database
      await prisma.shop.upsert({
        where: { shopDomain: session.shop },
        update: {
          accessToken: session.accessToken,
          updatedAt: new Date(),
        },
        create: {
          shopDomain: session.shop,
          accessToken: session.accessToken || "",
          plan: "starter",
          billingStatus: "active",
          storageProvider: "r2",
          settings: {},
        },
      });
    },
  },
  future: {
    unstable_newEmbeddedAuthStrategy: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;

