// M14.c — 戰鬥回放持久化（IndexedDB `mz-replays`）。比照 modelStore.ts 的薄 I/O glue。
// 只存 canonical encodeReplay 的 .json 字串（不存 derived .txt 戰報，plan/15 §7）。
// key = battleId（FNV-1a(seed+snapshot)）去重；超過 FIFO 上限丟最舊。node 測試無 indexedDB → 安全退回。

// M18.c 慣例：IDB DB 名保留舊前綴 `mz-`（純內部、不進 .save、不隨品牌改名遷移）。
const DB_NAME = 'mz-replays'
const DB_VERSION = 1
const STORE = 'replays'

/** 保留上限（FIFO）：超過丟最舊，避免 IndexedDB 無限長大。 */
export const REPLAY_FIFO_LIMIT = 50

/** 列表用輕量 meta（不必 decode json 即可渲染清單）。 */
export interface ReplayRecordMeta {
  battleId: string
  createdAt: number
  regionId: string
  mode: 'arena' | 'wild'
  outcome: 'win' | 'lose'
  players: string[]
  foes: string[]
}

/** 完整紀錄：meta + canonical json 字串。 */
export interface ReplayRecord extends ReplayRecordMeta {
  json: string
}

let dbPromise: Promise<IDBDatabase> | null = null

function hasIDB(): boolean {
  return typeof indexedDB !== 'undefined'
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'battleId' })
        os.createIndex('createdAt', 'createdAt')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const req = run(t.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
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
  await tx('readwrite', (s) => s.put(record))
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
  await tx('readwrite', (s) => s.delete(battleId))
  emit()
}

/** 超過 FIFO 上限時刪最舊（依 createdAt 升冪）。 */
async function trimFifo(): Promise<void> {
  const all = await tx<ReplayRecord[]>('readonly', (s) => s.getAll() as IDBRequest<ReplayRecord[]>)
  if (all.length <= REPLAY_FIFO_LIMIT) return
  const oldest = all.sort((a, b) => a.createdAt - b.createdAt).slice(0, all.length - REPLAY_FIFO_LIMIT)
  for (const r of oldest) await tx('readwrite', (s) => s.delete(r.battleId))
}
