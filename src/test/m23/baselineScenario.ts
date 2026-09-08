import { makeWildEvents } from '@/game/accidents'
import {
  MAX_TURNS,
  createBattleState,
  resolveTurn,
  type BattleAction,
  type BattleEvent,
  type BattleState,
  type TurnOptions,
} from '@/game/battle/reducer'
import { mon } from '@/game/battle/testFixtures'
import { crc32Str } from '@/game/crc32'
import { teamBuffStatuses, PARTNER_SKILLS } from '@/game/ext/partnerSkills'
import { createOwnedUnit } from '@/game/growth'
import { encodeReplay } from '@/game/replay/codec'
import type { DisplayUnitSnapshot, ReplayInput } from '@/game/replay/types'
import { makeRng } from '@/game/rng'
import { defaultSettings, type GameSettings } from '@/game/settings'
import { PRODUCT_RUNTIME } from '@/game/ext/productRuntime'
import type { BattleMobie, Move, MoveEffect, TypeName } from '@/game/types'
import { ReplayRecorder } from '@/store/replayRecorder'
import { M23_BASELINE_SCENARIO_ID } from '@/dev/m23/contracts'

export { M23_BASELINE_SCENARIO_ID }
export const M23_BASELINE_SEED = 'm23-current-parity-v1-seed'
export const M23_BASELINE_CREATED_AT = 1_787_846_400_000

export const M23_ARTWORK_FIXTURES = {
  'artwork-404': '/__m23__/missing-artwork.png',
  'decode-failure': 'data:image/png;base64,bm90LWFuLWltYWdl',
  'large-texture': `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="4096" height="4096"><rect width="100%" height="100%" fill="#7a5cff"/></svg>')}`,
} as const

export type M23ArtworkFixture = keyof typeof M23_ARTWORK_FIXTURES

export const M23_BASELINE_SETTINGS: GameSettings = {
  ...defaultSettings(),
  prefs: { ...defaultSettings().prefs, recordReplays: true },
}

export const M23_FIXED_PRODUCT_MODULES = {
  heldItems: true,
  synergy: true,
  abilities: true,
  chain: true,
  evolution: true,
  partnerSkills: true,
  combo: true,
  encounterSkills: false,
} as const

export type M23BaselineCaseId =
  | 'normal-hit-chain-ready'
  | 'miss'
  | 'immune'
  | 'crit-super-star'
  | 'status-buff'
  | 'heal'
  | 'terrain-shift'
  | 'switch-forced-switch'
  | 'chain-combo'
  | 'win'
  | 'lose'
  | 'timeout'

export interface M23BaselineStep {
  input: ReplayInput
  events: BattleEvent[]
  nextState: BattleState
}

export interface M23BaselineCaseResult {
  id: M23BaselineCaseId
  initialState: BattleState
  steps: M23BaselineStep[]
  finalState: BattleState
  canonicalReplay: string
}

export interface M23ProductConfigurationProof {
  modules: typeof M23_FIXED_PRODUCT_MODULES
  scanner: 'absent'
  replayRecording: true
  graphicsDefaultAssumption: 'balanced'
  highReleaseReady: false
  synergyModifiers: string[]
  heldItemPatchedAttack: number
  assignedAbilities: string[]
  chainMaxHits: number
  comboId: string
  evolvedSpeciesId: number
  partnerStatusCount: number
  artworkFixtures: M23ArtworkFixture[]
}

export interface M23BaselineScenarioResult {
  schemaVersion: 1
  scenarioId: typeof M23_BASELINE_SCENARIO_ID
  seed: string
  productConfiguration: M23ProductConfigurationProof
  cases: M23BaselineCaseResult[]
  digest: string
}

interface CaseDefinition {
  id: M23BaselineCaseId
  state: BattleState
  actions: BattleAction[]
  options: TurnOptions
}

function attackMove(id: number, type: TypeName, power = 50, accuracy = 100): Move {
  return { id, name: `Baseline ${id}`, nameZh: `基準招式 ${id}`, type, power, accuracy, category: 'physical' }
}

function statusMove(id: number, effect: MoveEffect, type: TypeName = 'normal'): Move {
  return { id, name: `Baseline ${id}`, nameZh: `基準變化 ${id}`, type, power: 0, accuracy: 100, category: 'status', effect }
}

