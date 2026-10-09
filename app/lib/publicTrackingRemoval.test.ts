import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name)
    return entry.isDirectory() ? sourceFiles(file) : [file]
  })
}

describe('public source data minimization', () => {
  it('ships no storefront collectors, replay, contact fields or tracking globals', () => {
    const files = [...sourceFiles('extensions/theme-extension'), ...sourceFiles('theme-snippets')]
    for (const file of files.filter(file => /\.(js|liquid)$/.test(file))) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(
        /ULVisitor|ULAnalytics|ULUploadTelemetry|ULRemoteLogger|ShopifyAnalytics|sendBeacon|ipapi\.co|customerEmail|customer\.email|customer\.name|customer\.first_name|customer\.last_name/
      )
    }
    expect(readFileSync('app/entry.client.tsx', 'utf8')).not.toMatch(/replayIntegration|browserTracingIntegration|Sentry/)
  })

  it('deletes person collection endpoints and models but keeps file content hashing', () => {
    for (const file of ['app/routes/api.v1.visitors.tsx', 'app/routes/api.v1.sessions.tsx',
      'app/routes/api.debug.log.tsx', 'app/lib/visitor.server.ts', 'workers/telemetry.worker.ts']) {
      expect(existsSync(file), file).toBe(false)
    }
    expect(readFileSync('prisma/schema.prisma', 'utf8')).not.toMatch(/model Visitor|visitorId|visitorSessions/)
    expect(existsSync('app/lib/uploadFingerprint.ts')).toBe(true)
    expect(readFileSync('extensions/theme-extension/assets/ul-file-probe.js', 'utf8')).toContain('fingerprint: fingerprint')
  })
})
