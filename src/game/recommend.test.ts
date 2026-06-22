import { describe, it, expect } from 'vitest'
import { scoreCardVsFoes, recommendTeamIds } from './recommend'
import { mon, move } from './battle/testFixtures'

describe('scoreCardVsFoes — 依對手整隊評分', () => {
  it('剋制對手越多、評分越高', () => {
    // 對手全是草系；水招(對草 0.5)不利，火招(對草 2)剋制
    const foes = [mon({ types: ['grass'] }), mon({ types: ['grass'] }), mon({ types: ['grass'] })]
    const fireMon = mon({ move: move('fire'), types: ['fire'] })
    const waterMon = mon({ move: move('water'), types: ['water'] })

    const fire = scoreCardVsFoes(fireMon, foes)
    const water = scoreCardVsFoes(waterMon, foes)

    expect(fire.counters).toBe(3) // 火剋三隻草
    expect(water.counters).toBe(0)
    expect(fire.score).toBeGreaterThan(water.score)
  })

  it('被對手招式痛擊會計入 weakTo', () => {
    // 對手用地面招；我方電系(對地面被 2 倍)會被痛擊
    const foes = [mon({ move: move('ground') }), mon({ move: move('ground') })]
    const electric = mon({ types: ['electric'], move: move('electric') })
    const m = scoreCardVsFoes(electric, foes)
    expect(m.weakTo).toBe(2)
  })
})

describe('recommendTeamIds — 一鍵推薦最佳陣容', () => {
  it('挑出對該對手最剋制的前 N 隻', () => {
    const foes = [mon({ types: ['grass'] }), mon({ types: ['grass'] })]
    const entries = [
      { id: 'fire', mon: mon({ types: ['fire'], move: move('fire') }) }, // 剋草
      { id: 'ice', mon: mon({ types: ['ice'], move: move('ice') }) }, // 剋草
      { id: 'water', mon: mon({ types: ['water'], move: move('water') }) }, // 不利
      { id: 'normal', mon: mon({ types: ['normal'], move: move('normal') }) }, // 普通
    ]
    const rec = recommendTeamIds(entries, foes, 2)
    expect(rec).toHaveLength(2)
    expect(rec).toContain('fire')
    expect(rec).toContain('ice')
    expect(rec).not.toContain('water')
  })
})
