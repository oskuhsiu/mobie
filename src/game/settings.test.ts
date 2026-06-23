// M6.0 — 設定 slice + assembleExt（plan/09 §0.3）。純判斷邏輯單測。
import { describe, it, expect } from 'vitest'
import { defaultSettings, migrateSettings, setModuleEnabledIn, MODULE_IDS } from '@/game/settings'
import { assembleExt } from '@/store/ext'
import { EMPTY_EXT, type ExtensionModule } from '@/game/ext/seams'

describe('M6.0 settings slice', () => {
  it('預設全模組關閉（新玩家＝純 M1.x）', () => {
    const s = defaultSettings()
    for (const id of MODULE_IDS) expect(s.modules[id]).toBe(false)
  })

  it('migrateSettings 防壞檔：非物件 → 全關', () => {
    expect(migrateSettings(null).modules.heldItems).toBe(false)
    expect(migrateSettings('garbage').modules.synergy).toBe(false)
    expect(migrateSettings(42).modules.tower).toBe(false)
  })

  it('migrateSettings 只認 true、未知鍵忽略、缺漏補關', () => {
    const m = migrateSettings({ modules: { heldItems: true, chain: 1, bogus: 'x' } }).modules
    expect(m.heldItems).toBe(true) // 認 true
    expect(m.chain).toBe(false) // 非布林 true → 關
    expect(m.synergy).toBe(false) // 缺漏 → 關
    expect('bogus' in m).toBe(false) // 未知鍵不滲入
  })

  it('setModuleEnabledIn 純函數、不改原物件', () => {
    const a = defaultSettings()
    const b = setModuleEnabledIn(a, 'tower', true)
    expect(a.modules.tower).toBe(false)
    expect(b.modules.tower).toBe(true)
  })
})

describe('M6.0 assembleExt', () => {
  it('全關 / 空註冊表 → EMPTY_EXT（reducer 行為等同 M1.x）', () => {
    expect(assembleExt(defaultSettings())).toBe(EMPTY_EXT)
  })

  it('啟用才收其縫、停用＝不收（零殘留）', () => {
    const mod: ExtensionModule = {
      id: 'heldItems',
      seams: { damageHook: () => 1.3, turnEndTrigger: () => [] },
    }
    const off = assembleExt(defaultSettings(), [mod])
    expect(off.damageHooks).toHaveLength(0) // 預設關 → 不收

    const on = assembleExt(setModuleEnabledIn(defaultSettings(), 'heldItems', true), [mod])
    expect(on.damageHooks).toHaveLength(1)
    expect(on.turnEndTriggers).toHaveLength(1)
  })
})
