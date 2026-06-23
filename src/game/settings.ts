// M6.0 — 設定存檔 slice（mz.settings.v1）。設計真相：plan/09 §0.3。
//
// 獨立命名空間（與 roster `mz.roster.v2` 不同）：延伸系統「逐一開關」住這裡，**預設全關**＝
// 新玩家拿到純 M1.x 體驗。不違反「只存 canonical roster」——該不變式約束的是 roster 序列化，
// 模組自有 slice 是另一命名空間（plan/09 §0.3）。
//
// 純判斷邏輯（defaultSettings / migrateSettings / setModuleEnabledIn）可單獨 vitest；
// localStorage I/O 薄、在無 localStorage（node 測試）時安全退回預設（同 saveMeta 慣例）。

import type { ModuleId } from '@/game/ext/seams'

export const SETTINGS_SCHEMA_VERSION = 1

/** 全部延伸模組 id（設定頁逐一列出；新增模組時補這裡） */
export const MODULE_IDS: ModuleId[] = ['synergy', 'heldItems', 'abilities', 'chain', 'evolution', 'tower']

export interface GameSettings {
  schemaVersion: number
  /** 逐系統開關，預設全 false */
  modules: Record<ModuleId, boolean>
}

const KEY = 'mz.settings.v1'

function hasLS(): boolean {
  return typeof localStorage !== 'undefined'
}

function allOff(): Record<ModuleId, boolean> {
  const m = {} as Record<ModuleId, boolean>
  for (const id of MODULE_IDS) m[id] = false
  return m
}

export function defaultSettings(): GameSettings {
  return { schemaVersion: SETTINGS_SCHEMA_VERSION, modules: allOff() }
}

/** 把任意外來物正規化成合法 GameSettings（遷移 / 防壞檔）。純函數，可測。 */
export function migrateSettings(raw: unknown): GameSettings {
  const base = defaultSettings()
  if (!raw || typeof raw !== 'object') return base
  const o = raw as Record<string, unknown>
  const modules = allOff()
  const m = o.modules
  if (m && typeof m === 'object') {
    for (const id of MODULE_IDS) {
      // 只認布林 true；未知/缺漏一律維持 false（零殘留預設）
      modules[id] = (m as Record<string, unknown>)[id] === true
    }
  }
  return {
    schemaVersion: typeof o.schemaVersion === 'number' ? o.schemaVersion : base.schemaVersion,
    modules,
  }
}

/** 純函數：回傳把某模組設成 on/off 後的新設定（不碰 localStorage，方便測試）。 */
export function setModuleEnabledIn(settings: GameSettings, id: ModuleId, on: boolean): GameSettings {
  return { ...settings, modules: { ...settings.modules, [id]: on } }
}

export function loadSettings(): GameSettings {
  if (!hasLS()) return defaultSettings()
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaultSettings()
    return migrateSettings(JSON.parse(raw))
  } catch {
    return defaultSettings()
  }
}

export function saveSettings(settings: GameSettings): void {
  if (!hasLS()) return
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    /* 配額 / 隱私模式失敗：忽略，不影響遊戲 */
  }
}
