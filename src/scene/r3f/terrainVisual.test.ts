import { describe, expect, it } from 'vitest'
import { TERRAINS } from '@/game/data/terrains'
import {
  TERRAIN_PALETTES,
  resolveTerrainPalette,
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
