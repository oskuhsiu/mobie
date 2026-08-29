// Runtime preferences stored in the existing mobie.settings.v1 envelope.
// The legacy `modules` subtree remains read-only rollback input and never enters this interface.

export const SETTINGS_SCHEMA_VERSION = 1

// ── M22 增強互動性（UX 偏好，不碰 reducer/engine）。設計真相：plan/22。 ────────────

/** 可疊加手勢的互動環節（情緒峰值優先）。MVP 只實作 capture/starStrike，其餘為 backlog 佔位。 */
export type InteractSurface = 'capture' | 'starStrike' | 'defense' | 'encounter' | 'hatch' | 'tower'
export const INTERACT_SURFACES: InteractSurface[] = ['capture', 'starStrike', 'defense', 'encounter', 'hatch', 'tower']

/** off＝零互動（現狀）；lite＝直覺單一手勢；arcade＝機台式高頻手勢。 */
export type InteractMode = 'off' | 'lite' | 'arcade'

/** M22.g 攻擊輸入變體：mash＝既有連打（預設）；rhythm＝太鼓式節奏點擊（只在 mode≠off 時替換）。 */
export type AttackInputVariant = 'mash' | 'rhythm'

// ── EXT.1 局內爽感（plan/EXT.1 §3）。純 display UX 偏好，不碰 reducer。─────────────
/**
 * 打擊感強度：
 * - full＝升級後的完整爽感（浮傷數字＋效果圖示＋頓格＋sprite 動態）；**新預設**。
 * - reduced＝只留浮傷數字、不頓格（暈動敏感／低效能裝置）。
 * - off＝完全回到 M22 純 flash+shake，DOM 不得出現任何 EXT.1 新增 wrapper（驗收項）。
 */
export type JuiceLevel = 'full' | 'reduced' | 'off'

export interface GamePrefs {
  enhancedInteractivity: {
    mode: InteractMode
    /** 即使 off 也預設填滿 true，避免日後 undefined gating；mode 開啟後才實際生效。 */
    surfaces: Record<InteractSurface, boolean>
  }
  /** M14：是否錄製戰鬥回放（存進 IndexedDB mz-replays）。預設 off＝零殘留；開啟才開始錄。 */
  recordReplays: boolean
  /** M22.g：攻擊蓄力輸入變體（mash 連打／rhythm 節奏）。預設 mash＝現狀；只在 mode≠off 時生效。 */
  attackInputVariant: AttackInputVariant
  /** EXT.1：打擊感強度（數字/頓格/sprite 動態）。預設 full＝升級爽感（升級既有演出、非新戰鬥規則）。 */
  juice: JuiceLevel
  /** EXT.1：觸覺回饋總開關（Vibration API）。預設 on，裝置不支援時自動 no-op。 */
  haptics: boolean
}

export interface GameSettings {
  /** UX preferences only; battle capabilities are fixed in PRODUCT_RUNTIME. */
  prefs: GamePrefs
}

/**
 * 各 mode 的手勢強度常數（閾值/速度/拍數），由 mode 派生、不做使用者滑桿（plan/22 §1.2）。
 * 角度單位 rad；時間單位 ms；速度單位 normalized-units/ms（座標已正規化到 0..1）。
 */
export const INTENSITY_BY_MODE: Record<Exclude<InteractMode, 'off'>, {
  /** 星擊長按蓄力：填滿環所需毫秒 */
  holdChargeMs: number
  /** 星擊節奏：需準確命中的拍數 */
  rhythmBeats: number
  /** 星擊節奏：每拍判定窗（ms，越小越難） */
  rhythmWindowMs: number
  /** 星擊節奏：拍間隔（ms） */
  rhythmIntervalMs: number
  /** 捕獲畫圈封印：累積到 1.0 所需總旋轉弧度（rad） */
  circleTargetRad: number
  /** 捕獲丟球：判定為有效甩動的最小速度（normalized-units/ms） */
  swipeMinSpeed: number
}> = {
  lite: { holdChargeMs: 850, rhythmBeats: 1, rhythmWindowMs: 240, rhythmIntervalMs: 600, circleTargetRad: Math.PI * 2, swipeMinSpeed: 0.0008 },
  arcade: { holdChargeMs: 1200, rhythmBeats: 3, rhythmWindowMs: 170, rhythmIntervalMs: 520, circleTargetRad: Math.PI * 6, swipeMinSpeed: 0.001 },
}

