import type { Card } from '@/game/types'
import { PLAYER_CARDS } from '@/game/data/playerCards'
import { bumpSaveMeta } from '@/game/save/saveMeta'

// 卡庫：cardId → Card 的本地表（IndexedDB）。掃卡時反查、QR 產生器列出可印的卡。
// 首次存取時用 PLAYER_CARDS 種子（讓自製 DEV-* 卡碼開箱即可掃到）。
// 純 I/O glue；卡碼/匯入解析見 cardCode.ts / cardsImport.ts。

// M18.c：IDB DB 名刻意保留舊前綴 `mz-`（不隨品牌改名遷移）——純內部、不面向品牌、不進 .save，
// 跨 DB 搬遷 blob 成本高且易孤立既有資料。詳見 game/keyMigration.ts / plan/20。
const DB_NAME = 'mz-cards'
const DB_VERSION = 1
const STORE = 'cards'

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
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'cardId' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function readReq<T>(run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = run(db.transaction(STORE, 'readonly').objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

function writeAll(run: (store: IDBObjectStore) => void): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const t = db.transaction(STORE, 'readwrite')
        run(t.objectStore(STORE))
        t.oncomplete = () => resolve()
        t.onerror = () => reject(t.error)
      }),
  )
}

const listeners = new Set<() => void>()
function emit() {
  for (const fn of listeners) fn()
}
export function subscribeCards(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

let seeding: Promise<void> | null = null
function ensureSeeded(): Promise<void> {
  if (!hasIDB()) return Promise.resolve()
  if (!seeding) {
    seeding = readReq<number>((s) => s.count()).then(async (n) => {
      if (n === 0) await writeAll((s) => PLAYER_CARDS.forEach((c) => s.put(c)))
    })
  }
  return seeding
}

/** 新增/覆寫多張卡（匯入用）。 */
export async function putCards(cards: Card[]): Promise<void> {
  if (!hasIDB()) throw new Error('此瀏覽器不支援 IndexedDB，無法保存卡庫')
  await writeAll((s) => cards.forEach((c) => s.put(c)))
  bumpSaveMeta(Date.now()) // 卡庫變動 → 存檔變新
  emit()
}

/** 匯入存檔：整批取代卡庫（清空後寫入 incoming）。meta 由匯入流程 adoptMeta 設定。 */
export async function replaceAllCards(cards: Card[]): Promise<void> {
  if (!hasIDB()) throw new Error('此瀏覽器不支援 IndexedDB，無法保存卡庫')
  await writeAll((s) => {
    s.clear()
    cards.forEach((c) => s.put(c))
  })
  emit()
}

/** 反查一張卡（掃卡用）。無 IndexedDB 時退回 PLAYER_CARDS。 */
export async function getCard(cardId: string): Promise<Card | null> {
  if (!hasIDB()) return PLAYER_CARDS.find((c) => c.cardId === cardId) ?? null
  await ensureSeeded()
  const c = await readReq<Card | undefined>((s) => s.get(cardId) as IDBRequest<Card | undefined>)
  return c ?? null
}

/** 列出整個卡庫（卡庫管理 / QR 產生器用）。 */
export async function listCards(): Promise<Card[]> {
  if (!hasIDB()) return [...PLAYER_CARDS]
  await ensureSeeded()
  const all = await readReq<Card[]>((s) => s.getAll())
  return all.sort((a, b) => a.speciesId - b.speciesId || a.cardId.localeCompare(b.cardId))
}

/** 刪除一張卡。 */
export async function deleteCard(cardId: string): Promise<void> {
  if (!hasIDB()) return
  await writeAll((s) => s.delete(cardId))
  bumpSaveMeta(Date.now()) // 卡庫變動 → 存檔變新
  emit()
}
