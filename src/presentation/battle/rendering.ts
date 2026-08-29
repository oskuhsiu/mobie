import type { BattleSessionToken } from './contracts'

export const GRAPHICS_PREFERENCES = ['auto', 'high', 'balanced', 'compatibility'] as const
export type GraphicsPreference = (typeof GRAPHICS_PREFERENCES)[number]

export type EffectiveGraphicsTier = 'high' | 'balanced' | 'compatibility'
export type BattleRendererPhase = 'renderer-booting' | 'next-ready' | 'compatibility-ready'
export type RendererFallbackReason =
  | 'preference'
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
  route: 'next' | 'compatibility'
  tier: EffectiveGraphicsTier
  dprCap: 1 | 1.5 | null
}

export interface BattleRendererState {
  attemptId: string
  phase: BattleRendererPhase
  requested: GraphicsPreference
  tier: EffectiveGraphicsTier
  dprCap: 1 | 1.5 | null
  fallbackReason: RendererFallbackReason | null
}

export type BattleRendererEvent =
  | { type: 'NEXT_READY'; attemptId: string }
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
  latchedFallback?: RendererFallbackReason | null
}): BattleRendererState {
  const graphics = resolveGraphicsPreference(options.preference)
  const fallbackReason = options.latchedFallback
    ?? (graphics.route === 'compatibility' ? 'preference' : null)
  if (fallbackReason) {
    return {
      attemptId: options.attemptId,
      phase: 'compatibility-ready',
      requested: graphics.requested,
      tier: 'compatibility',
      dprCap: null,
      fallbackReason,
    }
  }
  return {
    attemptId: options.attemptId,
    phase: 'renderer-booting',
    requested: graphics.requested,
    tier: graphics.tier,
    dprCap: graphics.dprCap,
    fallbackReason: null,
  }
}

export function reduceBattleRendererState(
  state: BattleRendererState,
  event: BattleRendererEvent,
): BattleRendererState {
  if (event.attemptId !== state.attemptId || state.phase === 'compatibility-ready') return state
  if (event.type === 'NEXT_READY') {
    return state.phase === 'next-ready' ? state : { ...state, phase: 'next-ready' }
  }
  return {
    ...state,
    phase: 'compatibility-ready',
    tier: 'compatibility',
    dprCap: null,
    fallbackReason: event.reason,
  }
}

export function rendererIsReady(state: BattleRendererState | null): boolean {
  return state?.phase === 'next-ready' || state?.phase === 'compatibility-ready'
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
