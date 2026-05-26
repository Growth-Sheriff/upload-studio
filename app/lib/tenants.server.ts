export const TENANT_SLUGS = [
  'fastdtftransfer',
  'everydaycustomprint',
  'dtftransferohio',
  'dtfprinthouse',
  'dtfprintdepot',
  'eagledtfprint',
  'alphaprint',
  'gangsheet',
  'legendtransfers',
  'customprintaz',
] as const;

export type TenantSlug = (typeof TENANT_SLUGS)[number];

export function getTenantInternalUrl(slug: TenantSlug, path = ''): string {
  return `http://us-${slug}:3000${path}`;
}
