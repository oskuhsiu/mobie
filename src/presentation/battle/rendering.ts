import type { BattleSessionToken } from './contracts'

export const GRAPHICS_PREFERENCES = ['auto', 'high', 'balanced', 'compatibility'] as const
export type GraphicsPreference = (typeof GRAPHICS_PREFERENCES)[number]

/**
 * Release A renderer entry points. The compatibility entry is a terminal
 * fallback, while legacy and next are selected before a battle renderer boots.
 */
export const BATTLE_RENDERER_ROUTES = ['legacy', 'next', 'compatibility'] as const
export type BattleRendererRoute = (typeof BATTLE_RENDERER_ROUTES)[number]

/**
 * Next is an opt-in development/test route for Release A. Compatibility stays
 * available in production because it is the recovery path for failed WebGL.
 */
export function resolveBattleRendererRoute(
  requested?: BattleRendererRoute,
  allowNext = false,
): BattleRendererRoute {
  if (requested === 'compatibility') return 'compatibility'
  if (requested === 'next' && allowNext) return 'next'
  return 'legacy'
}

export type EffectiveGraphicsTier = 'high' | 'balanced' | 'compatibility'
export type BattleRendererPhase = 'renderer-booting' | 'legacy-ready' | 'next-ready' | 'compatibility-ready'
export type RendererFallbackReason =
  | 'preference'
  | 'performance'
  | 'webgl-unsupported'
  | 'chunk-reject'
  | 'chunk-timeout'
  | 'shader-error'
  | 'context-lost'
  | 'render-error'

export type RendererFailureInjection =
  | 'chunk-reject'
  | 'chunk-timeout'
  | 'webgl-unsupported'
  | 'shader-error'

export interface GraphicsResolution {
  requested: GraphicsPreference
  /** Quality resolver route; the Release A entry route is BattleRendererRoute. */
  route: 'next' | 'compatibility'
  tier: EffectiveGraphicsTier
  dprCap: 1 | 1.5 | null
}

/**
 * Renderer cost controls are separate from motion and juice. A governor may
 * move through these profiles during one battle, but it can only move in the
 * cheaper direction until the next battle session is created.
 */
export type GraphicsQualityStage =
  | 'high'
  | 'high-dpr-reduced'
  | 'high-post-reduced'
  | 'balanced'
  | 'balanced-effects-reduced'
  | 'compatibility'

export interface GraphicsQualityProfile {
  stage: GraphicsQualityStage
  tier: EffectiveGraphicsTier
  dprCap: 1 | 1.5 | null
  /** A restrained compositor grade; disabled before particle/weather reduction. */
  postEnabled: boolean
  /** Multiplier for transient VFX emission, independent of the graphics tier. */
  particleScale: number
  /** Multiplier for continuous weather emission. */
  weatherScale: number
  /** Upper bound for the DOM canvas transient particle pool. */
  transientParticleCap: number
}

const QUALITY_PROFILES: Record<GraphicsQualityStage, GraphicsQualityProfile> = {
  high: {
    stage: 'high', tier: 'high', dprCap: 1.5, postEnabled: true,
    particleScale: 1, weatherScale: 1, transientParticleCap: 320,
  },
  'high-dpr-reduced': {
    stage: 'high-dpr-reduced', tier: 'high', dprCap: 1, postEnabled: true,
    particleScale: 1, weatherScale: 1, transientParticleCap: 320,
  },
  'high-post-reduced': {
    stage: 'high-post-reduced', tier: 'high', dprCap: 1, postEnabled: false,
    particleScale: 1, weatherScale: 1, transientParticleCap: 320,
  },
  balanced: {
    stage: 'balanced', tier: 'balanced', dprCap: 1, postEnabled: false,
    particleScale: 1, weatherScale: 0.3, transientParticleCap: 160,
  },
  'balanced-effects-reduced': {
    stage: 'balanced-effects-reduced', tier: 'balanced', dprCap: 1, postEnabled: false,
    particleScale: 0.5, weatherScale: 0.1, transientParticleCap: 80,
  },
  compatibility: {
    stage: 'compatibility', tier: 'compatibility', dprCap: null, postEnabled: false,
    particleScale: 0.5, weatherScale: 0, transientParticleCap: 80,
  },
}

function copyQualityProfile(profile: GraphicsQualityProfile): GraphicsQualityProfile {
  return { ...profile }
}

export function graphicsQualityProfileOf(preference?: GraphicsPreference): GraphicsQualityProfile {
  switch (preference ?? 'auto') {
    case 'high': return copyQualityProfile(QUALITY_PROFILES.high)
    case 'compatibility': return copyQualityProfile(QUALITY_PROFILES.compatibility)
    case 'auto':
    case 'balanced':
      return copyQualityProfile(QUALITY_PROFILES.balanced)
  }
}

