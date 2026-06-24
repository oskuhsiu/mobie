import { describe, expect, it } from 'vitest'
import { getFxImpactDelayMs, resolveFx, typePalette, playMoveFx } from './fxCatalog'
import type { Move } from '@/game/types'
import type { FxHandle } from './FxCanvas'

const move = (id: number, type: Move['type'], category: Move['category']): Move => ({
  id,
  name: `m${id}`,
  nameZh: `招式${id}`,
  type,
  category,
  power: category === 'status' ? 0 : 70,
  accuracy: 100,
  effect: category === 'status' ? { kind: 'buff', stat: 'atk', mult: 1.5, duration: 4, label: '提升' } : undefined,
})

describe('fxCatalog', () => {
  it('resolves every type to a colored recipe', () => {
    for (const [type, palette] of Object.entries(typePalette)) {
      const fx = resolveFx(move(1000, type as Move['type'], 'physical'))
      expect(fx.color).toBe(palette.color)
      expect(['dot', 'streak', 'shard']).toContain(fx.shape)
      expect(fx.mode).toBe('impact')
    }
  })

  it('uses category delivery without needing per-move presets', () => {
    expect(resolveFx(move(1011, 'fire', 'special')).mode).toBe('travel')
    expect(resolveFx(move(1062, 'fighting', 'physical')).mode).toBe('impact')
    expect(resolveFx(move(2002, 'psychic', 'status')).mode).toBe('aura')
  })

  it('plays travel for special moves and aura at the caster for status moves', () => {
    const calls: string[] = []
    const fx: FxHandle = {
      burst: (o) => calls.push(`burst:${o.nx}:${o.ny}:${o.shape ?? 'dot'}`),
      ring: (o) => calls.push(`ring:${o.nx}:${o.ny}`),
      flash: () => calls.push('flash'),
      travel: (o) => calls.push(`travel:${o.from.nx}:${o.to.nx}:${o.onArrive}:${o.count}`),
    }
    const travelDelay = playMoveFx(fx, resolveFx(move(1021, 'water', 'special')), { nx: 0.2, ny: 0.6 }, { nx: 0.8, ny: 0.2 })
    playMoveFx(fx, resolveFx(move(2000, 'normal', 'status')), { nx: 0.2, ny: 0.6 }, { nx: 0.8, ny: 0.2 })
    expect(travelDelay).toBe(getFxImpactDelayMs(resolveFx(move(1021, 'water', 'special'))))
    expect(travelDelay).toBeGreaterThan(300)
    expect(calls).toContain('travel:0.2:0.8:burst-ring:20')
    expect(calls).toContain('burst:0.2:0.6:dot')
  })
})
