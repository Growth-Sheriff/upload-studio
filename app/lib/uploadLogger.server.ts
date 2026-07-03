















import prisma from './prisma.server'





export type UploadEventType =
  | 'INTENT_CREATED'
  | 'UPLOAD_STARTED'
  | 'UPLOAD_RETRY'
  | 'UPLOAD_FALLBACK'
  | 'UPLOAD_SUCCESS'
  | 'UPLOAD_FAILED'
  | 'COMPLETE_CALLED'
  | 'PREFLIGHT_STARTED'
  | 'PREFLIGHT_SUCCESS'
  | 'PREFLIGHT_FAILED'
  | 'DOWNLOAD_FAILED'
  | 'THUMBNAIL_GENERATED'
  | 'THUMBNAIL_FAILED'

export type StorageProvider = 'bunny' | 'r2' | 'local' | 'unknown'

export interface UploadLogContext {
  uploadId?: string
  itemId?: string
  shopId?: string
  shopDomain?: string
  fileName?: string
  fileSize?: number
  contentType?: string
  provider?: StorageProvider
  previousProvider?: StorageProvider
  attempt?: number
  maxAttempts?: number
  durationMs?: number
  error?: {
    code?: string
    message: string
    status?: number
    details?: Record<string, unknown>
  }
  fallbackReason?: string
  storageKey?: string
  url?: string
  metadata?: Record<string, unknown>
}

export interface UploadLogEntry {
  timestamp: string
  event: UploadEventType
  level: 'info' | 'warn' | 'error'
  context: UploadLogContext
  traceId?: string
}





class UploadLogger {
  private static instance: UploadLogger
  private logs: UploadLogEntry[] = []
  private maxLogsInMemory = 1000

  private constructor() {}

  static getInstance(): UploadLogger {
    if (!UploadLogger.instance) {
      UploadLogger.instance = new UploadLogger()
    }
    return UploadLogger.instance
  }




