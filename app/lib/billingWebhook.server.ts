import { createHash } from 'node:crypto'
import type { ActionFunctionArgs } from '@remix-run/node'
import prisma from '~/lib/prisma.server'
import { authenticate } from '~/shopify.server'

export async function acceptBillingWebhook({ request }: ActionFunctionArgs) {
  const { shop, topic } = await authenticate.webhook(request)
  const installed = await prisma.shop.findUnique({ where: { shopDomain: shop }, select: { id: true, uninstalledAt: true } })
  if (!installed || installed.uninstalledAt) return new Response(null, { status: 200 })
  const event = request.headers.get('X-Shopify-Event-Id') || request.headers.get('X-Shopify-Webhook-Id')
  if (!event) return new Response('Missing event identifier', { status: 400 })
  const id = `billing-webhook-${createHash('sha256').update(`${shop}|${topic}|${event}`).digest('hex')}`
  // No buyer payload stored. This durable receipt is safe on replay and its
  // status is reconciled against Shopify, not delivery order or a local timer.
  await prisma.auditLog.upsert({ where: { id }, create: { id, shopId: installed.id, action: 'shopify_billing_event_received', resourceType: 'billing', resourceId: installed.id, metadata: { topic, eventId: event } }, update: {} })
  // Never wait on provider network inside a webhook response. The shared
  // five-minute scheduler syncs active/pending subscriptions and the billing
  // page syncs immediately; each charge also verifies provider state first.
  return new Response(null, { status: 200 })
}
