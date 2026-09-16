const SAMPLE_FINGERPRINT = /^v1-\d+-[a-f0-9]{64}$/
const FULL_FINGERPRINT = /^v2-full-\d+-[a-f0-9]{64}$/

export function normalizeUploadFingerprint(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return SAMPLE_FINGERPRINT.test(value) || FULL_FINGERPRINT.test(value) ? value : null
}

/** Only a digest over every byte may suppress the actual upload. The legacy
 * v1 fingerprint hashes the first/last 1 MB and can collide for revised
 * artwork whose middle changed. It remains useful for multipart resume but is
 * never proof that the stored production file is identical. */
export function canReuseUploadByFingerprint(value: string | null): boolean {
  return Boolean(value && FULL_FINGERPRINT.test(value))
}
