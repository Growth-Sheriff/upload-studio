import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'
import { Form, useActionData, useLoaderData, useNavigation } from '@remix-run/react'
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  DataTable,
  EmptyState,
  FormLayout,
  InlineStack,
  Layout,
  Modal,
  Page,
  Select,
  Text,
  TextField,
  Thumbnail,
} from '@shopify/polaris'
import { useCallback, useState } from 'react'
import prisma from '~/lib/prisma.server'
import { getStorageConfig, getUploadSignedUrl } from '~/lib/storage.server'
import { authenticate } from '~/shopify.server'


const DEFAULT_PRINT_LOCATIONS = [
  {
    code: 'front',
    name: 'Front',
    position: [0, 0.15, 0.15],
    rotation: [0, 0, 0],
    designArea: { width: 12, height: 14 },
    constraints: { minScale: 0.1, maxScale: 1, allowRotation: true },
  },
  {
    code: 'back',
    name: 'Back',
    position: [0, 0.15, -0.15],
    rotation: [0, Math.PI, 0],
    designArea: { width: 12, height: 16 },
    constraints: { minScale: 0.1, maxScale: 1, allowRotation: true },
  },
  {
    code: 'left_sleeve',
    name: 'Left Sleeve',
    position: [-0.2, 0.25, 0],
    rotation: [0, -Math.PI / 2, 0],
    designArea: { width: 4, height: 4 },
    constraints: { minScale: 0.1, maxScale: 0.5, allowRotation: true },
  },
  {
    code: 'right_sleeve',
    name: 'Right Sleeve',
    position: [0.2, 0.25, 0],
    rotation: [0, Math.PI / 2, 0],
    designArea: { width: 4, height: 4 },
    constraints: { minScale: 0.1, maxScale: 0.5, allowRotation: true },
  },
]

const DEFAULT_CAMERA_PRESETS = [
  { id: 'front', name: 'Front View', position: [0, 0, 2.5], target: [0, 0, 0] },
  { id: 'back', name: 'Back View', position: [0, 0, -2.5], target: [0, 0, 0] },
  { id: 'left', name: 'Left View', position: [-2.5, 0, 0], target: [0, 0, 0] },
  { id: 'right', name: 'Right View', position: [2.5, 0, 0], target: [0, 0, 0] },
]

export async function loader({ request }: LoaderFunctionArgs) {
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




  const assetSets = await prisma.assetSet.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: 'desc' },
  })


  const productCounts = await prisma.productConfig.groupBy({
    by: ['assetSetId'],
    where: { shopId: shop.id, assetSetId: { not: null } },
    _count: true,
  })

  const countsMap = new Map(
    productCounts.map((p: { assetSetId: string | null; _count: number }) => [
      p.assetSetId,
      p._count,
    ])
  )

  return json({
    assetSets: assetSets.map((a) => ({
      id: a.id,
      name: a.name,
      thumbnailUrl: a.thumbnailUrl,
      status: a.status,
      productCount: countsMap.get(a.id) || 0,
      schema: a.schema as Record<string, unknown>,
      createdAt: a.createdAt.toISOString(),
    })),
    shopPlan: shop.plan,
  })
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request)
  const shopDomain = session.shop

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
  })

  if (!shop) {
    return json({ error: 'Shop not found' }, { status: 404 })
  }

  const formData = await request.formData()
  const action = formData.get('_action')

  if (action === 'create') {
    const name = formData.get('name') as string
    const modelUrl = formData.get('modelUrl') as string
    const locationsJson = formData.get('printLocations') as string

    if (!name) {
      return json({ error: 'Name is required' })
    }

    let printLocations = DEFAULT_PRINT_LOCATIONS
    if (locationsJson) {
      try {
        printLocations = JSON.parse(locationsJson)
      } catch {

      }
    }

    const schema = {
      version: '1.0',
      model: {
        type: 'glb',
        source: modelUrl || 'default_tshirt.glb',
      },
      printLocations,
      cameraPresets: DEFAULT_CAMERA_PRESETS,
      renderPreset: {
        environment: 'city',
        shadows: true,
        ambientIntensity: 0.5,
        directionalIntensity: 1,
      },
      uploadPolicy: {
        maxFileSizeMB: 1024,
        minDPI: 150,
        allowedFormats: [
          'image/png',
          'image/jpeg',
          'image/webp',
          'image/tiff',
          'image/vnd.adobe.photoshop',
          'application/pdf',
          'application/postscript',
        ],
      },
    }

    const assetSet = await prisma.assetSet.create({
      data: {
        shopId: shop.id,
        name,
        schema,
        status: 'active',
      },
    })


    await prisma.auditLog.create({
      data: {
        shopId: shop.id,
        action: 'create',
        resourceType: 'asset_set',
        resourceId: assetSet.id,
        metadata: { name },
      },
    })

    return json({ success: true, assetSetId: assetSet.id, message: 'Asset set created' })
  }

  if (action === 'update') {
    const assetSetId = formData.get('assetSetId') as string
    const name = formData.get('name') as string
    const modelUrl = formData.get('modelUrl') as string
    const locationsJson = formData.get('printLocations') as string
    const status = formData.get('status') as string

    const existing = await prisma.assetSet.findFirst({
      where: { id: assetSetId, shopId: shop.id },
    })

    if (!existing) {
      return json({ error: 'Asset set not found' })
    }

    const currentSchema = existing.schema as Record<string, unknown>
    let printLocations = currentSchema.printLocations || DEFAULT_PRINT_LOCATIONS

    if (locationsJson) {
      try {
        printLocations = JSON.parse(locationsJson)
      } catch {

      }
    }

    const schema = {
      ...currentSchema,
      model: modelUrl ? { type: 'glb', source: modelUrl } : currentSchema.model,
      printLocations,
    }


    await prisma.assetSet.update({
      where: { id: assetSetId, shopId: shop.id },
      data: {
        name: name || existing.name,
        schema,
        status: status || existing.status,
      },
    })


    await prisma.auditLog.create({
      data: {
        shopId: shop.id,
        action: 'update',
        resourceType: 'asset_set',
        resourceId: assetSetId,
        metadata: { name },
      },
    })

    return json({ success: true, message: 'Asset set updated' })
  }

  if (action === 'delete') {
    const assetSetId = formData.get('assetSetId') as string


    const inUse = await prisma.productConfig.count({
      where: { shopId: shop.id, assetSetId },
    })

    if (inUse > 0) {
      return json({ error: `Cannot delete: ${inUse} products are using this asset set` })
    }


    await prisma.assetSet.delete({
      where: { id: assetSetId, shopId: shop.id },
    })


    await prisma.auditLog.create({
      data: {
        shopId: shop.id,
        action: 'delete',
        resourceType: 'asset_set',
        resourceId: assetSetId,
      },
    })

    return json({ success: true, message: 'Asset set deleted' })
  }

  if (action === 'archive') {
    const assetSetId = formData.get('assetSetId') as string


    await prisma.assetSet.update({
      where: { id: assetSetId, shopId: shop.id },
      data: { status: 'archived' },
    })

    return json({ success: true, message: 'Asset set archived' })
  }

  if (action === 'get_upload_url') {

    const fileName = formData.get('fileName') as string
    const contentType = formData.get('contentType') as string

    const storageConfig = getStorageConfig({
      storageProvider: shop.storageProvider,
      storageConfig: shop.storageConfig as Record<string, string> | null,
    })
    const key = `${shopDomain}/assets/models/${Date.now()}_${fileName}`

    const { url } = await getUploadSignedUrl(storageConfig, key, contentType, 900)

    return json({ uploadUrl: url, storageKey: key })
  }

  return json({ error: 'Unknown action' }, { status: 400 })
}

