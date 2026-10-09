import { spawn } from 'node:child_process'
import { currentJobSignal, remainingJobMs } from './jobBudget.server'

/** A shell timeout must kill its descendants too: killing only /bin/sh leaves
 * convert/gs decoding in the background while another shop takes the slot. */
export function runImageCommand(command: string, options: { timeout?: number; maxBuffer?: number } = {}): Promise<{ stdout: string; stderr: string }> {
  const signal = currentJobSignal()
  signal?.throwIfAborted()
  const timeoutMs = remainingJobMs(options.timeout ?? 10 * 60_000)
  const maxBuffer = options.maxBuffer ?? 16 * 1024 * 1024
  return new Promise((resolve, reject) => {
    const linux = process.platform === 'linux'
    const child = spawn(linux ? `ulimit -v 3145728; ${command}` : command, {
      shell: true,
      detached: linux,
      windowsHide: true,
      env: {
        ...process.env,
        MAGICK_MEMORY_LIMIT: '512MiB', MAGICK_MAP_LIMIT: '1GiB',
        MAGICK_DISK_LIMIT: '2GiB', MAGICK_THREAD_LIMIT: '2',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = '', stderr = '', receivedBytes = 0
    let failure: Error | undefined
    const kill = (error: Error) => {
      failure ??= error
      if (linux && child.pid) {
        try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
      } else child.kill('SIGKILL')
    }
    const abort = () => kill(signal?.reason instanceof Error ? signal.reason : new Error('Image command cancelled'))
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    const timer = setTimeout(() => kill(new Error(`Image command timed out after ${timeoutMs}ms`)), timeoutMs)
    timer.unref()
    const capture = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
      receivedBytes += chunk.length
      if (receivedBytes > maxBuffer) { kill(new Error('Image command output exceeded its memory budget')); return }
      if (stream === 'stdout') stdout += chunk.toString()
      else stderr += chunk.toString()
    }
    child.stdout.on('data', chunk => capture('stdout', chunk))
    child.stderr.on('data', chunk => capture('stderr', chunk))
    child.once('error', error => { failure = error })
    child.once('close', code => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      if (failure) reject(failure)
      else if (code !== 0) reject(new Error(`Image command exited ${code}: ${stderr.slice(-2000)}`))
      else resolve({ stdout, stderr })
    })
  })
}
