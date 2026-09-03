import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useFetcher } from "@remix-run/react";
import {
  Page, Card, Text, BlockStack, Banner,
  DataTable, Badge, Button, InlineStack, Box,
  Grid, ProgressBar, Divider, Icon, Select, InlineGrid,
} from "@shopify/polaris";
import {
  OrderIcon,
  CheckCircleIcon,
  ProductIcon,
  ClockIcon,
  CartIcon,
} from "@shopify/polaris-icons";
import { useState, useCallback } from "react";
import { authenticate } from "~/shopify.server";
import prisma from "~/lib/prisma.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  let shop = await prisma.shop.findUnique({
    where: { shopDomain },
    include: {
      productsConfig: { where: { enabled: true }, take: 1 },
    },
  });


  if (!shop) {
    shop = await prisma.shop.create({
      data: {
        shopDomain,
        accessToken: session.accessToken || "",
        plan: "commission",
        billingStatus: "active",
        storageProvider: "r2",
        onboardingCompleted: false,
        onboardingStep: 0,
        settings: {},
      },
      include: {
        productsConfig: { where: { enabled: true }, take: 1 },
      },
    });
  }


  const uploads = await prisma.upload.findMany({
    where: { shopId: shop.id },
    include: {
      items: {
        select: { id: true, location: true, preflightStatus: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });


  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  // Ghost records (preflightSummary.errorType = missing_upload) are
  // operational warnings — a bypassed upload or, historically, another
  // app's order lines. They are excluded from every primary stat so the
  // panel only reads orders that actually flowed through this app.
  const notGhost = {
    NOT: { preflightSummary: { path: ["errorType"], equals: "missing_upload" } },
  } as const;

  const [totalUploads, monthlyUploads, productsConfigured, pendingQueue, missingFileCount, realOrderIds, monthlyRealOrderIds] = await Promise.all([
    prisma.upload.count({ where: { shopId: shop.id, ...notGhost } }),
    prisma.upload.count({ where: { shopId: shop.id, createdAt: { gte: startOfMonth }, ...notGhost } }),
    prisma.productConfig.count({ where: { shopId: shop.id, enabled: true } }),
    prisma.upload.count({ where: { shopId: shop.id, status: "needs_review", ...notGhost } }),
    prisma.upload.count({
      where: {
        shopId: shop.id,
        preflightSummary: { path: ["errorType"], equals: "missing_upload" },
      },
    }),

    prisma.upload.findMany({
      where: { shopId: shop.id, orderId: { not: null }, ...notGhost },
      select: { orderId: true },
      distinct: ["orderId"],
    }).then(rows => rows.length),
    prisma.upload.findMany({
      where: { shopId: shop.id, orderId: { not: null }, createdAt: { gte: startOfMonth }, ...notGhost },
      select: { orderId: true },
      distinct: ["orderId"],
    }).then(rows => rows.length),
  ]);
  const totalOrders = realOrderIds;
  const monthlyOrders = monthlyRealOrderIds;


  const monthlyLimit = -1;


  const usageAlerts: Array<{ type: string; message: string; action?: { label: string; url: string } }> = [];

  return json({
    shop: {
      id: shop.id,
      domain: shop.shopDomain,
      plan: shop.plan,
      storageProvider: shop.storageProvider,
      onboardingCompleted: shop.onboardingCompleted,
      onboardingStep: shop.onboardingStep || 0,
      onboardingData: shop.onboardingData as Record<string, unknown> | null,
      hasConfiguredProduct: shop.productsConfig.length > 0,
    },
    stats: {
      totalUploads,
      monthlyUploads,
      monthlyLimit,
      productsConfigured,
      pendingQueue,
      missingFileCount,
      totalOrders,
      monthlyOrders,
      conversionRate: monthlyUploads > 0 ? Math.round((monthlyOrders / monthlyUploads) * 100) : 0,
    },
    usageAlerts,
    uploads: uploads.map((u: any) => ({
      id: u.id,
      mode: u.mode,
      status: u.status,
      orderId: u.orderId,
      orderPaidAt: u.orderPaidAt ? new Date(u.orderPaidAt).toISOString() : null,
      cartAddedAt: u.cartAddedAt ? new Date(u.cartAddedAt).toISOString() : null,
      productId: u.productId,
      itemCount: u.items.length,
      preflightStatus: u.items.some((i: any) => i.preflightStatus === "error")
        ? "error"
        : u.items.some((i: any) => i.preflightStatus === "warning")
          ? "warning"
          : u.items.every((i: any) => i.preflightStatus === "ok")
            ? "ok"
            : "pending",
      createdAt: u.createdAt.toISOString(),
    })),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  const shop = await prisma.shop.findUnique({ where: { shopDomain } });
  if (!shop) return json({ error: "Shop not found" }, { status: 404 });

  if (intent === "complete-step") {
    const stepId = parseInt(formData.get("stepId") as string, 10);
    const businessType = formData.get("businessType") as string;
    const printMethod = formData.get("printMethod") as string;
    const storageProvider = formData.get("storageProvider") as string;

    const onboardingData = (shop.onboardingData as Record<string, unknown>) || {};
    if (businessType) onboardingData.businessType = businessType;
    if (printMethod) onboardingData.printMethod = printMethod;

    const newStep = Math.max(shop.onboardingStep || 0, stepId);
    const isComplete = newStep >= 4;

    await prisma.shop.update({
      where: { id: shop.id },
      data: {
        onboardingStep: newStep,
        onboardingCompleted: isComplete,
        onboardingData,
        storageProvider: storageProvider || shop.storageProvider,
      },
    });

    return json({ success: true, step: newStep, completed: isComplete });
  }

  if (intent === "skip-onboarding") {
    await prisma.shop.update({
      where: { id: shop.id },
      data: { onboardingCompleted: true, onboardingStep: 4 },
    });
    return json({ success: true, completed: true });
  }

  return json({ error: "Invalid intent" }, { status: 400 });
}


import { StatCard } from "~/components/StatCard";
import {
  describeUploadStatus,
  preflightLabel,
  preflightTone,
  type UploadStatusFacts,
} from "~/lib/uploadStatus";

function StatusBadge({ facts }: { facts: UploadStatusFacts }) {
  const { label, tone } = describeUploadStatus(facts);
  return <Badge tone={tone}>{label}</Badge>;
}

function PreflightBadge({ status }: { status: string }) {
  return <Badge tone={preflightTone(status)}>{preflightLabel(status)}</Badge>;
}


function OnboardingChecklist({
  shop,
  onComplete,
  onSkip
}: {
  shop: any;
  onComplete: (stepId: number, data?: any) => void;
  onSkip: () => void;
}) {
  const navigate = useNavigate();
  const [businessType, setBusinessType] = useState(
    (shop.onboardingData?.businessType as string) || "print_shop"
  );
  const [printMethod, setPrintMethod] = useState(
    (shop.onboardingData?.printMethod as string) || "dtf"
  );
  const [storageProvider, setStorageProvider] = useState(shop.storageProvider);

  const currentStep = shop.onboardingStep || 0;
  const progress = (currentStep / 4) * 100;

  const isStepComplete = (stepId: number) => currentStep >= stepId;

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between">
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd">Getting Started</Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Complete these steps to set up your store
            </Text>
          </BlockStack>
          <Button variant="plain" onClick={onSkip}>Skip setup</Button>
        </InlineStack>

        <ProgressBar progress={progress} size="small" tone="primary" />

        <Divider />


        <Box padding="200" background={isStepComplete(1) ? "bg-surface-success" : undefined} borderRadius="200">
          <InlineStack align="space-between" blockAlign="start">
            <InlineStack gap="300" blockAlign="start">
              <Box
                background={isStepComplete(1) ? "bg-fill-success" : "bg-fill-secondary"}
                padding="100"
                borderRadius="full"
                minWidth="24px"
              >
                {isStepComplete(1) ? (
                  <Icon source={CheckCircleIcon} tone="success" />
                ) : (
                  <Text as="span" variant="bodySm" fontWeight="bold" alignment="center">1</Text>
                )}
              </Box>
              <BlockStack gap="100">
                <Text as="h3" variant="headingSm">Business Type</Text>
                {!isStepComplete(1) ? (
                  <BlockStack gap="200">
                    <Select
                      label=""
                      options={[
                        { label: "Print Shop / DTF Business", value: "print_shop" },
                        { label: "Apparel Brand", value: "apparel" },
                        { label: "Print on Demand", value: "pod" },
                        { label: "Custom Merchandise", value: "merch" },
                      ]}
                      value={businessType}
                      onChange={setBusinessType}
                    />
                    <Select
                      label=""
                      options={[
                        { label: "DTF (Direct to Film)", value: "dtf" },
                        { label: "Sublimation", value: "sublimation" },
                        { label: "Screen Printing", value: "screen" },
                        { label: "DTG", value: "dtg" },
                      ]}
                      value={printMethod}
                      onChange={setPrintMethod}
                    />
                  </BlockStack>
                ) : (
                  <Text as="p" variant="bodySm" tone="subdued">
                    {businessType === "print_shop" ? "Print Shop" : businessType} • {printMethod.toUpperCase()}
                  </Text>
                )}
              </BlockStack>
            </InlineStack>
            {!isStepComplete(1) && (
              <Button
                size="slim"
                onClick={() => onComplete(1, { businessType, printMethod })}
              >
                Save
              </Button>
            )}
          </InlineStack>
        </Box>


        <Box padding="200" background={isStepComplete(2) ? "bg-surface-success" : undefined} borderRadius="200">
          <InlineStack align="space-between" blockAlign="start">
            <InlineStack gap="300" blockAlign="start">
              <Box
                background={isStepComplete(2) ? "bg-fill-success" : "bg-fill-secondary"}
                padding="100"
                borderRadius="full"
                minWidth="24px"
              >
                {isStepComplete(2) ? (
                  <Icon source={CheckCircleIcon} tone="success" />
                ) : (
                  <Text as="span" variant="bodySm" fontWeight="bold" alignment="center">2</Text>
                )}
              </Box>
              <BlockStack gap="100">
                <Text as="h3" variant="headingSm">File Storage</Text>
                {!isStepComplete(2) && isStepComplete(1) ? (
                  <Select
                    label=""
                    options={[
                      { label: "Cloudflare R2 (Recommended)", value: "r2" },
                      { label: "Shopify Files", value: "shopify" },
                    ]}
                    value={storageProvider}
                    onChange={setStorageProvider}
                  />
                ) : isStepComplete(2) ? (
                  <Text as="p" variant="bodySm" tone="subdued">
                    {storageProvider === "r2" ? "Cloudflare R2" : "Shopify Files"}
                  </Text>
                ) : (
                  <Text as="p" variant="bodySm" tone="subdued">Complete step 1 first</Text>
                )}
              </BlockStack>
            </InlineStack>
            {!isStepComplete(2) && isStepComplete(1) && (
              <Button
                size="slim"
                onClick={() => onComplete(2, { storageProvider })}
              >
                Save
              </Button>
            )}
          </InlineStack>
        </Box>


        <Box padding="200" background={isStepComplete(3) ? "bg-surface-success" : undefined} borderRadius="200">
          <InlineStack align="space-between" blockAlign="start">
            <InlineStack gap="300" blockAlign="start">
              <Box
                background={isStepComplete(3) ? "bg-fill-success" : "bg-fill-secondary"}
                padding="100"
                borderRadius="full"
                minWidth="24px"
              >
                {isStepComplete(3) ? (
                  <Icon source={CheckCircleIcon} tone="success" />
                ) : (
                  <Text as="span" variant="bodySm" fontWeight="bold" alignment="center">3</Text>
                )}
              </Box>
              <BlockStack gap="100">
                <Text as="h3" variant="headingSm">Enable a Product</Text>
                {isStepComplete(3) || shop.hasConfiguredProduct ? (
                  <Text as="p" variant="bodySm" tone="subdued">Product configured</Text>
                ) : isStepComplete(2) ? (
                  <Text as="p" variant="bodySm" tone="subdued">Enable customization on a product</Text>
                ) : (
                  <Text as="p" variant="bodySm" tone="subdued">Complete step 2 first</Text>
                )}
              </BlockStack>
            </InlineStack>
            {!isStepComplete(3) && isStepComplete(2) && !shop.hasConfiguredProduct && (
              <Button size="slim" onClick={() => navigate("/app/products")}>
                Go to Products
              </Button>
            )}
            {shop.hasConfiguredProduct && !isStepComplete(3) && (
              <Button size="slim" onClick={() => onComplete(3)}>
                Mark Complete
              </Button>
            )}
          </InlineStack>
        </Box>


        <Box padding="200" background={isStepComplete(4) ? "bg-surface-success" : undefined} borderRadius="200">
          <InlineStack align="space-between" blockAlign="start">
            <InlineStack gap="300" blockAlign="start">
              <Box
                background={isStepComplete(4) ? "bg-fill-success" : "bg-fill-secondary"}
                padding="100"
                borderRadius="full"
                minWidth="24px"
              >
                {isStepComplete(4) ? (
                  <Icon source={CheckCircleIcon} tone="success" />
                ) : (
                  <Text as="span" variant="bodySm" fontWeight="bold" alignment="center">4</Text>
                )}
              </Box>
              <BlockStack gap="100">
                <Text as="h3" variant="headingSm">Add to Theme</Text>
                {isStepComplete(4) ? (
                  <Text as="p" variant="bodySm" tone="subdued">Theme configured</Text>
                ) : isStepComplete(3) ? (
                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm" tone="subdued">
                      Add the DTF Transfer block to your product page template
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Online Store → Themes → Customize → Product page → Add block → Apps
                    </Text>
                  </BlockStack>
                ) : (
                  <Text as="p" variant="bodySm" tone="subdued">Complete step 3 first</Text>
                )}
              </BlockStack>
            </InlineStack>
            {!isStepComplete(4) && isStepComplete(3) && (
              <Button size="slim" onClick={() => onComplete(4)}>
                Mark Complete
              </Button>
            )}
          </InlineStack>
        </Box>

        {isStepComplete(4) && (
          <Banner tone="success">
            <Text as="p" fontWeight="bold">Setup complete! You're ready to accept custom uploads.</Text>
          </Banner>
        )}
      </BlockStack>
    </Card>
  );
}

export default function AppDashboard() {
  const { shop, stats, uploads, usageAlerts } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher();

  const [onboardingComplete, setOnboardingComplete] = useState(shop.onboardingCompleted);

  const handleCompleteStep = useCallback((stepId: number, data?: any) => {
    const formData = new FormData();
    formData.append("intent", "complete-step");
    formData.append("stepId", stepId.toString());
    if (data?.businessType) formData.append("businessType", data.businessType);
    if (data?.printMethod) formData.append("printMethod", data.printMethod);
    if (data?.storageProvider) formData.append("storageProvider", data.storageProvider);
    fetcher.submit(formData, { method: "post" });

    if (stepId >= 4) setOnboardingComplete(true);
  }, [fetcher]);

  const handleSkipOnboarding = useCallback(() => {
    fetcher.submit({ intent: "skip-onboarding" }, { method: "post" });
    setOnboardingComplete(true);
  }, [fetcher]);

  const rows = uploads.slice(0, 5).map((upload: any) => [
    upload.id.slice(0, 8) + "...",
    <Badge key={upload.id + "-mode"} tone="info">{upload.mode === "3d_designer" ? "3D" : upload.mode}</Badge>,
    <StatusBadge key={upload.id + "-status"} facts={upload} />,
    <PreflightBadge key={upload.id + "-preflight"} status={upload.preflightStatus} />,
    new Date(upload.createdAt).toLocaleDateString(),
  ]);

  const successRate = stats.totalUploads > 0
    ? Math.round((stats.totalUploads - stats.pendingQueue) / stats.totalUploads * 100)
    : 100;

  const conversionRate = stats.conversionRate || 0;

  return (
    <Page
      title="Dashboard"
      subtitle={`Welcome to ${process.env.APP_NAME || 'Upload Studio'}`}
      primaryAction={{
        content: "Configure Product",
        onAction: () => navigate("/app/products"),
      }}
    >
      <BlockStack gap="500">

        {usageAlerts && usageAlerts.length > 0 && usageAlerts.map((alert: any, idx: number) => (
          <Banner key={idx} tone={alert.type === "critical" ? "critical" : "warning"}>
            <p>{alert.message}</p>
            {alert.action && <Button url={alert.action.url}>{alert.action.label}</Button>}
          </Banner>
        ))}


        {!onboardingComplete && (
          <OnboardingChecklist
            shop={shop}
            onComplete={handleCompleteStep}
            onSkip={handleSkipOnboarding}
          />
        )}


        <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
          <StatCard title="Uploads this month" value={stats.monthlyUploads} icon={OrderIcon} />
          <StatCard
            title="Orders this month"
            value={stats.monthlyOrders}
            icon={CartIcon}
            subtitle={`${conversionRate}% of uploads became orders`}
          />
          <StatCard
            title="Products with upload"
            value={stats.productsConfigured}
            icon={ProductIcon}
            subtitle="Upload block enabled"
          />
          <StatCard
            title="Ordered – check file"
            value={stats.pendingQueue}
            icon={ClockIcon}
            badge={stats.pendingQueue > 0 ? "Action" : undefined}
            badgeTone="attention"
            action={<Button variant="plain" onClick={() => navigate("/app/queue")}>Open production queue</Button>}
          />
        </InlineGrid>


        <Grid>

          <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 8, lg: 8, xl: 8 }}>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">Recent Uploads</Text>
                  <Button variant="plain" onClick={() => navigate("/app/uploads")}>View All</Button>
                </InlineStack>
                <Divider />
                {uploads.length > 0 ? (
                  <DataTable
                    columnContentTypes={["text", "text", "text", "text", "text"]}
                    headings={["ID", "Mode", "Status", "Preflight", "Date"]}
                    rows={rows}
                  />
                ) : (
                  <Box padding="400">
                    <BlockStack gap="200" align="center">
                      <Text as="p" tone="subdued">No uploads yet</Text>
                      <Button onClick={() => navigate("/app/products")}>Configure a Product</Button>
                    </BlockStack>
                  </Box>
                )}
              </BlockStack>
            </Card>
          </Grid.Cell>


          <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
            <BlockStack gap="400">

              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Quick Actions</Text>
                  <Divider />
                  <BlockStack gap="200">
                    <Button fullWidth onClick={() => navigate("/app/products")}>Configure Products</Button>
                  </BlockStack>
                </BlockStack>
              </Card>




              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">What's New</Text>
                  <Divider />
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm"><strong>3D Designer</strong> - Real-time product preview</Text>
                    <Text as="p" variant="bodySm"><strong>Analytics</strong> - Track your upload performance</Text>
                    <Text as="p" variant="bodySm"><strong>API v1</strong> - Integrate with your systems</Text>
                  </BlockStack>
                </BlockStack>
              </Card>
            </BlockStack>
          </Grid.Cell>
        </Grid>
      </BlockStack>
    </Page>
  );
}

