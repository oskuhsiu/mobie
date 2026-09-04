import { describe, expect, it } from 'vitest'
import { TERRAINS } from '@/game/data/terrains'
import {
  TERRAIN_ARCHETYPES,
  TERRAIN_PALETTES,
  TERRAIN_WORLD_TRANSITION_MS,
  resolveTerrainPalette,
  resolveTerrainWorld,
  type TerrainArchetype,
  type WeatherEmitter,
} from './terrainVisual'

const HEX = /^#[0-9a-f]{6}$/
const EMITTERS: WeatherEmitter[] = ['rain', 'snow', 'sand', 'ember', 'electric', 'wind-petal', 'mist', 'none']

describe('terrainVisual palette 表', () => {
  it('每個 TerrainId（含 data/terrains 全清單）都有 palette', () => {
    for (const t of TERRAINS) {
      expect(TERRAIN_PALETTES[t.id], `缺 ${t.id}`).toBeDefined()
    }
  })

  it('所有 palette 顏色都是合法 6 位 hex、emitter 都在 8 原型內', () => {
    for (const [id, p] of Object.entries(TERRAIN_PALETTES)) {
      expect(p.groundTint, id).toMatch(HEX)
      expect(p.ambient, id).toMatch(HEX)
      expect(p.particleColor, id).toMatch(HEX)
      expect(EMITTERS, id).toContain(p.emitter)
      if (p.fog) expect(p.fog.color, id).toMatch(HEX)
      if (p.fog) expect(p.fog.far, id).toBeGreaterThan(p.fog.near)
      if (p.sparkAccent) expect(p.sparkAccent, id).toMatch(HEX)
    }
  })

  it('neutral palette ＝ M22 基線（對齊 sceneParts hardcode），且 emitter=none', () => {
    const n = TERRAIN_PALETTES.neutral
    expect(n.groundTint).toBe('#0a0e22') // ArenaFloor 原色
    expect(n.ambient).toBe('#bcd0ff') // hemisphereLight 原 sky 色
    expect(n.emitter).toBe('none')
    expect(n.fog).toBeUndefined()
  })

  it('對照表 LOCKED：抽樣關鍵歸屬正確', () => {
    expect(TERRAIN_PALETTES.rain.emitter).toBe('rain')
    expect(TERRAIN_PALETTES.coastal.emitter).toBe('rain')
    expect(TERRAIN_PALETTES.volcanic.emitter).toBe('ember')
    expect(TERRAIN_PALETTES['dragons-peak'].emitter).toBe('ember')
    expect(TERRAIN_PALETTES.stormfield.emitter).toBe('electric')
    expect(TERRAIN_PALETTES.grassland.emitter).toBe('wind-petal')
    expect(TERRAIN_PALETTES.haunt.emitter).toBe('mist')
  })

  it('sunny＝none emitter + god-ray overlay（不新增第 9 原型）', () => {
    expect(TERRAIN_PALETTES.sunny.emitter).toBe('none')
    expect(TERRAIN_PALETTES.sunny.overlay).toBe('godray')
  })

  it('psychic-field＝mist + sparkAccent（不歸 electric）', () => {
    expect(TERRAIN_PALETTES['psychic-field'].emitter).toBe('mist')
    expect(TERRAIN_PALETTES['psychic-field'].sparkAccent).toMatch(HEX)
  })

  it('23 種 terrain 完整映射到恰好 8 個程序化世界 archetype', () => {
    const used = new Set<TerrainArchetype>()

    for (const terrain of TERRAINS) {
      const visual = TERRAIN_PALETTES[terrain.id]
      expect(TERRAIN_ARCHETYPES, terrain.id).toContain(visual.archetype)
      expect(visual.horizonTint, terrain.id).toMatch(HEX)
      expect(visual.featureTint, terrain.id).toMatch(HEX)
      used.add(visual.archetype)
    }

    expect(TERRAINS).toHaveLength(23)
    expect(used).toEqual(new Set(TERRAIN_ARCHETYPES))
  })

  it('8 個 archetype 遵守 canonical terrain 分組', () => {
    const expected: Record<TerrainArchetype, string[]> = {
      arena: ['neutral'],
      meadow: ['grassland', 'flowerfield', 'strong-winds', 'grassy-field'],
      wetlands: ['coastal', 'rain', 'swamp'],
      volcanic: ['volcanic', 'steam'],
      cavern: ['cavern', 'sandstorm'],
      storm: ['stormfield', 'electric-field', 'dragons-peak'],
      spectral: ['haunt', 'mystic', 'psychic-field', 'misty-field', 'fog'],
      sanctuary: ['holy-ground', 'sunny', 'snowfield'],
    }

    for (const [archetype, ids] of Object.entries(expected)) {
      expect(ids.every((id) => TERRAIN_PALETTES[id as keyof typeof TERRAIN_PALETTES].archetype === archetype)).toBe(true)
    }
  })

  it('每種 terrain 的 archetype／palette／weather 視覺簽章皆可辨識', () => {
    const signatures = TERRAINS.map(({ id }) => {
      const visual = TERRAIN_PALETTES[id]
      return [
        visual.archetype,
        visual.groundTint,
        visual.horizonTint,
        visual.featureTint,
        visual.emitter,
        visual.particleColor,
      ].join(':')
    })

    expect(new Set(signatures).size).toBe(TERRAINS.length)
  })

  it('terrain world palette/weather 過場固定在規格的 300–500ms', () => {
    expect(TERRAIN_WORLD_TRANSITION_MS).toBeGreaterThanOrEqual(300)
    expect(TERRAIN_WORLD_TRANSITION_MS).toBeLessThanOrEqual(500)
  })
})

