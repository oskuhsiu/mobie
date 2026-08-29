import { describe, expect, it, vi } from 'vitest'
import {
  createBattleIdentity,
  sameBattleSession,
  samePresentationToken,
  type BattleIdentityCrypto,
} from './battleIdentity'

describe('createBattleIdentity', () => {
  it('asks Web Crypto for two independent UUIDs', () => {
    const randomUUID = vi.fn()
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222')
    const crypto = { randomUUID, getRandomValues: vi.fn() } as unknown as BattleIdentityCrypto

    expect(createBattleIdentity(crypto)).toEqual({
      battleSessionId: '11111111-1111-4111-8111-111111111111',
      resultFingerprint: '22222222-2222-4222-8222-222222222222',
    })
    expect(randomUUID).toHaveBeenCalledTimes(2)
  })

  it('falls back to two independent 128-bit random byte arrays', () => {
    const arrays: Uint8Array[] = []
    const crypto: BattleIdentityCrypto = {
      getRandomValues: <T extends ArrayBufferView>(array: T): T => {
        const bytes = array as unknown as Uint8Array
        arrays.push(bytes)
        bytes.fill(arrays.length === 1 ? 0x0a : 0xf1)
        return array
      },
    }

    expect(createBattleIdentity(crypto)).toEqual({
      battleSessionId: '0a'.repeat(16),
      resultFingerprint: 'f1'.repeat(16),
    })
    expect(arrays).toHaveLength(2)
    expect(arrays[0]).not.toBe(arrays[1])
    expect(arrays.every((bytes) => bytes.byteLength === 16)).toBe(true)
  })
})

describe('battle identity predicates', () => {
  const session = { battleSessionId: 'battle', resultFingerprint: 'fingerprint' }

  it('requires both session identity fields', () => {
    expect(sameBattleSession(session, session)).toBe(true)
    expect(sameBattleSession({ ...session, resultFingerprint: 'collision' }, session)).toBe(false)
  })

  it('also distinguishes purpose and intent identity for presentations', () => {
    const intro = { ...session, presentationId: 1, purpose: 'intent' as const, intentId: 'intro' as const }
    expect(samePresentationToken(intro, intro)).toBe(true)
    expect(samePresentationToken({ ...intro, intentId: 'partner:test' }, intro)).toBe(false)
    expect(samePresentationToken({ ...session, presentationId: 1, purpose: 'turn' }, intro)).toBe(false)
  })
})
