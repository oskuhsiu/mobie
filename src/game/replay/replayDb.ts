// M14.c — 戰鬥回放持久化（IndexedDB `mz-replays`）的薄 I/O glue。
// 只存 canonical encodeReplay 的 .json 字串（不存 derived .txt 戰報，plan/15 §7）。
// key = battleId（FNV-1a(seed+snapshot)）去重；超過 FIFO 上限丟最舊。node 測試無 indexedDB → 安全退回。

// M18.c 慣例：IDB DB 名保留舊前綴 `mz-`（純內部、不進 .save、不隨品牌改名遷移）。
const DB_NAME = 'mz-replays'
const DB_VERSION = 1
const STORE = 'replays'

/** 保留上限（FIFO）：超過丟最舊，避免 IndexedDB 無限長大。 */
export const REPLAY_FIFO_LIMIT = 50

export type ReplayStorageErrorCode = 'unavailable' | 'open' | 'read' | 'write' | 'delete'

export class ReplayStorageError extends Error {
  readonly code: ReplayStorageErrorCode

  constructor(code: ReplayStorageErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ReplayStorageError'
    this.code = code
  }
}

/** 列表用輕量 meta（不必 decode json 即可渲染清單）。 */
export interface ReplayRecordMeta {
  battleId: string
  createdAt: number
  regionId: string
  mode: 'arena' | 'wild'
  outcome: 'win' | 'lose'
  players: string[]
  foes: string[]
  /** Cached list facts. Old records derive these from their canonical JSON. */
  durationMs?: number
  turnCount?: number
  eventCount?: number
}

/** 完整紀錄：meta + canonical json 字串。 */
export interface ReplayRecord extends ReplayRecordMeta {
  json: string
}

let dbPromise: Promise<IDBDatabase> | null = null

function hasIDB(): boolean {
  return typeof indexedDB !== 'undefined'
}

/** Whether this browser can expose the replay IndexedDB namespace. */
export function replayStorageAvailable(): boolean {
  return hasIDB()
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  if (!hasIDB()) {
    return Promise.reject(new ReplayStorageError('unavailable', '此瀏覽器沒有可用的回放儲存空間。請改用支援 IndexedDB 的瀏覽器。'))
  }
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    let req: IDBOpenDBRequest
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (error) {
      reject(new ReplayStorageError('open', '回放儲存空間無法開啟。請重新載入頁面後再試一次。', { cause: error }))
      return
    }
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'battleId' })
        os.createIndex('createdAt', 'createdAt')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(new ReplayStorageError('open', '回放儲存空間無法開啟。請重新載入頁面後再試一次。', { cause: req.error }))
  })
  dbPromise = opening.catch((error) => {
    // A transient private-mode/quota failure should be retryable from the UI
    // after the player changes browser state or reloads the storage namespace.
    dbPromise = null
    throw error
  })
  return dbPromise
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>, code: ReplayStorageErrorCode = mode === 'readonly' ? 'read' : 'write'): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    let transaction: IDBTransaction
    let request: IDBRequest<T>
    let result: T
    let settled = false
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      reject(error instanceof ReplayStorageError ? error : new ReplayStorageError(code, '回放儲存空間讀寫失敗。請再試一次。', { cause: error }))
    }
    try {
      transaction = db.transaction(STORE, mode)
      request = run(transaction.objectStore(STORE))
      request.onsuccess = () => { result = request.result }
      request.onerror = () => fail(request.error)
      transaction.onerror = () => fail(transaction.error)
      transaction.onabort = () => fail(transaction.error ?? new Error('transaction aborted'))
      transaction.oncomplete = () => {
        if (settled) return
        settled = true
        resolve(result)
      }
    } catch (error) {
      fail(error)
    }
  }))
}

const listeners = new Set<() => void>()
function emit() {
  for (const fn of listeners) fn()
}
export function subscribeReplays(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

const toMeta = (r: ReplayRecord): ReplayRecordMeta => {
  const { json: _json, ...meta } = r
  return meta
}

/** 存入一筆回放（battleId 已存在＝去重不重存）；存後 FIFO 修剪 + 通知訂閱者。 */
export async function putReplay(record: ReplayRecord): Promise<void> {
  if (!hasIDB()) return
  const exists = await tx<ReplayRecord | undefined>('readonly', (s) => s.get(record.battleId) as IDBRequest<ReplayRecord | undefined>)
  if (exists) return // 同一場（同 seed+snapshot）重看不重存
  await tx('readwrite', (s) => s.put(record), 'write')
  await trimFifo()
  emit()
}

/** 列出所有回放 meta（createdAt 由新到舊）。 */
export async function listReplayMetas(): Promise<ReplayRecordMeta[]> {
  if (!hasIDB()) return []
  const all = await tx<ReplayRecord[]>('readonly', (s) => s.getAll() as IDBRequest<ReplayRecord[]>)
  return all.map(toMeta).sort((a, b) => b.createdAt - a.createdAt)
}

/** 取一筆完整回放（含 json）；無則 null。 */
export async function getReplay(battleId: string): Promise<ReplayRecord | null> {
  if (!hasIDB()) return null
  const r = await tx<ReplayRecord | undefined>('readonly', (s) => s.get(battleId) as IDBRequest<ReplayRecord | undefined>)
  return r ?? null
}

/** 刪除一筆回放。 */
export async function deleteReplay(battleId: string): Promise<void> {
  if (!hasIDB()) return
  await tx('readwrite', (s) => s.delete(battleId), 'delete')
  emit()
}

/** 超過 FIFO 上限時刪最舊（依 createdAt 升冪）。 */
async function trimFifo(): Promise<void> {
  const all = await tx<ReplayRecord[]>('readonly', (s) => s.getAll() as IDBRequest<ReplayRecord[]>)
  if (all.length <= REPLAY_FIFO_LIMIT) return
  const oldest = all.sort((a, b) => a.createdAt - b.createdAt).slice(0, all.length - REPLAY_FIFO_LIMIT)
  for (const r of oldest) await tx('readwrite', (s) => s.delete(r.battleId))
}
