import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Page, Layout, Card, Text, BlockStack, Badge, List, Box, InlineStack } from "@shopify/polaris";
import { authenticate } from "~/shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  return json({});
}

interface ChangelogEntry {
  version: string;
  date: string;
  type: "major" | "minor" | "patch";
  changes: {
    category: "feature" | "fix" | "improvement" | "security" | "breaking";
    description: string;
  }[];
}

const changelog: ChangelogEntry[] = [
  {
    version: "1.2.0",
    date: "2025-06-10",
    type: "minor",
    changes: [
      { category: "feature", description: "Corporate legal pages redesign with professional styling" },
      { category: "improvement", description: "Removed decorative elements for cleaner interface" },
      { category: "feature", description: "Comprehensive changelog with full version history" },
    ]
  },
  {
    version: "1.1.0",
    date: "2025-06-09",
    type: "minor",
    changes: [
      { category: "feature", description: "Legal pages module: Privacy Policy, Terms of Service, GDPR compliance" },
      { category: "feature", description: "Documentation hub with quick links and search" },
      { category: "feature", description: "Contact form with subject categorization" },
    ]
  },
  {
    version: "1.0.0",
    date: "2025-06-01",
    type: "major",
    changes: [
      { category: "feature", description: "Production release of 3D T-Shirt Designer" },
      { category: "feature", description: "Multi-location print support: front, back, left sleeve, right sleeve" },
      { category: "feature", description: "Three.js / React Three Fiber 3D rendering engine" },
      { category: "feature", description: "DTF/Sublimation print-ready file export" },
      { category: "security", description: "GDPR-compliant data handling and webhook support" },
    ]
  },
  {
    version: "0.9.0",
    date: "2025-05-20",
    type: "minor",
    changes: [
      { category: "feature", description: "Order webhooks: orders/create, orders/paid, orders/cancelled" },
      { category: "feature", description: "Queue management system for background processing" },
      { category: "improvement", description: "Webhook verification and retry mechanism" },
    ]
  },
  {
    version: "0.8.0",
    date: "2025-05-10",
    type: "minor",
    changes: [
      { category: "feature", description: "Analytics dashboard with real-time metrics" },
      { category: "feature", description: "Export functionality for print queue" },
    ]
  },
  {
    version: "0.7.0",
    date: "2025-04-28",
    type: "minor",
    changes: [
      { category: "feature", description: "Team management with role-based access control (RBAC)" },
      { category: "feature", description: "API key generation for external integrations" },
      { category: "security", description: "Session management improvements" },
    ]
  },
  {
    version: "0.6.0",
    date: "2025-04-15",
    type: "minor",
    changes: [
      { category: "feature", description: "Billing integration with Shopify subscriptions" },
      { category: "feature", description: "Subscription tiers: Free, Starter, Pro, Enterprise" },
    ]
  },
];

function getCategoryBadge(category: string) {
  const toneMap: Record<string, "success" | "info" | "warning" | "critical" | "attention"> = {
    feature: "success",
    improvement: "info",
    fix: "warning",
    security: "attention",
    breaking: "critical",
  };
  return <Badge tone={toneMap[category] || "info"}>{category}</Badge>;
}

function getTypeBadge(type: string) {
  const toneMap: Record<string, "success" | "info" | "attention"> = {
    major: "attention",
    minor: "info",
    patch: "success",
  };
  return <Badge tone={toneMap[type] || "info"}>{type}</Badge>;
}

export default function ChangelogPage() {
  return (
    <Page
      title="Changelog"
      subtitle="Version history and release notes"
      backAction={{ content: "Dashboard", url: "/app" }}
    >
      <Layout>
        {changelog.map((entry, idx) => (
          <Layout.Section key={idx}>
            <Card>
              <BlockStack gap="300">
                <InlineStack gap="200" align="start">
                  <Text as="span" variant="headingMd" fontWeight="bold">v{entry.version}</Text>
                  {getTypeBadge(entry.type)}
                  <Text as="span" tone="subdued">{entry.date}</Text>
                </InlineStack>

                <List type="bullet">
                  {entry.changes.map((change, changeIdx) => (
                    <List.Item key={changeIdx}>
                      <InlineStack gap="100" align="start">
                        {getCategoryBadge(change.category)}
                        <Text as="span">{change.description}</Text>
                      </InlineStack>
                    </List.Item>
                  ))}
                </List>
              </BlockStack>
            </Card>
          </Layout.Section>
        ))}
      </Layout>
    </Page>
  );
}
