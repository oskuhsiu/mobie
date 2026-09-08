import type {
  M23Checkpoint,
  M23ArtworkCache,
  M23GraphicsGovernor,
  M23MotionPreference,
  M23PoolCount,
  M23PresentationTraceEvent,
  M23RendererResources,
  M23RequestedGraphics,
  M23RendererRoute,
} from './contracts'
import { GraphicsGovernor } from '@/scene/battle/host/graphicsGovernor'
import {
  DEFAULT_BATTLE_RENDERER_ROUTE,
  resolveGraphicsPreference,
  type BattleRendererPhase,
  type BattleRendererState,
  type EffectiveGraphicsTier,
  type RendererFallbackReason,
} from '@/presentation/battle/rendering'

export interface M23DiagnosticsSnapshot {
  activeFrameGapsMs: number[]
  idleCadenceGapsMs: number[]
  longTasks: Array<{ startTimeMs: number; durationMs: number }>
  rendererResources: M23RendererResources
  pools: Record<string, M23PoolCount>
  dpr: number
  requestedGraphics: M23RequestedGraphics
  requestedRendererRoute: M23RendererRoute
  rendererRoute: M23RendererRoute
  effectiveTier: EffectiveGraphicsTier
  rendererState: BattleRendererPhase
  rendererFallbackReason: RendererFallbackReason | null
  rendererTransitions: Array<{
    phase: BattleRendererPhase
    route: M23RendererRoute
    tier: EffectiveGraphicsTier
    reason: RendererFallbackReason | null
    qualityStage: M23GraphicsGovernor['profile']['stage']
    dprCap: 1 | 1.5 | null
    postEnabled: boolean
  }>
  governor: M23GraphicsGovernor
  artworkCache: M23ArtworkCache
  motion: M23MotionPreference
  activeCue: string | null
  checkpoints: M23Checkpoint[]
  assetComplexity: Record<string, number>
  firstCastLatencyMs: number | null
  presentationTrace: M23PresentationTraceEvent[]
  limitations: string[]
}

const MAX_FRAME_SAMPLES = 6_000
const MAX_LONG_TASKS = 500
const MAX_PRESENTATION_TRACE_EVENTS = 1_000

function appendBounded(values: number[], value: number, limit: number): void {
  values.push(value)
  if (values.length > limit) values.splice(0, values.length - limit)
}

function effectiveRouteFor(
  graphics: M23RequestedGraphics,
  rendererRoute: M23RendererRoute,
): M23RendererRoute {
  return graphics === 'compatibility' ? 'compatibility' : rendererRoute
}

export class M23BattleDiagnostics {
  private active = false
  private activeCue: string | null = null
  private lastRenderedFrameAt: number | null = null
  private lastRenderedFrameActive: boolean | null = null
  private activeFrameGapsMs: number[] = []
  private idleCadenceGapsMs: number[] = []
  private longTasks: Array<{ startTimeMs: number; durationMs: number }> = []
  private rendererResources: M23RendererResources = {
    geometries: 0,
    textures: 0,
    programs: 0,
    triangles: 0,
    drawCalls: 0,
  }
  private pools: Record<string, M23PoolCount> = {}
  private checkpoints = new Set<M23Checkpoint>()
  private firstCastStartedAt: number | null = null
  private firstCastLatencyMs: number | null = null
  private presentationTrace: M23PresentationTraceEvent[] = []
  private effectiveTier: EffectiveGraphicsTier
  private rendererRoute: M23RendererRoute
  private rendererState: BattleRendererPhase = 'renderer-booting'
  private rendererFallbackReason: RendererFallbackReason | null = null
  private rendererTransitions: M23DiagnosticsSnapshot['rendererTransitions'] = []
  private governor: M23GraphicsGovernor
  private artworkCache: M23ArtworkCache = {
    totalEntries: 0,
    activeEntries: 0,
    inactiveEntries: 0,
    estimatedDecodedBytes: 0,
    evictions: 0,
  }
  private observer: PerformanceObserver | null = null
  private peakAssetComplexity: Record<string, number> = {
    peakImageElements: 0,
    peakDecodedPixels: 0,
    peakEstimatedDecodedBytes: 0,
    peakFailedArtwork: 0,
    peakCanvasElements: 0,
    peakRendererTextures: 0,
    peakRendererGeometries: 0,
    peakRenderedTriangles: 0,
    peakImageResourceCount: 0,
    peakImageResourceBytes: 0,
    peakArtworkCacheEntries: 0,
    peakArtworkCacheBytes: 0,
    artworkEvictions: 0,
  }

