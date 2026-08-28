import { createBattleState, type BattleEvent } from '@/game/battle/reducer'
import { mon } from '@/game/battle/testFixtures'
import { compileBattleCues } from './compileBattleCues'
import { LegacyNormalAttackCueHandler, type BattleCuePorts } from './cueHandlers'
import { presentationAbortError, RealPresentationClock } from './PresentationClock'
import type { CueContext, PresentationClock } from './contracts'

function normalCue() {
  const before = createBattleState([mon()], [mon()])
  const event: BattleEvent = {
    type: 'damageApplied', attackerSide: 'player', attackerIndex: 0,
    targetSide: 'foe', targetIndex: 0, amount: 10, missed: false,
    crit: false, effectiveness: 1, effectivenessText: null,
    hpBefore: 100, hpAfter: 90, maxHp: 100,
  }
  const cue = compileBattleCues({
    kind: 'turn', token: { battleSessionId: 'b', presentationId: 1 },
    before, input: { type: 'ATTACK' }, events: [event],
  })[0]
  if (!cue || cue.kind !== 'normal-attack') throw new Error('fixture did not compile')
  return cue
}

function ports(call: (name: string, context: CueContext) => Promise<void> | void): BattleCuePorts {
  return {
    scene: {
      begin: (_cue, ctx) => call('scene.begin', ctx),
      impact: (_cue, ctx) => call('scene.impact', ctx),
      reaction: (_cue, ctx) => call('scene.reaction', ctx),
      hitStop: (_cue, ctx) => call('scene.hitStop', ctx),
      clear: (_cue, ctx) => call('scene.clear', ctx),
    },
    hud: {
      showMove: (_cue, ctx) => call('hud.showMove', ctx),
      applyDamage: (_cue, ctx) => call('hud.applyDamage', ctx),
      showResult: (_cue, ctx) => call('hud.showResult', ctx),
      clear: (_cue, ctx) => call('hud.clear', ctx),
    },
    audio: {
      playAttack: (_cue, ctx) => call('audio.attack', ctx),
      playImpact: (_cue, ctx) => call('audio.impact', ctx),
      playMoveSound: (_cue, ctx) => call('audio.move', ctx),
    },
    haptic: { impact: (_cue, ctx) => call('haptic.impact', ctx) },
    legacy: { play: (_cue, ctx) => call('legacy', ctx) },
  }
}

class ImmediateClock implements PresentationClock {
  constructor(private readonly log: string[], private readonly signals: AbortSignal[]) {}
  wait(ms: number, signal: AbortSignal): Promise<void> {
    this.log.push(`wait:${ms}`)
    this.signals.push(signal)
    return Promise.resolve()
  }
  race<T>(work: PromiseLike<T>, signal: AbortSignal): Promise<T> {
    this.signals.push(signal)
    return new RealPresentationClock().race(work, signal)
  }
}

class SelectiveClock implements PresentationClock {
  private count = 0
  constructor(private readonly blockedWait: number) {}
  wait(ms: number, signal: AbortSignal): Promise<void> {
    void ms
    this.count += 1
    if (this.count !== this.blockedWait) return Promise.resolve()
    return new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(presentationAbortError(signal.reason)), { once: true })
    })
  }
  race<T>(work: PromiseLike<T>, signal: AbortSignal): Promise<T> {
    return new RealPresentationClock().race(work, signal)
  }
}

describe('LegacyNormalAttackCueHandler', () => {
  it('keeps legacy choreography order/timing and passes one context signal everywhere', async () => {
    const log: string[] = []
    const signals: AbortSignal[] = []
    const controller = new AbortController()
    const clock = new ImmediateClock(log, signals)
    const context = { token: { battleSessionId: 'b', presentationId: 1 }, signal: controller.signal, clock }
    const handler = new LegacyNormalAttackCueHandler(ports((name, ctx) => {
      log.push(name)
      signals.push(ctx.signal)
    }))

    await handler.play(normalCue(), context)

    expect(log).toEqual([
      'scene.begin', 'hud.showMove', 'audio.attack', 'wait:440',
      'scene.impact', 'hud.applyDamage', 'scene.reaction', 'audio.impact',
      'audio.move', 'haptic.impact', 'scene.hitStop', 'hud.showResult', 'wait:820',
      'scene.clear', 'hud.clear', 'wait:140',
    ])
    expect(signals.length).toBeGreaterThan(0)
    expect(signals.every((signal) => signal === controller.signal)).toBe(true)
  })

  it.each([
    ['440ms windup', new SelectiveClock(1)],
    ['820ms result', new SelectiveClock(2)],
  ])('aborts promptly during %s', async (_label, clock) => {
    const controller = new AbortController()
    const handler = new LegacyNormalAttackCueHandler(ports(() => undefined))
    const playing = handler.play(normalCue(), {
      token: { battleSessionId: 'b', presentationId: 1 }, signal: controller.signal, clock,
    })
    await Promise.resolve()
    await Promise.resolve()
    controller.abort('unmount')
    await expect(playing).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('aborts an adapter-owned dynamic impact delay without an unhandled rejection', async () => {
    const controller = new AbortController()
    const clock = new ImmediateClock([], [])
    let rejectImpact: ((error: unknown) => void) | undefined
    const dynamic = new Promise<void>((_resolve, reject) => { rejectImpact = reject })
    const handler = new LegacyNormalAttackCueHandler(ports((name) => name === 'scene.impact' ? dynamic : undefined))
    const playing = handler.play(normalCue(), {
      token: { battleSessionId: 'b', presentationId: 1 }, signal: controller.signal, clock,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    controller.abort('unmount')
    await expect(playing).rejects.toMatchObject({ name: 'AbortError' })
    rejectImpact?.(new Error('late adapter rejection'))
    await Promise.resolve()
  })
})
