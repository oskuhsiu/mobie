// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { renderGameJourney } from '@/test/renderGameJourney'
import { useBattleStore } from '@/store/battleStore'
import { useSettings } from '@/store/settingsStore'
import type { NormalAttackCue } from '@/scene/battle/contracts'
import type { VfxCue } from '@/scene/r3f/vfxRuntime'

const scene = vi.hoisted(() => ({
  tracer: vi.fn<(cue: VfxCue) => boolean>(),
  normalAttack: vi.fn<(cue: NormalAttackCue) => void>(),
  hitReact: vi.fn(),
  playMoveFx: vi.fn(() => 0),
}))

vi.mock('@/audio/audioEngine', () => ({
  audio: {
    play: vi.fn(), unlock: vi.fn().mockResolvedValue(undefined), setIntensity: vi.fn(),
    pauseBgm: vi.fn(), resumeBgm: vi.fn(), cancelBattleSfx: vi.fn(),
    pauseBattleSfx: vi.fn(), resumeBattleSfx: vi.fn(), playMoveSound: vi.fn(),
    starChargeSweep: vi.fn(), starStampTick: vi.fn(), starImpactBoom: vi.fn(),
  },
}))
vi.mock('@/input/haptics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/input/haptics')>()
  return { ...actual, haptic: vi.fn(), vibrate: vi.fn() }
})
vi.mock('@/scene/fx/fxCatalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/scene/fx/fxCatalog')>()
  return { ...actual, playMoveFx: scene.playMoveFx }
})
vi.mock('@/scene/battle/host/BattleSceneHost', async () => {
  const { forwardRef, useEffect, useImperativeHandle } = await import('react')
  return {
    BattleSceneHost: forwardRef((props: any, ref) => {
      useImperativeHandle(ref, () => ({
        tracer: scene.tracer,
        normalAttack: scene.normalAttack,
        lunge: vi.fn(),
        hitReact: scene.hitReact,
        faint: vi.fn(),
        enter: vi.fn(),
        setTimeScale: vi.fn(),
        resetPresentation: vi.fn(),
        projectAnchor: (_side: string, _anchor: string, viewport: { width: number, height: number }) => ({
          x: viewport.width / 2,
          y: viewport.height / 2,
        }),
      }))
      useEffect(() => {
        props.onStateChange(props.sessionToken, {
          attemptId: `${props.sessionToken.battleSessionId}:${props.sessionToken.resultFingerprint}:renderer`,
          phase: 'next-ready', requested: props.preference, tier: 'balanced', dprCap: 1,
          fallbackReason: null,
        })
      }, [props.onStateChange, props.preference, props.sessionToken])
      return <div aria-label="battle-stage" />
    }),
  }
})
vi.mock('@/scene/fx/FxCanvas', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return {
    FxCanvas: forwardRef((_props, ref) => {
      useImperativeHandle(ref, () => ({
        burst: vi.fn(), ring: vi.fn(), flash: vi.fn(), travel: vi.fn(),
        converge: vi.fn(), shockwave: vi.fn(), clear: vi.fn(),
      }))
      return <div aria-label="battle-effects" />
    }),
  }
})
vi.mock('@/scene/fx/WeatherCanvas', () => ({ WeatherCanvas: () => null }))
vi.mock('@/ui/components/DamageNumbers', async () => {
  const { forwardRef } = await import('react')
  return { DamageNumbers: forwardRef(() => null) }
})

describe('battle world VFX fallback', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    scene.tracer.mockReset()
    scene.normalAttack.mockReset()
    scene.hitReact.mockReset()
    scene.playMoveFx.mockClear()
    scene.tracer.mockImplementation((cue) => cue.phase !== 'impact')
    useSettings.getState().setJuice('full')
    useSettings.getState().setInteractMode('off')
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('falls back once when world impact rejects and delays hit reaction until physical contact', async () => {
    renderGameJourney({
      state: 'battle',
      context: {
        regionId: 'practice',
        playerTeam: [
          { cardId: 'physical-player', speciesId: 16, level: 16 },
          { cardId: 'player-2', speciesId: 25, level: 16 },
          { cardId: 'player-3', speciesId: 133, level: 16 },
        ],
        foeTeam: [
          { cardId: 'physical-foe', speciesId: 1, level: 10 },
          { cardId: 'foe-2', speciesId: 7, level: 10 },
          { cardId: 'foe-3', speciesId: 10, level: 10 },
        ],
      },
    })
    vi.spyOn(screen.getByLabelText('戰鬥場景'), 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, width: 800, height: 600, top: 0, right: 800, bottom: 600, left: 0,
      toJSON: () => ({}),
    } as DOMRect)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
      fireEvent.click(screen.getByRole('button', { name: '跳過開場' }))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(useBattleStore.getState().phase).toBe('playerChoice')

    fireEvent.click(screen.getByRole('button', { name: /撞擊/ }))
    fireEvent.pointerDown(screen.getByRole('button', { name: /10秒內點擊任意處/ }))
    await act(async () => { await vi.advanceTimersByTimeAsync(2_801) })

    for (let elapsed = 0; elapsed < 3_000 && scene.playMoveFx.mock.calls.length === 0; elapsed += 50) {
      await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    }

    expect(scene.tracer.mock.calls.map(([cue]) => cue.phase).slice(0, 3))
      .toEqual(['anticipate', 'cast', 'impact'])
    expect(scene.playMoveFx).toHaveBeenCalledTimes(1)

    const phases = scene.normalAttack.mock.calls.map(([cue]) => cue.phase)
    expect(phases.indexOf('travel')).toBeGreaterThan(phases.indexOf('anticipate'))
    expect(phases.indexOf('contact')).toBeGreaterThan(phases.indexOf('travel'))

    await act(async () => { await vi.advanceTimersByTimeAsync(640) })
    const reactedPhases = scene.normalAttack.mock.calls.map(([cue]) => cue.phase)
    expect(reactedPhases.indexOf('hit-react')).toBeGreaterThan(reactedPhases.indexOf('contact'))
  })
})
