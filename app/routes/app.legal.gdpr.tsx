import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Page, Layout, Card, Text, BlockStack, Link, List, Badge, InlineStack, Box } from "@shopify/polaris";
import { authenticate } from "~/shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  return json({});
}

export default function GDPRCompliancePage() {
  const lastUpdated = new Date().toLocaleDateString("en-US", { 
    year: "numeric", 
    month: "long", 
    day: "numeric" 
  });

  const webhooks = [
    {
      name: "customers/data_request",
      desc: "When a customer requests their data, we provide all stored information including uploads, configurations, and order customizations."
    },
    {
      name: "customers/redact",
      desc: "When a customer requests deletion, we remove all their personal data and uploaded files within 30 days."
    },
    {
      name: "shop/redact",
      desc: "When a shop uninstalls our app, we delete all shop data within 48 hours."
    }
  ];

  return (
    <Page 
      title="GDPR Compliance" 
      titleMetadata={<Badge tone="success">Compliant</Badge>}
      backAction={{ content: "Dashboard", url: "/app" }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="p" tone="subdued">Last updated: {lastUpdated}</Text>

              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Overview</Text>
                <Text as="p">
                  Upload Studio is fully compliant with the General Data Protection Regulation (GDPR) 
                  and other applicable data protection laws. We are committed to protecting the privacy and rights 
                  of our users and their customers.
                </Text>
              </BlockStack>

              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Data Controller &amp; Processor</Text>
                <Text as="p">When you use our App:</Text>
                <List type="bullet">
                  <List.Item><Text as="span" fontWeight="bold">You (Merchant)</Text> are the Data Controller for your customers' data</List.Item>
                  <List.Item><Text as="span" fontWeight="bold">We</Text> act as a Data Processor on your behalf</List.Item>
                  <List.Item><Text as="span" fontWeight="bold">Shopify</Text> provides the underlying platform infrastructure</List.Item>
                </List>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Shopify GDPR Webhooks</Text>
              <Text as="p">We implement all required Shopify GDPR webhooks:</Text>
              
              {webhooks.map((wh, idx) => (
                <Box key={idx} padding="300" background="bg-surface-secondary" borderRadius="200">
                  <InlineStack gap="200" align="start">
                    <Badge tone="success">Active</Badge>
                    <BlockStack gap="100">
                      <Text as="span" fontWeight="bold" variant="bodyMd">{wh.name}</Text>
                      <Text as="p" tone="subdued">{wh.desc}</Text>
                    </BlockStack>
                  </InlineStack>
                </Box>
              ))}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Data Subject Rights</Text>
                <Text as="p">We support all GDPR data subject rights:</Text>
                <List type="bullet">
                  <List.Item><Text as="span" fontWeight="bold">Right to Access:</Text> Request a copy of stored data</List.Item>
                  <List.Item><Text as="span" fontWeight="bold">Right to Rectification:</Text> Correct inaccurate data</List.Item>
                  <List.Item><Text as="span" fontWeight="bold">Right to Erasure:</Text> Request data deletion</List.Item>
                  <List.Item><Text as="span" fontWeight="bold">Right to Portability:</Text> Export data in standard format</List.Item>
                  <List.Item><Text as="span" fontWeight="bold">Right to Restrict Processing:</Text> Limit data usage</List.Item>
                  <List.Item><Text as="span" fontWeight="bold">Right to Object:</Text> Opt out of certain processing</List.Item>
                </List>
              </BlockStack>

              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Data Security Measures</Text>
                <List type="bullet">
                  <List.Item>TLS 1.3 encryption for all data in transit</List.Item>
                  <List.Item>AES-256 encryption for data at rest</List.Item>
                  <List.Item>Row-level database security with tenant isolation</List.Item>
                  <List.Item>Regular security audits and penetration testing</List.Item>
                  <List.Item>Access logging and monitoring</List.Item>
                  <List.Item>Employee access controls and training</List.Item>
                </List>
              </BlockStack>

              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">International Data Transfers</Text>
                <Text as="p">Our servers are located in the EU (Germany). For data transfers outside the EU:</Text>
                <List type="bullet">
                  <List.Item>Standard Contractual Clauses (SCCs)</List.Item>
                  <List.Item>Cloudflare's GDPR-compliant infrastructure</List.Item>
                  <List.Item>Shopify's data processing terms</List.Item>
                </List>
              </BlockStack>

              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Contact Our DPO</Text>
                <Text as="p">
                  For GDPR-related inquiries, contact our Data Protection Officer at{" "}
                  <Link url={`mailto:dpo@${process.env.APP_DOMAIN || 'uploadstudio.app.techifyboost.com'}`}>dpo@{process.env.APP_DOMAIN || 'uploadstudio.app.techifyboost.com'}</Link>
                </Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
