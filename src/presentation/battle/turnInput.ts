import type { BattleAction } from '@/game/battle/reducer'
import type { ReplayInput } from '@/game/replay/types'

function assertNever(value: never): never {
  throw new Error(`Unhandled replay input: ${JSON.stringify(value)}`)
}

/** Pure adapter from the stable replay schema to the reducer's action schema. */
export function battleActionFromReplayInput(input: ReplayInput): BattleAction {
  switch (input.type) {
    case 'ATTACK': return { ...input }
    case 'SWITCH': return { ...input }
    case 'CHAIN': return {
      type: 'SUBMIT_CHAIN_RESULT',
      hits: input.hits.map((hit) => ({ ...hit })),
    }
    default: return assertNever(input)
  }
}
