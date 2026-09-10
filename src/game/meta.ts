// M10 — 圖鑑 / 成就 meta slice（mobie.meta.v1）。設計真相：plan/10 §3。
//
// 獨立命名空間（與 roster 無關），**不違反「只存 canonical OwnedUnit」**——meta 是另一 slice（S8）。
// 三層語義避免雙真相（plan/10 §3.2）：
//   currentlyOwned＝由 roster 即時派生（不存 meta）——「現在隊上/庫裡有哪些種」。
//   registered    ＝歷史曾捕獲，**單調遞增、進化不倒退**（圖鑑「已捕」用這個）。
//   seen          ＝看過但沒捕（roster 推不出，必存）。
// stats / achievements 累計量 roster 也推不出，故存 meta。純函數可單測；localStorage I/O 薄、無 LS 時退回預設。

import type { OwnedUnit } from '@/game/types'
import type { AchievementClaimOutbox } from '@/game/achievementClaim'

export const META_SCHEMA_VERSION = 1
export const META_KEY = 'mobie.meta.v1'
const SETTLEMENT_FIELD = 'resultSettlements'
const HATCH_FIELD = 'hatchSettlements'

export interface MetaStats {
  captures: number // 累計收服數
  wins: number // 野外勝利數
  arenaWins: number // 競技場勝利數
  evolutions: number // 進化次數
  shinies: number // 收服到的異色數
  towerClears: number // 連勝塔通關數（M11 用，先留欄）
}

export interface MetaState {
  schemaVersion: number
  registered: number[] // 歷史已捕（sorted、單調）
  seen: number[] // 看過沒捕（sorted）
  stats: MetaStats
  /** 成就領取狀態：id → claimedAt（present＝已領取）。是否「解鎖」由 computeAchievements 派生。 */
  achievements: Record<string, number>
  /** Ticket 40 durable claim outbox. Pending entries retain the exact reward payload. */
  achievementClaims?: AchievementClaimOutbox[]
}

function zeroStats(): MetaStats {
  return { captures: 0, wins: 0, arenaWins: 0, evolutions: 0, shinies: 0, towerClears: 0 }
}

export function defaultMeta(): MetaState {
  return {
    schemaVersion: META_SCHEMA_VERSION,
    registered: [],
    seen: [],
    stats: zeroStats(),
    achievements: {},
    achievementClaims: [],
  }
}

// ── 純更新（immutable，無變動則回原物件，方便 store 判斷是否需存檔）──

const sortedUnique = (arr: number[]): number[] => [...new Set(arr)].sort((a, b) => a - b)

/** 加入「歷史已捕」（單調）；無新增則回原 meta（registered 本就 sorted-unique → 等長即無新增）。 */
export function addRegistered(meta: MetaState, ids: number[]): MetaState {
  const merged = sortedUnique([...meta.registered, ...ids])
  return merged.length === meta.registered.length ? meta : { ...meta, registered: merged }
}

/** 加入「看過」（未登錄者才記；已 registered 不必再記 seen）；無新增則回原 meta。 */
export function addSeen(meta: MetaState, ids: number[]): MetaState {
  const reg = new Set(meta.registered)
  const set = new Set(meta.seen)
  let changed = false
  for (const id of ids) if (!reg.has(id) && !set.has(id)) { set.add(id); changed = true }
  return changed ? { ...meta, seen: sortedUnique([...set]) } : meta
}

/** 累加一項統計。 */
export function bumpStat(meta: MetaState, key: keyof MetaStats, n = 1): MetaState {
  return { ...meta, stats: { ...meta.stats, [key]: meta.stats[key] + n } }
}

/** 標記成就已領取（claimedAt）。 */
export function markClaimed(meta: MetaState, id: string, at: number): MetaState {
  if (meta.achievements[id]) return meta
  return { ...meta, achievements: { ...meta.achievements, [id]: at } }
}

/** 當前擁有的物種（由 roster 即時派生，不存 meta）。 */
export function currentlyOwnedSpecies(roster: OwnedUnit[]): Set<number> {
  return new Set(roster.map((u) => u.speciesId))
}

/** 圖鑑單格三態（owned 由 roster 疊加判定）。 */
export type DexState = 'unseen' | 'seen' | 'registered' | 'owned'

export function dexStateOf(speciesId: number, meta: MetaState, owned: Set<number>): DexState {
  if (owned.has(speciesId)) return 'owned'
  if (meta.registered.includes(speciesId)) return 'registered'
  if (meta.seen.includes(speciesId)) return 'seen'
  return 'unseen'
}

// ── 遷移 / 持久化（薄）──

export function migrateMeta(raw: unknown): MetaState {
  const base = defaultMeta()
  if (!raw || typeof raw !== 'object') return base
  const o = raw as Record<string, unknown>
  const nums = (v: unknown): number[] => (Array.isArray(v) ? sortedUnique(v.filter((x) => typeof x === 'number')) : [])
  const rawStats = (o.stats && typeof o.stats === 'object' ? o.stats : {}) as Record<string, unknown>
  const stats = zeroStats()
  for (const k of Object.keys(stats) as (keyof MetaStats)[]) {
    if (typeof rawStats[k] === 'number') stats[k] = rawStats[k] as number
  }
  const ach: Record<string, number> = {}
  if (o.achievements && typeof o.achievements === 'object') {
    for (const [id, at] of Object.entries(o.achievements as Record<string, unknown>)) {
      if (typeof at === 'number') ach[id] = at
    }
  }
  const achievementClaims = Array.isArray(o.achievementClaims)
    ? o.achievementClaims.filter((claim): claim is AchievementClaimOutbox => (
      !!claim && typeof claim === 'object'
      && typeof (claim as AchievementClaimOutbox).claimOperationId === 'string'
      && typeof (claim as AchievementClaimOutbox).rewardFingerprint === 'string'
      && typeof (claim as AchievementClaimOutbox).achievementId === 'string'
      && ((claim as AchievementClaimOutbox).status === 'pending' || (claim as AchievementClaimOutbox).status === 'settled')
      && !!(claim as AchievementClaimOutbox).reward
    ))
    : []
  return {
    schemaVersion: typeof o.schemaVersion === 'number' ? o.schemaVersion : base.schemaVersion,
    registered: nums(o.registered),
    seen: nums(o.seen),
    stats,
    achievements: ach,
    achievementClaims,
  }
}

