import { describe, it, expect } from 'vitest'
import {
  SAVE_SCHEMA_VERSION,
  defaultMeta,
  sanitizeProfileName,
  migrateMeta,
  compareSaves,
  type SaveMeta,
} from './saveMeta'

describe('saveMeta：純判斷邏輯', () => {
  it('defaultMeta 為新裝置基準（updatedAt/revision 皆 0）', () => {
    const m = defaultMeta()
    expect(m).toEqual({
      schemaVersion: SAVE_SCHEMA_VERSION,
      profileName: 'trainer',
      updatedAt: 0,
      revision: 0,
    })
  })

  describe('sanitizeProfileName', () => {
    it('保留各語系字母/數字/底線/連字號', () => {
      expect(sanitizeProfileName('Ash_2024-小智')).toBe('Ash_2024-小智')
    })
    it('去除空白與檔名地雷符號', () => {
      expect(sanitizeProfileName('a/b\\c:d e?')).toBe('abcde')
    })
    it('截斷到 24 字', () => {
      expect(sanitizeProfileName('x'.repeat(50))).toBe('x'.repeat(24))
    })
    it('非字串或清空後為空 → null（交呼叫端 fallback）', () => {
      expect(sanitizeProfileName(123)).toBeNull()
      expect(sanitizeProfileName('   ')).toBeNull()
      expect(sanitizeProfileName('!@#')).toBeNull()
    })
  })

  describe('migrateMeta：防壞檔/補預設', () => {
    it('非物件 → 全預設', () => {
      expect(migrateMeta(null)).toEqual(defaultMeta())
      expect(migrateMeta('garbage')).toEqual(defaultMeta())
    })
    it('部分缺漏 → 逐欄補預設、清洗名稱、夾合法範圍', () => {
      expect(migrateMeta({ profileName: 'bad name!', revision: 4.9, updatedAt: -1 })).toEqual({
        schemaVersion: SAVE_SCHEMA_VERSION,
        profileName: 'badname', // 去空白與驚嘆號
        updatedAt: 0, // 負值丟棄回預設
        revision: 4, // floor
      })
    })
    it('合法完整物件原樣保留', () => {
      const m: SaveMeta = { schemaVersion: 1, profileName: 'Red', updatedAt: 123, revision: 7 }
      expect(migrateMeta(m)).toEqual(m)
    })
  })

  describe('compareSaves：方向矩陣', () => {
    const base: SaveMeta = { schemaVersion: 1, profileName: 'p', updatedAt: 1000, revision: 5 }
    it('updatedAt 為主訊號', () => {
      expect(compareSaves(base, { ...base, updatedAt: 2000 })).toBe('newer')
      expect(compareSaves(base, { ...base, updatedAt: 500 })).toBe('older')
    })
    it('updatedAt 同分 → 看 revision', () => {
      expect(compareSaves(base, { ...base, revision: 6 })).toBe('newer')
      expect(compareSaves(base, { ...base, revision: 4 })).toBe('older')
    })
    it('兩者皆同 → same', () => {
      expect(compareSaves(base, { ...base })).toBe('same')
    })
    it('updatedAt 勝過 revision（較新時間即使 revision 較小仍算新）', () => {
      expect(compareSaves(base, { ...base, updatedAt: 2000, revision: 1 })).toBe('newer')
    })
  })
})
