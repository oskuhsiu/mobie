import type { BattleIntentHandler } from './BattleDirector'
import type {
  IntentCueContext,
  IntentFeedEntry,
  IntroIntent,
  IntentPresentationJob,
  PartnerSkillResultIntent,
  PartnerResultEffect,
} from './contracts'

export interface BattleIntentDisplayPort {
  prepareSwitch?(context: IntentCueContext): void
  frameSwitch?(context: IntentCueContext): void
  setBanner(message: string | null, context: IntentCueContext): Promise<void> | void
  appendFeed(entry: IntentFeedEntry, context: IntentCueContext): Promise<void> | void
  playPartnerEffect(effect: PartnerResultEffect, context: IntentCueContext): Promise<void> | void
}

export interface BattleIntentPresenterOptions {
  display: BattleIntentDisplayPort
}

function assertNever(value: never): never {
  throw new Error(`Unhandled battle intent: ${JSON.stringify(value)}`)
}

export class BattleIntentPresenter implements BattleIntentHandler {
  private readonly display: BattleIntentDisplayPort

  constructor(options: BattleIntentPresenterOptions) {
    this.display = options.display
  }

  async play(job: IntentPresentationJob, context: IntentCueContext): Promise<void> {
    switch (job.intent.kind) {
      case 'switch-prelude':
        context.signal.throwIfAborted()
        this.display.prepareSwitch?.(context)
        await context.clock.wait(300, context.signal)
        context.signal.throwIfAborted()
        this.display.frameSwitch?.(context)
        await context.clock.wait(120, context.signal)
        break
      case 'intro':
        await this.playIntro(job.intent, context)
        break
      case 'partner-result':
        await this.playPartnerResult(job.intent, context)
        break
      default: assertNever(job.intent)
    }
  }

  private async playIntro(intent: IntroIntent, context: IntentCueContext): Promise<void> {
    await context.clock.wait(700, context.signal)
    await this.invoke(this.display.appendFeed(intent.foeEntrance, context), context)
    await context.clock.wait(280, context.signal)
    await this.invoke(this.display.appendFeed(intent.playerEntrance, context), context)

    const sections = [
      { section: intent.terrain, holdMs: 1100 },
      { section: intent.synergy, holdMs: 1000 },
    ] as const
    for (const { section, holdMs } of sections) {
      if (!section) continue
      await context.clock.wait(220, context.signal)
      await this.invoke(this.display.setBanner(section.banner, context), context)
      for (const entry of section.feed) {
        await this.invoke(this.display.appendFeed(entry, context), context)
      }
      await context.clock.wait(holdMs, context.signal)
      await this.invoke(this.display.setBanner(null, context), context)
      await context.clock.wait(140, context.signal)
    }
  }

  private async playPartnerResult(intent: PartnerSkillResultIntent, context: IntentCueContext): Promise<void> {
    await this.invoke(this.display.setBanner(intent.banner, context), context)
    await this.invoke(this.display.appendFeed(intent.feed, context), context)
    for (const effect of intent.effects) {
      await this.invoke(this.display.playPartnerEffect(effect, context), context)
    }
    await context.clock.wait(1500, context.signal)
    await this.invoke(this.display.setBanner(null, context), context)
  }

  private async invoke(work: Promise<void> | void, context: IntentCueContext): Promise<void> {
    await context.clock.race(Promise.resolve(work), context.signal)
  }
}
