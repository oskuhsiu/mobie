// 載入邊界防護：把 localStorage 取回的 roster 夾到合法範圍、丟棄壞項。
// 目的只擋一個最痛的失敗類別——speciesId 不在圖鑑會讓 getSpecies() 拋錯，
// 而壞檔已存於 localStorage，重開仍持續 crash（死迴圈，使用者只能手動清檔）。
// 唯一寫入者是遊戲本身，故不做完整 schema 驗證，只做輕量 clamp / drop。

import type { OwnedUnit, Species, Stats } from '@/game/types'
import { SPECIES, getSpecies } from '@/game/data/species'
import { MAX_LEVEL, expForLevel, levelFromExp } from '@/game/growth'
import { IV_MAX, NATURES } from '@/game/individual'
import { getItem } from '@/game/ext/items'
import { MOVES } from '@/game/data/moves'
import { learnedAtLevel, teachableOf, MOVE_SLOT_CAP } from '@/game/learnset'

const MAX_EXP = expForLevel(MAX_LEVEL)

/** 取整並夾到 [lo, hi]；非有限數字則用 fallback */
function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : fallback
  return Math.min(hi, Math.max(lo, n))
}

function sanitizeIvs(v: unknown): Stats {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<Record<keyof Stats, unknown>>
  return {
    hp: clampInt(o.hp, 0, IV_MAX, 0),
    atk: clampInt(o.atk, 0, IV_MAX, 0),
    def: clampInt(o.def, 0, IV_MAX, 0),
    spa: clampInt(o.spa, 0, IV_MAX, 0),
    spd: clampInt(o.spd, 0, IV_MAX, 0),
    spe: clampInt(o.spe, 0, IV_MAX, 0),
  }
}

/** 該種族合法招式池（學習表全集 ∪ teachable ∪ 蛋招）∩ 已知招，用於過濾壞檔/刪過的招。 */
function legalMovePool(species: Species): Set<number> {
  const pool = new Set<number>([
    ...learnedAtLevel(species, MAX_LEVEL),
    ...teachableOf(species),
    ...(species.eggMoveIds ?? []),
  ])
  for (const id of pool) if (!MOVES[id]) pool.delete(id)
  return pool
}

/**
 * 健全化招式欄位（M19）：learnedMoveIds 只留種族合法且已知的招；equippedMoveIds ⊆ learned、截上限。
 * 缺省（舊存檔）→ 回傳 undefined（不materialize；buildBattleMobie 依等級自動派生＝向後相容）。
 */
function sanitizeMoves(
  rawLearned: unknown,
  rawEquipped: unknown,
  species: Species,
): { learnedMoveIds?: number[]; equippedMoveIds?: number[] } {
  if (!Array.isArray(rawLearned) && !Array.isArray(rawEquipped)) return {}
  const pool = legalMovePool(species)
  const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
  const learned = Array.isArray(rawLearned)
    ? [...new Set(rawLearned.filter(isInt).filter((id) => pool.has(id)))]
    : undefined
  // equipped 必須 ⊆ learned（或 species.moveId）；非法/重複去除、截 ≤4
  const allow = new Set<number>([...(learned ?? []), species.moveId])
  const equipped = Array.isArray(rawEquipped)
    ? [...new Set(rawEquipped.filter(isInt).filter((id) => allow.has(id) && MOVES[id]))].slice(0, MOVE_SLOT_CAP)
    : undefined
  const out: { learnedMoveIds?: number[]; equippedMoveIds?: number[] } = {}
  if (learned && learned.length > 0) out.learnedMoveIds = learned
  if (equipped && equipped.length > 0) out.equippedMoveIds = equipped
  return out
}

/**
 * 健全化整個 roster：丟棄 id 非字串或 speciesId 不在圖鑑的單位，
 * 其餘把 level/exp/ivs/nature 夾到合法範圍（level 至少對齊 exp 反推的等級，與 applyExp 一致）。
 */
export function sanitizeRoster(units: readonly OwnedUnit[]): OwnedUnit[] {
  if (!Array.isArray(units)) return []
  const clean: OwnedUnit[] = []
  for (const raw of units) {
    const u = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const speciesId = u.speciesId
    if (typeof speciesId !== 'number' || !SPECIES[speciesId]) continue // 未知種類：丟棄
    const id = typeof u.id === 'string' && u.id ? u.id : null
    if (!id) continue // 沒有穩定 id 的單位無法配對加經驗，視為壞項丟棄

    const exp = clampInt(u.exp, 0, MAX_EXP, 0)
    const level = Math.max(clampInt(u.level, 1, MAX_LEVEL, 1), levelFromExp(exp))
    const seed = typeof u.seed === 'string' && u.seed ? u.seed : id
    // 持有道具：只保留已知道具 id（防壞檔 / 刪過的道具），未知一律丟棄欄位
    const heldItemId = typeof u.heldItemId === 'string' && getItem(u.heldItemId) ? u.heldItemId : undefined
    const moveFields = sanitizeMoves(u.learnedMoveIds, u.equippedMoveIds, getSpecies(speciesId))
    clean.push({
      id,
      speciesId,
      level,
      exp,
      ivs: sanitizeIvs(u.ivs),
      nature: clampInt(u.nature, 0, NATURES.length - 1, 0),
      seed,
      shiny: u.shiny === true,
      ...(heldItemId ? { heldItemId } : {}),
      ...moveFields,
    })
  }
  return clean
}
