import type { Card, CardSource } from '@/game/types'
import { PLAYER_CARDS } from '@/game/data/playerCards'
import { SPECIES } from '@/game/data/species'
import { bumpSaveMeta } from '@/game/save/saveMeta'

// 卡庫：cardId → Card 的本地表（IndexedDB）。掃卡時反查、QR 產生器列出可印的卡。
// 首次存取時用 PLAYER_CARDS 種子（讓自製 DEV-* 卡碼開箱即可掃到）。
// 純 I/O glue；卡碼/匯入解析見 cardCode.ts / cardsImport.ts。

// M18.c：IDB DB 名刻意保留舊前綴 `mz-`（不隨品牌改名遷移）——純內部、不面向品牌、不進 .save，
// 跨 DB 搬遷 blob 成本高且易孤立既有資料。詳見 game/keyMigration.ts / plan/20。
const DB_NAME = 'mz-cards'
const DB_VERSION = 1
const STORE = 'cards'
const SEED_MARKER_KEY = 'mz-cards.initialized.v1'

/** 卡庫目前只有一個本機 profile；這個標籤用於顯示 provenance，不是帳號權限。 */
export const CARD_LIBRARY_OWNER = '本機訓練家'

export type CardLibraryErrorCode = 'storage' | 'invalid-card' | 'duplicate-card'

/** 卡庫寫入的 recoverable error；UI 可依 code 顯示下一步，不需要攔截未知 DOM 錯誤。 */
export class CardLibraryError extends Error {
  readonly code: CardLibraryErrorCode

  constructor(code: CardLibraryErrorCode, message: string) {
    super(message)
    this.name = 'CardLibraryError'
    this.code = code
  }
}

let dbPromise: Promise<IDBDatabase> | null = null
function hasIDB(): boolean {
  return typeof indexedDB !== 'undefined'
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  const pending = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'cardId' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  dbPromise = pending.catch((cause: unknown) => {
    dbPromise = null
    throw cause
  })
  return dbPromise
}

function readReq<T>(run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        let request: IDBRequest<T>
        try {
          request = run(db.transaction(STORE, 'readonly').objectStore(STORE))
        } catch (cause) {
          reject(cause)
          return
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      }),
  )
}

function writeAll(run: (store: IDBObjectStore) => void): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        let transaction: IDBTransaction
        try {
          transaction = db.transaction(STORE, 'readwrite')
          run(transaction.objectStore(STORE))
        } catch (cause) {
          reject(cause)
          return
        }
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error ?? new Error('卡庫交易已取消'))
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

// Card Library actions can originate from a button, file input, and a scanner
// callback in the same frame. Serialise writes so duplicate checks and the
// subsequent IndexedDB transaction observe one ordering.
let mutationQueue = Promise.resolve()
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = mutationQueue.then(task, task)
  mutationQueue = next.then(() => undefined, () => undefined)
  return next
}

function isCardSource(value: unknown): value is CardSource {
  return value === 'starter' || value === 'manual' || value === 'import'
}

/** Legacy cards have no provenance; infer the source from stable card-id prefixes. */
export function inferCardSource(cardId: string): CardSource {
  if (/^DEV(?:-|$)/i.test(cardId)) return 'starter'
  if (/^SELF(?:-|$)/i.test(cardId)) return 'manual'
  return 'import'
}

function validCreatedAt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null
}

/** Add display provenance while leaving all gameplay card fields untouched. */
export function withCardLibraryMetadata(card: Card, now = Date.now(), sourceOverride?: CardSource): Card {
  const owner = typeof card.owner === 'string' && card.owner.trim() ? card.owner.trim() : CARD_LIBRARY_OWNER
  const source = sourceOverride ?? (isCardSource(card.source) ? card.source : inferCardSource(card.cardId))
  // 0 means an old record predating the metadata fields. New writes always pass
  // a wall-clock fallback, so the UI can distinguish an unrecorded legacy time.
  const createdAt = validCreatedAt(card.createdAt) ?? (now >= 0 && Number.isFinite(now) ? Math.floor(now) : 0)
  return { ...card, cardId: card.cardId.trim(), owner, source, createdAt }
}

function validateCard(card: Card): string | null {
  if (!card || typeof card !== 'object') return '資料不是卡片物件'
  if (typeof card.cardId !== 'string' || !card.cardId.trim()) return '缺少 cardId'
  if (!Number.isInteger(card.speciesId) || !SPECIES[card.speciesId]) return `speciesId 無效（${String(card.speciesId)}）`
  if (!Number.isInteger(card.level) || card.level < 1 || card.level > 100) return `level 需為 1..100（${String(card.level)}）`
  return null
}

let seeding: Promise<void> | null = null
function seedMarker(): boolean {
  if (typeof localStorage === 'undefined') return false
  try { return localStorage.getItem(SEED_MARKER_KEY) === '1' } catch { return false }
}

function markSeeded(): void {
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(SEED_MARKER_KEY, '1') } catch { /* private mode / quota */ }
}

function ensureSeeded(): Promise<void> {
  if (!hasIDB()) return Promise.resolve()
  if (!seeding) {
    seeding = readReq<number>((s) => s.count()).then(async (n) => {
      if (n === 0 && !seedMarker()) {
        const createdAt = Date.now()
        await writeAll((s) => PLAYER_CARDS.forEach((card) => s.put(withCardLibraryMetadata(card, createdAt, 'starter'))))
      }
      // Persist initialization separately from card rows. A player may delete
      // every card intentionally; an app reload must keep the library empty
      // instead of reseeding the starter hand on every boot.
      markSeeded()
    }).catch((cause: unknown) => {
      seeding = null
      throw cause
    })
  }
  return seeding
}

