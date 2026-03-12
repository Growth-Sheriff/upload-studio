import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Page, Layout, Card, Text, BlockStack, Link, List } from "@shopify/polaris";
import { authenticate } from "~/shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  return json({});
}

export default function PrivacyPolicyPage() {
  const lastUpdated = new Date().toLocaleDateString("en-US", { 
    year: "numeric", 
    month: "long", 
    day: "numeric" 
  });

  return (
    <Page 
      title="Privacy Policy" 
      backAction={{ content: "Dashboard", url: "/app" }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="p" tone="subdued">Last updated: {lastUpdated}</Text>

              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">1. Introduction</Text>
                <Text as="p">
                  Upload Studio ("we," "our," or "us") is committed to protecting your privacy. 
                  This Privacy Policy explains how we collect, use, disclose, and safeguard your information when 
                  you use our Shopify application.
                </Text>
              </BlockStack>

              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">2. Information We Collect</Text>
                <Text as="p">We collect information that you provide directly to us:</Text>
                <List type="bullet">
                  <List.Item>Store information (shop domain, email, name)</List.Item>
                  <List.Item>Product configuration data</List.Item>
                  <List.Item>Uploaded design files and images</List.Item>
                  <List.Item>Order customization data</List.Item>
                  <List.Item>Usage analytics (page views, feature usage)</List.Item>
                </List>
              </BlockStack>

              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">3. How We Use Your Information</Text>
                <Text as="p">We use the collected information to:</Text>
                <List type="bullet">
                  <List.Item>Provide and maintain our application services</List.Item>
                  <List.Item>Process and store product customizations</List.Item>
                  <List.Item>Generate print-ready files for your orders</List.Item>
                  <List.Item>Improve our application features and user experience</List.Item>
                  <List.Item>Send important notifications about your account</List.Item>
                  <List.Item>Provide customer support</List.Item>
                </List>
              </BlockStack>

              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">4. Data Storage and Security</Text>
                <Text as="p">Your data is stored securely using industry-standard practices:</Text>
                <List type="bullet">
                  <List.Item>All data is encrypted in transit (TLS 1.3)</List.Item>
                  <List.Item>Files are stored in Cloudflare R2 with encryption at rest</List.Item>
                  <List.Item>Database is PostgreSQL with row-level security</List.Item>
                  <List.Item>Regular security audits and updates</List.Item>
                </List>
              </BlockStack>

              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">5. Data Sharing</Text>
                <Text as="p">We do not sell, trade, or rent your personal information. We may share data with:</Text>
                <List type="bullet">
                  <List.Item>Shopify (as required for app functionality)</List.Item>
                  <List.Item>Cloud storage providers (Cloudflare R2)</List.Item>
                  <List.Item>Analytics services (anonymized data only)</List.Item>
                </List>
              </BlockStack>

              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">6. Data Retention</Text>
                <Text as="p">We retain your data for as long as your account is active:</Text>
                <List type="bullet">
                  <List.Item>Upload files: 90 days after order completion</List.Item>
                  <List.Item>Configuration data: Until app uninstallation</List.Item>
                  <List.Item>Analytics data: 12 months (anonymized)</List.Item>
                </List>
              </BlockStack>

              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">7. Your Rights</Text>
                <Text as="p">You have the right to:</Text>
                <List type="bullet">
                  <List.Item>Access your personal data</List.Item>
                  <List.Item>Request data correction or deletion</List.Item>
                  <List.Item>Export your data in a portable format</List.Item>
                  <List.Item>Withdraw consent at any time</List.Item>
                </List>
              </BlockStack>

              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">8. Contact Us</Text>
                <Text as="p">
                  If you have questions about this Privacy Policy, please contact us at{" "}
                  <Link url={`mailto:privacy@${process.env.APP_DOMAIN || 'uploadstudio.app.techifyboost.com'}`}>privacy@{process.env.APP_DOMAIN || 'uploadstudio.app.techifyboost.com'}</Link>
                </Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
