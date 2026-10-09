import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createTenantPrismaClient } from './prisma.server'
import { withTenantContext } from './tenantContext.server'
import { acceptCheckoutSheetFacts, recordPaidSheetFacts } from './paidSheetVolume.server'

const url = process.env.PUBLIC_TENANCY_TEST_DATABASE_URL
describe.skipIf(!url)('paid film facts in isolated PostgreSQL', () => {
  it('stores actual paid copies once and retains film accounting after files are erased', async () => {
    const target = new URL(url!)
    if (!/^\/public[_a-z]*_test$/.test(target.pathname) || target.searchParams.get('schema') !== 'public') {
      throw new Error('Paid volume fixture requires a dedicated public_*_test database')
    }
    const client = createTenantPrismaClient({ datasources: { db: { url } } })
    const shop = await client.shop.create({ data: { shopDomain: `film-${randomUUID()}.myshopify.com`, accessToken: 'test-only' } })
    try {
      await withTenantContext(shop.id, async () => {
        const upload = await client.upload.create({ data: { shopId: shop.id, mode: 'dtf',
          items: { create: { location: 'front', storageKey: 'local:test-only-no-object' } } } })
        await acceptCheckoutSheetFacts({ shopId: shop.id, uploadId: upload.id,
          unitBillableInches: 6, pricingMode: 'measured_length', variantId: null }, client)
        const accepted = (await client.upload.findUnique({ where: { id: upload.id } }))!
        const paidOrder = (id: string, quantity: number) => ({ id, financial_status: 'paid',
          customer: { id: '42' }, volume_transactions_complete: true, refunds: [],
          transactions: [{ kind: 'sale', status: 'success', processed_at: new Date(Date.now() + 1000).toISOString() }],
          line_items: [{ id: `${id}1`, quantity, variant_id: null,
            properties: [{ name: 'Sheet Identity', value: `https://test.invalid/i/${upload.id}` }] }] })
        const firstOrder = paidOrder('1001', 12)
        const firstLink = await client.orderLink.create({ data: { shopId: shop.id, uploadId: upload.id,
          orderId: firstOrder.id, lineItemId: '10011' } })
        const input = { shopId: shop.id, linkId: firstLink.id, upload: accepted,
          order: firstOrder, lineItemId: '10011' }
        expect(await recordPaidSheetFacts(input, client)).toBe(true)
        expect(await recordPaidSheetFacts(input, client)).toBe(false)
        const changedQuantity = paidOrder('1001', 20)
        expect(await recordPaidSheetFacts({ ...input, order: changedQuantity }, client)).toBe(false)
        expect(Number((await client.paidSheetVolume.findUnique({ where: { id: firstLink.id } }))?.paidBillableInches)).toBe(72)
        expect(await client.auditLog.count({ where: { action: 'paid_sheet_volume_snapshot_conflict' } })).toBe(1)
        const secondOrder = paidOrder('1002', 3)
        const secondLink = await client.orderLink.create({ data: { shopId: shop.id, uploadId: upload.id,
          orderId: secondOrder.id, lineItemId: '10021' } })
        expect(await recordPaidSheetFacts({ ...input, linkId: secondLink.id,
          order: secondOrder, lineItemId: '10021' }, client)).toBe(true)
        const sum = await client.paidSheetVolume.aggregate({ where: { paidCustomerId: '42' }, _sum: { paidBillableInches: true } })
        expect(Number(sum._sum.paidBillableInches)).toBe(90)
        await client.upload.update({ where: { id: upload.id }, data: { privacyRedactedAt: new Date() } })
        await client.paidSheetVolume.updateMany({ where: { paidCustomerId: '42' }, data: { paidCustomerId: null } })
        expect(await recordPaidSheetFacts(input, client)).toBe(false)
        expect(await client.paidSheetVolume.count({ where: { paidCustomerId: '42' } })).toBe(0)
        await client.upload.delete({ where: { id: upload.id } })
        expect(await client.orderLink.count()).toBe(0)
        expect(await client.paidSheetVolume.count()).toBe(2)
        expect(Number((await client.paidSheetVolume.aggregate({ _sum: { paidBillableInches: true } }))._sum.paidBillableInches)).toBe(90)
      })
    } finally {
      await withTenantContext(shop.id, () => client.shop.delete({ where: { id: shop.id } }))
      await client.$disconnect()
    }
  }, 30_000)
})
