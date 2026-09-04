import {
  M23_BASELINE_SEED,
  M23_BASELINE_SETTINGS,
  M23_ARTWORK_FIXTURES,
  runM23BaselineScenario,
  type M23ArtworkFixture,
  type M23BaselineScenarioResult,
} from '@/test/m23/baselineScenario'
import { useSettings } from '@/store/settingsStore'
import { useBattleStore, type BattleCommandNotice } from '@/store/battleStore'
import { usePlayerSkills } from '@/store/playerSkillsStore'
import { PRODUCT_RUNTIME } from '@/game/ext/productRuntime'
import { lookupTerrain } from '@/game/data/terrains'
import type { TerrainId } from '@/game/types'
import type { BattleSessionToken } from '@/presentation/battle/contracts'
import type { BattleFeedEntry } from '@/presentation/battle/contracts'
import type { BattleRendererState } from '@/presentation/battle/rendering'
import type { QteQuality } from '@/game/battle/engine'
import { battleAudioSession } from '@/audio/battleAudioSession'
import { battleBgmSession } from '@/audio/battleBgmSession'
import {
  M23BattleDiagnostics,
  type M23DiagnosticsSnapshot,
} from './battleDiagnostics'
import {
  M23_BASELINE_SCENARIO_ID,
  M23_GRAPHICS_OPTIONS,
  M23_MOTION_OPTIONS,
  M23_RENDERER_FAILURES,
  M23_TURN_TRANSACTION_CASES,
  M23_FAILURE_STAGES,
  M23_HUD_CASES,
  type M23Checkpoint,
  type M23FailureStage,
  type M23HudCase,
  type M23MotionPreference,
  type M23RendererFailure,
  type M23PoolCount,
  type M23PresentationTraceEvent,
  type M23RendererResources,
  type M23RequestedGraphics,
  type M23TurnTransactionCase,
} from './contracts'

export interface M23BaselineDriverOptions {
  scenarioId: typeof M23_BASELINE_SCENARIO_ID
  seed: string
  viewport: { width: number; height: number }
  graphics: M23RequestedGraphics
  rendererFailure: M23RendererFailure | null
  motion: M23MotionPreference
  cueStep: number | 'run'
}

export interface M23BaselineDriver {
  readonly active: true
  options: M23BaselineDriverOptions
  configure: (options?: Partial<M23BaselineDriverOptions>) => M23BaselineDriverOptions
  run: (options?: Pick<Partial<M23BaselineDriverOptions>, 'scenarioId' | 'seed'>) => M23BaselineScenarioResult
  prepareCheckpoint: (checkpoint: 'player-choice' | 'qte' | 'star' | 'terrain' | 'terrain-rain' | 'switch') => void
  prepareTerrain: (terrainIds: readonly TerrainId[]) => void
  prepareTransactionCase: (caseId: M23TurnTransactionCase) => void
  prepareHudCase: (caseId: M23HudCase) => void
  battleState: () => ReturnType<typeof useBattleStore.getState>['battle']
  feed: () => readonly BattleFeedEntry[]
  prepareFeedHistory: (count?: number) => void
  runtimeState: () => {
    phase: ReturnType<typeof useBattleStore.getState>['phase']
    energy: number
    activeResource: 'star' | 'chain' | null
    commandNotice: BattleCommandNotice | null
    lockedIndex: number | null
    error: ReturnType<typeof useBattleStore.getState>['battleError']
    session: {
      token: BattleSessionToken
      nextPresentationId: number
      endSent: boolean
      retired: boolean
      recorderActive: boolean
      rendererFallbackReason: BattleRendererState['fallbackReason']
    } | null
  }
  takeQteQuality: (actual: QteQuality) => QteQuality
  activeTransactionCase: () => M23TurnTransactionCase | null
  injectFailure: (stage: M23FailureStage, count?: number) => void
  consumeFailure: (stage: M23FailureStage) => boolean
  audioState: () => {
    sfx: ReturnType<typeof battleAudioSession.snapshot>
    bgm: ReturnType<typeof battleBgmSession.snapshot>
  }
  prepareArtworkFixture: (fixture: M23ArtworkFixture) => void
  checkpoint: (cue: string, checkpoint?: M23Checkpoint) => Promise<void>
  step: (count?: number) => void
  resume: () => void
  setActivity: (active: boolean) => void
  recordRenderedFrame: (at: number) => void
  recordRendererResources: (resources: M23RendererResources) => void
  recordRendererState: (state: BattleRendererState) => void
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
const RENDERER_FAILURES = new Set<M23RendererFailure>(M23_RENDERER_FAILURES)

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
  const rendererFailure = query.get('rendererFailure') as M23RendererFailure | null
  const motion = query.get('motion') as M23MotionPreference | null
  const cue = query.get('cueStep')
  return {
    scenarioId: M23_BASELINE_SCENARIO_ID,
    ...(query.get('seed') ? { seed: query.get('seed')! } : {}),
    ...(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0
      ? { viewport: { width, height } }
      : {}),
    ...(graphics && GRAPHICS.has(graphics) ? { graphics } : {}),
    ...(rendererFailure && RENDERER_FAILURES.has(rendererFailure) ? { rendererFailure } : {}),
    ...(motion && MOTION.has(motion) ? { motion } : {}),
    ...(cue === 'run' ? { cueStep: 'run' as const } : cue !== null && Number.isInteger(Number(cue)) && Number(cue) >= 0
      ? { cueStep: Number(cue) }
      : {}),
  }
}

