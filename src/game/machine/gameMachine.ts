import { setup, assign } from 'xstate'
import type { Card } from '@/game/types'
import { lookupRegion } from '@/game/data/regionLookup'
import { rollEncounterTeam } from '@/game/encounter'

export type Outcome = 'win' | 'lose'

/** 一場 3v3 的隊伍大小 */
export const TEAM_SIZE = 3

export interface GameContext {
  regionId: string | null
  /** 對手隊伍（3 隻，末隻為 boss＝勝利後的捕獲對象） */
  foeTeam: Card[]
  /** 玩家出戰隊伍（cardSelect 選滿 3 隻） */
  playerTeam: Card[]
  outcome: Outcome | null
  captured: boolean
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

const initialContext: GameContext = {
  regionId: null,
  foeTeam: [],
  playerTeam: [],
  outcome: null,
  captured: false,
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
      return { regionId: event.regionId, foeTeam: rollEncounterTeam(region, TEAM_SIZE) }
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
      foeTeam: [], playerTeam: [], outcome: null, captured: false,
    })),
    rerollFoes: assign(({ context }) => {
      if (!context.regionId) return {}
      const region = lookupRegion(context.regionId)
      return { foeTeam: rollEncounterTeam(region, TEAM_SIZE), playerTeam: [], outcome: null, captured: false }
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
      },
    },
  },
})
