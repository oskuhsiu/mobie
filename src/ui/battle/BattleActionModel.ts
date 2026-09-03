import type { BattleMobie } from '@/game/types'
import type { BattlePhase } from '@/store/battleStore'

export const SWITCH_CONSEQUENCE = '放棄本回合攻擊並承受對手攻擊'

export interface SwitchAvailability {
  consequence: typeof SWITCH_CONSEQUENCE
  legalIndices: number[]
  disabledReason: string | null
}

/** Display-only switch legality; the reducer remains the canonical turn resolver. */
export function switchAvailability(
  members: readonly BattleMobie[],
  activeIndex: number,
  lockedIndex: number | null,
): SwitchAvailability {
  const livingBench = members
    .map((member, index) => ({ member, index }))
    .filter(({ member, index }) => index !== activeIndex && member.currentHp > 0)
  const legalIndices = livingBench
    .filter(({ index }) => index !== lockedIndex)
    .map(({ index }) => index)
  const disabledReason = legalIndices.length > 0
    ? null
    : livingBench.length > 0
      ? '剛換下的夥伴本回合不能立刻換回'
      : '沒有可換上的夥伴'
  return { consequence: SWITCH_CONSEQUENCE, legalIndices, disabledReason }
}

export type ResourceActionState = 'charging' | 'ready' | 'activating'

const MOB_CARD_DISABLED_REASON = {
  intro: '開場演出中',
  playerChoice: null,
  qte: '戰鬥輸入進行中',
  mash: '戰鬥輸入進行中',
  statusQte: '戰鬥輸入進行中',
  switchSelect: '正在選擇換人',
  defenseQte: '戰鬥輸入進行中',
  chainQte: '戰鬥輸入進行中',
  starQte: '戰鬥輸入進行中',
  busy: '正在結算回合',
  error: '戰鬥發生錯誤',
  won: '戰鬥已結束',
  lost: '戰鬥已結束',
} as const satisfies Record<BattlePhase, string | null>

export function mobCardDisabledReason(phase: BattlePhase): string | null {
  return MOB_CARD_DISABLED_REASON[phase]
}

export function resourceActionState({
  current,
  max,
  activating,
}: {
  current: number
  max: number
  activating: boolean
}): ResourceActionState {
  if (activating) return 'activating'
  return max > 0 && current >= max ? 'ready' : 'charging'
}
