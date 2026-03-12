import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Page, Layout, Card, Text, BlockStack, Link, List } from "@shopify/polaris";
import { authenticate } from "~/shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  return json({});
}

export default function TermsOfServicePage() {
  const lastUpdated = new Date().toLocaleDateString("en-US", { 
    year: "numeric", 
    month: "long", 
    day: "numeric" 
  });

  return (
    <Page 
      title="Terms of Service" 
      backAction={{ content: "Dashboard", url: "/app" }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="p" tone="subdued">Last updated: {lastUpdated}</Text>

              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">1. Acceptance of Terms</Text>
                <Text as="p">
                  By installing and using Upload Studio ("the App"), you agree to be bound by these 
                  Terms of Service. If you do not agree to these terms, please do not use the App.
                </Text>
              </BlockStack>

              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">2. Description of Service</Text>
                <Text as="p">Upload Studio is a Shopify application that provides:</Text>
                <List type="bullet">
                  <List.Item>3D product visualization and customization</List.Item>
                  <List.Item>Design upload and placement tools</List.Item>
                  <List.Item>Print-ready file generation (DTF, sublimation, etc.)</List.Item>
                  <List.Item>Order management with customization data</List.Item>
                  <List.Item>White-label branding options</List.Item>
                </List>
              </BlockStack>

              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">3. Account Registration</Text>
                <Text as="p">
                  To use the App, you must have an active Shopify store. By installing the App, you authorize 
                  us to access your Shopify store data as required to provide our services.
                </Text>
              </BlockStack>

              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">4. Subscription and Billing</Text>
                <Text as="p">The App offers multiple subscription tiers:</Text>
                <List type="bullet">
                  <List.Item><Text as="span" fontWeight="bold">Free:</Text> Basic features, limited uploads</List.Item>
                  <List.Item><Text as="span" fontWeight="bold">Starter ($19/mo):</Text> Extended limits, priority support</List.Item>
                  <List.Item><Text as="span" fontWeight="bold">Pro ($49/mo):</Text> Advanced features, API access</List.Item>
                  <List.Item><Text as="span" fontWeight="bold">Enterprise:</Text> Custom pricing - White-label, dedicated support</List.Item>
                </List>
                <Text as="p">
                  Billing is processed through Shopify's billing system. You may cancel at any time through 
                  your Shopify admin panel.
                </Text>
              </BlockStack>

              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">5. User Content</Text>
                <Text as="p">You are responsible for all content uploaded through the App. You represent that:</Text>
                <List type="bullet">
                  <List.Item>You own or have rights to use all uploaded content</List.Item>
                  <List.Item>Content does not infringe on third-party rights</List.Item>
                  <List.Item>Content is not illegal, harmful, or offensive</List.Item>
                </List>
                <Text as="p">We reserve the right to remove content that violates these terms.</Text>
              </BlockStack>

              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">6. Intellectual Property</Text>
                <Text as="p">
                  The App, including its code, design, and documentation, is owned by us and protected by 
                  intellectual property laws. You may not copy, modify, or distribute any part of the App 
                  without our written permission.
                </Text>
              </BlockStack>

              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">7. Limitation of Liability</Text>
                <Text as="p">The App is provided "as is" without warranties of any kind. We are not liable for:</Text>
                <List type="bullet">
                  <List.Item>Data loss or service interruptions</List.Item>
                  <List.Item>Inaccurate output or print quality issues</List.Item>
                  <List.Item>Third-party service failures</List.Item>
                  <List.Item>Indirect or consequential damages</List.Item>
                </List>
              </BlockStack>

              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">8. Termination</Text>
                <Text as="p">
                  We may suspend or terminate your access to the App if you violate these terms. Upon 
                  termination, your data will be handled according to our Privacy Policy and GDPR requirements.
                </Text>
              </BlockStack>

              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">9. Changes to Terms</Text>
                <Text as="p">
                  We may update these terms from time to time. Continued use of the App after changes 
                  constitutes acceptance of the updated terms.
                </Text>
              </BlockStack>

              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">10. Contact</Text>
                <Text as="p">
                  For questions about these terms, contact us at{" "}
                  <Link url={`mailto:legal@${process.env.APP_DOMAIN || 'uploadstudio.app.techifyboost.com'}`}>legal@{process.env.APP_DOMAIN || 'uploadstudio.app.techifyboost.com'}</Link>
                </Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
