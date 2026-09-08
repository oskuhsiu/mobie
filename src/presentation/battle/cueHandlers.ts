import type {
  BattleCue,
  BattleCueHandler,
  CueContext,
  DamageCue,
} from './contracts'
import type { BattleCuePorts } from './BattleCuePorts'
import { playEventChoreography } from './eventChoreography'
import { playChainCleanup, playChainPrelude, playOutcome, playStarChoreography } from './actionChoreography'
import { invokePresentationPort } from './presentationPort'

export type { BattleCuePorts } from './BattleCuePorts'

function assertNever(value: never): never {
  throw new Error(`Unhandled battle cue: ${JSON.stringify(value)}`)
}

export class BattleEventCueHandler implements BattleCueHandler {
  constructor(private readonly ports: BattleCuePorts) {}

  async play(cue: BattleCue, context: CueContext): Promise<void> {
    switch (cue.kind) {
      case 'battle-event': await playEventChoreography(cue, context, this.ports.event); return
      case 'intentional-noop': return
      case 'star-prelude': await playStarChoreography(cue, context, this.ports.action); return
      case 'chain-prelude': await playChainPrelude(cue, context, this.ports.action); return
      case 'chain-cleanup': await playChainCleanup(cue, context, this.ports.action); return
      case 'battle-outcome': await playOutcome(cue, context, this.ports.action); return
      case 'damage': await this.playDamage(cue, context); return
      default: return assertNever(cue)
    }
  }

  private async playDamage(cue: DamageCue, context: CueContext): Promise<void> {
    await invokePresentationPort(this.ports.scene.begin(cue, context), context)
    await invokePresentationPort(this.ports.hud.showMove(cue, context), context)
    await invokePresentationPort(this.ports.audio.playAttack(cue, context), context)
    await context.clock.wait(cue.timing.windupMs, context.signal)

    await invokePresentationPort(this.ports.scene.impact(cue, context), context)
    await invokePresentationPort(this.ports.hud.applyDamage(cue, context), context)
    await invokePresentationPort(this.ports.scene.reaction(cue, context), context)
    await invokePresentationPort(this.ports.audio.playImpact(cue, context), context)
    await invokePresentationPort(this.ports.audio.playMoveSound(cue, context), context)
    await invokePresentationPort(this.ports.haptic.impact(cue, context), context)
    await invokePresentationPort(this.ports.scene.hitStop(cue, context), context)
    await invokePresentationPort(this.ports.hud.showResult(cue, context), context)
    await context.clock.wait(cue.timing.resultMs, context.signal)

    await invokePresentationPort(this.ports.scene.clear(cue, context), context)
    await invokePresentationPort(this.ports.hud.clear(cue, context), context)
    await context.clock.wait(cue.timing.clearMs, context.signal)
  }
}
