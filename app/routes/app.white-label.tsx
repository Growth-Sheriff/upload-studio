import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useActionData, Form, useNavigation } from "@remix-run/react";
import {
  Page, Layout, Card, Text, BlockStack, InlineStack,
  Button, Banner, TextField, Checkbox, Box
} from "@shopify/polaris";
import { useState } from "react";
import { authenticate } from "~/shopify.server";
import prisma from "~/lib/prisma.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  let shop = await prisma.shop.findUnique({
    where: { shopDomain },
    include: {
      whiteLabelConfig: true,
    },
  });

  if (!shop) {
    shop = await prisma.shop.create({
      data: {
        shopDomain,
        accessToken: session.accessToken || "",
        plan: "starter",
        billingStatus: "active",
        storageProvider: "r2",
        settings: {},
      },
      include: {
        whiteLabelConfig: true,
      },
    });
  }

  return json({
    plan: shop.plan,
    config: shop.whiteLabelConfig || {
      enabled: false,
      logoUrl: null,
      primaryColor: "#5c6ac4",
      secondaryColor: "#47c1bf",
      customCss: null,
      hideBranding: false,
      customDomain: null,
    },
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
  });

  if (!shop) {
    return json({ error: "Shop not found" }, { status: 404 });
  }

  // Check pro plan (white-label included in Pro)
  if (shop.plan !== "pro" && shop.plan !== "enterprise") {
    return json({ error: "White-label requires Pro plan" }, { status: 403 });
  }

  const formData = await request.formData();

  const enabled = formData.get("enabled") === "on";
  const logoUrl = formData.get("logoUrl") as string;
  const primaryColor = formData.get("primaryColor") as string;
  const secondaryColor = formData.get("secondaryColor") as string;
  const customCss = formData.get("customCss") as string;
  const hideBranding = formData.get("hideBranding") === "on";
  const customDomain = formData.get("customDomain") as string;

  // Upsert white label config
  await prisma.whiteLabelConfig.upsert({
    where: { shopId: shop.id },
    update: {
      enabled,
      logoUrl: logoUrl || null,
      primaryColor: primaryColor || null,
      secondaryColor: secondaryColor || null,
      customCss: customCss || null,
      hideBranding,
      customDomain: customDomain || null,
    },
    create: {
      shopId: shop.id,
      enabled,
      logoUrl: logoUrl || null,
      primaryColor: primaryColor || null,
      secondaryColor: secondaryColor || null,
      customCss: customCss || null,
      hideBranding,
      customDomain: customDomain || null,
    },
  });

  await prisma.auditLog.create({
    data: {
      shopId: shop.id,
      action: "white_label_update",
      resourceType: "white_label_config",
      metadata: { enabled, hideBranding },
    },
  });

  return json({ success: true, message: "White-label settings saved" });
}

