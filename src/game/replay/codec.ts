// M14.a — 戰鬥回放純 codec（比照 save/bundle.ts：穩定鍵序 encode + 嚴格 decode + 分類錯誤 + crc）。
// player 只吃 decode 過的 ReplayLog；.txt 戰報是另一條投影路徑（report.ts），永不被 decode。

import { crc32Str } from '@/game/crc32'
import type { BattleEvent } from '@/game/battle/reducer'
import {
  REPLAY_FORMAT_VERSION,
  type ReplayLog,
  type ReplayTurn,
  type ReplayHeader,
} from './types'

// reducer 目前會吐的所有 BattleEvent type；decode 時逐 event 驗白名單（plan/15 §2 unknown-event fail-fast）。
// 用 Record<BattleEvent['type'], true> 綁定到 union：reducer 新增 event variant（M12 合體技…）時，
// 若忘了在此補一筆會「編譯失敗」——正是 plan/15 §10 要的耦合治理（bump version + 加 handler 的強制提醒）。
const KNOWN_EVENT_MAP: Record<BattleEvent['type'], true> = {
  damageApplied: true,
  memberFainted: true,
  heal: true,
  activeChanged: true,
  switchDefenseResolved: true,
  battleEnded: true,
  random: true,
  chainOpportunity: true,
  chainHit: true,
  wildAccident: true,
  statusApplied: true,
}
export const KNOWN_EVENT_TYPES = new Set<string>(Object.keys(KNOWN_EVENT_MAP))

export type ReplayDecodeError =
  | 'not-json' // JSON 解析失敗
  | 'bad-shape' // 結構不符（缺 header/turns）
  | 'version-too-new' // 由更新版產生，本版讀不了（不嘗試降級）
  | 'unknown-event' // 出現未知 event variant（前向不相容）
  | 'bad-checksum' // turns 校驗不符（截斷/手改/損毀）

export interface DecodeOk {
  ok: true
  log: ReplayLog
}
export interface DecodeFail {
  ok: false
  error: ReplayDecodeError
  message: string
}
export type DecodeResult = DecodeOk | DecodeFail

// ── 穩定鍵序序列化（遞迴排序物件鍵；陣列順序保留）──────────────────────
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const o = value as Record<string, unknown>
  const keys = Object.keys(o).sort()
  const parts = keys
    .filter((k) => o[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
  return `{${parts.join(',')}}`
}

/** turns 的 crc32（穩定鍵序），放 header.checksum。 */
function turnsChecksum(turns: ReplayTurn[]): string {
  return crc32Str(stableStringify(turns))
}

// ── encode ────────────────────────────────────────────────────────────
/** 把 log 序列化成穩定鍵序 JSON 字串（checksum 由本函式算入 header）。 */
export function encodeReplay(log: ReplayLog): string {
  const header: ReplayHeader = {
    ...log.header,
    formatVersion: REPLAY_FORMAT_VERSION,
    checksum: turnsChecksum(log.turns),
  }
  return stableStringify({ header, turns: log.turns })
}

// ── migrate ───────────────────────────────────────────────────────────
/** 純版本升級（vN → 目前版）。目前只有 v1，無實際遷移；未來加 event variant 在此補。 */
export function migrateReplay(log: ReplayLog): ReplayLog {
  return log
}

// ── decode ────────────────────────────────────────────────────────────
function fail(error: ReplayDecodeError, message: string): DecodeFail {
  return { ok: false, error, message }
}

function isHeader(raw: unknown): raw is ReplayHeader {
  if (!raw || typeof raw !== 'object') return false
  const o = raw as Record<string, unknown>
  return (
    typeof o.formatVersion === 'number' &&
    typeof o.battleId === 'string' &&
    typeof o.battleSeed === 'string' &&
    Array.isArray(o.snapshot)
  )
}

export function decodeReplay(text: string): DecodeResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return fail('not-json', '回放資料不是有效的 JSON。')
  }
  if (!raw || typeof raw !== 'object') return fail('bad-shape', '回放資料結構不正確。')
  const o = raw as Record<string, unknown>
  if (!isHeader(o.header) || !Array.isArray(o.turns)) {
    return fail('bad-shape', '回放資料缺少 header 或 turns。')
  }
  const header = o.header as ReplayHeader
  if (header.formatVersion > REPLAY_FORMAT_VERSION) {
    return fail('version-too-new', `此回放由更新版本（v${header.formatVersion}）產生，請先更新遊戲。`)
  }

  // 逐 turn / 逐 event 驗白名單（含未知 variant fail-fast）
  const turns = o.turns as ReplayTurn[]
  for (const turn of turns) {
    if (!turn || typeof turn !== 'object' || !Array.isArray(turn.events) || !turn.input) {
      return fail('bad-shape', '回放的某個回合結構不正確。')
    }
    for (const ev of turn.events) {
      const t = (ev as { type?: unknown })?.type
      if (typeof t !== 'string' || !KNOWN_EVENT_TYPES.has(t)) {
        return fail('unknown-event', `回放含未知事件「${String(t)}」，無法安全播放。`)
      }
    }
  }

  // 校驗 turns（header.checksum 若存在才比對；舊檔可能無）
  if (typeof header.checksum === 'string') {
    if (turnsChecksum(turns) !== header.checksum) {
      return fail('bad-checksum', '回放校驗失敗，檔案可能已損毀或被竄改。')
    }
  }

  return { ok: true, log: migrateReplay({ header, turns }) }
}
