
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Fetching recent uploads with suspected R2 content...')


  const uploads = await prisma.upload.findMany({
    take: 50,
    orderBy: { createdAt: 'desc' },
    include: {
      items: true
    }
  })

  let foundCount = 0;
  console.log('--- Scanning for R2 signatures in Storage Key ---');

  for (const upload of uploads) {
    if (!upload.orderId) continue;

    let hasR2 = false;
    const r2Items = [];

    for (const item of upload.items) {
      if (item.storageKey && (item.storageKey.includes('r2.dev') || item.storageKey.startsWith('r2:'))) {
        hasR2 = true;
        r2Items.push(item);
      }
    }

    if (hasR2) {
      foundCount++;
      if (foundCount > 10) break;

      console.log(`\n📦 Order #${upload.orderId}`);
      console.log(`   Upload ID: ${upload.id}`);
      console.log(`   Created At: ${upload.createdAt.toISOString()}`);

      for (const item of r2Items) {
        console.log(`   - StorageKey: ${item.storageKey}`);
      }
    }
  }
  if (foundCount === 0) {
      console.log('No recent orders found with explicit R2 keys in the last 50 uploads.');
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
