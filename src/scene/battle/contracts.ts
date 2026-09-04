import type { Side } from '@/game/battle/reducer'
import type { BattleMobie } from '@/game/types'
import type { ResolvedTerrainWorld } from '@/scene/r3f/terrainVisual'
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

export type NormalAttackPhase = 'anticipate' | 'contact' | 'hit-react' | 'recover'
export type BattleCameraShot = 'wide' | 'caster' | 'impact'

export interface NormalAttackCue {
  cueId: string
  owner: string
  caster: Side
  target: Side
  didHit: boolean
  phase: NormalAttackPhase
}

export interface BattleSceneDiagnostics {
  cameraShot: BattleCameraShot
  cameraOwner: string | null
  motionPhase: NormalAttackPhase | 'idle'
  artworkMode: Record<Side, 'artwork' | 'silhouette'>
  anchors: Record<Side, Record<BattleAnchorKind, BattleScreenPoint>> | null
}

export interface BattleSceneSnapshot {
  player: BattleMobie
  foe: BattleMobie
  terrainWorld: ResolvedTerrainWorld
  terrainVisualIntensity: number
  outcome: 'player' | 'foe' | null
}

export interface BattleSceneHandle {
  normalAttack(cue: NormalAttackCue): void
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
  paused: boolean
  reducedMotion: boolean
  onReady(): void
  onFatal(reason: RendererFallbackReason): void
  onRenderedFrame?: (at: number) => void
  onRendererDiagnostics?: (diagnostics: RendererDiagnostics) => void
  onSceneDiagnostics?: (diagnostics: BattleSceneDiagnostics) => void
  /** DEV/test-only typed renderer failure. Production callers omit it. */
  devShaderFailure?: boolean
}
