
import { PrismaClient } from '@prisma/client'
import fs from 'fs'
import path from 'path'


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
            name
            createdAt
            note
            lineItems(first: 50) {
              edges {
                node {
                  id
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

  if (!response.ok) {
     console.error(`[${shopDomain}] Status: ${response.status} ${response.statusText}`)
     if (response.status === 401) return null
  }

  const result = await response.json()
  if (result.errors) {
    console.error(`[${shopDomain}] GraphQL Errors:`, JSON.stringify(result.errors, null, 2))
    return null
  }

  return result.data.orders
}

async function main() {
  console.log('🔍 Connecting to database...')
  const shops = await prisma.shop.findMany()
  console.log(`Found ${shops.length} shops.`)

  const allBrokenOrders = []

  for (const shop of shops) {
      console.log(`\nChecking shop: ${shop.shopDomain}`)
      if (!shop.accessToken) {
          console.log('  ❌ No access token found. Skipping.')
          continue
      }

      let hasNextPage = true
      let cursor = null
      let processedCount = 0
      const maxLimit = 500

      while (hasNextPage && processedCount < maxLimit) {
        const data = await fetchOrders(shop.shopDomain, shop.accessToken, cursor)
        if (!data) break

        const orders = data.edges
        if (orders.length === 0) break

        for (const { node: order } of orders) {
          processedCount++
          let hasBrokenLink = false
          const affectedItems = []

          for (const { node: item } of order.lineItems.edges) {
            for (const attr of item.customAttributes) {

              if (attr.value && (attr.value.includes('pub-') && attr.value.includes('.r2.dev'))) {
                hasBrokenLink = true
                affectedItems.push({
                  title: item.title,
                  key: attr.key,
                  value: attr.value
                })
              }
            }
          }

          if (hasBrokenLink) {
            allBrokenOrders.push({
              shop: shop.shopDomain,
              orderNumber: order.name,
              id: order.id,
              date: new Date(order.createdAt).toLocaleString('tr-TR'),
              items: affectedItems
            })
          }
        }

        hasNextPage = data.pageInfo.hasNextPage
        cursor = data.pageInfo.endCursor
        process.stdout.write(`  Checked ${processedCount} orders... Found ${allBrokenOrders.filter(o => o.shop === shop.shopDomain).length} broken for this shop.\r`)
      }
  }

  console.log('\n\n✅ Scan complete.\n')

  let markdown = '# 🚨 Broken R2 URLs Report\n\n'
  markdown += `**Date:** ${new Date().toLocaleString()}\n`
  markdown += `**Broken Orders Found:** ${allBrokenOrders.length}\n\n`

  markdown += '| Shop | Order | Date | Item | Property | Broken URL |\n'
  markdown += '|------|-------|------|------|----------|------------|\n'

  for (const order of allBrokenOrders) {
    for (const item of order.items) {
      markdown += `| ${order.shop} | ${order.orderNumber} | ${order.date} | ${item.title} | ${item.key} | \`${item.value.substring(0, 40)}...\` |\n`
    }
  }

  markdown += '\n<!-- RAW DATA FOR FIXING SCRIPT\n'
  markdown += JSON.stringify(allBrokenOrders, null, 2)
  markdown += '\n-->\n'

  console.log(markdown)

  fs.writeFileSync('BROKEN_URLS_REPORT.md', markdown)
  console.log('📄 Report saved to BROKEN_URLS_REPORT.md')

  await prisma.$disconnect()
}

main().catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
})
