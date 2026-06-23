import { create } from 'zustand'
import type { Card, OwnedUnit } from '@/game/types'
import type { PostGrowthHook } from '@/game/ext/seams'
import { PLAYER_CARDS } from '@/game/data/playerCards'
import { applyExp, createOwnedUnit, expYield, type ExpResult } from '@/game/growth'
import { sanitizeRoster } from '@/game/rosterSanitize'
import { LocalStorageAdapter, type PersistenceAdapter } from '@/game/persistence'
import { bumpSaveMeta } from '@/game/save/saveMeta'

/** 一隻於本場戰後進化（S6 postGrowth）的紀錄，給結算畫面演出。 */
export interface EvolutionEvent {
  unitId: string
  fromSpecies: number
  toSpecies: number
  atLevel: number
}

const adapter: PersistenceAdapter = new LocalStorageAdapter()

/** 預設 roster：由本地假卡 seed（id = cardId，與持久化一致） */
function defaultRoster(): OwnedUnit[] {
  return PLAYER_CARDS.map((c) => createOwnedUnit(c.cardId, c.speciesId, c.level, c))
}

interface RosterState {
  roster: OwnedUnit[]
  loaded: boolean
  /** 最近一場戰鬥的每隻成長結果（給結算畫面顯示） */
  lastResults: ExpResult[]
  /** 最近一場戰後進化（S6，給結算畫面演出），空＝無進化 */
  lastEvolutions: EvolutionEvent[]
  /** 最近一場勝利新收服的寶可夢（給結算畫面顯示），null=沒收服 */
  lastCaptured: OwnedUnit | null
  load: () => Promise<void>
  /**
   * 戰鬥結算：給參戰的 unitIds 依被擊敗隊伍等級加經驗、升級、存檔。
   * ratio 用來區分勝（1.0 全額）與敗（部分，例如 0.15）。
   * `postGrowth`＝S6 進化縫（由 settingsStore 組好傳入；空＝不進化）：升級後套用、改 speciesId、記 lastEvolutions。
   */
  grantBattleExp: (unitIds: string[], foeLevels: number[], ratio?: number, postGrowth?: PostGrowthHook[]) => Promise<ExpResult[]>
  /** 收服一隻（由捕獲卡建 canonical OwnedUnit，加入並存檔；個體與戰鬥畫面一致） */
  captureUnit: (card: Card) => Promise<OwnedUnit | null>
  /** 裝備/卸下持有道具（itemId=undefined 卸下），回傳原本裝備的 itemId（給背包對帳）；存檔。 */
  setHeldItem: (unitId: string, itemId: string | undefined) => Promise<string | undefined>
  /** 匯入存檔：整批取代 roster（已 sanitize），存檔。meta 由匯入流程的 adoptMeta 設定，故此處不 bump。 */
  replaceAll: (units: OwnedUnit[]) => Promise<void>
  clearResults: () => void
}

export const useRoster = create<RosterState>((set, get) => ({
  roster: defaultRoster(),
  loaded: false,
  lastResults: [],
  lastEvolutions: [],
  lastCaptured: null,

  load: async () => {
    const saved = await adapter.loadRoster()
    // 載入邊界防護：丟棄壞項 / 夾合法範圍，擋「壞檔讓遊戲開不起來」的死迴圈
    const clean = sanitizeRoster(saved)
    if (clean.length === 0) {
      const seeded = defaultRoster()
      await adapter.saveRoster(seeded)
      set({ roster: seeded, loaded: true })
    } else {
      if (clean.length !== saved.length) await adapter.saveRoster(clean) // 有丟棄壞項 → 修檔回寫
      set({ roster: clean, loaded: true })
    }
  },

  grantBattleExp: async (unitIds, foeLevels, ratio = 1, postGrowth = []) => {
    const base = foeLevels.reduce((s, l) => s + expYield(l), 0)
    // 敗北也給部分經驗（ratio<1）：至少 1 點，讓每場都有累積、不白忙
    const gained = base > 0 ? Math.max(1, Math.floor(base * ratio)) : 0
    const ids = new Set(unitIds)
    const results: ExpResult[] = []
    const evolutions: EvolutionEvent[] = []
    const roster = get().roster.map((u) => {
      if (!ids.has(u.id)) return u
      const r = applyExp(u, gained)
      // S6 進化：升級後逐一套 postGrowth（改 speciesId、個體欄位全保留）；speciesId 變動即記進化
      let grown = r.unit
      for (const hook of postGrowth) grown = hook(grown)
      if (grown.speciesId !== r.unit.speciesId) {
        evolutions.push({ unitId: grown.id, fromSpecies: r.unit.speciesId, toSpecies: grown.speciesId, atLevel: grown.level })
      }
      results.push({ ...r, unit: grown })
      return grown
    })
    set({ roster, lastResults: results, lastEvolutions: evolutions })
    await adapter.saveRoster(roster)
    bumpSaveMeta(Date.now()) // 進度推進 → 存檔變新（供匯出/匯入新舊判斷）
    return results
  },

  captureUnit: async (card) => {
    // seed = cardId，與 buildBattlePokemon 對野生卡的決定論個體一致 → 收服後個體不變
    // card 顯式給的 ivs/nature/shiny（自製/掃描卡）會覆寫 seed roll
    const unit = createOwnedUnit(card.cardId, card.speciesId, card.level, card)
    // 去重：同 id（同一次遭遇）不重複加入
    if (get().roster.some((u) => u.id === unit.id)) {
      set({ lastCaptured: null })
      return null
    }
    const roster = [...get().roster, unit]
    set({ roster, lastCaptured: unit })
    await adapter.saveRoster(roster)
    bumpSaveMeta(Date.now()) // 收服 → 存檔變新
    return unit
  },

  setHeldItem: async (unitId, itemId) => {
    let prev: string | undefined
    const roster = get().roster.map((u) => {
      if (u.id !== unitId) return u
      prev = u.heldItemId
      if (itemId) return { ...u, heldItemId: itemId }
      const { heldItemId: _drop, ...rest } = u // 卸下：移除欄位（保持 canonical 乾淨）
      return rest
    })
    set({ roster })
    await adapter.saveRoster(roster)
    bumpSaveMeta(Date.now())
    return prev
  },

  replaceAll: async (units) => {
    const clean = sanitizeRoster(units)
    set({ roster: clean, lastResults: [], lastEvolutions: [], lastCaptured: null })
    await adapter.saveRoster(clean)
  },

  clearResults: () => set({ lastResults: [], lastEvolutions: [], lastCaptured: null }),
}))
