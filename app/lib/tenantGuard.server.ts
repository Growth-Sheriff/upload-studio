import type { PrismaClient } from '@prisma/client'
import { getTenantShopId, isTenantSqlAuthorized, requireTenantShopId, TenantIsolationError } from './tenantContext.server'
import { assertJobActive } from './jobBudget.server'

type Args = Record<string, any>
export interface TenantOperation { model?: string; action: string; args?: Args }
const scopedModels = new Set([
  'ProductConfig', 'AssetSet', 'Upload', 'OrderLink', 'ExportJob', 'AuditLog',
  'TeamMember', 'ApiKey', 'WhiteLabelConfig', 'FlowTrigger', 'Commission',
  'UploadLog', 'ShopBilling', 'BillingCredit', 'SupportTicket',
])
const whereActions = new Set(['findMany', 'findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow', 'count', 'aggregate', 'groupBy', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert'])

function rejectContradictingScope(value: unknown, shopId: string): void {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) { value.forEach(entry => rejectContradictingScope(entry, shopId)); return }
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'shopId' || key === 'shop_id') {
      if (entry !== shopId && !(entry && typeof entry === 'object' && (entry as Args).equals === shopId && Object.keys(entry).length === 1)) throw new TenantIsolationError('caller shop scope differs from authenticated shop')
    } else if (key === 'AND' || key === 'OR' || key === 'NOT' || key.startsWith('shopId_') || key === 'upload' || key === 'is') {
      rejectContradictingScope(entry, shopId)
    }
  }
}

function stampData(data: Args, shopId: string): void {
  rejectContradictingScope(data, shopId)
  if (data.shop?.connect?.id && data.shop.connect.id !== shopId) throw new TenantIsolationError('foreign shop relation')
  if (data.shop && !data.shop.connect) throw new TenantIsolationError('nested shop mutation is forbidden')
  if (!data.shop) data.shopId = shopId
}

/** IDs identify records, never owners. The top-level injected predicate
 * cannot be removed by a caller's OR/NOT filters or unique selectors. */
export function scopeTenantOperation(params: TenantOperation): void {
  assertJobActive()
  const { model, action } = params
  if (!model) {
    if (['queryRaw', 'executeRaw'].includes(action)) {
      const query = params.args?.query ?? params.args?.[0]
      const sql = String(query?.sql ?? query?.text ?? query ?? '').trim()
      if (!/^SELECT\s+1\s*;?$/i.test(sql) && !isTenantSqlAuthorized()) throw new TenantIsolationError('raw SQL requires a reviewed owner predicate')
    }
    if (/Unsafe$/.test(action)) throw new TenantIsolationError('unsafe raw SQL is forbidden')
    return
  }
  // Session adapter and verified Shop discovery are control-plane operations.
  if (model === 'Shop') {
    const shopId = getTenantShopId()
    if (shopId && params.args?.where?.id && params.args.where.id !== shopId) throw new TenantIsolationError('foreign Shop record')
    if (shopId && whereActions.has(action)) {
      const args = params.args ?? (params.args = {})
      args.where = { ...(args.where ?? {}), id: shopId }
    }
    if (params.args?.data || params.args?.create || params.args?.update) {
      const values = [params.args?.data, params.args?.create, params.args?.update]
      for (const value of values) if (value) {
        for (const key of ['uploads', 'productsConfig', 'assetSets', 'ordersLink', 'commissions', 'exportJobs', 'auditLogs', 'uploadLogs', 'billing', 'billingCredits']) if (value[key]) throw new TenantIsolationError('Shop nested tenant mutation is forbidden')
      }
    }
    return
  }
  if (!scopedModels.has(model) && !['UploadItem', 'SupportReply'].includes(model)) {
    if (['Session', 'ComplianceRequest'].includes(model)) return
    throw new TenantIsolationError(`unclassified model ${model}`)
  }
  const shopId = requireTenantShopId()
  const args = params.args ?? (params.args = {})
  if (whereActions.has(action)) {
    const where = args.where ?? (args.where = {})
    rejectContradictingScope(where, shopId)
    if (model === 'UploadItem') where.upload = { ...(where.upload ?? {}), shopId }
    else if (model === 'SupportReply') where.ticket = { ...(where.ticket ?? {}), shopId }
    else where.shopId = shopId
  }
  if (['create', 'createMany', 'createManyAndReturn'].includes(action)) {
    const records = Array.isArray(args.data) ? args.data : [args.data]
    for (const record of records) {
      if (!record) throw new TenantIsolationError('missing create data')
      if (!['UploadItem', 'SupportReply'].includes(model)) stampData(record, shopId)
    }
  }
  if (action === 'upsert') {
    if (!['UploadItem', 'SupportReply'].includes(model)) stampData(args.create, shopId)
    rejectContradictingScope(args.update, shopId)
  }
  if (['update', 'updateMany'].includes(action)) rejectContradictingScope(args.data, shopId)
}

