import { create } from 'zustand'
import type { BattlePokemon } from '@/game/types'
import {
  resolveAttack, qteMultiplier, type AttackResult, type QteQuality,
} from '@/game/battle/engine'

export type BattlePhase = 'intro' | 'playerChoice' | 'qte' | 'busy' | 'won' | 'lost'
export type Side = 'player' | 'foe'

/** 一次受擊的視覺效果（低頻：每次攻擊一次，走 React state 沒問題） */
export interface HitFx {
  target: Side
  amount: number
  crit: boolean
  effText: string | null
  missed: boolean
  id: number
}

interface BattleState {
  player: BattlePokemon | null
  foe: BattlePokemon | null
  phase: BattlePhase
  log: string[]
  banner: string | null
  attacking: Side | null
  hitFx: HitFx | null
  fxCounter: number
  captured: boolean | null

  init: (player: BattlePokemon, foe: BattlePokemon) => void
  setPhase: (p: BattlePhase) => void
  pushLog: (msg: string) => void
  setBanner: (b: string | null) => void
  setAttacking: (s: Side | null) => void
  /** 解算並套用一次攻擊；回傳結果供元件編排動畫節奏 */
  applyHit: (attacker: Side, quality?: QteQuality) => AttackResult
  clearFx: () => void
  setCaptured: (b: boolean) => void
}

export const useBattleStore = create<BattleState>((set, get) => ({
  player: null,
  foe: null,
  phase: 'intro',
  log: [],
  banner: null,
  attacking: null,
  hitFx: null,
  fxCounter: 0,
  captured: null,

  init: (player, foe) =>
    set({
      player, foe, phase: 'intro', log: [], banner: null,
      attacking: null, hitFx: null, fxCounter: 0, captured: null,
    }),

  setPhase: (phase) => set({ phase }),
  pushLog: (msg) => set((s) => ({ log: [...s.log.slice(-4), msg] })),
  setBanner: (banner) => set({ banner }),
  setAttacking: (attacking) => set({ attacking }),

  applyHit: (attacker, quality) => {
    const state = get()
    const atkMon = attacker === 'player' ? state.player! : state.foe!
    const defSide: Side = attacker === 'player' ? 'foe' : 'player'
    const defMon = attacker === 'player' ? state.foe! : state.player!

    const qteMult = quality ? qteMultiplier(quality) : 1
    const result = resolveAttack(atkMon, defMon, { qteMult })

    const updatedDef: BattlePokemon = { ...defMon, currentHp: result.defenderHpAfter }
    const fxId = state.fxCounter + 1

    const hitFx: HitFx = {
      target: defSide,
      amount: result.damage,
      crit: result.crit,
      effText: result.effectivenessText,
      missed: result.missed,
      id: fxId,
    }

    const nextPhase: BattlePhase =
      result.defenderFainted ? (defSide === 'foe' ? 'won' : 'lost') : state.phase

    set({
      [defSide]: updatedDef,
      hitFx,
      fxCounter: fxId,
      phase: nextPhase,
    } as Partial<BattleState>)

    return result
  },

  clearFx: () => set({ hitFx: null, attacking: null }),
  setCaptured: (captured) => set({ captured }),
}))
