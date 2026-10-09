import { afterEach, describe, expect, it, vi } from 'vitest'
import { imageCommandEnvironment, runImageCommand } from './imageProcess.server'

afterEach(() => vi.unstubAllEnvs())

describe('untrusted image command environment', () => {
  it('keeps native paths/fonts/locale and fixed limits, not application credentials', () => {
    const environment = imageCommandEnvironment({
      PATH: '/usr/bin', HOME: '/tmp', TMPDIR: '/tmp', LANG: 'en_US.UTF-8',
      SystemRoot: 'C:\\Windows', ComSpec: 'C:\\Windows\\System32\\cmd.exe',
      FONTCONFIG_PATH: '/etc/fonts', GS_LIB: '/usr/share/ghostscript', MAGICK_CONFIGURE_PATH: '/etc/ImageMagick-6',
      MAGICK_MEMORY_LIMIT: 'unlimited', SHOPIFY_API_SECRET: 'secret', R2_SECRET_ACCESS_KEY: 'secret',
      DATABASE_URL: 'secret', REDIS_URL: 'secret', PUBLIC_OPERATIONS_TOKEN: 'secret', NODE_OPTIONS: '--inspect',
    })
    expect(environment).toMatchObject({ PATH: '/usr/bin', HOME: '/tmp', LANG: 'en_US.UTF-8', FONTCONFIG_PATH: '/etc/fonts', GS_LIB: '/usr/share/ghostscript', MAGICK_CONFIGURE_PATH: '/etc/ImageMagick-6', MAGICK_MEMORY_LIMIT: '512MiB', MAGICK_THREAD_LIMIT: '2' })
    for (const key of ['SHOPIFY_API_SECRET', 'R2_SECRET_ACCESS_KEY', 'DATABASE_URL', 'REDIS_URL', 'PUBLIC_OPERATIONS_TOKEN', 'NODE_OPTIONS']) expect(environment[key]).toBeUndefined()
  })
  it('a spawned shell cannot see the parent app secret', async () => {
    vi.stubEnv('SHOPIFY_API_SECRET', 'decoder-must-not-see-this-test-value')
    const command = process.platform === 'win32' ? 'echo %SHOPIFY_API_SECRET%' : 'printf "%s" "$SHOPIFY_API_SECRET"'
    const result = await runImageCommand(command, { timeout: 2000 })
    expect(result.stdout).not.toContain('decoder-must-not-see-this-test-value')
  })
})
