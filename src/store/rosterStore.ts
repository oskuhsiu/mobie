import { create } from 'zustand'
import type { Card, OwnedUnit } from '@/game/types'
import { PLAYER_CARDS } from '@/game/data/playerCards'
import { applyExp, createOwnedUnit, expYield, type ExpResult } from '@/game/growth'
import { sanitizeRoster } from '@/game/rosterSanitize'
import { LocalStorageAdapter, type PersistenceAdapter } from '@/game/persistence'
import { bumpSaveMeta } from '@/game/save/saveMeta'

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
  /** 最近一場勝利新收服的寶可夢（給結算畫面顯示），null=沒收服 */
  lastCaptured: OwnedUnit | null
  load: () => Promise<void>
  /**
   * 戰鬥結算：給參戰的 unitIds 依被擊敗隊伍等級加經驗、升級、存檔。
   * ratio 用來區分勝（1.0 全額）與敗（部分，例如 0.15）。
   */
  grantBattleExp: (unitIds: string[], foeLevels: number[], ratio?: number) => Promise<ExpResult[]>
  /** 收服一隻（由捕獲卡建 canonical OwnedUnit，加入並存檔；個體與戰鬥畫面一致） */
  captureUnit: (card: Card) => Promise<OwnedUnit | null>
  clearResults: () => void
}

export const useRoster = create<RosterState>((set, get) => ({
  roster: defaultRoster(),
  loaded: false,
  lastResults: [],
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

  grantBattleExp: async (unitIds, foeLevels, ratio = 1) => {
    const base = foeLevels.reduce((s, l) => s + expYield(l), 0)
    // 敗北也給部分經驗（ratio<1）：至少 1 點，讓每場都有累積、不白忙
    const gained = base > 0 ? Math.max(1, Math.floor(base * ratio)) : 0
    const ids = new Set(unitIds)
    const results: ExpResult[] = []
    const roster = get().roster.map((u) => {
      if (!ids.has(u.id)) return u
      const r = applyExp(u, gained)
      results.push(r)
      return r.unit
    })
    set({ roster, lastResults: results })
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

  clearResults: () => set({ lastResults: [], lastCaptured: null }),
}))
