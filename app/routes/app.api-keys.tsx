import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useActionData, Form, useNavigation } from "@remix-run/react";
import {
  Page, Layout, Card, Text, BlockStack, InlineStack,
  Button, Banner, DataTable, Badge, Modal, TextField, Select,
  EmptyState, Box, Checkbox
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "~/shopify.server";
import prisma from "~/lib/prisma.server";
import { nanoid } from "nanoid";
import crypto from "crypto";

// API Permission options
const API_PERMISSIONS = [
  { value: "uploads:read", label: "Uploads - Read" },
  { value: "uploads:write", label: "Uploads - Write (Approve/Reject)" },
  { value: "exports:read", label: "Exports - Read" },
  { value: "exports:create", label: "Exports - Create" },
  { value: "products:read", label: "Products - Read" },
  { value: "analytics:read", label: "Analytics - Read" },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  let shop = await prisma.shop.findUnique({
    where: { shopDomain },
    include: {
      apiKeys: {
        where: { status: "active" },
        orderBy: { createdAt: "desc" },
      },
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
        apiKeys: {
          where: { status: "active" },
          orderBy: { createdAt: "desc" },
        },
      },
    });
  }

  return json({
    plan: shop.plan,
    apiKeys: shop.apiKeys.map((k) => ({
      id: k.id,
      name: k.name,
      keyPrefix: k.keyPrefix,
      permissions: k.permissions,
      rateLimit: k.rateLimit,
      usageCount: k.usageCount,
      lastUsedAt: k.lastUsedAt?.toISOString() || null,
      createdAt: k.createdAt.toISOString(),
      expiresAt: k.expiresAt?.toISOString() || null,
    })),
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

  // Check pro plan for API access
  if (shop.plan !== "pro" && shop.plan !== "enterprise") {
    return json({ error: "Public API requires Pro plan" }, { status: 403 });
  }

  const formData = await request.formData();
  const action = formData.get("_action");

  if (action === "create") {
    const name = formData.get("name") as string;
    const permissions = formData.getAll("permissions") as string[];
    const rateLimit = parseInt(formData.get("rateLimit") as string) || 100;

    if (!name) {
      return json({ error: "API key name is required" });
    }

    if (permissions.length === 0) {
      return json({ error: "At least one permission is required" });
    }

    // Generate API key
    const rawKey = `ulp_${nanoid(32)}`; // ulp = upload pro
    const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
    const keyPrefix = rawKey.slice(0, 12);

    await prisma.apiKey.create({
      data: {
        shopId: shop.id,
        name,
        keyHash,
        keyPrefix,
        permissions,
        rateLimit,
      },
    });

    await prisma.auditLog.create({
      data: {
        shopId: shop.id,
        action: "api_key_create",
        resourceType: "api_key",
        metadata: { name, permissions },
      },
    });

    // Return the raw key ONCE - won't be shown again
    return json({
      success: true,
      message: "API key created successfully",
      newKey: rawKey,
      warning: "Copy this key now. It won't be shown again!",
    });
  }

  if (action === "revoke") {
    const keyId = formData.get("keyId") as string;

    const apiKey = await prisma.apiKey.findFirst({
      where: { id: keyId, shopId: shop.id },
    });

    if (!apiKey) {
      return json({ error: "API key not found" });
    }

    await prisma.apiKey.update({
      where: { id: keyId, shopId: shop.id },
      data: { status: "revoked" },
    });

    await prisma.auditLog.create({
      data: {
        shopId: shop.id,
        action: "api_key_revoke",
        resourceType: "api_key",
        resourceId: keyId,
        metadata: { name: apiKey.name },
      },
    });

    return json({ success: true, message: "API key revoked" });
  }

  return json({ error: "Unknown action" }, { status: 400 });
}

export default function ApiKeysPage() {
  const { apiKeys, plan } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [rateLimit, setRateLimit] = useState("100");
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);

  const canUseApi = plan === "pro" || plan === "enterprise";

  const handlePermissionChange = useCallback((permission: string, checked: boolean) => {
    setSelectedPermissions(prev =>
      checked ? [...prev, permission] : prev.filter(p => p !== permission)
    );
  }, []);

  const rows = apiKeys.map((key: any) => [
    <BlockStack key={key.id} gap="050">
      <Text as="span" variant="bodySm" fontWeight="semibold">{key.name}</Text>
      <Text as="span" variant="bodySm" tone="subdued">{key.keyPrefix}...</Text>
    </BlockStack>,
    <InlineStack key={`perms-${key.id}`} gap="100" wrap>
      {key.permissions.slice(0, 2).map((p: string) => (
        <Badge key={p} size="small">{p}</Badge>
      ))}
      {key.permissions.length > 2 && (
        <Badge size="small">+{key.permissions.length - 2}</Badge>
      )}
    </InlineStack>,
    `${key.rateLimit}/min`,
    key.usageCount.toLocaleString(),
    key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleDateString() : "Never",
    <Form key={`revoke-${key.id}`} method="post" style={{ display: "inline" }}>
      <input type="hidden" name="_action" value="revoke" />
      <input type="hidden" name="keyId" value={key.id} />
      <Button size="slim" tone="critical" submit loading={isSubmitting}>
        Revoke
      </Button>
    </Form>,
  ]);

  return (
    <Page
      title="API Keys"
      backAction={{ content: "Dashboard", url: "/app" }}
      primaryAction={
        canUseApi
          ? { content: "Create API Key", onAction: () => setCreateModalOpen(true) }
          : undefined
      }
    >
        <Layout>
          {/* New key display */}
          {actionData && "newKey" in actionData && actionData.newKey && (
            <Layout.Section>
              <Banner tone="warning" title="Save Your API Key">
                <BlockStack gap="200">
                  <Text as="p">Copy this key now. It won&apos;t be shown again!</Text>
                  <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                    <code style={{ fontSize: 14, wordBreak: "break-all" }}>
                      {String(actionData.newKey)}
                    </code>
                  </Box>
                  <Button
                    onClick={() => navigator.clipboard.writeText(String(actionData.newKey))}
                  >
                    Copy to Clipboard
                  </Button>
                </BlockStack>
              </Banner>
            </Layout.Section>
          )}

          {/* Action result banner */}
          {actionData && "success" in actionData && !("newKey" in actionData) && (
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
          {!canUseApi && (
            <Layout.Section>
              <Banner tone="warning">
                <p>Public API requires <strong>Pro</strong> plan.</p>
                <Button url="/app/billing">Upgrade Plan</Button>
              </Banner>
            </Layout.Section>
          )}

          {/* API Documentation */}
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">API Documentation</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Use API keys to integrate the Pro API with your systems.
                </Text>

                <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" fontWeight="semibold">Base URL</Text>
                    <code>{`https://${process.env.APP_DOMAIN || 'uploadstudio.app.techifyboost.com'}/api/v1`}</code>

                    <Text as="p" variant="bodySm" fontWeight="semibold">Authentication</Text>
                    <code>Authorization: Bearer ulp_xxxxx...</code>

                    <Text as="p" variant="bodySm" fontWeight="semibold">Available Endpoints</Text>
                    <code>GET /uploads - List uploads</code><br/>
                    <code>GET /uploads/:id - Get upload details</code><br/>
                    <code>POST /uploads/:id/approve - Approve upload</code><br/>
                    <code>POST /uploads/:id/reject - Reject upload</code><br/>
                    <code>POST /exports - Create export job</code><br/>
                    <code>GET /exports/:id - Get export status</code><br/>
                    <code>GET /analytics - Get analytics data</code>
                  </BlockStack>
                </Box>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* API Keys list */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Active API Keys</Text>

                {apiKeys.length > 0 ? (
                  <DataTable
                    columnContentTypes={["text", "text", "text", "numeric", "text", "text"]}
                    headings={["Name", "Permissions", "Rate Limit", "Usage", "Last Used", "Actions"]}
                    rows={rows}
                  />
                ) : (
                  <EmptyState
                    heading="No API keys yet"
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                    action={
                      canUseApi
                        ? { content: "Create API Key", onAction: () => setCreateModalOpen(true) }
                        : undefined
                    }
                  >
                    <p>Create API keys to integrate with external systems.</p>
                  </EmptyState>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Create Key Modal */}
        <Modal
          open={createModalOpen}
          onClose={() => setCreateModalOpen(false)}
          title="Create API Key"
          primaryAction={{
            content: "Create Key",
            loading: isSubmitting,
            onAction: () => {
              const form = document.getElementById("create-form") as HTMLFormElement;
              form?.submit();
            },
          }}
          secondaryActions={[
            { content: "Cancel", onAction: () => setCreateModalOpen(false) },
          ]}
        >
          <Modal.Section>
            <Form method="post" id="create-form">
              <input type="hidden" name="_action" value="create" />

              <BlockStack gap="400">
                <TextField
                  label="Key Name"
                  value={name}
                  onChange={setName}
                  name="name"
                  helpText="A descriptive name for this API key"
                  autoComplete="off"
                  requiredIndicator
                />

                <TextField
                  label="Rate Limit (requests/minute)"
                  type="number"
                  value={rateLimit}
                  onChange={setRateLimit}
                  name="rateLimit"
                  autoComplete="off"
                />

                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">Permissions</Text>
                  {API_PERMISSIONS.map(perm => (
                    <Checkbox
                      key={perm.value}
                      label={perm.label}
                      checked={selectedPermissions.includes(perm.value)}
                      onChange={(checked) => handlePermissionChange(perm.value, checked)}
                      name="permissions"
                      value={perm.value}
                    />
                  ))}
                </BlockStack>
              </BlockStack>
            </Form>
          </Modal.Section>
        </Modal>
      </Page>
  );
}

