import { createBattleState, type BattleEvent } from '@/game/battle/reducer'
import { mon } from '@/game/battle/testFixtures'
import { compileBattleCues } from './compileBattleCues'
import { LegacyBattleCueHandler, type BattleCuePorts } from './cueHandlers'
import { presentationAbortError, RealPresentationClock } from './PresentationClock'
import type { BattleCue, CueContext, PresentationClock } from './contracts'

const token = { battleSessionId: 'b', resultFingerprint: 'f', presentationId: 1, purpose: 'turn' as const }

function damageCue() {
  const before = createBattleState([mon()], [mon()])
  const event: BattleEvent = {
    type: 'damageApplied', attackerSide: 'player', attackerIndex: 0,
    targetSide: 'foe', targetIndex: 0, amount: 10, missed: false,
    crit: false, effectiveness: 1, effectivenessText: null,
    hpBefore: 100, hpAfter: 90, maxHp: 100,
  }
  const cue = compileBattleCues({
    kind: 'turn', token, before, input: { type: 'ATTACK' }, events: [event],
    battleSeed: 'seed', turn: 1,
  })[0]
  if (!cue || cue.kind !== 'damage') throw new Error('fixture did not compile')
  return cue
}

function ports(call: (name: string, context: CueContext) => Promise<void> | void): BattleCuePorts {
  return {
    scene: {
      begin: (_cue, ctx) => call('scene.begin', ctx), impact: (_cue, ctx) => call('scene.impact', ctx),
      reaction: (_cue, ctx) => call('scene.reaction', ctx), hitStop: (_cue, ctx) => call('scene.hitStop', ctx),
      clear: (_cue, ctx) => call('scene.clear', ctx),
    },
    hud: {
      showMove: (_cue, ctx) => call('hud.showMove', ctx), applyDamage: (_cue, ctx) => call('hud.applyDamage', ctx),
      showResult: (_cue, ctx) => call('hud.showResult', ctx), clear: (_cue, ctx) => call('hud.clear', ctx),
    },
    audio: {
      playAttack: (_cue, ctx) => call('audio.attack', ctx), playImpact: (_cue, ctx) => call('audio.impact', ctx),
      playMoveSound: (_cue, ctx) => call('audio.move', ctx),
    },
    haptic: { impact: (_cue, ctx) => call('haptic.impact', ctx) },
    legacy: { play: (_cue, ctx) => call('legacy', ctx) },
    action: {
      starPrelude: (_cue, ctx) => call('star', ctx), chainPrelude: (_cue, ctx) => call('chain.prelude', ctx),
      chainCleanup: (_cue, ctx) => call('chain.cleanup', ctx), outcome: (_cue, ctx) => call('outcome', ctx),
    },
  }
}

class ImmediateClock implements PresentationClock {
  constructor(private readonly log: string[], private readonly signals: AbortSignal[]) {}
  wait(ms: number, signal: AbortSignal): Promise<void> {
    this.log.push(`wait:${ms}`); this.signals.push(signal); return Promise.resolve()
  }
  race<T>(work: PromiseLike<T>, signal: AbortSignal): Promise<T> {
    this.signals.push(signal); return new RealPresentationClock().race(work, signal)
  }
}

class SelectiveClock implements PresentationClock {
  private count = 0
  constructor(private readonly blockedWait: number) {}
  wait(_ms: number, signal: AbortSignal): Promise<void> {
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

describe('LegacyBattleCueHandler', () => {
  it('keeps damage choreography order/timing and passes one signal everywhere', async () => {
    const log: string[] = []
    const signals: AbortSignal[] = []
    const controller = new AbortController()
    const clock = new ImmediateClock(log, signals)
    const context = { token, signal: controller.signal, clock }
    const handler = new LegacyBattleCueHandler(ports((name, ctx) => { log.push(name); signals.push(ctx.signal) }))

    await handler.play(damageCue(), context)

    expect(log).toEqual([
      'scene.begin', 'hud.showMove', 'audio.attack', 'wait:440',
      'scene.impact', 'hud.applyDamage', 'scene.reaction', 'audio.impact',
      'audio.move', 'haptic.impact', 'scene.hitStop', 'hud.showResult', 'wait:820',
      'scene.clear', 'hud.clear', 'wait:140',
    ])
    expect(signals.length).toBeGreaterThan(0)
    expect(signals.every((signal) => signal === controller.signal)).toBe(true)
  })

  it('routes action, legacy and outcome cues through the same context and skips intentional no-op', async () => {
    const log: string[] = []
    const signals: AbortSignal[] = []
    const controller = new AbortController()
    const context = { token, signal: controller.signal, clock: new ImmediateClock(log, signals) }
    const handler = new LegacyBattleCueHandler(ports((name, ctx) => { log.push(name); signals.push(ctx.signal) }))
    const before = createBattleState([mon()], [mon()])
    const cues: BattleCue[] = [
      { kind: 'star-prelude', id: 'input:star-prelude' },
      { kind: 'chain-prelude', id: 'input:chain-prelude', timingMs: 420 },
      { kind: 'legacy-event', id: 'event:0:memberFainted', eventIndex: 0, before, event: { type: 'memberFainted', side: 'foe', index: 0 } },
      { kind: 'intentional-noop', id: 'event:1:random:crit', eventIndex: 1, event: { type: 'random', event: { type: 'crit', actorId: 'p', roll: 0, outcome: 'crit', source: 'x' } } },
      { kind: 'chain-cleanup', id: 'input:chain-cleanup', timingMs: 180 },
      { kind: 'battle-outcome', id: 'event:2:battleEnded', eventIndex: 2, event: { type: 'battleEnded', winner: 'player' } },
    ]
    for (const cue of cues) await handler.play(cue, context)
    expect(log).toEqual(['star', 'chain.prelude', 'legacy', 'chain.cleanup', 'outcome'])
    expect(signals.every((signal) => signal === controller.signal)).toBe(true)
  })

  it.each([
    ['440ms windup', new SelectiveClock(1)],
    ['820ms result', new SelectiveClock(2)],
  ])('aborts promptly during %s', async (_label, clock) => {
    const controller = new AbortController()
    const handler = new LegacyBattleCueHandler(ports(() => undefined))
    const playing = handler.play(damageCue(), { token, signal: controller.signal, clock })
    await Promise.resolve(); await Promise.resolve()
    controller.abort('unmount')
    await expect(playing).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('absorbs a late adapter rejection after cancellation', async () => {
    const controller = new AbortController()
    let rejectImpact: ((error: unknown) => void) | undefined
    const dynamic = new Promise<void>((_resolve, reject) => { rejectImpact = reject })
    const handler = new LegacyBattleCueHandler(ports((name) => name === 'scene.impact' ? dynamic : undefined))
    const playing = handler.play(damageCue(), {
      token, signal: controller.signal, clock: new ImmediateClock([], []),
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    controller.abort('unmount')
    await expect(playing).rejects.toMatchObject({ name: 'AbortError' })
    rejectImpact?.(new Error('late adapter rejection'))
    await Promise.resolve()
  })
})