const KEY = 'mobie.settings.v1'

function hasLS(): boolean {
  return typeof localStorage !== 'undefined'
}

function allSurfacesOn(): Record<InteractSurface, boolean> {
  const s = {} as Record<InteractSurface, boolean>
  for (const id of INTERACT_SURFACES) s[id] = true
  return s
}

/** M22 UX 偏好預設：mode='off'（現狀一字不差）、surfaces 全 true（待 mode 開啟才生效）。
 *  EXT.1：juice='full'（升級爽感）、haptics=true（裝置不支援自動 no-op）。 */
export function defaultPrefs(): GamePrefs {
  return { enhancedInteractivity: { mode: 'off', surfaces: allSurfacesOn() }, recordReplays: false, attackInputVariant: 'mash', juice: 'full', haptics: true }
}

export function defaultSettings(): GameSettings {
  return { prefs: defaultPrefs() }
}

/** 把任意外來物正規化成合法 GamePrefs（遷移 / 防壞檔 / 缺欄補預設）。純函數，可測。 */
export function migratePrefs(raw: unknown): GamePrefs {
  if (!raw || typeof raw !== 'object') return defaultPrefs()
  const o = raw as Record<string, unknown>
  const recordReplays = o.recordReplays === true // 缺欄/未知 → 預設 off
  const attackInputVariant: AttackInputVariant = o.attackInputVariant === 'rhythm' ? 'rhythm' : 'mash'
  // EXT.1：juice 預設 full（缺欄/未知 → 升級爽感）；haptics 預設 true（只認顯式 false 才關）。
  const juice: JuiceLevel = o.juice === 'off' ? 'off' : o.juice === 'reduced' ? 'reduced' : 'full'
  const haptics = o.haptics !== false
  let mode: InteractMode = 'off'
  const surfaces = allSurfacesOn()
  const ei = o.enhancedInteractivity
  if (ei && typeof ei === 'object') {
    const e = ei as Record<string, unknown>
    mode = e.mode === 'lite' || e.mode === 'arcade' ? e.mode : 'off'
    const s = e.surfaces
    if (s && typeof s === 'object') {
      for (const id of INTERACT_SURFACES) {
        // 只認顯式 false 才關；其餘（缺漏/未知）維持預設 true
        if ((s as Record<string, unknown>)[id] === false) surfaces[id] = false
      }
    }
  }
  return { enhancedInteractivity: { mode, surfaces }, recordReplays, attackInputVariant, juice, haptics }
}

/** Project only writable runtime prefs from the v1 envelope; legacy modules are deliberately ignored. */
export function runtimeSettingsFromV1(raw: unknown): GameSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaultSettings()
  return { prefs: migratePrefs((raw as Record<string, unknown>).prefs) }
}

/** Merge prefs without interpreting, normalizing, deleting, or replacing legacy v1 rollback fields. */
export function mergeRuntimeSettingsIntoLegacyV1(
  legacy: Record<string, unknown>,
  settings: GameSettings,
): Record<string, unknown> {
  return {
    ...legacy,
    ...(!Object.prototype.hasOwnProperty.call(legacy, 'schemaVersion')
      ? { schemaVersion: SETTINGS_SCHEMA_VERSION }
      : {}),
    prefs: settings.prefs,
  }
}

