import type { ActionFunctionArgs } from '@remix-run/node'
import { authenticate } from '~/shopify.server'
import prisma from '~/lib/prisma.server'
import { Prisma } from '@prisma/client'

export async function action({ request }: ActionFunctionArgs) {
  const { shop, webhookId } = await authenticate.webhook(request)
  const eventId = request.headers.get('X-Shopify-Event-Id') || webhookId
  const triggeredAt = new Date(request.headers.get('X-Shopify-Triggered-At') || '')
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await prisma.$transaction(async tx => {
        const identity = { shopDomain: shop, topic: 'uninstall/erase', eventId }
        if (await tx.complianceRequest.findUnique({ where: { compliance_shop_topic_event: identity } })) return
        const existing = await tx.shop.findUnique({ where: { shopDomain: shop } })
        if (!existing || existing.erasureStartedAt) return
        // An old uninstall delivery must not deactivate a freshly authenticated
        // installation. Event IDs also fence replay after a cancelled purge.
        if (Number.isFinite(triggeredAt.getTime()) && triggeredAt < existing.installedAt) {
          await tx.complianceRequest.create({ data: { ...identity, status: 'cancelled', completedAt: new Date(), payload: { reason: 'older_than_current_installation' } } })
          return
        }
        const uninstalledAt = existing.uninstalledAt || new Date()
        const changed = await tx.shop.updateMany({ where: { id: existing.id, erasureStartedAt: null },
          data: { billingStatus: 'uninstalled', uninstalledAt, accessToken: '' } })
        if (changed.count !== 1) throw new Error('Installation changed while processing uninstall')
        await tx.session.deleteMany({ where: { shop } })
        // Start at 46h; allow outstanding one-hour upload capabilities to drain.
        await tx.complianceRequest.create({ data: { ...identity, payload: { uninstalledAt: uninstalledAt.toISOString() },
          dueAt: new Date(uninstalledAt.getTime() + 46 * 3600_000) } })
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
      break
    } catch (error) {
      if (attempt === 2 || !(error instanceof Prisma.PrismaClientKnownRequestError) || !['P2034', 'P2002'].includes(error.code)) throw error
    }
  }
  return new Response(null, { status: 200 })
}
