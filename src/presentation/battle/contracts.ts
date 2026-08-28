import type { BattleEvent, BattleState, Side } from '@/game/battle/reducer'
import type { ReplayInput } from '@/game/replay/types'
import type { BattleMobie, Move } from '@/game/types'

export interface BattleSessionToken {
  battleSessionId: string
  resultFingerprint: string
}

export interface PresentationToken extends BattleSessionToken {
  presentationId: number
}

export type TurnInput = ReplayInput

export type EnergyCommitPolicy =
  | { kind: 'gain'; delta: number; dealtDamage: boolean }
  | { kind: 'reset' }
  | { kind: 'unchanged' }

export interface TurnCommitMeta {
  energy: EnergyCommitPolicy
  lockedIndex: number | null | 'unchanged'
  combo: number | null | 'unchanged'
  outcome: {
    winner: Side
    outcome: 'win' | 'lose'
    reason?: 'timeout'
  } | null
}

export interface TurnResolution {
  before: BattleState
  input: TurnInput
  events: readonly BattleEvent[]
  nextState: BattleState
  battleSeed: string
  turn: number
  rngCalls: number
  commitMeta: TurnCommitMeta
}

export interface TurnPresentationJob {
  kind: 'turn'
  token: PresentationToken
  before: BattleState
  input: TurnInput
  events: readonly BattleEvent[]
  battleSeed: string
  turn: number
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

export interface DamageTiming {
  windupMs: 440
  resultMs: 820
  clearMs: 140
}

export interface DamageCue {
  kind: 'damage'
  id: string
  eventIndex: number
  event: Extract<BattleEvent, { type: 'damageApplied' }>
  attacker: BattleMobie
  defender: BattleMobie
  attackerSide: Side
  defenderSide: Side
  move: Move
  timing: DamageTiming
}

type NarrowLegacyEvent =
  | Exclude<BattleEvent, { type: 'damageApplied' | 'battleEnded' | 'random' }>
  | (Omit<Extract<BattleEvent, { type: 'random' }>, 'event'> & {
      event: Extract<BattleEvent, { type: 'random' }>['event'] & { type: 'supportRoulette' }
    })

export interface LegacyBattleCue {
  kind: 'legacy-event'
  id: string
  eventIndex: number
  before: BattleState
  event: NarrowLegacyEvent
}

export interface IntentionalNoopCue {
  kind: 'intentional-noop'
  id: string
  eventIndex: number
  event: Extract<BattleEvent, { type: 'random' }>
}

export interface StarPreludeCue {
  kind: 'star-prelude'
  id: 'input:star-prelude'
}

export interface ChainPreludeCue {
  kind: 'chain-prelude'
  id: 'input:chain-prelude'
  timingMs: 420
}

export interface ChainCleanupCue {
  kind: 'chain-cleanup'
  id: 'input:chain-cleanup'
  timingMs: 180
}

export interface BattleOutcomeCue {
  kind: 'battle-outcome'
  id: string
  eventIndex: number
  event: Extract<BattleEvent, { type: 'battleEnded' }>
}

export type BattleCue =
  | DamageCue
  | LegacyBattleCue
  | IntentionalNoopCue
  | StarPreludeCue
  | ChainPreludeCue
  | ChainCleanupCue
  | BattleOutcomeCue

export type CancelReason = 'unmount' | 'superseded' | 'stale' | 'skip' | 'context-lost'
export type PresentationResult = 'completed' | 'degraded' | 'cancelled'
export type TurnSubmissionResult = PresentationResult | 'ignored' | 'failed'
export type TryRecordStatus = 'recorded' | 'already-recorded' | 'disabled' | 'failed'

export interface DamageScenePort {
  begin(cue: DamageCue, context: CueContext): Promise<void> | void
  impact(cue: DamageCue, context: CueContext): Promise<void> | void
  reaction(cue: DamageCue, context: CueContext): Promise<void> | void
  hitStop(cue: DamageCue, context: CueContext): Promise<void> | void
  clear(cue: DamageCue, context: CueContext): Promise<void> | void
}

export interface DamageHudPort {
  showMove(cue: DamageCue, context: CueContext): Promise<void> | void
  applyDamage(cue: DamageCue, context: CueContext): Promise<void> | void
  showResult(cue: DamageCue, context: CueContext): Promise<void> | void
  clear(cue: DamageCue, context: CueContext): Promise<void> | void
}

export interface DamageAudioPort {
  playAttack(cue: DamageCue, context: CueContext): Promise<void> | void
  playImpact(cue: DamageCue, context: CueContext): Promise<void> | void
  playMoveSound(cue: DamageCue, context: CueContext): Promise<void> | void
}

export interface DamageHapticPort {
  impact(cue: DamageCue, context: CueContext): Promise<void> | void
}

export interface LegacyEventPort {
  play(cue: LegacyBattleCue, context: CueContext): Promise<void> | void
}

export interface BattleActionPort {
  starPrelude(cue: StarPreludeCue, context: CueContext): Promise<void> | void
  chainPrelude(cue: ChainPreludeCue, context: CueContext): Promise<void> | void
  chainCleanup(cue: ChainCleanupCue, context: CueContext): Promise<void> | void
  outcome(cue: BattleOutcomeCue, context: CueContext): Promise<void> | void
}

export interface BattleCueHandler {
  play(cue: BattleCue, context: CueContext): Promise<void>
}

export interface BattleDirectorPort {
  present(job: TurnPresentationJob, signal: AbortSignal): Promise<PresentationResult>
}

export interface BattleTransactionPort {
  begin(token: PresentationToken, before: BattleState, input: TurnInput): void
  isCurrent(token: PresentationToken): boolean
  commit(token: PresentationToken, resolution: TurnResolution): boolean
  cancel(token: PresentationToken, reason: CancelReason): void
  resolveFailed?(token: PresentationToken, error: unknown): void
}
