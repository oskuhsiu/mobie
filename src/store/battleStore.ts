import { create } from 'zustand'
import type { BattleMobie, TerrainId } from '@/game/types'
import { createBattleState, type BattleState, type Side, type SupportOutcome, type StatusEffect } from '@/game/battle/reducer'

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

interface BattleUiState {
  /** canonical 戰鬥態（由 reducer 算、BattleScreen 依 event 逐步搬進來做動畫） */
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
  /** M16/M17：已看穿的對手隊員 index（MobCard 對手深度揭露）；M16 恆空，M17 看穿鈕 add。 */
  revealedFoes: number[]

  init: (playerMembers: BattleMobie[], foeMembers: BattleMobie[], terrains?: TerrainId[]) => void
  /** 整盤覆寫（回合結算後 snap turn/winner，HP 已逐步動畫到位） */
  setBattle: (battle: BattleState) => void
  /** 單隻 HP（觸發血條 tween） */
  setMemberHp: (side: Side, index: number, hp: number) => void
  /** 換上場（主動或強制） */
  setActiveIndex: (side: Side, index: number) => void
  setPhase: (p: BattlePhase) => void
  pushLog: (msg: string) => void
  setBanner: (b: string | null) => void
  setSupport: (o: SupportOutcome | null) => void
  /** 累積能量（dealtDamage=該回合有命中→連鎖+1，否則歸零）；回傳是否剛集滿 */
  addEnergy: (delta: number, dealtDamage: boolean) => void
  resetEnergy: () => void
  /** M9 連鎖連段 overlay（null 清除） */
  setCombo: (n: number | null) => void
  /** M17 看穿：標記某對手 index 已揭露（M16 不呼叫；exactly-once 去重）。 */
  revealFoe: (index: number) => void
  /** M17 訓練師加油（support）：開戰一次性灌注全隊增益到 field.teamStatuses（複用 M19.d，reducer 既有消費）。 */
  applyTeamStatuses: (statuses: StatusEffect[]) => void
  showHit: (fx: Omit<HitFx, 'id'>) => void
  clearFx: () => void
  setCaptured: (b: boolean) => void
}

export const useBattleStore = create<BattleUiState>((set) => ({
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
  revealedFoes: [],

  init: (playerMembers, foeMembers, terrains) =>
    set({
      battle: createBattleState(playerMembers, foeMembers, terrains),
      phase: 'intro', log: [], banner: null,
      hitFx: null, fxCounter: 0, captured: null,
      support: null, energy: 0, chain: 0, combo: null, revealedFoes: [],
    }),

  setBattle: (battle) => set({ battle }),

  setMemberHp: (side, index, hp) =>
    set((s) => {
      if (!s.battle) return {}
      const sideState = s.battle[side]
      const members = sideState.members.map((m, i) => (i === index ? { ...m, currentHp: hp } : m))
      return { battle: { ...s.battle, [side]: { ...sideState, members } } }
    }),

  setActiveIndex: (side, index) =>
    set((s) => {
      if (!s.battle) return {}
      return { battle: { ...s.battle, [side]: { ...s.battle[side], activeIndex: index } } }
    }),

  setPhase: (phase) => set({ phase }),
  pushLog: (msg) => set((s) => ({ log: [...s.log.slice(-4), msg] })),
  setBanner: (banner) => set({ banner }),
  setSupport: (support) => set({ support }),
  addEnergy: (delta, dealtDamage) =>
    set((s) => {
      const chain = dealtDamage ? s.chain + 1 : 0
      const gain = delta + (dealtDamage ? chain * 4 : 0) // 連鎖加成
      return { energy: Math.max(0, Math.min(100, s.energy + gain)), chain }
    }),
  resetEnergy: () => set({ energy: 0 }),
  setCombo: (combo) => set({ combo }),
  revealFoe: (index) => set((s) => (s.revealedFoes.includes(index) ? {} : { revealedFoes: [...s.revealedFoes, index] })),
  applyTeamStatuses: (statuses) =>
    set((s) => {
      if (!s.battle || statuses.length === 0) return {}
      const field = { ...s.battle.field, teamStatuses: [...s.battle.field.teamStatuses, ...statuses] }
      return { battle: { ...s.battle, field } }
    }),

  showHit: (fx) => set((s) => ({ hitFx: { ...fx, id: s.fxCounter + 1 }, fxCounter: s.fxCounter + 1 })),
  clearFx: () => set({ hitFx: null }),
  setCaptured: (captured) => set({ captured }),
}))
