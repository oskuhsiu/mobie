import { setup, assign } from 'xstate'
import type { Card } from '@/game/types'
import { lookupRegion } from '@/game/data/regionLookup'
import { rollEncounterTeam } from '@/game/encounter'
import { maybeRareBoss } from '@/game/accidents'
import { towerFoeTeam } from '@/game/tower'

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
  captured: boolean
  /** M11 連勝塔 run（null＝非塔戰）；塔戰無捕獲、地形、野外意外 */
  tower: TowerRun | null
}

export type GameEvent =
  | { type: 'START' }
  | { type: 'SELECT_REGION'; regionId: string }
  | { type: 'ENGAGE' }
  | { type: 'BACK' }
  | { type: 'SELECT_TEAM'; cards: Card[] }
  | { type: 'END_BATTLE'; outcome: Outcome }
  | { type: 'SET_CAPTURED'; captured: boolean }
  | { type: 'PLAY_AGAIN' }
  | { type: 'TO_REGIONS' }
  | { type: 'OPEN_TOWER' }
  | { type: 'START_TOWER'; cards: Card[]; ascension: number; seed: string }
  | { type: 'TOWER_CONTINUE' }
  | { type: 'TOWER_QUIT' }

const initialContext: GameContext = {
  regionId: null,
  foeTeam: [],
  playerTeam: [],
  outcome: null,
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
      return { regionId: event.regionId, foeTeam }
    }),
    pickTeam: assign(({ event }) => {
      if (event.type !== 'SELECT_TEAM') return {}
      return { playerTeam: event.cards }
    }),
    recordOutcome: assign(({ event }) => {
      if (event.type !== 'END_BATTLE') return {}
      return { outcome: event.outcome }
    }),
    setCaptured: assign(({ event }) => {
      if (event.type !== 'SET_CAPTURED') return {}
      return { captured: event.captured }
    }),
    resetEncounter: assign(() => ({
      foeTeam: [], playerTeam: [], outcome: null, captured: false, tower: null,
    })),
    // M11 連勝塔：開新 run（第 1 樓），生成 foe；隊伍固定為 run team。
    startTower: assign(({ event }) => {
      if (event.type !== 'START_TOWER') return {}
      const tower: TowerRun = { ascension: event.ascension, floor: 1, seed: event.seed, teamCards: event.cards }
      return {
        tower, playerTeam: event.cards, outcome: null, captured: false,
        foeTeam: towerFoeTeam(1, event.ascension, event.seed),
      }
    }),
    // M11：勝利推進下一樓，沿用 run team、重生 foe（決定論依 run seed + 新樓層）。
    towerAdvance: assign(({ context }) => {
      const t = context.tower
      if (!t) return {}
      const floor = t.floor + 1
      return {
        tower: { ...t, floor }, playerTeam: t.teamCards, outcome: null, captured: false,
        foeTeam: towerFoeTeam(floor, t.ascension, t.seed),
      }
    }),
    endTower: assign(() => ({ tower: null, foeTeam: [], playerTeam: [], outcome: null, captured: false })),
    rerollFoes: assign(({ context }) => {
      if (!context.regionId) return {}
      const region = lookupRegion(context.regionId)
      const foeTeam = maybeRareBoss(rollEncounterTeam(region, TEAM_SIZE), region, Math.random)
      return { foeTeam, playerTeam: [], outcome: null, captured: false }
    }),
  },
}).createMachine({
  id: 'game',
  initial: 'title',
  context: initialContext,
  states: {
    title: {
      on: { START: 'regionSelect' },
    },
    regionSelect: {
      entry: 'resetEncounter',
      on: {
        SELECT_REGION: { target: 'encounter', actions: 'rollFoes' },
        OPEN_TOWER: 'towerSetup',
        BACK: 'title',
      },
    },
    towerSetup: {
      on: {
        START_TOWER: { target: 'battle', actions: 'startTower' },
        BACK: 'regionSelect',
      },
    },
    encounter: {
      on: {
        ENGAGE: 'cardSelect',
        BACK: 'regionSelect',
      },
    },
    cardSelect: {
      on: {
        SELECT_TEAM: { target: 'battle', actions: 'pickTeam' },
        BACK: 'encounter',
      },
    },
    battle: {
      on: {
        END_BATTLE: { target: 'result', actions: 'recordOutcome' },
      },
    },
    result: {
      on: {
        SET_CAPTURED: { actions: 'setCaptured' },
        PLAY_AGAIN: { target: 'encounter', actions: 'rerollFoes' },
        TO_REGIONS: 'regionSelect',
        // M11 連勝塔：勝利續攻下一樓 / 結束遠征（settle）
        TOWER_CONTINUE: { target: 'battle', actions: 'towerAdvance' },
        TOWER_QUIT: { target: 'regionSelect', actions: 'endTower' },
      },
    },
  },
})
