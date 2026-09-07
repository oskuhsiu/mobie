import type { Move, MoveCategory, TypeName } from '@/game/types'

export type MoveResult = 'normal' | 'miss' | 'immune' | 'crit' | 'super' | 'resisted'
export interface MoveRecipe {
  delivery: 'contact' | 'projectile' | 'beam' | 'ground' | 'aura'
  element: TypeName
  effect: 'damage' | 'heal' | 'buff' | 'debuff' | 'terrain'
  intensity: number
  result: MoveResult
  motif: number
}

// Stable shader motif indices. Each element has a silhouette, not just a tint.
export const ELEMENT_MOTIFS: Record<TypeName, number> = {
  normal: 0, fire: 1, water: 2, electric: 3, grass: 4, ice: 5,
  fighting: 6, poison: 7, ground: 8, flying: 9, psychic: 10, bug: 11,
  rock: 12, ghost: 13, dragon: 14, dark: 15, steel: 16, fairy: 17,
}
const DEFAULT_DELIVERY: Record<MoveCategory, MoveRecipe['delivery']> = {
  physical: 'contact', special: 'projectile', status: 'aura',
}
// Display-only exceptions; generated move definitions remain canonical.
const DELIVERY_OVERRIDES: Readonly<Partial<Record<number, MoveRecipe['delivery']>>> = {
  1011: 'beam', 1042: 'beam', 1051: 'beam',
  1080: 'ground', 1081: 'ground', 1082: 'ground', 1032: 'ground',
}

export interface MoveOutcome {
  missed?: boolean
  effectiveness?: number
  crit?: boolean
  star?: boolean
}

export function resolveMoveRecipe(move: Move, outcome: MoveOutcome = {}): MoveRecipe {
  const effectiveness = outcome.effectiveness ?? 1
  const result: MoveResult = outcome.missed ? 'miss' : effectiveness === 0 ? 'immune'
    : outcome.crit ? 'crit' : effectiveness >= 2 ? 'super' : effectiveness < 1 ? 'resisted' : 'normal'
  const effect = move.category !== 'status' ? 'damage'
    : move.effect?.kind === 'buff' && (move.effect.mult ?? 1) < 1 ? 'debuff'
    : move.effect?.kind ?? 'buff'
  return {
    delivery: move.category === 'status' ? 'aura' : DELIVERY_OVERRIDES[move.id] ?? DEFAULT_DELIVERY[move.category],
    element: move.type,
    effect,
    motif: ELEMENT_MOTIFS[move.type],
    result,
    // Strength changes scale, never duplicates the recipe or particle budget.
    intensity: Math.min(1, Math.max(0.65, 0.65 + Math.max(0, move.power) / 600
      + (outcome.crit ? 0.07 : 0) + (effectiveness >= 2 ? 0.05 : 0)
      + (outcome.star ? 0.1 : 0) - (effectiveness > 0 && effectiveness < 1 ? 0.08 : 0))),
  }
}
