import { create } from 'zustand'
import { projectEventField } from '@/presentation/battle/eventProjection'
import type { BattleMobie, TerrainId } from '@/game/types'
import { createBattleState, upsertStatus, type BattleEvent, type BattleState, type Side, type SupportOutcome, type StatusEffect } from '@/game/battle/reducer'
import type { DisplayUnitSnapshot, ReplayInput, ReplayTurn } from '@/game/replay/types'
import { ReplayRecorder } from '@/store/replayRecorder'
import {
  createBattleIdentity,
  sameBattleSession,
  samePresentationToken,
} from '@/presentation/battle/battleIdentity'
import type {
  BattleFeedEntry,
  BattleIntent,
  BattleSessionToken,
  IntentFeedEntry,
  IntentPresentationToken,
  TurnPresentationToken,
  TryRecordStatus,
  TurnInput,
  TurnResolution,
} from '@/presentation/battle/contracts'
import type { RendererFallbackReason } from '@/presentation/battle/rendering'

export type { Side }

export type BattlePhase =
  | 'intro' | 'playerChoice' | 'qte' | 'mash'
  | 'statusQte' // M19.d 變化招：輕量強度 QTE（只影響效果強度、不影響成敗；無 mash）
  | 'switchSelect' | 'defenseQte'
  | 'chainQte' // M9 連鎖：對 eligible 隊友依序跑連續 QTE
  | 'starQte'
  | 'busy' | 'error' | 'won' | 'lost'

export interface BattleCommandNotice {
  kind: 'forced-switch' | 'outcome' | 'timeout'
  text: string
}

export interface BattleRuntimeError {
  kind: 'resolve' | 'init'
  message: string
  detail: string
  requestId: number
}

/** 一次受擊的視覺效果（低頻：每次攻擊一次，走 React state 沒問題） */
export interface HitFx {
  target: Side
  amount: number
  crit: boolean
  effText: string | null
  missed: boolean
  id: number
}

export interface BattlePresentationProjection {
  token: TurnPresentationToken
  battle: BattleState
  log: BattleFeedEntry[]
  banner: string | null
  hitFx: HitFx | null
  support: SupportOutcome | null
  combo: number | null
  energy: number
  chain: number
  lockedIndex: number | null
  fxCounter: number
  activeResource: 'star' | 'chain' | null
  commandNotice: BattleCommandNotice | null
}

export interface BattleIntentPresentation {
  token: IntentPresentationToken
  intent: BattleIntent
  baseLog: BattleFeedEntry[]
  log: BattleFeedEntry[]
  banner: string | null
  safePointFeed: readonly IntentFeedEntry[]
}

export type InterruptedBattleIntent = Pick<
  BattleIntentPresentation,
  'token' | 'intent' | 'baseLog' | 'safePointFeed'
>

export interface BattleFeedInput {
  id: string
  text: string
  kind?: BattleFeedEntry['kind']
  announce?: boolean
}

const currentSession = (
  session: BattleRuntimeSession | null,
  token: BattleSessionToken,
): session is BattleRuntimeSession => Boolean(session && !session.retired && sameBattleSession(session.token, token))

const errorDetail = (error: unknown): string => error instanceof Error ? error.message : String(error)

const cloneBattle = (battle: BattleState): BattleState => ({
  ...battle,
  player: { ...battle.player, members: [...battle.player.members] },
  foe: { ...battle.foe, members: [...battle.foe.members] },
})

function safePointFeedOf(intent: BattleIntent): readonly IntentFeedEntry[] {
  switch (intent.kind) {
    case 'intro':
      return [
        intent.foeEntrance,
        intent.playerEntrance,
        ...(intent.terrain?.feed ?? []),
        ...(intent.synergy?.feed ?? []),
      ]
    case 'partner-result': return [intent.feed]
    case 'switch-prelude': return []
  }
}

function appendFeedEntries(
  log: readonly BattleFeedEntry[],
  entries: readonly BattleFeedEntry[],
): BattleFeedEntry[] {
  const ids = new Set(log.map((entry) => entry.id))
  return entries.reduce<BattleFeedEntry[]>((current, entry) => {
    if (ids.has(entry.id)) return current
    ids.add(entry.id)
    return [...current, entry]
  }, [...log])
}

