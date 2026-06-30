// M6.0 — 設定 slice + assembleExt（plan/09 §0.3）。純判斷邏輯單測。
import { describe, it, expect } from 'vitest'
import {
  defaultSettings, migrateSettings, setModuleEnabledIn, MODULE_IDS,
  defaultPrefs, migratePrefs, setInteractModeIn, isEnhancedSurfaceEnabled, interactModeOf,
  setAttackInputVariantIn, attackInputVariantOf,
  setJuiceIn, setHapticsIn, juiceLevelOf, hapticsEnabledOf,
  INTERACT_SURFACES, INTENSITY_BY_MODE,
} from '@/game/settings'
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
    expect(migrateSettings(42).modules.evolution).toBe(false)
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
    const b = setModuleEnabledIn(a, 'evolution', true)
    expect(a.modules.evolution).toBe(false)
    expect(b.modules.evolution).toBe(true)
  })
})

describe('M22 增強互動性偏好（prefs）', () => {
  it('預設 mode=off（現狀一字不差）、surfaces 全填滿 true', () => {
    const p = defaultPrefs()
    expect(p.enhancedInteractivity.mode).toBe('off')
    for (const id of INTERACT_SURFACES) expect(p.enhancedInteractivity.surfaces[id]).toBe(true)
  })

  it('defaultSettings 含 prefs（向後相容欄位）', () => {
    expect(defaultSettings().prefs.enhancedInteractivity.mode).toBe('off')
  })

  it('migrateSettings 舊存檔無 prefs → 補預設（off + surfaces 全 true）', () => {
    const s = migrateSettings({ modules: { chain: true } })
    expect(s.modules.chain).toBe(true)
    expect(s.prefs.enhancedInteractivity.mode).toBe('off')
    expect(s.prefs.enhancedInteractivity.surfaces.capture).toBe(true)
  })

  it('migratePrefs 防壞檔 / 未知 mode → off；只認 lite/arcade', () => {
    expect(migratePrefs(null).enhancedInteractivity.mode).toBe('off')
    expect(migratePrefs({ enhancedInteractivity: { mode: 'bogus' } }).enhancedInteractivity.mode).toBe('off')
    expect(migratePrefs({ enhancedInteractivity: { mode: 'lite' } }).enhancedInteractivity.mode).toBe('lite')
    expect(migratePrefs({ enhancedInteractivity: { mode: 'arcade' } }).enhancedInteractivity.mode).toBe('arcade')
  })

  it('migratePrefs surfaces 只認顯式 false 才關，缺漏維持 true', () => {
    const s = migratePrefs({ enhancedInteractivity: { mode: 'arcade', surfaces: { capture: false, bogus: 'x' } } })
    expect(s.enhancedInteractivity.surfaces.capture).toBe(false) // 顯式 false → 關
    expect(s.enhancedInteractivity.surfaces.starStrike).toBe(true) // 缺漏 → 維持預設 true
    expect('bogus' in s.enhancedInteractivity.surfaces).toBe(false) // 未知鍵不滲入
  })

  it('M22.g attackInputVariant：預設 mash、選擇器只在 mode≠off+rhythm 時回 rhythm', () => {
    expect(defaultPrefs().attackInputVariant).toBe('mash')
    expect(migratePrefs({}).attackInputVariant).toBe('mash') // 缺欄
    expect(migratePrefs({ attackInputVariant: 'rhythm' }).attackInputVariant).toBe('rhythm')
    expect(migratePrefs({ attackInputVariant: 'bogus' }).attackInputVariant).toBe('mash')
    // 選擇器：off 時 rhythm 不生效
    const offRhythm = setAttackInputVariantIn(defaultSettings(), 'rhythm')
    expect(attackInputVariantOf(offRhythm)).toBe('mash')
    const onRhythm = setAttackInputVariantIn(setInteractModeIn(defaultSettings(), 'arcade'), 'rhythm')
    expect(attackInputVariantOf(onRhythm)).toBe('rhythm')
  })

  it('M14 recordReplays：預設 off、只認顯式 true、向後相容缺欄', () => {
    expect(defaultPrefs().recordReplays).toBe(false)
    expect(migratePrefs({}).recordReplays).toBe(false) // 缺欄 → off
    expect(migratePrefs({ recordReplays: true }).recordReplays).toBe(true)
    expect(migratePrefs({ recordReplays: 'yes' }).recordReplays).toBe(false) // 非布林 true → off
    // 與 enhancedInteractivity 不互相干擾
    expect(migratePrefs({ recordReplays: true, enhancedInteractivity: { mode: 'lite' } }).enhancedInteractivity.mode).toBe('lite')
  })

  it('setInteractModeIn 純函數、不改原物件、surfaces 不動', () => {
    const a = defaultSettings()
    const b = setInteractModeIn(a, 'arcade')
    expect(a.prefs.enhancedInteractivity.mode).toBe('off')
    expect(b.prefs.enhancedInteractivity.mode).toBe('arcade')
    expect(b.prefs.enhancedInteractivity.surfaces).toEqual(a.prefs.enhancedInteractivity.surfaces)
  })

  it('isEnhancedSurfaceEnabled：off → 一律 false（零回歸）', () => {
    const s = defaultSettings()
    for (const id of INTERACT_SURFACES) expect(isEnhancedSurfaceEnabled(s, id)).toBe(false)
  })

  it('isEnhancedSurfaceEnabled：mode≠off 且 surface 開 → true；surface 關 → false', () => {
    const lite = setInteractModeIn(defaultSettings(), 'lite')
    expect(isEnhancedSurfaceEnabled(lite, 'capture')).toBe(true)
    const off1 = { ...lite, prefs: { ...lite.prefs, enhancedInteractivity: { mode: 'lite' as const, surfaces: { ...lite.prefs.enhancedInteractivity.surfaces, capture: false } } } }
    expect(isEnhancedSurfaceEnabled(off1, 'capture')).toBe(false)
  })

  it('interactModeOf：啟用回該 mode，否則 off', () => {
    expect(interactModeOf(defaultSettings(), 'starStrike')).toBe('off')
    expect(interactModeOf(setInteractModeIn(defaultSettings(), 'arcade'), 'starStrike')).toBe('arcade')
  })

  it('INTENSITY_BY_MODE：arcade 比 lite 更高頻（拍數多、判定窗窄、目標弧度大）', () => {
    expect(INTENSITY_BY_MODE.arcade.rhythmBeats).toBeGreaterThan(INTENSITY_BY_MODE.lite.rhythmBeats)
    expect(INTENSITY_BY_MODE.arcade.rhythmWindowMs).toBeLessThan(INTENSITY_BY_MODE.lite.rhythmWindowMs)
    expect(INTENSITY_BY_MODE.arcade.circleTargetRad).toBeGreaterThan(INTENSITY_BY_MODE.lite.circleTargetRad)
  })
})

