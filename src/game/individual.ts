// 個體差異（M1.5e）：由 seed 決定論 roll 出 IV(0–31/項) + 性格(25 種) + 異色。
// owned 用 cardId 當 seed、野生用遭遇 cardId；同 seed → 同個體（可重播、不存中間態）。
// 不做 EV（見 plan/07）。

import type { Stats, NatureId } from '@/game/types'

export const IV_MAX = 31
export const IV_TOTAL_MAX = IV_MAX * 6 // 186
/** 異色機率（自用遊戲調高一點比較好玩） */
export const SHINY_RATE = 1 / 64

/** 性格影響的能力值順序（HP 不受性格影響）；nature 索引 = up*5 + down */
const NATURE_STATS: Array<keyof Stats> = ['atk', 'def', 'spe', 'spa', 'spd']

export interface Nature {
  id: NatureId
  nameZh: string
  /** 提升 ×1.1 的能力（null=無影響性格） */
  up: keyof Stats | null
  /** 下降 ×0.9 的能力 */
  down: keyof Stats | null
}

const NATURE_NAMES_ZH = [
  '勤奮', '怕寂寞', '勇敢', '固執', '頑皮',
  '大膽', '坦率', '悠閒', '淘氣', '樂天',
  '膽小', '急躁', '認真', '爽朗', '天真',
  '內向', '慢吞吞', '冷靜', '害羞', '馬虎',
  '溫和', '溫順', '自大', '慎重', '浮躁',
]

export const NATURES: Nature[] = NATURE_NAMES_ZH.map((nameZh, id) => {
  const upIdx = Math.floor(id / 5)
  const downIdx = id % 5
  const neutral = upIdx === downIdx
  return {
    id,
    nameZh,
    up: neutral ? null : NATURE_STATS[upIdx],
    down: neutral ? null : NATURE_STATS[downIdx],
  }
})

export const getNature = (id: NatureId): Nature => NATURES[id] ?? NATURES[0]

/** 性格對某能力值的乘數（HP 永遠 1） */
export function natureMultiplier(id: NatureId, stat: keyof Stats): number {
  const n = getNature(id)
  if (stat === n.up) return 1.1
  if (stat === n.down) return 0.9
  return 1
}

// ── 決定論 seeded RNG ──────────────────────────────────────────
function hashSeed(str: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface Individual {
  ivs: Stats
  nature: NatureId
  shiny: boolean
}

/** 由 seed 決定論產生個體（同 seed 永遠相同）。消耗順序固定：6 IV → 性格 → 異色。 */
export function rollIndividual(seed: string): Individual {
  const rng = mulberry32(hashSeed(seed))
  const iv = () => Math.floor(rng() * (IV_MAX + 1)) // 0..31
  const ivs: Stats = {
    hp: iv(), atk: iv(), def: iv(), spa: iv(), spd: iv(), spe: iv(),
  }
  const nature = Math.floor(rng() * NATURES.length)
  const shiny = rng() < SHINY_RATE
  return { ivs, nature, shiny }
}

/** IV 總和(0–186) → 星級 1–5 */
export function ivStars(ivs: Stats): number {
  const total = ivs.hp + ivs.atk + ivs.def + ivs.spa + ivs.spd + ivs.spe
  const f = total / IV_TOTAL_MAX
  if (f < 0.35) return 1
  if (f < 0.55) return 2
  if (f < 0.72) return 3
  if (f < 0.88) return 4
  return 5
}
