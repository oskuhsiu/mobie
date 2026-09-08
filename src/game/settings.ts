// Player-owned runtime preferences. Settings v2 is the only writable shape;
// mobie.settings.v1 remains a read-only migration source for rollback safety.

export const SETTINGS_SCHEMA_VERSION = 2 as const
export const SETTINGS_V1_KEY = 'mobie.settings.v1'
export const SETTINGS_V2_KEY = 'mobie.settings.v2'

export const GRAPHICS_PREFERENCES = ['auto', 'high', 'balanced', 'compatibility'] as const
export type GraphicsPreference = (typeof GRAPHICS_PREFERENCES)[number]

// ── M22 enhanced interaction (UX preference; it never enters battle assembly). ──

/** Interactive surfaces supported by the M22 gesture layer. */
export type InteractSurface = 'capture' | 'starStrike' | 'defense' | 'encounter' | 'hatch' | 'tower'
export const INTERACT_SURFACES: InteractSurface[] = ['capture', 'starStrike', 'defense', 'encounter', 'hatch', 'tower']

/** off = ordinary tap, lite = one simple gesture, arcade = arcade-style input. */
export type InteractMode = 'off' | 'lite' | 'arcade'

/** M22.g attack input variant. It only takes effect when enhanced interaction is on. */
export type AttackInputVariant = 'mash' | 'rhythm'

// ── EXT.1 presentation preferences. ───────────────────────────────────────────

export type JuiceLevel = 'full' | 'reduced' | 'off'

export interface GamePrefs {
  enhancedInteractivity: {
    mode: InteractMode
    surfaces: Record<InteractSurface, boolean>
  }
  recordReplays: boolean
  attackInputVariant: AttackInputVariant
  juice: JuiceLevel
  haptics: boolean
  graphicsPreference: GraphicsPreference
  scannerEnabled: boolean
}

/** Exact persisted v2 envelope. Fixed battle capabilities are not settings. */
export interface GameSettingsV2 {
  schemaVersion: 2
  prefs: GamePrefs
}

/** Short compatibility name used by existing presentation/store callers. */
export type GameSettings = GameSettingsV2

/**
 * Gesture intensity constants. The values are derived from the selected mode,
 * rather than being persisted as another preference.
 */
export const INTENSITY_BY_MODE: Record<Exclude<InteractMode, 'off'>, {
  holdChargeMs: number
  rhythmBeats: number
  rhythmWindowMs: number
  rhythmIntervalMs: number
  circleTargetRad: number
  swipeMinSpeed: number
}> = {
  lite: { holdChargeMs: 850, rhythmBeats: 1, rhythmWindowMs: 240, rhythmIntervalMs: 600, circleTargetRad: Math.PI * 2, swipeMinSpeed: 0.0008 },
  arcade: { holdChargeMs: 1200, rhythmBeats: 3, rhythmWindowMs: 170, rhythmIntervalMs: 520, circleTargetRad: Math.PI * 6, swipeMinSpeed: 0.001 },
}

export interface SettingsStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function hasLS(): boolean {
  return typeof localStorage !== 'undefined'
}

