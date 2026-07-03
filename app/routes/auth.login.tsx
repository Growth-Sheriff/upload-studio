import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import {
  AppProvider as PolarisAppProvider,
  Button,
  Card,
  FormLayout,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { login } from "~/shopify.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));
  return { errors, polarisTranslations };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));
  return { errors };
};

function loginErrorMessage(loginErrors: any) {
  if (loginErrors?.shop === "MissingShop") {
    return { shop: "Please enter your shop domain to log in" };
  } else if (loginErrors?.shop === "InvalidShop") {
    return { shop: "Please enter a valid shop domain to log in" };
  }
  return {};
}

export default function Auth() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [shop, setShop] = useState("");
  const { errors } = actionData || loaderData;



  if (typeof window !== "undefined" && window.top !== window.self) {
    return (
      <PolarisAppProvider i18n={loaderData.polarisTranslations}>
        <Page>
          <Card>
             <div style={{ padding: "2rem", textAlign: "center" }}>
                <Text variant="headingMd" as="h2">Session Expired</Text>
                <div style={{ margin: "1rem 0" }}>
                  <Text as="p">Your session has expired or the connection was lost.</Text>
                </div>
                <Button
                   variant="primary"
                   onClick={() => {


                        try {
                            if (window.top) window.top.location.reload();
                        } catch (e) {

                        }
                   }}
                >
                   Reload App
                </Button>
                <div style={{ marginTop: "1rem" }}>
                    <Text variant="bodySm" as="p" tone="subdued">
                        If the button doesn't work, <a href="/auth/login" target="_blank">open in new tab</a> to log in.
                    </Text>
                </div>
             </div>
          </Card>
        </Page>
      </PolarisAppProvider>
    );
  }

  return (
    <PolarisAppProvider i18n={loaderData.polarisTranslations}>
      <Page>
        <Card>
          <Form method="post">
            <FormLayout>
              <Text variant="headingMd" as="h2">
                Log in
              </Text>
              <TextField
                type="text"
                name="shop"
                label="Shop domain"
                helpText="example.myshopify.com"
                value={shop}
                onChange={setShop}
                autoComplete="on"
                error={errors?.shop}
              />
              <Button submit>Log in</Button>
            </FormLayout>
          </Form>
        </Card>
      </Page>
    </PolarisAppProvider>
  );
}
