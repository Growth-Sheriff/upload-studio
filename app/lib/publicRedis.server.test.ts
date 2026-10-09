import { describe, expect, it } from 'vitest'
import { publicRedisUrl } from './publicRedis.server'
describe('single public Redis database', () => {
  it('uses DB0 with credentials and TLS preserved and refuses tenant indices', () => {
    expect(publicRedisUrl('rediss://app:secret@cache.example:6379')).toBe('rediss://app:secret@cache.example:6379/0')
    expect(() => publicRedisUrl('redis://cache.example/7')).toThrow('database 0')
  })
})