async function assertOwner(client: PrismaClient, model: string, selector: Args, shopId: string): Promise<void> {
  const delegate = (client as any)[model[0].toLowerCase() + model.slice(1)]
  const where = model === 'UploadItem' ? { ...selector, upload: { shopId } } : { ...selector, shopId }
  if (!await delegate.findFirst({ where, select: { id: true } })) throw new TenantIsolationError(`foreign or missing ${model} relation`)
}

/** Scalar foreign keys and nested connects also need owner validation. */
export async function validateTenantRelations(client: PrismaClient, params: TenantOperation): Promise<void> {
  if (!params.model || !['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'upsert'].includes(params.action)) return
  if (!scopedModels.has(params.model) && !['UploadItem', 'SupportReply'].includes(params.model)) return
  const shopId = requireTenantShopId()
  const data = params.action === 'upsert' ? [params.args?.create, params.args?.update] : Array.isArray(params.args?.data) ? params.args?.data : [params.args?.data]
  for (const record of data) {
    if (!record) continue
    if (params.model === 'SupportReply') {
      if (record.ticketId) await assertOwner(client, 'SupportTicket', { id: record.ticketId }, shopId)
      if (record.ticket?.connect) await assertOwner(client, 'SupportTicket', record.ticket.connect, shopId)
      if (record.ticket && !record.ticket.connect) throw new TenantIsolationError('nested ticket mutation is forbidden')
    }
    if (['UploadItem', 'OrderLink'].includes(params.model)) {
      if (record.uploadId) await assertOwner(client, 'Upload', { id: record.uploadId }, shopId)
      if (record.upload?.connect) await assertOwner(client, 'Upload', record.upload.connect, shopId)
      if (record.upload?.create || record.upload?.upsert || record.upload?.update) throw new TenantIsolationError('nested upload mutation is forbidden; use its scoped delegate')
    }
    if (params.model === 'ProductConfig') {
      if (record.assetSetId) await assertOwner(client, 'AssetSet', { id: record.assetSetId }, shopId)
      if (record.assetSet?.connect) await assertOwner(client, 'AssetSet', record.assetSet.connect, shopId)
      if (record.assetSet && !record.assetSet.connect && !record.assetSet.disconnect) throw new TenantIsolationError('nested asset mutation is forbidden')
    }
    if (params.model === 'Upload' && record.items) {
      for (const key of ['connect', 'set', 'connectOrCreate', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert']) if (record.items[key]) throw new TenantIsolationError('nested item reassignment/mutation is forbidden; use its scoped delegate')
    }
    for (const key of ['ordersLink', 'productsConfig', 'uploads', 'assetSets', 'exportJobs', 'commissions', 'auditLogs', 'teamMembers', 'apiKeys', 'flowTriggers']) if (record[key]) throw new TenantIsolationError(`nested ${key} mutation is forbidden`)
  }
}

export async function assertTenantWriteAllowed(client: PrismaClient, params: TenantOperation): Promise<void> {
  if (!['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'upsert', 'executeRaw'].includes(params.action)) return
  if (params.model && !scopedModels.has(params.model) && !['UploadItem', 'SupportReply'].includes(params.model)) return
  const shopId = requireTenantShopId()
  const shop = await client.shop.findUnique({ where: { id: shopId }, select: { billingStatus: true } })
  if (!shop || shop.billingStatus === 'erasing') throw new TenantIsolationError('shop is being erased; writes are closed')
}
