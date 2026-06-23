// 使用者本機 drop-in 的 GLB 造型：存進 IndexedDB（blob），依 speciesId 對應。
// repo 不散布任何侵權模型——這裡只是「使用者自己放進自己瀏覽器」的保管箱。
// 純 I/O glue，不在 vitest（node 無 indexedDB）覆蓋；正規化數學見 normalize.ts。

import { bumpSaveMeta } from '@/game/save/saveMeta'

const DB_NAME = 'mz-models'
const DB_VERSION = 1
const STORE = 'glb'

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
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
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

// objectURL 快取：避免每次 render 重建/外洩；速度 + 讓 useLoader 的 URL 穩定。
const urlCache = new Map<number, string>()
// 訂閱：匯入/刪除模型時通知 UI 與場景重新解析。
const listeners = new Set<() => void>()
function emit() {
  for (const fn of listeners) fn()
}
export function subscribeModels(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** 存入/取代某 speciesId 的 GLB。傳入的應是 .glb/.gltf 檔的 Blob。 */
export async function putModel(speciesId: number, blob: Blob): Promise<void> {
  if (!hasIDB()) throw new Error('此瀏覽器不支援 IndexedDB，無法保存 3D 模型')
  await tx('readwrite', (s) => s.put(blob, speciesId))
  const old = urlCache.get(speciesId)
  if (old) {
    URL.revokeObjectURL(old)
    urlCache.delete(speciesId)
  }
  bumpSaveMeta(Date.now()) // 匯入模型 → 存檔變新
  emit()
}

/** 取某 speciesId 的 objectURL（無則 null）。URL 有快取，請勿自行 revoke。 */
export async function getModelUrl(speciesId: number): Promise<string | null> {
  if (!hasIDB()) return null
  const cached = urlCache.get(speciesId)
  if (cached) return cached
  const blob = await tx<Blob | undefined>('readonly', (s) => s.get(speciesId) as IDBRequest<Blob | undefined>)
  if (!blob) return null
  const url = URL.createObjectURL(blob)
  urlCache.set(speciesId, url)
  return url
}

/** 取某 speciesId 的原始 GLB Blob（匯出存檔用；無則 null）。 */
export async function getModelBlob(speciesId: number): Promise<Blob | null> {
  if (!hasIDB()) return null
  const blob = await tx<Blob | undefined>('readonly', (s) => s.get(speciesId) as IDBRequest<Blob | undefined>)
  return blob ?? null
}

/** 刪除某 speciesId 的自訂模型（回到 billboard fallback）。 */
export async function deleteModel(speciesId: number): Promise<void> {
  if (!hasIDB()) return
  await tx('readwrite', (s) => s.delete(speciesId))
  const old = urlCache.get(speciesId)
  if (old) {
    URL.revokeObjectURL(old)
    urlCache.delete(speciesId)
  }
  bumpSaveMeta(Date.now()) // 刪除模型 → 存檔變新
  emit()
}

/** 清空所有自訂模型（匯入「含模型的完整備份」時，先清再套用）。 */
export async function clearAllModels(): Promise<void> {
  if (!hasIDB()) return
  await tx('readwrite', (s) => s.clear())
  for (const url of urlCache.values()) URL.revokeObjectURL(url)
  urlCache.clear()
  bumpSaveMeta(Date.now()) // 視為一次存檔變動；匯入流程後續 adoptMeta 會覆蓋
  emit()
}

/** 列出已匯入自訂模型的 speciesId。 */
export async function listModelIds(): Promise<number[]> {
  if (!hasIDB()) return []
  const keys = await tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys())
  return keys.map((k) => Number(k)).filter((n) => Number.isFinite(n))
}
