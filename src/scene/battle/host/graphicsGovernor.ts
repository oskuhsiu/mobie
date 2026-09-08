import {
  graphicsQualityProfileForStage,
  graphicsQualityProfileOf,
  type GraphicsPreference,
  type GraphicsQualityProfile,
  type GraphicsQualityStage,
} from '@/presentation/battle/rendering'

export const GRAPHICS_GOVERNOR_WINDOW_SIZE = 120
export const GRAPHICS_GOVERNOR_EVALUATION_INTERVAL = 60
export const GRAPHICS_GOVERNOR_FRAME_BUDGET_MS = 34
export const GRAPHICS_GOVERNOR_JANK_RATE = 0.05
export const GRAPHICS_GOVERNOR_FAILURE_WINDOWS = 2

export type GraphicsGovernorAction =
  | 'reduce-dpr'
  | 'disable-post'
  | 'reduce-particles-weather'
  | 'compatibility'

export interface GraphicsGovernorWindow {
  sampleCount: number
  p50Ms: number
  p95Ms: number
  maxMs: number
  overBudgetCount: number
  overBudgetRate: number
  failing: boolean
}

export interface GraphicsGovernorTransition {
  action: GraphicsGovernorAction
  from: GraphicsQualityProfile
  to: GraphicsQualityProfile
  reason: 'active-frame-window'
}

export interface GraphicsGovernorEvaluation {
  window: GraphicsGovernorWindow
  consecutiveFailingWindows: number
  pending: GraphicsGovernorTransition | null
}

export interface GraphicsGovernorSnapshot {
  profile: GraphicsQualityProfile
  activeFrameCount: number
  activeGapCount: number
  consecutiveFailingWindows: number
  pending: GraphicsGovernorTransition | null
  lastWindow: GraphicsGovernorWindow | null
  transitions: GraphicsGovernorTransition[]
}

export interface GraphicsGovernorOptions {
  preference?: GraphicsPreference
  initialProfile?: GraphicsQualityProfile
  windowSize?: number
  evaluateEvery?: number
  frameBudgetMs?: number
  jankRate?: number
  failureWindows?: number
}

function positiveInteger(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 ? value : fallback
}

