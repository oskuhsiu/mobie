import type {
  BattleCue,
  BattleCueHandler,
  CueContext,
  NormalAttackCue,
} from './contracts'
import type { LegacyPresentationPorts } from './legacy/LegacyPresentationPorts'

export type BattleCuePorts = LegacyPresentationPorts

async function invoke(work: Promise<void> | void, context: CueContext): Promise<void> {
  await context.clock.race(Promise.resolve(work), context.signal)
}

export class LegacyNormalAttackCueHandler implements BattleCueHandler {
  constructor(private readonly ports: BattleCuePorts) {}

  async play(cue: BattleCue, context: CueContext): Promise<void> {
    if (cue.kind === 'legacy-event') {
      await invoke(this.ports.legacy.play(cue, context), context)
      return
    }
    await this.playNormalAttack(cue, context)
  }

  private async playNormalAttack(cue: NormalAttackCue, context: CueContext): Promise<void> {
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
