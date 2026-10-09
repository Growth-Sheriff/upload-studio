import { createHash } from 'node:crypto'
import prisma from '~/lib/prisma.server'
import { PUBLIC_LEGAL_DOCUMENT_VERSION, hasCurrentMerchantLegalReceipt, type MerchantLegalReceipt } from './publicLegalPolicy'

/** Owner-supplied identity is not inferred from a brand, mailbox or cloud account. */
export function getPublicLegalOperator() {
  const name = process.env.PUBLIC_LEGAL_ENTITY_NAME?.trim() || ''
  const address = process.env.PUBLIC_LEGAL_ENTITY_ADDRESS?.trim() || ''
  // Shopify's published Level-1 checklist requires identity/contact and a
  // processing agreement, not a compulsory street-address input. Do not make
  // an operator invent an address; jurisdiction-specific obligations remain.
  const ready = Boolean(name && process.env.PUBLIC_LEGAL_REVIEW_APPROVED === 'true')
  const identity = createHash('sha256').update(JSON.stringify([PUBLIC_LEGAL_DOCUMENT_VERSION, name, address])).digest('hex').slice(0, 24)
  return { name, address, ready, version: `${PUBLIC_LEGAL_DOCUMENT_VERSION}:${identity}` }
}
export function merchantLegalAgreementSatisfied(receipt: MerchantLegalReceipt): boolean {
  const operator = getPublicLegalOperator()
  return operator.ready && hasCurrentMerchantLegalReceipt(receipt, operator.version)
}
export async function requireMerchantLegalAgreement(shopId: string) {
  const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { legalAgreementVersion: true, legalAgreementAcceptedAt: true, legalAgreementActorId: true, erasureStartedAt: true, uninstalledAt: true } })
  if (!shop || shop.erasureStartedAt || shop.uninstalledAt || !merchantLegalAgreementSatisfied(shop)) throw new Error('Review and accept the current Terms and Data Processing Agreement in Setup before activating the app.')
}
export async function acceptMerchantLegalAgreement(shopId: string, actorId: string, version: string) {
  const operator = getPublicLegalOperator()
  if (!operator.ready) throw new Error('Activation is unavailable until the operator identity and processing terms are confirmed. Contact info@actualscope.com.')
  if (!/^\d{1,32}$/.test(actorId)) throw new Error('A verified Shopify administrator identity is required. Reopen the app from Shopify admin.')
  if (version !== operator.version) throw new Error('The terms changed. Reload Setup and review the current documents.')
  const acceptedAt = new Date()
  await prisma.$transaction(async tx => {
    const updated = await tx.shop.updateMany({ where: { id: shopId, erasureStartedAt: null, uninstalledAt: null, billingStatus: { notIn: ['erasing', 'uninstalled'] } }, data: { legalAgreementVersion: version, legalAgreementAcceptedAt: acceptedAt, legalAgreementActorId: actorId } })
    if (updated.count !== 1) throw new Error('This store is unavailable or being erased; acceptance was not recorded.')
    await tx.auditLog.create({ data: { shopId, action: 'merchant_processing_terms_accepted', resourceType: 'shop', resourceId: shopId, metadata: { version, acceptedAt: acceptedAt.toISOString(), actorId, operatorName: operator.name, operatorAddress: operator.address, documents: ['/legal/terms', '/legal/privacy', '/legal/dpa'] } } })
  })
}
