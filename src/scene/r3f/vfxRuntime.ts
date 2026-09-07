import type { MoveRecipe } from '@/presentation/battle/moveRecipe'
import type { Side } from '@/game/battle/reducer'

export type VfxRecipe = 'physical' | 'electric' | 'status'
export type VfxPhase = 'anticipate' | 'cast' | 'impact' | 'recover'

export interface VfxCue {
  cueId: string
  owner: string
  caster: Side
  target: Side
  recipe: VfxRecipe
  presentation?: MoveRecipe
  phase: VfxPhase
  didHit: boolean
}

export interface VfxRuntimeDiagnostics {
  activeParticles: number
  capacity: number
  emitted: number
  overwritten: number
  resets: number
  disposals: number
}

export interface VfxCueOptions {
  tier: 'balanced' | 'high'
  intensity: number
  seed?: number
}

export interface VfxLabControls {
  frozen: boolean
  seed: number
  tier: 'balanced' | 'high' | null
  reducedMotion: boolean | null
  intensity: number | null
  forceFallback: boolean
}

export const VFX_PARTICLE_CAPACITY = 128
const CUE_CAPACITY = 12
const MAX_DELTA_SECONDS = 0.05
const ELECTRIC_CAST_SECONDS = 0.28

const RECIPE_CODE: Record<VfxRecipe, number> = { physical: 0, electric: 1, status: 2 }
const DELIVERY_CODE = { contact: 1, projectile: 2, beam: 3, ground: 4, aura: 5 } as const
const EFFECT_CODE = { damage: 0, heal: 1, buff: 2, debuff: 3, terrain: 4 } as const
const PHASE_CODE: Record<VfxPhase, number> = { anticipate: 0, cast: 1, impact: 2, recover: 3 }

function hash(text: string): number {
  let value = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index)
    value = Math.imul(value, 16777619)
  }
  return value >>> 0
}

function random01(seed: number): number {
  let value = seed + 0x6d2b79f5
  value = Math.imul(value ^ (value >>> 15), value | 1)
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296
}

/**
 * Allocation-free hot-path state for BattleVfx. Public typed arrays are read by
 * the R3F view once per frame; callers only mutate the runtime through cue/step.
 */
export class VfxRuntime {
  readonly presentation = new Float32Array(VFX_PARTICLE_CAPACITY * 4)
  private readonly cuePresentation: (MoveRecipe | undefined)[] = Array(CUE_CAPACITY).fill(undefined)
  readonly active = new Uint8Array(VFX_PARTICLE_CAPACITY)
  readonly recipe = new Uint8Array(VFX_PARTICLE_CAPACITY)
  readonly stage = new Uint8Array(VFX_PARTICLE_CAPACITY)
  readonly caster = new Uint8Array(VFX_PARTICLE_CAPACITY)
  readonly target = new Uint8Array(VFX_PARTICLE_CAPACITY)
  readonly age = new Float32Array(VFX_PARTICLE_CAPACITY)
  readonly spawnTime = new Float32Array(VFX_PARTICLE_CAPACITY)
  readonly lifetime = new Float32Array(VFX_PARTICLE_CAPACITY)
  readonly angle = new Float32Array(VFX_PARTICLE_CAPACITY)
  readonly radius = new Float32Array(VFX_PARTICLE_CAPACITY)
  readonly variance = new Float32Array(VFX_PARTICLE_CAPACITY)
  readonly size = new Float32Array(VFX_PARTICLE_CAPACITY)

  private readonly cueIds = Array<string>(CUE_CAPACITY).fill('')
  private readonly owners = Array<string>(CUE_CAPACITY).fill('')
  private readonly cueRecipe = new Uint8Array(CUE_CAPACITY)
  private readonly cueCaster = new Uint8Array(CUE_CAPACITY)
  private readonly cueTarget = new Uint8Array(CUE_CAPACITY)
  private readonly cuePhaseMask = new Uint8Array(CUE_CAPACITY)
  private readonly emitterActive = new Uint8Array(CUE_CAPACITY)
  private readonly emitterElapsed = new Float32Array(CUE_CAPACITY)
  private readonly emitterAccumulator = new Float32Array(CUE_CAPACITY)
  private readonly emitterRate = new Float32Array(CUE_CAPACITY)
  private readonly emitterSeed = new Uint32Array(CUE_CAPACITY)
  private readonly emitterOrdinal = new Uint16Array(CUE_CAPACITY)
  private readonly emitterStartedAt = new Float32Array(CUE_CAPACITY)
  private particleCursor = 0
  private cueCursor = 0
  private activeCount = 0
  private emitted = 0
  private overwritten = 0
  private resets = 0
  private disposals = 0
  private time = 0
  private revision = 0

  get elapsed(): number {
    return this.time
  }

  get spawnRevision(): number {
    return this.revision
  }

