// M18.c — 一次性 localStorage key 遷移：舊 `mz.*` → 新 `mobie.*`（全面改名 → Mobie）。
//
// 純函數、可測、冪等。策略：先讀新 key，已存在就跳過（已遷移）；否則把舊 key 的值「複製」到新 key。
// **刻意不刪舊 key**——保留為安全網（roster=使用者最珍貴資料），萬一遷移異常舊資料仍在；占用極小。
// 必須在任何 store 模組載入「之前」執行（store 於 import 時即 `loadSettings()`/`loadRoster()` 讀 key）。
// 故由 `src/bootstrap.ts` 以「最前 side-effect import」呼叫（見 main.tsx）。
//
// 注意：IndexedDB DB 名（`mz-cards`/`mz-models`/`mz-save-backup`）**刻意保留舊名**，不在此遷移——
// 純內部、不面向品牌、不進 .save，且跨 DB 搬遷 blob 成本高、`indexedDB.databases()` 在 iPad Safari
// 支援不穩易孤立模型/卡庫（plan/20「二選一明文記錄」採此案）。`.save` 格式不含 key 名故完全不受影響。

/** 舊→新 localStorage key 對照（6 個 slice）。 */
export const KEY_MIGRATIONS: ReadonlyArray<readonly [oldKey: string, newKey: string]> = [
  ['mz.roster.v2', 'mobie.roster.v2'],
  ['mz.settings.v1', 'mobie.settings.v1'],
  ['mz.itembag.v1', 'mobie.itembag.v1'],
  ['mz.savemeta.v1', 'mobie.savemeta.v1'],
  ['mz.meta.v1', 'mobie.meta.v1'],
  ['mz.incubator.v1', 'mobie.incubator.v1'],
]

/** 最小 storage 介面，方便注入測試替身。 */
export interface KeyStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * 把舊 `mz.*` 值搬到新 `mobie.*`（新 key 已有則不動＝冪等）。回傳實際搬遷的 key 數（供測試/log）。
 * 無 localStorage（node）時安全略過。
 */
export function migrateKeys(store: KeyStore | undefined = safeLocalStorage()): number {
  if (!store) return 0
  let moved = 0
  for (const [oldKey, newKey] of KEY_MIGRATIONS) {
    if (store.getItem(newKey) != null) continue // 已在新 key（含本次之前已遷移）
    const value = store.getItem(oldKey)
    if (value != null) {
      store.setItem(newKey, value)
      moved++
    }
  }
  return moved
}

function safeLocalStorage(): KeyStore | undefined {
  return typeof localStorage !== 'undefined' ? localStorage : undefined
}
