// M5 / M24 Ticket 44：把純粹的 packSave/unpackSave 接到真實 store I/O 與
// 瀏覽器分享 / 下載。這裡保留 no-model 邊界：custom GLB 不讀、不寫、不清理。

import type { Card, OwnedUnit } from '@/game/types'
import { SPECIES } from '@/game/data/species'
import { packSave, unpackSave, type UnpackResult, type UnpackOk } from './bundle'
import { loadMeta, adoptMetaStrict, type SaveMeta } from './saveMeta'
import { listCards, replaceAllCards } from '@/game/cardLibrary'
import { saveBackup, loadBackupBytes } from './backupStore'
import { useRoster } from '@/store/rosterStore'
import { LocalStorageAdapter, ROSTER_STORAGE_KEY } from '@/game/persistence'
import { assertSaveOperationsIdle, beginSaveMutation } from './saveOperationGuard'
import {
  clearSaveTransactionStrict,
  loadSaveTransactionStrict,
  saveSaveTransactionStrict,
  SAVE_TRANSACTION_SCHEMA_VERSION,
  type SaveCanonicalSnapshot,
} from './saveTransaction'

export interface BuiltSave {
  bytes: Uint8Array
  filename: string
  meta: SaveMeta
  /** 打包後的位元組大小（給 UI 顯示 / 判斷分享可行性） */
  size: number
}

/**
 * Serialise save mutations. A repeated click/remount for the same import or
 * restore shares the in-flight promise; a different mutation gets a clear
 * recoverable error instead of racing two whole-save replacements.
 */
let activeMutation: { key: string; promise: Promise<unknown> } | null = null

function runMutation<T>(key: string, task: () => Promise<T>, options: { allowTransactionRecovery?: boolean } = {}): Promise<T> {
  if (activeMutation) {
    if (activeMutation.key === key) return activeMutation.promise as Promise<T>
    return Promise.reject(new Error('另一個存檔操作正在進行中，請稍候再試。'))
  }
  let release: (() => void) | undefined
  try {
    release = beginSaveMutation(options)
  } catch (error) {
    return Promise.reject(error)
  }
  const promise = Promise.resolve().then(task)
  activeMutation = { key, promise }
  promise.then(
    () => {
      release?.()
      if (activeMutation?.promise === promise) activeMutation = null
    },
    () => {
      release?.()
      if (activeMutation?.promise === promise) activeMutation = null
    },
  )
  return promise
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function comparableCard(card: Card): Record<string, unknown> {
  return {
    cardId: card.cardId,
    speciesId: card.speciesId,
    level: card.level,
    ...(card.ivs ? { ivs: card.ivs } : {}),
    ...(card.nature !== undefined ? { nature: card.nature } : {}),
    ...(card.shiny !== undefined ? { shiny: card.shiny } : {}),
    ...(card.heldItemId ? { heldItemId: card.heldItemId } : {}),
    ...(card.equippedMoveIds ? { equippedMoveIds: card.equippedMoveIds } : {}),
  }
}

async function readCanonicalSnapshot(): Promise<SaveCanonicalSnapshot> {
  // The Zustand projection is the live authority after bootstrap. Prefer the
  // persisted value when it exists so direct callers and a remount see the
  // same canonical bytes; an empty persisted roster is still represented by
  // an intentionally empty live roster.
  const persisted = await new LocalStorageAdapter().loadRoster()
  const live = useRoster.getState().roster
  const hasPersistedEnvelope = typeof localStorage !== 'undefined' && localStorage.getItem(ROSTER_STORAGE_KEY) !== null
  const roster = hasPersistedEnvelope || live.length === 0 ? persisted : live
  return { roster, cards: await listCards(), meta: loadMeta() }
}

function sameCanonical(left: SaveCanonicalSnapshot, right: SaveCanonicalSnapshot): boolean {
  const leftCards = [...left.cards].sort((a, b) => a.cardId.localeCompare(b.cardId)).map(comparableCard)
  const rightCards = [...right.cards].sort((a, b) => a.cardId.localeCompare(b.cardId)).map(comparableCard)
  return stableJson(left.roster) === stableJson(right.roster)
    && stableJson(leftCards) === stableJson(rightCards)
    && stableJson(left.meta) === stableJson(right.meta)
}

function validateParsed(parsed: UnpackOk): void {
  const rosterIds = new Set<string>()
  for (const unit of parsed.roster) {
    if (!unit || typeof unit.id !== 'string' || !unit.id.trim() || !SPECIES[unit.speciesId]) {
      throw new Error('匯入的 Mobie 資料結構無效，既有進度未變更。')
    }
    if (rosterIds.has(unit.id)) throw new Error(`匯入資料含重複 Mobie id（${unit.id}），既有進度未變更。`)
    rosterIds.add(unit.id)
  }

  const cardIds = new Set<string>()
  for (const card of parsed.cards) {
    if (!card || typeof card.cardId !== 'string' || !card.cardId.trim() || !Number.isInteger(card.level) || card.level < 1 || card.level > 100 || !SPECIES[card.speciesId]) {
      throw new Error(`匯入卡片資料結構無效（${card?.cardId ?? 'unknown'}），既有進度未變更。`)
    }
    if (cardIds.has(card.cardId)) throw new Error(`匯入資料含重複 cardId（${card.cardId}），既有進度未變更。`)
    cardIds.add(card.cardId)
  }
}

/**
 * 打包目前存檔成 `<profileName>.save`。roster 由呼叫端（讀 useRoster 的 live 狀態）傳入，
 * cards 從 IndexedDB 取。新格式固定只含 canonical roster / cards。
 */
export async function buildSaveFile(roster: OwnedUnit[]): Promise<BuiltSave> {
  return runMutation('export', async () => {
    await recoverSaveTransactionInternal()
    assertSaveOperationsIdle('匯出')
    const meta = loadMeta()
    const cards = await listCards()
    const bytes = packSave({ meta, roster, cards })
    const filename = `${meta.profileName || 'trainer'}.save`
    return { bytes, filename, meta, size: bytes.byteLength }
  }, { allowTransactionRecovery: true })
}

export type DeliverMethod = 'shared' | 'downloaded' | 'copied' | 'manual'

export interface DeliverResult {
  method: DeliverMethod
  /** Base64 recovery text shown when both download and clipboard are blocked. */
  recoveryText?: string
}

function base64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0
    const b = bytes[index + 1]
    const c = bytes[index + 2]
    out += alphabet[a >> 2]
    out += alphabet[((a & 3) << 4) | ((b ?? 0) >> 4)]
    out += b === undefined ? '=' : alphabet[((b & 15) << 2) | ((c ?? 0) >> 6)]
    out += c === undefined ? '=' : alphabet[c & 63]
  }
  return out
}

