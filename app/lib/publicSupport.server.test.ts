import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ reply: vi.fn(), sent: vi.fn(), email: vi.fn() }))
vi.mock('~/shopify.server', () => ({ authenticate: { admin: vi.fn(async () => ({ session: { shop: 'support-test.myshopify.com' } })) } }))
vi.mock('~/lib/prisma.server', () => ({ default: {
  shop: { findUnique: vi.fn(async () => ({ id: 'shop-a' })) },
  supportTicket: {
    findMany: vi.fn(async () => []), count: vi.fn(async () => 0),
    findFirst: vi.fn(async () => ({ id: 'ticket-a', ticketNumber: 'T-1', email: 'fixture@example.com', name: 'Fixture', subject: 'Help', status: 'in_progress' })),
  },
  supportReply: { create: mocks.reply, update: mocks.sent },
} }))
vi.mock('~/lib/email.server', () => ({ sendTicketReply: mocks.email, sendTicketStatusUpdate: vi.fn() }))
import { action, loader } from '../routes/app.support'

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })

it('reports server email availability without secrets and distinguishes a saved reply from a sent email', async () => {
  const args = { request: new Request('https://app.example/app/support'), params: {}, context: {} }
  vi.stubEnv('RESEND_API_KEY', '')
  expect(await (await loader(args)).json()).toMatchObject({ emailDeliveryConfigured: false })
  vi.stubEnv('RESEND_API_KEY', 'test-only-secret-never-returned')
  const configured = await (await loader(args)).text()
  expect(JSON.parse(configured)).toMatchObject({ emailDeliveryConfigured: true })
  expect(configured).not.toContain('test-only-secret-never-returned')

  mocks.reply.mockResolvedValue({ id: 'reply-a' })
  mocks.email.mockResolvedValue({ success: false })
  const request = new Request(args.request.url, { method: 'POST', body: new URLSearchParams({ intent: 'reply', ticketId: 'ticket-a', message: 'Saved response' }) })
  expect(await (await action({ ...args, request })).json()).toEqual({ success: true, emailSent: false })
  expect(mocks.reply).toHaveBeenCalledWith({ data: expect.objectContaining({ authorEmail: 'info@actualscope.com' }) })
  expect(mocks.sent).not.toHaveBeenCalled()

  const component = readFileSync('app/routes/app.support.tsx', 'utf8').split('export default function SupportPage')[1]
  expect(component).not.toContain('process.env')
  expect(component).not.toContain('RESEND_API_KEY')
  expect(component).toContain('mailto:info@actualscope.com')
})
