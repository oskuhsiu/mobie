// 持久化（M1.5f）：只存 canonical OwnedUnit roster（不存派生數值/RNG 中間態）。
// 介面化方便 M2 無痛換 Dexie/IndexedDB。

import type { OwnedUnit } from '@/game/types'

export interface PersistenceAdapter {
  loadRoster(): Promise<OwnedUnit[]>
  saveRoster(units: OwnedUnit[]): Promise<void>
  saveUnit(unit: OwnedUnit): Promise<void>
}

// v2：起始 roster 由 5 隻擴充為跨屬性 16 隻（dex 擴到 251、區域擴到 8）→ 換 key 讓既有存檔重新種子。
const KEY = 'mobie.roster.v2'

/** localStorage 墊檔；只序列化 canonical OwnedUnit。 */
export class LocalStorageAdapter implements PersistenceAdapter {
  async loadRoster(): Promise<OwnedUnit[]> {
    try {
      const raw = localStorage.getItem(KEY)
      if (!raw) return []
      const data = JSON.parse(raw)
      return Array.isArray(data) ? (data as OwnedUnit[]) : []
    } catch {
      return []
    }
  }

  async saveRoster(units: OwnedUnit[]): Promise<void> {
    try {
      localStorage.setItem(KEY, JSON.stringify(units))
    } catch {
      /* 配額/隱私模式失敗：忽略，不影響遊戲 */
    }
  }

  async saveUnit(unit: OwnedUnit): Promise<void> {
    const roster = await this.loadRoster()
    const i = roster.findIndex((u) => u.id === unit.id)
    if (i >= 0) roster[i] = unit
    else roster.push(unit)
    await this.saveRoster(roster)
  }
}

/** 記憶體實作（測試 / SSR 安全用） */
export class MemoryAdapter implements PersistenceAdapter {
  private roster: OwnedUnit[] = []
  async loadRoster() { return this.roster.map((u) => ({ ...u })) }
  async saveRoster(units: OwnedUnit[]) { this.roster = units.map((u) => ({ ...u })) }
  async saveUnit(unit: OwnedUnit) {
    const i = this.roster.findIndex((u) => u.id === unit.id)
    if (i >= 0) this.roster[i] = { ...unit }
    else this.roster.push({ ...unit })
  }
}
