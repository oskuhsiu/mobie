import { create } from 'zustand'
import type { OwnedUnit } from '@/game/types'
import { PLAYER_CARDS } from '@/game/data/playerCards'
import { applyExp, createOwnedUnit, expYield, type ExpResult } from '@/game/growth'
import { LocalStorageAdapter, type PersistenceAdapter } from '@/game/persistence'

const adapter: PersistenceAdapter = new LocalStorageAdapter()

/** 預設 roster：由本地假卡 seed（id = cardId，與持久化一致） */
function defaultRoster(): OwnedUnit[] {
  return PLAYER_CARDS.map((c) => createOwnedUnit(c.cardId, c.speciesId, c.level))
}

interface RosterState {
  roster: OwnedUnit[]
  loaded: boolean
  /** 最近一場勝利的每隻成長結果（給結算畫面顯示） */
  lastResults: ExpResult[]
  load: () => Promise<void>
  /** 勝利結算：給參戰的 unitIds 依被擊敗隊伍等級加經驗、升級、存檔 */
  grantBattleExp: (unitIds: string[], foeLevels: number[]) => Promise<ExpResult[]>
  clearResults: () => void
}

export const useRoster = create<RosterState>((set, get) => ({
  roster: defaultRoster(),
  loaded: false,
  lastResults: [],

  load: async () => {
    const saved = await adapter.loadRoster()
    if (saved.length === 0) {
      const seeded = defaultRoster()
      await adapter.saveRoster(seeded)
      set({ roster: seeded, loaded: true })
    } else {
      set({ roster: saved, loaded: true })
    }
  },

  grantBattleExp: async (unitIds, foeLevels) => {
    const gained = foeLevels.reduce((s, l) => s + expYield(l), 0)
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
    return results
  },

  clearResults: () => set({ lastResults: [] }),
}))
