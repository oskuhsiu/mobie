// M6.0 — 設定存檔 slice（mobie.settings.v1）。設計真相：plan/09 §0.3。
//
// 獨立命名空間（與 roster `mobie.roster.v2` 不同）：延伸系統「逐一開關」住這裡，**預設全關**＝
// 新玩家拿到純 M1.x 體驗。不違反「只存 canonical roster」——該不變式約束的是 roster 序列化，
// 模組自有 slice 是另一命名空間（plan/09 §0.3）。
//
// 純判斷邏輯（defaultSettings / migrateSettings / setModuleEnabledIn）可單獨 vitest；
// localStorage I/O 薄、在無 localStorage（node 測試）時安全退回預設（同 saveMeta 慣例）。

import type { ModuleId } from '@/game/ext/seams'

export const SETTINGS_SCHEMA_VERSION = 1

/** 全部延伸模組 id（設定頁逐一列出；新增模組時補這裡） */
export const MODULE_IDS: ModuleId[] = ['synergy', 'heldItems', 'abilities', 'chain', 'combo', 'evolution', 'partnerSkills', 'encounterSkills']

// ── M22 增強互動性（UX 偏好，非戰鬥模組）。設計真相：plan/22。 ────────────────────
// 與 modules 不同：不註冊任何 S1–S8 seam、不碰 reducer/engine，只在 display 層替換/疊加互動
// component。故住獨立的 `prefs` 欄（避免被當戰鬥模組、避免污染 MODULE_IDS）。預設 off＝現狀一字不差。

/** 可疊加手勢的互動環節（情緒峰值優先）。MVP 只實作 capture/starStrike，其餘為 backlog 佔位。 */
export type InteractSurface = 'capture' | 'starStrike' | 'defense' | 'encounter' | 'hatch' | 'tower'
export const INTERACT_SURFACES: InteractSurface[] = ['capture', 'starStrike', 'defense', 'encounter', 'hatch', 'tower']

/** off＝零互動（現狀）；lite＝直覺單一手勢；arcade＝機台式高頻手勢。 */
export type InteractMode = 'off' | 'lite' | 'arcade'

/** M22.g 攻擊輸入變體：mash＝既有連打（預設）；rhythm＝太鼓式節奏點擊（只在 mode≠off 時替換）。 */
export type AttackInputVariant = 'mash' | 'rhythm'

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
}

export interface GameSettings {
  schemaVersion: number
  /** 逐系統開關，預設全 false */
  modules: Record<ModuleId, boolean>
  /** M22 UX 偏好（不參與 ext/prep/postGrowth 注入） */
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

function allOff(): Record<ModuleId, boolean> {
  const m = {} as Record<ModuleId, boolean>
  for (const id of MODULE_IDS) m[id] = false
  return m
}

function allSurfacesOn(): Record<InteractSurface, boolean> {
  const s = {} as Record<InteractSurface, boolean>
  for (const id of INTERACT_SURFACES) s[id] = true
  return s
}

/** M22 UX 偏好預設：mode='off'（現狀一字不差）、surfaces 全 true（待 mode 開啟才生效）。 */
export function defaultPrefs(): GamePrefs {
  return { enhancedInteractivity: { mode: 'off', surfaces: allSurfacesOn() }, recordReplays: false, attackInputVariant: 'mash' }
}

export function defaultSettings(): GameSettings {
  return { schemaVersion: SETTINGS_SCHEMA_VERSION, modules: allOff(), prefs: defaultPrefs() }
}

/** 把任意外來物正規化成合法 GamePrefs（遷移 / 防壞檔 / 缺欄補預設）。純函數，可測。 */
export function migratePrefs(raw: unknown): GamePrefs {
  if (!raw || typeof raw !== 'object') return defaultPrefs()
  const o = raw as Record<string, unknown>
  const recordReplays = o.recordReplays === true // 缺欄/未知 → 預設 off
  const attackInputVariant: AttackInputVariant = o.attackInputVariant === 'rhythm' ? 'rhythm' : 'mash'
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
  return { enhancedInteractivity: { mode, surfaces }, recordReplays, attackInputVariant }
}

/** 把任意外來物正規化成合法 GameSettings（遷移 / 防壞檔）。純函數，可測。 */
export function migrateSettings(raw: unknown): GameSettings {
  const base = defaultSettings()
  if (!raw || typeof raw !== 'object') return base
  const o = raw as Record<string, unknown>
  const modules = allOff()
  const m = o.modules
  if (m && typeof m === 'object') {
    for (const id of MODULE_IDS) {
      // 只認布林 true；未知/缺漏一律維持 false（零殘留預設）
      modules[id] = (m as Record<string, unknown>)[id] === true
    }
  }
  return {
    schemaVersion: typeof o.schemaVersion === 'number' ? o.schemaVersion : base.schemaVersion,
    modules,
    prefs: migratePrefs(o.prefs),
  }
}

/** 純函數：回傳把某模組設成 on/off 後的新設定（不碰 localStorage，方便測試）。 */
export function setModuleEnabledIn(settings: GameSettings, id: ModuleId, on: boolean): GameSettings {
  return { ...settings, modules: { ...settings.modules, [id]: on } }
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
    return migrateSettings(JSON.parse(raw))
  } catch {
    return defaultSettings()
  }
}

export function saveSettings(settings: GameSettings): void {
  if (!hasLS()) return
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    /* 配額 / 隱私模式失敗：忽略，不影響遊戲 */
  }
}
