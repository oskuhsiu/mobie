import type { Region } from '@/game/types'

/**
 * 練習場（非產生器產生、手動維護）。
 * 低等級常見寶可夢、刻意「無傳說 boss」，提供低風險刷經驗、把起始隊練強的場地。
 * 流程與一般區域完全共用（encounter→cardSelect→battle→result）。
 */
export const PRACTICE_REGION: Region = {
  id: 'practice',
  name: '練習場',
  gradient: ['#3a4a72', '#191f33'],
  icon: '🥊',
  blurb: '低風險的訓練對戰，安心刷經驗、把隊伍練強。',
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
