import type { Move, MoveCategory, TypeName } from '@/game/types'
import { FX_TRAVEL_SPEED, type FxHandle, type FxShape } from '@/scene/fx/FxCanvas'

type FxMode = 'impact' | 'travel' | 'aura'

interface TypePalette {
  color: string
  accent: string
  shape: FxShape
}

interface ClassDelivery {
  mode: FxMode
  count: number
  power: number
  ring: boolean
  flashAlpha: number
}

export interface FxRecipe {
  mode: FxMode
  color: string
  accent: string
  shape: FxShape
  count: number
  power: number
  ring: boolean
  flashAlpha: number
}

export type FxPoint = { nx: number; ny: number }

type MoveFxOverride = Partial<Omit<FxRecipe, 'mode'>>
const FRAME_MS = 1000 / 60

export const typePalette: Record<TypeName, TypePalette> = {
  normal: { color: '#d5d8d4', accent: '#8f938f', shape: 'dot' },
  fire: { color: '#ff5a32', accent: '#ffd36a', shape: 'shard' },
  water: { color: '#48b6ff', accent: '#b9efff', shape: 'dot' },
  electric: { color: '#ffe14a', accent: '#ffffff', shape: 'streak' },
  grass: { color: '#58d24c', accent: '#c7ff9e', shape: 'shard' },
  ice: { color: '#92efff', accent: '#ffffff', shape: 'shard' },
  fighting: { color: '#ff9b3d', accent: '#ffe0a8', shape: 'streak' },
  poison: { color: '#b36aff', accent: '#f0c4ff', shape: 'dot' },
  ground: { color: '#d08b43', accent: '#f4d0a1', shape: 'shard' },
  flying: { color: '#9bd5ff', accent: '#ffffff', shape: 'streak' },
  psychic: { color: '#ff70a8', accent: '#ffd0e8', shape: 'dot' },
  bug: { color: '#afd22e', accent: '#efffa3', shape: 'shard' },
  rock: { color: '#c8bf85', accent: '#f3e8ba', shape: 'shard' },
  ghost: { color: '#8e5b9a', accent: '#d5b5ff', shape: 'dot' },
  dragon: { color: '#6b7cff', accent: '#c2c8ff', shape: 'streak' },
  dark: { color: '#71615e', accent: '#b7aaa7', shape: 'streak' },
  steel: { color: '#85c3d8', accent: '#e3f6ff', shape: 'shard' },
  fairy: { color: '#ff91f3', accent: '#ffe1ff', shape: 'dot' },
}

export const classDelivery: Record<MoveCategory, ClassDelivery> = {
  physical: { mode: 'impact', count: 18, power: 1.1, ring: false, flashAlpha: 0 },
  special: { mode: 'travel', count: 20, power: 1.15, ring: true, flashAlpha: 0.08 },
  status: { mode: 'aura', count: 16, power: 1, ring: true, flashAlpha: 0.06 },
}

export const moveFxOverrides: Record<number, MoveFxOverride> = {}

export function resolveFx(move: Move): FxRecipe {
  const palette = typePalette[move.type]
  const delivery = classDelivery[move.category]
  const override = moveFxOverrides[move.id] ?? {}
  return {
    mode: delivery.mode,
    color: palette.color,
    accent: palette.accent,
    shape: palette.shape,
    count: delivery.count,
    power: delivery.power,
    ring: delivery.ring,
    flashAlpha: delivery.flashAlpha,
    ...override,
  }
}

export function getFxImpactDelayMs(recipe: FxRecipe): number {
  return recipe.mode === 'travel' ? Math.ceil((1 / FX_TRAVEL_SPEED) + 1) * FRAME_MS : 0
}

export function playMoveFx(fx: FxHandle | null | undefined, recipe: FxRecipe, from: FxPoint, to: FxPoint): number {
  if (!fx) return 0
  if (recipe.mode === 'travel') {
    fx.travel({
      from,
      to,
      color: recipe.color,
      accent: recipe.accent,
      shape: recipe.shape,
      count: recipe.count,
      power: recipe.power,
      onArrive: recipe.ring ? 'burst-ring' : 'burst',
    })
  } else {
    const pos = recipe.mode === 'aura' ? from : to
    fx.burst({ ...pos, color: recipe.color, count: recipe.count, power: recipe.power, shape: recipe.shape })
    if (recipe.ring) fx.ring({ ...pos, color: recipe.accent })
  }
  if (recipe.flashAlpha > 0) fx.flash(recipe.color, recipe.flashAlpha)
  return getFxImpactDelayMs(recipe)
}
