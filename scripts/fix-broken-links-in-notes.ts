
import { PrismaClient } from '@prisma/client'
import fs from 'fs'
import path from 'path'

// Force load env
const envPath = path.resolve(process.cwd(), '.env')
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, 'utf8')
  envConfig.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/)
    if (match) {
      const key = match[1].trim()
      const value = match[2].trim().replace(/^["']|["']$/g, '') 
      if (!process.env[key]) process.env[key] = value
    }
  })
}

const prisma = new PrismaClient()
const API_VERSION = '2025-01'
const PROXY_BASE = `https://${process.env.APP_DOMAIN || 'uploadstudio.app.techifyboost.com'}/api/files/r2:`

async function updateOrderNote(shopDomain: string, accessToken: string, orderId: string, links: string[]) {
  console.log(`   🔄 Updating Order ${orderId}...`)

  const noteLines = [
    `\n--- [Fix: Corrected R2 Links] (${new Date().toLocaleString('tr-TR')}) ---`,
    ...links,
    "--------------------------------------------------"
  ];

  try {
    // 1. Get current note
    const getRes = await fetch(`https://${shopDomain}/admin/api/${API_VERSION}/orders/${orderId}.json`, {
      headers: { 'X-Shopify-Access-Token': accessToken }
    });

    if (!getRes.ok) {
        console.error(`   ❌ Failed to fetch order: ${getRes.status} ${getRes.statusText}`);
        return
    }

    const orderData = await getRes.json();
    const currentNote = orderData.order.note || "";
    
    // Check duplication
    if (links.some(l => currentNote.includes(l.split(': ')[1]))) {
        console.log('   ⚠️  Links already in note. Skipping.')
        return
    }

    const updatedNote = currentNote + noteLines.join('\n');

    // 2. Update note
    const updateRes = await fetch(`https://${shopDomain}/admin/api/${API_VERSION}/orders/${orderId}.json`, {
      method: 'PUT',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        order: {
          id: orderData.order.id, // Use numeric ID for REST
          note: updatedNote
        }
      })
    });

    if (!updateRes.ok) {
         console.error(`   ❌ Failed to update Shopify: ${await updateRes.text()}`);
    } else {
         console.log('   ✅ Order Note Updated!');
    }

  } catch (err) {
    console.error('   ❌ Error updating shopify:', err);
  }
}

async function fetchOrders(shopDomain: string, accessToken: string, cursor = null) {
  const query = `
    query getOrders($cursor: String) {
      orders(first: 50, after: $cursor, sortKey: CREATED_AT, reverse: true) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          node {
            id
            legacyResourceId
            name
            createdAt
            lineItems(first: 50) {
              edges {
                node {
                  title
                  customAttributes {
                    key
                    value
                  }
                }
              }
            }
          }
        }
      }
    }
  `

  const response = await fetch(`https://${shopDomain}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({
      query,
      variables: { cursor },
    }),
  })

  if (!response.ok) return null
  const result = await response.json()
  return result.data?.orders
}

async function main() {
  console.log('🔍 Scanning for broken R2 links to fix...')
  const shops = await prisma.shop.findMany()

  for (const shop of shops) {
      if (!shop.accessToken) continue
      console.log(`Checking shop: ${shop.shopDomain}`)

      let hasNextPage = true
      let cursor = null
      let processedCount = 0
      
      while (hasNextPage && processedCount < 200) { // Limit to 200 recent orders
        const data = await fetchOrders(shop.shopDomain, shop.accessToken, cursor)
        if (!data) break
    
        const orders = data.edges
        if (orders.length === 0) break
    
        for (const { node: order } of orders) {
          processedCount++
          const correctedLinks: string[] = []

          for (const { node: item } of order.lineItems.edges) {
            for (const attr of item.customAttributes) {
              if (attr.value && attr.value.includes('pub-') && attr.value.includes('.r2.dev')) {
                // Extract path: https://pub-xxx.r2.dev/PATH
                const parts = attr.value.split('.r2.dev/')
                if (parts.length > 1) {
                    const r2Key = parts[1] // The path after /
                    // Encode ONLY the path segments? URI is already likely encoded or not.
                    // Usually safe to take as is if it was a valid URL, but our proxy expects r2:KEY
                    // key should not start with slash.
                    // New URL: 
                    const newUrl = `${PROXY_BASE}${r2Key}`
                    correctedLinks.push(`${item.title}: ${newUrl}`)
                }
              }
            }
          }

          if (correctedLinks.length > 0) {
            console.log(`\nFound broken items in ${order.name}. Fixing...`)
            await updateOrderNote(shop.shopDomain, shop.accessToken, order.legacyResourceId, correctedLinks)
          }
        }
    
        hasNextPage = data.pageInfo.hasNextPage
        cursor = data.pageInfo.endCursor
      }
  }
  
  await prisma.$disconnect()
}

main().catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
})
