import { setup, assign } from 'xstate'
import type { Card } from '@/game/types'
import { getRegion } from '@/game/data/regions'
import { rollEncounter } from '@/game/encounter'

export type Outcome = 'win' | 'lose'

export interface GameContext {
  regionId: string | null
  wild: Card | null
  playerCard: Card | null
  outcome: Outcome | null
  captured: boolean
}

export type GameEvent =
  | { type: 'START' }
  | { type: 'SELECT_REGION'; regionId: string }
  | { type: 'ENGAGE' }
  | { type: 'BACK' }
  | { type: 'SELECT_CARD'; card: Card }
  | { type: 'END_BATTLE'; outcome: Outcome }
  | { type: 'SET_CAPTURED'; captured: boolean }
  | { type: 'PLAY_AGAIN' }
  | { type: 'TO_REGIONS' }

const initialContext: GameContext = {
  regionId: null,
  wild: null,
  playerCard: null,
  outcome: null,
  captured: false,
}

/**
 * 遊戲高層流程狀態機。
 * 戰鬥內部的回合 / HP / QTE 由 battleStore 處理；本機只負責畫面流轉與帶資料。
 */
export const gameMachine = setup({
  types: {
    context: {} as GameContext,
    events: {} as GameEvent,
  },
  actions: {
    rollWild: assign(({ event }) => {
      if (event.type !== 'SELECT_REGION') return {}
      const region = getRegion(event.regionId)
      return { regionId: event.regionId, wild: rollEncounter(region) }
    }),
    pickCard: assign(({ event }) => {
      if (event.type !== 'SELECT_CARD') return {}
      return { playerCard: event.card }
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
      wild: null, playerCard: null, outcome: null, captured: false,
    })),
    rerollWild: assign(({ context }) => {
      if (!context.regionId) return {}
      const region = getRegion(context.regionId)
      return { wild: rollEncounter(region), playerCard: null, outcome: null, captured: false }
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
        SELECT_REGION: { target: 'encounter', actions: 'rollWild' },
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
        SELECT_CARD: { target: 'battle', actions: 'pickCard' },
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
        PLAY_AGAIN: { target: 'encounter', actions: 'rerollWild' },
        TO_REGIONS: 'regionSelect',
      },
    },
  },
})
