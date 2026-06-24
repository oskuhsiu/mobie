// M19 — 多招式制的學習表與招式解析（plan/17 §2–3）。
//
// 怪物招式系統的純邏輯層：種族學習表（領悟）、可學清單（teachable）、自動裝備（出生/野生）、
// id→Move 解析。**全純函數、決定論、可測。** canonical 只存 id 陣列（OwnedUnit），此處不持久化。
//
// 學習表來源優先序：`species.learnset`（gen_dex M19.f emit）＞ 由屬性招式池**派生**（fallback，
// 讓 M19.a 在 gen_dex 之前即可運作、且全 251 種皆有合理 loadout）。派生規則見 deriveLearnset。

import type { Move, OwnedUnit, Species } from '@/game/types'
import { MOVES, getMove } from '@/game/data/moves'

/** 出戰招式槽上限（plan/17：4 槽，攻擊招＋變化招）。 */
export const MOVE_SLOT_CAP = 4

/** 某屬性的**攻擊招** id（由 MOVES 派生、由弱到強；不綁 id 命名規則）。
 *  排除變化招（power 0 / category 'status'，M19.d）——派生 loadout 維持純攻擊招、向後相容；
 *  變化招由產生檔 learnset（M19.f）或訓練所（M19.e）顯式授予。 */
function moveIdsOfType(type: Species['types'][number]): number[] {
  return Object.values(MOVES)
    .filter((m) => m.type === type && m.power > 0)
    .sort((a, b) => a.power - b.power || a.id - b.id)
    .map((m) => m.id)
}

/** 變化招 id（由 MOVES 依 effect 派生，不綁 id；M19.f gen_dex 後會被產生檔 learnset 取代）。 */
const HEAL_MOVE = Object.values(MOVES).find((m) => m.effect?.kind === 'heal')?.id
const ATK_BUFF_MOVE = Object.values(MOVES).find((m) => m.effect?.kind === 'buff' && m.effect.stat === 'atk')?.id
const SPA_BUFF_MOVE = Object.values(MOVES).find((m) => m.effect?.kind === 'buff' && m.effect.stat === 'spa')?.id

/** 派生 fallback 學習表：slot0=species.moveId 於 L1；各屬性攻擊招 tier1/2/3 → L1/16/32；
 *  變化招（M19.d）——每隻於 L20 學「自我再生」、L24 依攻擊取向（物理→劍舞 / 特殊→瞑想）學增益招。 */
const TIER_LEVELS = [1, 16, 32]
export function deriveLearnset(species: Species): { level: number; moveId: number }[] {
  const entries: { level: number; moveId: number }[] = []
  const seen = new Set<number>()
  const push = (level: number, moveId: number | undefined) => {
    if (moveId === undefined || !MOVES[moveId] || seen.has(moveId)) return
    seen.add(moveId)
    entries.push({ level, moveId })
  }
  push(1, species.moveId) // 出生自帶＝slot0
  for (const type of species.types) {
    moveIdsOfType(type).forEach((id, tier) => push(TIER_LEVELS[tier] ?? 32, id))
  }
  // 變化招：通用回復 + 依攻防取向的增益招（決定論，給每隻一點戰術深度）。
  push(20, HEAL_MOVE)
  push(24, species.baseStats.atk >= species.baseStats.spa ? ATK_BUFF_MOVE : SPA_BUFF_MOVE)
  return entries.sort((a, b) => a.level - b.level || a.moveId - b.moveId)
}

/** 該種族有效學習表（產生檔優先，否則派生）。 */
export function learnsetOf(species: Species): { level: number; moveId: number }[] {
  return species.learnset && species.learnset.length > 0 ? species.learnset : deriveLearnset(species)
}

/** 該種族可學招式清單（teachable；產生檔優先，否則＝派生學習表全集）。 */
export function teachableOf(species: Species): number[] {
  if (species.teachableMoveIds && species.teachableMoveIds.length > 0) return species.teachableMoveIds
  return [...new Set(learnsetOf(species).map((e) => e.moveId))]
}

/** 等級已可領悟的全部招（learnedMoveIds 預設；含 slot0）。 */
export function learnedAtLevel(species: Species, level: number): number[] {
  const ids = learnsetOf(species)
    .filter((e) => e.level <= level)
    .map((e) => e.moveId)
  return ids.includes(species.moveId) ? [...new Set(ids)] : [species.moveId, ...new Set(ids)]
}

/**
 * 自動出戰 loadout（≤4，寶可夢式「最近領悟」優先）：slot0＝出生自帶固定第一，
 * 其餘取較晚領悟（高階）填滿到上限。用於野生 foe 與舊存檔單位的 fallback。
 */
export function autoEquip(species: Species, level: number): number[] {
  const learned = learnedAtLevel(species, level)
  const rest = learned.filter((id) => id !== species.moveId).reverse() // 高 level/高 power 在後 → 反轉取最近
  return [species.moveId, ...rest].slice(0, MOVE_SLOT_CAP)
}

/**
 * 解析裝備 id → Move[]（過濾非法、截上限、保證非空＝至少 slot0）。
 * `equippedMoveIds` 缺省/空 → 用 autoEquip(level)（舊單位/野生 fallback）。
 */
export function resolveEquippedMoves(
  equippedMoveIds: number[] | undefined,
  species: Species,
  level: number,
): Move[] {
  const source =
    equippedMoveIds && equippedMoveIds.length > 0 ? equippedMoveIds : autoEquip(species, level)
  const ids = source.filter((id) => MOVES[id]).slice(0, MOVE_SLOT_CAP)
  const finalIds = ids.length > 0 ? ids : [species.moveId]
  return finalIds.map(getMove)
}

// ── M19.e 招式訓練所 / 升級領悟 ──────────────────────────────────

/**
 * 一隻單位「目前已學會」的招式池（canonical learnedMoveIds 優先；缺省＝依等級派生領悟）。
 * learnedMoveIds 物化後存「完整已學集」（含等級領悟 + 訓練習得），升級時由 grantBattleExp union 維護。
 */
export function effectiveLearnedMoves(unit: Pick<OwnedUnit, 'learnedMoveIds' | 'level'>, species: Species): number[] {
  if (unit.learnedMoveIds && unit.learnedMoveIds.length > 0) return unit.learnedMoveIds
  return learnedAtLevel(species, unit.level)
}

/** 升級後新領悟的招（learnedAtLevel 差集，fromLevel→toLevel）；給 moveLearned 提示。 */
export function newlyLearned(species: Species, fromLevel: number, toLevel: number): number[] {
  if (toLevel <= fromLevel) return []
  const before = new Set(learnedAtLevel(species, fromLevel))
  return learnedAtLevel(species, toLevel).filter((id) => !before.has(id))
}

/** 該單位「可學但尚未學」的招（teachable ∖ 已學；訓練所學招清單）。 */
export function teachableNotLearned(unit: Pick<OwnedUnit, 'learnedMoveIds' | 'level'>, species: Species): number[] {
  const learned = new Set(effectiveLearnedMoves(unit, species))
  return teachableOf(species).filter((id) => !learned.has(id) && MOVES[id])
}
