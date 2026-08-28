import {
  M23_BASELINE_SEED,
  M23_BASELINE_SETTINGS,
  M23_ARTWORK_FIXTURES,
  runM23BaselineScenario,
  type M23ArtworkFixture,
  type M23BaselineScenarioResult,
} from '@/test/m23/baselineScenario'
import { useSettings } from '@/store/settingsStore'
import { useBattleStore } from '@/store/battleStore'
import { assembleBattlePrep, assembleExt, assemblePostGrowth } from '@/store/ext'
import {
  M23BattleDiagnostics,
  type M23DiagnosticsSnapshot,
} from './battleDiagnostics'
import {
  M23_BASELINE_SCENARIO_ID,
  M23_GRAPHICS_OPTIONS,
  M23_MOTION_OPTIONS,
  type M23Checkpoint,
  type M23MotionPreference,
  type M23PoolCount,
  type M23PresentationTraceEvent,
  type M23RendererResources,
  type M23RequestedGraphics,
} from './contracts'

export interface M23BaselineDriverOptions {
  scenarioId: typeof M23_BASELINE_SCENARIO_ID
  seed: string
  viewport: { width: number; height: number }
  graphics: M23RequestedGraphics
  motion: M23MotionPreference
  cueStep: number | 'run'
}

export interface M23BaselineDriver {
  readonly active: true
  options: M23BaselineDriverOptions
  configure: (options?: Partial<M23BaselineDriverOptions>) => M23BaselineDriverOptions
  run: (options?: Pick<Partial<M23BaselineDriverOptions>, 'scenarioId' | 'seed'>) => M23BaselineScenarioResult
  prepareCheckpoint: (checkpoint: 'player-choice' | 'qte' | 'star' | 'terrain' | 'terrain-rain' | 'switch') => void
  prepareArtworkFixture: (fixture: M23ArtworkFixture) => void
  checkpoint: (cue: string, checkpoint?: M23Checkpoint) => Promise<void>
  step: (count?: number) => void
  resume: () => void
  setActivity: (active: boolean) => void
  recordRenderedFrame: (at: number) => void
  recordRendererResources: (resources: M23RendererResources) => void
  recordPools: (pools: Record<string, M23PoolCount>) => void
  beginCast: (at: number) => void
  recordCastImpact: (at: number) => void
  recordPresentationEvent: (event: M23PresentationTraceEvent) => void
  diagnostics: () => M23DiagnosticsSnapshot
  resetDiagnostics: () => void
  dispose: () => void
}

const GRAPHICS = new Set<M23RequestedGraphics>(M23_GRAPHICS_OPTIONS)
const MOTION = new Set<M23MotionPreference>(M23_MOTION_OPTIONS)

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
  return value
}

function queryOptions(): Partial<M23BaselineDriverOptions> {
  const query = new URLSearchParams(window.location.search)
  if (query.get('m23Scenario') !== M23_BASELINE_SCENARIO_ID) return {}
  const width = Number(query.get('width'))
  const height = Number(query.get('height'))
  const graphics = query.get('graphics') as M23RequestedGraphics | null
  const motion = query.get('motion') as M23MotionPreference | null
  const cue = query.get('cueStep')
  return {
    scenarioId: M23_BASELINE_SCENARIO_ID,
    ...(query.get('seed') ? { seed: query.get('seed')! } : {}),
    ...(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0
      ? { viewport: { width, height } }
      : {}),
    ...(graphics && GRAPHICS.has(graphics) ? { graphics } : {}),
    ...(motion && MOTION.has(motion) ? { motion } : {}),
    ...(cue === 'run' ? { cueStep: 'run' as const } : cue !== null && Number.isInteger(Number(cue)) && Number(cue) >= 0
      ? { cueStep: Number(cue) }
      : {}),
  }
}

function installFixtureSettings(): void {
  const settings = {
    ...M23_BASELINE_SETTINGS,
    modules: { ...M23_BASELINE_SETTINGS.modules },
    prefs: {
      ...M23_BASELINE_SETTINGS.prefs,
      enhancedInteractivity: {
        ...M23_BASELINE_SETTINGS.prefs.enhancedInteractivity,
        surfaces: { ...M23_BASELINE_SETTINGS.prefs.enhancedInteractivity.surfaces },
      },
    },
  }
  useSettings.setState({
    settings,
    ext: assembleExt(settings),
    prep: assembleBattlePrep(settings),
    postGrowth: assemblePostGrowth(settings),
  })
}

