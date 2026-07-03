





















import { PrismaClient } from '@prisma/client'
import { existsSync } from 'fs'
import { readFile, stat } from 'fs/promises'
import { join } from 'path'

const prisma = new PrismaClient()


const BUNNY_STORAGE_ZONE = process.env.BUNNY_STORAGE_ZONE || 'customizerappdev'
const BUNNY_API_KEY = process.env.BUNNY_API_KEY || ''
const BUNNY_CDN_URL = process.env.BUNNY_CDN_URL || 'https://customizerappdev.b-cdn.net'
const BUNNY_STORAGE_HOST = 'storage.bunnycdn.com'
const LOCAL_STORAGE_PATH = process.env.LOCAL_STORAGE_PATH || './uploads'


const isDryRun = process.argv.includes('--dry-run')
const isVerbose = process.argv.includes('--verbose')
const limitArg = process.argv.find((a) => a.startsWith('--limit='))
const limit = limitArg ? parseInt(limitArg.split('=')[1]) : undefined
const shopArg = process.argv.find((a) => a.startsWith('--shop='))
const shopFilter = shopArg ? shopArg.split('=')[1] : undefined


const stats = {
  total: 0,
  migrated: 0,
  skipped: 0,
  failed: 0,
  totalBytes: 0,
}




async function uploadToBunny(key: string, data: Buffer, contentType: string): Promise<string> {
  const url = `https://${BUNNY_STORAGE_HOST}/${BUNNY_STORAGE_ZONE}/${key}`

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      AccessKey: BUNNY_API_KEY,
      'Content-Type': contentType,
    },
    body: data,
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`Bunny upload failed: ${response.status} ${response.statusText} - ${errorText}`)
  }

  return `${BUNNY_CDN_URL}/${key}`
}




async function checkBunnyExists(key: string): Promise<boolean> {
  const url = `https://${BUNNY_STORAGE_HOST}/${BUNNY_STORAGE_ZONE}/${key}`

  try {
    const response = await fetch(url, {
      method: 'HEAD',
      headers: {
        AccessKey: BUNNY_API_KEY,
      },
    })
    return response.ok
  } catch {
    return false
  }
}




async function migrateItem(item: {
  id: string
  storageKey: string
  mimeType: string | null
  thumbnailKey: string | null
  previewKey: string | null
}): Promise<'migrated' | 'skipped' | 'failed'> {
  try {

    if (item.storageKey.startsWith('http://') || item.storageKey.startsWith('https://')) {
      if (isVerbose) console.log(`  [SKIP] ${item.id} - Already external URL`)
      return 'skipped'
    }


    if (item.storageKey.startsWith('bunny:')) {
      if (isVerbose) console.log(`  [SKIP] ${item.id} - Already Bunny storage`)
      return 'skipped'
    }


    const localPath = join(LOCAL_STORAGE_PATH, item.storageKey)
    if (!existsSync(localPath)) {
      console.log(`  [SKIP] ${item.id} - Local file not found: ${localPath}`)
      return 'skipped'
    }


    const fileStat = await stat(localPath)
    stats.totalBytes += fileStat.size

    if (isDryRun) {
      console.log(`  [DRY-RUN] Would migrate: ${item.storageKey} (${formatBytes(fileStat.size)})`)
      return 'migrated'
    }


    const fileData = await readFile(localPath)


    const exists = await checkBunnyExists(item.storageKey)
    if (exists) {
      if (isVerbose)
        console.log(`  [EXISTS] ${item.storageKey} - Already on Bunny, updating DB only`)
    } else {

      await uploadToBunny(item.storageKey, fileData, item.mimeType || 'application/octet-stream')
    }


    await prisma.uploadItem.update({
      where: { id: item.id },
      data: { storageKey: `bunny:${item.storageKey}` },
    })


    if (
      item.thumbnailKey &&
      !item.thumbnailKey.startsWith('http') &&
      !item.thumbnailKey.startsWith('bunny:')
    ) {
      const thumbPath = join(LOCAL_STORAGE_PATH, item.thumbnailKey)
      if (existsSync(thumbPath)) {
        const thumbData = await readFile(thumbPath)
        const thumbExists = await checkBunnyExists(item.thumbnailKey)
        if (!thumbExists) {
          await uploadToBunny(item.thumbnailKey, thumbData, 'image/webp')
        }
        await prisma.uploadItem.update({
          where: { id: item.id },
          data: { thumbnailKey: `bunny:${item.thumbnailKey}` },
        })
      }
    }


    if (
      item.previewKey &&
      !item.previewKey.startsWith('http') &&
      !item.previewKey.startsWith('bunny:')
    ) {
      const previewPath = join(LOCAL_STORAGE_PATH, item.previewKey)
      if (existsSync(previewPath)) {
        const previewData = await readFile(previewPath)
        const previewExists = await checkBunnyExists(item.previewKey)
        if (!previewExists) {
          await uploadToBunny(item.previewKey, previewData, 'image/webp')
        }
        await prisma.uploadItem.update({
          where: { id: item.id },
          data: { previewKey: `bunny:${item.previewKey}` },
        })
      }
    }

    console.log(`  [OK] ${item.id}: ${item.storageKey} → bunny:${item.storageKey}`)
    return 'migrated'
  } catch (error) {
    console.error(`  [ERROR] ${item.id}: ${error instanceof Error ? error.message : error}`)
    return 'failed'
  }
}