  constructor(
    private requestedGraphics: M23RequestedGraphics,
    private motion: M23MotionPreference,
    private requestedRendererRoute: M23RendererRoute = DEFAULT_BATTLE_RENDERER_ROUTE,
  ) {
    this.rendererRoute = effectiveRouteFor(requestedGraphics, requestedRendererRoute)
    this.effectiveTier = resolveGraphicsPreference(requestedGraphics).tier
    this.governor = new GraphicsGovernor({ preference: requestedGraphics }).snapshot()
    if (typeof PerformanceObserver === 'undefined') return
    try {
      this.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.longTasks.push({ startTimeMs: entry.startTime, durationMs: entry.duration })
        }
        if (this.longTasks.length > MAX_LONG_TASKS) {
          this.longTasks.splice(0, this.longTasks.length - MAX_LONG_TASKS)
        }
      })
      this.observer.observe({ type: 'longtask', buffered: true })
    } catch {
      this.observer = null
    }
  }

  configure(
    graphics: M23RequestedGraphics,
    motion: M23MotionPreference,
    rendererRoute: M23RendererRoute = this.requestedRendererRoute,
  ): void {
    this.requestedGraphics = graphics
    this.requestedRendererRoute = rendererRoute
    this.rendererRoute = effectiveRouteFor(graphics, rendererRoute)
    this.effectiveTier = resolveGraphicsPreference(graphics).tier
    this.motion = motion
    this.governor = new GraphicsGovernor({ preference: graphics }).snapshot()
  }

  setActivity(active: boolean): void {
    if (this.active === active) return
    this.active = active
    this.lastRenderedFrameAt = null
    this.lastRenderedFrameActive = null
  }

  setCue(cue: string, checkpoint?: M23Checkpoint): void {
    this.activeCue = cue
    if (checkpoint) this.checkpoints.add(checkpoint)
  }

  beginCast(at: number): void {
    if (this.firstCastLatencyMs === null && this.firstCastStartedAt === null) this.firstCastStartedAt = at
  }

  recordCastImpact(at: number): void {
    if (this.firstCastLatencyMs !== null || this.firstCastStartedAt === null) return
    this.firstCastLatencyMs = Math.max(0, at - this.firstCastStartedAt)
  }

  recordPresentationEvent(event: M23PresentationTraceEvent): void {
    this.presentationTrace.push({ ...event })
    if (this.presentationTrace.length > MAX_PRESENTATION_TRACE_EVENTS) {
      this.presentationTrace.splice(0, this.presentationTrace.length - MAX_PRESENTATION_TRACE_EVENTS)
    }
  }

  recordRenderedFrame(at: number, active = this.active): void {
    if (!Number.isFinite(at)) return
    if (
      this.lastRenderedFrameAt !== null
      && this.lastRenderedFrameActive === active
    ) {
      const gap = at - this.lastRenderedFrameAt
      if (gap >= 0) {
        appendBounded(
          active ? this.activeFrameGapsMs : this.idleCadenceGapsMs,
          gap,
          MAX_FRAME_SAMPLES,
        )
      }
    }
    this.lastRenderedFrameAt = at
    this.lastRenderedFrameActive = active
  }

  recordRendererResources(resources: M23RendererResources): void {
    this.rendererResources = { ...resources }
    this.peakAssetComplexity.peakRendererTextures = Math.max(
      this.peakAssetComplexity.peakRendererTextures ?? 0,
      resources.textures,
    )
    this.peakAssetComplexity.peakRendererGeometries = Math.max(
      this.peakAssetComplexity.peakRendererGeometries ?? 0,
      resources.geometries,
    )
    this.peakAssetComplexity.peakRenderedTriangles = Math.max(
      this.peakAssetComplexity.peakRenderedTriangles ?? 0,
      resources.triangles,
    )
  }

  recordRendererState(state: BattleRendererState): void {
    const next = {
      phase: state.phase,
      route: state.route,
      tier: state.tier,
      reason: state.fallbackReason,
      qualityStage: state.quality?.stage ?? 'balanced',
      dprCap: state.quality?.dprCap ?? state.dprCap,
      postEnabled: state.quality?.postEnabled ?? false,
    }
    const previous = this.rendererTransitions.at(-1)
    if (
      previous?.phase === next.phase
      && previous.route === next.route
      && previous.tier === next.tier
      && previous.reason === next.reason
      && previous.qualityStage === next.qualityStage
      && previous.dprCap === next.dprCap
      && previous.postEnabled === next.postEnabled
    ) return
    this.effectiveTier = state.tier
    this.rendererRoute = state.route
    this.rendererState = state.phase
    this.rendererFallbackReason = state.fallbackReason
    if (state.quality) {
      this.governor = {
        ...this.governor,
        profile: { ...state.quality },
        pending: state.phase === 'compatibility-ready' ? null : this.governor.pending,
      }
    }
    this.rendererTransitions.push(next)
  }

  recordPools(pools: Record<string, M23PoolCount>): void {
    this.pools = { ...this.pools, ...pools }
  }

  recordGovernor(governor: M23GraphicsGovernor): void {
    this.governor = {
      ...governor,
      profile: { ...governor.profile },
      pending: governor.pending
        ? { ...governor.pending, from: { ...governor.pending.from }, to: { ...governor.pending.to } }
        : null,
      lastWindow: governor.lastWindow ? { ...governor.lastWindow } : null,
      transitions: governor.transitions.map((transition) => ({
        ...transition,
        from: { ...transition.from },
        to: { ...transition.to },
      })),
    }
  }

  recordArtworkCache(cache: M23ArtworkCache): void {
    this.artworkCache = { ...cache }
    this.peakAssetComplexity.peakArtworkCacheEntries = Math.max(
      this.peakAssetComplexity.peakArtworkCacheEntries ?? 0,
      cache.totalEntries,
    )
    this.peakAssetComplexity.peakArtworkCacheBytes = Math.max(
      this.peakAssetComplexity.peakArtworkCacheBytes ?? 0,
      cache.estimatedDecodedBytes,
    )
    this.peakAssetComplexity.artworkEvictions = Math.max(
      this.peakAssetComplexity.artworkEvictions ?? 0,
      cache.evictions,
    )
  }

  reset(): void {
    this.active = false
    this.activeCue = null
    this.lastRenderedFrameAt = null
    this.lastRenderedFrameActive = null
    this.activeFrameGapsMs = []
    this.idleCadenceGapsMs = []
    this.longTasks = []
    this.rendererResources = { geometries: 0, textures: 0, programs: 0, triangles: 0, drawCalls: 0 }
    this.pools = {}
    this.checkpoints.clear()
    this.firstCastStartedAt = null
    this.firstCastLatencyMs = null
    this.presentationTrace = []
    this.effectiveTier = resolveGraphicsPreference(this.requestedGraphics).tier
    this.rendererRoute = effectiveRouteFor(this.requestedGraphics, this.requestedRendererRoute)
    this.rendererState = 'renderer-booting'
    this.rendererFallbackReason = null
    this.rendererTransitions = []
    this.governor = new GraphicsGovernor({ preference: this.requestedGraphics }).snapshot()
    this.artworkCache = {
      totalEntries: 0,
      activeEntries: 0,
      inactiveEntries: 0,
      estimatedDecodedBytes: 0,
      evictions: 0,
    }
    this.peakAssetComplexity = {
      peakImageElements: 0,
      peakDecodedPixels: 0,
      peakEstimatedDecodedBytes: 0,
      peakFailedArtwork: 0,
      peakCanvasElements: 0,
      peakRendererTextures: 0,
      peakRendererGeometries: 0,
      peakRenderedTriangles: 0,
      peakImageResourceCount: 0,
      peakImageResourceBytes: 0,
      peakArtworkCacheEntries: 0,
      peakArtworkCacheBytes: 0,
      artworkEvictions: 0,
    }
  }

  snapshot(): M23DiagnosticsSnapshot {
    const images = [...document.querySelectorAll('img')]
    const decodedPixels = images.reduce(
      (sum, image) => sum + image.naturalWidth * image.naturalHeight,
      0,
    )
    const failedArtwork = images.filter(
      (image) => image.complete && (image.naturalWidth === 0 || image.naturalHeight === 0),
    ).length
    const currentAssetComplexity = {
      peakImageElements: images.length,
      peakDecodedPixels: decodedPixels,
      peakEstimatedDecodedBytes: decodedPixels * 4,
      peakFailedArtwork: failedArtwork,
      peakCanvasElements: document.querySelectorAll('canvas').length,
      peakImageResourceCount: performance.getEntriesByType('resource').filter((entry) => (
        (entry as PerformanceResourceTiming).initiatorType === 'img'
      )).length,
      peakImageResourceBytes: performance.getEntriesByType('resource').reduce((sum, entry) => {
        const resource = entry as PerformanceResourceTiming
        return resource.initiatorType === 'img' ? sum + resource.decodedBodySize : sum
      }, 0),
    }
    for (const [name, amount] of Object.entries(currentAssetComplexity)) {
      this.peakAssetComplexity[name] = Math.max(this.peakAssetComplexity[name] ?? 0, amount)
    }
    const limitations = [
      'Minimum supported device is not selected; Auto is conservatively treated as Balanced and High is not release-ready.',
    ]
    if (this.observer === null) limitations.push('Long Task API is unavailable in this browser.')
    if (
      (this.peakAssetComplexity.peakImageResourceCount ?? 0) > 0
      && (this.peakAssetComplexity.peakImageResourceBytes ?? 0) === 0
    ) {
      limitations.push('Cross-origin artwork does not expose resource byte sizes; renderer texture counts remain available.')
    }

    return {
      activeFrameGapsMs: [...this.activeFrameGapsMs],
      idleCadenceGapsMs: [...this.idleCadenceGapsMs],
      longTasks: this.longTasks.map((task) => ({ ...task })),
      rendererResources: { ...this.rendererResources },
      pools: Object.fromEntries(Object.entries(this.pools).map(([name, pool]) => [name, { ...pool }])),
      dpr: this.governor.profile.dprCap === null
        ? 1
        : Math.min(window.devicePixelRatio || 1, this.governor.profile.dprCap),
      requestedGraphics: this.requestedGraphics,
      requestedRendererRoute: this.requestedRendererRoute,
      rendererRoute: this.rendererRoute,
      effectiveTier: this.effectiveTier,
      rendererState: this.rendererState,
      rendererFallbackReason: this.rendererFallbackReason,
      rendererTransitions: this.rendererTransitions.map((transition) => ({ ...transition })),
      governor: {
        ...this.governor,
        profile: { ...this.governor.profile },
        pending: this.governor.pending
          ? { ...this.governor.pending, from: { ...this.governor.pending.from }, to: { ...this.governor.pending.to } }
          : null,
        lastWindow: this.governor.lastWindow ? { ...this.governor.lastWindow } : null,
        transitions: this.governor.transitions.map((transition) => ({
          ...transition,
          from: { ...transition.from },
          to: { ...transition.to },
        })),
      },
      artworkCache: { ...this.artworkCache },
      motion: this.motion,
      activeCue: this.activeCue,
      checkpoints: [...this.checkpoints],
      assetComplexity: { ...this.peakAssetComplexity },
      firstCastLatencyMs: this.firstCastLatencyMs,
      presentationTrace: this.presentationTrace.map((event) => ({ ...event })),
      limitations,
    }
  }

  dispose(): void {
    this.observer?.disconnect()
    this.observer = null
  }
}
