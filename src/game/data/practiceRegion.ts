import type { Region } from '@/game/types'

/**
 * 競技場（非產生器產生、手動維護；原「練習場」於 M6 模式 contract 重定位）。
 * `mode:'arena'`＝中性地形、無野外意外、不可捕獲、純得經驗——但**保留支援輪盤**（街機手感核心）。
 * 低等級常見Mobie、刻意「無傳說 boss」，提供低風險刷經驗、把起始隊練強的場地。
 * 流程與野外區域完全共用（encounter→cardSelect→battle→result），只在 result 依 mode 決定能否捕獲。
 */
export const PRACTICE_REGION: Region = {
  id: 'practice',
  name: '競技場',
  mode: 'arena',
  // 中性地形（M8）：resolveBattleTerrains 對 arena 一律回空地形，此處明示語意。
  terrains: ['neutral'],
  gradient: ['#3a4a72', '#191f33'],
  icon: '🏟️',
  blurb: '中性地形的純競技對戰：安心刷經驗、不可捕獲，仍保留支援輪盤手感。',
  encounters: [
    { speciesId: 16, weight: 5, minLevel: 6, maxLevel: 9 }, // 波波
    { speciesId: 19, weight: 5, minLevel: 6, maxLevel: 9 }, // 小拉達
    { speciesId: 10, weight: 4, minLevel: 5, maxLevel: 8 }, // 綠毛蟲
    { speciesId: 13, weight: 4, minLevel: 5, maxLevel: 8 }, // 獨角蟲
    { speciesId: 21, weight: 4, minLevel: 7, maxLevel: 10 }, // 烈雀
    { speciesId: 129, weight: 3, minLevel: 6, maxLevel: 10 }, // 鯉魚王
    { speciesId: 39, weight: 2, minLevel: 9, maxLevel: 12 }, // 胖丁
  ],
}