export function graphicsQualityProfileForStage(stage: GraphicsQualityStage): GraphicsQualityProfile {
  return copyQualityProfile(QUALITY_PROFILES[stage])
}

export interface BattleRendererState {
  attemptId: string
  phase: BattleRendererPhase
  route: BattleRendererRoute
  requested: GraphicsPreference
  tier: EffectiveGraphicsTier
  dprCap: 1 | 1.5 | null
  quality: GraphicsQualityProfile
  fallbackReason: RendererFallbackReason | null
}

export type BattleRendererEvent =
  | { type: 'NEXT_READY'; attemptId: string }
  | { type: 'LEGACY_READY'; attemptId: string }
  | { type: 'FALLBACK'; attemptId: string; reason: RendererFallbackReason }

export function resolveGraphicsPreference(preference?: GraphicsPreference): GraphicsResolution {
  const requested = preference ?? 'auto'
  switch (requested) {
    case 'auto': return { requested, route: 'next', tier: 'balanced', dprCap: 1 }
    case 'balanced': return { requested, route: 'next', tier: 'balanced', dprCap: 1 }
    case 'high': return { requested, route: 'next', tier: 'high', dprCap: 1.5 }
    case 'compatibility': return {
      requested,
      route: 'compatibility',
      tier: 'compatibility',
      dprCap: null,
    }
  }
}

export function createBattleRendererState(options: {
  attemptId: string
  preference?: GraphicsPreference
  rendererRoute?: BattleRendererRoute
  latchedFallback?: RendererFallbackReason | null
}): BattleRendererState {
  const graphics = resolveGraphicsPreference(options.preference)
  const rendererRoute = graphics.route === 'compatibility'
    ? 'compatibility'
    : options.rendererRoute ?? 'legacy'
  const fallbackReason = options.latchedFallback
    ?? (rendererRoute === 'compatibility' ? 'preference' : null)
  if (fallbackReason) {
    const quality = graphicsQualityProfileForStage('compatibility')
    return {
      attemptId: options.attemptId,
      phase: 'compatibility-ready',
      route: 'compatibility',
      requested: graphics.requested,
      tier: quality.tier,
      dprCap: quality.dprCap,
      quality,
      fallbackReason,
    }
  }
  const quality = graphicsQualityProfileOf(graphics.requested)
  return {
    attemptId: options.attemptId,
    phase: 'renderer-booting',
    route: rendererRoute,
    requested: graphics.requested,
    tier: quality.tier,
    dprCap: quality.dprCap,
    quality,
    fallbackReason: null,
  }
}

export function updateBattleRendererQuality(
  state: BattleRendererState,
  quality: GraphicsQualityProfile,
): BattleRendererState {
  if (state.phase === 'compatibility-ready' || quality.tier === 'compatibility') return state
  if (
    state.quality.stage === quality.stage
    && state.dprCap === quality.dprCap
    && state.tier === quality.tier
  ) return state
  return { ...state, tier: quality.tier, dprCap: quality.dprCap, quality }
}

export function reduceBattleRendererState(
  state: BattleRendererState,
  event: BattleRendererEvent,
): BattleRendererState {
  if (event.attemptId !== state.attemptId || state.phase === 'compatibility-ready') return state
  if (event.type === 'NEXT_READY') {
    if (state.route !== 'next') return state
    return state.phase === 'next-ready'
      ? state
      : { ...state, phase: 'next-ready', route: 'next' }
  }
  if (event.type === 'LEGACY_READY') {
    if (state.route !== 'legacy') return state
    return state.phase === 'legacy-ready'
      ? state
      : { ...state, phase: 'legacy-ready', route: 'legacy' }
  }
  return {
    ...state,
    phase: 'compatibility-ready',
    route: 'compatibility',
    tier: 'compatibility',
    dprCap: null,
    quality: graphicsQualityProfileForStage('compatibility'),
    fallbackReason: event.reason,
  }
}

export function rendererIsReady(state: BattleRendererState | null): boolean {
  return state?.phase === 'legacy-ready'
    || state?.phase === 'next-ready'
    || state?.phase === 'compatibility-ready'
}

export function rendererAttemptId(token: BattleSessionToken): string {
  return `${token.battleSessionId}:${token.resultFingerprint}:renderer`
}

export function classifyRendererError(error: unknown): Extract<
  RendererFallbackReason,
  'shader-error' | 'render-error'
> {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return /shader|webglprogram|compile|link/i.test(message) ? 'shader-error' : 'render-error'
}
