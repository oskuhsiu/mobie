// 決定論 seeded RNG 共用地基（M14.0）。
// 原本 hashSeed/mulberry32 私藏在 individual.ts；抽到本檔成單一真相，供個體差異、
// 地形隨機抽、連勝塔 foe、孵化 id、以及 M14 戰鬥回放的「整場單一 rng stream」共用。
// 純函式、零相依、零行為變動（individual.ts 改 re-export）。

/** FNV-1a 32-bit 字串雜湊 → seed 整數。 */
export function hashSeed(str: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** mulberry32：由整數 seed 產生 [0,1) 決定論序列。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 由字串 seed 直接建出一條 rng stream（hashSeed → mulberry32）。
 * 一場戰鬥開戰時建一次、整場持續推進；同 seed + 同呼叫序 → 同序列（回放重模擬地基）。
 */
export function makeRng(seed: string): () => number {
  return mulberry32(hashSeed(seed))
}
