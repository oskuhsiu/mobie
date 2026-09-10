// 持久化（M1.5f）：只存 canonical OwnedUnit roster（不存派生數值/RNG 中間態）。
// 介面化方便 M2 無痛換 Dexie/IndexedDB。

import type { OwnedUnit } from '@/game/types'

export interface PersistenceAdapter {
  loadRoster(): Promise<OwnedUnit[]>
  saveRoster(units: OwnedUnit[]): Promise<void>
  saveUnit(unit: OwnedUnit): Promise<void>
  /** Capture child boundary: canonical roster and its result markers share one envelope write. */
  saveRosterWithCaptureMarkersStrict?: (units: OwnedUnit[], markers: unknown[]) => Promise<void>
  /** Hatch child boundary: canonical roster and its hatch markers share one envelope write. */
  saveRosterWithHatchMarkersStrict?: (units: OwnedUnit[], markers: unknown[]) => Promise<void>
  /** Bootstrap-only strict reads/writes; unlike gameplay persistence, failures are recoverable UI errors. */
  loadRosterStrict?: () => Promise<OwnedUnit[]>
  saveRosterStrict?: (units: OwnedUnit[]) => Promise<void>
}

// v2：起始 roster 由 5 隻擴充為跨屬性 16 隻（dex 擴到 251、區域擴到 8）→ 換 key 讓既有存檔重新種子。
// The legacy value is an OwnedUnit[]; the capture child may add a resultSettlements
// field around that array without changing the loadRoster contract.
const KEY = 'mobie.roster.v2'

interface RosterEnvelope {
  roster: OwnedUnit[]
  resultSettlements?: unknown[]
  hatchSettlements?: unknown[]
}

function decodeRoster(raw: string | null): { roster: OwnedUnit[]; markers?: unknown[]; hatchMarkers?: unknown[] } | null {
  if (!raw) return null
  const parsed: unknown = JSON.parse(raw)
  if (Array.isArray(parsed)) return { roster: parsed as OwnedUnit[] }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const record = parsed as Partial<RosterEnvelope>
  if (!Array.isArray(record.roster)) return null
  return {
    roster: record.roster,
    ...(Array.isArray(record.resultSettlements) ? { markers: record.resultSettlements } : {}),
    ...(Array.isArray(record.hatchSettlements) ? { hatchMarkers: record.hatchSettlements } : {}),
  }
}

function encodeRoster(units: OwnedUnit[], markers?: unknown[], hatchMarkers?: unknown[]): string {
  if (!markers && !hatchMarkers) return JSON.stringify(units)
  return JSON.stringify({
    roster: units,
    ...(markers ? { resultSettlements: markers } : {}),
    ...(hatchMarkers ? { hatchSettlements: hatchMarkers } : {}),
  })
}

function existingMarkers(): unknown[] | undefined {
  try {
    return decodeRoster(localStorage.getItem(KEY))?.markers
  } catch {
    return undefined
  }
}

function existingHatchMarkers(): unknown[] | undefined {
  try {
    return decodeRoster(localStorage.getItem(KEY))?.hatchMarkers
  } catch {
    return undefined
  }
}

/** localStorage 墊檔；只序列化 canonical OwnedUnit。 */
export class LocalStorageAdapter implements PersistenceAdapter {
  async loadRoster(): Promise<OwnedUnit[]> {
    try {
      const raw = localStorage.getItem(KEY)
      return decodeRoster(raw)?.roster ?? []
    } catch {
      return []
    }
  }

  async saveRoster(units: OwnedUnit[]): Promise<void> {
    try {
      localStorage.setItem(KEY, encodeRoster(units, existingMarkers(), existingHatchMarkers()))
    } catch {
      /* 配額/隱私模式失敗：忽略，不影響遊戲 */
    }
  }

  async loadRosterStrict(): Promise<OwnedUnit[]> {
    if (typeof localStorage === 'undefined') return []
    try {
      const raw = localStorage.getItem(KEY)
      if (raw === null) return []
      const data = decodeRoster(raw)
      if (!data) throw new Error('roster payload is not an array or roster envelope')
      return data.roster
    } catch (cause) {
      throw new Error(`讀取 Mobie 資料失敗：${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }

  async saveRosterStrict(units: OwnedUnit[]): Promise<void> {
    if (typeof localStorage === 'undefined') return
    try {
      localStorage.setItem(KEY, encodeRoster(units, existingMarkers(), existingHatchMarkers()))
    } catch (cause) {
      throw new Error(`保存 Mobie 資料失敗：${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }

  async saveRosterWithCaptureMarkersStrict(units: OwnedUnit[], markers: unknown[]): Promise<void> {
    if (typeof localStorage === 'undefined') return
    try {
      localStorage.setItem(KEY, encodeRoster(units, markers, existingHatchMarkers()))
    } catch (cause) {
      throw new Error(`保存收服 Mobie 結算資料失敗：${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }

  async saveRosterWithHatchMarkersStrict(units: OwnedUnit[], markers: unknown[]): Promise<void> {
    if (typeof localStorage === 'undefined') return
    try {
      localStorage.setItem(KEY, encodeRoster(units, existingMarkers(), markers))
    } catch (cause) {
      throw new Error(`保存孵化 roster 結算資料失敗：${cause instanceof Error ? cause.message : String(cause)}`)
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
  async loadRosterStrict() { return this.loadRoster() }
  async saveRosterStrict(units: OwnedUnit[]) { return this.saveRoster(units) }
  async saveRosterWithCaptureMarkersStrict(units: OwnedUnit[]) { return this.saveRoster(units) }
  async saveRosterWithHatchMarkersStrict(units: OwnedUnit[]) { return this.saveRoster(units) }
  async saveUnit(unit: OwnedUnit) {
    const i = this.roster.findIndex((u) => u.id === unit.id)
    if (i >= 0) this.roster[i] = { ...unit }
    else this.roster.push({ ...unit })
  }
}
