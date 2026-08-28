import type {
  M23Checkpoint,
  M23MotionPreference,
  M23PoolCount,
  M23RendererResources,
  M23RequestedGraphics,
} from './contracts'

export interface M23DiagnosticsSnapshot {
  activeFrameGapsMs: number[]
  idleCadenceGapsMs: number[]
  longTasks: Array<{ startTimeMs: number; durationMs: number }>
  rendererResources: M23RendererResources
  pools: Record<string, M23PoolCount>
  dpr: number
  requestedGraphics: M23RequestedGraphics
  effectiveTier: 'legacy-fixed'
  motion: M23MotionPreference
  activeCue: string | null
  checkpoints: M23Checkpoint[]
  assetComplexity: Record<string, number>
  firstCastLatencyMs: number | null
  limitations: string[]
}

const MAX_FRAME_SAMPLES = 6_000
const MAX_LONG_TASKS = 500

function appendBounded(values: number[], value: number, limit: number): void {
  values.push(value)
  if (values.length > limit) values.splice(0, values.length - limit)
}

export class M23BattleDiagnostics {
  private active = false
  private activeCue: string | null = null
  private lastRenderedFrameAt: number | null = null
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
  }

  constructor(
    private requestedGraphics: M23RequestedGraphics,
    private motion: M23MotionPreference,
  ) {
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

  configure(graphics: M23RequestedGraphics, motion: M23MotionPreference): void {
    this.requestedGraphics = graphics
    this.motion = motion
  }

  setActivity(active: boolean): void {
    if (this.active === active) return
    this.active = active
    this.lastRenderedFrameAt = null
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

  recordRenderedFrame(at: number): void {
    if (this.lastRenderedFrameAt !== null) {
      const gap = at - this.lastRenderedFrameAt
      appendBounded(
        this.active ? this.activeFrameGapsMs : this.idleCadenceGapsMs,
        gap,
        MAX_FRAME_SAMPLES,
      )
    }
    this.lastRenderedFrameAt = at
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

  recordPools(pools: Record<string, M23PoolCount>): void {
    this.pools = { ...this.pools, ...pools }
  }

  reset(): void {
    this.active = false
    this.activeCue = null
    this.lastRenderedFrameAt = null
    this.activeFrameGapsMs = []
    this.idleCadenceGapsMs = []
    this.longTasks = []
    this.rendererResources = { geometries: 0, textures: 0, programs: 0, triangles: 0, drawCalls: 0 }
    this.pools = {}
    this.checkpoints.clear()
    this.firstCastStartedAt = null
    this.firstCastLatencyMs = null
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
      'Requested graphics is recorded only; the current renderer remains legacy fixed DPR/always-loop.',
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
      dpr: window.devicePixelRatio || 1,
      requestedGraphics: this.requestedGraphics,
      effectiveTier: 'legacy-fixed',
      motion: this.motion,
      activeCue: this.activeCue,
      checkpoints: [...this.checkpoints],
      assetComplexity: { ...this.peakAssetComplexity },
      firstCastLatencyMs: this.firstCastLatencyMs,
      limitations,
    }
  }

  dispose(): void {
    this.observer?.disconnect()
    this.observer = null
  }
}
