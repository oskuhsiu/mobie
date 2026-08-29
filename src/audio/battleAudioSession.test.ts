import { describe, expect, it, vi } from 'vitest'
import type { PresentationToken } from '@/presentation/battle/contracts'
import { BattleAudioSession } from './battleAudioSession'

const turn = (battleSessionId: string, presentationId: number): PresentationToken => ({
  battleSessionId,
  resultFingerprint: `fingerprint-${battleSessionId}`,
  presentationId,
  purpose: 'turn',
})

const adapter = () => ({
  cancelBattleSfx: vi.fn(),
  pauseBattleSfx: vi.fn(),
  resumeBattleSfx: vi.fn(),
})

describe('BattleAudioSession', () => {
  it('owns one full presentation token and gates sounds while paused', () => {
    const output = adapter()
    const session = new BattleAudioSession(output)
    const token = turn('A', 1)
    const play = vi.fn()

    session.begin(token)
    session.begin(token)
    expect(session.play(token, play)).toBe(true)
    session.pause(token)
    session.pause(token)
    expect(session.play(token, play)).toBe(false)
    session.resume(token)
    session.resume(token)
    expect(session.play(token, play)).toBe(true)

    expect(play).toHaveBeenCalledTimes(2)
    expect(output.cancelBattleSfx).not.toHaveBeenCalled()
    expect(output.pauseBattleSfx).toHaveBeenCalledOnce()
    expect(output.resumeBattleSfx).toHaveBeenCalledOnce()
    expect(session.snapshot()).toEqual({ owner: token, paused: false })
  })

  it('makes every late A call inert after B begins', () => {
    const output = adapter()
    const session = new BattleAudioSession(output)
    const a = turn('A', 1)
    const b = turn('B', 1)
    const latePlay = vi.fn()

    session.begin(a)
    session.begin(b)
    session.pause(a)
    session.resume(a)
    session.cancel(a)
    expect(session.play(a, latePlay)).toBe(false)
    session.release(a)

    expect(output.cancelBattleSfx).toHaveBeenCalledTimes(1)
    expect(latePlay).not.toHaveBeenCalled()
    expect(session.snapshot()).toEqual({ owner: b, paused: false })
  })

  it('distinguishes presentation purpose and identity within one battle', () => {
    const session = new BattleAudioSession(adapter())
    const active: PresentationToken = {
      battleSessionId: 'A', resultFingerprint: 'fingerprint-A', presentationId: 2,
      purpose: 'intent', intentId: 'intro',
    }
    const collision: PresentationToken = { ...active, intentId: 'partner:test' }

    session.begin(active)
    expect(session.play(collision, vi.fn())).toBe(false)
  })

  it('releases a successful presentation without cutting its final sound', () => {
    const output = adapter()
    const session = new BattleAudioSession(output)
    const token = turn('A', 1)
    session.begin(token)

    session.complete(token)

    expect(output.cancelBattleSfx).not.toHaveBeenCalled()
    expect(session.snapshot()).toEqual({ owner: null, paused: false })
  })

  it('gates current-owner callbacks without exposing the owner token', () => {
    const session = new BattleAudioSession(adapter())
    const play = vi.fn()
    expect(session.playCurrent(play)).toBe(false)
    session.begin(turn('A', 1))
    expect(session.playCurrent(play)).toBe(true)
    expect(play).toHaveBeenCalledOnce()
  })
})
