import { describe, expect, it, vi } from 'vitest'
import type { BattleSessionToken, TurnPresentationToken } from '@/presentation/battle/contracts'
import { BattleBgmSession } from './battleBgmSession'

const battle = (id: string): BattleSessionToken => ({
  battleSessionId: id,
  resultFingerprint: `fingerprint-${id}`,
})

describe('BattleBgmSession', () => {
  it('establishes a new owner before resetting intensity and is idempotent per battle', () => {
    const observedOwners: Array<BattleSessionToken | null> = []
    let session: BattleBgmSession
    const adapter = {
      setIntensity: vi.fn(() => observedOwners.push(session.snapshot().owner)),
      pauseBgm: vi.fn(),
      resumeBgm: vi.fn(),
    }
    session = new BattleBgmSession(adapter)
    const a = battle('A')

    session.acquire(a)
    session.acquire(a)

    expect(adapter.setIntensity).toHaveBeenCalledTimes(1)
    expect(observedOwners).toEqual([a])
  })

  it('treats presentations in the same battle as one owner', () => {
    const adapter = { setIntensity: vi.fn(), pauseBgm: vi.fn(), resumeBgm: vi.fn() }
    const session = new BattleBgmSession(adapter)
    const token: TurnPresentationToken = { ...battle('A'), presentationId: 3, purpose: 'turn' }
    const nextPresentation: TurnPresentationToken = { ...token, presentationId: 4 }

    session.acquire(token)
    expect(session.set(nextPresentation, 0.75)).toBe(true)

    expect(adapter.setIntensity).toHaveBeenLastCalledWith(0.75)
    expect(session.snapshot()).toEqual({ owner: battle('A'), intensity: 0.75, paused: false })
  })

  it('makes late A set, pause, resume, and release inert after B acquires', () => {
    const adapter = { setIntensity: vi.fn(), pauseBgm: vi.fn(), resumeBgm: vi.fn() }
    const session = new BattleBgmSession(adapter)
    const a = battle('A')
    const b = battle('B')

    session.acquire(a)
    session.pause(a)
    session.acquire(b)
    const callsAfterB = {
      intensity: adapter.setIntensity.mock.calls.length,
      pause: adapter.pauseBgm.mock.calls.length,
      resume: adapter.resumeBgm.mock.calls.length,
    }
    expect(session.set(a, 1)).toBe(false)
    session.pause(a)
    session.resume(a)
    session.release(a)

    expect(adapter.setIntensity).toHaveBeenCalledTimes(callsAfterB.intensity)
    expect(adapter.pauseBgm).toHaveBeenCalledTimes(callsAfterB.pause)
    expect(adapter.resumeBgm).toHaveBeenCalledTimes(callsAfterB.resume)
    expect(session.snapshot()).toEqual({ owner: b, intensity: 0, paused: false })
  })

  it('releases the current battle to neutral exactly once', () => {
    const adapter = { setIntensity: vi.fn(), pauseBgm: vi.fn(), resumeBgm: vi.fn() }
    const session = new BattleBgmSession(adapter)
    const a = battle('A')

    session.acquire(a)
    session.set(a, 0.8)
    session.pause(a)
    session.release(a)
    session.release(a)

    expect(adapter.setIntensity.mock.calls).toEqual([[0], [0.8], [0]])
    expect(adapter.pauseBgm).toHaveBeenCalledTimes(1)
    expect(adapter.resumeBgm).toHaveBeenCalledTimes(1)
    expect(session.snapshot()).toEqual({ owner: null, intensity: 0, paused: false })
  })
})
