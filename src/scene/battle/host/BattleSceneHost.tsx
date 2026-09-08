import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ForwardRefExoticComponent,
  type RefAttributes,
} from 'react'
import type { BattleSessionToken } from '@/presentation/battle/contracts'
import {
  classifyRendererError,
  createBattleRendererState,
  reduceBattleRendererState,
  resolveBattleRendererRoute,
  rendererAttemptId,
  updateBattleRendererQuality,
  type BattleRendererEvent,
  type BattleRendererRoute,
  type BattleRendererState,
  type GraphicsPreference,
  type GraphicsQualityProfile,
  type RendererFailureInjection,
  type RendererFallbackReason,
} from '@/presentation/battle/rendering'
import { projectBattleAnchor } from '@/presentation/battle/battleAnchors'
import type {
  BattleSceneDiagnostics,
  BattleSceneHandle,
  BattleSceneSnapshot,
  NextBattleSceneProps,
} from '@/scene/battle/contracts'
import { CompatibilityBattleScene } from '@/scene/battle/compat/CompatibilityBattleScene'
import { BattleRenderGate } from '@/ui/battle/BattleRenderGate'
import { BattleSceneBoundary } from './BattleSceneBoundary'
import { supportsWebGl } from './capabilityProbe'
import { TERRAIN_WORLD_TRANSITION_MS } from '@/scene/r3f/terrainVisual'

type BattleSceneComponent = ForwardRefExoticComponent<NextBattleSceneProps & RefAttributes<BattleSceneHandle>>

export interface BattleSceneHostProps {
  snapshot: BattleSceneSnapshot
  sessionToken: BattleSessionToken
  /** Post-M23 route. Absent uses the sole full scene entry, next. */
  rendererRoute?: BattleRendererRoute
  preference: GraphicsPreference
  quality: GraphicsQualityProfile
  active: boolean
  paused: boolean
  reducedMotion: boolean
  latchedFallback: RendererFallbackReason | null
  onStateChange: (token: BattleSessionToken, state: BattleRendererState) => void
  onFallback: (token: BattleSessionToken, reason: RendererFallbackReason) => void
  onRenderedFrame?: NextBattleSceneProps['onRenderedFrame']
  onRendererDiagnostics?: NextBattleSceneProps['onRendererDiagnostics']
  onVfxDiagnostics?: NextBattleSceneProps['onVfxDiagnostics']
  onArtworkCacheDiagnostics?: NextBattleSceneProps['onArtworkCacheDiagnostics']
  onSceneDiagnostics?: NextBattleSceneProps['onSceneDiagnostics']
  /** DEV/test failure injection; production callers omit this. */
  devFailure?: RendererFailureInjection | null
  timeoutMs?: number
}

const loadNextScene = () => import('@/scene/battle/next/NextBattleScene')