function hasLS(): boolean {
  return typeof localStorage !== 'undefined'
}

function existingSettlementMarkers(): unknown[] | undefined {
  if (!hasLS()) return undefined
  try {
    const raw = localStorage.getItem(META_KEY)
    if (!raw) return undefined
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const markers = (parsed as Record<string, unknown>)[SETTLEMENT_FIELD]
    return Array.isArray(markers) ? markers : undefined
  } catch {
    return undefined
  }
}

function existingAchievementClaims(): unknown[] | undefined {
  if (!hasLS()) return undefined
  try {
    const raw = localStorage.getItem(META_KEY)
    if (!raw) return undefined
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const claims = (parsed as Record<string, unknown>).achievementClaims
    return Array.isArray(claims) ? claims : undefined
  } catch {
    return undefined
  }
}

function existingHatchMarkers(): unknown[] | undefined {
  if (!hasLS()) return undefined
  try {
    const raw = localStorage.getItem(META_KEY)
    if (!raw) return undefined
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const hatch = (parsed as Record<string, unknown>)[HATCH_FIELD]
    return Array.isArray(hatch) ? hatch : undefined
  } catch {
    return undefined
  }
}

function encodeMeta(
  meta: MetaState,
  markers: unknown[] | undefined,
  claims: unknown[] | undefined,
  hatchMarkers: unknown[] | undefined = existingHatchMarkers(),
): string {
  return JSON.stringify({
    ...meta,
    ...(markers ? { [SETTLEMENT_FIELD]: markers } : {}),
    ...(claims ? { achievementClaims: claims } : {}),
    ...(hatchMarkers ? { [HATCH_FIELD]: hatchMarkers } : {}),
  })
}

export function loadMeta(): MetaState {
  if (!hasLS()) return defaultMeta()
  try {
    const raw = localStorage.getItem(META_KEY)
    return raw ? migrateMeta(JSON.parse(raw)) : defaultMeta()
  } catch {
    return defaultMeta()
  }
}

/** Bootstrap read: preserve storage errors so the Title can offer Retry instead of seeding over them. */
export function loadMetaStrict(): MetaState {
  if (!hasLS()) return defaultMeta()
  const raw = localStorage.getItem(META_KEY)
  if (raw === null) return defaultMeta()
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    throw new Error(`讀取圖鑑與成就失敗：${cause instanceof Error ? cause.message : String(cause)}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('讀取圖鑑與成就失敗：資料格式無效')
  }
  const record = parsed as Record<string, unknown>
  if (
    !Array.isArray(record.registered)
    || !Array.isArray(record.seen)
    || !record.stats || typeof record.stats !== 'object' || Array.isArray(record.stats)
    || !record.achievements || typeof record.achievements !== 'object' || Array.isArray(record.achievements)
  ) throw new Error('讀取圖鑑與成就失敗：資料格式無效')
  return migrateMeta(record)
}

export function saveMetaState(meta: MetaState): void {
  if (!hasLS()) return
  try {
    localStorage.setItem(META_KEY, encodeMeta(meta, existingSettlementMarkers(), meta.achievementClaims ?? existingAchievementClaims()))
  } catch {
    /* 配額/隱私模式：忽略 */
  }
}

/** Bootstrap write: report a storage failure instead of presenting an unpersisted ready state. */
export function saveMetaStateStrict(meta: MetaState): void {
  if (!hasLS()) return
  try {
    localStorage.setItem(META_KEY, encodeMeta(meta, existingSettlementMarkers(), meta.achievementClaims ?? existingAchievementClaims()))
  } catch (cause) {
    throw new Error(`保存圖鑑與成就失敗：${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

/** Child-boundary write: canonical Meta and its settlement markers share one envelope. */
export function saveMetaStateWithSettlementMarkersStrict(meta: MetaState, markers: unknown[]): void {
  if (!hasLS()) return
  try {
    localStorage.setItem(META_KEY, encodeMeta(meta, markers, meta.achievementClaims ?? existingAchievementClaims()))
  } catch (cause) {
    throw new Error(`保存 Meta 結算資料失敗：${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

/** Hatch child-boundary write: canonical Meta/Dex data and hatch markers share one envelope. */
export function saveMetaStateWithHatchMarkersStrict(meta: MetaState, hatchMarkers: unknown[]): void {
  if (!hasLS()) return
  try {
    localStorage.setItem(META_KEY, encodeMeta(meta, existingSettlementMarkers(), meta.achievementClaims ?? existingAchievementClaims(), hatchMarkers))
  } catch (cause) {
    throw new Error(`保存孵化圖鑑結算資料失敗：${cause instanceof Error ? cause.message : String(cause)}`)
  }
}