  cue(cue: VfxCue, options: VfxCueOptions): void {
    const slot = this.findOrAcquireCue(cue)
    const phaseBit = 1 << PHASE_CODE[cue.phase]
    if ((this.cuePhaseMask[slot] & phaseBit) !== 0) return
    if (
      this.cueRecipe[slot] !== RECIPE_CODE[cue.recipe]
      || this.cueCaster[slot] !== sideCode(cue.caster)
      || this.cueTarget[slot] !== sideCode(cue.target)
    ) return
    this.cuePhaseMask[slot] |= phaseBit

    if (cue.phase === 'recover') {
      this.emitterActive[slot] = 0
      return
    }
    if (cue.phase === 'impact') this.emitterActive[slot] = 0
    if (cue.phase === 'impact' && (cue.presentation?.result === 'miss' || (!cue.didHit && cue.presentation?.result !== 'immune'))) return

    if ((cue.presentation ? cue.presentation.delivery === 'projectile' : cue.recipe === 'electric') && cue.phase === 'cast') {
      const intensity = clamp01(options.intensity)
      this.emitterActive[slot] = intensity > 0 ? 1 : 0
      this.emitterElapsed[slot] = 0
      this.emitterAccumulator[slot] = 0
      this.emitterRate[slot] = (options.tier === 'high' ? 100 : 50) * intensity
      this.emitterSeed[slot] = hash(`${cue.cueId}:${cue.owner}:${cue.recipe}:${cue.phase}:${options.seed ?? 0}`)
      this.emitterOrdinal[slot] = 0
      this.emitterStartedAt[slot] = this.time
      return
    }

    const baseCount = cue.presentation
      ? (cue.phase === 'impact' ? 12 : 8) * (options.tier === 'high' ? 2 : 1)
      : particleCount(cue.recipe, cue.phase, options.tier)
    const count = Math.min(baseCount, Math.floor(baseCount * clamp01(options.intensity)))
    const cueSeed = hash(`${cue.cueId}:${cue.owner}:${cue.recipe}:${cue.phase}:${options.seed ?? 0}`)
    for (let index = 0; index < count; index += 1) {
      this.emit(cue, cueSeed, index)
    }
  }

  step(rawDeltaSeconds: number, timeScale: number): number {
    const delta = Math.min(
      MAX_DELTA_SECONDS,
      Math.max(0, Number.isFinite(rawDeltaSeconds) ? rawDeltaSeconds : 0)
        * Math.max(0, Number.isFinite(timeScale) ? timeScale : 0),
    )
    this.time += delta
    for (let index = 0; index < VFX_PARTICLE_CAPACITY; index += 1) {
      if (this.active[index] === 0) continue
      this.age[index] = this.time - this.spawnTime[index]
      if (this.age[index] >= this.lifetime[index]) {
        this.active[index] = 0
        this.activeCount -= 1
      }
    }
    for (let slot = 0; slot < CUE_CAPACITY; slot += 1) {
      if (this.emitterActive[slot] === 0) continue
      const previousElapsed = this.emitterElapsed[slot]
      const slice = Math.min(delta, Math.max(0, ELECTRIC_CAST_SECONDS - previousElapsed))
      this.emitterElapsed[slot] = previousElapsed + slice
      this.emitterAccumulator[slot] += slice * this.emitterRate[slot]
      const emitCount = Math.floor(this.emitterAccumulator[slot] + 1e-4)
      this.emitterAccumulator[slot] -= emitCount
      for (let index = 0; index < emitCount; index += 1) this.emitElectricTrail(slot)
      if (this.emitterElapsed[slot] >= ELECTRIC_CAST_SECONDS - 1e-6) this.emitterActive[slot] = 0
    }
    return delta
  }

  reset(): void {
    this.active.fill(0)
    this.age.fill(0)
    this.cueIds.fill('')
    this.owners.fill('')
    this.cuePhaseMask.fill(0)
    this.emitterActive.fill(0)
    this.emitterElapsed.fill(0)
    this.emitterAccumulator.fill(0)
    this.particleCursor = 0
    this.cueCursor = 0
    this.activeCount = 0
    this.time = 0
    this.revision += 1
    this.resets += 1
  }

  dispose(): void {
    this.reset()
    this.disposals += 1
  }

  diagnostics(): VfxRuntimeDiagnostics {
    return {
      activeParticles: this.activeCount,
      capacity: VFX_PARTICLE_CAPACITY,
      emitted: this.emitted,
      overwritten: this.overwritten,
      resets: this.resets,
      disposals: this.disposals,
    }
  }

  private findOrAcquireCue(cue: VfxCue): number {
    for (let index = 0; index < CUE_CAPACITY; index += 1) {
      if (this.cueIds[index] === cue.cueId && this.owners[index] === cue.owner) return index
    }
    const slot = this.cueCursor
    this.cueCursor = (this.cueCursor + 1) % CUE_CAPACITY
    this.cueIds[slot] = cue.cueId
    this.owners[slot] = cue.owner
    this.cueRecipe[slot] = RECIPE_CODE[cue.recipe]
    this.cuePresentation[slot] = cue.presentation ? { ...cue.presentation } : undefined
    this.cueCaster[slot] = sideCode(cue.caster)
    this.cueTarget[slot] = sideCode(cue.target)
    this.cuePhaseMask[slot] = 0
    this.emitterActive[slot] = 0
    return slot
  }