function recoveryTextFor(built: BuiltSave): string {
  return [
    `Mobie 存檔復原碼｜${built.filename}`,
    '下載與分享都受阻時，請完整複製這段文字保存；回到本遊戲可交給支援流程轉回 .save。',
    base64(built.bytes),
  ].join('\n')
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to the legacy textarea copy path.
  }
  try {
    if (typeof document === 'undefined') return false
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const copied = typeof document.execCommand === 'function' && document.execCommand('copy')
    area.remove()
    return copied
  } catch {
    return false
  }
}

function tryDownload(blob: Blob, built: BuiltSave): boolean {
  try {
    if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return false
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = built.filename
    anchor.style.display = 'none'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 4000)
    return true
  } catch {
    return false
  }
}

/**
 * 把存檔交給使用者。iPad PWA 優先 Web Share，桌機 / 不支援時退回下載；
 * 兩者都被瀏覽器擋下時，提供 clipboard 與可手動保存的 recovery text。
 */
async function deliverSaveFileInternal(built: BuiltSave): Promise<DeliverResult> {
  assertSaveOperationsIdle('匯出')
  const blob = new Blob([built.bytes as BlobPart], { type: 'application/zip' })
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    const file = new File([blob], built.filename, { type: 'application/zip' })
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
    let shareable = true
    try { shareable = !nav.canShare || nav.canShare({ files: [file] }) } catch { shareable = false }
    if (shareable) {
      try {
        await navigator.share({ files: [file], title: built.filename })
        return { method: 'shared' }
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') throw error
        // Other share errors (permission / file support) use download below.
      }
    }
  }

  if (tryDownload(blob, built)) return { method: 'downloaded', recoveryText: recoveryTextFor(built) }
  const recoveryText = recoveryTextFor(built)
  if (await copyText(recoveryText)) return { method: 'copied' }
  return { method: 'manual', recoveryText }
}

export async function deliverSaveFile(built: BuiltSave): Promise<DeliverResult> {
  return runMutation(`deliver:${built.filename}:${built.size}`, () => deliverSaveFileInternal(built), { allowTransactionRecovery: true })
}

// ── 匯入 ──────────────────────────────────────────────────────────────────

/** 讀 .save 檔並解析（純解析在 bundle.unpackSave；這裡只負責讀檔位元組）。 */
export async function readSaveFile(file: File): Promise<UnpackResult> {
  try {
    const buf = await file.arrayBuffer()
    return unpackSave(new Uint8Array(buf))
  } catch (cause) {
    return {
      ok: false,
      error: 'bad-payload',
      message: `無法讀取存檔檔案，請重新選擇：${cause instanceof Error ? cause.message : String(cause)}`,
    }
  }
}