function storage(): SettingsStorage | undefined {
  if (!hasLS()) return undefined
  try { return localStorage } catch { return undefined }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function allSurfacesOn(): Record<InteractSurface, boolean> {
  const surfaces = {} as Record<InteractSurface, boolean>
  for (const id of INTERACT_SURFACES) surfaces[id] = true
  return surfaces
}

function isGraphicsPreference(value: unknown): value is GraphicsPreference {
  return typeof value === 'string' && (GRAPHICS_PREFERENCES as readonly string[]).includes(value)
}

function isInteractMode(value: unknown): value is InteractMode {
  return value === 'off' || value === 'lite' || value === 'arcade'
}

function isAttackInputVariant(value: unknown): value is AttackInputVariant {
  return value === 'mash' || value === 'rhythm'
}

function isJuiceLevel(value: unknown): value is JuiceLevel {
  return value === 'full' || value === 'reduced' || value === 'off'
}

/** Defaults are also the canonical values used when a legacy preference is absent. */
export function defaultPrefs(): GamePrefs {
  return {
    enhancedInteractivity: { mode: 'off', surfaces: allSurfacesOn() },
    recordReplays: false,
    attackInputVariant: 'mash',
    juice: 'full',
    haptics: true,
    graphicsPreference: 'auto',
    scannerEnabled: false,
  }
}

export function defaultSettings(): GameSettingsV2 {
  return { schemaVersion: SETTINGS_SCHEMA_VERSION, prefs: defaultPrefs() }
}

/**
 * Migrate the preference subtree of the old v1 envelope. Legacy `modules`
 * (including encounterSkills) are intentionally never inspected or copied.
 * Scanner is a new capability and therefore always starts off after migration.
 */
export function migratePrefs(raw: unknown): GamePrefs {
  if (!isRecord(raw)) return defaultPrefs()
  const recordReplays = raw.recordReplays === true
  const attackInputVariant: AttackInputVariant = raw.attackInputVariant === 'rhythm' ? 'rhythm' : 'mash'
  const juice: JuiceLevel = raw.juice === 'off' ? 'off' : raw.juice === 'reduced' ? 'reduced' : 'full'
  const haptics = raw.haptics !== false
  const graphicsPreference = isGraphicsPreference(raw.graphicsPreference) ? raw.graphicsPreference : 'auto'
  let mode: InteractMode = 'off'
  const surfaces = allSurfacesOn()
  if (isRecord(raw.enhancedInteractivity)) {
    mode = isInteractMode(raw.enhancedInteractivity.mode) ? raw.enhancedInteractivity.mode : 'off'
    if (isRecord(raw.enhancedInteractivity.surfaces)) {
      for (const id of INTERACT_SURFACES) {
        if (raw.enhancedInteractivity.surfaces[id] === false) surfaces[id] = false
      }
    }
  }
  return {
    enhancedInteractivity: { mode, surfaces },
    recordReplays,
    attackInputVariant,
    juice,
    haptics,
    graphicsPreference,
    scannerEnabled: false,
  }
}

/** Project a legacy v1 envelope into the exact v2 runtime shape. */
export function runtimeSettingsFromV1(raw: unknown): GameSettingsV2 {
  if (!isRecord(raw) || (raw.schemaVersion !== undefined && raw.schemaVersion !== 1)) return defaultSettings()
  return { schemaVersion: SETTINGS_SCHEMA_VERSION, prefs: migratePrefs(raw.prefs) }
}

function parseLegacyV1(raw: unknown): GameSettingsV2 | null {
  if (!isRecord(raw)) return null
  if (raw.schemaVersion !== undefined && raw.schemaVersion !== 1) return null
  return runtimeSettingsFromV1(raw)
}

function validSurfaces(raw: unknown): raw is Record<InteractSurface, boolean> {
  if (!isRecord(raw)) return false
  return INTERACT_SURFACES.every((id) => typeof raw[id] === 'boolean')
}

/**
 * Validate and canonicalize v2. Unknown keys are discarded from the returned
 * value, while a missing or incorrectly typed required key makes the payload
 * invalid and lets the caller continue to v1/default recovery.
 */
export function parseSettingsV2(raw: unknown): GameSettingsV2 | null {
  if (!isRecord(raw) || raw.schemaVersion !== SETTINGS_SCHEMA_VERSION || !isRecord(raw.prefs)) return null
  const prefs = raw.prefs
  const interaction = prefs.enhancedInteractivity
  const surfaces = interaction && isRecord(interaction) ? interaction.surfaces : null
  if (
    !isRecord(interaction)
    || !isInteractMode(interaction.mode)
    || !validSurfaces(surfaces)
    || typeof prefs.recordReplays !== 'boolean'
    || !isAttackInputVariant(prefs.attackInputVariant)
    || !isJuiceLevel(prefs.juice)
    || typeof prefs.haptics !== 'boolean'
    || !isGraphicsPreference(prefs.graphicsPreference)
    || typeof prefs.scannerEnabled !== 'boolean'
  ) return null

  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    prefs: {
      enhancedInteractivity: {
        mode: interaction.mode,
        surfaces: Object.fromEntries(INTERACT_SURFACES.map((id) => [id, surfaces[id]])) as Record<InteractSurface, boolean>,
      },
      recordReplays: prefs.recordReplays,
      attackInputVariant: prefs.attackInputVariant,
      juice: prefs.juice,
      haptics: prefs.haptics,
      graphicsPreference: prefs.graphicsPreference,
      scannerEnabled: prefs.scannerEnabled,
    },
  }
}