  private emit(cue: VfxCue, cueSeed: number, ordinal: number): void {
    const slot = this.particleCursor
    this.particleCursor = (this.particleCursor + 1) % VFX_PARTICLE_CAPACITY
    if (this.active[slot] !== 0) this.overwritten += 1
    else this.activeCount += 1

    const a = random01(cueSeed + ordinal * 3)
    const b = random01(cueSeed + ordinal * 3 + 1)
    const c = random01(cueSeed + ordinal * 3 + 2)
    this.active[slot] = 1
    this.recipe[slot] = RECIPE_CODE[cue.recipe]
    this.stage[slot] = PHASE_CODE[cue.phase]
    this.caster[slot] = sideCode(cue.caster)
    this.target[slot] = sideCode(cue.target)
    this.age[slot] = 0
    this.spawnTime[slot] = this.time
    this.lifetime[slot] = lifetime(cue.recipe, cue.phase, c)
    this.angle[slot] = a * Math.PI * 2
    this.radius[slot] = 0.25 + b * 0.75
    this.variance[slot] = c
    this.size[slot] = particleSize(cue.recipe, cue.phase, b)
    this.applyPresentation(slot, cue.presentation)
    this.emitted += 1
    this.revision += 1
  }

  private emitElectricTrail(cueSlot: number): void {
    const slot = this.particleCursor
    this.particleCursor = (this.particleCursor + 1) % VFX_PARTICLE_CAPACITY
    if (this.active[slot] !== 0) this.overwritten += 1
    else this.activeCount += 1

    const ordinal = this.emitterOrdinal[cueSlot]
    const seed = this.emitterSeed[cueSlot]
    const a = random01(seed + ordinal * 3)
    const b = random01(seed + ordinal * 3 + 1)
    const emittedAt = this.emitterStartedAt[cueSlot] + (ordinal + 1) / this.emitterRate[cueSlot]
    this.active[slot] = 1
    this.recipe[slot] = RECIPE_CODE.electric
    this.stage[slot] = PHASE_CODE.cast
    this.caster[slot] = this.cueCaster[cueSlot]
    this.target[slot] = this.cueTarget[cueSlot]
    this.spawnTime[slot] = emittedAt
    this.age[slot] = Math.max(0, this.time - emittedAt)
    this.lifetime[slot] = 0.48 + b * 0.12
    this.angle[slot] = a * Math.PI * 2
    this.radius[slot] = 0.25 + b * 0.75
    this.variance[slot] = Math.min(1, (emittedAt - this.emitterStartedAt[cueSlot]) / ELECTRIC_CAST_SECONDS)
    this.size[slot] = 18 + b * 11
    this.applyPresentation(slot, this.cuePresentation[cueSlot])
    this.emitterOrdinal[cueSlot] = ordinal + 1
    this.emitted += 1
    this.revision += 1
  }
  private applyPresentation(slot: number, presentation: MoveRecipe | undefined): void {
    const offset = slot * 4
    this.presentation[offset] = presentation ? DELIVERY_CODE[presentation.delivery] : 0
    this.presentation[offset + 1] = presentation?.motif ?? 0
    this.presentation[offset + 2] = presentation ? EFFECT_CODE[presentation.effect] : 0
    this.presentation[offset + 3] = presentation?.result === 'immune' ? 1 : presentation?.result === 'miss' ? 2 : 0
    if (presentation) {
      const strength = Math.max(0.65, clamp01(presentation.intensity))
      this.size[slot] *= strength * 3
      this.lifetime[slot] *= 0.8 + strength * 0.2
    }
  }
}

function sideCode(side: Side): number {
  return side === 'player' ? 0 : 1
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
}

function particleCount(recipe: VfxRecipe, phase: VfxPhase, tier: 'balanced' | 'high'): number {
  const multiplier = tier === 'high' ? 2 : 1
  if (phase === 'recover') return 0
  if (recipe === 'physical') return (phase === 'impact' ? 12 : 6) * multiplier
  if (recipe === 'electric') return (phase === 'cast' ? 0 : 8) * multiplier
  return (phase === 'cast' ? 12 : 7) * multiplier
}

function lifetime(recipe: VfxRecipe, phase: VfxPhase, variance: number): number {
  if (recipe === 'status') return phase === 'cast' ? 0.95 + variance * 0.25 : 0.55
  if (recipe === 'electric' && phase === 'cast') return 0.48 + variance * 0.12
  if (phase === 'impact') return 0.3 + variance * 0.18
  return 0.42 + variance * 0.14
}

function particleSize(recipe: VfxRecipe, phase: VfxPhase, variance: number): number {
  if (recipe === 'physical') return (phase === 'impact' ? 22 : 15) + variance * 10
  if (recipe === 'electric') return 18 + variance * 11
  return 20 + variance * 13
}