function presentationFeedEntry(
  token: TurnPresentationToken | IntentPresentationToken,
  input: BattleFeedInput,
): BattleFeedEntry {
  return {
    id: `${token.battleSessionId}:${token.resultFingerprint}:${token.purpose}:${token.presentationId}:${input.id}`,
    kind: input.kind ?? 'event',
    text: input.text,
    announce: input.announce ?? true,
  }
}

function sessionFeedEntry(token: BattleSessionToken, input: BattleFeedInput): BattleFeedEntry {
  return {
    id: `${token.battleSessionId}:${token.resultFingerprint}:session:${input.id}`,
    kind: input.kind ?? 'event',
    text: input.text,
    announce: input.announce ?? true,
  }
}

function appendIntentFeed(
  log: readonly BattleFeedEntry[],
  token: IntentPresentationToken,
  feed: readonly IntentFeedEntry[],
): BattleFeedEntry[] {
  return appendFeedEntries(log, feed.map((entry) => presentationFeedEntry(token, {
    id: entry.id,
    text: entry.message,
    kind: 'system',
  })))
}

export interface BattleSessionInit {
  logicalBattleKey: object
  playerMembers: BattleMobie[]
  foeMembers: BattleMobie[]
  terrains?: TerrainId[]
  battleSeed: string
  regionId: string
  mode: 'arena' | 'wild'
  recordReplay: boolean
  snapshot: DisplayUnitSnapshot[]
  createdAt: number
  forceNew?: boolean
  attemptToken?: BattleSessionToken
  identityFactory?: () => BattleSessionToken
}

export interface BattleSessionAttempt {
  logicalBattleKey: object
  battleSeed: string
  identityFactory?: () => BattleSessionToken
}

export interface BattleRuntimeSession {
  logicalBattleKey: object
  token: BattleSessionToken
  nextPresentationId: number
  endSent: boolean
  battleSeed: string
  rngCursor: number
  recorder: ReplayRecorder
  recordedPresentationIds: ReadonlySet<number>
  pendingReplay: { presentationId: number; turn: ReplayTurn } | null
  replayWarningShown: boolean
  replayFinished: boolean
  completedIntentIds: ReadonlySet<BattleIntent['id']>
  partnerSkillIdsUsed: ReadonlySet<string>
  interruptedIntent: InterruptedBattleIntent | null
  rendererFallbackReason: RendererFallbackReason | null
  retired: boolean
}

function settleIntentSafePoint(
  session: BattleRuntimeSession,
  choiceFocusRequestId: number,
  presentation: InterruptedBattleIntent,
) {
  const completedIntentIds = new Set(session.completedIntentIds)
  completedIntentIds.add(presentation.intent.id)
  return {
    phase: 'playerChoice' as const,
    log: appendIntentFeed(presentation.baseLog, presentation.token, presentation.safePointFeed),
    banner: null,
    choiceFocusRequestId: choiceFocusRequestId + 1,
    session: { ...session, completedIntentIds, interruptedIntent: null },
  }
}

function createRuntimeSession({
  logicalBattleKey,
  token,
  battleSeed,
  recorder,
}: Pick<BattleRuntimeSession, 'logicalBattleKey' | 'token' | 'battleSeed' | 'recorder'>): BattleRuntimeSession {
  return {
    logicalBattleKey,
    token,
    nextPresentationId: 1,
    endSent: false,
    battleSeed,
    rngCursor: 0,
    recorder,
    recordedPresentationIds: new Set(),
    pendingReplay: null,
    replayWarningShown: false,
    replayFinished: false,
    completedIntentIds: new Set(),
    partnerSkillIdsUsed: new Set(),
    interruptedIntent: null,
    rendererFallbackReason: null,
    retired: false,
  }
}

export interface BattleSessionEnsureResult {
  created: boolean
  token: BattleSessionToken
  battleSeed: string
}

export type CommitTurnResult =
  | { committed: true; outcome: TurnResolution['commitMeta']['outcome'] }
  | { committed: false }

export interface PartnerSkillGameplayCommit {
  skillId: string
  revealFoeIndex?: number
  teamStatuses: readonly StatusEffect[]
}

export interface PartnerSkillCommitReceipt {
  skillId: string
  revealedFoeIndex: number | null
  teamStatusCount: number
}

