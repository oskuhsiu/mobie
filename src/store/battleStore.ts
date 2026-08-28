import { create } from 'zustand'
import type { BattleMobie, TerrainId } from '@/game/types'
import { createBattleState, upsertStatus, type BattleEvent, type BattleState, type Side, type SupportOutcome, type StatusEffect } from '@/game/battle/reducer'
import type { DisplayUnitSnapshot, ReplayInput, ReplayTurn } from '@/game/replay/types'
import { ReplayRecorder } from '@/store/replayRecorder'
import { createBattleIdentity } from '@/presentation/battle/battleIdentity'
import type {
  BattleSessionToken,
  PresentationToken,
  TryRecordStatus,
  TurnInput,
  TurnResolution,
} from '@/presentation/battle/contracts'

export type { Side }

export type BattlePhase =
  | 'intro' | 'playerChoice' | 'qte' | 'mash'
  | 'statusQte' // M19.d 變化招：輕量強度 QTE（只影響效果強度、不影響成敗；無 mash）
  | 'switchSelect' | 'defenseQte'
  | 'chainQte' // M9 連鎖：對 eligible 隊友依序跑連續 QTE
  | 'busy' | 'won' | 'lost'

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
  token: PresentationToken
  battle: BattleState
  log: string[]
  banner: string | null
  hitFx: HitFx | null
  support: SupportOutcome | null
  combo: number | null
  energy: number
  chain: number
  lockedIndex: number | null
  fxCounter: number
}

const samePresentation = (left: PresentationToken, right: PresentationToken): boolean =>
  left.battleSessionId === right.battleSessionId
  && left.resultFingerprint === right.resultFingerprint
  && left.presentationId === right.presentationId

const sameSession = (left: BattleSessionToken, right: BattleSessionToken): boolean =>
  left.battleSessionId === right.battleSessionId
  && left.resultFingerprint === right.resultFingerprint

const cloneBattle = (battle: BattleState): BattleState => ({
  ...battle,
  player: { ...battle.player, members: [...battle.player.members] },
  foe: { ...battle.foe, members: [...battle.foe.members] },
})

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
}

export interface BattleSessionEnsureResult {
  created: boolean
  token: BattleSessionToken
  battleSeed: string
}

export type CommitTurnResult =
  | { committed: true; outcome: TurnResolution['commitMeta']['outcome'] }
  | { committed: false }

interface BattleUiState {
  /** canonical 戰鬥態；turn coordinator 只在 presentation 完成後原子提交。 */
  battle: BattleState | null
  phase: BattlePhase
  log: string[]
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
  /** Non-persisted logical battle runtime; survives BattleScreen remounts. */
  session: BattleRuntimeSession | null

  init: (playerMembers: BattleMobie[], foeMembers: BattleMobie[], terrains?: TerrainId[]) => void
  ensureBattleSession: (init: BattleSessionInit) => BattleSessionEnsureResult
  acquirePresentationToken: () => PresentationToken | null
  isSessionCurrent: (token: BattleSessionToken) => boolean
  tryRecordTurnOnce: (
    token: PresentationToken,
    input: ReplayInput,
    events: readonly BattleEvent[],
  ) => TryRecordStatus
  finishReplayOnce: (token: PresentationToken, outcome: 'win' | 'lose') => boolean
  markEndSentOnce: (token: PresentationToken) => boolean
  setPhase: (p: BattlePhase) => void
  pushLog: (msg: string) => void
  setBanner: (b: string | null) => void
  setSupport: (o: SupportOutcome | null) => void
  /** M17 看穿：標記某對手 index 已揭露（M16 不呼叫；exactly-once 去重）。 */
  revealFoe: (index: number) => void
  /** M17 訓練師加油（support）：開戰一次性灌注全隊增益到 field.teamStatuses（複用 M19.d，reducer 既有消費）。 */
  applyTeamStatuses: (statuses: StatusEffect[]) => void
  setCaptured: (b: boolean) => void
  beginPresentation: (token: PresentationToken, before: BattleState, input: TurnInput) => void
  presentationSetMemberHp: (token: PresentationToken, side: Side, index: number, hp: number) => void
  presentationSetActiveIndex: (token: PresentationToken, side: Side, index: number) => void
  presentationSetBanner: (token: PresentationToken, banner: string | null) => void
  presentationPushLog: (token: PresentationToken, message: string) => void
  presentationShowHit: (token: PresentationToken, fx: Omit<HitFx, 'id'>) => void
  presentationSetSupport: (token: PresentationToken, support: SupportOutcome | null) => void
  presentationSetCombo: (token: PresentationToken, combo: number | null) => void
  presentationClearTransient: (token: PresentationToken) => void
  isPresentationCurrent: (token: PresentationToken) => boolean
  commitTurn: (token: PresentationToken, resolution: TurnResolution) => CommitTurnResult
  cancelPresentation: (token: PresentationToken, phase?: BattlePhase) => void
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
  session: null,