function nonNegative(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

function unitInterval(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback
}

function copyProfile(profile: GraphicsQualityProfile): GraphicsQualityProfile {
  return { ...profile }
}

function copyTransition(transition: GraphicsGovernorTransition | null): GraphicsGovernorTransition | null {
  return transition
    ? { ...transition, from: copyProfile(transition.from), to: copyProfile(transition.to) }
    : null
}

function copyWindow(window: GraphicsGovernorWindow | null): GraphicsGovernorWindow | null {
  return window ? { ...window } : null
}

function actionForStage(stage: GraphicsQualityStage): GraphicsGovernorAction | null {
  switch (stage) {
    case 'high': return 'reduce-dpr'
    case 'high-dpr-reduced': return 'disable-post'
    case 'high-post-reduced':
    case 'balanced':
      return 'reduce-particles-weather'
    case 'balanced-effects-reduced': return 'compatibility'
    case 'compatibility': return null
  }
}

function nextStage(stage: GraphicsQualityStage): GraphicsQualityStage | null {
  switch (stage) {
    case 'high': return 'high-dpr-reduced'
    case 'high-dpr-reduced': return 'high-post-reduced'
    case 'high-post-reduced': return 'balanced-effects-reduced'
    case 'balanced': return 'balanced-effects-reduced'
    case 'balanced-effects-reduced': return 'compatibility'
    case 'compatibility': return null
  }
}

export function summarizeGraphicsFrameWindow(
  gaps: readonly number[],
  frameBudgetMs = GRAPHICS_GOVERNOR_FRAME_BUDGET_MS,
  jankRate = GRAPHICS_GOVERNOR_JANK_RATE,
): GraphicsGovernorWindow | null {
  const samples = gaps.filter((gap) => Number.isFinite(gap) && gap >= 0)
  if (samples.length === 0) return null
  const sorted = [...samples].sort((a, b) => a - b)
  const percentile = (ratio: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0
  const overBudgetCount = samples.filter((gap) => gap > frameBudgetMs).length
  const overBudgetRate = overBudgetCount / samples.length
  return {
    sampleCount: samples.length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: sorted[sorted.length - 1] ?? 0,
    overBudgetCount,
    overBudgetRate,
    failing: percentile(0.95) > frameBudgetMs || overBudgetRate > jankRate,
  }
}

/**
 * Tracks only rendered frames explicitly marked active by the battle scene.
 * Idle cadence, hidden/resume gaps, and choice-screen throttling never enter
 * the rolling performance window. Quality changes are queued until the caller
 * reaches a safe cue boundary, which keeps a cue's renderer stable throughout.
 */
export class GraphicsGovernor {
  private readonly windowSize: number
  private readonly evaluateEvery: number
  private readonly frameBudgetMs: number
  private readonly jankRate: number
  private readonly failureWindows: number
  private profileState: GraphicsQualityProfile
  private activeGaps: number[] = []
  private gapCursor = 0
  private lastActiveFrameAt: number | null = null
  private activeFrameCountState = 0
  private samplesSinceEvaluation = 0
  private consecutiveFailingWindowsState = 0
  private pendingState: GraphicsGovernorTransition | null = null
  private lastWindowState: GraphicsGovernorWindow | null = null
  private transitionsState: GraphicsGovernorTransition[] = []

  constructor(options: GraphicsGovernorOptions = {}) {
    this.windowSize = positiveInteger(options.windowSize ?? GRAPHICS_GOVERNOR_WINDOW_SIZE, GRAPHICS_GOVERNOR_WINDOW_SIZE)
    this.evaluateEvery = positiveInteger(options.evaluateEvery ?? GRAPHICS_GOVERNOR_EVALUATION_INTERVAL, GRAPHICS_GOVERNOR_EVALUATION_INTERVAL)
    this.frameBudgetMs = nonNegative(options.frameBudgetMs ?? GRAPHICS_GOVERNOR_FRAME_BUDGET_MS, GRAPHICS_GOVERNOR_FRAME_BUDGET_MS)
    this.jankRate = unitInterval(options.jankRate ?? GRAPHICS_GOVERNOR_JANK_RATE, GRAPHICS_GOVERNOR_JANK_RATE)
    this.failureWindows = positiveInteger(options.failureWindows ?? GRAPHICS_GOVERNOR_FAILURE_WINDOWS, GRAPHICS_GOVERNOR_FAILURE_WINDOWS)
    this.profileState = copyProfile(options.initialProfile ?? graphicsQualityProfileOf(options.preference))
  }

  get profile(): GraphicsQualityProfile {
    return copyProfile(this.profileState)
  }

  recordRenderedFrame(at: number, active = true): GraphicsGovernorEvaluation | null {
    if (!Number.isFinite(at)) return null
    if (!active) {
      this.lastActiveFrameAt = null
      return null
    }

    if (this.lastActiveFrameAt !== null && at <= this.lastActiveFrameAt) return null
    this.activeFrameCountState += 1
    if (this.lastActiveFrameAt !== null) {
      const gap = at - this.lastActiveFrameAt
      if (this.activeGaps.length < this.windowSize) this.activeGaps.push(gap)
      else {
        this.activeGaps[this.gapCursor] = gap
        this.gapCursor = (this.gapCursor + 1) % this.windowSize
      }
      this.samplesSinceEvaluation += 1
    }
    this.lastActiveFrameAt = at

    if (
      this.activeGaps.length < this.windowSize
      || this.samplesSinceEvaluation < this.evaluateEvery
    ) return null

    this.samplesSinceEvaluation = 0
    const window = summarizeGraphicsFrameWindow(this.activeGaps, this.frameBudgetMs, this.jankRate)
    if (!window) return null
    this.lastWindowState = window
    this.consecutiveFailingWindowsState = window.failing
      ? this.consecutiveFailingWindowsState + 1
      : 0
    if (
      window.failing
      && this.consecutiveFailingWindowsState >= this.failureWindows
      && this.pendingState === null
    ) {
      const stage = nextStage(this.profileState.stage)
      const action = actionForStage(this.profileState.stage)
      if (stage && action) {
        this.pendingState = {
          action,
          from: copyProfile(this.profileState),
          to: graphicsQualityProfileForStage(stage),
          reason: 'active-frame-window',
        }
      }
    }
    return {
      window: copyWindow(window)!,
      consecutiveFailingWindows: this.consecutiveFailingWindowsState,
      pending: copyTransition(this.pendingState),
    }
  }

  /** Alias used by renderer integrations that call their callback a frame sample. */
  recordFrame(at: number, active = true): GraphicsGovernorEvaluation | null {
    return this.recordRenderedFrame(at, active)
  }

  /** Apply one queued downgrade. There is deliberately no upgrade operation. */
  applyAtSafeCueBoundary(): GraphicsGovernorTransition | null {
    if (!this.pendingState) return null
    const transition = copyTransition(this.pendingState)!
    this.profileState = copyProfile(transition.to)
    this.transitionsState.push(copyTransition(transition)!)
    this.pendingState = null
    this.consecutiveFailingWindowsState = 0
    this.samplesSinceEvaluation = 0
    this.activeGaps = []
    this.gapCursor = 0
    this.lastActiveFrameAt = null
    return transition
  }

  /** Start a fresh battle's quality budget. This is the only reset/upgrade path. */
  reset(options: { preference?: GraphicsPreference; profile?: GraphicsQualityProfile } = {}): void {
    this.profileState = copyProfile(options.profile ?? graphicsQualityProfileOf(options.preference))
    this.activeGaps = []
    this.gapCursor = 0
    this.lastActiveFrameAt = null
    this.activeFrameCountState = 0
    this.samplesSinceEvaluation = 0
    this.consecutiveFailingWindowsState = 0
    this.pendingState = null
    this.lastWindowState = null
    this.transitionsState = []
  }

  snapshot(): GraphicsGovernorSnapshot {
    return {
      profile: copyProfile(this.profileState),
      activeFrameCount: this.activeFrameCountState,
      activeGapCount: this.activeGaps.length,
      consecutiveFailingWindows: this.consecutiveFailingWindowsState,
      pending: copyTransition(this.pendingState),
      lastWindow: copyWindow(this.lastWindowState),
      transitions: this.transitionsState.map((transition) => copyTransition(transition)!),
    }
  }
}