/** 純函數：回傳把增強互動 mode 設成新值後的設定（surfaces 不動）。 */
export function setInteractModeIn(settings: GameSettings, mode: InteractMode): GameSettings {
  return {
    ...settings,
    prefs: { ...settings.prefs, enhancedInteractivity: { ...settings.prefs.enhancedInteractivity, mode } },
  }
}

/** 純函數：回傳把「錄製戰鬥回放」開關設成新值後的設定（M14）。 */
export function setReplayRecordingIn(settings: GameSettings, on: boolean): GameSettings {
  return { ...settings, prefs: { ...settings.prefs, recordReplays: on } }
}

/** 純函數：回傳把攻擊輸入變體設成新值後的設定（M22.g）。 */
export function setAttackInputVariantIn(settings: GameSettings, variant: AttackInputVariant): GameSettings {
  return { ...settings, prefs: { ...settings.prefs, attackInputVariant: variant } }
}

/** 純函數：回傳把打擊感強度設成新值後的設定（EXT.1）。 */
export function setJuiceIn(settings: GameSettings, juice: JuiceLevel): GameSettings {
  return { ...settings, prefs: { ...settings.prefs, juice } }
}

/** 純函數：回傳把觸覺回饋開關設成新值後的設定（EXT.1）。 */
export function setHapticsIn(settings: GameSettings, on: boolean): GameSettings {
  return { ...settings, prefs: { ...settings.prefs, haptics: on } }
}

/** 當前打擊感強度（EXT.1）。供 BattleScreen/sprite 判斷是否 spawn 數字/頓格/動態。 */
export function juiceLevelOf(settings: GameSettings): JuiceLevel {
  return settings.prefs.juice
}

/** 觸覺回饋是否開啟（EXT.1）。實際是否震動仍取決於裝置 feature-detect（見 input/haptics）。 */
export function hapticsEnabledOf(settings: GameSettings): boolean {
  return settings.prefs.haptics === true
}

/** 當前生效的攻擊輸入變體：只有 mode≠off 且選了 rhythm 才回 'rhythm'，否則 'mash'（現狀）。 */
export function attackInputVariantOf(settings: GameSettings): AttackInputVariant {
  const ei = settings.prefs.enhancedInteractivity
  return ei.mode !== 'off' && settings.prefs.attackInputVariant === 'rhythm' ? 'rhythm' : 'mash'
}

/**
 * 統一 selector（plan/22 §1.3）：某互動環節是否啟用增強手勢＝mode≠off 且該 surface 開著。
 * 各頁一律用此判斷，別自行檢查 mode/surface。
 */
export function isEnhancedSurfaceEnabled(settings: GameSettings, surface: InteractSurface): boolean {
  const ei = settings.prefs.enhancedInteractivity
  return ei.mode !== 'off' && ei.surfaces[surface] === true
}

/** 回某 surface 的當前互動 mode；surface 關閉或全域 off → 'off'。供 component 取強度常數。 */
export function interactModeOf(settings: GameSettings, surface: InteractSurface): InteractMode {
  return isEnhancedSurfaceEnabled(settings, surface) ? settings.prefs.enhancedInteractivity.mode : 'off'
}

export function loadSettings(): GameSettings {
  if (!hasLS()) return defaultSettings()
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaultSettings()
    return runtimeSettingsFromV1(JSON.parse(raw))
  } catch {
    return defaultSettings()
  }
}

export function saveSettings(settings: GameSettings): void {
  if (!hasLS()) return
  try {
    const existing = localStorage.getItem(KEY)
    let legacy: Record<string, unknown> = {}
    if (existing !== null) {
      const parsed: unknown = JSON.parse(existing)
      // A malformed/non-object legacy payload remains untouched instead of being rewritten for a preference.
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
      legacy = parsed as Record<string, unknown>
    }
    localStorage.setItem(KEY, JSON.stringify(mergeRuntimeSettingsIntoLegacyV1(legacy, settings)))
  } catch {
    /* 配額 / 隱私模式失敗：忽略，不影響遊戲 */
  }
}