interface BattleUiState {
  /** canonical 戰鬥態；turn coordinator 只在 presentation 完成後原子提交。 */
  battle: BattleState | null
  phase: BattlePhase
  log: BattleFeedEntry[]
  banner: string | null
  hitFx: HitFx | null
  fxCounter: number
  captured: boolean | null
  /** 支援輪盤結果 overlay（null=不顯示） */
  support: SupportOutcome | null
  /** 星擊能量槽 0..100（只由 QTE 表現+連鎖累積，不綁隨機） */
  energy: number
  /** 連鎖：連續命中回合數 */
  chain: number
  /** M9 連鎖連段數 overlay（null=不顯示；連鎖中各段 chainHit 設定） */
  combo: number | null
  /** 剛換下的隊員 index；由 turn commit 原子更新。 */
  lockedIndex: number | null
  /** M16/M17：已看穿的對手隊員 index（MobCard 對手深度揭露）；M16 恆空，M17 看穿鈕 add。 */
  revealedFoes: number[]
  /** Token-owned presentation shadow; canonical battle stays unchanged until commitTurn. */
  presentation: BattlePresentationProjection | null
  /** Intent-only display shadow. It deliberately contains no battle, energy, recorder, or outcome. */
  intentPresentation: BattleIntentPresentation | null
  /** Monotonic request used by React to restore focus after an intent reaches its safe point. */
  choiceFocusRequestId: number
  battleError: BattleRuntimeError | null
  /** Non-persisted logical battle runtime; survives BattleScreen remounts. */
  session: BattleRuntimeSession | null

  init: (playerMembers: BattleMobie[], foeMembers: BattleMobie[], terrains?: TerrainId[]) => void
  beginSessionAttempt: (attempt: BattleSessionAttempt) => BattleSessionToken
  ensureBattleSession: (init: BattleSessionInit) => BattleSessionEnsureResult
  acquireTurnPresentationToken: () => TurnPresentationToken | null
  isSessionCurrent: (token: BattleSessionToken) => boolean
  latchRendererCompatibility: (token: BattleSessionToken, reason: RendererFallbackReason) => boolean
  fenceSession: (token: BattleSessionToken) => boolean
  failTurnOnce: (token: TurnPresentationToken, error: unknown) => boolean
  recordFailedOnce: (token: TurnPresentationToken, error: unknown) => boolean
  failBattleInit: (error: unknown) => void
  tryRecordTurnOnce: (
    token: TurnPresentationToken,
    input: ReplayInput,
    events: readonly BattleEvent[],
  ) => TryRecordStatus
  finishReplayOnce: (token: TurnPresentationToken, outcome: 'win' | 'lose') => boolean
  markEndSentOnce: (token: TurnPresentationToken) => boolean
  setPhase: (p: BattlePhase) => void
  pushFeed: (entry: BattleFeedInput) => void
  setBanner: (b: string | null) => void
  setSupport: (o: SupportOutcome | null) => void
  /** M17 看穿：標記某對手 index 已揭露（M16 不呼叫；exactly-once 去重）。 */
  revealFoe: (index: number) => void
  /** M17 訓練師加油（support）：開戰一次性灌注全隊增益到 field.teamStatuses（複用 M19.d，reducer 既有消費）。 */
  applyTeamStatuses: (statuses: StatusEffect[]) => void
  commitPartnerSkillOnce: (commit: PartnerSkillGameplayCommit) => PartnerSkillCommitReceipt | null
  setCaptured: (b: boolean) => void
  beginPresentation: (token: TurnPresentationToken, before: BattleState, input: TurnInput) => void
  presentationApplyEvent: (token: TurnPresentationToken, event: BattleEvent) => void
  presentationSetMemberHp: (token: TurnPresentationToken, side: Side, index: number, hp: number) => void
  presentationSetActiveIndex: (token: TurnPresentationToken, side: Side, index: number) => void
  presentationSetBanner: (token: TurnPresentationToken, banner: string | null) => void
  presentationPushFeed: (token: TurnPresentationToken, entry: BattleFeedInput) => void
  presentationShowHit: (token: TurnPresentationToken, fx: Omit<HitFx, 'id'>) => void
  presentationSetSupport: (token: TurnPresentationToken, support: SupportOutcome | null) => void
  presentationSetCombo: (token: TurnPresentationToken, combo: number | null) => void
  presentationSetCommandNotice: (token: TurnPresentationToken, notice: BattleCommandNotice | null) => void
  presentationClearTransient: (token: TurnPresentationToken) => void
  isPresentationCurrent: (token: TurnPresentationToken) => boolean
  commitTurn: (token: TurnPresentationToken, resolution: TurnResolution) => CommitTurnResult
  cancelPresentation: (token: TurnPresentationToken, phase?: BattlePhase) => void
  beginIntentPresentation: (intent: BattleIntent) => IntentPresentationToken | null
  isIntentPresentationCurrent: (token: IntentPresentationToken) => boolean
  intentPushFeed: (token: IntentPresentationToken, entry: IntentFeedEntry) => void
  intentSetBanner: (token: IntentPresentationToken, banner: string | null) => void
  completeIntentOnce: (token: IntentPresentationToken) => boolean
  cancelIntentOnce: (token: IntentPresentationToken, reason: string) => boolean
  completeInterruptedIntentOnce: (token: BattleSessionToken) => boolean
}