function mobie(
  speciesId: number,
  types: TypeName[],
  move: Move,
  over: Partial<BattleMobie> = {},
): BattleMobie {
  return mon({
    speciesId,
    name: `Baseline-${speciesId}`,
    nameZh: `基準-${speciesId}`,
    types,
    move,
    moves: [move],
    maxHp: 500,
    currentHp: 500,
    atk: 80,
    def: 80,
    spa: 80,
    spd: 80,
    spe: 80,
    ...over,
  })
}

function sequenceRng(values: number[]): () => number {
  let index = 0
  return () => values[Math.min(index++, values.length - 1)] ?? 0.5
}

function replayInput(action: BattleAction): ReplayInput {
  switch (action.type) {
    case 'ATTACK':
      return { ...action }
    case 'SWITCH':
      return { ...action }
    case 'SUBMIT_CHAIN_RESULT':
      return { type: 'CHAIN', hits: action.hits.map((hit) => ({ ...hit })) }
  }
}

function replaySnapshot(state: BattleState): DisplayUnitSnapshot[] {
  return (['player', 'foe'] as const).flatMap((side) =>
    state[side].members.map((unit, slot) => ({
      instanceId: `${side}:${slot}`,
      side,
      slot,
      speciesId: unit.speciesId,
      displayName: unit.nameZh,
      level: unit.level,
      maxHp: unit.maxHp,
      initialHp: unit.currentHp,
      shiny: unit.shiny,
      ...(unit.heldItemId ? { heldItemId: unit.heldItemId } : {}),
      ...(unit.abilityId ? { abilityId: unit.abilityId } : {}),
    })),
  )
}

function runCase(definition: CaseDefinition, seed: string, caseIndex: number): M23BaselineCaseResult {
  const recorder = new ReplayRecorder()
  recorder.start({
    battleSeed: `${seed}|${definition.id}`,
    regionId: definition.id === 'terrain-shift' ? 'baseline-wild' : 'baseline-arena',
    mode: definition.id === 'terrain-shift' ? 'wild' : 'arena',
    snapshot: replaySnapshot(definition.state),
    createdAt: M23_BASELINE_CREATED_AT + caseIndex,
  })

  let state = definition.state
  const steps: M23BaselineStep[] = []
  for (const action of definition.actions) {
    const result = resolveTurn(state, action, definition.options)
    const input = replayInput(action)
    recorder.record(input, result.events)
    steps.push({ input, events: result.events, nextState: result.nextState })
    state = result.nextState
  }

  const replay = recorder.build(state.winner === 'foe' ? 'lose' : 'win')
  if (!replay) throw new Error(`Baseline case ${definition.id} produced no replay`)
  return {
    id: definition.id,
    initialState: definition.state,
    steps,
    finalState: state,
    canonicalReplay: encodeReplay(replay),
  }
}

function configurationProof(): M23ProductConfigurationProof {
  const rawTeam = [
    mobie(4, ['fire'], attackMove(10_001, 'fire'), { heldItemId: 'headband', atk: 100 }),
    mobie(7, ['water'], attackMove(10_002, 'water')),
    mobie(1, ['grass'], attackMove(10_003, 'grass')),
  ]
  const prepared = PRODUCT_RUNTIME.prepareBattleTeams(rawTeam, [])
  const combo = PRODUCT_RUNTIME.turnExtensions.combo.match(prepared.playerTeam.slice(0, 2), [])
  const evolved = PRODUCT_RUNTIME.applyPostGrowth(createOwnedUnit('m23-baseline-evolution', 1, 16))
  const rally = PARTNER_SKILLS.find((skill) => skill.id === 'rally')
  if (!combo || !rally) throw new Error('M23 baseline fixed product configuration is incomplete')

  return {
    modules: { ...M23_FIXED_PRODUCT_MODULES },
    scanner: 'absent',
    replayRecording: true,
    graphicsDefaultAssumption: 'balanced',
    highReleaseReady: false,
    synergyModifiers: prepared.playerModifiers.map((modifier) => modifier.label),
    heldItemPatchedAttack: prepared.playerTeam[0].atk,
    assignedAbilities: prepared.playerTeam.map((unit) => unit.abilityId ?? ''),
    chainMaxHits: PRODUCT_RUNTIME.turnExtensions.chain.maxHits,
    comboId: combo.id,
    evolvedSpeciesId: evolved.speciesId,
    partnerStatusCount: teamBuffStatuses(rally).length,
    artworkFixtures: Object.keys(M23_ARTWORK_FIXTURES) as M23ArtworkFixture[],
  }
}

