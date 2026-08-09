import { typeEffectiveness } from '@/game/data/typeChart'
import type { Move, TypeName } from '@/game/types'

export interface MoveDecisionPresentation {
  label: string
  multiplier: number | null
}

const formatMultiplier = (multiplier: number): string => Number.isInteger(multiplier)
  ? multiplier.toFixed(0)
  : multiplier.toString()

/** Read-only move consequence derived from the canonical type chart and move data. */
export function moveDecisionPresentation(
  move: Move,
  defenderTypes: TypeName[],
): MoveDecisionPresentation {
  if (move.category === 'status') {
    return {
      label: `變化：${move.effect?.label ?? '輔助效果'}`,
      multiplier: null,
    }
  }

  const multiplier = typeEffectiveness(move.type, defenderTypes)
  const consequence = multiplier === 0
    ? '無效'
    : multiplier >= 2
      ? '效果絕佳'
      : multiplier < 1
        ? '效果不佳'
        : '一般'

  return {
    label: `${consequence} ×${formatMultiplier(multiplier)}`,
    multiplier,
  }
}

/** Existing initiative rule: higher speed acts first; ties remain random. */
export function initiativePresentation(playerSpeed: number, foeSpeed: number): string {
  if (playerSpeed === foeSpeed) return '速度相同，先攻順序不定'
  return playerSpeed > foeSpeed ? '你先攻' : '對手先攻'
}