export const BattleSceneHost = forwardRef<BattleSceneHandle, BattleSceneHostProps>(function BattleSceneHost({
  snapshot,
  sessionToken,
  rendererRoute,
  preference,
  quality,
  active,
  paused,
  reducedMotion,
  latchedFallback,
  onStateChange,
  onFallback,
  onRenderedFrame,
  onRendererDiagnostics,
  onVfxDiagnostics,
  onArtworkCacheDiagnostics,
  onSceneDiagnostics,
  devFailure = null,
  timeoutMs = 8_000,
}, ref) {
  const activeDevFailure = import.meta.env.DEV ? devFailure : null
  const selectedRoute = resolveBattleRendererRoute(rendererRoute)
  const attemptId = rendererAttemptId(sessionToken)
  const [state, setState] = useState(() => createBattleRendererState({
    attemptId,
    preference,
    rendererRoute: selectedRoute,
    latchedFallback,
  }))
  const stateRef = useRef(state)
  const nextRef = useRef<BattleSceneHandle>(null)
  const compatibilityRef = useRef<BattleSceneHandle>(null)
  const [Scene, setScene] = useState<BattleSceneComponent | null>(null)
  const [sceneDiagnostics, setSceneDiagnostics] = useState<BattleSceneDiagnostics | null>(null)
  const initialStateReported = useRef(false)
  const bootTimeoutRef = useRef<number | null>(null)

  const clearBootTimeout = useCallback(() => {
    if (bootTimeoutRef.current === null) return
    window.clearTimeout(bootTimeoutRef.current)
    bootTimeoutRef.current = null
  }, [])

  const send = useCallback((event: BattleRendererEvent) => {
    const current = stateRef.current
    const next = reduceBattleRendererState(current, event)
    if (next === current) return false
    stateRef.current = next
    setState(next)
    if (next.phase !== 'renderer-booting') clearBootTimeout()
    if (next.phase === 'compatibility-ready' && current.phase !== 'compatibility-ready') {
      onFallback(sessionToken, next.fallbackReason!)
    }
    onStateChange(sessionToken, next)
    return true
  }, [clearBootTimeout, onFallback, onStateChange, sessionToken])

  useEffect(() => {
    if (initialStateReported.current) return
    initialStateReported.current = true
    onStateChange(sessionToken, state)
    if (state.phase === 'compatibility-ready' && !latchedFallback) {
      onFallback(sessionToken, state.fallbackReason!)
    }
  }, [latchedFallback, onFallback, onStateChange, sessionToken, state])

  useEffect(() => {
    const current = stateRef.current
    if (quality.tier === 'compatibility') {
      if (current.phase !== 'compatibility-ready') {
        send({ type: 'FALLBACK', attemptId, reason: 'performance' })
      }
      return
    }
    if (current.phase === 'compatibility-ready') return
    const next = updateBattleRendererQuality(current, quality)
    if (next === current) return
    stateRef.current = next
    setState(next)
    onStateChange(sessionToken, next)
  }, [attemptId, onStateChange, quality, send, sessionToken])

  useEffect(() => {
    if (stateRef.current.phase !== 'renderer-booting') return
    if (activeDevFailure === 'shader-error') {
      send({ type: 'FALLBACK', attemptId, reason: 'shader-error' })
      return
    }
    if (activeDevFailure === 'context-lost') {
      send({ type: 'FALLBACK', attemptId, reason: 'context-lost' })
      return
    }
    if (activeDevFailure === 'webgl-unsupported' || !supportsWebGl()) {
      send({ type: 'FALLBACK', attemptId, reason: 'webgl-unsupported' })
      return
    }

    let disposed = false
    bootTimeoutRef.current = window.setTimeout(() => {
      if (!disposed && stateRef.current.phase === 'renderer-booting') {
        send({ type: 'FALLBACK', attemptId, reason: 'chunk-timeout' })
      }
    }, timeoutMs)
    const route = stateRef.current.route
    const loading = activeDevFailure === 'chunk-timeout'
      ? new Promise<never>(() => undefined)
      : activeDevFailure === 'chunk-reject'
        ? Promise.reject(new Error(`Injected ${route} renderer chunk rejection`))
        : loadNextScene()

    void loading.then((module) => {
      if (!disposed && stateRef.current.phase === 'renderer-booting') {
        setScene(() => module.default as BattleSceneComponent)
      }
    }).catch(() => {
      if (!disposed) send({ type: 'FALLBACK', attemptId, reason: 'chunk-reject' })
    })
    return () => {
      disposed = true
      clearBootTimeout()
    }
  }, [activeDevFailure, attemptId, clearBootTimeout, send, timeoutMs])

  useImperativeHandle(ref, () => {
    const active = () => {
      if (stateRef.current.phase === 'compatibility-ready') return compatibilityRef.current
      return nextRef.current
    }
    return {
      tracer: (cue) => active()?.tracer?.(cue) ?? false,
      normalAttack: (cue) => active()?.normalAttack(cue),
      lunge: (side) => active()?.lunge(side),
      hitReact: (side, strength) => active()?.hitReact(side, strength),
      recall: (side) => active()?.recall?.(side),
      frameEntry: (side, cueId, owner) => active()?.frameEntry?.(side, cueId, owner),
      faint: (side) => active()?.faint(side),
      enter: (side) => active()?.enter(side),
      setTimeScale: (scale) => active()?.setTimeScale(scale),
      resetPresentation: (options) => active()?.resetPresentation(options),
      projectAnchor: (side, anchor, viewport) => active()?.projectAnchor(side, anchor, viewport)
        ?? projectBattleAnchor(side, anchor, viewport),
    }
  }, [])

  const fatal = (reason: RendererFallbackReason) => {
    send({ type: 'FALLBACK', attemptId, reason })
  }

  const handleSceneDiagnostics = useCallback((diagnostics: BattleSceneDiagnostics) => {
    setSceneDiagnostics(diagnostics)
    onSceneDiagnostics?.(diagnostics)
  }, [onSceneDiagnostics])

  const nextDiagnostics = state.phase === 'compatibility-ready' ? null : sceneDiagnostics

  return (
    <div
      className="battle-scene-host"
      data-renderer-state={state.phase}
      data-renderer-route={state.route}
      data-renderer-tier={state.tier}
      data-battle-quality-stage={state.quality.stage}
      data-battle-post={state.quality.postEnabled ? 'restrained' : 'off'}
      data-battle-quality-dpr={state.quality.dprCap === null ? 'css' : String(state.quality.dprCap)}
      data-renderer-fallback={state.fallbackReason ?? undefined}
      data-battle-camera-shot={nextDiagnostics?.cameraShot ?? 'wide'}
      data-battle-camera-owner={nextDiagnostics?.cameraOwner ?? undefined}
      data-battle-motion-phase={nextDiagnostics?.motionPhase ?? 'idle'}
      data-battle-artwork-player={nextDiagnostics?.artworkMode.player}
      data-battle-artwork-foe={nextDiagnostics?.artworkMode.foe}
      data-battle-anchor-player={nextDiagnostics?.anchors
        ? JSON.stringify(nextDiagnostics.anchors.player)
        : undefined}
      data-battle-anchor-foe={nextDiagnostics?.anchors
        ? JSON.stringify(nextDiagnostics.anchors.foe)
        : undefined}
      data-battle-anchor-player-impact={nextDiagnostics?.anchors
        ? `${nextDiagnostics.anchors.player.impact.x.toFixed(1)},${nextDiagnostics.anchors.player.impact.y.toFixed(1)}`
        : undefined}
      data-battle-anchor-foe-impact={nextDiagnostics?.anchors
        ? `${nextDiagnostics.anchors.foe.impact.x.toFixed(1)},${nextDiagnostics.anchors.foe.impact.y.toFixed(1)}`
        : undefined}
      data-battle-shake={reducedMotion ? '0' : 'enabled'}
      data-battle-bob={reducedMotion ? '0' : 'enabled'}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      data-terrain-id={snapshot.terrainWorld.primaryId}
      data-terrain-archetype={snapshot.terrainWorld.primary.archetype}
      data-terrain-accent={snapshot.terrainWorld.secondaryAccent?.terrainId}
      data-terrain-visual-intensity={snapshot.terrainVisualIntensity}
      data-terrain-transition-ms={TERRAIN_WORLD_TRANSITION_MS}
    >
      {state.phase !== 'compatibility-ready' && Scene && (
        <BattleSceneBoundary onFatal={(error) => fatal(classifyRendererError(error))}>
          <Scene
            ref={nextRef}
            snapshot={snapshot}
            tier={state.tier === 'high' ? 'high' : 'balanced'}
            quality={state.quality}
            active={active}
            paused={paused}
            reducedMotion={reducedMotion}
            onReady={() => send({ type: 'NEXT_READY', attemptId })}
            onFatal={fatal}
            onRenderedFrame={onRenderedFrame}
            onRendererDiagnostics={onRendererDiagnostics}
            onVfxDiagnostics={onVfxDiagnostics}
            onArtworkCacheDiagnostics={onArtworkCacheDiagnostics}
            onSceneDiagnostics={handleSceneDiagnostics}
          />
        </BattleSceneBoundary>
      )}
      {state.phase === 'compatibility-ready' && (
        <CompatibilityBattleScene
          ref={compatibilityRef}
          snapshot={snapshot}
          paused={paused}
          reducedMotion={reducedMotion}
        />
      )}
      {state.phase === 'renderer-booting' && <BattleRenderGate state="renderer-booting" />}
    </div>
  )
})
