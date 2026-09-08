import type { Side } from '@/game/battle/reducer'
import type { BattleMobie } from '@/game/types'
import type { ResolvedTerrainWorld } from '@/scene/r3f/terrainVisual'
import type { ArtworkCacheDiagnostics } from '@/scene/r3f/artworkResourceCache'
import type { VfxCue } from '@/scene/r3f/vfxRuntime'
import type {
  BattleAnchorKind,
  BattleScreenPoint,
  BattleViewport,
} from '@/presentation/battle/battleAnchors'
import type {
  EffectiveGraphicsTier,
  GraphicsQualityProfile,
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

export interface BattleVfxDiagnostics {
  activeParticles: number
  capacity: number
  emitted: number
  overwritten: number
  resets: number
  disposals: number
  shaderMode: 'procedural' | 'fallback'
}

export type NormalAttackPhase = 'anticipate' | 'travel' | 'contact' | 'hit-react' | 'recover'
export type BattleCameraShot = 'wide' | 'caster' | 'impact'

export interface NormalAttackCue {
  cueId: string
  owner: string
  caster: Side
  target: Side
  didHit: boolean
  phase: NormalAttackPhase
  delivery?: 'contact' | 'projectile'
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
  vfxIntensity?: number
  outcome: 'player' | 'foe' | null
}

export interface BattleSceneHandle {
  /** Returns true only when the world runtime accepted this committed cue. */
  tracer?(cue: VfxCue): boolean
  normalAttack(cue: NormalAttackCue): void
  lunge(side: Side): void
  hitReact(side: Side, strength?: number): void
  /** Withdraw without a faint result or sound; remain absent until enter. */
  recall?(side: Side): void
  /** Camera-only framing of the empty entry anchor; compatibility keeps its static view. */
  frameEntry?(side: Side, cueId: string, owner: string): void
  faint(side: Side): void
  enter(side: Side): void
  setTimeScale(scale: number): void
  resetPresentation(options?: { keepRecall?: boolean }): void
  projectAnchor(side: Side, anchor: BattleAnchorKind, viewport: BattleViewport): BattleScreenPoint
}

export interface NextBattleSceneProps {
  snapshot: BattleSceneSnapshot
  tier: NextGraphicsTier
  quality: GraphicsQualityProfile
  /** True only for rendered frames that belong to an active presentation/QTE. */
  active: boolean
  paused: boolean
  reducedMotion: boolean
  onReady(): void
  onFatal(reason: RendererFallbackReason): void
  onRenderedFrame?: (at: number, active: boolean) => void
  onRendererDiagnostics?: (diagnostics: RendererDiagnostics) => void
  onVfxDiagnostics?: (diagnostics: BattleVfxDiagnostics) => void
  onArtworkCacheDiagnostics?: (diagnostics: ArtworkCacheDiagnostics) => void
  onSceneDiagnostics?: (diagnostics: BattleSceneDiagnostics) => void
}
