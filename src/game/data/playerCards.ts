import type { Card } from '@/game/types'

/**
 * 起始玩家 roster（手牌）。M2 會由掃描實體卡 QR 取代。
 * 跨屬性挑選，讓玩家面對 8 個區域都有屬性相剋的策略選擇。
 * IV/性格由 cardId 決定論 roll（見 individual.ts）。
 */
export const PLAYER_CARDS: Card[] = [
  { cardId: 'DEV-1', speciesId: 1, level: 16 }, // 妙蛙種子
  { cardId: 'DEV-4', speciesId: 4, level: 16 }, // 小火龍
  { cardId: 'DEV-7', speciesId: 7, level: 16 }, // 傑尼龜
  { cardId: 'DEV-25', speciesId: 25, level: 17, shiny: true }, // 皮卡丘
  { cardId: 'DEV-133', speciesId: 133, level: 16 }, // 伊布
  { cardId: 'DEV-66', speciesId: 66, level: 16 }, // 腕力
  { cardId: 'DEV-92', speciesId: 92, level: 16 }, // 鬼斯
  { cardId: 'DEV-74', speciesId: 74, level: 16 }, // 小拳石
  { cardId: 'DEV-35', speciesId: 35, level: 16 }, // 皮皮
  { cardId: 'DEV-63', speciesId: 63, level: 16 }, // 凱西
  { cardId: 'DEV-81', speciesId: 81, level: 16 }, // 小磁怪
  { cardId: 'DEV-123', speciesId: 123, level: 17 }, // 飛天螳螂
  { cardId: 'DEV-131', speciesId: 131, level: 18 }, // 拉普拉斯
  { cardId: 'DEV-143', speciesId: 143, level: 18 }, // 卡比獸
  { cardId: 'DEV-147', speciesId: 147, level: 18 }, // 迷你龍
  { cardId: 'DEV-198', speciesId: 198, level: 17 }, // 黑暗鴉
]
