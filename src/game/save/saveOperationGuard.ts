import { SAVE_TRANSACTION_KEY } from './saveTransaction'

declare global {
  interface Window {
    /** DEV-only command guard seam used by the Chrome closure runner. */
    __MOBIE_SAVE_GUARD__?: {
      assertIdle: (action: string) => void
    }
  }
}

/** Durable operations that must reach a receipt before a save can move data. */
export type SaveBlockingOperation = 'result' | 'achievement-claim' | 'hatch' | 'save-transaction' | 'storage'
export type SaveRewardOperation = Exclude<SaveBlockingOperation, 'save-transaction' | 'storage'>

export interface SaveOperationSnapshot {
  blocked: boolean
  reasons: SaveBlockingOperation[]
  message: string | null
}

const STORAGE_KEYS: Record<Exclude<SaveBlockingOperation, 'storage'>, string> = {
  result: 'mobie.result.settlement.v1',
  'achievement-claim': 'mobie.meta.v1',
  hatch: 'mobie.incubator.v1',
  'save-transaction': SAVE_TRANSACTION_KEY,
}

const activeCounts: Record<SaveRewardOperation, number> = {
  result: 0,
  'achievement-claim': 0,
  hatch: 0,
}
let saveMutationCount = 0
let resultExternalRunning = false
const listeners = new Set<() => void>()
let cachedKey = ''
let cachedSnapshot: SaveOperationSnapshot = { blocked: false, reasons: [], message: null }

type PersistedState = 'clear' | 'pending' | 'unknown'

function readPersistedState(raw: string | null, field?: string, requireArray = true): PersistedState {
  if (raw === null) return 'clear'
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return 'unknown'
  }
  const entries = field
    ? parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)[field]
      : '__invalid-root__'
    : parsed
  if (field && entries === undefined) return 'clear'
  if (field && entries === '__invalid-root__') return 'unknown'
  if (!requireArray) return entries === 'pending' ? 'pending' : entries === 'committed' ? 'clear' : 'unknown'
  if (requireArray && !Array.isArray(entries)) return 'unknown'
  if (!Array.isArray(entries)) return 'clear'
  let pending = false
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') return 'unknown'
    const status = (entry as Record<string, unknown>).status
    if (status !== 'pending' && status !== 'settled') return 'unknown'
    if (status === 'pending') pending = true
  }
  return pending ? 'pending' : 'clear'
}

function persistedState(kind: Exclude<SaveBlockingOperation, 'storage'>): PersistedState {
  if (typeof localStorage === 'undefined') return 'clear'
  try {
    const raw = localStorage.getItem(STORAGE_KEYS[kind])
    if (kind === 'result') return readPersistedState(raw)
    if (kind === 'achievement-claim') return readPersistedState(raw, 'achievementClaims')
    if (kind === 'hatch') return readPersistedState(raw, 'hatchOutbox')
    return readPersistedState(raw, 'status', false)
  } catch {
    return 'unknown'
  }
}

function computeSnapshot(): SaveOperationSnapshot {
  const reasons: SaveBlockingOperation[] = []
  const rewardKinds: SaveRewardOperation[] = ['result', 'achievement-claim', 'hatch']
  for (const kind of rewardKinds) {
    const state = persistedState(kind)
    if (activeCounts[kind] > 0 || (kind === 'result' && resultExternalRunning) || state === 'pending') reasons.push(kind)
    else if (state === 'unknown' && !reasons.includes('storage')) reasons.push('storage')
  }
  const transaction = persistedState('save-transaction')
  if (transaction === 'pending') reasons.push('save-transaction')
  else if (transaction === 'unknown' && !reasons.includes('storage')) reasons.push('storage')

  const labels: Record<SaveBlockingOperation, string> = {
    result: 'Result 結算',
    'achievement-claim': '成就獎勵領取',
    hatch: '孵化操作',
    'save-transaction': '存檔交易回復',
    storage: '存檔操作狀態讀取',
  }
  const message = reasons.length > 0
    ? reasons.includes('storage')
      ? '無法確認 durable operation 狀態，匯出、匯入、備份與還原暫時停用；請重新載入後再試。'
      : `${reasons.map((kind) => labels[kind]).join('、')}尚未完成，匯出、匯入、備份與還原暫時停用。`
    : null
  return { blocked: reasons.length > 0, reasons, message }
}

function snapshotKey(snapshot: SaveOperationSnapshot): string {
  return `${snapshot.reasons.join('|')}|${snapshot.message ?? ''}`
}

function notify(): void {
  cachedKey = ''
  for (const listener of listeners) listener()
}

function snapshot(): SaveOperationSnapshot {
  const next = computeSnapshot()
  const key = snapshotKey(next)
  if (key !== cachedKey) {
    cachedKey = key
    cachedSnapshot = next
  }
  return cachedSnapshot
}

/** Mark a process-local reward operation. Calls are reference-counted for queued retries. */
export function setSaveOperationRunning(kind: SaveRewardOperation, running: boolean): void {
  activeCounts[kind] = running ? activeCounts[kind] + 1 : Math.max(0, activeCounts[kind] - 1)
  notify()
}

/** Result projection exposes a boolean status, so its bridge is idempotent. */
export function setResultOperationRunning(running: boolean): void {
  resultExternalRunning = running
  notify()
}

/** Non-throwing start used by reward coordinators that must return a Promise rejection. */
export function tryBeginSaveOperation(kind: SaveRewardOperation): boolean {
  if (saveMutationCount > 0 || persistedState('save-transaction') !== 'clear') return false
  activeCounts[kind] += 1
  notify()
  return true
}

/** Result uses the same mutex but retains a release callback across async presentation. */
export function beginResultOperation(): (() => void) | null {
  if (saveMutationCount > 0 || persistedState('save-transaction') !== 'clear') return null
  activeCounts.result += 1
  notify()
  let released = false
  return () => {
    if (released) return
    released = true
    activeCounts.result = Math.max(0, activeCounts.result - 1)
    notify()
  }
}

/** Acquire the same process-local mutex for save mutations and return its release callback. */
export function beginSaveMutation(options: { allowTransactionRecovery?: boolean } = {}): () => void {
  if (saveMutationCount > 0) throw new Error('另一個存檔操作正在進行中，請稍候再試。')
  const current = snapshot()
  const allowedRecoveryOnly = options.allowTransactionRecovery === true
    && current.reasons.includes('save-transaction')
    && !current.reasons.includes('storage')
  if (current.blocked && !allowedRecoveryOnly) throw new Error(`${current.message ?? '存檔操作暫時停用'} 請完成目前操作後再試。`)
  saveMutationCount += 1
  notify()
  let released = false
  return () => {
    if (released) return
    released = true
    saveMutationCount = Math.max(0, saveMutationCount - 1)
    notify()
  }
}

export function getSaveOperationSnapshot(): SaveOperationSnapshot {
  return snapshot()
}

export function isSaveOperationBlocked(): boolean {
  return snapshot().blocked
}

export function subscribeSaveOperationGuard(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = () => notify()
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
  }
}

/** Command-level gate. UI state is advisory; every save mutation calls this seam. */
export function assertSaveOperationsIdle(action: string): void {
  const current = snapshot()
  if (current.blocked) throw new Error(`${current.message ?? '存檔操作暫時停用'} 請完成目前操作後再${action}。`)
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__MOBIE_SAVE_GUARD__ = {
    assertIdle: assertSaveOperationsIdle,
  }
}