function StatusBadge({ status }: { status: string }) {
  return <Badge tone={status === 'active' ? 'success' : 'info'}>{status}</Badge>
}

export default function AssetSetsPage() {
  const data = useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()
  const navigation = useNavigation()
  const isSubmitting = navigation.state === 'submitting'

  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [selectedAsset, setSelectedAsset] = useState<{
    id: string
    name: string
    thumbnailUrl: string | null
    status: string
    productCount: number
    schema: Record<string, unknown>
    createdAt: string
  } | null>(null)
  const [formName, setFormName] = useState('')
  const [formModelUrl, setFormModelUrl] = useState('')


  const { assetSets } = data

  const openCreateModal = useCallback(() => {
    setFormName('')
    setFormModelUrl('')
    setCreateModalOpen(true)
  }, [])

  const openEditModal = useCallback(
    (asset: {
      id: string
      name: string
      thumbnailUrl: string | null
      status: string
      productCount: number
      schema: Record<string, unknown>
      createdAt: string
    }) => {
      setSelectedAsset(asset)
      setFormName(asset.name)
      setFormModelUrl(((asset.schema as Record<string, unknown>)?.model as string) || '')
      setEditModalOpen(true)
    },
    []
  )

  const rows = assetSets.map((asset) => [
    <InlineStack key={asset.id} gap="200" align="start" blockAlign="center">
      {asset.thumbnailUrl ? (
        <Thumbnail source={asset.thumbnailUrl} alt={asset.name} size="small" />
      ) : (
        <Box background="bg-surface-secondary" padding="200" borderRadius="100">
          <Text as="span" tone="subdued">
            3D
          </Text>
        </Box>
      )}
      <Text as="span" variant="bodyMd" fontWeight="semibold">
        {asset.name}
      </Text>
    </InlineStack>,
    <StatusBadge key={`status-${asset.id}`} status={asset.status} />,
    (asset.schema as any)?.printLocations?.length || 0,
    asset.productCount,
    new Date(asset.createdAt).toLocaleDateString(),
    <InlineStack key={`actions-${asset.id}`} gap="100">
      <Button size="slim" onClick={() => openEditModal(asset)}>
        Edit
      </Button>
      <Button size="slim" url={`/app/asset-sets/${asset.id}`}>
        Preview
      </Button>
    </InlineStack>,
  ])

  return (
    <Page
      title="Asset Sets"
      backAction={{ content: 'Dashboard', url: '/app' }}
      primaryAction={{ content: 'Create Asset Set', onAction: openCreateModal }}
    >
      <Layout>

        {actionData && 'success' in actionData && (
          <Layout.Section>
            <Banner tone="success" onDismiss={() => {}}>
              {actionData.message}
            </Banner>
          </Layout.Section>
        )}
        {actionData && 'error' in actionData && (
          <Layout.Section>
            <Banner tone="critical" onDismiss={() => {}}>
              {actionData.error}
            </Banner>
          </Layout.Section>
        )}


        <Layout.Section>
          <Banner tone="info">
            Asset Sets define 3D models and print locations for the 3D Designer. Each set includes a
            GLB model, print location configs, camera presets, and upload policies.
          </Banner>
        </Layout.Section>


        <Layout.Section>
          <Card>
            {assetSets.length > 0 ? (
              <DataTable
                columnContentTypes={['text', 'text', 'numeric', 'numeric', 'text', 'text']}
                headings={['Asset Set', 'Status', 'Locations', 'Products', 'Created', 'Actions']}
                rows={rows}
              />
            ) : (
              <EmptyState
                heading="No asset sets yet"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                action={{ content: 'Create Asset Set', onAction: openCreateModal }}
              >
                <p>Create your first asset set to enable 3D customization for products.</p>
              </EmptyState>
            )}
          </Card>
        </Layout.Section>
      </Layout>


      <Modal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="Create Asset Set"
        primaryAction={{
          content: 'Create',
          loading: isSubmitting,
          onAction: () => {
            const form = document.getElementById('create-form') as HTMLFormElement
            form?.submit()
          },
        }}
        secondaryActions={[{ content: 'Cancel', onAction: () => setCreateModalOpen(false) }]}
      >
        <Modal.Section>
          <Form method="post" id="create-form">
            <input type="hidden" name="_action" value="create" />
            <FormLayout>
              <TextField
                label="Name"
                name="name"
                value={formName}
                onChange={setFormName}
                placeholder="e.g., Basic T-Shirt White"
                autoComplete="off"
              />

              <TextField
                label="3D Model URL (GLB)"
                name="modelUrl"
                value={formModelUrl}
                onChange={setFormModelUrl}
                placeholder="Leave empty for default T-Shirt model"
                helpText="Upload a GLB file or use the default model"
                autoComplete="off"
              />

              <Banner tone="info">
                Default print locations (Front, Back, Left Sleeve, Right Sleeve) will be created.
                You can customize them after creating the asset set.
              </Banner>
            </FormLayout>
          </Form>
        </Modal.Section>
      </Modal>


      <Modal
        open={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        title={`Edit: ${selectedAsset?.name || ''}`}
        primaryAction={{
          content: 'Save',
          loading: isSubmitting,
          onAction: () => {
            const form = document.getElementById('edit-form') as HTMLFormElement
            form?.submit()
          },
        }}
        secondaryActions={[
          { content: 'Cancel', onAction: () => setEditModalOpen(false) },
          {
            content: 'Delete',
            destructive: true,
            disabled: (selectedAsset?.productCount || 0) > 0,
            onAction: () => {
              if (confirm('Are you sure you want to delete this asset set?')) {
                const form = document.createElement('form')
                form.method = 'post'
                form.innerHTML = `
                    <input type="hidden" name="_action" value="delete" />
                    <input type="hidden" name="assetSetId" value="${selectedAsset?.id}" />
                  `
                document.body.appendChild(form)
                form.submit()
              }
            },
          },
        ]}
      >
        <Modal.Section>
          <Form method="post" id="edit-form">
            <input type="hidden" name="_action" value="update" />
            <input type="hidden" name="assetSetId" value={selectedAsset?.id || ''} />
            <FormLayout>
              <TextField
                label="Name"
                name="name"
                value={formName}
                onChange={setFormName}
                autoComplete="off"
              />

              <TextField
                label="3D Model URL (GLB)"
                name="modelUrl"
                value={formModelUrl}
                onChange={setFormModelUrl}
                autoComplete="off"
              />

              <Select
                label="Status"
                name="status"
                options={[
                  { label: 'Active', value: 'active' },
                  { label: 'Archived', value: 'archived' },
                ]}
                value={selectedAsset?.status || 'active'}
              />

              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  Print Locations
                </Text>
                {((selectedAsset?.schema as any)?.printLocations || []).map(
                  (loc: any, idx: number) => (
                    <InlineStack key={idx} gap="200" align="space-between">
                      <Text as="span">
                        {loc.name} ({loc.code})
                      </Text>
                      <Text as="span" tone="subdued">
                        Area: {loc.designArea?.width}" x {loc.designArea?.height}"
                      </Text>
                    </InlineStack>
                  )
                )}
                <Button url={`/app/asset-sets/${selectedAsset?.id}/locations`} size="slim">
                  Edit Locations
                </Button>
              </BlockStack>
            </FormLayout>
          </Form>
        </Modal.Section>
      </Modal>
    </Page>
  )
}
