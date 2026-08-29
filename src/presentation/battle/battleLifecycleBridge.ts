import type { BattleSessionEndReason } from './BattleSessionLifecycle'

let endCurrentBattle: ((reason: BattleSessionEndReason) => void) | null = null

/** Route host bridge for ending volatile battle resources before removing BattleScreen. */
export function registerBattleLifecycleEnd(
  handler: (reason: BattleSessionEndReason) => void,
): () => void {
  endCurrentBattle = handler
  return () => {
    if (endCurrentBattle === handler) endCurrentBattle = null
  }
}

export function endRegisteredBattleLifecycle(reason: BattleSessionEndReason): boolean {
  if (!endCurrentBattle) return false
  endCurrentBattle(reason)
  return true
}
