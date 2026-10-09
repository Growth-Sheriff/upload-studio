import { describe, expect, it, vi } from 'vitest'
import { calculateMeasuredLengthQuote } from './customerPricing.server'
import { acceptCheckoutSheetFacts, buildPaidSheetFacts, CHECKOUT_SHEET_CHANGED,
  recordPaidSheetFacts } from './paidSheetVolume.server'

vi.mock('./prisma.server', () => ({ default: {} }))
const uploadId = 'upload_123456'
function accepted() { return { id: uploadId, checkoutUnitBillableInches: 6,
  checkoutPricingMode: 'measured_length', checkoutVariantId: null,
  checkoutQuoteAcceptedAt: new Date('2026-10-09T10:00:00Z') } }
function paidOrder(quantity = 12) { return { id: '1001', financial_status: 'paid', customer: { id: '42' },
  volume_transactions_complete: true, refunds: [],
  transactions: [{ kind: 'sale', status: 'success', processed_at: '2026-10-09T11:00:00Z' }],
  line_items: [{ id: '123', quantity, variant_id: null,
    properties: [{ name: 'Sheet Identity', value: `https://public.example/i/${uploadId}?t=capability` }] }] } }

function ledger() {
  const rows = new Map<string, any>()
  const audit = vi.fn(async () => ({}))
  const store = { paidSheetVolume: {
    createMany: vi.fn(async ({ data }: any) => {
      const row = rows.get(data.id)
      if (row?.paidAt) return { count: 0 }
      rows.set(data.id, data); return { count: 1 }
    }), findFirst: vi.fn(async ({ where }: any) => rows.get(where.id)),
  }, auditLog: { upsert: audit } }
  return { rows, audit, store: store as any }
}

describe('accepted checkout unit', () => {
  it('keeps the first server unit immutable and allows quantity-only checkout changes', async () => {
    let snapshot: any = null
    const store = { upload: {
      updateMany: vi.fn(async ({ data }: any) => {
        if (snapshot) return { count: 0 }
        snapshot = data; return { count: 1 }
      }), findFirst: vi.fn(async () => snapshot),
    } } as any
    const input = { shopId: 'shop_one', uploadId, unitBillableInches: 6,
      pricingMode: 'measured_length', variantId: null }
    await acceptCheckoutSheetFacts(input, store)
    await acceptCheckoutSheetFacts(input, store)
    expect(snapshot).not.toHaveProperty('requestedCopies')
    await expect(acceptCheckoutSheetFacts({ ...input, unitBillableInches: 22 }, store)).rejects.toThrow(CHECKOUT_SHEET_CHANGED)
    await expect(acceptCheckoutSheetFacts({ ...input, variantId: '100000' }, store)).rejects.toThrow(CHECKOUT_SHEET_CHANGED)
    expect(Number(snapshot.checkoutUnitBillableInches)).toBe(6)
  })
})

describe('paid sheet volume snapshots', () => {
  it('counts 22x6 × 12 as the 72 inches actually quoted, never 264', () => {
    const quote = calculateMeasuredLengthQuote({ widthIn: 22, heightIn: 6 } as any, 0.3, 12)
    const upload = { ...accepted(), checkoutUnitBillableInches: quote.billableLengthIn / 12 }
    const facts = buildPaidSheetFacts(upload, paidOrder(), '123')!
    expect(Number(facts.paidBillableInches)).toBe(72)
    expect(facts.paidQuantity).toBe(12)
    expect(facts.paidCustomerId).toBe('42')
    expect(facts.paidAt.toISOString()).toBe('2026-10-09T11:00:00.000Z')
  })

  it('uses actual paid variant quantity, not the requested upload copies', () => {
    const order = paidOrder(2); order.line_items[0].variant_id = '100000' as any
    const facts = buildPaidSheetFacts({ ...accepted(), checkoutUnitBillableInches: 80,
      checkoutPricingMode: 'standard_variant', checkoutVariantId: '100000' }, order, '123')!
    expect(Number(facts.paidBillableInches)).toBe(160)
    expect(facts.paidQuantity).toBe(2)
    order.line_items[0].variant_id = '200000' as any
    expect(buildPaidSheetFacts({ ...accepted(), checkoutVariantId: '100000' }, order, '123')).toBeNull()
  })

  it('is replay-safe, records reused uploads per order, and audits a later quantity edit without rewriting', async () => {
    const { rows, audit, store } = ledger()
    const input = { shopId: 'shop_one', linkId: 'link_order1', upload: accepted(), order: paidOrder(), lineItemId: '123' }
    expect(await recordPaidSheetFacts(input, store)).toBe(true)
    expect(await recordPaidSheetFacts(input, store)).toBe(false)
    expect(audit).not.toHaveBeenCalled()
    rows.get('link_order1').paidCustomerId = null
    expect(await recordPaidSheetFacts(input, store)).toBe(false)
    expect(rows.get('link_order1').paidCustomerId).toBeNull()
    audit.mockClear()
    expect(await recordPaidSheetFacts({ ...input, order: paidOrder(20) }, store)).toBe(false)
    expect(Number(rows.get('link_order1').paidBillableInches)).toBe(72)
    expect(audit).toHaveBeenCalledOnce()
    const secondOrder = paidOrder(3); secondOrder.id = '1002'
    expect(await recordPaidSheetFacts({ ...input, linkId: 'link_order2', order: secondOrder }, store)).toBe(true)
    expect([...rows.values()].reduce((sum, row) => sum + Number(row.paidBillableInches), 0)).toBe(90)
  })

  it('does not invent volume for historical units, partial payment, missing payment dates or ambiguous lines', () => {
    expect(buildPaidSheetFacts({ id: uploadId }, paidOrder(), '123')).toBeNull()
    const partial = paidOrder(); partial.financial_status = 'partially_paid'
    expect(buildPaidSheetFacts(accepted(), partial, '123')).toBeNull()
    const missingDate = paidOrder(); missingDate.transactions[0].processed_at = ''
    expect(buildPaidSheetFacts(accepted(), missingDate, '123')).toBeNull()
    const incomplete = paidOrder(); incomplete.volume_transactions_complete = false
    expect(buildPaidSheetFacts(accepted(), incomplete, '123')).toBeNull()
    const ambiguous = paidOrder(); ambiguous.line_items.push({ ...ambiguous.line_items[0], id: '124' })
    expect(buildPaidSheetFacts(accepted(), ambiguous, '123')).toBeNull()
    const noteOnly = paidOrder(); noteOnly.line_items[0].properties = []
    expect(buildPaidSheetFacts(accepted(), noteOnly, '123')).toBeNull()
  })
})
