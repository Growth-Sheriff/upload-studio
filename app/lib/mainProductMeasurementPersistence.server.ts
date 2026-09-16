import prisma from '~/lib/prisma.server'
import type { UploadLifecycleMetadata } from '~/lib/uploadLifecycle.server'

export async function persistMainProductMeasurementProjection(
  itemId: string,
  metadata: UploadLifecycleMetadata,
  rollWidthIn: number
): Promise<void> {
  const metadataJson = JSON.stringify(metadata)
  const basisJson = JSON.stringify('full_page')
  const projectionJson = JSON.stringify({
    version: 1,
    policy: 'main_product_roll_width',
    rollWidthIn,
  })

  const updated = await prisma.$executeRaw`
    update upload_items
    set preflight_result_json = jsonb_set(
      jsonb_set(
        jsonb_set(
          coalesce(preflight_result_json, '{}'::jsonb),
          '{metadata}',
          ${metadataJson}::jsonb,
          true
        ),
        '{measurementBasis}',
        ${basisJson}::jsonb,
        true
      ),
      '{measurementProjection}',
      ${projectionJson}::jsonb,
      true
    )
    where id = ${itemId}
  `

  if (updated !== 1) {
    throw new Error(`Upload item not found while saving canonical measurement: ${itemId}`)
  }
}