function definitions(seed: string): CaseDefinition[] {
  const ext = PRODUCT_RUNTIME.turnExtensions
  const weakNormal = attackMove(11_001, 'normal', 10)
  const normal = attackMove(11_002, 'normal', 55)
  const fire = attackMove(11_003, 'fire', 70)

  const rawPlayers = [
    mobie(4, ['fire'], fire, { heldItemId: 'lifeorb', spe: 140 }),
    mobie(7, ['water'], attackMove(11_004, 'water', 45), { heldItemId: 'leftovers', spe: 120 }),
    mobie(1, ['grass'], attackMove(11_005, 'grass', 45), { spe: 110 }),
  ]
  const prepared = PRODUCT_RUNTIME.prepareBattleTeams(rawPlayers, [
    mobie(43, ['grass'], weakNormal, { maxHp: 5_000, currentHp: 5_000, spe: 10 }),
    mobie(92, ['ghost'], weakNormal, { maxHp: 5_000, currentHp: 5_000, spe: 10 }),
    mobie(74, ['rock'], weakNormal, { maxHp: 5_000, currentHp: 5_000, spe: 10 }),
  ])
  const players = prepared.playerTeam
  const foes = prepared.foeTeam

  const normalState = createBattleState(players, foes, ['rain'])
  normalState.chainGauge = 80

  const miss = attackMove(11_006, 'normal', 55, 0)
  const buff = statusMove(11_007, { kind: 'buff', stat: 'atk', mult: 1.5, duration: 4, label: '攻擊提升' })
  const heal = statusMove(11_008, { kind: 'heal', healFrac: 0.25, label: '回復' })

  const healPlayer = mobie(7, ['water'], heal, { heldItemId: 'leftovers', maxHp: 400, currentHp: 100, spe: 150 })
  const healState = createBattleState([healPlayer], [mobie(74, ['rock'], weakNormal, { maxHp: 2_000, currentHp: 2_000, spe: 5 })])

  const terrainState = createBattleState(
    [mobie(4, ['fire'], weakNormal, { spe: 150 })],
    [mobie(7, ['water'], weakNormal, { maxHp: 2_000, currentHp: 2_000, spe: 5 })],
    ['rain'],
  )
  terrainState.turn = 2
  const terrainHook = makeWildEvents({ terrainPool: ['snowfield'] })

  const switchState = createBattleState(
    [
      mobie(1, ['grass'], weakNormal, { spe: 50 }),
      mobie(4, ['fire'], weakNormal, { maxHp: 1, currentHp: 1, def: 1, spe: 40 }),
      mobie(7, ['water'], weakNormal, { spe: 30 }),
    ],
    [mobie(68, ['fighting'], attackMove(11_009, 'fighting', 500), { atk: 500, spe: 200 })],
  )

  const chainState = createBattleState(
    [
      mobie(4, ['fire'], fire, { spe: 200 }),
      mobie(7, ['water'], attackMove(11_010, 'water', 35), { spe: 190 }),
      mobie(1, ['grass'], attackMove(11_011, 'grass', 35), { spe: 180 }),
    ],
    [mobie(143, ['normal'], weakNormal, { maxHp: 20_000, currentHp: 20_000, def: 500, spe: 1 })],
  )

  const timeoutState = createBattleState(
    [mobie(92, ['ghost'], normal, { currentHp: 400 })],
    [mobie(200, ['ghost'], normal, { currentHp: 300 })],
  )
  timeoutState.turn = MAX_TURNS

  const standardOptions = (id: string): TurnOptions => ({
    rng: makeRng(`${seed}|${id}`),
    ext,
  })

  return [
    { id: 'normal-hit-chain-ready', state: normalState, actions: [{ type: 'ATTACK', quality: 'good' }], options: standardOptions('normal-hit-chain-ready') },
    {
      id: 'miss',
      state: createBattleState(
        [mobie(19, ['normal'], miss, { spe: 120 })],
        [mobie(20, ['normal'], miss, { maxHp: 2_000, currentHp: 2_000, spe: 10 })],
      ),
      actions: [{ type: 'ATTACK', quality: 'normal' }],
      options: standardOptions('miss'),
    },
    {
      id: 'immune',
      state: createBattleState(
        [mobie(19, ['normal'], normal, { spe: 120 })],
        [mobie(92, ['ghost'], weakNormal, { maxHp: 2_000, currentHp: 2_000, spe: 10 })],
      ),
      actions: [{ type: 'ATTACK', quality: 'normal' }],
      options: standardOptions('immune'),
    },
    {
      id: 'crit-super-star',
      state: createBattleState(
        [mobie(4, ['fire'], fire, { spe: 120 })],
        [mobie(43, ['grass'], weakNormal, { maxHp: 10_000, currentHp: 10_000, spe: 10 })],
      ),
      actions: [{ type: 'ATTACK', starStrike: true }],
      options: standardOptions('crit-super-star'),
    },
    {
      id: 'status-buff',
      state: createBattleState(
        [mobie(56, ['fighting'], buff, { spe: 120 })],
        [mobie(143, ['normal'], weakNormal, { maxHp: 2_000, currentHp: 2_000, spe: 10 })],
      ),
      actions: [{ type: 'ATTACK', quality: 'perfect' }],
      options: standardOptions('status-buff'),
    },
    { id: 'heal', state: healState, actions: [{ type: 'ATTACK', quality: 'normal' }], options: standardOptions('heal') },
    {
      id: 'terrain-shift',
      state: terrainState,
      actions: [{ type: 'ATTACK', quality: 'normal' }],
      options: {
        ...standardOptions('terrain-shift'),
        wildEvents: ({ state }) => terrainHook({ state, rng: sequenceRng([0.01, 0.01, 0.01]) }),
      },
    },
    {
      id: 'switch-forced-switch',
      state: switchState,
      actions: [{ type: 'SWITCH', index: 1, defenseQuality: 'weak' }],
      options: standardOptions('switch-forced-switch'),
    },
    {
      id: 'chain-combo',
      state: chainState,
      actions: [{ type: 'SUBMIT_CHAIN_RESULT', hits: [
        { attackerIndex: 0, quality: 'perfect' },
        { attackerIndex: 1, quality: 'good' },
        { attackerIndex: 2, quality: 'normal' },
      ] }],
      options: standardOptions('chain-combo'),
    },
    {
      id: 'win',
      state: createBattleState(
        [mobie(6, ['fire'], attackMove(11_012, 'fire', 500), { atk: 500, spe: 200 })],
        [mobie(10, ['bug'], weakNormal, { maxHp: 1, currentHp: 1, def: 1, spe: 1 })],
      ),
      actions: [{ type: 'ATTACK', quality: 'perfect' }],
      options: standardOptions('win'),
    },
    {
      id: 'lose',
      state: createBattleState(
        [mobie(10, ['bug'], weakNormal, { maxHp: 1, currentHp: 1, def: 1, spe: 1 })],
        [mobie(6, ['fire'], attackMove(11_013, 'fire', 500), { atk: 500, spe: 200 })],
      ),
      actions: [{ type: 'ATTACK', quality: 'weak' }],
      options: standardOptions('lose'),
    },
    {
      id: 'timeout',
      state: timeoutState,
      actions: [{ type: 'ATTACK', quality: 'normal' }],
      options: standardOptions('timeout'),
    },
  ]
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}

export function runM23BaselineScenario(options: {
  scenarioId?: string
  seed?: string
} = {}): M23BaselineScenarioResult {
  const scenarioId = options.scenarioId ?? M23_BASELINE_SCENARIO_ID
  if (scenarioId !== M23_BASELINE_SCENARIO_ID) throw new Error(`Unknown M23 baseline scenario: ${scenarioId}`)
  const seed = options.seed ?? M23_BASELINE_SEED
  const payload = {
    schemaVersion: 1 as const,
    scenarioId: M23_BASELINE_SCENARIO_ID as typeof M23_BASELINE_SCENARIO_ID,
    seed,
    productConfiguration: configurationProof(),
    cases: definitions(seed).map((definition, index) => runCase(definition, seed, index)),
  }
  return { ...payload, digest: crc32Str(stableStringify(payload)) }
}
