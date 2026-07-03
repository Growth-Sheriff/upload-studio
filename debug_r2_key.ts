
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const uploadId = 'Mv2mNbdj3iM1'
  const upload = await prisma.upload.findFirst({
    where: { id: uploadId },
    include: { items: true }
  })

  if (!upload) {
    console.log('Upload not found')
    return
  }

  for (const item of upload.items) {
      console.log('--- ITEM ---')
      console.log('Full Storage Key:', item.storageKey)

      console.log('Key Length:', item.storageKey.length)

      const cleanKey = item.storageKey.replace('r2:', '')
      const url = `https://app.customizerapp.dev/${cleanKey}`
      console.log('Expected URL:', url)


      const encoded = cleanKey.split('/').map(s => encodeURIComponent(s)).join('/')
      console.log('Encoded URL:', `https://app.customizerapp.dev/${encoded}`)
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
