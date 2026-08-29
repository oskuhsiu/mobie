import type { Side } from '@/game/battle/reducer'
import type { BattleMobie } from '@/game/types'
import type { TerrainPalette } from '@/scene/r3f/terrainVisual'
import type {
  BattleAnchorKind,
  BattleScreenPoint,
  BattleViewport,
} from '@/presentation/battle/battleAnchors'
import type {
  EffectiveGraphicsTier,
  RendererFallbackReason,
} from '@/presentation/battle/rendering'

export type NextGraphicsTier = Exclude<EffectiveGraphicsTier, 'compatibility'>
export interface RendererDiagnostics {
  geometries: number
  textures: number
  programs: number
  triangles: number
  drawCalls: number
}

export interface BattleSceneSnapshot {
  player: BattleMobie
  foe: BattleMobie
  palette?: TerrainPalette
  outcome: 'player' | 'foe' | null
}

export interface BattleSceneHandle {
  lunge(side: Side): void
  hitReact(side: Side, strength?: number): void
  faint(side: Side): void
  enter(side: Side): void
  setTimeScale(scale: number): void
  resetPresentation(): void
  projectAnchor(side: Side, anchor: BattleAnchorKind, viewport: BattleViewport): BattleScreenPoint
}

export interface NextBattleSceneProps {
  snapshot: BattleSceneSnapshot
  tier: NextGraphicsTier
  onReady(): void
  onFatal(reason: RendererFallbackReason): void
  onRenderedFrame?: (at: number) => void
  onRendererDiagnostics?: (diagnostics: RendererDiagnostics) => void
  /** DEV/test-only typed renderer failure. Production callers omit it. */
  devShaderFailure?: boolean
}
