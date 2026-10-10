import type { LoaderFunctionArgs, HeadersFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useMatches, useRouteError, type ShouldRevalidateFunction } from "@remix-run/react";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { authenticate } from "~/shopify.server";
import { AppFrame } from "~/components/AppFrame";
import { PaymentSetupBanner, billingBannerForRender, revalidateAfterBilling } from "~/components/PaymentSetupBanner";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import adminStyles from "~/styles/admin.css?url";
import prisma from "~/lib/prisma.server";
import { useAppBridgeNavigation } from "~/hooks/useAppBridgeNavigation";
import { billingCapState } from "~/lib/billingPolicy";
import { createElement } from 'react';
import { Banner, Button, BlockStack } from '@shopify/polaris';

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
    needsSetup: !shop?.onboardingCompleted,
  });
}

export const shouldRevalidate: ShouldRevalidateFunction = ({ currentUrl, nextUrl, defaultShouldRevalidate }) =>
  revalidateAfterBilling(currentUrl.pathname, nextUrl.pathname, defaultShouldRevalidate);

export default function AppLayout() {
  const { apiKey, shop, pendingUploads, pendingQueue, billingBanner, needsSetup } =
    useLoaderData<typeof loader>();
  const matches = useMatches();
  const visibleBillingBanner = billingBannerForRender(billingBanner, matches.find(match => match.id === 'routes/app.billing')?.data);


  useAppBridgeNavigation();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      {createElement('s-app-nav', null,
        createElement('a', { href: '/app', rel: 'home' }, 'Dashboard'),
        createElement('a', { href: '/app/setup' }, 'Setup'),
        createElement('a', { href: '/app/products' }, 'Products'),
        createElement('a', { href: '/app/uploads' }, 'Uploads'),
        createElement('a', { href: '/app/queue' }, 'Production'),
        createElement('a', { href: '/app/billing' }, 'Billing'),
        createElement('a', { href: '/app/privacy' }, 'Privacy requests'))}
      <AppFrame
        shop={shop}
        pendingUploads={pendingUploads}
        pendingQueue={pendingQueue}
        notice={
          <BlockStack gap="300">
          {needsSetup && <Banner title="Choose your product and printable limits"><p>Finish setup before adding your upload block.</p><Button url="/app/setup">Start setup</Button></Banner>}
          {visibleBillingBanner ? (
            <PaymentSetupBanner
              status={visibleBillingBanner.status}
              capUsd={visibleBillingBanner.capUsd}
              usedUsd={visibleBillingBanner.usedUsd}
            />
          ) : null}
          </BlockStack>
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
