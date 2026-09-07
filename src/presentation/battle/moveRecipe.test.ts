import { MOVES } from '@/game/data/moves'
import type { MoveCategory, Move } from '@/game/types'
import { VfxRuntime, type VfxCue } from '@/scene/r3f/vfxRuntime'
import { ELEMENT_MOTIFS, resolveMoveRecipe } from './moveRecipe'

describe('generated move presentation totality', () => {
  it('executes every generated move and every element/category default in the bounded runtime', () => {
    const runtime = new VfxRuntime()
    const categories: MoveCategory[] = ['physical', 'special', 'status']
    const defaults = Object.keys(ELEMENT_MOTIFS).flatMap((type) => categories.map((category): Move => ({
      id: -1, name: 'default', nameZh: '預設', power: 70, accuracy: 100,
      type: type as Move['type'], category,
    })))
    for (const move of [...Object.values(MOVES), ...defaults]) {
      const before = JSON.stringify(move)
      const presentation = resolveMoveRecipe(move)
      expect(presentation.delivery).toBeTruthy()
      expect(presentation.motif).toBeGreaterThanOrEqual(0)
      expect(presentation.motif).toBeLessThan(18)
      expect(presentation.intensity).toBeGreaterThanOrEqual(0.65)
      expect(presentation.intensity).toBeLessThanOrEqual(1)
      runtime.reset()
      const cue: VfxCue = {
        cueId: String(move.id), owner: 'totality', caster: 'player', target: 'foe',
        recipe: move.category === 'status' ? 'status' : move.category === 'physical' ? 'physical' : 'electric',
        presentation, phase: 'cast', didHit: true,
      }
      const emittedBefore = runtime.diagnostics().emitted
      runtime.cue(cue, { tier: 'balanced', intensity: 1 })
      for (let i = 0; i < 6; i++) runtime.step(0.05, 1)
      runtime.cue({ ...cue, phase: 'impact' }, { tier: 'balanced', intensity: 1 })
      expect(runtime.diagnostics().emitted).toBeGreaterThan(emittedBefore)
      expect(runtime.diagnostics().activeParticles).toBeLessThanOrEqual(runtime.diagnostics().capacity)
      expect(JSON.stringify(move)).toBe(before)
    }
  })

  it('keeps result precedence and particle budgets bounded; misses cannot emit impact', () => {
    const move = MOVES[1010]
    const runtime = new VfxRuntime()
    const emit = (outcome: Parameters<typeof resolveMoveRecipe>[1], didHit: boolean) => {
      runtime.reset()
      const before = runtime.diagnostics().emitted
      const presentation = resolveMoveRecipe(move, outcome)
      const cue: VfxCue = { cueId: 'outcome', owner: 'test', caster: 'player', target: 'foe',
        recipe: 'electric', phase: 'impact', presentation, didHit }
      runtime.cue(cue, { tier: 'balanced', intensity: 1 })
      const count = runtime.diagnostics().emitted - before
      runtime.cue(cue, { tier: 'balanced', intensity: 1 })
      expect(runtime.diagnostics().emitted - before).toBe(count)
      return { count, presentation }
    }
    const normal = emit({}, true)
    for (const outcome of [{ crit: true }, { effectiveness: 2 }, { star: true }]) {
      const result = emit(outcome, true)
      expect(result.count).toBeLessThanOrEqual(normal.count)
      expect(result.presentation.delivery).toBe(normal.presentation.delivery)
    }
    expect(emit({ missed: true, crit: true, effectiveness: 0 }, false)).toMatchObject({
      count: 0, presentation: { result: 'miss' },
    })
    const immune = emit({ effectiveness: 0, crit: true }, false)
    expect(immune.presentation.result).toBe('immune')
    expect(immune.count).toBeGreaterThan(0)
    expect(resolveMoveRecipe(move, { effectiveness: 0.5 }).result).toBe('resisted')
    expect(resolveMoveRecipe({ ...move, category: 'status', effect: { kind: 'buff', mult: 0.8, label: '弱化' } }).effect).toBe('debuff')
  })
})
