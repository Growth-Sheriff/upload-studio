import { describe, expect, it } from 'vitest'
import { Readable } from 'node:stream'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withJobBudget, currentJobSignal } from './jobBudget.server'
import { downloadObjectBounded } from './boundedObjectDownload.server'
import { withTenantContext } from './tenantContext.server'
import { scopeTenantOperation } from './tenantGuard.server'

describe('shared worker cancellation', () => {
  it('aborts hanging object bodies and removes partial output', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'public-download-'))
    const file = join(dir, 'original')
    const body = new Readable({ read() { this.push(Buffer.from('partial')); this._read = () => undefined } })
    try {
      await expect(downloadObjectBounded(file, async () => ({ body, contentLength: 100 }), { timeoutMs: 25 })).rejects.toThrow()
      expect(body.destroyed).toBe(true)
      await expect(readFile(file)).rejects.toThrow()
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('rejects an oversized object before writing it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'public-download-'))
    const body = Readable.from(['123456789'])
    try { await expect(downloadObjectBounded(join(dir, 'original'), async () => ({ body, contentLength: 9 }), { maxBytes: 8 })).rejects.toThrow('limit') }
    finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('bounds opening too, even when a provider ignores its abort signal', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'public-download-'))
    try { await expect(downloadObjectBounded(join(dir, 'original'), () => new Promise(() => undefined), { timeoutMs: 20 })).rejects.toThrow('timed out') }
    finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('late work cannot modify a tenant row after its job budget expires', async () => {
    let afterDeadline: Promise<void> | undefined
    await expect(withTenantContext('shop_one', () => withJobBudget(20, async () => {
      const signal = currentJobSignal()!
      afterDeadline = (async () => {
        await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve()))
        expect(() => scopeTenantOperation({ model: 'Upload', action: 'update', args: { where: { id: 'upload_001' }, data: { status: 'ready' } } })).toThrow('time budget')
      })()
      return new Promise<never>(() => undefined)
    }))).rejects.toThrow('time budget')
    await afterDeadline
  })
})
