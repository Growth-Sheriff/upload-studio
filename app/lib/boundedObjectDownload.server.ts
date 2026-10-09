import { createWriteStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { currentJobSignal, remainingJobMs } from './jobBudget.server'

export const MAX_PROCESSING_FILE_BYTES = 1024 * 1024 * 1024
export const OBJECT_DOWNLOAD_TIMEOUT_MS = 120_000

/** Timeout covers response headers AND every body byte, not just GetObject.
 * An unending stream is destroyed, its partial file removed and slot freed. */
export async function downloadObjectBounded(
  localPath: string,
  open: (signal: AbortSignal) => Promise<{ body: Readable; contentLength?: number }>,
  options: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<void> {
  const controller = new AbortController()
  const parent = currentJobSignal()
  const abort = () => controller.abort(parent?.reason)
  if (parent?.aborted) abort()
  else parent?.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(() => controller.abort(new Error('Storage download timed out')), remainingJobMs(options.timeoutMs ?? OBJECT_DOWNLOAD_TIMEOUT_MS))
  timeout.unref()
  let bytes = 0
  const maxBytes = options.maxBytes ?? MAX_PROCESSING_FILE_BYTES
  try {
    controller.signal.throwIfAborted()
    // Opening must also terminate if an SDK ignores cancellation. Dispose a
    // response arriving after the deadline instead of leaving its socket alive.
    const opening = open(controller.signal).then(response => {
      if (controller.signal.aborted) { response.body.destroy(); controller.signal.throwIfAborted() }
      return response
    })
    let onAbort: (() => void) | undefined
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(controller.signal.reason ?? new Error('Storage download aborted'))
      if (controller.signal.aborted) onAbort()
      else controller.signal.addEventListener('abort', onAbort, { once: true })
    })
    let response: Awaited<typeof opening>
    try { response = await Promise.race([opening, aborted]) }
    finally { if (onAbort) controller.signal.removeEventListener('abort', onAbort) }
    const { body, contentLength } = response
    if (contentLength && contentLength > maxBytes) {
      body.destroy()
      throw new Error(`File exceeds processing limit (${maxBytes} bytes)`)
    }
    const limit = new Transform({ transform(chunk, _encoding, callback) {
      bytes += chunk.length
      callback(bytes > maxBytes ? new Error(`File exceeds processing limit (${maxBytes} bytes)`) : null, chunk)
    } })
    await pipeline(body, limit, createWriteStream(localPath), { signal: controller.signal })
    if (contentLength !== undefined && contentLength !== bytes) throw new Error(`Incomplete storage object (${bytes}/${contentLength} bytes)`)
  } catch (error) {
    await rm(localPath, { force: true }).catch(() => undefined)
    throw error
  } finally {
    clearTimeout(timeout)
    parent?.removeEventListener('abort', abort)
  }
}
