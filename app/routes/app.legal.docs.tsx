import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Page, Layout, Card, Text, BlockStack, Link, List, Button, InlineStack } from "@shopify/polaris";
import { authenticate } from "~/shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  return json({});
}

const sections = [
  {
    title: "Getting Started",
    items: [
      { title: "Installation Guide", description: "How to install and set up the app" },
      { title: "Initial Configuration", description: "Configure your first product" },
      { title: "Theme Integration", description: "Add the customizer to your theme" },
    ]
  },
  {
    title: "Product Configuration",
    items: [
      { title: "Asset Sets", description: "Create and manage asset sets" },
      { title: "Print Locations", description: "Define print areas on products" },
      { title: "Size & Color Options", description: "Configure product variants" },
      { title: "T-Shirt 3D Mode", description: "Enable 3D preview for apparel" },
    ]
  },
  {
    title: "Order Management",
    items: [
      { title: "Processing Orders", description: "Handle customized orders" },
      { title: "Export Files", description: "Generate print-ready files" },
      { title: "Queue Management", description: "Manage the processing queue" },
    ]
  },
  {
    title: "API Reference",
    items: [
      { title: "REST API", description: "API endpoints documentation" },
      { title: "Webhooks", description: "Available webhook events" },
      { title: "Rate Limits", description: "API usage limits" },
    ]
  },
  {
    title: "Analytics",
    items: [
      { title: "Dashboard Overview", description: "Understanding your metrics" },
      { title: "Conversion Tracking", description: "Track customization conversions" },
      { title: "Export Reports", description: "Generate analytics reports" },
    ]
  },
];

export default function DocumentationPage() {
  return (
    <Page 
      title="Documentation" 
      subtitle="Complete guide to using Upload Studio"
      backAction={{ content: "Dashboard", url: "/app" }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Quick Links</Text>
              <InlineStack gap="200">
                <Button url="/app">Open Dashboard</Button>
                <Button url="/app/legal/changelog" variant="secondary">Changelog</Button>
                <Button url="/app/support" variant="secondary">Contact Support</Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {sections.map((section, idx) => (
          <Layout.Section key={idx}>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">{section.title}</Text>
                <List type="bullet">
                  {section.items.map((item, itemIdx) => (
                    <List.Item key={itemIdx}>
                      <Text as="span" fontWeight="bold">{item.title}:</Text> {item.description}
                    </List.Item>
                  ))}
                </List>
              </BlockStack>
            </Card>
          </Layout.Section>
        ))}

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Need Help?</Text>
              <Text as="p">
                Can't find what you're looking for? Contact our support team at{" "}
                <Link url={`mailto:support@${process.env.APP_DOMAIN || 'uploadstudio.app.techifyboost.com'}`}>support@{process.env.APP_DOMAIN || 'uploadstudio.app.techifyboost.com'}</Link>
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