  init: (playerMembers, foeMembers, terrains) =>
    set({
      battle: createBattleState(playerMembers, foeMembers, terrains),
      phase: 'intro', log: [], banner: null,
      hitFx: null, fxCounter: 0, captured: null,
      support: null, energy: 0, chain: 0, combo: null, lockedIndex: null, revealedFoes: [],
      presentation: null, session: null,
    }),

  ensureBattleSession: (init) => {
    const current = get()
    if (
      !init.forceNew
      && current.session?.logicalBattleKey === init.logicalBattleKey
      && current.battle
    ) {
      return {
        created: false,
        token: current.session.token,
        battleSeed: current.session.battleSeed,
      }
    }

    const token = (init.identityFactory ?? createBattleIdentity)()
    const recorder = new ReplayRecorder()
    if (init.recordReplay) {
      recorder.start({
        battleSeed: init.battleSeed,
        regionId: init.regionId,
        mode: init.mode,
        snapshot: init.snapshot,
        createdAt: init.createdAt,
      })
    }
    const session: BattleRuntimeSession = {
      logicalBattleKey: init.logicalBattleKey,
      token,
      nextPresentationId: 1,
      endSent: false,
      battleSeed: init.battleSeed,
      rngCursor: 0,
      recorder,
      recordedPresentationIds: new Set(),
      pendingReplay: null,
      replayWarningShown: false,
      replayFinished: false,
    }
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
      session,
    })
    return { created: true, token, battleSeed: init.battleSeed }
  },

  acquirePresentationToken: () => {
    const session = get().session
    if (!session) return null
    const token: PresentationToken = {
      ...session.token,
      presentationId: session.nextPresentationId,
    }
    set({ session: { ...session, nextPresentationId: session.nextPresentationId + 1 } })
    return token
  },

  isSessionCurrent: (token) => {
    const session = get().session
    return Boolean(session && sameSession(session.token, token))
  },

  tryRecordTurnOnce: (token, input, events) => {
    const session = get().session
    if (!session || !sameSession(session.token, token)) return 'failed'
    if (session.recordedPresentationIds.has(token.presentationId)) return 'already-recorded'
    const recordedPresentationIds = new Set(session.recordedPresentationIds)
    recordedPresentationIds.add(token.presentationId)
    const result = session.recorder.prepareTurn(input, events)
    const failed = result.status === 'failed'
    const warn = failed && !session.replayWarningShown
    set({
      session: {
        ...session,
        recordedPresentationIds,
        pendingReplay: result.status === 'prepared'
          ? { presentationId: token.presentationId, turn: result.turn }
          : null,
        replayWarningShown: session.replayWarningShown || failed,
      },
    })
    if (warn) get().presentationPushLog(token, '⚠️ 本場回放錄製已停用，戰鬥仍會繼續')
    if (result.status === 'prepared') return 'recorded'
    if (result.status === 'failed') return 'failed'
    return 'disabled'
  },

  finishReplayOnce: (token, outcome) => {
    const session = get().session
    if (!session || !sameSession(session.token, token) || session.replayFinished) return false
    set({ session: { ...session, replayFinished: true } })
    void session.recorder.finish(outcome)
    return true
  },

  markEndSentOnce: (token) => {
    const session = get().session
    if (!session || !sameSession(session.token, token) || session.endSent) return false
    set({ session: { ...session, endSent: true } })
    return true
  },

  setPhase: (phase) => set({ phase }),
  pushLog: (msg) => set((s) => ({ log: [...s.log.slice(-4), msg] })),
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

  setCaptured: (captured) => set({ captured }),

  beginPresentation: (token, before, input) =>
    set((s) => {
      if (!s.session || !sameSession(s.session.token, token)) return {}
      if (s.presentation && !samePresentation(s.presentation.token, token)) return {}
      const star = input.type === 'ATTACK' && input.starStrike === true
      return {
        phase: 'busy',
        presentation: {
          token,
          battle: cloneBattle(before),
          log: [...s.log],
          banner: s.banner,
          hitFx: s.hitFx ? { ...s.hitFx } : null,
          support: s.support,
          combo: s.combo,
          energy: star ? 0 : s.energy,
          chain: star ? 0 : s.chain,
          lockedIndex: s.lockedIndex,
          fxCounter: s.fxCounter,
        },
      }
    }),

  presentationSetMemberHp: (token, side, index, hp) =>
    set((s) => {
      const projection = s.presentation
      if (!projection || !samePresentation(projection.token, token)) return {}
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
      if (!projection || !samePresentation(projection.token, token)) return {}
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
    set((s) => s.presentation && samePresentation(s.presentation.token, token)
      ? { presentation: { ...s.presentation, banner } }
      : {}),
  presentationPushLog: (token, message) =>
    set((s) => s.presentation && samePresentation(s.presentation.token, token)
      ? { presentation: { ...s.presentation, log: [...s.presentation.log.slice(-4), message] } }
      : {}),
  presentationShowHit: (token, fx) =>
    set((s) => {
      const projection = s.presentation
      if (!projection || !samePresentation(projection.token, token)) return {}
      const fxCounter = projection.fxCounter + 1
      return { presentation: { ...projection, hitFx: { ...fx, id: fxCounter }, fxCounter } }
    }),
  presentationSetSupport: (token, support) =>
    set((s) => s.presentation && samePresentation(s.presentation.token, token)
      ? { presentation: { ...s.presentation, support } }
      : {}),
  presentationSetCombo: (token, combo) =>
    set((s) => s.presentation && samePresentation(s.presentation.token, token)
      ? { presentation: { ...s.presentation, combo } }
      : {}),
  presentationClearTransient: (token) =>
    set((s) => s.presentation && samePresentation(s.presentation.token, token)
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
    return Boolean(projection && samePresentation(projection.token, token))
  },
  commitTurn: (token, resolution) => {
    let result: CommitTurnResult = { committed: false }
    const currentSession = get().session
    const stagedReplay = currentSession
      && sameSession(currentSession.token, token)
      && currentSession.pendingReplay?.presentationId === token.presentationId
      ? { recorder: currentSession.recorder, turn: currentSession.pendingReplay.turn }
      : null
    set((s) => {
      const projection = s.presentation
      if (
        !projection
        || !samePresentation(projection.token, token)
        || !s.session
        || !sameSession(s.session.token, token)
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
      if (!s.presentation || !samePresentation(s.presentation.token, token)) return {}
      return {
        presentation: null,
        phase,
        banner: null,
        hitFx: null,
        support: null,
        combo: null,
        session: s.session && sameSession(s.session.token, token)
          ? { ...s.session, pendingReplay: null }
          : s.session,
      }
    }),
}))
