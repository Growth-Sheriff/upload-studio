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
import { billingCapState } from "~/lib/billing.server";

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
    status: string;
    capUsd: number;
    usedUsd: number;
  } | null = null;

  if (shop) {

    // Badge on "Uploads": files a merchant may want to look at that are not
    // ordered yet (warnings land in pending_approval) plus ordered-unpaid.
    pendingUploads = await prisma.upload.count({
      where: {
        shopId: shop.id,
        status: { in: ["pending_approval", "needs_review"] }
      },
    });


    pendingQueue = await prisma.upload.count({
      where: {
        shopId: shop.id,
        status: "needs_review"
      },
    });

    const state = await prisma.shopBilling.findUnique({ where: { shopId: shop.id } });
    const capUsd = Number(state?.cappedAmountUsd || 0);
    const usedUsd = Number(state?.balanceUsedUsd || 0);
    if (state?.status !== 'active' || billingCapState(capUsd, usedUsd) !== 'available') {
      billingBanner = { status: state?.status || 'inactive', capUsd, usedUsd };
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
              status={billingBanner.status}
              capUsd={billingBanner.capUsd}
              usedUsd={billingBanner.usedUsd}
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
