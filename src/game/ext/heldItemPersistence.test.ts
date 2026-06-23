// M7 資料正確性：持有道具的「canonical 持久化全鏈路」——
//   OwnedUnit.heldItemId → ownedToCard → buildBattlePokemon（帶進戰鬥暫態）
//   → sanitizeRoster（載入防護：保留已知、丟棄未知）
//   → packSave/unpackSave（.save 匯出匯入逐欄一致）
// 確保裝備的道具不會在存檔往返 / 載入清理 / 進戰鬥時遺失或被竄改。
import { describe, it, expect } from 'vitest'
import type { OwnedUnit } from '@/game/types'
import { createOwnedUnit, ownedToCard } from '@/game/growth'
import { buildBattlePokemon } from '@/game/stats'
import { sanitizeRoster } from '@/game/rosterSanitize'
import { packSave, unpackSave, type SaveSlices } from '@/game/save/bundle'
import { SAVE_SCHEMA_VERSION } from '@/game/save/saveMeta'
import { ITEMS } from '@/game/ext/items'

const withItem = (id: string, speciesId: number, heldItemId?: string): OwnedUnit => ({
  ...createOwnedUnit(id, speciesId, 16),
  ...(heldItemId ? { heldItemId } : {}),
})

describe('M7 持有道具持久化 · 建構鏈路', () => {
  it('ownedToCard 帶 heldItemId、buildBattlePokemon 落到戰鬥暫態', () => {
    const u = withItem('u1', 1, 'lifeorb')
    const card = ownedToCard(u)
    expect(card.heldItemId).toBe('lifeorb')
    expect(buildBattlePokemon(card).heldItemId).toBe('lifeorb')
  })

  it('未裝備：heldItemId 全程為 undefined（不無中生有）', () => {
    const u = withItem('u2', 4)
    expect(u.heldItemId).toBeUndefined()
    expect(ownedToCard(u).heldItemId).toBeUndefined()
    expect(buildBattlePokemon(ownedToCard(u)).heldItemId).toBeUndefined()
  })
})

describe('M7 持有道具持久化 · sanitizeRoster 載入防護', () => {
  it('保留已知道具 id', () => {
    for (const it of ITEMS) {
      const r = sanitizeRoster([withItem('a', 1, it.id)])
      expect(r[0].heldItemId).toBe(it.id)
    }
  })

  it('丟棄未知 / 非字串 heldItemId（防壞檔、刪過的道具）', () => {
    expect(sanitizeRoster([withItem('b', 1, 'no-such-item')])[0].heldItemId).toBeUndefined()
    expect(sanitizeRoster([{ ...withItem('c', 1), heldItemId: 123 as unknown as string }])[0].heldItemId).toBeUndefined()
    expect(sanitizeRoster([withItem('d', 1)])[0].heldItemId).toBeUndefined()
  })
})

describe('M7 持有道具持久化 · .save 匯出匯入往返', () => {
  const slices = (roster: OwnedUnit[]): SaveSlices => ({
    meta: { schemaVersion: SAVE_SCHEMA_VERSION, profileName: 'Trainer', updatedAt: 1234, revision: 1 },
    roster,
    cards: [],
  })

  it('roster 的 heldItemId 經 pack→unpack 逐隻一致', () => {
    const roster = [
      withItem('a', 1, 'lifeorb'),
      withItem('b', 4, 'leftovers'),
      withItem('c', 7), // 未裝備
      withItem('d', 25, 'expertbelt'),
    ]
    const r = unpackSave(packSave(slices(roster)))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.roster.map((u) => u.heldItemId)).toEqual(['lifeorb', 'leftovers', undefined, 'expertbelt'])
  })

  it('往返後再 sanitize 仍保住（匯入流程 replaceAll→sanitize 不掉道具）', () => {
    const roster = [withItem('a', 1, 'headband'), withItem('b', 133, 'vest')]
    const r = unpackSave(packSave(slices(roster)))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const clean = sanitizeRoster(r.roster)
    expect(clean.map((u) => u.heldItemId)).toEqual(['headband', 'vest'])
  })
})