describe('resolveTerrainPalette', () => {
  it('空陣列 → neutral 基線', () => {
    expect(resolveTerrainPalette([])).toBe(TERRAIN_PALETTES.neutral)
  })

  it('全 neutral → neutral 基線', () => {
    expect(resolveTerrainPalette(['neutral'])).toBe(TERRAIN_PALETTES.neutral)
  })

  it('取第一個非 neutral 的 terrain', () => {
    expect(resolveTerrainPalette(['rain'])).toBe(TERRAIN_PALETTES.rain)
    expect(resolveTerrainPalette(['neutral', 'volcanic'])).toBe(TERRAIN_PALETTES.volcanic)
    // 混合地形：第一個非 neutral 勝出
    expect(resolveTerrainPalette(['haunt', 'rain'])).toBe(TERRAIN_PALETTES.haunt)
  })
})

describe('resolveTerrainWorld', () => {
  it('第一個非 neutral terrain 決定主世界', () => {
    expect(resolveTerrainWorld([]).primary).toBe(TERRAIN_PALETTES.neutral)
    expect(resolveTerrainWorld(['neutral', 'rain']).primary).toBe(TERRAIN_PALETTES.rain)
    expect(resolveTerrainWorld(['volcanic', 'rain']).primary).toBe(TERRAIN_PALETTES.volcanic)
  })

  it('複合 terrain 最多投影一個不含 weather emitter 的 secondary accent', () => {
    const world = resolveTerrainWorld(['neutral', 'rain', 'holy-ground', 'snowfield'])

    expect(world.primary).toBe(TERRAIN_PALETTES.rain)
    expect(world.secondaryAccent).toEqual({
      terrainId: 'holy-ground',
      archetype: TERRAIN_PALETTES['holy-ground'].archetype,
      color: TERRAIN_PALETTES['holy-ground'].featureTint,
    })
    expect(world.secondaryAccent).not.toHaveProperty('emitter')
  })

  it('忽略重複主 terrain 與 neutral，不製造多餘 accent', () => {
    expect(resolveTerrainWorld(['rain', 'neutral', 'rain']).secondaryAccent).toBeUndefined()
  })

  it('runtime unknown id 安全回 neutral，不留下空 world', () => {
    expect(resolveTerrainWorld(['unknown' as never])).toEqual({
      primaryId: 'neutral',
      primary: TERRAIN_PALETTES.neutral,
    })
  })
})
