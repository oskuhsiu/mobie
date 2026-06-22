import { create } from 'zustand'
import type { BattlePokemon } from '@/game/types'
import { createBattleState, type BattleState, type Side } from '@/game/battle/reducer'

export type { Side }

export type BattlePhase = 'intro' | 'playerChoice' | 'qte' | 'busy' | 'won' | 'lost'

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
  attacking: Side | null
  hitFx: HitFx | null
  fxCounter: number
  captured: boolean | null

  init: (playerMembers: BattlePokemon[], foeMembers: BattlePokemon[]) => void
  /** 整盤覆寫（回合結算後 snap turn/winner，HP 已逐步動畫到位） */
  setBattle: (battle: BattleState) => void
  /** 單隻 HP（觸發 HpBar tween） */
  setMemberHp: (side: Side, index: number, hp: number) => void
  /** 換上場（主動或強制） */
  setActiveIndex: (side: Side, index: number) => void
  setPhase: (p: BattlePhase) => void
  pushLog: (msg: string) => void
  setBanner: (b: string | null) => void
  setAttacking: (s: Side | null) => void
  showHit: (fx: Omit<HitFx, 'id'>) => void
  clearFx: () => void
  setCaptured: (b: boolean) => void
}

export const useBattleStore = create<BattleUiState>((set) => ({
  battle: null,
  phase: 'intro',
  log: [],
  banner: null,
  attacking: null,
  hitFx: null,
  fxCounter: 0,
  captured: null,

  init: (playerMembers, foeMembers) =>
    set({
      battle: createBattleState(playerMembers, foeMembers),
      phase: 'intro', log: [], banner: null,
      attacking: null, hitFx: null, fxCounter: 0, captured: null,
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
  setAttacking: (attacking) => set({ attacking }),

  showHit: (fx) => set((s) => ({ hitFx: { ...fx, id: s.fxCounter + 1 }, fxCounter: s.fxCounter + 1 })),
  clearFx: () => set({ hitFx: null, attacking: null }),
  setCaptured: (captured) => set({ captured }),
}))
