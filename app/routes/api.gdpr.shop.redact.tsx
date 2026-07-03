import type { ActionFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'
import prisma from '~/lib/prisma.server'
import { deleteFile, getStorageConfig } from '~/lib/storage.server'
import { authenticate } from '~/shopify.server'



export async function action({ request }: ActionFunctionArgs) {

  const { shop, topic } = await authenticate.webhook(request)

  console.log(`[GDPR] ${topic} for shop: ${shop}`)

  try {

    const shopRecord = await prisma.shop.findUnique({
      where: { shopDomain: shop },
      include: {
        uploads: {
          include: { items: true },
        },
      },
    })

    if (!shopRecord) {
      console.log(`[GDPR] Shop ${shop} not found, nothing to redact`)
      return json({ ok: true })
    }


    const storageConfig = getStorageConfig({
      storageProvider: shopRecord.storageProvider,
      storageConfig: shopRecord.storageConfig as Record<string, string> | null,
    })
    let deletedFiles = 0
    let failedFiles = 0

    for (const upload of shopRecord.uploads) {
      for (const item of upload.items) {
        const keysToDelete = [item.storageKey, item.thumbnailKey, item.previewKey].filter(
          Boolean
        ) as string[]

        for (const key of keysToDelete) {
          try {
            await deleteFile(storageConfig, key)
            deletedFiles++
          } catch (e) {
            console.warn(`[GDPR] Failed to delete file ${key}:`, e)
            failedFiles++
          }
        }
      }
    }

    console.log(`[GDPR] Deleted ${deletedFiles} files (${failedFiles} failed) for shop ${shop}`)


    await prisma.shop.delete({
      where: { shopDomain: shop },
    })

    console.log(`[GDPR] Deleted all database data for shop ${shop}`)

    return json({ ok: true, deletedFiles, failedFiles })
  } catch (error) {
    console.error('[GDPR] Error processing shop redact:', error)
    return json({ ok: true })
  }
}