describe('EXT.1 打擊感 juice / 觸覺 haptics 偏好', () => {
  it('預設 juice=full、haptics=true（升級爽感）', () => {
    expect(defaultPrefs().juice).toBe('full')
    expect(defaultPrefs().haptics).toBe(true)
    expect(juiceLevelOf(defaultSettings())).toBe('full')
    expect(hapticsEnabledOf(defaultSettings())).toBe(true)
  })

  it('migratePrefs juice：缺欄/未知 → full；只認 reduced/off', () => {
    expect(migratePrefs({}).juice).toBe('full') // 缺欄 → 升級爽感
    expect(migratePrefs({ juice: 'bogus' }).juice).toBe('full') // 未知 → full
    expect(migratePrefs({ juice: 'reduced' }).juice).toBe('reduced')
    expect(migratePrefs({ juice: 'off' }).juice).toBe('off')
  })

  it('migratePrefs haptics：缺欄 → true；只認顯式 false 才關', () => {
    expect(migratePrefs({}).haptics).toBe(true) // 缺欄 → on
    expect(migratePrefs({ haptics: false }).haptics).toBe(false) // 顯式 false → off
    expect(migratePrefs({ haptics: 'no' }).haptics).toBe(true) // 非 false → 維持 on
  })

  it('舊存檔（無 EXT.1 欄）遷移後補 full/true，且不干擾既有 prefs', () => {
    const s = migrateSettings({ prefs: { enhancedInteractivity: { mode: 'lite' }, recordReplays: true } })
    expect(s.prefs.juice).toBe('full')
    expect(s.prefs.haptics).toBe(true)
    expect(s.prefs.enhancedInteractivity.mode).toBe('lite') // 既有欄不被覆蓋
    expect(s.prefs.recordReplays).toBe(true)
  })

  it('setJuiceIn / setHapticsIn 純函數、不改原物件', () => {
    const a = defaultSettings()
    const b = setJuiceIn(a, 'off')
    expect(a.prefs.juice).toBe('full')
    expect(b.prefs.juice).toBe('off')
    const c = setHapticsIn(a, false)
    expect(a.prefs.haptics).toBe(true)
    expect(c.prefs.haptics).toBe(false)
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
