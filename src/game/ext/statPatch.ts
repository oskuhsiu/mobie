// M7 — 延伸系統共用的純小工具（道具 / 特性 / 羈絆共享）。
// 集中能力值倍率與 id 查表，避免三個模組各自複製一份。

import type { BattlePokemon } from '@/game/types'

/** 可被 statMod 倍率影響的能力值鍵（不動 HP，避免 maxHp/currentHp 不同步）。 */
export const STAT_KEYS = ['atk', 'def', 'spa', 'spd', 'spe'] as const
export type StatKey = (typeof STAT_KEYS)[number]
export const isStatKey = (k: string): k is StatKey => (STAT_KEYS as readonly string[]).includes(k)

/** 能力值乘倍率並四捨五入（保底 1）。 */
export const scale = (v: number, mult: number): number => Math.max(1, Math.round(v * mult))

/**
 * 套 statMod 倍率到一隻 BattlePokemon（params 鍵為能力值名、值為倍率）。
 * 非能力值鍵忽略。回傳新複本，不改原物件。
 */
export function applyStatMod(unit: BattlePokemon, params: Record<string, number>): BattlePokemon {
  const out = { ...unit }
  for (const [k, mult] of Object.entries(params)) {
    if (isStatKey(k)) out[k] = scale(unit[k], mult)
  }
  return out
}

/** 由帶 id 的定義表建 O(1) 查表函式（未知/未給 id → undefined）。 */
export function createLookup<T extends { id: string }>(defs: readonly T[]): (id: string | undefined) => T | undefined {
  const map = new Map(defs.map((d) => [d.id, d]))
  return (id) => (id ? map.get(id) : undefined)
}
