import type { LoaderFunctionArgs } from '@remix-run/node'
import { json, redirect } from '@remix-run/node'
import { useLoaderData } from '@remix-run/react'
import { Banner, BlockStack, Box, Card, Layout, Page, Text } from '@shopify/polaris'
import prisma from '~/lib/prisma.server'
import { getDownloadSignedUrl, getStorageConfig } from '~/lib/storage.server'
import { authenticate } from '~/shopify.server'

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request)
  const shopDomain = session.shop

  let shop = await prisma.shop.findUnique({
    where: { shopDomain },
  })

  if (!shop) {
    shop = await prisma.shop.create({
      data: {
        shopDomain,
        accessToken: session.accessToken || '',
        plan: 'starter',
        billingStatus: 'active',
        storageProvider: 'r2',
        settings: {},
      },
    })
  }

  const assetSetId = params.id
  if (!assetSetId) {
    return redirect('/app/asset-sets')
  }

  const assetSet = await prisma.assetSet.findFirst({
    where: { id: assetSetId, shopId: shop.id },
  })

  if (!assetSet) {
    return redirect('/app/asset-sets')
  }

  const schema = assetSet.schema as Record<string, unknown>


  let modelUrl = (schema.model as any)?.source || ''
  if (modelUrl && !modelUrl.startsWith('http') && !modelUrl.startsWith('default_')) {
    try {
      const storageConfig = getStorageConfig({
        storageProvider: shop.storageProvider,
        storageConfig: shop.storageConfig as Record<string, string> | null,
      })
      modelUrl = await getDownloadSignedUrl(storageConfig, modelUrl, 3600)
    } catch (e) {
      console.error('Failed to get model URL:', e)
    }
  }

  return json({
    assetSet: {
      id: assetSet.id,
      name: assetSet.name,
      status: assetSet.status,
      schema: {
        ...schema,
        model: {
          ...(schema.model as any),
          url: modelUrl,
        },
      },
    },
    shopDomain,
  })
}

export default function AssetSetPreviewPage() {
  const { assetSet, shopDomain } = useLoaderData<typeof loader>()
  const schema = assetSet.schema as any

  return (
    <Page
      title={`Preview: ${assetSet.name}`}
      backAction={{ content: 'Asset Sets', url: '/app/asset-sets' }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                3D Preview
              </Text>


              <Box
                id="3d-preview-container"
                background="bg-surface-secondary"
                borderRadius="200"
                padding="400"
                minHeight="500px"
              >
                <div
                  id="upload-lift-3d-preview"
                  data-mode="preview"
                  data-asset-set={JSON.stringify(schema)}
                  data-shop-domain={shopDomain}
                  style={{ width: '100%', height: '500px' }}
                >
                  <Text as="p" tone="subdued" alignment="center">
                    3D Preview loading...
                  </Text>
                </div>
              </Box>

              <Banner tone="info">
                This is a preview of the 3D model with print locations. Test the camera controls and
                verify print location positions.
              </Banner>
            </BlockStack>
          </Card>
        </Layout.Section>


        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Asset Set Details
              </Text>

              <BlockStack gap="100">
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  Model
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {schema.model?.source || 'Default T-Shirt'}
                </Text>
              </BlockStack>

              <BlockStack gap="100">
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  Print Locations
                </Text>
                {(schema.printLocations || []).map((loc: any, idx: number) => (
                  <Text key={idx} as="p" variant="bodySm" tone="subdued">
                    • {loc.name} ({loc.designArea?.width}" x {loc.designArea?.height}")
                  </Text>
                ))}
              </BlockStack>

              <BlockStack gap="100">
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  Camera Presets
                </Text>
                {(schema.cameraPresets || []).map((cam: any, idx: number) => (
                  <Text key={idx} as="p" variant="bodySm" tone="subdued">
                    • {cam.name}
                  </Text>
                ))}
              </BlockStack>

              <BlockStack gap="100">
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  Upload Policy
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Max size: {schema.uploadPolicy?.maxFileSizeMB || 25}MB
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Min DPI: {schema.uploadPolicy?.minDPI || 150}
                </Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>


      <script
        dangerouslySetInnerHTML={{
          __html: `
              // Load 3D preview when ready
              if (typeof window !== 'undefined') {
                const container = document.getElementById('upload-lift-3d-preview');
                if (container) {
                  const script = document.createElement('script');
                  script.src = '/assets/upload-lift-3d-preview.js';
                  script.defer = true;
                  document.body.appendChild(script);
                }
              }
            `,
        }}
      />
    </Page>
  )
}
