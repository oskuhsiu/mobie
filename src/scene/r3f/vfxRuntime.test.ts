import { describe, expect, it } from 'vitest'
import { VFX_PARTICLE_CAPACITY, VfxRuntime, type VfxCue } from './vfxRuntime'

const cue = (phase: VfxCue['phase'], overrides: Partial<VfxCue> = {}): VfxCue => ({
  cueId: 'cue-1',
  owner: 'battle-director',
  caster: 'player',
  target: 'foe',
  recipe: 'electric',
  phase,
  didHit: true,
  ...overrides,
})

describe('VfxRuntime', () => {
  it('emits every owned phase exactly once and suppresses a missed impact', () => {
    const runtime = new VfxRuntime()
    const options = { tier: 'balanced' as const, intensity: 1 }
    runtime.cue(cue('anticipate'), options)
    runtime.cue(cue('cast'), options)
    runtime.cue(cue('cast'), options)
    for (let frame = 0; frame < 17; frame += 1) runtime.step(1 / 60, 1)
    runtime.cue(cue('impact', { didHit: false }), options)
    runtime.cue(cue('recover'), options)
    expect(runtime.diagnostics()).toMatchObject({ activeParticles: 22, emitted: 22, overwritten: 0 })
  })

  it('clamps virtual seconds and resets the bounded ring deterministically', () => {
    const runtime = new VfxRuntime()
    const options = { tier: 'high' as const, intensity: 1 }
    for (let index = 0; index < 20; index += 1) {
      runtime.cue(cue('impact', { cueId: `cue-${index}`, recipe: 'physical' }), options)
    }
    expect(runtime.diagnostics()).toMatchObject({
      activeParticles: VFX_PARTICLE_CAPACITY,
      capacity: VFX_PARTICLE_CAPACITY,
      overwritten: 352,
    })
    expect(runtime.step(2, 1)).toBe(0.05)
    runtime.reset()
    expect(runtime.diagnostics()).toMatchObject({ activeParticles: 0, resets: 1 })
  })

  it('emits equal electric trails at 60 and 120Hz within one-frame timing', () => {
    const run = (hz: number) => {
      const runtime = new VfxRuntime()
      runtime.cue(cue('cast'), { tier: 'balanced', intensity: 1 })
      for (let frame = 0; frame < Math.ceil(0.28 * hz); frame += 1) runtime.step(1 / hz, 1)
      const timestamps = Array.from(runtime.spawnTime)
        .filter((_, index) => runtime.active[index] === 1 && runtime.stage[index] === 1)
      for (let frame = Math.ceil(0.28 * hz); frame < hz; frame += 1) runtime.step(1 / hz, 1)
      return { timestamps, remaining: runtime.diagnostics().activeParticles }
    }
    const at60 = run(60)
    const at120 = run(120)
    expect(at60.timestamps).toHaveLength(14)
    expect(at120.timestamps).toHaveLength(14)
    at60.timestamps.forEach((timestamp, index) => {
      expect(Math.abs(timestamp - (at120.timestamps[index] ?? 0))).toBeLessThanOrEqual(1 / 60)
    })
    expect(at60.remaining).toBe(0)
    expect(at120.remaining).toBe(0)
  })
})
