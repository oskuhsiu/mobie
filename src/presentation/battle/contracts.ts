import type { BattleEvent, BattleState, Side } from '@/game/battle/reducer'
import type { ReplayInput } from '@/game/replay/types'
import type { BattleMobie, Move } from '@/game/types'

export interface BattleSessionToken {
  battleSessionId: string
}

export interface PresentationToken extends BattleSessionToken {
  presentationId: number
}

export type NormalAttackInput = Omit<Extract<ReplayInput, { type: 'ATTACK' }>, 'starStrike'> & {
  starStrike?: false
}

export interface TurnResolution {
  before: BattleState
  input: NormalAttackInput
  events: readonly BattleEvent[]
  nextState: BattleState
  commitMeta: {
    energyDelta: number
    dealtDamage: boolean
    lockedIndex: null
  }
}

export interface TurnPresentationJob {
  kind: 'turn'
  token: PresentationToken
  before: BattleState
  input: NormalAttackInput
  events: readonly BattleEvent[]
}

export interface PresentationClock {
  wait(ms: number, signal: AbortSignal): Promise<void>
  race<T>(work: PromiseLike<T>, signal: AbortSignal): Promise<T>
}

export interface CueContext {
  token: PresentationToken
  signal: AbortSignal
  clock: PresentationClock
}

export interface NormalAttackTiming {
  windupMs: 440
  resultMs: 820
  clearMs: 140
}

export interface NormalAttackCue {
  kind: 'normal-attack'
  id: string
  eventIndex: number
  event: Extract<BattleEvent, { type: 'damageApplied' }>
  attacker: BattleMobie
  defender: BattleMobie
  attackerSide: Side
  defenderSide: Side
  move: Move
  timing: NormalAttackTiming
}

export type LegacyEventCue = {
  [Type in Exclude<BattleEvent['type'], 'damageApplied'>]: {
    kind: 'legacy-event'
    id: string
    eventIndex: number
    before: BattleState
    event: Extract<BattleEvent, { type: Type }>
  }
}[Exclude<BattleEvent['type'], 'damageApplied'>]

export type BattleCue = NormalAttackCue | LegacyEventCue

export type CancelReason = 'unmount' | 'superseded' | 'stale' | 'skip' | 'context-lost'
export type PresentationResult = 'completed' | 'degraded' | 'cancelled'
export type TurnSubmissionResult = PresentationResult | 'ignored' | 'failed'

export interface NormalAttackScenePort {
  begin(cue: NormalAttackCue, context: CueContext): Promise<void> | void
  impact(cue: NormalAttackCue, context: CueContext): Promise<void> | void
  reaction(cue: NormalAttackCue, context: CueContext): Promise<void> | void
  hitStop(cue: NormalAttackCue, context: CueContext): Promise<void> | void
  clear(cue: NormalAttackCue, context: CueContext): Promise<void> | void
}

export interface NormalAttackHudPort {
  showMove(cue: NormalAttackCue, context: CueContext): Promise<void> | void
  applyDamage(cue: NormalAttackCue, context: CueContext): Promise<void> | void
  showResult(cue: NormalAttackCue, context: CueContext): Promise<void> | void
  clear(cue: NormalAttackCue, context: CueContext): Promise<void> | void
}

export interface NormalAttackAudioPort {
  playAttack(cue: NormalAttackCue, context: CueContext): Promise<void> | void
  playImpact(cue: NormalAttackCue, context: CueContext): Promise<void> | void
  playMoveSound(cue: NormalAttackCue, context: CueContext): Promise<void> | void
}

export interface NormalAttackHapticPort {
  impact(cue: NormalAttackCue, context: CueContext): Promise<void> | void
}

export interface LegacyEventPort {
  play(cue: LegacyEventCue, context: CueContext): Promise<void> | void
}

export interface BattleCueHandler {
  play(cue: BattleCue, context: CueContext): Promise<void>
}

export interface BattleDirectorPort {
  present(job: TurnPresentationJob, signal: AbortSignal): Promise<PresentationResult>
}

export interface BattleTransactionPort {
  begin(token: PresentationToken, before: BattleState): void
  isCurrent(token: PresentationToken): boolean
  commit(token: PresentationToken, resolution: TurnResolution): void
  cancel(token: PresentationToken, reason: CancelReason): void
  resolveFailed?(token: PresentationToken, error: unknown): void
  recordFailed?(token: PresentationToken, error: unknown): void
}
