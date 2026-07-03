
import { PrismaClient } from '@prisma/client'
import { REST } from '@discordjs/rest';


const prisma = new PrismaClient()


const R2_PUBLIC_BASE = 'https://app.customizerapp.dev'

async function main() {
  console.log('🔍 Scanning specifically for broken R2 fallback orders (Last 50 uploads)...')


  const uploads = await prisma.upload.findMany({
    take: 50,
    orderBy: { createdAt: 'desc' },
    where: {
      orderId: { not: null },
      items: {
        some: {
          storageKey: { startsWith: 'r2:' }
        }
      }
    },
    include: {
      items: true,
      shop: true
    }
  })

  console.log(`Found ${uploads.length} uploads with R2 fallback items.`)

  for (const upload of uploads) {
    if (!upload.createdAt) continue;


    console.log(`\n📦 Processing Order #${upload.orderId} (Upload: ${upload.id}) [${upload.createdAt.toISOString()}]`)
    const shopDomain = upload.shop.shopDomain;
    const accessToken = upload.shop.accessToken;

    const fileLinks: { location: string, url: string }[] = [];


    for (const item of upload.items) {
      if (item.storageKey && item.storageKey.startsWith('r2:')) {
        let cleanKey = item.storageKey.replace('r2:', '');





        const encodedKey = cleanKey.split('/').map(s => encodeURIComponent(s)).join('/');
        const finalUrl = `${R2_PUBLIC_BASE}/${encodedKey}`;

        console.log(`   👉 Generated: ${finalUrl}`);
        fileLinks.push({
            location: item.location,
            url: finalUrl
        });
      }
    }

    if (fileLinks.length > 0) {

      await updateShopifyOrder(shopDomain, accessToken, upload.orderId!, fileLinks);
    }
  }
}

async function updateShopifyOrder(shop: string, token: string, orderId: string, links: {location: string, url: string}[]) {
  console.log(`   🔄 Checking Shopify Order ${orderId}...`);

  const dateStr = new Date().toLocaleString('tr-TR');




  const noteLines = [
    `\n--- [Recovered Links] (${dateStr}) ---`,
    ...links.map(l => `${l.location.toUpperCase()}: ${l.url}`),
    "--------------------------------------------------"
  ];

  try {
    const getRes = await fetch(`https://${shop}/admin/api/2024-01/orders/${orderId}.json`, {
      headers: { 'X-Shopify-Access-Token': token }
    });

    if (!getRes.ok) {
        throw new Error(`Failed to fetch order: ${getRes.statusText}`);
    }

    const orderData = await getRes.json();
    const currentNote = orderData.order.note || "";


    const alreadyExists = links.some(l => currentNote.includes(l.url));

    if (alreadyExists) {
         console.log('   ⚠️  Links already in note. Skipping update.');
         return;
    }

    const updatedNote = currentNote + noteLines.join('\n');


    const updateRes = await fetch(`https://${shop}/admin/api/2024-01/orders/${orderId}.json`, {
      method: 'PUT',
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        order: {
          id: orderId,
          note: updatedNote
        }
      })
    });

    if (!updateRes.ok) {
         console.error(`   ❌ Failed to update Shopify: ${await updateRes.text()}`);
    } else {
         console.log('   ✅ Shopify Order Updated successfully!');
    }

  } catch (err) {
    console.error('   ❌ Error updating shopify:', err);
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