function storageError(cause: unknown): CardLibraryError {
  const message = cause instanceof Error && cause.message ? cause.message : String(cause)
  return new CardLibraryError('storage', `卡庫保存失敗：${message}`)
}

function assertCards(cards: Card[]): void {
  for (const card of cards) {
    const error = validateCard(card)
    if (error) throw new CardLibraryError('invalid-card', error)
  }
}

/** 新增/覆寫多張卡（存檔 seed 與相容 caller 用）。 */
export async function putCards(cards: Card[], options: { source?: CardSource } = {}): Promise<void> {
  if (!hasIDB()) throw new CardLibraryError('storage', '此瀏覽器不支援 IndexedDB，無法保存卡庫')
  if (cards.length === 0) return
  assertCards(cards)
  await enqueue(async () => {
    try {
      await ensureSeeded()
      const now = Date.now()
      await writeAll((s) => cards.forEach((card) => s.put(withCardLibraryMetadata(card, now, options.source))))
    } catch (cause) {
      throw cause instanceof CardLibraryError ? cause : storageError(cause)
    }
    bumpSaveMeta(Date.now()) // 卡庫變動 → 存檔變新
    emit()
  })
}

/**
 * 嚴格新增卡片：同一批或既有卡庫已有的 cardId 都會整批拒絕，避免匯入
 * 靜默覆寫既有卡，也讓手動建立與匯入共享同一個 atomic boundary。
 */
export async function addCards(cards: Card[], source: CardSource): Promise<Card[]> {
  if (!hasIDB()) throw new CardLibraryError('storage', '此瀏覽器不支援 IndexedDB，無法保存卡庫')
  if (cards.length === 0) return []
  assertCards(cards)
  const ids = new Set<string>()
  for (const card of cards) {
    const id = card.cardId.trim()
    if (ids.has(id)) throw new CardLibraryError('duplicate-card', `同一批資料含重複 cardId：${id}`)
    ids.add(id)
  }

  return enqueue(async () => {
    try {
      await ensureSeeded()
      const existing = await readReq<Card[]>((s) => s.getAll())
      const existingIds = new Set(existing.map((card) => card.cardId))
      const duplicate = [...ids].find((id) => existingIds.has(id))
      if (duplicate) throw new CardLibraryError('duplicate-card', `卡片 ${duplicate} 已存在，未覆寫既有資料。`)
      const now = Date.now()
      const stored = cards.map((card) => withCardLibraryMetadata(card, now, source))
      await writeAll((s) => stored.forEach((card) => s.add(card)))
      bumpSaveMeta(Date.now())
      emit()
      return stored
    } catch (cause) {
      throw cause instanceof CardLibraryError ? cause : storageError(cause)
    }
  })
}

/** 匯入存檔：整批取代卡庫（清空後寫入 incoming）。meta 由匯入流程 adoptMeta 設定。 */
export async function replaceAllCards(cards: Card[]): Promise<void> {
  if (!hasIDB()) throw new CardLibraryError('storage', '此瀏覽器不支援 IndexedDB，無法保存卡庫')
  assertCards(cards)
  await enqueue(async () => {
    try {
      await ensureSeeded()
      const now = Date.now()
      const stored = cards.map((card) => withCardLibraryMetadata(card, now))
      await writeAll((s) => {
        s.clear()
        stored.forEach((card) => s.put(card))
      })
    } catch (cause) {
      throw cause instanceof CardLibraryError ? cause : storageError(cause)
    }
    // replaceAll is part of save import; adoptMeta intentionally owns the
    // following meta lineage write, so this operation must not bump it.
    seeding = Promise.resolve()
    emit()
  })
}

/** 反查一張卡（掃卡用）。無 IndexedDB 時退回 PLAYER_CARDS。 */
export async function getCard(cardId: string): Promise<Card | null> {
  if (!hasIDB()) {
    const card = PLAYER_CARDS.find((candidate) => candidate.cardId === cardId)
    return card ? withCardLibraryMetadata(card, 0, 'starter') : null
  }
  await ensureSeeded()
  const card = await readReq<Card | undefined>((s) => s.get(cardId) as IDBRequest<Card | undefined>)
  if (!card || validateCard(card)) return null
  return withCardLibraryMetadata(card, 0)
}

/** 列出整個卡庫（卡庫管理 / QR 產生器用）。 */
export async function listCards(): Promise<Card[]> {
  if (!hasIDB()) return PLAYER_CARDS.map((card) => withCardLibraryMetadata(card, 0, 'starter'))
  await ensureSeeded()
  const all = await readReq<Card[]>((s) => s.getAll())
  return all
    .filter((card) => !validateCard(card))
    .map((card) => withCardLibraryMetadata(card, 0))
    .sort((a, b) => a.speciesId - b.speciesId || a.cardId.localeCompare(b.cardId))
}

/** 刪除一張卡。 */
export async function deleteCard(cardId: string): Promise<void> {
  if (!hasIDB()) throw new CardLibraryError('storage', '此瀏覽器不支援 IndexedDB，無法刪除卡片')
  await enqueue(async () => {
    try {
      await ensureSeeded()
      await writeAll((s) => s.delete(cardId))
    } catch (cause) {
      throw cause instanceof CardLibraryError ? cause : storageError(cause)
    }
    bumpSaveMeta(Date.now()) // 卡庫變動 → 存檔變新
    emit()
  })
}
