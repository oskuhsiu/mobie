import { describe, it, expect } from 'vitest'
import {
  deriveLearnset,
  learnsetOf,
  teachableOf,
  learnedAtLevel,
  autoEquip,
  resolveEquippedMoves,
  MOVE_SLOT_CAP,
} from './learnset'
import { getSpecies } from '@/game/data/species'
import { MOVES } from '@/game/data/moves'
import { sanitizeRoster } from '@/game/rosterSanitize'
import { buildBattleMobie } from '@/game/stats'
import type { OwnedUnit } from '@/game/types'

const bulba = getSpecies(1) // grass/poison（雙屬性），moveId 1040
const pika = getSpecies(25) // electric（單屬性），moveId 1030

describe('learnset 派生與解析（M19.a）', () => {
  it('deriveLearnset：slot0=species.moveId 於 L1、依 level 排序、id 皆合法、無重複', () => {
    const ls = deriveLearnset(bulba)
    expect(ls[0]).toEqual({ level: 1, moveId: bulba.moveId })
    for (let i = 1; i < ls.length; i++) expect(ls[i].level).toBeGreaterThanOrEqual(ls[i - 1].level)
    expect(ls.every((e) => MOVES[e.moveId])).toBe(true)
    expect(new Set(ls.map((e) => e.moveId)).size).toBe(ls.length)
  })

  it('learnsetOf：無 species.learnset 時回派生表', () => {
    expect(learnsetOf(pika)).toEqual(deriveLearnset(pika))
  })

  it('autoEquip：slot0 固定第一、截上限 ≤4、皆相異', () => {
    const eq = autoEquip(bulba, 100) // 雙屬性 6 招 + slot0 → 截到 4
    expect(eq.length).toBe(MOVE_SLOT_CAP)
    expect(eq[0]).toBe(bulba.moveId)
    expect(new Set(eq).size).toBe(eq.length)
    const eqPika = autoEquip(pika, 100) // 單屬性 ≤3 招
    expect(eqPika.length).toBeLessThanOrEqual(MOVE_SLOT_CAP)
    expect(eqPika[0]).toBe(pika.moveId)
  })

  it('learnedAtLevel：含 slot0、隨等級單調增加', () => {
    const low = learnedAtLevel(bulba, 1)
    const high = learnedAtLevel(bulba, 100)
    expect(low).toContain(bulba.moveId)
    expect(high.length).toBeGreaterThanOrEqual(low.length)
    expect(low.every((id) => high.includes(id))).toBe(true)
  })

  it('teachableOf：非空、id 皆合法', () => {
    const t = teachableOf(bulba)
    expect(t.length).toBeGreaterThan(0)
    expect(t.every((id) => MOVES[id])).toBe(true)
  })

  it('resolveEquippedMoves：缺省→autoEquip fallback、moves[0]=slot0', () => {
    const moves = resolveEquippedMoves(undefined, bulba, 50)
    expect(moves.length).toBeGreaterThan(0)
    expect(moves[0].id).toBe(bulba.moveId)
  })

  it('resolveEquippedMoves：過濾非法 id、保留合法', () => {
    const moves = resolveEquippedMoves([999999, 1041], bulba, 50)
    expect(moves.map((m) => m.id)).toEqual([1041])
  })

  it('resolveEquippedMoves：空陣列→fallback 非空；超量→截 ≤4', () => {
    expect(resolveEquippedMoves([], pika, 50).length).toBeGreaterThan(0)
    const many = resolveEquippedMoves([1040, 1041, 1042, 1070, 1071, 1072], bulba, 100)
    expect(many.length).toBe(MOVE_SLOT_CAP)
  })
})

describe('向後相容（M19.a）', () => {
  it('舊式 card（無 equippedMoveIds）→ buildBattleMobie 的 moves[0]＝species 單招（行為不變）', () => {
    const bm = buildBattleMobie({ cardId: 'legacy', speciesId: 25, level: 20 })
    expect(bm.moves.length).toBeGreaterThan(0)
    expect(bm.move).toBe(bm.moves[0])
    expect(bm.moves[0].id).toBe(pika.moveId) // slot0＝舊單招
  })

  it('sanitizeRoster：舊存檔（無招式欄）不 materialize（留給派生）', () => {
    const old = { id: 'u1', speciesId: 25, level: 10, exp: 1000, ivs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, nature: 0, seed: 'u1', shiny: false } as OwnedUnit
    const [s] = sanitizeRoster([old])
    expect(s.equippedMoveIds).toBeUndefined()
    expect(s.learnedMoveIds).toBeUndefined()
  })

  it('sanitizeRoster：過濾非法 equipped、截上限、equipped ⊆ learned', () => {
    const unit = {
      id: 'u2', speciesId: 1, level: 100, exp: 1_000_000,
      ivs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, nature: 0, seed: 'u2', shiny: false,
      learnedMoveIds: [1040, 1041, 1070, 999999], // 999999 非法 → 丟
      equippedMoveIds: [1040, 1041, 1070, 1071, 1042, 1030], // 1071/1042 不在 learned、1030 非本系→丟；截 ≤4
    } as OwnedUnit
    const [s] = sanitizeRoster([unit])
    expect(s.learnedMoveIds).not.toContain(999999)
    expect(s.equippedMoveIds!.length).toBeLessThanOrEqual(MOVE_SLOT_CAP)
    const learnedSet = new Set([...(s.learnedMoveIds ?? []), 1040])
    expect(s.equippedMoveIds!.every((id) => learnedSet.has(id))).toBe(true)
  })
})
