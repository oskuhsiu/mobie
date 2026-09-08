// Runtime preferences plus the read-only legacy v1 module-data boundary.
import { describe, it, expect } from 'vitest'
import {
  defaultSettings, runtimeSettingsFromV1, loadSettingsFrom, parseSettingsV2, saveSettingsTo,
  defaultPrefs, migratePrefs, setInteractModeIn, isEnhancedSurfaceEnabled, interactModeOf,
  setAttackInputVariantIn, attackInputVariantOf,
  setJuiceIn, setHapticsIn, juiceLevelOf, hapticsEnabledOf,
  setGraphicsPreferenceIn, setScannerEnabledIn,
  GRAPHICS_PREFERENCES, INTERACT_SURFACES, INTENSITY_BY_MODE,
  SETTINGS_SCHEMA_VERSION, SETTINGS_V1_KEY, SETTINGS_V2_KEY,
  type SettingsStorage,
} from '@/game/settings'

function fakeStore(initial: Record<string, string> = {}): SettingsStorage & { values: () => Record<string, string> } {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    values: () => Object.fromEntries(values),
  }
}

describe('Ticket 21 Settings v2 migration and validation', () => {
  it('projects legacy module data into exact v2 without exposing or enabling it', () => {
    const runtime = runtimeSettingsFromV1({
      schemaVersion: 1,
      modules: { synergy: false, heldItems: false, encounterSkills: true },
      prefs: { recordReplays: true },
    })

    expect(runtime.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION)
    expect(runtime.prefs.recordReplays).toBe(true)
    expect(runtime).not.toHaveProperty('modules')
    expect(runtime.prefs.scannerEnabled).toBe(false)
    expect(runtime.prefs.graphicsPreference).toBe('auto')
  })

  it('has the exact v2 defaults and only the declared graphics choices', () => {
    const settings = defaultSettings()
    expect(settings).toEqual({ schemaVersion: 2, prefs: {
      enhancedInteractivity: { mode: 'off', surfaces: Object.fromEntries(INTERACT_SURFACES.map((id) => [id, true])) },
      recordReplays: false,
      attackInputVariant: 'mash',
      juice: 'full',
      haptics: true,
      graphicsPreference: 'auto',
      scannerEnabled: false,
    } })
    expect(GRAPHICS_PREFERENCES).toEqual(['auto', 'high', 'balanced', 'compatibility'])
    expect(parseSettingsV2(settings)).toEqual(settings)
  })

  it('prefers valid v2, otherwise migrates valid v1 once and writes only v2', () => {
    const v2 = { ...defaultSettings(), prefs: { ...defaultPrefs(), scannerEnabled: true, graphicsPreference: 'high' as const } }
    const store = fakeStore({
      [SETTINGS_V2_KEY]: JSON.stringify(v2),
      [SETTINGS_V1_KEY]: JSON.stringify({ schemaVersion: 1, prefs: { recordReplays: true } }),
    })
    expect(loadSettingsFrom(store)).toEqual(v2)
    expect(store.values()[SETTINGS_V1_KEY]).toContain('recordReplays')

    const legacyStore = fakeStore({ [SETTINGS_V1_KEY]: JSON.stringify({ schemaVersion: 1, modules: { synergy: true }, prefs: { recordReplays: true } }) })
    const migrated = loadSettingsFrom(legacyStore)
    expect(migrated.prefs.recordReplays).toBe(true)
    expect(migrated.prefs.scannerEnabled).toBe(false)
    expect(JSON.parse(legacyStore.values()[SETTINGS_V2_KEY])).toEqual(migrated)
    expect(legacyStore.values()[SETTINGS_V1_KEY]).toContain('synergy')
  })

  it('recovers from malformed v2/v1 without throwing and writes canonical v2 on save', () => {
    const store = fakeStore({ [SETTINGS_V2_KEY]: '{broken', [SETTINGS_V1_KEY]: '{also broken' })
    expect(() => loadSettingsFrom(store)).not.toThrow()
    expect(loadSettingsFrom(store)).toEqual(defaultSettings())

    const settings = setScannerEnabledIn(setGraphicsPreferenceIn(defaultSettings(), 'compatibility'), true)
    saveSettingsTo(store, settings)
    const saved = JSON.parse(store.values()[SETTINGS_V2_KEY])
    expect(saved).toEqual(settings)
    expect(saved).not.toHaveProperty('modules')
    expect(store.values()[SETTINGS_V1_KEY]).toBe('{also broken')
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

  it('舊 v1 存檔無 prefs → 補預設（off + surfaces 全 true）', () => {
    const s = runtimeSettingsFromV1({ modules: { chain: true } })
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
    const s = runtimeSettingsFromV1({ prefs: { enhancedInteractivity: { mode: 'lite' }, recordReplays: true } })
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