export default function WhiteLabelPage() {
  const { plan, config } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [enabled, setEnabled] = useState(config.enabled);
  const [logoUrl, setLogoUrl] = useState(config.logoUrl || "");
  const [primaryColor, setPrimaryColor] = useState(config.primaryColor || "#5c6ac4");
  const [secondaryColor, setSecondaryColor] = useState(config.secondaryColor || "#47c1bf");
  const [customCss, setCustomCss] = useState(config.customCss || "");
  const [hideBranding, setHideBranding] = useState(config.hideBranding);
  const [customDomain, setCustomDomain] = useState(config.customDomain || "");

  const canUseWhiteLabel = plan === "pro" || plan === "enterprise";

  return (
    <Page
      title="White-Label Settings"
      backAction={{ content: "Settings", url: "/app/settings" }}
    >
        <Layout>
          {/* Action result banner */}
          {actionData && "success" in actionData && (
            <Layout.Section>
              <Banner tone="success" onDismiss={() => {}}>
                {actionData.message}
              </Banner>
            </Layout.Section>
          )}
          {actionData && "error" in actionData && (
            <Layout.Section>
              <Banner tone="critical" onDismiss={() => {}}>
                {actionData.error}
              </Banner>
            </Layout.Section>
          )}

          {/* Plan restriction */}
          {!canUseWhiteLabel && (
            <Layout.Section>
              <Banner tone="warning">
                <p>White-label customization requires <strong>Pro</strong> plan.</p>
                <Button url="/app/billing">Upgrade Plan</Button>
              </Banner>
            </Layout.Section>
          )}

          <Form method="post">
            {/* Enable/Disable */}
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Checkbox
                    label="Enable White-Label"
                    checked={enabled}
                    onChange={setEnabled}
                    name="enabled"
                    disabled={!canUseWhiteLabel}
                  />
                  <Text as="p" variant="bodySm" tone="subdued">
                    When enabled, your custom branding will be shown to customers instead of default branding.
                  </Text>
                </BlockStack>
              </Card>
            </Layout.Section>

            {/* Logo */}
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Logo</Text>

                  <TextField
                    label="Logo URL"
                    value={logoUrl}
                    onChange={setLogoUrl}
                    name="logoUrl"
                    placeholder="https://..."
                    helpText="Recommended size: 200x50px, transparent PNG"
                    autoComplete="off"
                    disabled={!canUseWhiteLabel}
                  />

                  {logoUrl && (
                    <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                      <Text as="p" variant="bodySm">Preview:</Text>
                      <img
                        src={logoUrl}
                        alt="Logo preview"
                        style={{ maxHeight: 50, marginTop: 8 }}
                        onError={(e) => (e.currentTarget.style.display = "none")}
                      />
                    </Box>
                  )}
                </BlockStack>
              </Card>
            </Layout.Section>

            {/* Colors */}
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Colors</Text>

                  <InlineStack gap="400">
                    <BlockStack gap="100">
                      <TextField
                        label="Primary Color"
                        value={primaryColor}
                        onChange={setPrimaryColor}
                        name="primaryColor"
                        placeholder="#5c6ac4"
                        helpText="Hex color code"
                        autoComplete="off"
                        disabled={!canUseWhiteLabel}
                        prefix={
                          <div
                            style={{
                              width: 16,
                              height: 16,
                              backgroundColor: primaryColor,
                              borderRadius: 3,
                              border: "1px solid #ddd",
                            }}
                          />
                        }
                      />
                    </BlockStack>

                    <BlockStack gap="100">
                      <TextField
                        label="Secondary Color"
                        value={secondaryColor}
                        onChange={setSecondaryColor}
                        name="secondaryColor"
                        placeholder="#47c1bf"
                        helpText="Hex color code"
                        autoComplete="off"
                        disabled={!canUseWhiteLabel}
                        prefix={
                          <div
                            style={{
                              width: 16,
                              height: 16,
                              backgroundColor: secondaryColor,
                              borderRadius: 3,
                              border: "1px solid #ddd",
                            }}
                          />
                        }
                      />
                    </BlockStack>
                  </InlineStack>
                </BlockStack>
              </Card>
            </Layout.Section>

            {/* Branding */}
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Branding</Text>

                  <Checkbox
                    label="Hide default branding"
                    helpText="Remove 'Powered by' text from customer-facing widgets"
                    checked={hideBranding}
                    onChange={setHideBranding}
                    name="hideBranding"
                    disabled={!canUseWhiteLabel}
                  />
                </BlockStack>
              </Card>
            </Layout.Section>

            {/* Custom CSS */}
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Custom CSS</Text>

                  <TextField
                    label="Custom Styles"
                    value={customCss}
                    onChange={setCustomCss}
                    name="customCss"
                    multiline={6}
                    placeholder=".upload-lift-container { ... }"
                    helpText="Add custom CSS to style the upload widgets"
                    autoComplete="off"
                    disabled={!canUseWhiteLabel}
                  />
                </BlockStack>
              </Card>
            </Layout.Section>

            {/* Custom Domain */}
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Custom Domain (Preview URLs)</Text>

                  <TextField
                    label="Custom Domain"
                    value={customDomain}
                    onChange={setCustomDomain}
                    name="customDomain"
                    placeholder="uploads.yourstore.com"
                    helpText="Use your own domain for preview URLs (requires DNS configuration)"
                    autoComplete="off"
                    disabled={!canUseWhiteLabel}
                  />

                  <Banner tone="info">
                    Contact support for custom domain setup instructions.
                  </Banner>
                </BlockStack>
              </Card>
            </Layout.Section>

            {/* Save */}
            <Layout.Section>
              <InlineStack align="end">
                <Button
                  variant="primary"
                  submit
                  loading={isSubmitting}
                  disabled={!canUseWhiteLabel}
                >
                  Save Settings
                </Button>
              </InlineStack>
            </Layout.Section>
          </Form>
        </Layout>
      </Page>
  );
}

