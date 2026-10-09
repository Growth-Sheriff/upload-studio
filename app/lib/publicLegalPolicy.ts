/** Bump on material changes; the server also binds acceptance to operator identity. */
export const PUBLIC_LEGAL_DOCUMENT_VERSION = '2026-10-10'
export interface MerchantLegalReceipt {
  legalAgreementVersion?: string | null
  legalAgreementAcceptedAt?: Date | string | null
  legalAgreementActorId?: string | null
}
export function hasCurrentMerchantLegalReceipt(receipt: MerchantLegalReceipt, version: string): boolean {
  return receipt.legalAgreementVersion === version && Boolean(receipt.legalAgreementAcceptedAt) && /^\d{1,32}$/.test(receipt.legalAgreementActorId || '')
}
