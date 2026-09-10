import { setup, assign } from 'xstate'
import type { Card } from '@/game/types'
import { lookupRegion } from '@/game/data/regionLookup'
import { rollEncounterTeam } from '@/game/encounter'
import { maybeRareBoss } from '@/game/accidents'
import { ASCENSIONS, towerFoeTeam } from '@/game/tower'

export type Outcome = 'win' | 'lose'

/** 一場 3v3 的隊伍大小 */
export const TEAM_SIZE = 3

/** M11 連勝塔進行中的 run（XState context 暫態，run 防火牆：不逆寫 OwnedUnit）。 */
export interface TowerRun {
  ascension: number
  floor: number
  /** run-unique 種子：同一 run 內每樓 foe 決定論、不同 run 不同序列 */
  seed: string
  /** 固定的 run 出戰隊伍（每樓沿用，不重選） */
  teamCards: Card[]
}

export interface GameContext {
  regionId: string | null
  /** 對手隊伍（3 隻，末隻為 boss＝勝利後的捕獲對象） */
  foeTeam: Card[]
  /** 玩家出戰隊伍（cardSelect 選滿 3 隻） */
  playerTeam: Card[]
  outcome: Outcome | null
  /** Stable handoff from battle presentation to result settlement. */
  battleResult: BattleResultHandoff | null
  captured: boolean
  /** M11 連勝塔 run（null＝非塔戰）；塔戰無捕獲、地形、野外意外 */
  tower: TowerRun | null
}

export interface BattleResultHandoff {
  resultId: string
  resultFingerprint: string
  outcome: Outcome
  /** A turn-cap result is still a normal win/lose outcome, but Result keeps the reason for a truthful summary. */
  reason?: 'timeout'
}

/** Runtime guard for restored or externally seeded Tower Result contexts. */
export function isValidTowerRun(value: unknown): value is TowerRun {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<TowerRun>
  if (!Number.isInteger(candidate.floor) || (candidate.floor ?? 0) < 1) return false
  if (!Number.isInteger(candidate.ascension) || (candidate.ascension ?? -1) < 0 || (candidate.ascension ?? Infinity) >= ASCENSIONS.length) return false
  if (typeof candidate.seed !== 'string' || candidate.seed.trim().length === 0) return false
  return isValidBattleTeam(candidate.teamCards)
}

/** Runtime boundary for card selections arriving from UI or a restored handoff. */
export function isValidBattleTeam(value: unknown): value is Card[] {
  if (!Array.isArray(value) || value.length !== TEAM_SIZE) return false
  const ids = new Set<string>()
  return value.every((card) => {
    if (!card || typeof card !== 'object') return false
    if (typeof card.cardId !== 'string' || card.cardId.trim().length === 0 || ids.has(card.cardId)) return false
    if (!Number.isInteger(card.speciesId) || card.speciesId < 1) return false
    if (!Number.isInteger(card.level) || card.level < 1) return false
    ids.add(card.cardId)
    return true
  })
}

function validRegionId(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) return false
  try {
    lookupRegion(value)
    return true
  } catch {
    return false
  }
}

export function sameCardOrder(left: readonly Card[], right: readonly Card[]): boolean {
  return left.length === right.length && left.every((card, index) => {
    const paired = right[index]
    return paired?.cardId === card.cardId
      && paired.speciesId === card.speciesId
      && paired.level === card.level
      && paired.shiny === card.shiny
      && paired.nature === card.nature
      && paired.heldItemId === card.heldItemId
      && JSON.stringify(paired.ivs ?? null) === JSON.stringify(card.ivs ?? null)
      && JSON.stringify(paired.equippedMoveIds ?? null) === JSON.stringify(card.equippedMoveIds ?? null)
  })
}

function validResultHandoff(value: unknown): value is BattleResultHandoff {
  if (!value || typeof value !== 'object') return false
  const handoff = value as Partial<BattleResultHandoff>
  return typeof handoff.resultId === 'string'
    && handoff.resultId.trim().length > 0
    && typeof handoff.resultFingerprint === 'string'
    && handoff.resultFingerprint.trim().length > 0
    && (handoff.outcome === 'win' || handoff.outcome === 'lose')
    && (handoff.reason === undefined || handoff.reason === 'timeout')
}

