import { describe, expect, it } from 'vitest'
import { classifyResultIdentity } from './resultIdentity'

describe('classifyResultIdentity', () => {
  const incoming = { resultId: 'battle-a', resultFingerprint: 'fingerprint-a' }

  it('classifies an absent or different result id as new', () => {
    expect(classifyResultIdentity(null, incoming)).toBe('new')
    expect(classifyResultIdentity(
      { resultId: 'battle-b', resultFingerprint: 'fingerprint-a' },
      incoming,
    )).toBe('new')
  })

  it('classifies the same id and fingerprint as the same result', () => {
    expect(classifyResultIdentity({ ...incoming }, incoming)).toBe('same-result')
  })

  it('treats a reused id with a different fingerprint as a collision', () => {
    expect(classifyResultIdentity(
      { resultId: 'battle-a', resultFingerprint: 'fingerprint-old' },
      incoming,
    )).toBe('collision')
  })
})
