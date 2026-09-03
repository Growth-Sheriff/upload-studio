import type { LoaderFunctionArgs, HeadersFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useRouteError } from "@remix-run/react";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { authenticate } from "~/shopify.server";
import { AppFrame } from "~/components/AppFrame";
import { PaymentSetupBanner } from "~/components/PaymentSetupBanner";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import adminStyles from "~/styles/admin.css?url";
import prisma from "~/lib/prisma.server";
import { useAppBridgeNavigation } from "~/hooks/useAppBridgeNavigation";

export const links = () => [
  { rel: "stylesheet", href: polarisStyles },
  { rel: "stylesheet", href: adminStyles },
];



export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);


  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
  });

  let pendingUploads = 0;
  let pendingQueue = 0;
  let billingBanner: {
    pendingAmount: string;
    pendingOrderCount: number;
    hasOverdueRetry: boolean;
    retryNextAt: string | null;
  } | null = null;

  if (shop) {

    pendingUploads = await prisma.upload.count({
      where: {
        shopId: shop.id,
        status: { in: ["uploaded", "needs_review"] }
      },
    });


    pendingQueue = await prisma.upload.count({
      where: {
        shopId: shop.id,
        status: "needs_review"
      },
    });

    const hasVault = Boolean(
      (shop.stripePaymentMethodId && shop.stripeAutoCharge) ||
      (shop.paypalVaultId && shop.paypalAutoCharge)
    );
    const billingState = ((shop.settings as Record<string, any>)?.billing ?? {}) as {
      retryNextAt?: string;
      retryCount?: number;
    };
    const hasOverdueRetry =
      Boolean(billingState.retryNextAt) && (billingState.retryCount || 0) > 0;

    if (!hasVault || hasOverdueRetry) {
      const pendingAgg = await prisma.commission.aggregate({
        where: { shopId: shop.id, status: 'pending' },
        _sum: { commissionAmount: true },
        _count: true,
      });
      const amount = Number(pendingAgg._sum.commissionAmount ?? 0);
      if (amount > 0 || hasOverdueRetry) {
        billingBanner = {
          pendingAmount: amount.toFixed(2),
          pendingOrderCount: pendingAgg._count || 0,
          hasOverdueRetry,
          retryNextAt: billingState.retryNextAt ?? null,
        };
      }
    }
  }

  return json({
    apiKey: process.env.SHOPIFY_API_KEY || "",
    shop: session.shop,
    pendingUploads,
    pendingQueue,
    billingBanner,
  });
}

export default function AppLayout() {
  const { apiKey, shop, pendingUploads, pendingQueue, billingBanner } =
    useLoaderData<typeof loader>();


  useAppBridgeNavigation();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <AppFrame
        shop={shop}
        pendingUploads={pendingUploads}
        pendingQueue={pendingQueue}
        notice={
          billingBanner ? (
            <PaymentSetupBanner
              pendingAmount={billingBanner.pendingAmount}
              pendingOrderCount={billingBanner.pendingOrderCount}
              hasOverdueRetry={billingBanner.hasOverdueRetry}
              retryNextAt={billingBanner.retryNextAt}
            />
          ) : null
        }
      />
    </AppProvider>
  );
}


export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};