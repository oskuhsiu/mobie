import type { MoveRecipe } from './moveRecipe'
import type { BattleEvent, BattleState, Side } from '@/game/battle/reducer'
import type { ReplayInput } from '@/game/replay/types'
import type { BattleMobie, Move, TerrainId } from '@/game/types'

export interface BattleSessionToken {
  battleSessionId: string
  resultFingerprint: string
}

interface PresentationTokenBase extends BattleSessionToken {
  presentationId: number
}

export interface TurnPresentationToken extends PresentationTokenBase {
  purpose: 'turn'
}

export interface IntentPresentationToken extends PresentationTokenBase {
  purpose: 'intent'
  intentId: BattleIntent['id']
}

export type PresentationToken = TurnPresentationToken | IntentPresentationToken

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
  token: TurnPresentationToken
  before: BattleState
  input: TurnInput
  events: readonly BattleEvent[]
  battleSeed: string
  turn: number
}

export interface IntentFeedEntry {
  id: string
  message: string
}

export type BattleFeedKind = 'system' | 'event' | 'result' | 'warning'

/** Renderer-independent, full-session battle history projection. */
export interface BattleFeedEntry {
  id: string
  kind: BattleFeedKind
  text: string
  announce: boolean
}

export interface IntroIntentSection {
  banner: string
  feed: readonly IntentFeedEntry[]
}

export interface IntroIntent {
  kind: 'intro'
  id: 'intro'
  foeEntrance: IntentFeedEntry
  playerEntrance: IntentFeedEntry
  terrain: IntroIntentSection | null
  synergy: IntroIntentSection | null
}

export type PartnerResultEffect = 'reveal-foe' | 'team-status'

export interface PartnerSkillResultIntent {
  kind: 'partner-result'
  id: `partner:${string}`
  skillId: string
  banner: string
  feed: IntentFeedEntry
  effects: readonly PartnerResultEffect[]
}

export type BattleIntent = IntroIntent | PartnerSkillResultIntent

export interface BattleUnitView {
  instanceId: string
  side: Side
  slot: number
  speciesId: number
  artworkUrl: string
  displayName: string
  level: number
  hp: number
  maxHp: number
  shiny: boolean
  heldItemId?: string
  abilityId?: string
}

export interface StatusView {
  stat: 'atk' | 'def' | 'spa' | 'spd'
  multiplier: number
  remaining: number
  source: number
  label: string
}

export interface FieldMarkView {
  key: string
  label: string
  icon: string
  remaining: number
}

export interface BattleDisplaySnapshot {
  player: { members: readonly BattleUnitView[]; activeIndex: number }
  foe: { members: readonly BattleUnitView[]; activeIndex: number }
  terrainIds: readonly TerrainId[]
  sideStatuses: { player: readonly StatusView[]; foe: readonly StatusView[] }
  fieldMarks: readonly FieldMarkView[]
}

export interface IntentPresentationJob {
  kind: 'intent'
  token: IntentPresentationToken
  intent: BattleIntent
  snapshot: BattleDisplaySnapshot
  visualSeed: string
}

export type PresentationJob = TurnPresentationJob | IntentPresentationJob

export interface PresentationClock {
  wait(ms: number, signal: AbortSignal): Promise<void>
  race<T>(work: PromiseLike<T>, signal: AbortSignal): Promise<T>
}

export interface PausablePresentationClock extends PresentationClock {
  pause(): void
  resume(): void
}

export interface CueContext {
  token: TurnPresentationToken
  signal: AbortSignal
  clock: PresentationClock
}

export interface IntentCueContext {
  token: IntentPresentationToken
  signal: AbortSignal
  clock: PresentationClock
}

export interface PresentationContext {
  token: PresentationToken
  signal: AbortSignal
  clock: PresentationClock
}

export interface DamageTiming {
  windupMs: number
  resultMs: number
  clearMs: number
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
  normalAttack: boolean
  tracerRecipe: 'physical' | 'electric' | null
  presentation: MoveRecipe
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
export type IntentSkipSource = 'touch' | 'enter' | 'escape'
export type IntentSubmissionResult = PresentationResult | 'skipped' | 'ignored' | 'failed'
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
  present(job: PresentationJob, signal: AbortSignal): Promise<PresentationResult>
}

export interface BattleTurnDirectorPort {
  present(job: TurnPresentationJob, signal: AbortSignal): Promise<PresentationResult>
}

export interface BattleTransactionPort {
  begin(token: TurnPresentationToken, before: BattleState, input: TurnInput): void
  isCurrent(token: TurnPresentationToken): boolean
  commit(token: TurnPresentationToken, resolution: TurnResolution): boolean
  cancel(token: TurnPresentationToken, reason: CancelReason): void
  resolveFailed?(token: TurnPresentationToken, error: unknown): void
  recordFailed?(token: TurnPresentationToken, error: unknown): void
}

export interface BattleIntentPresenterPort {
  present(job: IntentPresentationJob, signal: AbortSignal): Promise<PresentationResult>
}

export interface BattleIntentTransactionPort {
  begin(intent: BattleIntent): IntentPresentationToken | null
  isCurrent(token: IntentPresentationToken): boolean
  completeOnce(token: IntentPresentationToken): boolean
  cancelOnce(token: IntentPresentationToken, reason: CancelReason): boolean
}