export function installM23BaselineDriver(): M23BaselineDriver {
  window.__MOBIE_M23_BASELINE__?.dispose()

  let options: M23BaselineDriverOptions = {
    scenarioId: M23_BASELINE_SCENARIO_ID,
    seed: M23_BASELINE_SEED,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    graphics: 'auto',
    motion: 'full',
    cueStep: 'run',
    ...queryOptions(),
  }
  const diagnostics = new M23BattleDiagnostics(options.graphics, options.motion)
  let cueIndex = -1
  let stepPermits = 0
  let resumeWaiters: Array<() => void> = []

  const configure = (patch: Partial<M23BaselineDriverOptions> = {}): M23BaselineDriverOptions => {
    if (patch.scenarioId !== undefined && patch.scenarioId !== M23_BASELINE_SCENARIO_ID) {
      throw new Error(`Unknown M23 baseline scenario: ${patch.scenarioId}`)
    }
    const viewport = patch.viewport ?? options.viewport
    positiveInteger(viewport.width, 'viewport.width')
    positiveInteger(viewport.height, 'viewport.height')
    if (patch.graphics !== undefined && !GRAPHICS.has(patch.graphics)) throw new Error(`Unknown graphics request: ${patch.graphics}`)
    if (patch.motion !== undefined && !MOTION.has(patch.motion)) throw new Error(`Unknown motion request: ${patch.motion}`)
    if (patch.cueStep !== undefined && patch.cueStep !== 'run' && (!Number.isInteger(patch.cueStep) || patch.cueStep < 0)) {
      throw new Error('cueStep must be run or a non-negative integer')
    }
    options = { ...options, ...patch, viewport: { ...viewport } }
    driver.options = options
    diagnostics.configure(options.graphics, options.motion)
    document.documentElement.dataset.m23Scenario = options.scenarioId
    document.documentElement.dataset.m23Graphics = options.graphics
    document.documentElement.dataset.m23Motion = options.motion
    installFixtureSettings()
    return { ...options, viewport: { ...options.viewport } }
  }

  const release = (count: number): void => {
    stepPermits += count
    while (stepPermits > 0 && resumeWaiters.length > 0) {
      stepPermits -= 1
      resumeWaiters.shift()?.()
    }
  }

  const driver: M23BaselineDriver = {
    active: true,
    options,
    configure,
    run: (runOptions = {}) => runM23BaselineScenario({
      scenarioId: runOptions.scenarioId ?? options.scenarioId,
      seed: runOptions.seed ?? options.seed,
    }),
    prepareCheckpoint: (checkpoint) => {
      const state = useBattleStore.getState()
      if (!state.battle) throw new Error('A live battle is required before preparing a checkpoint')
      if (checkpoint === 'terrain' || checkpoint === 'terrain-rain') {
        useBattleStore.setState({
          battle: {
            ...state.battle,
            field: {
              ...state.battle.field,
              terrainEffects: {
                ...state.battle.field.terrainEffects,
                current: [checkpoint === 'terrain' ? 'volcanic' : 'rain'],
              },
            },
          },
          phase: 'playerChoice',
        })
        return
      }
      if (checkpoint === 'star') {
        useBattleStore.setState({ energy: 100, phase: 'playerChoice' })
        return
      }
      useBattleStore.setState({
        phase: checkpoint === 'qte' ? 'qte' : checkpoint === 'switch' ? 'switchSelect' : 'playerChoice',
      })
    },
    prepareArtworkFixture: (fixture) => {
      const state = useBattleStore.getState()
      if (!state.battle) throw new Error('A live battle is required before preparing artwork')
      const artworkUrl = M23_ARTWORK_FIXTURES[fixture]
      if (!artworkUrl) throw new Error(`Unknown M23 artwork fixture: ${fixture}`)
      const activeIndex = state.battle.player.activeIndex
      useBattleStore.setState({
        battle: {
          ...state.battle,
          player: {
            ...state.battle.player,
            members: state.battle.player.members.map((member, index) => (
              index === activeIndex ? { ...member, artworkUrl } : member
            )),
          },
        },
      })
    },
    checkpoint: async (cue, checkpoint) => {
      cueIndex += 1
      diagnostics.setCue(cue, checkpoint)
      if (options.cueStep === 'run' || cueIndex < options.cueStep) return
      if (stepPermits > 0) {
        stepPermits -= 1
        return
      }
      await new Promise<void>((resolve) => resumeWaiters.push(resolve))
    },
    step: (count = 1) => release(positiveInteger(count, 'step count')),
    resume: () => {
      options = { ...options, cueStep: 'run' }
      driver.options = options
      const waiters = resumeWaiters
      resumeWaiters = []
      for (const resolve of waiters) resolve()
    },
    setActivity: (active) => diagnostics.setActivity(active),
    recordRenderedFrame: (at) => diagnostics.recordRenderedFrame(at),
    recordRendererResources: (resources) => diagnostics.recordRendererResources(resources),
    recordPools: (pools) => diagnostics.recordPools(pools),
    beginCast: (at) => diagnostics.beginCast(at),
    recordCastImpact: (at) => diagnostics.recordCastImpact(at),
    recordPresentationEvent: (event) => diagnostics.recordPresentationEvent(event),
    diagnostics: () => diagnostics.snapshot(),
    resetDiagnostics: () => {
      cueIndex = -1
      stepPermits = 0
      diagnostics.reset()
    },
    dispose: () => {
      diagnostics.dispose()
      const waiters = resumeWaiters
      resumeWaiters = []
      for (const resolve of waiters) resolve()
      delete document.documentElement.dataset.m23Scenario
      delete document.documentElement.dataset.m23Graphics
      delete document.documentElement.dataset.m23Motion
      if (window.__MOBIE_M23_BASELINE__ === driver) delete window.__MOBIE_M23_BASELINE__
    },
  }

  window.__MOBIE_M23_BASELINE__ = driver
  configure(options)
  return driver
}
