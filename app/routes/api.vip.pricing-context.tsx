import type { LoaderFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'
import prisma from '~/lib/prisma.server'
import {
  normalizeCustomerId,
  resolveCustomerPricingContext,
} from '~/lib/customerPricing.server'
import { authenticate } from '~/shopify.server'

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.public.appProxy(request)

  const url = new URL(request.url)
  const shopDomain = url.searchParams.get('shop')?.trim() || ''
  const loggedInCustomerId = normalizeCustomerId(url.searchParams.get('logged_in_customer_id'))

  if (!shopDomain) {
    return json({ error: 'Missing shop parameter' }, { status: 400 })
  }

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: {
      shopDomain: true,
      settings: true,
    },
  })

  if (!shop) {
    return json({ error: 'Shop not found' }, { status: 404 })
  }

  const context = resolveCustomerPricingContext(shop.settings, loggedInCustomerId)

  return json({
    shopDomain: shop.shopDomain,
    enabled: context.enabled,
    customerId: context.customerId,
    customerType: context.customerType,
    statusKey: context.statusKey,
    statusLabel: context.statusLabel,
    pricePerInch: context.pricePerInch,
    businessPricePerInch: context.businessPricePerInch,
    status: context.status,
    assignment: context.assignment,
  })
}