function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}




async function main() {
  console.log('')
  console.log('═'.repeat(60))
  console.log('  LOCAL STORAGE → BUNNY.NET CDN MIGRATION')
  console.log('═'.repeat(60))
  console.log('')
  console.log(`  Mode:          ${isDryRun ? '🔍 DRY RUN (no changes)' : '🚀 LIVE MIGRATION'}`)
  console.log(`  Limit:         ${limit || 'ALL'}`)
  console.log(`  Shop Filter:   ${shopFilter || 'ALL SHOPS'}`)
  console.log(`  Bunny Zone:    ${BUNNY_STORAGE_ZONE}`)
  console.log(`  Bunny CDN:     ${BUNNY_CDN_URL}`)
  console.log(`  Local Path:    ${LOCAL_STORAGE_PATH}`)
  console.log('')


  if (!BUNNY_API_KEY && !isDryRun) {
    console.error('❌ ERROR: BUNNY_API_KEY is required for live migration')
    process.exit(1)
  }


  const whereClause: any = {
    storageKey: {
      not: { startsWith: 'http' },
    },
  }


  if (shopFilter) {
    const shop = await prisma.shop.findUnique({
      where: { shopDomain: shopFilter },
      select: { id: true },
    })

    if (!shop) {
      console.error(`❌ ERROR: Shop not found: ${shopFilter}`)
      process.exit(1)
    }

    whereClause.upload = { shopId: shop.id }
  }


  const items = await prisma.uploadItem.findMany({
    where: whereClause,
    select: {
      id: true,
      storageKey: true,
      mimeType: true,
      thumbnailKey: true,
      previewKey: true,
    },
    take: limit,
    orderBy: { createdAt: 'asc' },
  })

  stats.total = items.length
  console.log(`📁 Found ${items.length} items to process`)
  console.log('')
  console.log('─'.repeat(60))
  console.log('')


  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    console.log(`[${i + 1}/${items.length}] Processing ${item.id}...`)

    const result = await migrateItem(item)

    switch (result) {
      case 'migrated':
        stats.migrated++
        break
      case 'skipped':
        stats.skipped++
        break
      case 'failed':
        stats.failed++
        break
    }


    if (!isDryRun && result === 'migrated') {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }


  console.log('')
  console.log('═'.repeat(60))
  console.log('  MIGRATION COMPLETE')
  console.log('═'.repeat(60))
  console.log('')
  console.log(`  Total Processed: ${stats.total}`)
  console.log(`  ✅ Migrated:     ${stats.migrated}`)
  console.log(`  ⏭️  Skipped:      ${stats.skipped}`)
  console.log(`  ❌ Failed:       ${stats.failed}`)
  console.log(`  📦 Total Size:   ${formatBytes(stats.totalBytes)}`)
  console.log('')

  if (isDryRun) {
    console.log('💡 This was a dry run. Run without --dry-run to perform actual migration.')
    console.log('')
  }

  if (stats.failed > 0) {
    process.exit(1)
  }
}


main()
  .catch((error) => {
    console.error('❌ Migration failed:', error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