export type GameEvent =
  | { type: 'START' }
  | { type: 'SELECT_REGION'; regionId: string }
  | { type: 'RETRY_ENCOUNTER' }
  | { type: 'ENGAGE' }
  | { type: 'BACK' }
  | { type: 'SELECT_TEAM'; cards: Card[] }
  | ({ type: 'END_BATTLE' } & BattleResultHandoff)
  | { type: 'ABORT_BATTLE' }
  | { type: 'SET_CAPTURED'; captured: boolean }
  | { type: 'PLAY_AGAIN' }
  | { type: 'TO_REGIONS' }
  | { type: 'OPEN_TOWER' }
  | { type: 'START_TOWER'; cards: Card[]; ascension: number; seed: string }
  | { type: 'TOWER_CONTINUE' }
  | { type: 'TOWER_QUIT' }

export const INITIAL_GAME_CONTEXT: GameContext = {
  regionId: null,
  foeTeam: [],
  playerTeam: [],
  outcome: null,
  battleResult: null,
  captured: false,
  tower: null,
}

/**
 * 遊戲高層流程狀態機。
 * 戰鬥內部的回合 / HP / QTE / 換人由 battleStore + reducer 處理；本機只負責畫面流轉與帶資料。
 */
export const gameMachine = setup({
  types: {
    context: {} as GameContext,
    events: {} as GameEvent,
  },
  actions: {
    rollFoes: assign(({ event }) => {
      if (event.type !== 'SELECT_REGION') return {}
      const region = lookupRegion(event.regionId)
      // M11 稀有閃光 boss（wild-only，機率）：升 boss 為異色 + 高 IV
      const foeTeam = maybeRareBoss(rollEncounterTeam(region, TEAM_SIZE), region, Math.random)
      return { regionId: event.regionId, foeTeam, outcome: null, battleResult: null }
    }),
    pickTeam: assign(({ event }) => {
      if (event.type !== 'SELECT_TEAM') return {}
      return { playerTeam: event.cards, outcome: null, battleResult: null }
    }),
    recordOutcome: assign(({ event }) => {
      if (event.type !== 'END_BATTLE') return {}
      return {
        outcome: event.outcome,
        battleResult: {
          resultId: event.resultId,
          resultFingerprint: event.resultFingerprint,
          outcome: event.outcome,
          ...(event.reason ? { reason: event.reason } : {}),
        },
      }
    }),
    setCaptured: assign(({ event }) => {
      if (event.type !== 'SET_CAPTURED') return {}
      return { captured: event.captured }
    }),
    resetEncounter: assign(() => ({
      foeTeam: [], playerTeam: [], outcome: null, battleResult: null, captured: false, tower: null,
    })),
    // M11 連勝塔：開新 run（第 1 樓），生成 foe；隊伍固定為 run team。
    startTower: assign(({ event }) => {
      if (event.type !== 'START_TOWER') return {}
      const tower: TowerRun = { ascension: event.ascension, floor: 1, seed: event.seed, teamCards: event.cards }
      return {
        tower, playerTeam: event.cards, outcome: null, battleResult: null, captured: false,
        foeTeam: towerFoeTeam(1, event.ascension, event.seed),
      }
    }),
    // M11：勝利推進下一樓，沿用 run team、重生 foe（決定論依 run seed + 新樓層）。
    towerAdvance: assign(({ context }) => {
      const t = context.tower
      if (!t) return {}
      const floor = t.floor + 1
      return {
        tower: { ...t, floor }, playerTeam: t.teamCards, outcome: null, battleResult: null, captured: false,
        foeTeam: towerFoeTeam(floor, t.ascension, t.seed),
      }
    }),
    endTower: assign(() => ({ tower: null, foeTeam: [], playerTeam: [], outcome: null, battleResult: null, captured: false })),
    rerollFoes: assign(({ context }) => {
      if (!context.regionId) return {}
      const region = lookupRegion(context.regionId)
      const foeTeam = maybeRareBoss(rollEncounterTeam(region, TEAM_SIZE), region, Math.random)
      return { foeTeam, playerTeam: [], outcome: null, battleResult: null, captured: false }
    }),
  },
  guards: {
    validRegion: ({ event }) => event.type === 'SELECT_REGION' && validRegionId(event.regionId),
    validEncounterRetry: ({ context }) => context.tower === null && validRegionId(context.regionId),
    validEncounter: ({ context }) => context.tower === null
      && validRegionId(context.regionId)
      && isValidBattleTeam(context.foeTeam),
    validPlayerTeam: ({ context, event }) => event.type === 'SELECT_TEAM'
      && context.tower === null
      && validRegionId(context.regionId)
      && isValidBattleTeam(event.cards)
      && isValidBattleTeam(context.foeTeam),
    validTowerStart: ({ event }) => event.type === 'START_TOWER'
      && isValidBattleTeam(event.cards)
      && Number.isInteger(event.ascension)
      && event.ascension >= 0
      && event.ascension < ASCENSIONS.length
      && typeof event.seed === 'string'
      && event.seed.trim().length > 0,
    validBattleResult: ({ event }) => event.type === 'END_BATTLE' && validResultHandoff(event),
    capturableResult: ({ context, event }) => event.type === 'SET_CAPTURED'
      && context.tower === null
      && context.outcome === 'win'
      && validRegionId(context.regionId)
      && lookupRegion(context.regionId).mode === 'wild',
    towerContinue: ({ context }) => context.tower !== null
      && context.outcome === 'win'
      && isValidTowerRun(context.tower)
      && isValidBattleTeam(context.playerTeam)
      && sameCardOrder(context.tower.teamCards, context.playerTeam),
    wildResult: ({ context }) => context.tower === null
      && context.outcome !== null
      && validRegionId(context.regionId),
    // TOWER_QUIT is the recovery escape hatch as well, so it must clear a
    // malformed/stale tower context instead of trapping the player on Result.
    activeTower: ({ context }) => context.tower !== null,
  },
}).createMachine({
  id: 'game',
  initial: 'title',
  context: INITIAL_GAME_CONTEXT,
  states: {
    title: {
      on: { START: 'regionSelect' },
    },
    regionSelect: {
      entry: 'resetEncounter',
      on: {
        SELECT_REGION: { target: 'encounter', actions: 'rollFoes', guard: 'validRegion' },
        OPEN_TOWER: 'towerSetup',
        BACK: 'title',
      },
    },
    towerSetup: {
      on: {
        START_TOWER: { target: 'battle', actions: 'startTower', guard: 'validTowerStart' },
        BACK: 'regionSelect',
      },
    },
    encounter: {
      on: {
        RETRY_ENCOUNTER: { actions: 'rerollFoes', guard: 'validEncounterRetry' },
        ENGAGE: { target: 'cardSelect', guard: 'validEncounter' },
        BACK: 'regionSelect',
      },
    },
    cardSelect: {
      on: {
        SELECT_TEAM: { target: 'battle', actions: 'pickTeam', guard: 'validPlayerTeam' },
        BACK: 'encounter',
      },
    },
    battle: {
      on: {
        END_BATTLE: { target: 'result', actions: 'recordOutcome', guard: 'validBattleResult' },
        ABORT_BATTLE: { target: 'regionSelect', actions: 'resetEncounter' },
      },
    },
    result: {
      on: {
        SET_CAPTURED: { actions: 'setCaptured', guard: 'capturableResult' },
        PLAY_AGAIN: { target: 'encounter', actions: 'rerollFoes', guard: 'wildResult' },
        TO_REGIONS: 'regionSelect',
        // M11 連勝塔：勝利續攻下一樓 / 結束遠征（settle）
        TOWER_CONTINUE: { target: 'battle', actions: 'towerAdvance', guard: 'towerContinue' },
        TOWER_QUIT: { target: 'regionSelect', actions: 'endTower', guard: 'activeTower' },
      },
    },
  },
})