  generateTraceId(): string {
    return `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }




  async log(
    event: UploadEventType,
    context: UploadLogContext,
    options: { traceId?: string; persist?: boolean } = {}
  ): Promise<void> {
    const level = this.getLogLevel(event)
    const entry: UploadLogEntry = {
      timestamp: new Date().toISOString(),
      event,
      level,
      context,
      traceId: options.traceId,
    }


    this.consoleLog(entry)


    this.logs.push(entry)
    if (this.logs.length > this.maxLogsInMemory) {
      this.logs.shift()
    }


    if (options.persist || level === 'error') {
      await this.persistToDatabase(entry)
    }
  }




  async intentCreated(uploadId: string, context: Partial<UploadLogContext>): Promise<string> {
    const traceId = this.generateTraceId()
    await this.log('INTENT_CREATED', { uploadId, ...context }, { traceId })
    return traceId
  }

  async uploadStarted(
    traceId: string,
    provider: StorageProvider,
    context: Partial<UploadLogContext>
  ): Promise<void> {
    await this.log('UPLOAD_STARTED', { provider, ...context }, { traceId })
  }

  async uploadRetry(
    traceId: string,
    provider: StorageProvider,
    attempt: number,
    maxAttempts: number,
    error: string
  ): Promise<void> {
    await this.log(
      'UPLOAD_RETRY',
      {
        provider,
        attempt,
        maxAttempts,
        error: { message: error },
      },
      { traceId }
    )
  }

  async uploadFallback(
    traceId: string,
    fromProvider: StorageProvider,
    toProvider: StorageProvider,
    reason: string,
    context?: Partial<UploadLogContext>
  ): Promise<void> {
    await this.log(
      'UPLOAD_FALLBACK',
      {
        previousProvider: fromProvider,
        provider: toProvider,
        fallbackReason: reason,
        ...context,
      },
      { traceId, persist: true }
    )
  }

  async uploadSuccess(
    traceId: string,
    provider: StorageProvider,
    durationMs: number,
    context: Partial<UploadLogContext>
  ): Promise<void> {
    await this.log(
      'UPLOAD_SUCCESS',
      { provider, durationMs, ...context },
      { traceId, persist: true }
    )
  }

  async uploadFailed(
    traceId: string,
    provider: StorageProvider,
    error: { code?: string; message: string; status?: number; details?: Record<string, unknown> },
    context?: Partial<UploadLogContext>
  ): Promise<void> {
    await this.log('UPLOAD_FAILED', { provider, error, ...context }, { traceId, persist: true })
  }

  async completeCalled(
    traceId: string,
    uploadId: string,
    actualProvider: StorageProvider,
    actualUrl: string
  ): Promise<void> {
    await this.log(
      'COMPLETE_CALLED',
      {
        uploadId,
        provider: actualProvider,
        url: actualUrl,
        metadata: {
          fallbackUsed: actualProvider !== 'bunny',
        },
      },
      { traceId, persist: true }
    )
  }

  async preflightStarted(uploadId: string, itemId: string, storageKey: string): Promise<string> {
    const traceId = this.generateTraceId()
    await this.log('PREFLIGHT_STARTED', { uploadId, itemId, storageKey }, { traceId })
    return traceId
  }

  async preflightSuccess(
    traceId: string,
    itemId: string,
    result: 'ok' | 'warning' | 'error',
    durationMs: number
  ): Promise<void> {
    await this.log(
      'PREFLIGHT_SUCCESS',
      { itemId, durationMs, metadata: { result } },
      { traceId, persist: true }
    )
  }

  async preflightFailed(
    traceId: string,
    itemId: string,
    error: string,
    storageKey: string
  ): Promise<void> {
    await this.log(
      'PREFLIGHT_FAILED',
      { itemId, storageKey, error: { message: error } },
      { traceId, persist: true }
    )
  }

  async downloadFailed(
    traceId: string,
    provider: StorageProvider,
    storageKey: string,
    error: { code?: string; message: string; status?: number }
  ): Promise<void> {
    await this.log(
      'DOWNLOAD_FAILED',
      { provider, storageKey, error },
      { traceId, persist: true }
    )
  }




  getRecentLogs(count = 100): UploadLogEntry[] {
    return this.logs.slice(-count)
  }




  getLogsByTraceId(traceId: string): UploadLogEntry[] {
    return this.logs.filter((log) => log.traceId === traceId)
  }




  getLogsByUploadId(uploadId: string): UploadLogEntry[] {
    return this.logs.filter((log) => log.context.uploadId === uploadId)
  }




  async getErrorSummary(hours = 24): Promise<{
    total: number
    byProvider: Record<string, number>
    byEventType: Record<string, number>
    recentErrors: UploadLogEntry[]
  }> {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000)
    const errors = this.logs.filter(
      (log) => log.level === 'error' && new Date(log.timestamp) > cutoff
    )

    const byProvider: Record<string, number> = {}
    const byEventType: Record<string, number> = {}

    errors.forEach((error) => {
      const provider = error.context.provider || 'unknown'
      byProvider[provider] = (byProvider[provider] || 0) + 1
      byEventType[error.event] = (byEventType[error.event] || 0) + 1
    })

    return {
      total: errors.length,
      byProvider,
      byEventType,
      recentErrors: errors.slice(-10),
    }
  }





  private getLogLevel(event: UploadEventType): 'info' | 'warn' | 'error' {
    switch (event) {
      case 'UPLOAD_FAILED':
      case 'PREFLIGHT_FAILED':
      case 'DOWNLOAD_FAILED':
      case 'THUMBNAIL_FAILED':
        return 'error'
      case 'UPLOAD_RETRY':
      case 'UPLOAD_FALLBACK':
        return 'warn'
      default:
        return 'info'
    }
  }

  private consoleLog(entry: UploadLogEntry): void {
    const prefix = `[Upload:${entry.event}]`
    const traceInfo = entry.traceId ? `[${entry.traceId.slice(-8)}]` : ''
    const providerInfo = entry.context.provider ? `[${entry.context.provider}]` : ''


    const contextParts: string[] = []
    if (entry.context.uploadId) contextParts.push(`upload=${entry.context.uploadId}`)
    if (entry.context.itemId) contextParts.push(`item=${entry.context.itemId}`)
    if (entry.context.fileName) contextParts.push(`file=${entry.context.fileName}`)
    if (entry.context.fileSize)
      contextParts.push(`size=${(entry.context.fileSize / 1024 / 1024).toFixed(2)}MB`)
    if (entry.context.attempt)
      contextParts.push(`attempt=${entry.context.attempt}/${entry.context.maxAttempts}`)
    if (entry.context.durationMs) contextParts.push(`duration=${entry.context.durationMs}ms`)
    if (entry.context.error) contextParts.push(`error="${entry.context.error.message}"`)
    if (entry.context.fallbackReason) contextParts.push(`reason="${entry.context.fallbackReason}"`)

    const contextStr = contextParts.length > 0 ? ` { ${contextParts.join(', ')} }` : ''

    const message = `${prefix}${traceInfo}${providerInfo}${contextStr}`

    switch (entry.level) {
      case 'error':
        console.error(message)
        break
      case 'warn':
        console.warn(message)
        break
      default:
        console.log(message)
    }
  }

  private async persistToDatabase(entry: UploadLogEntry): Promise<void> {
    try {


      await prisma.uploadLog.create({
        data: {
          event: entry.event,
          level: entry.level,
          uploadId: entry.context.uploadId,
          itemId: entry.context.itemId,
          shopId: entry.context.shopId,
          provider: entry.context.provider,
          traceId: entry.traceId,
          context: entry.context as any,
          createdAt: new Date(entry.timestamp),
        },
      })
    } catch {
      // Table might not exist yet, just log to console
      // This is expected during initial setup
    }
  }
}


export const uploadLogger = UploadLogger.getInstance()








export function createErrorContext(
  error: unknown,
  additionalContext?: Record<string, unknown>
): UploadLogContext['error'] {
  if (error instanceof Error) {
    return {
      code: (error as any).code || 'UNKNOWN',
      message: error.message,
      status: (error as any).status || (error as any).statusCode,
      details: {
        name: error.name,
        stack: error.stack?.split('\n').slice(0, 5).join('\n'),
        ...additionalContext,
      },
    }
  }

  if (typeof error === 'string') {
    return {
      code: 'STRING_ERROR',
      message: error,
      details: additionalContext,
    }
  }

  return {
    code: 'UNKNOWN',
    message: String(error),
    details: additionalContext,
  }
}




export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}




export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}
