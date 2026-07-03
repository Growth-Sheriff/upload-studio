









import type { ActionFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'
import { prisma } from '~/lib/prisma.server'
import { linkUploadToVisitor, recordAddToCart } from '~/lib/visitor.server'





interface SessionUpdateRequest {
  shopDomain: string
  sessionId: string
  action: 'page_view' | 'add_to_cart' | 'link_upload'
  uploadId?: string
  visitorId?: string
}





export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 })
  }

  let body: SessionUpdateRequest

  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { shopDomain, sessionId, action: sessionAction, uploadId, visitorId } = body

  if (!shopDomain || !sessionId || !sessionAction) {
    return json(
      { error: 'Missing required fields (shopDomain, sessionId, action)' },
      { status: 400 }
    )
  }


  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  })

  if (!shop) {
    return json({ error: 'Shop not found' }, { status: 404 })
  }



  let session = await prisma.visitorSession.findFirst({
    where: {
      shopId: shop.id,
      OR: [{ id: sessionId }, { sessionToken: sessionId }],
    },
    select: { id: true, visitorId: true },
  })

  if (!session) {



    return json({
      success: true,
      action: sessionAction,
      sessionFound: false,
      message: 'Session not found, action skipped',
    })
  }


  const actualSessionId = session.id

  try {
    switch (sessionAction) {
      case 'page_view':
        await prisma.visitorSession.update({
          where: { id: actualSessionId },
          data: {
            pageViews: { increment: 1 },
            lastActivityAt: new Date(),
          },
        })
        break

      case 'add_to_cart':
        await recordAddToCart(shop.id, actualSessionId)
        break

      case 'link_upload':
        if (!uploadId) {
          return json({ error: 'uploadId required for link_upload action' }, { status: 400 })
        }


        let effectiveVisitorId = session.visitorId
        if (visitorId && visitorId !== session.visitorId) {
          const visitorBelongsToShop = await prisma.visitor.findFirst({
            where: { id: visitorId, shopId: shop.id },
            select: { id: true },
          })
          if (!visitorBelongsToShop) {
            return json({ error: 'Visitor not found' }, { status: 404 })
          }
          effectiveVisitorId = visitorId
        }
        await linkUploadToVisitor(shop.id, uploadId, effectiveVisitorId, actualSessionId)
        break

      default:
        return json({ error: `Unknown action: ${sessionAction}` }, { status: 400 })
    }

    return json({
      success: true,
      action: sessionAction,
      sessionFound: true,
    })
  } catch (error) {
    console.error('[Session Update Error]', error)
    return json({ error: 'Failed to update session' }, { status: 500 })
  }
}
