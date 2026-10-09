import prisma from '~/lib/prisma.server'
import type { UploadLifecycleMetadata } from '~/lib/uploadLifecycle.server'
import type { FinishedSheetSettings } from '~/lib/finishedSheetMeasurement'
import { withTenantSql } from './tenantContext.server'

export async function persistMainProductMeasurementProjection(
  itemId: string,
  metadata: UploadLifecycleMetadata,
  settings: FinishedSheetSettings
): Promise<void> {
  const metadataJson = JSON.stringify(metadata)
  const basisJson = JSON.stringify('full_page')
  const projectionJson = JSON.stringify({
    version: 2,
    policy: 'finished_sheet',
    maxPrintableWidthIn: settings.maxPrintableWidthIn,
    maxPrintableLengthIn: settings.maxPrintableLengthIn,
    fitToleranceIn: settings.fitToleranceIn,
  })

  const updated = await withTenantSql((shopId) => prisma.$executeRaw`
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
      and upload_id in (select id from uploads where shop_id = ${shopId} and privacy_redacted_at is null)
  `)

  if (updated !== 1) {
    throw new Error(`Upload item not found while saving canonical measurement: ${itemId}`)
  }
}
