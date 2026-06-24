import { describe, it, expect } from 'vitest'
import { migrateKeys, KEY_MIGRATIONS, type KeyStore } from './keyMigration'

/** Map 後盾的假 storage（避免 jsdom localStorage 跨測污染）。 */
function fakeStore(init: Record<string, string> = {}): KeyStore & { dump(): Record<string, string> } {
  const m = new Map<string, string>(Object.entries(init))
  return {
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    setItem: (k, v) => void m.set(k, v),
    dump: () => Object.fromEntries(m),
  }
}

describe('migrateKeys（M18.c：mz.* → mobie.*）', () => {
  it('把舊 key 值複製到新 key，且刻意保留舊 key 當安全網', () => {
    const s = fakeStore({ 'mz.roster.v2': '[{"id":"a"}]' })
    const moved = migrateKeys(s)
    expect(moved).toBe(1)
    expect(s.getItem('mobie.roster.v2')).toBe('[{"id":"a"}]')
    expect(s.getItem('mz.roster.v2')).toBe('[{"id":"a"}]') // 不刪舊
  })

  it('冪等：重跑不再搬、且不覆蓋新 key', () => {
    const s = fakeStore({ 'mz.settings.v1': 'OLD' })
    expect(migrateKeys(s)).toBe(1)
    expect(s.getItem('mobie.settings.v1')).toBe('OLD')
    expect(migrateKeys(s)).toBe(0) // 第二次無事可搬
    expect(s.getItem('mobie.settings.v1')).toBe('OLD')
  })

  it('新 key 已存在時，不被舊 key 蓋掉（保護已遷移/新寫入的值）', () => {
    const s = fakeStore({ 'mz.meta.v1': 'OLD', 'mobie.meta.v1': 'NEW' })
    expect(migrateKeys(s)).toBe(0)
    expect(s.getItem('mobie.meta.v1')).toBe('NEW')
  })

  it('舊 key 不存在則不建立新 key（新裝置無殘留）', () => {
    const s = fakeStore({})
    expect(migrateKeys(s)).toBe(0)
    expect(s.getItem('mobie.roster.v2')).toBeNull()
  })

  it('多 slice 一次搬遷，計數正確', () => {
    const s = fakeStore({
      'mz.roster.v2': 'r',
      'mz.itembag.v1': 'b',
      'mz.incubator.v1': 'i',
    })
    expect(migrateKeys(s)).toBe(3)
    expect(s.getItem('mobie.itembag.v1')).toBe('b')
    expect(s.getItem('mobie.incubator.v1')).toBe('i')
  })

  it('無 storage（node/SSR）時安全略過', () => {
    expect(migrateKeys(undefined)).toBe(0)
  })

  it('對照表涵蓋 6 個 slice，且全為 mz.→mobie. 同名遷移', () => {
    expect(KEY_MIGRATIONS).toHaveLength(6)
    for (const [oldK, newK] of KEY_MIGRATIONS) {
      expect(oldK.startsWith('mz.')).toBe(true)
      expect(newK).toBe(oldK.replace(/^mz\./, 'mobie.'))
    }
  })
})
