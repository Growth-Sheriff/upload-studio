import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useActionData, Form, useNavigation } from "@remix-run/react";
import {
  Page, Layout, Card, Text, BlockStack, InlineStack,
  TextField, Button, Banner, FormLayout, Box, Badge, Divider,
  Checkbox, Select, RangeSlider
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "~/shopify.server";
import prisma from "~/lib/prisma.server";
import { getAutoSheetConfig, saveAutoSheetConfig, DEFAULT_AUTO_SHEET_CONFIG } from "~/lib/autoSheet.server";
import type { AutoSheetConfig } from "~/lib/autoSheet.server";


const SHOP_INFO_QUERY = `
  query {
    shop {
      name
      email
    }
  }
`;

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const shopDomain = session.shop;


  let shopifyShopName = "";
  let shopifyEmail = "";
  try {
    const response = await admin.graphql(SHOP_INFO_QUERY);
    const data = await response.json();
    shopifyShopName = data?.data?.shop?.name || "";
    shopifyEmail = data?.data?.shop?.email || "";
  } catch (e) {
    console.warn("[Settings] Could not fetch shop info from Shopify");
  }

  let shop = await prisma.shop.findUnique({
    where: { shopDomain },
  });

  if (!shop) {
    shop = await prisma.shop.create({
      data: {
        shopDomain,
        accessToken: session.accessToken || "",
        plan: "starter",
        billingStatus: "active",
        storageProvider: "local",
        settings: {},
      },
    });
  }

  const settings = (shop.settings as Record<string, unknown>) || {};


  const autoSheetConfig = await getAutoSheetConfig(shopDomain);

  return json({
    shop: {
      domain: shop.shopDomain,
      plan: shop.plan,
    },
    storageConfig: {
      provider: "local",
      isConfigured: true,
    },
    settings: {

      shopName: (settings.shopName as string) || shopifyShopName,
      notificationEmail: (settings.notificationEmail as string) || shopifyEmail,
      autoApprove: settings.autoApprove || false,
      watermarkEnabled: false,
      redisEnabled: settings.redisEnabled || false,
    },
    autoSheet: autoSheetConfig,
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

  const formData = await request.formData();
  const action = formData.get("_action");




  if (action === "save_general") {
    const shopName = formData.get("shopName") as string;
    const notificationEmail = formData.get("notificationEmail") as string;
    const autoApprove = formData.get("autoApprove") === "on";

    const existingSettings = (shop.settings as Record<string, unknown>) || {};

    await prisma.shop.update({
      where: { id: shop.id },
      data: {
        settings: {
          ...existingSettings,
          shopName,
          notificationEmail,
          autoApprove,
        },
      },
    });

    return json({ success: true, message: "General settings saved" });
  }

  if (action === "save_auto_sheet") {
    const enabled = formData.get("enabled") === "true";




    const config: Partial<AutoSheetConfig> = { enabled };

    if (formData.has("gapMm")) {
      const gapMm = parseInt(formData.get("gapMm") as string, 10);
      if (!isNaN(gapMm)) config.gapMm = gapMm;
    }
    if (formData.has("marginMm")) {
      const marginMm = parseInt(formData.get("marginMm") as string, 10);
      if (!isNaN(marginMm)) config.marginMm = marginMm;
    }
    if (formData.has("allowRotation")) {
      config.allowRotation = formData.get("allowRotation") === "true";
    }
    if (formData.has("strategy")) {
      config.strategy = formData.get("strategy") as AutoSheetConfig["strategy"];
    }
    if (formData.has("showSimulator")) {
      config.showSimulator = formData.get("showSimulator") === "true";
    }
    if (formData.has("showAlternatives")) {
      config.showAlternatives = formData.get("showAlternatives") === "true";
    }
    if (formData.has("showComparison")) {
      config.showComparison = formData.get("showComparison") === "true";
    }
    if (formData.has("showQuantitySuggestion")) {
      config.showQuantitySuggestion = formData.get("showQuantitySuggestion") === "true";
    }

    await saveAutoSheetConfig(shopDomain, config);

    return json({ success: true, message: "Auto sheet calculator settings saved" });
  }

  return json({ error: "Unknown action" }, { status: 400 });
}

export default function SettingsPage() {
  const { shop, storageConfig, settings, autoSheet } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";


  const [shopName, setShopName] = useState(settings.shopName as string);
  const [notificationEmail, setNotificationEmail] = useState(settings.notificationEmail as string);


  const [sheetEnabled, setSheetEnabled] = useState(autoSheet.enabled);
  const [sheetGap, setSheetGap] = useState(autoSheet.gapMm);
  const [sheetMargin, setSheetMargin] = useState(autoSheet.marginMm);
  const [sheetRotation, setSheetRotation] = useState(autoSheet.allowRotation);
  const [sheetStrategy, setSheetStrategy] = useState(autoSheet.strategy);
  const [sheetSimulator, setSheetSimulator] = useState(autoSheet.showSimulator);
  const [sheetAlternatives, setSheetAlternatives] = useState(autoSheet.showAlternatives);
  const [sheetComparison, setSheetComparison] = useState(autoSheet.showComparison);
  const [sheetQtySuggestion, setSheetQtySuggestion] = useState(autoSheet.showQuantitySuggestion);

  const handleSheetGapChange = useCallback((value: number) => setSheetGap(value), []);
  const handleSheetMarginChange = useCallback((value: number) => setSheetMargin(value), []);

  return (
    <Page title="Settings" backAction={{ content: "Dashboard", url: "/app" }}>
        <Layout>

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


          <Layout.Section>
            <Card>
              <Form method="post">
                <input type="hidden" name="_action" value="save_general" />
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">General Settings</Text>

                  <FormLayout>
                    <TextField
                      label="Shop Name"
                      name="shopName"
                      value={shopName}
                      onChange={setShopName}
                      autoComplete="off"
                    />

                    <TextField
                      label="Notification Email"
                      name="notificationEmail"
                      type="email"
                      value={notificationEmail}
                      onChange={setNotificationEmail}
                      helpText="Receive notifications about uploads and orders"
                      autoComplete="off"
                    />
                  </FormLayout>

                  <InlineStack align="end">
                    <Button submit loading={isSubmitting}>
                      Save General Settings
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Form>
            </Card>
          </Layout.Section>


          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">Storage</Text>
                  <Badge tone="success">Local Storage Active</Badge>
                </InlineStack>

                <Banner tone="info">
                  <p>
                    <strong>Secure Local Storage:</strong> All customer uploads are stored securely on the server.
                    Files are accessed via time-limited signed URLs for maximum security.
                  </p>
                </Banner>
              </BlockStack>
            </Card>
          </Layout.Section>


          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Current Plan</Text>

                <InlineStack align="space-between">
                  <Box>
                    <Text as="p" variant="bodyLg" fontWeight="semibold">
                      {shop.plan.toUpperCase()}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {shop.plan === "starter" && "20 free orders/month, then $0.05/order"}
                      {shop.plan === "pro" && "30 free orders/month, then $0.06/order, all features"}
                    </Text>
                  </Box>

                  {shop.plan === "starter" && (
                    <Button url="/app/billing">
                      Upgrade to Pro
                    </Button>
                  )}
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>


          <Layout.Section>
            <Card>
              <Form method="post">
                <input type="hidden" name="_action" value="save_auto_sheet" />
                <BlockStack gap="400">
                  <InlineStack align="space-between">
                    <Text as="h2" variant="headingMd">🧮 Auto Sheet Size Calculator</Text>
                    <Badge tone={sheetEnabled ? "success" : "enabled"}>
                      {sheetEnabled ? "Active" : "Inactive"}
                    </Badge>
                  </InlineStack>

                  <Text as="p" variant="bodySm" tone="subdued">
                    Automatically calculates the optimal sheet size for customers based on their design dimensions and quantity.
                    Reduces waste and helps customers choose the most cost-effective variant.
                  </Text>

                  <Divider />

                  <Checkbox
                    label="Enable Auto Sheet Calculator"
                    helpText="Show the sheet size calculator modal on product pages"
                    checked={sheetEnabled}
                    onChange={setSheetEnabled}
                  />
                  <input type="hidden" name="enabled" value={sheetEnabled ? "true" : "false"} />

                  {sheetEnabled && (
                    <BlockStack gap="400">
                      <Divider />

                      <Text as="h3" variant="headingSm">Layout Settings</Text>

                      <RangeSlider
                        label={`Gap Between Designs: ${sheetGap}mm`}
                        value={sheetGap}
                        min={0}
                        max={20}
                        step={1}
                        onChange={handleSheetGapChange}
                        helpText="Space between each design placement on the sheet"
                        output
                      />
                      <input type="hidden" name="gapMm" value={sheetGap.toString()} />

                      <RangeSlider
                        label={`Sheet Margin: ${sheetMargin}mm`}
                        value={sheetMargin}
                        min={0}
                        max={20}
                        step={1}
                        onChange={handleSheetMarginChange}
                        helpText="Safe area margin from sheet edges"
                        output
                      />
                      <input type="hidden" name="marginMm" value={sheetMargin.toString()} />

                      <Checkbox
                        label="Allow Design Rotation"
                        helpText="Allow 90° rotation of designs for better fit"
                        checked={sheetRotation}
                        onChange={setSheetRotation}
                      />
                      <input type="hidden" name="allowRotation" value={sheetRotation ? "true" : "false"} />

                      <Divider />

                      <Text as="h3" variant="headingSm">Optimization Strategy</Text>

                      <Select
                        label="Strategy"
                        options={[
                          { label: "Balanced (Recommended)", value: "balanced" },
                          { label: "Minimize Waste", value: "waste" },
                          { label: "Fewest Sheets", value: "sheets" },
                          { label: "Lowest Cost", value: "cost" },
                        ]}
                        value={sheetStrategy}
                        onChange={setSheetStrategy}
                        helpText="How to prioritize when recommending sheet sizes"
                      />
                      <input type="hidden" name="strategy" value={sheetStrategy} />

                      <Divider />

                      <Text as="h3" variant="headingSm">Display Options</Text>

                      <Checkbox
                        label="Show Visual Simulator"
                        helpText="Interactive canvas showing how designs are placed on the sheet"
                        checked={sheetSimulator}
                        onChange={setSheetSimulator}
                      />
                      <input type="hidden" name="showSimulator" value={sheetSimulator ? "true" : "false"} />

                      <Checkbox
                        label="Show Alternative Sizes"
                        helpText="Display other sheet size options besides the recommended one"
                        checked={sheetAlternatives}
                        onChange={setSheetAlternatives}
                      />
                      <input type="hidden" name="showAlternatives" value={sheetAlternatives ? "true" : "false"} />

                      <Checkbox
                        label="Show Comparison Table"
                        helpText="Detailed comparison table of all sheet sizes"
                        checked={sheetComparison}
                        onChange={setSheetComparison}
                      />
                      <input type="hidden" name="showComparison" value={sheetComparison ? "true" : "false"} />

                      <Checkbox
                        label="Show Quantity Suggestions"
                        helpText="Suggest quantity adjustments to reduce waste"
                        checked={sheetQtySuggestion}
                        onChange={setSheetQtySuggestion}
                      />
                      <input type="hidden" name="showQuantitySuggestion" value={sheetQtySuggestion ? "true" : "false"} />
                    </BlockStack>
                  )}

                  <InlineStack align="end">
                    <Button submit loading={isSubmitting}>
                      Save Calculator Settings
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Form>
            </Card>
          </Layout.Section>


          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">📦 Collection Quick Upload Button</Text>
                  <Badge tone="success">Full API Integration</Badge>
                </InlineStack>

                <Text as="p" variant="bodyMd" tone="subdued">
                  Add a powerful "Upload Design" button to your collection pages. Customers can upload, select variants, and add to cart without leaving the collection page.
                </Text>

                <Banner tone="info">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" fontWeight="semibold">Features included:</Text>
                    <Text as="p" variant="bodySm">
                      ✓ Full modal with upload area • ✓ Variant selection • ✓ Quantity selector • ✓ DPI validation • ✓ Direct add to cart • ✓ Real API integration
                    </Text>
                  </BlockStack>
                </Banner>

                <Divider />

                <Box paddingBlockStart="200">
                  <Text as="h3" variant="headingSm">Step 1: Create the Snippet File</Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Go to <strong>Online Store → Themes → Edit Code → snippets</strong> folder and click "Add a new snippet". Name it <code>dtf-quick-upload-btn</code>
                  </Text>
                </Box>

                <Box paddingBlockStart="200">
                  <Text as="h3" variant="headingSm">Step 2: Copy the Code</Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Copy the code below and paste it into your new snippet file:
                  </Text>
                </Box>

                <Box
                  background="bg-surface-secondary"
                  padding="400"
                  borderRadius="200"
                >
                  <BlockStack gap="200">
                    <InlineStack align="end">
                      <Button
                        size="slim"
                        onClick={() => {
                          const code = document.getElementById('snippet-code-full')?.textContent || '';
                          navigator.clipboard.writeText(code);
                          shopify.toast.show('Code copied to clipboard!');
                        }}
                      >
                        📋 Copy Full Code
                      </Button>
                    </InlineStack>
                    <Box overflowX="auto" maxHeight="300px">
                      <pre id="snippet-code-full" style={{ fontSize: '10px', lineHeight: '1.3', margin: 0, whiteSpace: 'pre' }}>
{`{% liquid
  assign btn_text = button_text | default: 'Upload Design'
  assign section_id = section.id | default: 'main'
  assign unique_id = section_id | append: '-' | append: product.id
  assign modal_id = 'ul-modal-' | append: unique_id
  assign first_variant = product.selected_or_first_available_variant
  assign api_base = '/apps/customizer'
  assign shop_domain = shop.permanent_domain
%}
<button type="button" class="ul-quick-btn-trigger" data-modal="{{ modal_id }}" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:12px 20px;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;width:100%;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;box-shadow:0 2px 8px rgba(102,126,234,0.3);font-family:inherit;">
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
  <span>{{ btn_text }}</span>
</button>
<template id="{{ modal_id }}-tpl">
<div id="{{ modal_id }}" class="ul-quick-modal" data-api-base="{{ api_base }}" data-shop="{{ shop_domain }}" data-product-id="{{ product.id }}" data-unique-id="{{ unique_id }}">
  <div class="ul-quick-modal-overlay" data-close="{{ modal_id }}"></div>
  <div class="ul-quick-modal-content">
    <button class="ul-quick-modal-close" data-close="{{ modal_id }}">&times;</button>
    <div id="{{ modal_id }}-step1" class="ul-modal-step">
      <div class="ul-quick-modal-header">
        <img src="{{ product.featured_image | image_url: width: 80 }}" alt="{{ product.title }}" class="ul-quick-modal-thumb">
        <div><h3>{{ product.title }}</h3><p class="ul-price">{{ first_variant.price | money }}</p></div>
      </div>
      <div class="ul-quick-modal-body">
        <div class="ul-quick-dropzone" id="ul-dropzone-{{ unique_id }}">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <p><strong>Click to upload</strong></p><span>PNG, JPG, PDF (Max 25MB)</span>
          <input type="file" id="ul-file-{{ unique_id }}" accept=".png,.jpg,.jpeg,.pdf" style="display:none">
        </div>
        <div id="ul-progress-{{ unique_id }}" class="ul-upload-progress" style="display:none;"><div class="ul-progress-bar"><div class="ul-progress-fill" id="ul-progress-fill-{{ unique_id }}"></div></div><p id="ul-progress-text-{{ unique_id }}">Uploading...</p></div>
        <div id="ul-preview-{{ unique_id }}" class="ul-quick-preview" style="display:none;"><img id="ul-preview-img-{{ unique_id }}" src="" alt="Preview"><div class="ul-preview-info"><span id="ul-preview-name-{{ unique_id }}"></span><span id="ul-preview-status-{{ unique_id }}" class="ul-status-badge"></span></div><button type="button" data-clear="{{ unique_id }}" data-modal="{{ modal_id }}">&times;</button></div>
        <div id="ul-dpi-warning-{{ unique_id }}" class="ul-dpi-warning" style="display:none;"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg><span id="ul-dpi-text-{{ unique_id }}"></span></div>
        {% if product.has_only_default_variant == false %}<div class="ul-variants-section">{% for option in product.options_with_values %}<div class="ul-variant-group"><label>{{ option.name }}</label><select id="ul-option-{{ unique_id }}-{{ forloop.index0 }}" class="ul-variant-select">{% for value in option.values %}<option value="{{ value }}" {% if option.selected_value == value %}selected{% endif %}>{{ value }}</option>{% endfor %}</select></div>{% endfor %}</div>{% endif %}
        <div class="ul-quantity-section"><label>Quantity</label><div class="ul-quantity-wrapper"><button type="button" data-qty="{{ unique_id }}" data-delta="-1">−</button><input type="number" id="ul-qty-{{ unique_id }}" value="1" min="1" max="99"><button type="button" data-qty="{{ unique_id }}" data-delta="1">+</button></div></div>
        <input type="hidden" id="ul-variant-{{ unique_id }}" value="{{ first_variant.id }}"><input type="hidden" id="ul-upload-id-{{ unique_id }}" value="">
      </div>
      <div class="ul-quick-modal-footer"><button type="button" class="ul-quick-btn-primary" id="ul-addcart-{{ unique_id }}" data-add-cart="{{ unique_id }}" data-modal="{{ modal_id }}" disabled><span class="ul-btn-text">Add to Cart</span><span class="ul-btn-loading" style="display:none;">Adding...</span></button><p class="ul-upload-hint" id="ul-hint-{{ unique_id }}">Please upload your design first</p></div>
    </div>
    <div id="{{ modal_id }}-step2" class="ul-modal-step" style="display:none;"><div class="ul-success-content"><div class="ul-success-icon">✓</div><h3>Added to Cart!</h3><p>Your custom design has been uploaded and added to cart.</p></div><div class="ul-quick-modal-footer ul-success-buttons"><button type="button" class="ul-btn-secondary" data-close="{{ modal_id }}">Continue Shopping</button><a href="/checkout" class="ul-quick-btn-primary">Checkout</a></div></div>
  </div>
</div>
</template>
<script type="application/json" id="ul-variants-{{ unique_id }}">{{ product.variants | json }}</script>
<style>.ul-quick-modal{position:fixed;top:0;left:0;width:100%;height:100%;z-index:99999;display:none;align-items:center;justify-content:center}.ul-quick-modal-overlay{position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px)}.ul-quick-modal-content{position:relative;background:white;border-radius:16px;width:90%;max-width:420px;max-height:90vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3);animation:modalSlideIn 0.3s ease}@keyframes modalSlideIn{from{opacity:0;transform:translateY(20px) scale(0.95)}to{opacity:1;transform:translateY(0) scale(1)}}.ul-quick-modal-close{position:absolute;top:12px;right:12px;width:32px;height:32px;border:none;background:#f3f4f6;border-radius:50%;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#6b7280;z-index:10}.ul-quick-modal-close:hover{background:#e5e7eb}.ul-quick-modal-header{display:flex;align-items:center;gap:16px;padding:20px;border-bottom:1px solid #e5e7eb}.ul-quick-modal-thumb{width:60px;height:60px;object-fit:cover;border-radius:8px}.ul-quick-modal-header h3{margin:0 0 4px 0;font-size:16px;color:#1f2937}.ul-price{margin:0;font-size:15px;font-weight:600;color:#667eea}.ul-quick-modal-body{padding:20px}.ul-quick-dropzone{border:2px dashed #d1d5db;border-radius:12px;padding:24px 20px;text-align:center;cursor:pointer;transition:all 0.2s;background:#f9fafb}.ul-quick-dropzone:hover{border-color:#667eea;background:rgba(102,126,234,0.05)}.ul-quick-dropzone svg{color:#9ca3af;margin-bottom:8px}.ul-quick-dropzone p{margin:0 0 4px 0;font-size:14px;color:#374151}.ul-quick-dropzone span{font-size:12px;color:#9ca3af}.ul-upload-progress{padding:20px;text-align:center;background:#f9fafb;border-radius:12px}.ul-progress-bar{height:6px;background:#e5e7eb;border-radius:3px;overflow:hidden;margin-bottom:10px}.ul-progress-fill{height:100%;background:linear-gradient(90deg,#667eea,#764ba2);width:0%;transition:width 0.3s ease}.ul-upload-progress p{margin:0;font-size:13px;color:#6b7280}.ul-quick-preview{display:flex;align-items:center;gap:12px;padding:12px;background:#f0fdf4;border:1px solid #86efac;border-radius:8px}.ul-quick-preview img{width:48px;height:48px;object-fit:cover;border-radius:6px}.ul-preview-info{flex:1;overflow:hidden}.ul-preview-info span:first-child{display:block;font-size:13px;color:#166534;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ul-status-badge{display:inline-block;font-size:11px;padding:2px 8px;border-radius:10px;margin-top:4px}.ul-status-badge.processing{background:#fef3c7;color:#92400e}.ul-status-badge.ready{background:#d1fae5;color:#065f46}.ul-quick-preview>button{width:24px;height:24px;border:none;background:#dc2626;color:white;border-radius:50%;cursor:pointer;font-size:14px;flex-shrink:0}.ul-dpi-warning{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#fef3c7;border-radius:8px;margin-top:12px;color:#92400e;font-size:12px}.ul-variants-section{margin-top:16px}.ul-variant-group{margin-bottom:12px}.ul-variant-group label{display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:6px}.ul-variant-select{width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;background:white;cursor:pointer}.ul-variant-select:focus{outline:none;border-color:#667eea;box-shadow:0 0 0 3px rgba(102,126,234,0.1)}.ul-quantity-section{margin-top:16px}.ul-quantity-section label{display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:6px}.ul-quantity-wrapper{display:flex;align-items:center;gap:0;width:fit-content;border:1px solid #d1d5db;border-radius:8px;overflow:hidden}.ul-quantity-wrapper button{width:40px;height:40px;border:none;background:#f3f4f6;font-size:18px;cursor:pointer;color:#374151}.ul-quantity-wrapper button:hover{background:#e5e7eb}.ul-quantity-wrapper input{width:50px;height:40px;border:none;text-align:center;font-size:15px;font-weight:600;-moz-appearance:textfield}.ul-quantity-wrapper input::-webkit-outer-spin-button,.ul-quantity-wrapper input::-webkit-inner-spin-button{-webkit-appearance:none}.ul-quick-modal-footer{padding:16px 20px;border-top:1px solid #e5e7eb}.ul-quick-btn-primary{display:flex;align-items:center;justify-content:center;width:100%;padding:14px 20px;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white!important;text-align:center;text-decoration:none!important;border:none;border-radius:8px;font-weight:600;font-size:14px;cursor:pointer;font-family:inherit}.ul-quick-btn-primary:disabled{opacity:0.5;cursor:not-allowed}.ul-btn-secondary{display:block;width:100%;padding:14px 20px;background:#f3f4f6;color:#374151;text-align:center;text-decoration:none;border:none;border-radius:8px;font-weight:600;font-size:14px;cursor:pointer;margin-bottom:10px;font-family:inherit}.ul-btn-secondary:hover{background:#e5e7eb}.ul-upload-hint{text-align:center;font-size:12px;color:#9ca3af;margin:10px 0 0 0}.ul-success-content{padding:40px 20px;text-align:center}.ul-success-icon{width:60px;height:60px;background:#10b981;color:white;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 16px}.ul-success-content h3{margin:0 0 8px 0;font-size:20px;color:#1f2937}.ul-success-content p{margin:0;color:#6b7280;font-size:14px}.ul-success-buttons{display:flex;flex-direction:column;gap:10px}.ul-success-buttons .ul-btn-secondary{margin:0}</style>
<script>(function(){if(window.ULQuickUploadInit)return;window.ULQuickUploadInit=true;function hideAllModals(){document.querySelectorAll('.ul-quick-modal').forEach(function(m){m.style.display='none'});document.body.style.overflow=''}document.addEventListener('shopify:section:select',hideAllModals);document.addEventListener('shopify:section:deselect',hideAllModals);document.addEventListener('shopify:section:load',hideAllModals);document.addEventListener('shopify:block:select',hideAllModals);document.addEventListener('shopify:block:deselect',hideAllModals);let c=document.getElementById('ul-modal-container');if(!c){c=document.createElement('div');c.id='ul-modal-container';document.body.appendChild(c)}function init(){document.querySelectorAll('template[id$="-tpl"]').forEach(t=>{if(t.dataset.initialized)return;t.dataset.initialized='true';c.appendChild(t.content.cloneNode(true))})}if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',init)}else{init()}new MutationObserver(()=>setTimeout(init,100)).observe(document.body,{childList:true,subtree:true});document.addEventListener('click',function(e){const t=e.target;const ob=t.closest('.ul-quick-btn-trigger');if(ob){e.preventDefault();e.stopPropagation();openModal(ob.dataset.modal);return}const cb=t.closest('[data-close]');if(cb){e.preventDefault();e.stopPropagation();closeModal(cb.dataset.close);return}const ab=t.closest('[data-add-cart]');if(ab&&!ab.disabled){e.preventDefault();e.stopPropagation();addToCart(ab.dataset.addCart,ab.dataset.modal);return}const dz=t.closest('.ul-quick-dropzone');if(dz){const fi=dz.querySelector('input[type="file"]');if(fi)fi.click();return}const clr=t.closest('[data-clear]');if(clr){clearUpload(clr.dataset.clear);return}const qb=t.closest('[data-qty]');if(qb){changeQty(qb.dataset.qty,parseInt(qb.dataset.delta)||0);return}});document.addEventListener('change',function(e){if(e.target.matches('.ul-quick-dropzone input[type="file"]')){const i=e.target;const dz=i.closest('.ul-quick-dropzone');const uid=dz.id.replace('ul-dropzone-','');const m=i.closest('.ul-quick-modal');handleUpload(i,uid,m)}if(e.target.matches('.ul-variant-select')){const id=e.target.id;const m=id.match(/ul-option-(.+)-\\d+$/);if(m)updateVariant(m[1])}});function openModal(id){if(window.Shopify&&window.Shopify.designMode){console.log('[UL] Design mode - modal disabled');return}const m=document.getElementById(id);if(!m)return;m.style.display='flex';document.body.style.overflow='hidden';const s1=document.getElementById(id+'-step1');const s2=document.getElementById(id+'-step2');if(s1)s1.style.display='block';if(s2)s2.style.display='none'}function closeModal(id){const m=document.getElementById(id);if(m){m.style.display='none';document.body.style.overflow=''}}async function handleUpload(input,uid,modal){const file=input.files[0];if(!file)return;const api=modal.dataset.apiBase;const shop=modal.dataset.shop;const pid=modal.dataset.productId;const dz=document.getElementById('ul-dropzone-'+uid);const pg=document.getElementById('ul-progress-'+uid);const pf=document.getElementById('ul-progress-fill-'+uid);const pt=document.getElementById('ul-progress-text-'+uid);const pv=document.getElementById('ul-preview-'+uid);const pi=document.getElementById('ul-preview-img-'+uid);const pn=document.getElementById('ul-preview-name-'+uid);const ps=document.getElementById('ul-preview-status-'+uid);const ab=document.getElementById('ul-addcart-'+uid);const ht=document.getElementById('ul-hint-'+uid);const ui=document.getElementById('ul-upload-id-'+uid);const dw=document.getElementById('ul-dpi-warning-'+uid);const dt=document.getElementById('ul-dpi-text-'+uid);if(!dz||!pg)return;dz.style.display='none';pg.style.display='block';pf.style.width='10%';pt.textContent='Getting upload URL...';try{const ir=await fetch(api+'/api/upload/intent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({shopDomain:shop,productId:pid,mode:'quick',contentType:file.type,fileName:file.name,fileSize:file.size})});if(!ir.ok)throw new Error('Failed');const id=await ir.json();pf.style.width='30%';pt.textContent='Uploading...';let ur;const st=id.storageProvider||(id.isLocal?'local':'signed_url');if(st==='local'){const fd=new FormData();fd.append('file',file);fd.append('key',id.key);fd.append('uploadId',id.uploadId);fd.append('itemId',id.itemId);ur=await fetch(id.uploadUrl,{method:'POST',body:fd})}else{ur=await fetch(id.uploadUrl,{method:'PUT',headers:{'Content-Type':file.type},body:file})}if(!ur.ok)throw new Error('Upload failed');pf.style.width='60%';pt.textContent='Processing...';await fetch(api+'/api/upload/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uploadId:id.uploadId,shopDomain:shop,items:[{itemId:id.itemId,location:'front',storageProvider:id.storageProvider||'local'}]})});pf.style.width='80%';pt.textContent='Analyzing...';if(ui)ui.value=id.uploadId;let st='processing',att=0;while(st==='processing'&&att<10){await new Promise(r=>setTimeout(r,1000));try{const sr=await fetch(api+'/api/upload/status/'+id.uploadId+'?shopDomain='+shop);if(sr.ok){const sd=await sr.json();st=sd.status;if(sd.preflight?.dpi&&sd.preflight.dpi<150&&dw&&dt){dw.style.display='flex';dt.textContent='Low DPI: '+sd.preflight.dpi}}}catch(e){}att++}pg.style.display='none';pv.style.display='flex';if(pn)pn.textContent=file.name;if(file.type.startsWith('image/')&&pi){const r=new FileReader();r.onload=(e)=>{pi.src=e.target.result};r.readAsDataURL(file)}if(ps){ps.textContent=st==='ready'||st==='completed'?'Ready':'Processing';ps.className='ul-status-badge '+(st==='ready'||st==='completed'?'ready':'processing')}if(ab)ab.disabled=false;if(ht)ht.style.display='none'}catch(e){console.error(e);pg.style.display='none';dz.style.display='block';alert('Upload failed')}}function clearUpload(uid){const dz=document.getElementById('ul-dropzone-'+uid);const pv=document.getElementById('ul-preview-'+uid);const fi=document.getElementById('ul-file-'+uid);const ab=document.getElementById('ul-addcart-'+uid);const ht=document.getElementById('ul-hint-'+uid);const ui=document.getElementById('ul-upload-id-'+uid);const dw=document.getElementById('ul-dpi-warning-'+uid);if(fi)fi.value='';if(dz)dz.style.display='block';if(pv)pv.style.display='none';if(dw)dw.style.display='none';if(ab)ab.disabled=true;if(ht)ht.style.display='block';if(ui)ui.value=''}function changeQty(uid,d){const i=document.getElementById('ul-qty-'+uid);if(!i)return;let v=parseInt(i.value)||1;v=Math.max(1,Math.min(99,v+d));i.value=v}function updateVariant(uid){const ve=document.getElementById('ul-variants-'+uid);if(!ve)return;try{const vd=JSON.parse(ve.textContent);const opts=[];let i=0;while(document.getElementById('ul-option-'+uid+'-'+i)){opts.push(document.getElementById('ul-option-'+uid+'-'+i).value);i++}const v=vd.find(x=>opts.every((o,i)=>x['option'+(i+1)]===o));if(v){const vi=document.getElementById('ul-variant-'+uid);if(vi)vi.value=v.id}}catch(e){}}async function addToCart(uid,mid){const ab=document.getElementById('ul-addcart-'+uid);if(!ab)return;const bt=ab.querySelector('.ul-btn-text');const bl=ab.querySelector('.ul-btn-loading');const vi=document.getElementById('ul-variant-'+uid);const qi=document.getElementById('ul-qty-'+uid);const ui=document.getElementById('ul-upload-id-'+uid);const pn=document.getElementById('ul-preview-name-'+uid);const vid=vi?.value;const qty=parseInt(qi?.value)||1;const upid=ui?.value;const name=pn?.textContent||'';if(!upid){alert('Please upload first');return}const mm=document.getElementById(mid);const mapi=(mm&&mm.dataset.apiBase)||'/apps/customizer';const mshop=(mm&&mm.dataset.shop)||'';const idl=(/^https?:/i.test(mapi)?mapi:(mshop?'https://'+mshop+mapi:mapi))+'/i/'+upid;ab.disabled=true;if(bt)bt.style.display='none';if(bl)bl.style.display='inline';try{const r=await fetch('/cart/add.js',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:vid,quantity:qty,properties:{'Uploaded File':idl,'_ul_upload_id':upid,'_ul_design_file':name,'_ul_uploaded':'true','_ul_identity':idl}})});if(!r.ok)throw new Error('Failed');const s1=document.getElementById(mid+'-step1');const s2=document.getElementById(mid+'-step2');if(s1)s1.style.display='none';if(s2)s2.style.display='block';fetch('/cart.js').then(r=>r.json()).then(c=>{document.querySelectorAll('.cart-count,.cart-count-bubble span,[data-cart-count]').forEach(e=>{e.textContent=c.item_count})}).catch(()=>{})}catch(e){alert('Error adding to cart')}finally{ab.disabled=false;if(bt)bt.style.display='inline';if(bl)bl.style.display='none'}}window.openUploadModal=openModal;window.closeUploadModal=closeModal})();</script>`}
                      </pre>
                    </Box>
                  </BlockStack>
                </Box>

                <Divider />

                <Box paddingBlockStart="200">
                  <Text as="h3" variant="headingSm">Step 3: Use in Your Theme</Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Find your product card template (usually <code>snippets/card-product.liquid</code>) and replace the Add to Cart button with:
                  </Text>
                </Box>

                <Box
                  background="bg-surface-secondary"
                  padding="400"
                  borderRadius="200"
                >
                  <pre style={{ fontSize: '12px', lineHeight: '1.5', margin: 0 }}>
{`{% render 'dtf-quick-upload-btn', product: product %}`}
                  </pre>
                </Box>

                <Box paddingBlockStart="200">
                  <Text as="h3" variant="headingSm">Customization</Text>
                </Box>

                <Box
                  background="bg-surface-secondary"
                  padding="400"
                  borderRadius="200"
                >
                  <pre style={{ fontSize: '12px', lineHeight: '1.5', margin: 0 }}>
{`{% render 'dtf-quick-upload-btn',
  product: product,
  button_text: 'Customize Now'
%}`}
                  </pre>
                </Box>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
  );
}

