import { AsyncLocalStorage } from 'node:async_hooks'

const budgets = new AsyncLocalStorage<{ signal: AbortSignal; deadline: number }>()
export function currentJobSignal(): AbortSignal | undefined { return budgets.getStore()?.signal }
export function assertJobActive(): void { currentJobSignal()?.throwIfAborted() }
export function remainingJobMs(fallback: number): number {
  assertJobActive()
  const deadline = budgets.getStore()?.deadline
  return deadline ? Math.max(1, Math.min(fallback, deadline - Date.now())) : fallback
}

/** Cancellation reaches storage streams and child process groups. Late work
 * cannot write tenant records after the deadline because the Prisma guard
 * checks the same signal. */
export async function withJobBudget<T>(ms: number, run: () => Promise<T>): Promise<T> {
  const controller = new AbortController()
  let timer: NodeJS.Timeout | undefined
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`Upload processing exceeded its ${Math.round(ms / 1000)}s time budget`)
      controller.abort(error)
      reject(error)
    }, ms)
    timer.unref()
  })
  try {
    return await budgets.run({ signal: controller.signal, deadline: Date.now() + ms }, () => Promise.race([run(), expired]))
  } finally {
    if (timer) clearTimeout(timer)
    controller.abort()
  }
}
