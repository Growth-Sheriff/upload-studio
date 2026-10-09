import { describe, expect, it, vi } from 'vitest'
import { enterTenantContext, requireTenantShopId, withTenantContext, withTenantRequest } from './tenantContext.server'
import { assertTenantWriteAllowed, scopeTenantOperation, validateTenantRelations, type TenantOperation } from './tenantGuard.server'
import { createUploadCapability, bindUploadCapability } from './uploadCapability.server'
import { withJobBudget } from './jobBudget.server'

describe('public tenant isolation', () => {
  it('keeps three simultaneous authenticated requests in separate shops after await', async () => {
    const results = await Promise.all(['shop_one', 'shop_two', 'shop_three'].map(shopId => withTenantRequest(async () => {
      await Promise.resolve()
      enterTenantContext(shopId)
      await new Promise(resolve => setTimeout(resolve, 2))
      const operation: TenantOperation = { model: 'Upload', action: 'findUnique', args: { where: { id: 'same_id' } } }
      scopeTenantOperation(operation)
      return operation.args?.where.shopId
    })))
    expect(results).toEqual(['shop_one', 'shop_two', 'shop_three'])
  })
  it('rejects unbound requests and caller-injected shops, including OR scope', () => {
    expect(() => scopeTenantOperation({ model: 'Upload', action: 'findMany', args: { where: { shopId: 'shop_one' } } })).toThrow('context is required')
    withTenantContext('shop_one', () => {
      expect(() => scopeTenantOperation({ model: 'Upload', action: 'findMany', args: { where: { OR: [{ shopId: 'shop_two' }] } } })).toThrow('differs')
      expect(() => enterTenantContext('shop_two')).toThrow('change')
    })
  })
  it('adds owner predicates to single reads, writes and item relation records', () => withTenantContext('shop_one', () => {
    for (const action of ['findUnique', 'update', 'delete', 'upsert']) {
      const op: TenantOperation = { model: 'UploadItem', action, args: { where: { id: 'item_001' }, create: { uploadId: 'upload_001' }, update: {} } }
      scopeTenantOperation(op)
      expect(op.args?.where.upload).toEqual({ shopId: 'shop_one' })
    }
    const op: TenantOperation = { model: 'Upload', action: 'createMany', args: { data: [{ mode: 'dtf' }, { mode: 'dtf' }] } }
    scopeTenantOperation(op)
    expect(op.args?.data.map((row: any) => row.shopId)).toEqual(['shop_one', 'shop_one'])
  }))
  it('verifies an item upload foreign key by owner instead of trusting its ID', async () => withTenantContext('shop_one', async () => {
    const findFirst = vi.fn().mockResolvedValue(null)
    await expect(validateTenantRelations({ upload: { findFirst } } as any, { model: 'UploadItem', action: 'create', args: { data: { uploadId: 'other_upload' } } })).rejects.toThrow('foreign')
    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'other_upload', shopId: 'shop_one' }, select: { id: true } })
  }))
  it('prevents nested item reassignment and unreviewed raw SQL', async () => withTenantContext('shop_one', async () => {
    await expect(validateTenantRelations({} as any, { model: 'Upload', action: 'update', args: { data: { items: { connect: { id: 'foreign' } } } } })).rejects.toThrow('reassignment')
    expect(() => scopeTenantOperation({ action: 'queryRaw', args: { query: 'SELECT * FROM uploads' } })).toThrow('raw SQL')
    for (const relation of ['teamMembers', 'apiKeys', 'whiteLabelConfig', 'flowTriggers', 'supportTickets']) expect(() => scopeTenantOperation({ model: 'Shop', action: 'update', args: { where: { id: 'shop_one' }, data: { [relation]: { connect: { id: 'foreign' } } } } })).toThrow('nested tenant mutation')
  }))
  it('signed public identity token binds one shop and rejects a changed upload', () => {
    vi.stubEnv('SECRET_KEY', 'unit-test-signing-secret')
    const token = withTenantContext('shop_one', () => createUploadCapability('upload_001'))
    withTenantRequest(() => {
      expect(bindUploadCapability('upload_002', token)).toBe(false)
      expect(bindUploadCapability('upload_001', `${token.slice(0, -3)}bad`)).toBe(false)
      expect(bindUploadCapability('upload_001', token)).toBe(true)
      expect(requireTenantShopId()).toBe('shop_one')
    })
    vi.unstubAllEnvs()
  })
  it('active processing can neither read nor revive a privacy-stopped upload', async () => withTenantContext('shop_one', () => withJobBudget(1000, async () => {
    const upload: TenantOperation = { model: 'Upload', action: 'updateMany', args: { where: { id: 'upload_001' }, data: { status: 'ready' } } }
    const item: TenantOperation = { model: 'UploadItem', action: 'findUnique', args: { where: { id: 'item_001' } } }
    scopeTenantOperation(upload); scopeTenantOperation(item)
    expect(upload.args?.where).toMatchObject({ shopId: 'shop_one', privacyRedactedAt: null })
    expect(item.args?.where.upload).toEqual({ shopId: 'shop_one', privacyRedactedAt: null })
  })))
  it('erasing shops cannot write records even from an already authenticated request', async () => withTenantContext('shop_one', async () => {
    const client = { shop: { findUnique: vi.fn().mockResolvedValue({ billingStatus: 'erasing' }) } }
    await expect(assertTenantWriteAllowed(client as any, { model: 'UploadItem', action: 'update' })).rejects.toThrow('writes are closed')
    await expect(assertTenantWriteAllowed(client as any, { model: 'Upload', action: 'deleteMany' })).resolves.toBeUndefined()
    client.shop.findUnique.mockResolvedValue({ billingStatus: 'active', erasureStartedAt: new Date() } as any)
    await expect(assertTenantWriteAllowed(client as any, { model: 'Upload', action: 'create' })).rejects.toThrow('writes are closed')
    expect(() => scopeTenantOperation({ model: 'Shop', action: 'update', args: { where: { id: 'shop_one' }, data: { erasureStartedAt: null } } })).toThrow('cannot be cleared')
  }))
})
