import type { Region } from '@/game/types'

/** 11 個主題化區域（含混合/隨機地形區），等級帶遞增、覆蓋全 18 型；
 *  遭遇表由產生器從 dex 篩出（每區末項為高等 boss）；地形＝M8 場域系統。
 *  請勿手改，改請改產生器的 REGION_THEMES。 */
export const REGIONS: Region[] = [
  {
    id: 'verdant-forest',
    name: '常綠森林',
    mode: 'wild',
    terrains: ['grassland'],
    gradient: ['#1f6e43', '#0c3a24'],
    icon: '🌳',
    blurb: '蟲與草系出沒的蓊鬱林地，新手最佳起點。',
    encounters: [
      { speciesId: 191, weight: 4, minLevel: 6, maxLevel: 9 }, // 向日種子
      { speciesId: 165, weight: 4, minLevel: 7, maxLevel: 10 }, // 芭瓢蟲
      { speciesId: 43, weight: 4, minLevel: 8, maxLevel: 11 }, // 走路草
      { speciesId: 44, weight: 3, minLevel: 9, maxLevel: 12 }, // 臭臭花
      { speciesId: 49, weight: 2, minLevel: 10, maxLevel: 13 }, // 摩魯蛾
      { speciesId: 127, weight: 2, minLevel: 11, maxLevel: 13 }, // 凱羅斯
      { speciesId: 251, weight: 1, minLevel: 13, maxLevel: 15 }, // 時拉比
    ],
  },
  {
    id: 'ember-volcano',
    name: '灼熱火山',
    mode: 'wild',
    terrains: ['volcanic'],
    gradient: ['#b3361f', '#5c1208'],
    icon: '🌋',
    blurb: '岩漿翻騰的赤紅山體，火系與烈性寶可夢的領域。',
    encounters: [
      { speciesId: 218, weight: 4, minLevel: 12, maxLevel: 15 }, // 熔岩蟲
      { speciesId: 228, weight: 4, minLevel: 13, maxLevel: 16 }, // 戴魯比
      { speciesId: 5, weight: 3, minLevel: 14, maxLevel: 17 }, // 火恐龍
      { speciesId: 126, weight: 2, minLevel: 15, maxLevel: 18 }, // 鴨嘴火獸
      { speciesId: 38, weight: 2, minLevel: 16, maxLevel: 19 }, // 九尾
      { speciesId: 59, weight: 1, minLevel: 17, maxLevel: 19 }, // 風速狗
      { speciesId: 250, weight: 1, minLevel: 19, maxLevel: 21 }, // 鳳王
    ],
  },
  {
    id: 'crystal-shore',
    name: '澄澈水濱',
    mode: 'wild',
    terrains: ['coastal'],
    gradient: ['#1b6fb3', '#0a2f5c'],
    icon: '🌊',
    blurb: '清澈海灣與冰涼潮間帶，水、冰系悠游其中。',
    encounters: [
      { speciesId: 129, weight: 4, minLevel: 12, maxLevel: 15 }, // 鯉魚王
      { speciesId: 7, weight: 4, minLevel: 13, maxLevel: 16 }, // 傑尼龜
      { speciesId: 120, weight: 4, minLevel: 14, maxLevel: 17 }, // 海星星
      { speciesId: 215, weight: 2, minLevel: 15, maxLevel: 18 }, // 狃拉
      { speciesId: 224, weight: 2, minLevel: 16, maxLevel: 19 }, // 章魚桶
      { speciesId: 121, weight: 1, minLevel: 17, maxLevel: 19 }, // 寶石海星
      { speciesId: 245, weight: 1, minLevel: 19, maxLevel: 21 }, // 水君
    ],
  },
  {
    id: 'thunder-plateau',
    name: '雷鳴高原',
    mode: 'wild',
    terrains: ['stormfield'],
    gradient: ['#caa42a', '#5c4a06'],
    icon: '⚡',
    blurb: '雷雲低垂的開闊高地，電系與飛行系翱翔盤旋。',
    encounters: [
      { speciesId: 172, weight: 4, minLevel: 16, maxLevel: 19 }, // 皮丘
      { speciesId: 25, weight: 4, minLevel: 17, maxLevel: 20 }, // 皮卡丘
      { speciesId: 180, weight: 3, minLevel: 18, maxLevel: 21 }, // 茸茸羊
      { speciesId: 164, weight: 2, minLevel: 19, maxLevel: 22 }, // 貓頭夜鷹
      { speciesId: 18, weight: 2, minLevel: 20, maxLevel: 23 }, // 大比鳥
      { speciesId: 6, weight: 1, minLevel: 21, maxLevel: 23 }, // 噴火龍
      { speciesId: 250, weight: 1, minLevel: 23, maxLevel: 25 }, // 鳳王
    ],
  },
  {
    id: 'rocky-cavern',
    name: '岩窟洞穴',
    mode: 'wild',
    terrains: ['cavern'],
    gradient: ['#7a5a3a', '#33231a'],
    icon: '🪨',
    blurb: '崎嶇地底坑道，岩、地面與格鬥系潛伏其中。',
    encounters: [
      { speciesId: 194, weight: 4, minLevel: 16, maxLevel: 19 }, // 烏波
      { speciesId: 56, weight: 4, minLevel: 17, maxLevel: 20 }, // 猴怪
      { speciesId: 75, weight: 3, minLevel: 18, maxLevel: 21 }, // 隆隆石
      { speciesId: 195, weight: 2, minLevel: 19, maxLevel: 22 }, // 沼王
      { speciesId: 107, weight: 2, minLevel: 20, maxLevel: 23 }, // 快拳郎
      { speciesId: 31, weight: 2, minLevel: 21, maxLevel: 23 }, // 尼多后
      { speciesId: 248, weight: 1, minLevel: 23, maxLevel: 25 }, // 班基拉斯
    ],
  },
  {
    id: 'haunted-tower',
    name: '幽魂古塔',
    mode: 'wild',
    terrains: ['haunt'],
    gradient: ['#4b2d6e', '#1a0e2e'],
    icon: '👻',
    blurb: '陰森詭譎的廢棄高塔，幽靈、毒與惡系徘徊。',
    encounters: [
      { speciesId: 13, weight: 4, minLevel: 20, maxLevel: 23 }, // 獨角蟲
      { speciesId: 69, weight: 4, minLevel: 21, maxLevel: 24 }, // 喇叭芽
      { speciesId: 72, weight: 4, minLevel: 22, maxLevel: 25 }, // 瑪瑙水母
      { speciesId: 2, weight: 3, minLevel: 23, maxLevel: 26 }, // 妙蛙草
      { speciesId: 49, weight: 2, minLevel: 24, maxLevel: 27 }, // 摩魯蛾
      { speciesId: 229, weight: 2, minLevel: 25, maxLevel: 27 }, // 黑魯加
      { speciesId: 248, weight: 1, minLevel: 27, maxLevel: 29 }, // 班基拉斯
    ],
  },
  {
    id: 'mystic-meadow',
    name: '神秘花圃',
    mode: 'wild',
    terrains: ['mystic'],
    gradient: ['#c25b9e', '#5c2347'],
    icon: '🧚',
    blurb: '霧氣繚繞的夢幻花原，超能力與妖精系翩翩起舞。',
    encounters: [
      { speciesId: 174, weight: 4, minLevel: 20, maxLevel: 23 }, // 寶寶丁
      { speciesId: 132, weight: 4, minLevel: 21, maxLevel: 24 }, // 百變怪
      { speciesId: 216, weight: 4, minLevel: 22, maxLevel: 25 }, // 熊寶寶
      { speciesId: 162, weight: 3, minLevel: 23, maxLevel: 26 }, // 大尾立
      { speciesId: 122, weight: 2, minLevel: 24, maxLevel: 27 }, // 魔牆人偶
      { speciesId: 65, weight: 2, minLevel: 25, maxLevel: 27 }, // 胡地
      { speciesId: 249, weight: 1, minLevel: 27, maxLevel: 29 }, // 洛奇亞
    ],
  },
  {
    id: 'dragon-summit',
    name: '巨龍峰頂',
    mode: 'wild',
    terrains: ['dragons-peak'],
    gradient: ['#2c4a8a', '#10182e'],
    icon: '🐉',
    blurb: '雲端之上的險峻峰巔，龍、鋼系強敵盤踞的終局試煉。',
    encounters: [
      { speciesId: 220, weight: 4, minLevel: 26, maxLevel: 29 }, // 小山豬
      { speciesId: 81, weight: 4, minLevel: 27, maxLevel: 30 }, // 小磁怪
      { speciesId: 215, weight: 2, minLevel: 28, maxLevel: 31 }, // 狃拉
      { speciesId: 205, weight: 2, minLevel: 29, maxLevel: 32 }, // 佛烈托斯
      { speciesId: 212, weight: 2, minLevel: 31, maxLevel: 34 }, // 巨鉗螳螂
      { speciesId: 131, weight: 1, minLevel: 32, maxLevel: 34 }, // 拉普拉斯
      { speciesId: 149, weight: 1, minLevel: 34, maxLevel: 36 }, // 快龍
    ],
  },
  {
    id: 'coastal-marsh',
    name: '海濱濕地',
    mode: 'wild',
    terrains: ['coastal', 'grassland'],
    gradient: ['#2f7d8a', '#0c2e33'],
    icon: '🪷',
    blurb: '潮間帶與沼澤交錯的濕地，水、草與毒系混居其間。',
    encounters: [
      { speciesId: 191, weight: 4, minLevel: 14, maxLevel: 17 }, // 向日種子
      { speciesId: 223, weight: 4, minLevel: 15, maxLevel: 18 }, // 鐵炮魚
      { speciesId: 72, weight: 4, minLevel: 16, maxLevel: 19 }, // 瑪瑙水母
      { speciesId: 93, weight: 3, minLevel: 17, maxLevel: 20 }, // 鬼斯通
      { speciesId: 87, weight: 2, minLevel: 19, maxLevel: 22 }, // 白海獅
      { speciesId: 34, weight: 2, minLevel: 20, maxLevel: 22 }, // 尼多王
      { speciesId: 251, weight: 1, minLevel: 22, maxLevel: 24 }, // 時拉比
    ],
  },
  {
    id: 'volcanic-cavern',
    name: '火山岩窟',
    mode: 'wild',
    terrains: ['volcanic', 'cavern'],
    gradient: ['#8a3a1f', '#2e1208'],
    icon: '⛰️',
    blurb: '岩漿滲入地底坑道的灼熱洞窟，火、岩與地面系盤踞。',
    encounters: [
      { speciesId: 194, weight: 4, minLevel: 18, maxLevel: 21 }, // 烏波
      { speciesId: 155, weight: 4, minLevel: 19, maxLevel: 22 }, // 火球鼠
      { speciesId: 95, weight: 3, minLevel: 20, maxLevel: 23 }, // 大岩蛇
      { speciesId: 105, weight: 3, minLevel: 21, maxLevel: 24 }, // 嘎啦嘎啦
      { speciesId: 139, weight: 2, minLevel: 23, maxLevel: 26 }, // 多刺菊石獸
      { speciesId: 208, weight: 1, minLevel: 24, maxLevel: 26 }, // 大鋼蛇
      { speciesId: 250, weight: 1, minLevel: 26, maxLevel: 28 }, // 鳳王
    ],
  },
  {
    id: 'mirage-realm',
    name: '幻象之境',
    mode: 'wild',
    terrains: ['mystic', 'haunt', 'dragons-peak', 'sandstorm', 'snowfield', 'flowerfield'],
    randomTerrain: true,
    gradient: ['#5b3a8a', '#1a1030'],
    icon: '🌀',
    blurb: '地形變幻莫測的幻象結界，每次踏入都是未知的場域。',
    encounters: [
      { speciesId: 174, weight: 4, minLevel: 24, maxLevel: 27 }, // 寶寶丁
      { speciesId: 238, weight: 4, minLevel: 25, maxLevel: 28 }, // 迷唇娃
      { speciesId: 96, weight: 4, minLevel: 26, maxLevel: 29 }, // 催眠貘
      { speciesId: 40, weight: 2, minLevel: 27, maxLevel: 30 }, // 胖可丁
      { speciesId: 36, weight: 2, minLevel: 29, maxLevel: 32 }, // 皮可西
      { speciesId: 196, weight: 1, minLevel: 30, maxLevel: 32 }, // 太陽伊布
      { speciesId: 249, weight: 1, minLevel: 32, maxLevel: 34 }, // 洛奇亞
    ],
  },
]

export function getRegion(id: string): Region {
  const r = REGIONS.find((x) => x.id === id)
  if (!r) throw new Error(`Unknown region id: ${id}`)
  return r
}
