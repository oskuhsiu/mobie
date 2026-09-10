// M14.a — 戰鬥回放純 codec（比照 save/bundle.ts：穩定鍵序 encode + 嚴格 decode + 分類錯誤 + crc）。
// player 只吃 decode 過的 ReplayLog；.txt 戰報是另一條投影路徑（report.ts），永不被 decode。

import { crc32Str } from '@/game/crc32'
import type { BattleEvent } from '@/game/battle/reducer'
import {
  REPLAY_FORMAT_VERSION,
  type ReplayLog,
  type ReplayTurn,
  type ReplayHeader,
  type DisplayUnitSnapshot,
  type ReplayInput,
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
  comboCast: true,
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
/**
 * 純版本升級（vN → 目前版）。v1→v2（M12.d comboCast）為**純加法** event variant：
 * 舊 v1 紀錄不含 comboCast、結構不變，故無需轉換、直接相容（decoder 已放行 formatVersion≤目前版）。
 * 未來若有破壞性 schema 變更，在此依 log.header.formatVersion 補實際遷移。
 */
export function migrateReplay(log: ReplayLog): ReplayLog {
  return log
}

// ── decode ────────────────────────────────────────────────────────────
function fail(error: ReplayDecodeError, message: string): DecodeFail {
  return { ok: false, error, message }
}

const QTE_QUALITIES = new Set(['perfect', 'good', 'normal', 'weak'])

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isSnapshot(raw: unknown): raw is DisplayUnitSnapshot {
  if (!raw || typeof raw !== 'object') return false
  const o = raw as Record<string, unknown>
  const side = o.side
  const slot = o.slot
  return (
    typeof o.instanceId === 'string' && o.instanceId.length > 0 &&
    (side === 'player' || side === 'foe') &&
    isIndex(slot) && o.instanceId === `${side}:${slot}` &&
    Number.isInteger(o.speciesId) && Number(o.speciesId) > 0 &&
    typeof o.displayName === 'string' && o.displayName.length > 0 &&
    Number.isFinite(o.level) && Number(o.level) > 0 &&
    isFiniteNumber(o.maxHp) && o.maxHp > 0 &&
    isFiniteNumber(o.initialHp) && o.initialHp >= 0 && o.initialHp <= o.maxHp &&
    typeof o.shiny === 'boolean'
  )
}

function isQuality(value: unknown): boolean {
  return value === undefined || (typeof value === 'string' && QTE_QUALITIES.has(value))
}

function isReplayInput(raw: unknown): raw is ReplayInput {
  if (!raw || typeof raw !== 'object') return false
  const o = raw as Record<string, unknown>
  if (o.type === 'ATTACK') {
    return isQuality(o.quality)
      && (o.mashCount === undefined || (Number.isInteger(o.mashCount) && Number(o.mashCount) >= 0))
      && (o.starStrike === undefined || typeof o.starStrike === 'boolean')
      && (o.slotIndex === undefined || (Number.isInteger(o.slotIndex) && Number(o.slotIndex) >= 0 && Number(o.slotIndex) <= 2))
  }
  if (o.type === 'SWITCH') {
    return Number.isInteger(o.index) && Number(o.index) >= 0 && Number(o.index) <= 2 && isQuality(o.defenseQuality)
  }
  if (o.type === 'CHAIN') {
    return Array.isArray(o.hits) && o.hits.every((hit) => {
      if (!hit || typeof hit !== 'object') return false
      const h = hit as Record<string, unknown>
      return Number.isInteger(h.attackerIndex) && Number(h.attackerIndex) >= 0 && Number(h.attackerIndex) <= 2 && isQuality(h.quality) && h.quality !== undefined
    })
  }
  return false
}

function isSide(value: unknown): value is 'player' | 'foe' {
  return value === 'player' || value === 'foe'
}

function isIndex(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 2
}

function isOptionalFinite(value: unknown, predicate: (number: number) => boolean = () => true): boolean {
  return value === undefined || (isFiniteNumber(value) && predicate(value))
}

function isBattleEventShape(raw: unknown): raw is BattleEvent {
  if (!raw || typeof raw !== 'object') return false
  const o = raw as Record<string, unknown>
  switch (o.type) {
    case 'damageApplied':
      return isSide(o.attackerSide) && isIndex(o.attackerIndex) && isSide(o.targetSide) && isIndex(o.targetIndex)
        && isFiniteNumber(o.amount) && o.amount >= 0 && typeof o.missed === 'boolean' && typeof o.crit === 'boolean'
        && isFiniteNumber(o.effectiveness) && (o.effectivenessText === null || typeof o.effectivenessText === 'string')
        && isFiniteNumber(o.hpBefore) && o.hpBefore >= 0 && isFiniteNumber(o.hpAfter) && o.hpAfter >= 0
        && isFiniteNumber(o.maxHp) && o.maxHp > 0 && isOptionalFinite(o.resolvedMoveId, (number) => Number.isInteger(number) && number >= 0)
    case 'memberFainted':
      return isSide(o.side) && isIndex(o.index)
    case 'heal':
      return isSide(o.side) && isIndex(o.index) && isFiniteNumber(o.amount) && o.amount >= 0
        && isFiniteNumber(o.hpBefore) && o.hpBefore >= 0 && isFiniteNumber(o.hpAfter) && o.hpAfter >= 0
        && isFiniteNumber(o.maxHp) && o.maxHp > 0 && typeof o.source === 'string'
    case 'activeChanged':
      return isSide(o.side) && isIndex(o.fromIndex) && isIndex(o.toIndex) && typeof o.forced === 'boolean'
    case 'switchDefenseResolved':
      return isSide(o.side) && isIndex(o.index) && typeof o.defenseQuality === 'string' && QTE_QUALITIES.has(o.defenseQuality)
        && isFiniteNumber(o.damageMult) && o.damageMult >= 0
    case 'battleEnded':
      return isSide(o.winner) && (o.reason === undefined || o.reason === 'timeout')
    case 'random': {
      if (!o.event || typeof o.event !== 'object') return false
      const event = o.event as Record<string, unknown>
      return (event.type === 'accuracy' || event.type === 'crit' || event.type === 'supportRoulette' || event.type === 'ballRoulette')
        && typeof event.actorId === 'string' && isFiniteNumber(event.roll) && typeof event.outcome === 'string' && typeof event.source === 'string'
    }
    case 'chainOpportunity':
      return Number.isInteger(o.maxHits) && Number(o.maxHits) > 0 && Array.isArray(o.eligibleIndices) && o.eligibleIndices.every(isIndex)
    case 'chainHit':
      return Number.isInteger(o.comboCount) && Number(o.comboCount) > 0 && isIndex(o.attackerIndex)
    case 'comboCast':
      return typeof o.key === 'string' && typeof o.name === 'string' && typeof o.icon === 'string'
        && (o.castKind === 'infuseTerrain' || o.castKind === 'teamBuff' || o.castKind === 'enemyDebuff')
        && typeof o.label === 'string' && isFiniteNumber(o.remaining) && o.remaining >= 0
    case 'wildAccident':
      return o.kind === 'terrainShift' || o.kind === 'intrusion'
        ? isOptionalFinite(o.amount, (number) => number >= 0) && isOptionalFinite(o.hpAfter, (number) => number >= 0)
          && (o.side === undefined || isSide(o.side)) && (o.index === undefined || isIndex(o.index))
          && (o.terrainId === undefined || typeof o.terrainId === 'string')
        : false
    case 'statusApplied':
      return isSide(o.side) && isIndex(o.index) && Number.isInteger(o.moveId) && Number(o.moveId) > 0
        && (o.effectKind === 'buff' || o.effectKind === 'heal' || o.effectKind === 'terrain')
        && typeof o.label === 'string' && isFiniteNumber(o.remaining) && o.remaining >= 0
        && isOptionalFinite(o.healAmount, (number) => number >= 0) && isOptionalFinite(o.hpAfter, (number) => number >= 0)
        && (o.terrainId === undefined || typeof o.terrainId === 'string')
    default:
      return false
  }
}

function isHeader(raw: unknown): raw is ReplayHeader {
  if (!raw || typeof raw !== 'object') return false
  const o = raw as Record<string, unknown>
  return (
    Number.isInteger(o.formatVersion) && Number(o.formatVersion) >= 1 &&
    typeof o.battleId === 'string' && o.battleId.length > 0 &&
    typeof o.battleSeed === 'string' &&
    isFiniteNumber(o.createdAt) &&
    typeof o.regionId === 'string' &&
    (o.mode === 'arena' || o.mode === 'wild') &&
    (o.outcome === 'win' || o.outcome === 'lose') &&
    Array.isArray(o.snapshot) && o.snapshot.length > 0 && o.snapshot.every(isSnapshot) &&
    (o.durationMs === undefined || (isFiniteNumber(o.durationMs) && o.durationMs >= 0))
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
    if (!turn || typeof turn !== 'object' || !Array.isArray(turn.events) || !isReplayInput(turn.input)) {
      return fail('bad-shape', '回放的某個回合結構不正確。')
    }
    for (const ev of turn.events) {
      if (!ev || typeof ev !== 'object') return fail('bad-shape', '回放含有不正確的事件資料。')
      const t = (ev as { type?: unknown })?.type
      if (typeof t !== 'string' || !KNOWN_EVENT_TYPES.has(t)) {
        return fail('unknown-event', `回放含未知事件「${String(t)}」，無法安全播放。`)
      }
      if (!isBattleEventShape(ev)) return fail('bad-shape', `回放事件「${t}」資料不完整，無法安全播放。`)
    }
  }

  // 校驗 turns。舊檔可能完全沒有 checksum；欄位若存在卻不是字串，
  // 則視為損壞，不能悄悄降級成未校驗的舊檔。
  if ('checksum' in header) {
    if (typeof header.checksum !== 'string') return fail('bad-shape', '回放校驗欄位格式不正確。')
    if (turnsChecksum(turns) !== header.checksum) {
      return fail('bad-checksum', '回放校驗失敗，檔案可能已損毀或被竄改。')
    }
  }

  return { ok: true, log: migrateReplay({ header, turns }) }
}
