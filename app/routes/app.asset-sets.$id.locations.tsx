import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useActionData, Form, useNavigation } from "@remix-run/react";
import {
  Page, Layout, Card, Text, BlockStack, InlineStack,
  Button, Banner, TextField, RangeSlider, FormLayout, Divider, Box
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "~/shopify.server";
import prisma from "~/lib/prisma.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

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
        storageProvider: "r2",
        settings: {},
      },
    });
  }

  const assetSetId = params.id;
  if (!assetSetId) {
    return redirect("/app/asset-sets");
  }

  const assetSet = await prisma.assetSet.findFirst({
    where: { id: assetSetId, shopId: shop.id },
  });

  if (!assetSet) {
    return redirect("/app/asset-sets");
  }

  const schema = assetSet.schema as Record<string, unknown>;

  return json({
    assetSet: {
      id: assetSet.id,
      name: assetSet.name,
    },
    printLocations: (schema as any).printLocations || [],
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
  });

  if (!shop) {
    return json({ error: "Shop not found" }, { status: 404 });
  }

  const assetSetId = params.id;
  const assetSet = await prisma.assetSet.findFirst({
    where: { id: assetSetId, shopId: shop.id },
  });

  if (!assetSet) {
    return json({ error: "Asset set not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const action = formData.get("_action");
  const currentSchema = assetSet.schema as Record<string, unknown>;

  if (action === "save_locations") {
    const locationsJson = formData.get("locations") as string;

    try {
      const printLocations = JSON.parse(locationsJson);

      await prisma.assetSet.update({
        where: { id: assetSetId, shopId: shop.id },
        data: {
          schema: {
            ...currentSchema,
            printLocations,
          },
        },
      });

      return json({ success: true, message: "Print locations saved" });
    } catch (error) {
      return json({ error: "Invalid location data" });
    }
  }

  if (action === "add_location") {
    const code = formData.get("code") as string;
    const name = formData.get("name") as string;
    const width = parseFloat(formData.get("width") as string) || 8;
    const height = parseFloat(formData.get("height") as string) || 8;
    const posX = parseFloat(formData.get("posX") as string) || 0;
    const posY = parseFloat(formData.get("posY") as string) || 0.15;
    const posZ = parseFloat(formData.get("posZ") as string) || 0.15;

    if (!code || !name) {
      return json({ error: "Code and name are required" });
    }

    const printLocations = [...((currentSchema as any).printLocations || [])];

    // Check for duplicate code
    if (printLocations.some((l: any) => l.code === code)) {
      return json({ error: `Location with code "${code}" already exists` });
    }

    printLocations.push({
      code,
      name,
      position: [posX, posY, posZ],
      rotation: [0, 0, 0],
      designArea: { width, height },
      constraints: { minScale: 0.1, maxScale: 1, allowRotation: true },
    });

    await prisma.assetSet.update({
      where: { id: assetSetId, shopId: shop.id },
      data: {
        schema: {
          ...currentSchema,
          printLocations,
        },
      },
    });

    return json({ success: true, message: "Location added" });
  }

  if (action === "delete_location") {
    const code = formData.get("code") as string;

    const printLocations = ((currentSchema as any).printLocations || []).filter(
      (l: any) => l.code !== code
    );

    await prisma.assetSet.update({
      where: { id: assetSetId, shopId: shop.id },
      data: {
        schema: {
          ...currentSchema,
          printLocations,
        },
      },
    });

    return json({ success: true, message: "Location deleted" });
  }

  return json({ error: "Unknown action" }, { status: 400 });
}

export default function AssetSetLocationsPage() {
  const { assetSet, printLocations } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [locations, setLocations] = useState(printLocations);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newLocation, setNewLocation] = useState({
    code: "",
    name: "",
    width: 8,
    height: 8,
    posX: 0,
    posY: 0.15,
    posZ: 0.15,
  });

  const updateLocation = useCallback((index: number, field: string, value: any) => {
    setLocations((prev: any[]) => {
      const updated = [...prev];
      if (field.includes('.')) {
        const [parent, child] = field.split('.');
        updated[index] = {
          ...updated[index],
          [parent]: {
            ...updated[index][parent],
            [child]: value,
          },
        };
      } else if (field.startsWith('position')) {
        const posIndex = parseInt(field.replace('position', ''));
        updated[index] = {
          ...updated[index],
          position: updated[index].position.map((v: number, i: number) =>
            i === posIndex ? value : v
          ),
        };
      } else {
        updated[index] = { ...updated[index], [field]: value };
      }
      return updated;
    });
  }, []);

  return (
    <Page
      title={`Print Locations: ${assetSet.name}`}
      backAction={{ content: "Asset Sets", url: "/app/asset-sets" }}
      primaryAction={{
        content: "Save All",
        loading: isSubmitting,
        onAction: () => {
          const form = document.getElementById("save-form") as HTMLFormElement;
          form?.submit();
        },
      }}
        secondaryActions={[
          { content: "Add Location", onAction: () => setShowAddForm(true) },
        ]}
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

          {/* Hidden save form */}
          <Form method="post" id="save-form">
            <input type="hidden" name="_action" value="save_locations" />
            <input type="hidden" name="locations" value={JSON.stringify(locations)} />
          </Form>

          {/* Locations */}
          {locations.map((location: any, index: number) => (
            <Layout.Section key={location.code}>
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between">
                    <Text as="h2" variant="headingMd">
                      {location.name} ({location.code})
                    </Text>
                    <Form method="post">
                      <input type="hidden" name="_action" value="delete_location" />
                      <input type="hidden" name="code" value={location.code} />
                      <Button size="slim" tone="critical" submit>
                        Delete
                      </Button>
                    </Form>
                  </InlineStack>

                  <FormLayout>
                    <FormLayout.Group>
                      <TextField
                        label="Name"
                        value={location.name}
                        onChange={(v) => updateLocation(index, "name", v)}
                        autoComplete="off"
                      />
                      <TextField
                        label="Code"
                        value={location.code}
                        disabled
                        autoComplete="off"
                      />
                    </FormLayout.Group>

                    <Divider />
                    <Text as="h3" variant="headingSm">Design Area (inches)</Text>

                    <FormLayout.Group>
                      <TextField
                        label="Width"
                        type="number"
                        value={String(location.designArea?.width || 8)}
                        onChange={(v) => updateLocation(index, "designArea.width", parseFloat(v) || 8)}
                        autoComplete="off"
                      />
                      <TextField
                        label="Height"
                        type="number"
                        value={String(location.designArea?.height || 8)}
                        onChange={(v) => updateLocation(index, "designArea.height", parseFloat(v) || 8)}
                        autoComplete="off"
                      />
                    </FormLayout.Group>

                    <Divider />
                    <Text as="h3" variant="headingSm">3D Position</Text>

                    <FormLayout.Group>
                      <TextField
                        label="X"
                        type="number"
                        step={0.01}
                        value={String(location.position?.[0] || 0)}
                        onChange={(v) => updateLocation(index, "position0", parseFloat(v) || 0)}
                        autoComplete="off"
                      />
                      <TextField
                        label="Y"
                        type="number"
                        step={0.01}
                        value={String(location.position?.[1] || 0)}
                        onChange={(v) => updateLocation(index, "position1", parseFloat(v) || 0)}
                        autoComplete="off"
                      />
                      <TextField
                        label="Z"
                        type="number"
                        step={0.01}
                        value={String(location.position?.[2] || 0)}
                        onChange={(v) => updateLocation(index, "position2", parseFloat(v) || 0)}
                        autoComplete="off"
                      />
                    </FormLayout.Group>

                    <Divider />
                    <Text as="h3" variant="headingSm">Constraints</Text>

                    <FormLayout.Group>
                      <TextField
                        label="Min Scale"
                        type="number"
                        step={0.1}
                        value={String(location.constraints?.minScale || 0.1)}
                        onChange={(v) => updateLocation(index, "constraints.minScale", parseFloat(v) || 0.1)}
                        autoComplete="off"
                      />
                      <TextField
                        label="Max Scale"
                        type="number"
                        step={0.1}
                        value={String(location.constraints?.maxScale || 1)}
                        onChange={(v) => updateLocation(index, "constraints.maxScale", parseFloat(v) || 1)}
                        autoComplete="off"
                      />
                    </FormLayout.Group>
                  </FormLayout>
                </BlockStack>
              </Card>
            </Layout.Section>
          ))}

          {/* Add Location Form */}
          {showAddForm && (
            <Layout.Section>
              <Card>
                <Form method="post">
                  <input type="hidden" name="_action" value="add_location" />
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingMd">Add Print Location</Text>

                    <FormLayout>
                      <FormLayout.Group>
                        <TextField
                          label="Code (unique)"
                          name="code"
                          value={newLocation.code}
                          onChange={(v) => setNewLocation(p => ({ ...p, code: v }))}
                          placeholder="e.g., chest_pocket"
                          autoComplete="off"
                        />
                        <TextField
                          label="Name"
                          name="name"
                          value={newLocation.name}
                          onChange={(v) => setNewLocation(p => ({ ...p, name: v }))}
                          placeholder="e.g., Chest Pocket"
                          autoComplete="off"
                        />
                      </FormLayout.Group>

                      <FormLayout.Group>
                        <TextField
                          label="Width (inches)"
                          name="width"
                          type="number"
                          value={String(newLocation.width)}
                          onChange={(v) => setNewLocation(p => ({ ...p, width: parseFloat(v) || 8 }))}
                          autoComplete="off"
                        />
                        <TextField
                          label="Height (inches)"
                          name="height"
                          type="number"
                          value={String(newLocation.height)}
                          onChange={(v) => setNewLocation(p => ({ ...p, height: parseFloat(v) || 8 }))}
                          autoComplete="off"
                        />
                      </FormLayout.Group>

                      <FormLayout.Group>
                        <TextField
                          label="Position X"
                          name="posX"
                          type="number"
                          step={0.01}
                          value={String(newLocation.posX)}
                          onChange={(v) => setNewLocation(p => ({ ...p, posX: parseFloat(v) || 0 }))}
                          autoComplete="off"
                        />
                        <TextField
                          label="Position Y"
                          name="posY"
                          type="number"
                          step={0.01}
                          value={String(newLocation.posY)}
                          onChange={(v) => setNewLocation(p => ({ ...p, posY: parseFloat(v) || 0 }))}
                          autoComplete="off"
                        />
                        <TextField
                          label="Position Z"
                          name="posZ"
                          type="number"
                          step={0.01}
                          value={String(newLocation.posZ)}
                          onChange={(v) => setNewLocation(p => ({ ...p, posZ: parseFloat(v) || 0 }))}
                          autoComplete="off"
                        />
                      </FormLayout.Group>
                    </FormLayout>

                    <InlineStack gap="200">
                      <Button submit loading={isSubmitting}>Add Location</Button>
                      <Button onClick={() => setShowAddForm(false)}>Cancel</Button>
                    </InlineStack>
                  </BlockStack>
                </Form>
              </Card>
            </Layout.Section>
          )}

          {locations.length === 0 && !showAddForm && (
            <Layout.Section>
              <Card>
                <Box padding="400">
                  <BlockStack gap="200" inlineAlign="center">
                    <Text as="p" tone="subdued">No print locations defined</Text>
                    <Button onClick={() => setShowAddForm(true)}>Add First Location</Button>
                  </BlockStack>
                </Box>
              </Card>
            </Layout.Section>
          )}
        </Layout>
      </Page>
  );
}

