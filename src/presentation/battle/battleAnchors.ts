import type { Side } from '@/game/battle/reducer'

export type BattleAnchorKind = 'root' | 'center' | 'head' | 'ground' | 'cast' | 'impact'
export interface NormalizedBattlePoint { nx: number; ny: number }
export interface BattleViewport { width: number; height: number }
export interface BattleScreenPoint { x: number; y: number }

const LEGACY_ANCHORS: Record<Side, Record<BattleAnchorKind, NormalizedBattlePoint>> = {
  player: {
    root: { nx: 0.3, ny: 0.74 },
    center: { nx: 0.3, ny: 0.62 },
    head: { nx: 0.3, ny: 0.48 },
    ground: { nx: 0.3, ny: 0.79 },
    cast: { nx: 0.43, ny: 0.56 },
    impact: { nx: 0.3, ny: 0.62 },
  },
  foe: {
    root: { nx: 0.7, ny: 0.3 },
    center: { nx: 0.7, ny: 0.34 },
    head: { nx: 0.7, ny: 0.2 },
    ground: { nx: 0.7, ny: 0.44 },
    cast: { nx: 0.57, ny: 0.42 },
    impact: { nx: 0.72, ny: 0.22 },
  },
}

export function normalizedBattleAnchor(side: Side, anchor: BattleAnchorKind): NormalizedBattlePoint {
  return { ...LEGACY_ANCHORS[side][anchor] }
}

export function projectBattleAnchor(
  side: Side,
  anchor: BattleAnchorKind,
  viewport: BattleViewport,
): BattleScreenPoint {
  const point = LEGACY_ANCHORS[side][anchor]
  return {
    x: point.nx * Math.max(0, viewport.width),
    y: point.ny * Math.max(0, viewport.height),
  }
}
