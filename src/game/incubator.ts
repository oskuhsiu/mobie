// M10 — 抽蛋孵化（Incubator，mobie.incubator.v1）。設計真相：plan/10 §5。
//
// 用遊玩進度換隨機新Mobie（**非付費 gacha**），複用 individual 決定論 roll。防線（plan/10 §5.2 寫死）：
//   egg 只存 seed/source/speciesPool/progress——**孵化才生成 OwnedUnit**、不可付費、不可刷池、不可存預生成結果。
// 進度來源＝有效戰鬥完成數 + 塔層數（不用真實時間/每日/步數，避免手遊體力感）。獨立 slice，與 roster 不同命名空間。

import type { OwnedUnit } from '@/game/types'
import { createOwnedUnit } from '@/game/growth'
import { hashSeed } from '@/game/individual'
import { getSpecies } from '@/game/data/species'
import { teachableOf } from '@/game/learnset'

export const INCUBATOR_SCHEMA_VERSION = 1
const KEY = 'mobie.incubator.v1'

export type EggSource = 'achievement' | 'duplicate' | 'tower'

export interface Egg {
  id: string
  /** 孵出個體的決定論種子（沿用 individual roll；同一顆蛋永遠孵出同一隻）。 */
  seed: string
  source: EggSource
  /** 可能孵出的 speciesId 池（依來源主題）。 */
  speciesPool: number[]
  progress: number
  requiredProgress: number
  /** 顯示用來源標籤（如「新手蛋」）。 */
  label: string
  /** M12.c 蛋招繼承（plan/12 §3）：父母傳的一個招 id；孵化時若該種族可學且未習得才落入 learnedMoveIds。 */
  inheritedMoveId?: number
}

export interface IncubatorState {
  schemaVersion: number
  eggs: Egg[]
  /** 決定論 egg id 計數（避免 Math.random，孵化結果穩定）。 */
  nextId: number
}

/** 孵出個體的起始等級。 */
export const HATCH_LEVEL = 5
/** 各來源的所需進度（戰鬥/塔層加權點數）。 */
const REQUIRED: Record<EggSource, number> = { achievement: 6, duplicate: 8, tower: 5 }

export function defaultIncubator(): IncubatorState {
  return { schemaVersion: INCUBATOR_SCHEMA_VERSION, eggs: [], nextId: 1 }
}

/** 新增一顆蛋（純函數，決定論 id/seed）。speciesPool 過濾後為空則不新增（回原 state）。 */
export function addEgg(
  state: IncubatorState,
  spec: { source: EggSource; speciesPool: number[]; label: string; inheritedMoveId?: number },
): IncubatorState {
  const pool = spec.speciesPool.filter((id) => Number.isInteger(id) && id > 0)
  if (pool.length === 0) return state
  const id = `egg-${state.nextId}`
  const inherited = Number.isInteger(spec.inheritedMoveId) && (spec.inheritedMoveId as number) > 0 ? spec.inheritedMoveId : undefined
  const egg: Egg = {
    id,
    seed: `${id}-${spec.source}`,
    source: spec.source,
    speciesPool: pool,
    progress: 0,
    requiredProgress: REQUIRED[spec.source],
    label: spec.label,
    ...(inherited ? { inheritedMoveId: inherited } : {}),
  }
  return { ...state, eggs: [...state.eggs, egg], nextId: state.nextId + 1 }
}

/** 推進所有蛋的孵化進度（夾在 requiredProgress）。amount=本次有效進度點。 */
export function advanceAll(state: IncubatorState, amount: number): IncubatorState {
  if (amount <= 0 || state.eggs.length === 0) return state
  return {
    ...state,
    eggs: state.eggs.map((e) => ({ ...e, progress: Math.min(e.requiredProgress, e.progress + amount) })),
  }
}

export const isHatchable = (e: Egg): boolean => e.progress >= e.requiredProgress

/**
 * 孵化一顆蛋 → canonical OwnedUnit（一次性、決定論）：
 *   由 seed 決定 speciesPool 中的種類 + individual roll 個體。不在此移除蛋（store 負責）。
 */
export function hatchEgg(egg: Egg): OwnedUnit {
  const speciesId = egg.speciesPool[hashSeed(egg.seed) % egg.speciesPool.length]
  const unit = createOwnedUnit(egg.seed, speciesId, HATCH_LEVEL)
  // M12.c 蛋招繼承：父母傳的招若該種族可學（teachable）且尚未習得 → 加入 learnedMoveIds（可學庫，不繞 loadout 上限）。
  if (egg.inheritedMoveId && teachableOf(getSpecies(speciesId)).includes(egg.inheritedMoveId) && !unit.learnedMoveIds?.includes(egg.inheritedMoveId)) {
    return { ...unit, learnedMoveIds: [...(unit.learnedMoveIds ?? []), egg.inheritedMoveId] }
  }
  return unit
}

// ── 遷移 / 持久化（薄）──

export function migrateIncubator(raw: unknown): IncubatorState {
  const base = defaultIncubator()
  if (!raw || typeof raw !== 'object') return base
  const o = raw as Record<string, unknown>
  const eggs: Egg[] = Array.isArray(o.eggs)
    ? o.eggs.filter((e): e is Egg =>
        !!e && typeof e === 'object'
        && typeof (e as Egg).id === 'string'
        && typeof (e as Egg).seed === 'string'
        && Array.isArray((e as Egg).speciesPool) && (e as Egg).speciesPool.length > 0)
    : []
  return {
    schemaVersion: typeof o.schemaVersion === 'number' ? o.schemaVersion : base.schemaVersion,
    eggs,
    nextId: typeof o.nextId === 'number' && o.nextId > 0 ? o.nextId : eggs.length + 1,
  }
}

function hasLS(): boolean {
  return typeof localStorage !== 'undefined'
}

export function loadIncubator(): IncubatorState {
  if (!hasLS()) return defaultIncubator()
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? migrateIncubator(JSON.parse(raw)) : defaultIncubator()
  } catch {
    return defaultIncubator()
  }
}

export function saveIncubatorState(state: IncubatorState): void {
  if (!hasLS()) return
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* 配額/隱私模式：忽略 */
  }
}
