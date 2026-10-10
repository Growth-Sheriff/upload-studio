import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  AppProvider as PolarisAppProvider,
  Button,
  Card,
  Page,
  Spinner,
  Text,
} from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { LoginErrorType } from "@shopify/shopify-app-remix/server";

import { login } from "~/shopify.server";
import { recoveryAppPath, recoveryShopDomain, shopifyAdminReopenUrl } from "~/lib/embeddedAuthRecovery";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));
  const url = new URL(request.url);
  return { errors, polarisTranslations, apiKey: process.env.SHOPIFY_API_KEY || "", recoveryShop: recoveryShopDomain(url.searchParams.get('recoveryShop')), returnTo: recoveryAppPath(url.searchParams.get('returnTo')) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));
  return { errors };
};

function loginErrorMessage(loginErrors: { shop?: string }): { shop?: string } {
  if (loginErrors?.shop === LoginErrorType.MissingShop) {
    return { shop: "Please enter your shop domain to log in" };
  } else if (loginErrors?.shop === LoginErrorType.InvalidShop) {
    return { shop: "Please enter a valid shop domain to log in" };
  }
  return {};
}

export default function Auth() {
  const loaderData = useLoaderData<typeof loader>();
  const [recoveryShop, setRecoveryShop] = useState(loaderData.recoveryShop);
  useEffect(() => {
    const bridge = window as Window & { shopify?: { config?: { shop?: string } } };
    setRecoveryShop(loaderData.recoveryShop || recoveryShopDomain(bridge.shopify?.config?.shop));
  }, [loaderData.recoveryShop]);
  const recoveryUrl = shopifyAdminReopenUrl(recoveryShop, loaderData.apiKey, loaderData.returnTo);

  // A merchant reaches this route by clicking a link inside the app before the
  // embedded page finished hydrating: the click leaves as a plain document
  // navigation, so it arrives without Shopify's session token. Nothing is
  // broken and nothing needs their attention, so reopen the page inside
  // Shopify instead of parking them on a dead end. One attempt per requested
  // path; a second failure falls through to the card below rather than
  // bouncing them between Shopify and this page.
  const [reopening, setReopening] = useState(false);
  useEffect(() => {
    if (!recoveryUrl) return;
    const attemptKey = `agsu:reopen:${loaderData.returnTo}`;
    let alreadyTried = true;
    try {
      alreadyTried = sessionStorage.getItem(attemptKey) !== null;
      if (!alreadyTried) sessionStorage.setItem(attemptKey, "1");
    } catch {
      alreadyTried = true; // storage blocked — show the manual button instead
    }
    if (alreadyTried) return;
    setReopening(true);
    (window.top ?? window).location.href = recoveryUrl;
  }, [recoveryUrl, loaderData.returnTo]);

  return (
    <PolarisAppProvider i18n={loaderData.polarisTranslations}>
      <Page>
        <Card>
          <div style={{ padding: "2rem", textAlign: "center" }}>
            <Text variant="headingMd" as="h2">
              {reopening ? 'Opening in Shopify' : 'Reconnect to Shopify'}
            </Text>
            <div style={{ margin: "1rem 0" }}>
              <Text as="p">
                {reopening
                  ? 'Taking you back to the page you asked for.'
                  : 'Shopify could not authenticate this request. Reopen the app from Shopify to restore the connection.'}
              </Text>
            </div>
            {reopening ? (
              <Spinner accessibilityLabel="Opening the app in Shopify" size="small" />
            ) : (
              <>
                <Button
                  variant="primary"
                  url={recoveryUrl || 'https://admin.shopify.com'}
                  target="_top"
                >
                  {recoveryUrl ? 'Reopen app in Shopify' : 'Open Shopify admin'}
                </Button>
                <div style={{ marginTop: "1rem" }}>
                  <Text variant="bodySm" as="p" tone="subdued">
                    {recoveryUrl ? 'Your requested page will reopen inside Shopify.' : 'In Shopify, open Apps and select Auto Gang Sheet Upload.'}
                  </Text>
                </div>
              </>
            )}
          </div>
        </Card>
      </Page>
    </PolarisAppProvider>
  );
}