async function backupSnapshot(snapshot: SaveCanonicalSnapshot, now: number): Promise<void> {
  await saveBackup(packSave(snapshot), snapshot.meta, now)
}

async function restoreCanonical(snapshot: SaveCanonicalSnapshot): Promise<void> {
  await useRoster.getState().replaceAll(snapshot.roster)
  await replaceAllCards(snapshot.cards)
  adoptMetaStrict(snapshot.meta)
}

async function recoverSaveTransactionInternal(): Promise<void> {
  const record = loadSaveTransactionStrict()
  if (!record) return
  if (record.status === 'committed') {
    try { clearSaveTransactionStrict() } catch { /* committed data is already canonical; retry cleanup later */ }
    return
  }
  await restoreCanonical(record.before)
  clearSaveTransactionStrict()
}

/** Reconcile an interrupted cross-store save before another command starts. */
export async function recoverSaveTransaction(): Promise<void> {
  // Do not claim the save mutex for the common no-journal path. Bootstrap must
  // remain free to let the achievement/hatch owners reconcile their own
  // pending outboxes after this probe.
  if (!loadSaveTransactionStrict()) return
  return runMutation('recover', recoverSaveTransactionInternal, { allowTransactionRecovery: true })
}

async function applyParsedSave(parsed: UnpackOk, options: { backupBefore: boolean; action: '匯入' | '還原' }): Promise<boolean> {
  await recoverSaveTransactionInternal()
  assertSaveOperationsIdle(options.action)
  validateParsed(parsed)
  const before = await readCanonicalSnapshot()
  const incoming: SaveCanonicalSnapshot = { roster: parsed.roster, cards: parsed.cards, meta: parsed.meta }
  // Idempotence guard: a remount/repeated click after a completed import must
  // not overwrite the useful pre-import backup with the already-imported data.
  if (sameCanonical(before, incoming)) return false

  const transaction = {
    schemaVersion: SAVE_TRANSACTION_SCHEMA_VERSION,
    status: 'pending' as const,
    kind: options.action === '匯入' ? 'import' as const : 'restore' as const,
    before,
    incoming,
    startedAt: Date.now(),
  }
  saveSaveTransactionStrict(transaction)
  try {
    if (options.backupBefore) await backupSnapshot(before, Date.now())
    await useRoster.getState().replaceAll(parsed.roster)
    await replaceAllCards(parsed.cards)
    adoptMetaStrict(parsed.meta)
    saveSaveTransactionStrict({ ...transaction, status: 'committed' })
    try { clearSaveTransactionStrict() } catch { /* committed marker is safe and will be cleaned on the next command */ }
    return true
  } catch (cause) {
    try {
      await restoreCanonical(before)
    } catch (rollbackCause) {
      throw new Error(`存檔${options.action}失敗，且回復原進度也失敗：${rollbackCause instanceof Error ? rollbackCause.message : String(rollbackCause)}`)
    }
    try { clearSaveTransactionStrict() } catch (clearCause) {
      throw new Error(`存檔${options.action}失敗，原進度已回復，但交易回復標記仍在：${clearCause instanceof Error ? clearCause.message : String(clearCause)}`)
    }
    throw new Error(`存檔${options.action}失敗，原進度已回復：${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

/**
 * 覆蓋目前存檔：先做單槽備份，再以 roster → cards → lineage 的順序完成
 * canonical replacement；任何後續 boundary 失敗都回復整份 snapshot。
 */
export async function applyImportedSave(parsed: UnpackOk): Promise<void> {
  await runMutation(`import:${parsed.manifest.checksum}`, async () => {
    await applyParsedSave(parsed, { backupBefore: true, action: '匯入' })
  }, { allowTransactionRecovery: true })
}

/** 目前存檔的獨立手動備份。 */
export async function backupCurrentSave(now = Date.now()): Promise<void> {
  await runMutation('backup', async () => {
    await recoverSaveTransactionInternal()
    assertSaveOperationsIdle('備份')
    await backupSnapshot(await readCanonicalSnapshot(), now)
  }, { allowTransactionRecovery: true })
}

/** 還原最近一次「匯入前備份」。不再覆蓋備份槽，避免第二次點擊破壞救援點。 */
export async function restoreBackup(): Promise<UnpackResult | null> {
  return runMutation('restore', async () => {
    await recoverSaveTransactionInternal()
    assertSaveOperationsIdle('還原')
    const bytes = await loadBackupBytes()
    if (!bytes) return null
    const parsed = unpackSave(bytes)
    if (parsed.ok) await applyParsedSave(parsed, { backupBefore: false, action: '還原' })
    return parsed
  }, { allowTransactionRecovery: true })
}
