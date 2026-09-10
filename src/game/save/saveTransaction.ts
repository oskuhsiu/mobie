import type { Card, OwnedUnit } from '@/game/types'
import type { SaveMeta } from './saveMeta'

export const SAVE_TRANSACTION_SCHEMA_VERSION = 1
export const SAVE_TRANSACTION_KEY = 'mobie.save.transaction.v1'

export interface SaveCanonicalSnapshot {
  roster: OwnedUnit[]
  cards: Card[]
  meta: SaveMeta
}

export interface SaveTransactionRecord {
  schemaVersion: number
  status: 'pending' | 'committed'
  kind: 'import' | 'restore'
  before: SaveCanonicalSnapshot
  incoming: SaveCanonicalSnapshot
  startedAt: number
}

function hasStorage(): boolean {
  return typeof localStorage !== 'undefined'
}

function validSnapshot(value: unknown): value is SaveCanonicalSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return Array.isArray(record.roster)
    && Array.isArray(record.cards)
    && Boolean(record.meta && typeof record.meta === 'object' && !Array.isArray(record.meta))
}

function validRecord(value: unknown): value is SaveTransactionRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record.schemaVersion === SAVE_TRANSACTION_SCHEMA_VERSION
    && (record.status === 'pending' || record.status === 'committed')
    && (record.kind === 'import' || record.kind === 'restore')
    && typeof record.startedAt === 'number'
    && validSnapshot(record.before)
    && validSnapshot(record.incoming)
}

/** Strictly read the crash-recovery journal; malformed data must stop saves. */
export function loadSaveTransactionStrict(): SaveTransactionRecord | null {
  if (!hasStorage()) return null
  const raw = localStorage.getItem(SAVE_TRANSACTION_KEY)
  if (raw === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    throw new Error(`讀取存檔交易回復資料失敗：${cause instanceof Error ? cause.message : String(cause)}`)
  }
  if (!validRecord(parsed)) throw new Error('讀取存檔交易回復資料失敗：資料格式無效')
  return parsed
}

export function saveSaveTransactionStrict(record: SaveTransactionRecord): void {
  if (!hasStorage()) return
  try {
    localStorage.setItem(SAVE_TRANSACTION_KEY, JSON.stringify(record))
  } catch (cause) {
    throw new Error(`保存存檔交易回復資料失敗：${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

export function clearSaveTransactionStrict(): void {
  if (!hasStorage()) return
  try {
    localStorage.removeItem(SAVE_TRANSACTION_KEY)
  } catch (cause) {
    throw new Error(`清除存檔交易回復資料失敗：${cause instanceof Error ? cause.message : String(cause)}`)
  }
}
