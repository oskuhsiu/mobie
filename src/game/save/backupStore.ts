// M5-4：匯入覆蓋「之前」的自動備份槽（IndexedDB，單一 'last' 槽）。
// 安全紅線：絕不在沒有可救回備份的情況下覆蓋既有存檔。備份內容＝當前 roster+cards 的
// .save 位元組（不含 GLB 模型——模型是可重新 drop-in 的，進度才是不可逆的）。

import type { SaveMeta } from './saveMeta'

// M18.c：IDB DB 名刻意保留舊前綴 `mz-`（不隨品牌改名遷移）。詳見 game/keyMigration.ts / plan/20。
const DB_NAME = 'mz-save-backup'
const DB_VERSION = 1
const STORE = 'backup'
const KEY = 'last'

interface BackupRecord {
  bytes: ArrayBuffer
  meta: SaveMeta
  /** 建立備份的 wall-clock（ms）；給「還原」UI 顯示 */
  at: number
}

function hasIDB(): boolean {
  return typeof indexedDB !== 'undefined'
}

let dbPromise: Promise<IDBDatabase> | null = null
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = run(db.transaction(STORE, mode).objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

export interface BackupInfo {
  meta: SaveMeta
  at: number
}

/** 寫入 / 覆蓋備份槽（匯入套用前呼叫）。 */
export async function saveBackup(bytes: Uint8Array, meta: SaveMeta, at: number): Promise<void> {
  if (!hasIDB()) return
  const copy = bytes.slice() // 與來源解耦，存純 ArrayBuffer
  const rec: BackupRecord = { bytes: copy.buffer, meta, at }
  await tx('readwrite', (s) => s.put(rec, KEY))
}

/** 讀備份的 metadata（給 UI 判斷是否顯示「還原」）。無則 null。 */
export async function getBackupInfo(): Promise<BackupInfo | null> {
  if (!hasIDB()) return null
  const rec = await tx<BackupRecord | undefined>('readonly', (s) => s.get(KEY) as IDBRequest<BackupRecord | undefined>)
  return rec ? { meta: rec.meta, at: rec.at } : null
}

/** 讀回備份的原始 .save 位元組（還原用）。無則 null。 */
export async function loadBackupBytes(): Promise<Uint8Array | null> {
  if (!hasIDB()) return null
  const rec = await tx<BackupRecord | undefined>('readonly', (s) => s.get(KEY) as IDBRequest<BackupRecord | undefined>)
  return rec ? new Uint8Array(rec.bytes) : null
}
