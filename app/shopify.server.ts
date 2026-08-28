import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
  DeliveryMethod,
  BillingInterval,
} from "@shopify/shopify-app-remix/server";
import { RedisSessionStorage } from "@shopify/shopify-app-session-storage-redis";
import type { Prisma } from "@prisma/client";
import prisma from "~/lib/prisma.server";


const redisSessionStorage = new RedisSessionStorage(
  process.env.REDIS_URL || "redis://localhost:6379"
);



const BILLING_PLANS = {
  STARTER: {
    amount: 9,
    currencyCode: "USD",
    interval: BillingInterval.Every30Days,
    trialDays: 7,


  },
  PRO: {
    amount: 19,
    currencyCode: "USD",
    interval: BillingInterval.Every30Days,
    trialDays: 7,


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
    "write_draft_orders",
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

      shopify.registerWebhooks({ session });


      // Reinstall must reactivate a shop that webhooks.app-uninstalled
      // deactivated (data is retained through uninstall; see that handler).
      const existing = await prisma.shop.findUnique({
        where: { shopDomain: session.shop },
        select: { billingStatus: true, settings: true },
      });
      const reactivating = existing?.billingStatus === "uninstalled";
      const cleanedSettings =
        reactivating && existing?.settings && typeof existing.settings === "object"
          ? (Object.fromEntries(
              Object.entries(existing.settings as Record<string, unknown>).filter(
                ([key]) => key !== "uninstalledAt"
              )
            ) as Prisma.InputJsonObject)
          : undefined;

      await prisma.shop.upsert({
        where: { shopDomain: session.shop },
        update: {
          accessToken: session.accessToken,
          updatedAt: new Date(),
          ...(reactivating
            ? { billingStatus: "active", ...(cleanedSettings ? { settings: cleanedSettings } : {}) }
            : {}),
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

