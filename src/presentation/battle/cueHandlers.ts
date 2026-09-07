import type {
  BattleCue,
  BattleCueHandler,
  CueContext,
  DamageCue,
} from './contracts'
import type { BattleCuePorts } from './BattleCuePorts'
import { playEventChoreography } from './eventChoreography'

export type { BattleCuePorts } from './BattleCuePorts'

async function invoke(work: Promise<void> | void, context: CueContext): Promise<void> {
  await context.clock.race(Promise.resolve(work), context.signal)
}

function assertNever(value: never): never {
  throw new Error(`Unhandled battle cue: ${JSON.stringify(value)}`)
}

export class BattleEventCueHandler implements BattleCueHandler {
  constructor(private readonly ports: BattleCuePorts) {}

  async play(cue: BattleCue, context: CueContext): Promise<void> {
    switch (cue.kind) {
      case 'battle-event': await playEventChoreography(cue, context, this.ports.event); return
      case 'intentional-noop': return
      case 'star-prelude': await invoke(this.ports.action.starPrelude(cue, context), context); return
      case 'chain-prelude': await invoke(this.ports.action.chainPrelude(cue, context), context); return
      case 'chain-cleanup': await invoke(this.ports.action.chainCleanup(cue, context), context); return
      case 'battle-outcome': await invoke(this.ports.action.outcome(cue, context), context); return
      case 'damage': await this.playDamage(cue, context); return
      default: return assertNever(cue)
    }
  }

  private async playDamage(cue: DamageCue, context: CueContext): Promise<void> {
    await invoke(this.ports.scene.begin(cue, context), context)
    await invoke(this.ports.hud.showMove(cue, context), context)
    await invoke(this.ports.audio.playAttack(cue, context), context)
    await context.clock.wait(cue.timing.windupMs, context.signal)

    await invoke(this.ports.scene.impact(cue, context), context)
    await invoke(this.ports.hud.applyDamage(cue, context), context)
    await invoke(this.ports.scene.reaction(cue, context), context)
    await invoke(this.ports.audio.playImpact(cue, context), context)
    await invoke(this.ports.audio.playMoveSound(cue, context), context)
    await invoke(this.ports.haptic.impact(cue, context), context)
    await invoke(this.ports.scene.hitStop(cue, context), context)
    await invoke(this.ports.hud.showResult(cue, context), context)
    await context.clock.wait(cue.timing.resultMs, context.signal)

    await invoke(this.ports.scene.clear(cue, context), context)
    await invoke(this.ports.hud.clear(cue, context), context)
    await context.clock.wait(cue.timing.clearMs, context.signal)
  }
}