export const useBattleStore = create<BattleUiState>((set, get) => ({
  battle: null,
  phase: 'intro',
  log: [],
  banner: null,
  hitFx: null,
  fxCounter: 0,
  captured: null,
  support: null,
  energy: 0,
  chain: 0,
  combo: null,
  lockedIndex: null,
  revealedFoes: [],
  presentation: null,
  intentPresentation: null,
  choiceFocusRequestId: 0,
  battleError: null,
  session: null,

  init: (playerMembers, foeMembers, terrains) =>
    set({
      battle: createBattleState(playerMembers, foeMembers, terrains),
      phase: 'intro', log: [], banner: null,
      hitFx: null, fxCounter: 0, captured: null,
      support: null, energy: 0, chain: 0, combo: null, lockedIndex: null, revealedFoes: [],
      presentation: null, intentPresentation: null, choiceFocusRequestId: 0, battleError: null, session: null,
    }),

  beginSessionAttempt: (attempt) => {
    const token = (attempt.identityFactory ?? createBattleIdentity)()
    const session = createRuntimeSession({
      logicalBattleKey: attempt.logicalBattleKey,
      token,
      battleSeed: attempt.battleSeed,
      recorder: new ReplayRecorder(),
    })
    set({
      presentation: null,
      intentPresentation: null,
      banner: null,
      hitFx: null,
      support: null,
      combo: null,
      session,
    })
    return token
  },

  ensureBattleSession: (init) => {
    const current = get()
    if (
      !init.forceNew
      && current.session?.logicalBattleKey === init.logicalBattleKey
      && !current.session.retired
      && current.battle
    ) {
      return {
        created: false,
        token: current.session.token,
        battleSeed: current.session.battleSeed,
      }
    }

    const attemptSession = init.attemptToken
      && current.session
      && !current.session.retired
      && current.session.logicalBattleKey === init.logicalBattleKey
      && sameBattleSession(current.session.token, init.attemptToken)
      ? current.session
      : null
    const token = attemptSession?.token ?? (init.identityFactory ?? createBattleIdentity)()
    const recorder = attemptSession?.recorder ?? new ReplayRecorder()
    if (init.recordReplay) {
      recorder.start({
        battleSeed: init.battleSeed,
        regionId: init.regionId,
        mode: init.mode,
        snapshot: init.snapshot,
        createdAt: init.createdAt,
      })
    }
    const session = createRuntimeSession({
      logicalBattleKey: init.logicalBattleKey,
      token,
      battleSeed: init.battleSeed,
      recorder,
    })
    set({
      battle: createBattleState(init.playerMembers, init.foeMembers, init.terrains),
      phase: 'intro',
      log: [],
      banner: null,
      hitFx: null,
      fxCounter: 0,
      captured: null,
      support: null,
      energy: 0,
      chain: 0,
      combo: null,
      lockedIndex: null,
      revealedFoes: [],
      presentation: null,
      intentPresentation: null,
      choiceFocusRequestId: 0,
      battleError: null,
      session,
    })
    return { created: true, token, battleSeed: init.battleSeed }
  },

  acquireTurnPresentationToken: () => {
    const state = get()
    const session = state.session
    if (!session || session.retired || state.intentPresentation || state.battleError) return null
    const token: TurnPresentationToken = {
      ...session.token,
      presentationId: session.nextPresentationId,
      purpose: 'turn',
    }
    set({ session: { ...session, nextPresentationId: session.nextPresentationId + 1 } })
    return token
  },

  isSessionCurrent: (token) => {
    const session = get().session
    return currentSession(session, token)
  },

  latchRendererCompatibility: (token, reason) => {
    let latched = false
    set((s) => {
      if (!currentSession(s.session, token) || s.session.rendererFallbackReason) return {}
      latched = true
      return { session: { ...s.session, rendererFallbackReason: reason } }
    })
    return latched
  },

  fenceSession: (token) => {
    let fenced = false
    set((s) => {
      if (!s.session || !sameBattleSession(s.session.token, token)) return {}
      s.session.recorder.disableAfterFailure()
      fenced = true
      return {
        presentation: null,
        intentPresentation: null,
        banner: null,
        hitFx: null,
        support: null,
        combo: null,
        session: { ...s.session, retired: true, pendingReplay: null },
      }
    })
    return fenced
  },

  failTurnOnce: (token, error) => {
    let failed = false
    set((s) => {
      if (!currentSession(s.session, token) || s.battleError) return {}
      if (s.presentation && !samePresentationToken(s.presentation.token, token)) return {}
      failed = true
      return {
        phase: 'error',
        presentation: null,
        intentPresentation: null,
        banner: null,
        hitFx: null,
        support: null,
        combo: null,
        battleError: {
          kind: 'resolve',
          message: '戰鬥處理發生錯誤，請重新開始本場戰鬥。',
          detail: errorDetail(error),
          requestId: 1,
        },
        session: { ...s.session, pendingReplay: null },
      }
    })
    return failed
  },

  recordFailedOnce: (token, error) => {
    let warned = false
    set((s) => {
      if (!currentSession(s.session, token) || s.session.replayWarningShown) return {}
      s.session.recorder.disableAfterFailure()
      const recordedPresentationIds = new Set(s.session.recordedPresentationIds)
      recordedPresentationIds.add(token.presentationId)
      warned = true
      const warning = `⚠️ 本場回放錄製已停用，戰鬥仍會繼續（${errorDetail(error)}）`
      return {
        presentation: s.presentation && samePresentationToken(s.presentation.token, token)
          ? {
              ...s.presentation,
              log: appendFeedEntries(s.presentation.log, [presentationFeedEntry(token, {
                id: 'replay-warning',
                text: warning,
                kind: 'warning',
              })]),
            }
          : s.presentation,
        session: {
          ...s.session,
          recordedPresentationIds,
          pendingReplay: null,
          replayWarningShown: true,
        },
      }
    })
    return warned
  },

  failBattleInit: (error) =>
    set((s) => ({
      phase: 'error',
      presentation: null,
      intentPresentation: null,
      banner: null,
      battleError: {
        kind: 'init',
        message: '戰鬥重新初始化失敗，請再試一次或離開。',
        detail: errorDetail(error),
        requestId: (s.battleError?.requestId ?? 0) + 1,
      },
      session: s.session ? { ...s.session, pendingReplay: null } : null,
    })),

  tryRecordTurnOnce: (token, input, events) => {
    const session = get().session
    if (!currentSession(session, token)) return 'failed'
    if (session.recordedPresentationIds.has(token.presentationId)) return 'already-recorded'
    const result = session.recorder.prepareTurn(input, events)
    const failed = result.status === 'failed'
    let published = false
    let warn = false
    set((s) => {
      if (!currentSession(s.session, token) || s.session.recordedPresentationIds.has(token.presentationId)) return {}
      const recordedPresentationIds = new Set(s.session.recordedPresentationIds)
      recordedPresentationIds.add(token.presentationId)
      warn = failed && !s.session.replayWarningShown
      published = true
      return { session: {
        ...s.session,
        recordedPresentationIds,
        pendingReplay: result.status === 'prepared'
          ? { presentationId: token.presentationId, turn: result.turn }
          : null,
        replayWarningShown: s.session.replayWarningShown || failed,
      } }
    })
    if (!published) return 'failed'
    if (warn) get().presentationPushFeed(token, {
      id: 'replay-warning',
      text: '⚠️ 本場回放錄製已停用，戰鬥仍會繼續',
      kind: 'warning',
    })
    if (result.status === 'prepared') return 'recorded'
    if (result.status === 'failed') return 'failed'
    return 'disabled'
  },

  finishReplayOnce: (token, outcome) => {
    const session = get().session
    if (!currentSession(session, token) || session.replayFinished) return false
    set({ session: { ...session, replayFinished: true } })
    void session.recorder.finish(outcome)
    return true
  },

  markEndSentOnce: (token) => {
    const session = get().session
    if (!currentSession(session, token) || session.endSent) return false
    set({ session: { ...session, endSent: true } })
    return true
  },

  setPhase: (phase) => set({ phase }),
  pushFeed: (entry) => set((s) => !s.session ? {} : ({
    log: appendFeedEntries(s.log, [sessionFeedEntry(s.session.token, entry)]),
  })),
  setBanner: (banner) => set({ banner }),
  setSupport: (support) => set({ support }),
  revealFoe: (index) => set((s) => (s.revealedFoes.includes(index) ? {} : { revealedFoes: [...s.revealedFoes, index] })),
  applyTeamStatuses: (statuses) =>
    set((s) => {
      if (!s.battle || statuses.length === 0) return {}
      // 同 stat 取 max（不疊乘）——與 reducer 變化招同規則，避免加油 + 變化招對同屬性連乘爆表。
      let teamStatuses = s.battle.field.teamStatuses
      for (const st of statuses) teamStatuses = upsertStatus(teamStatuses, st)
      return { battle: { ...s.battle, field: { ...s.battle.field, teamStatuses } } }
    }),

  commitPartnerSkillOnce: (commit) => {
    let receipt: PartnerSkillCommitReceipt | null = null
    set((s) => {
      if (
        !s.session
        || s.session.retired
        || s.battleError
        || !s.battle
        || s.phase !== 'playerChoice'
        || s.presentation
        || s.intentPresentation
        || s.session.partnerSkillIdsUsed.has(commit.skillId)
      ) return {}

      const revealIndex = commit.revealFoeIndex
      if (
        revealIndex !== undefined
        && (!Number.isInteger(revealIndex) || revealIndex < 0 || revealIndex >= s.battle.foe.members.length)
      ) return {}

      let teamStatuses = s.battle.field.teamStatuses
      for (const status of commit.teamStatuses) teamStatuses = upsertStatus(teamStatuses, status)
      const partnerSkillIdsUsed = new Set(s.session.partnerSkillIdsUsed)
      partnerSkillIdsUsed.add(commit.skillId)
      const revealedFoes = revealIndex === undefined || s.revealedFoes.includes(revealIndex)
        ? s.revealedFoes
        : [...s.revealedFoes, revealIndex]
      receipt = {
        skillId: commit.skillId,
        revealedFoeIndex: revealIndex ?? null,
        teamStatusCount: commit.teamStatuses.length,
      }
      return {
        battle: commit.teamStatuses.length > 0
          ? { ...s.battle, field: { ...s.battle.field, teamStatuses } }
          : s.battle,
        revealedFoes,
        session: { ...s.session, partnerSkillIdsUsed },
      }
    })
    return receipt
  },

  setCaptured: (captured) => set({ captured }),

  beginPresentation: (token, before, input) =>
    set((s) => {
      if (!currentSession(s.session, token) || s.battleError) return {}
      if (s.intentPresentation) return {}
      if (s.presentation && !samePresentationToken(s.presentation.token, token)) return {}
      const star = input.type === 'ATTACK' && input.starStrike === true
      const chainInput = input.type === 'CHAIN'
      const projectedBattle = cloneBattle(before)
      if (chainInput) projectedBattle.chainGauge = 0
      return {
        phase: 'busy',
        presentation: {
          token,
          battle: projectedBattle,
          log: [...s.log],
          banner: s.banner,
          hitFx: s.hitFx ? { ...s.hitFx } : null,
          support: s.support,
          combo: s.combo,
          energy: star ? 0 : s.energy,
          chain: star ? 0 : s.chain,
          lockedIndex: s.lockedIndex,
          fxCounter: s.fxCounter,
          activeResource: star ? 'star' : chainInput ? 'chain' : null,
          commandNotice: null,
        },
      }
    }),

  presentationApplyEvent: (token, event) =>
    set((s) => {
      const projection = s.presentation
      if (!projection || !samePresentationToken(projection.token, token)) return {}
      const field = projectEventField(projection.battle, event)
      if (field === projection.battle.field) return {}
      return { presentation: { ...projection, battle: { ...projection.battle, field } } }
    }),

  presentationSetMemberHp: (token, side, index, hp) =>
    set((s) => {
      const projection = s.presentation
      if (!projection || !samePresentationToken(projection.token, token)) return {}
      const sideState = projection.battle[side]
      const members = sideState.members.map((member, memberIndex) =>
        memberIndex === index ? { ...member, currentHp: hp } : member,
      )
      return {
        presentation: {
          ...projection,
          battle: { ...projection.battle, [side]: { ...sideState, members } },
        },
      }
    }),

  presentationSetActiveIndex: (token, side, index) =>
    set((s) => {
      const projection = s.presentation
      if (!projection || !samePresentationToken(projection.token, token)) return {}
      return {
        presentation: {
          ...projection,
          battle: {
            ...projection.battle,
            [side]: { ...projection.battle[side], activeIndex: index },
          },
        },
      }
    }),

  presentationSetBanner: (token, banner) =>
    set((s) => s.presentation && samePresentationToken(s.presentation.token, token)
      ? { presentation: { ...s.presentation, banner } }
      : {}),
  presentationPushFeed: (token, entry) =>
    set((s) => s.presentation && samePresentationToken(s.presentation.token, token)
      ? {
          presentation: {
            ...s.presentation,
            log: appendFeedEntries(s.presentation.log, [presentationFeedEntry(token, entry)]),
          },
        }
      : {}),
  presentationShowHit: (token, fx) =>
    set((s) => {
      const projection = s.presentation
      if (!projection || !samePresentationToken(projection.token, token)) return {}
      const fxCounter = projection.fxCounter + 1
      return { presentation: { ...projection, hitFx: { ...fx, id: fxCounter }, fxCounter } }
    }),
  presentationSetSupport: (token, support) =>
    set((s) => s.presentation && samePresentationToken(s.presentation.token, token)
      ? { presentation: { ...s.presentation, support } }
      : {}),
  presentationSetCombo: (token, combo) =>
    set((s) => s.presentation && samePresentationToken(s.presentation.token, token)
      ? { presentation: { ...s.presentation, combo } }
      : {}),
  presentationSetCommandNotice: (token, commandNotice) =>
    set((s) => s.presentation && samePresentationToken(s.presentation.token, token)
      ? { presentation: { ...s.presentation, commandNotice } }
      : {}),
  presentationClearTransient: (token) =>
    set((s) => s.presentation && samePresentationToken(s.presentation.token, token)
      ? {
          presentation: {
            ...s.presentation,
            banner: null,
            hitFx: null,
            support: null,
            combo: null,
          },
        }
      : {}),
  isPresentationCurrent: (token) => {
    const projection = get().presentation
    return Boolean(projection && samePresentationToken(projection.token, token))
  },
  commitTurn: (token, resolution) => {
    let result: CommitTurnResult = { committed: false }
    const runtimeSession = get().session
    const stagedReplay = currentSession(runtimeSession, token)
      && runtimeSession.pendingReplay?.presentationId === token.presentationId
      ? { recorder: runtimeSession.recorder, turn: runtimeSession.pendingReplay.turn }
      : null
    set((s) => {
      const projection = s.presentation
      if (
        !projection
        || !samePresentationToken(projection.token, token)
        || !currentSession(s.session, token)
        || s.battle !== resolution.before
      ) return {}

      let energy = s.energy
      let chain = s.chain
      if (resolution.commitMeta.energy.kind === 'gain') {
        chain = resolution.commitMeta.energy.dealtDamage ? s.chain + 1 : 0
        const gain = resolution.commitMeta.energy.delta
          + (resolution.commitMeta.energy.dealtDamage ? chain * 4 : 0)
        energy = Math.max(0, Math.min(100, s.energy + gain))
      } else if (resolution.commitMeta.energy.kind === 'reset') {
        energy = 0
        chain = 0
      }
      const lockedIndex = resolution.commitMeta.lockedIndex === 'unchanged'
        ? s.lockedIndex
        : resolution.commitMeta.lockedIndex
      const combo = resolution.commitMeta.combo === 'unchanged'
        ? s.combo
        : resolution.commitMeta.combo
      const outcome = resolution.commitMeta.outcome
      result = { committed: true, outcome }
      return {
        battle: resolution.nextState,
        phase: outcome ? (outcome.winner === 'player' ? 'won' : 'lost') : 'playerChoice',
        log: projection.log,
        choiceFocusRequestId: outcome ? s.choiceFocusRequestId : s.choiceFocusRequestId + 1,
        fxCounter: projection.fxCounter,
        energy,
        chain,
        lockedIndex,
        banner: null,
        hitFx: null,
        support: null,
        combo,
        presentation: null,
        session: {
          ...s.session,
          rngCursor: s.session.rngCursor + resolution.rngCalls,
          pendingReplay: null,
        },
      }
    })
    if (result.committed && stagedReplay) stagedReplay.recorder.commitPrepared(stagedReplay.turn)
    return result
  },
  cancelPresentation: (token, phase = 'playerChoice') =>
    set((s) => {
      if (!s.presentation || !samePresentationToken(s.presentation.token, token)) return {}
      return {
        presentation: null,
        phase,
        banner: null,
        hitFx: null,
        support: null,
        combo: null,
        session: currentSession(s.session, token)
          ? { ...s.session, pendingReplay: null }
          : s.session,
      }
    }),

  beginIntentPresentation: (intent) => {
    let token: IntentPresentationToken | null = null
    set((s) => {
      if (
        !s.session
        || s.session.retired
        || s.battleError
        || !s.battle
        || s.presentation
        || s.intentPresentation
        || s.session.completedIntentIds.has(intent.id)
        || (intent.kind === 'intro'
          ? s.phase !== 'intro'
          : intent.kind === 'switch-prelude' ? s.phase !== 'switchSelect' : s.phase !== 'playerChoice')
        || (intent.kind === 'partner-result' && (
          intent.id !== `partner:${intent.skillId}`
          || !s.session.partnerSkillIdsUsed.has(intent.skillId)
        ))
      ) return {}

      token = {
        ...s.session.token,
        presentationId: s.session.nextPresentationId,
        purpose: 'intent',
        intentId: intent.id,
      }
      return {
        phase: intent.kind === 'intro' ? 'intro' : 'busy',
        intentPresentation: {
          token,
          intent,
          baseLog: [...s.log],
          log: [...s.log],
          banner: null,
          safePointFeed: safePointFeedOf(intent),
        },
        session: { ...s.session, nextPresentationId: s.session.nextPresentationId + 1 },
      }
    })
    return token
  },

  isIntentPresentationCurrent: (token) => {
    const current = get().intentPresentation
    return Boolean(current && samePresentationToken(current.token, token))
  },

  intentPushFeed: (token, entry) =>
    set((s) => s.intentPresentation && samePresentationToken(s.intentPresentation.token, token)
      ? {
          intentPresentation: {
            ...s.intentPresentation,
            log: appendIntentFeed(s.intentPresentation.log, s.intentPresentation.token, [entry]),
          },
        }
      : {}),

  intentSetBanner: (token, banner) =>
    set((s) => s.intentPresentation && samePresentationToken(s.intentPresentation.token, token)
      ? { intentPresentation: { ...s.intentPresentation, banner } }
      : {}),

  completeIntentOnce: (token) => {
    let completed = false
    set((s) => {
      const presentation = s.intentPresentation
      if (
        !presentation
        || !samePresentationToken(presentation.token, token)
        || !currentSession(s.session, token)
        || s.session.completedIntentIds.has(presentation.intent.id)
      ) return {}

      completed = true
      return {
        ...settleIntentSafePoint(s.session, s.choiceFocusRequestId, presentation),
        intentPresentation: null,
      }
    })
    return completed
  },

  cancelIntentOnce: (token) => {
    let cancelled = false
    set((s) => {
      if (
        !s.intentPresentation
        || !samePresentationToken(s.intentPresentation.token, token)
        || !currentSession(s.session, token)
      ) return {}
      cancelled = true
      return {
        intentPresentation: null,
        banner: null,
        session: {
          ...s.session,
          interruptedIntent: {
            token: s.intentPresentation.token,
            intent: s.intentPresentation.intent,
            baseLog: s.intentPresentation.baseLog,
            safePointFeed: s.intentPresentation.safePointFeed,
          },
        },
      }
    })
    return cancelled
  },

  completeInterruptedIntentOnce: (token) => {
    let completed = false
    set((s) => {
      if (!currentSession(s.session, token) || !s.session.interruptedIntent) return {}
      const interrupted = s.session.interruptedIntent
      completed = true
      return settleIntentSafePoint(s.session, s.choiceFocusRequestId, interrupted)
    })
    return completed
  },
}))