export function isSettingsV2(raw: unknown): raw is GameSettingsV2 {
  return parseSettingsV2(raw) !== null
}

function parseStoredJson(value: string | null): unknown | null {
  if (value === null) return null
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

/**
 * Load in the locked order: valid v2, valid v1 migrated into v2, defaults.
 * Storage failures are treated as an unavailable persistence layer and never
 * prevent the app from starting.
 */
export function loadSettingsFrom(store: SettingsStorage | undefined): GameSettingsV2 {
  if (!store) return defaultSettings()

  let v2: unknown = null
  try { v2 = parseStoredJson(store.getItem(SETTINGS_V2_KEY)) } catch { v2 = null }
  const current = parseSettingsV2(v2)
  if (current) return current

  let v1: unknown = null
  try { v1 = parseStoredJson(store.getItem(SETTINGS_V1_KEY)) } catch { v1 = null }
  const migrated = parseLegacyV1(v1)
  if (migrated) {
    try { store.setItem(SETTINGS_V2_KEY, JSON.stringify(migrated)) } catch {
      // A read-only/private storage still gets a live migrated runtime value.
    }
    return migrated
  }
  return defaultSettings()
}

export function loadSettings(): GameSettingsV2 {
  return loadSettingsFrom(storage())
}

/** Serialize only the exact v2 envelope. This function never reads or writes v1. */
export function serializeSettingsV2(settings: GameSettingsV2): string {
  const parsed = parseSettingsV2(settings)
  return JSON.stringify(parsed ?? defaultSettings())
}

export function saveSettingsTo(store: SettingsStorage | undefined, settings: GameSettingsV2): void {
  if (!store) return
  try { store.setItem(SETTINGS_V2_KEY, serializeSettingsV2(settings)) } catch {
    /* Quota/private-mode failure: keep the live preference in memory. */
  }
}

export function saveSettings(settings: GameSettingsV2): void {
  saveSettingsTo(storage(), settings)
}

export function setInteractModeIn(settings: GameSettingsV2, mode: InteractMode): GameSettingsV2 {
  return {
    ...settings,
    prefs: { ...settings.prefs, enhancedInteractivity: { ...settings.prefs.enhancedInteractivity, mode } },
  }
}

export function setReplayRecordingIn(settings: GameSettingsV2, on: boolean): GameSettingsV2 {
  return { ...settings, prefs: { ...settings.prefs, recordReplays: on } }
}

export function setAttackInputVariantIn(settings: GameSettingsV2, variant: AttackInputVariant): GameSettingsV2 {
  return { ...settings, prefs: { ...settings.prefs, attackInputVariant: variant } }
}

export function setJuiceIn(settings: GameSettingsV2, juice: JuiceLevel): GameSettingsV2 {
  return { ...settings, prefs: { ...settings.prefs, juice } }
}

export function setHapticsIn(settings: GameSettingsV2, on: boolean): GameSettingsV2 {
  return { ...settings, prefs: { ...settings.prefs, haptics: on } }
}

export function setGraphicsPreferenceIn(settings: GameSettingsV2, preference: GraphicsPreference): GameSettingsV2 {
  return { ...settings, prefs: { ...settings.prefs, graphicsPreference: preference } }
}

export function setScannerEnabledIn(settings: GameSettingsV2, enabled: boolean): GameSettingsV2 {
  return { ...settings, prefs: { ...settings.prefs, scannerEnabled: enabled } }
}

export function juiceLevelOf(settings: GameSettingsV2): JuiceLevel {
  return settings.prefs.juice
}

export function hapticsEnabledOf(settings: GameSettingsV2): boolean {
  return settings.prefs.haptics === true
}

export function attackInputVariantOf(settings: GameSettingsV2): AttackInputVariant {
  const interaction = settings.prefs.enhancedInteractivity
  return interaction.mode !== 'off' && settings.prefs.attackInputVariant === 'rhythm' ? 'rhythm' : 'mash'
}

export function isEnhancedSurfaceEnabled(settings: GameSettingsV2, surface: InteractSurface): boolean {
  const interaction = settings.prefs.enhancedInteractivity
  return interaction.mode !== 'off' && interaction.surfaces[surface] === true
}

export function interactModeOf(settings: GameSettingsV2, surface: InteractSurface): InteractMode {
  return isEnhancedSurfaceEnabled(settings, surface) ? settings.prefs.enhancedInteractivity.mode : 'off'
}