function installFixtureSettings(): void {
  const settings = {
    ...M23_BASELINE_SETTINGS,
    prefs: {
      ...M23_BASELINE_SETTINGS.prefs,
      enhancedInteractivity: {
        ...M23_BASELINE_SETTINGS.prefs.enhancedInteractivity,
        surfaces: { ...M23_BASELINE_SETTINGS.prefs.enhancedInteractivity.surfaces },
      },
    },
  }
  useSettings.setState({ settings })
}

export function installM23BaselineDriver(): M23BaselineDriver {
  window.__MOBIE_M23_BASELINE__?.dispose()

  let options: M23BaselineDriverOptions = {
    scenarioId: M23_BASELINE_SCENARIO_ID,
    seed: M23_BASELINE_SEED,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    graphics: 'auto',
    rendererFailure: null,
    motion: 'full',
    cueStep: 'run',
    ...queryOptions(),
  }
  const diagnostics = new M23BattleDiagnostics(options.graphics, options.motion)
  let cueIndex = -1
  let stepPermits = 0
  let resumeWaiters: Array<() => void> = []
  let qteQualityQueue: QteQuality[] = []
  let activeTransactionCase: M23TurnTransactionCase | null = null
  const failures: Record<M23FailureStage, number> = {
    'battle-data': 0,
    resolve: 0,
    recorder: 0,
    'retry-init': 0,
  }

  const configure = (patch: Partial<M23BaselineDriverOptions> = {}): M23BaselineDriverOptions => {
    if (patch.scenarioId !== undefined && patch.scenarioId !== M23_BASELINE_SCENARIO_ID) {
      throw new Error(`Unknown M23 baseline scenario: ${patch.scenarioId}`)
    }
    const viewport = patch.viewport ?? options.viewport
    positiveInteger(viewport.width, 'viewport.width')
    positiveInteger(viewport.height, 'viewport.height')
    if (patch.graphics !== undefined && !GRAPHICS.has(patch.graphics)) throw new Error(`Unknown graphics request: ${patch.graphics}`)
    if (patch.rendererFailure !== undefined && patch.rendererFailure !== null && !RENDERER_FAILURES.has(patch.rendererFailure)) {
      throw new Error(`Unknown renderer failure: ${patch.rendererFailure}`)
    }
    if (patch.motion !== undefined && !MOTION.has(patch.motion)) throw new Error(`Unknown motion request: ${patch.motion}`)
    if (patch.cueStep !== undefined && patch.cueStep !== 'run' && (!Number.isInteger(patch.cueStep) || patch.cueStep < 0)) {
      throw new Error('cueStep must be run or a non-negative integer')
    }
    options = { ...options, ...patch, viewport: { ...viewport } }
    driver.options = options
    diagnostics.configure(options.graphics, options.motion)
    document.documentElement.dataset.m23Scenario = options.scenarioId
    document.documentElement.dataset.m23Graphics = options.graphics
    document.documentElement.dataset.m23RendererFailure = options.rendererFailure ?? ''
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

  const prepareTerrain = (terrainIds: readonly TerrainId[]): void => {
    const state = useBattleStore.getState()
    if (!state.battle) throw new Error('A live battle is required before preparing terrain')
    for (const terrainId of terrainIds) {
      if (!lookupTerrain(terrainId)) throw new Error(`Unknown terrain: ${terrainId}`)
    }
    useBattleStore.setState({
      battle: {
        ...state.battle,
        field: {
          ...state.battle.field,
          terrainEffects: {
            ...state.battle.field.terrainEffects,
            current: [...terrainIds],
          },
        },
      },
      phase: 'playerChoice',
    })
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
      if (checkpoint === 'terrain' || checkpoint === 'terrain-rain') {
        prepareTerrain([checkpoint === 'terrain' ? 'volcanic' : 'rain'])
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
    prepareTerrain,
    prepareTransactionCase: (caseId) => {
      if (!M23_TURN_TRANSACTION_CASES.includes(caseId)) throw new Error(`Unknown turn transaction case: ${caseId}`)
      const scenario = runM23BaselineScenario({ scenarioId: options.scenarioId, seed: options.seed })
      const fixture = scenario.cases.find((candidate) => candidate.id === caseId)
      if (!fixture) throw new Error(`Missing baseline turn fixture: ${caseId}`)
      const battle = structuredClone(fixture.initialState)
      if (caseId === 'chain-combo') {
        battle.chainGauge = PRODUCT_RUNTIME.turnExtensions.chain.gaugeFull
      }
      const state = useBattleStore.getState()
      const qualityByCase: Record<M23TurnTransactionCase, QteQuality[]> = {
        'normal-hit-chain-ready': ['good'],
        'status-buff': ['perfect'],
        heal: ['good'],
        'switch-forced-switch': ['weak'],
        'chain-combo': ['perfect', 'good', 'normal'],
        'crit-super-star': [],
        win: ['perfect'],
        lose: ['weak'],
        timeout: ['normal'],
      }
      qteQualityQueue = [...qualityByCase[caseId]]
      activeTransactionCase = caseId
      for (const side of ['player', 'foe'] as const) {
        battle[side].members = battle[side].members.map((member, index) => ({
          ...member,
          artworkUrl: member.artworkUrl
            || state.battle?.[side].members[index]?.artworkUrl
            || M23_ARTWORK_FIXTURES['large-texture'],
        }))
      }
      useBattleStore.setState({
        battle,
        phase: 'playerChoice',
        log: [],
        banner: null,
        hitFx: null,
        support: null,
        energy: caseId === 'crit-super-star' ? 100 : 0,
        chain: 0,
        combo: null,
        lockedIndex: null,
        presentation: null,
        intentPresentation: null,
        battleError: null,
        session: state.session ? {
          ...state.session,
          battleSeed: `${options.seed}|${caseId}`,
          rngCursor: 0,
          pendingReplay: null,
          retired: false,
        } : null,
      })
    },
    prepareHudCase: (caseId) => {
      if (!M23_HUD_CASES.includes(caseId)) throw new Error(`Unknown M23 HUD case: ${caseId}`)
      const state = useBattleStore.getState()
      if (!state.battle) throw new Error('A live battle is required before preparing HUD state')
      let battle = structuredClone(state.battle)
      battle.field.teamStatuses = []
      battle.field.enemyStatuses = []
      battle.field.comboCastEffects = []
      battle.usedComboKeys = []
      battle.winner = null
      activeTransactionCase = null
      qteQualityQueue = []
      let energy = 0
      let learnedSkillIds: string[] = []
      let lockedIndex: number | null = null

      if (caseId === 'choice-complete' || caseId === 'switch-one-legal' || caseId === 'switch-disabled') {
        energy = 100
        learnedSkillIds = ['rally']
        battle.chainGauge = PRODUCT_RUNTIME.turnExtensions.chain.gaugeFull
        const player = battle.player.members[battle.player.activeIndex]
        const foe = battle.foe.members[battle.foe.activeIndex]
        player.heldItemId = 'lifeorb'
        player.abilityId = 'pinch_boost'
        player.currentHp = Math.max(1, Math.floor(player.maxHp / 3))
        foe.abilityId = 'guard'
        delete foe.heldItemId
        battle.field.teamStatuses = [
          { stat: 'atk', mult: 1.2, remaining: 3, source: -1, label: '訓練師加油' },
          { stat: 'def', mult: 1.3, remaining: 2, source: 1010, label: '防禦提升' },
          { stat: 'spa', mult: 1.2, remaining: 4, source: -1, label: '精神集中' },
          { stat: 'spd', mult: 1.1, remaining: 1, source: -1, label: '靈光守護' },
        ]
        battle.field.enemyStatuses = [
          { stat: 'def', mult: 0.8, remaining: 2, source: -1, label: '防禦下降' },
        ]
        battle.field.comboCastEffects = [
          { key: 'steam-burst', label: '蒸氣爆破', icon: '♨️', remaining: 4 },
          { key: 'thunderstorm', label: '雷暴連擊', icon: '⛈️', remaining: 3 },
          { key: 'frost-veil', label: '霜霰護幕', icon: '❄️', remaining: 2 },
        ]
        if (caseId !== 'choice-complete') {
          battle.player.members[1].currentHp = 0
          battle.player.members[2].currentHp = Math.max(1, battle.player.members[2].currentHp)
          if (caseId === 'switch-disabled') lockedIndex = 2
        }
      } else if (caseId === 'choice-absent') {
        for (const side of ['player', 'foe'] as const) {
          battle[side].members = battle[side].members.map((member) => {
            const copy = { ...member }
            delete copy.heldItemId
            return copy
          })
        }
      } else if (caseId === 'resources-charging') {
        energy = 38
        battle.chainGauge = 42
      } else if (caseId === 'combo-non-applicable') {
        battle.chainGauge = PRODUCT_RUNTIME.turnExtensions.chain.gaugeFull
        battle.player.members = battle.player.members.map((member, index) => ({
          ...member,
          speciesId: 500 + index,
          types: ['normal'],
        }))
      } else {
        const scenario = runM23BaselineScenario({ scenarioId: options.scenarioId, seed: options.seed })
        const fixture = scenario.cases.find((candidate) => candidate.id === 'crit-super-star')
        if (!fixture) throw new Error('Missing damage source HUD fixture')
        battle = structuredClone(fixture.initialState)
        const player = battle.player.members[battle.player.activeIndex]
        const foe = battle.foe.members[battle.foe.activeIndex]
        player.heldItemId = 'lifeorb'
        player.abilityId = 'pinch_boost'
        player.currentHp = Math.max(1, Math.floor(player.maxHp / 3))
        foe.abilityId = 'guard'
        qteQualityQueue = ['good']
        for (const side of ['player', 'foe'] as const) {
          battle[side].members = battle[side].members.map((member, index) => ({
            ...member,
            artworkUrl: member.artworkUrl
              || state.battle?.[side].members[index]?.artworkUrl
              || M23_ARTWORK_FIXTURES['large-texture'],
          }))
        }
      }

      usePlayerSkills.setState({ learnedSkillIds })
      useBattleStore.setState({
        battle,
        phase: 'playerChoice',
        energy,
        log: [],
        banner: null,
        hitFx: null,
        support: null,
        combo: null,
        lockedIndex,
        presentation: null,
        intentPresentation: null,
        battleError: null,
      })
    },
    battleState: () => useBattleStore.getState().battle,
    feed: () => useBattleStore.getState().log.map((entry) => ({ ...entry })),
    prepareFeedHistory: (count = 10) => {
      const total = positiveInteger(count, 'feed count')
      for (let index = 1; index <= total; index += 1) {
        useBattleStore.getState().pushFeed({
          id: `evidence:${index}`,
          text: `測試戰況 ${index}`,
          kind: 'event',
        })
      }
    },
    runtimeState: () => {
      const state = useBattleStore.getState()
      return {
        phase: state.phase,
        energy: state.energy,
        activeResource: state.presentation?.activeResource ?? null,
        commandNotice: state.presentation?.commandNotice ?? null,
        lockedIndex: state.lockedIndex,
        error: state.battleError,
        session: state.session ? {
          token: state.session.token,
          nextPresentationId: state.session.nextPresentationId,
          endSent: state.session.endSent,
          retired: state.session.retired,
          recorderActive: state.session.recorder.active,
          rendererFallbackReason: state.session.rendererFallbackReason,
        } : null,
      }
    },
    takeQteQuality: (actual) => qteQualityQueue.shift() ?? actual,
    activeTransactionCase: () => activeTransactionCase,
    injectFailure: (stage, count = 1) => {
      if (!M23_FAILURE_STAGES.includes(stage)) throw new Error(`Unknown failure stage: ${stage}`)
      failures[stage] += positiveInteger(count, 'failure count')
    },
    consumeFailure: (stage) => {
      if (failures[stage] <= 0) return false
      failures[stage] -= 1
      return true
    },
    audioState: () => ({ sfx: battleAudioSession.snapshot(), bgm: battleBgmSession.snapshot() }),
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
    recordRendererState: (state) => diagnostics.recordRendererState(state),
    recordPools: (pools) => diagnostics.recordPools(pools),
    beginCast: (at) => diagnostics.beginCast(at),
    recordCastImpact: (at) => diagnostics.recordCastImpact(at),
    recordPresentationEvent: (event) => diagnostics.recordPresentationEvent(event),
    diagnostics: () => diagnostics.snapshot(),
    resetDiagnostics: () => {
      cueIndex = -1
      stepPermits = 0
      qteQualityQueue = []
      activeTransactionCase = null
      for (const stage of M23_FAILURE_STAGES) failures[stage] = 0
      diagnostics.reset()
    },
    dispose: () => {
      diagnostics.dispose()
      const waiters = resumeWaiters
      resumeWaiters = []
      for (const resolve of waiters) resolve()
      delete document.documentElement.dataset.m23Scenario
      delete document.documentElement.dataset.m23Graphics
      delete document.documentElement.dataset.m23RendererFailure
      delete document.documentElement.dataset.m23Motion
      if (window.__MOBIE_M23_BASELINE__ === driver) delete window.__MOBIE_M23_BASELINE__
    },
  }

  window.__MOBIE_M23_BASELINE__ = driver
  configure(options)
  return driver
}
