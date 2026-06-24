import type { Region } from '@/game/types'

/** 16 個主題化區域（含混合/隨機地形區），等級帶遞增、覆蓋全 18 型；
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
      { speciesId: 946, weight: 4, minLevel: 7, maxLevel: 10 }, // 納噬草
      { speciesId: 451, weight: 4, minLevel: 8, maxLevel: 11 }, // 鉗尾蠍
      { speciesId: 651, weight: 3, minLevel: 9, maxLevel: 12 }, // 胖胖哈力
      { speciesId: 272, weight: 2, minLevel: 10, maxLevel: 13 }, // 樂天河童
      { speciesId: 930, weight: 1, minLevel: 11, maxLevel: 13 }, // 奧利瓦
      { speciesId: 893, weight: 1, minLevel: 13, maxLevel: 15 }, // 薩戮德
    ],
  },
  {
    id: 'ember-volcano',
    name: '灼熱火山',
    mode: 'wild',
    terrains: ['volcanic'],
    gradient: ['#b3361f', '#5c1208'],
    icon: '🌋',
    blurb: '岩漿翻騰的赤紅山體，火系與烈性Mobie的領域。',
    encounters: [
      { speciesId: 218, weight: 4, minLevel: 12, maxLevel: 15 }, // 熔岩蟲
      { speciesId: 909, weight: 4, minLevel: 13, maxLevel: 16 }, // 呆火鱷
      { speciesId: 256, weight: 3, minLevel: 14, maxLevel: 17 }, // 力壯雞
      { speciesId: 555, weight: 2, minLevel: 15, maxLevel: 18 }, // 達摩狒狒
      { speciesId: 609, weight: 1, minLevel: 16, maxLevel: 19 }, // 水晶燈火靈
      { speciesId: 467, weight: 1, minLevel: 17, maxLevel: 19 }, // 鴨嘴炎獸
      { speciesId: 643, weight: 1, minLevel: 19, maxLevel: 21 }, // 萊希拉姆
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
      { speciesId: 746, weight: 4, minLevel: 12, maxLevel: 15 }, // 弱丁魚
      { speciesId: 501, weight: 4, minLevel: 13, maxLevel: 16 }, // 水水獺
      { speciesId: 458, weight: 4, minLevel: 14, maxLevel: 17 }, // 小球飛魚
      { speciesId: 124, weight: 2, minLevel: 15, maxLevel: 18 }, // 迷唇姐
      { speciesId: 199, weight: 2, minLevel: 16, maxLevel: 19 }, // 呆呆王
      { speciesId: 9, weight: 1, minLevel: 17, maxLevel: 19 }, // 水箭龜
      { speciesId: 484, weight: 1, minLevel: 19, maxLevel: 21 }, // 帕路奇亞
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
      { speciesId: 333, weight: 4, minLevel: 17, maxLevel: 20 }, // 青綿鳥
      { speciesId: 12, weight: 3, minLevel: 18, maxLevel: 21 }, // 巴大蝶
      { speciesId: 277, weight: 2, minLevel: 19, maxLevel: 22 }, // 大王燕
      { speciesId: 923, weight: 2, minLevel: 20, maxLevel: 23 }, // 巴布土撥
      { speciesId: 130, weight: 1, minLevel: 21, maxLevel: 23 }, // 暴鯉龍
      { speciesId: 717, weight: 1, minLevel: 23, maxLevel: 25 }, // 伊裴爾塔爾
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
      { speciesId: 304, weight: 4, minLevel: 17, maxLevel: 20 }, // 可可多拉
      { speciesId: 533, weight: 3, minLevel: 18, maxLevel: 21 }, // 鐵骨土人
      { speciesId: 297, weight: 2, minLevel: 19, maxLevel: 22 }, // 鐵掌力士
      { speciesId: 973, weight: 2, minLevel: 20, maxLevel: 23 }, // 纏紅鶴
      { speciesId: 392, weight: 1, minLevel: 21, maxLevel: 23 }, // 烈焰猴
      { speciesId: 1007, weight: 1, minLevel: 23, maxLevel: 25 }, // 故勒頓
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
      { speciesId: 318, weight: 4, minLevel: 21, maxLevel: 24 }, // 利牙魚
      { speciesId: 302, weight: 3, minLevel: 22, maxLevel: 25 }, // 勾魂眼
      { speciesId: 342, weight: 2, minLevel: 23, maxLevel: 26 }, // 鐵螯龍蝦
      { speciesId: 94, weight: 2, minLevel: 24, maxLevel: 27 }, // 耿鬼
      { speciesId: 911, weight: 1, minLevel: 25, maxLevel: 27 }, // 骨紋巨聲鱷
      { speciesId: 890, weight: 1, minLevel: 27, maxLevel: 29 }, // 無極汰那
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
      { speciesId: 298, weight: 4, minLevel: 20, maxLevel: 23 }, // 露力麗
      { speciesId: 52, weight: 4, minLevel: 21, maxLevel: 24 }, // 喵喵
      { speciesId: 327, weight: 3, minLevel: 22, maxLevel: 25 }, // 晃晃斑
      { speciesId: 432, weight: 2, minLevel: 23, maxLevel: 26 }, // 東施喵
      { speciesId: 521, weight: 2, minLevel: 24, maxLevel: 27 }, // 高傲雉雞
      { speciesId: 772, weight: 1, minLevel: 25, maxLevel: 27 }, // 屬性：空
      { speciesId: 493, weight: 1, minLevel: 27, maxLevel: 29 }, // 阿爾宙斯
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
      { speciesId: 872, weight: 4, minLevel: 26, maxLevel: 29 }, // 雪吞蟲
      { speciesId: 304, weight: 4, minLevel: 27, maxLevel: 30 }, // 可可多拉
      { speciesId: 705, weight: 2, minLevel: 28, maxLevel: 31 }, // 黏美兒
      { speciesId: 437, weight: 2, minLevel: 29, maxLevel: 32 }, // 青銅鐘
      { speciesId: 473, weight: 1, minLevel: 31, maxLevel: 34 }, // 象牙豬
      { speciesId: 1023, weight: 1, minLevel: 32, maxLevel: 34 }, // 铁头壳
      { speciesId: 890, weight: 1, minLevel: 34, maxLevel: 36 }, // 無極汰那
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
      { speciesId: 746, weight: 4, minLevel: 14, maxLevel: 17 }, // 弱丁魚
      { speciesId: 747, weight: 4, minLevel: 15, maxLevel: 18 }, // 好壞星
      { speciesId: 188, weight: 4, minLevel: 16, maxLevel: 19 }, // 毽子花
      { speciesId: 114, weight: 2, minLevel: 17, maxLevel: 20 }, // 蔓藤怪
      { speciesId: 842, weight: 2, minLevel: 19, maxLevel: 22 }, // 豐蜜龍
      { speciesId: 389, weight: 1, minLevel: 20, maxLevel: 22 }, // 土台龜
      { speciesId: 890, weight: 1, minLevel: 22, maxLevel: 24 }, // 無極汰那
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
      { speciesId: 104, weight: 4, minLevel: 19, maxLevel: 22 }, // 卡拉卡拉
      { speciesId: 525, weight: 3, minLevel: 20, maxLevel: 23 }, // 地幔岩
      { speciesId: 618, weight: 2, minLevel: 21, maxLevel: 24 }, // 泥巴魚
      { speciesId: 934, weight: 2, minLevel: 23, maxLevel: 26 }, // 鹽石巨靈
      { speciesId: 157, weight: 1, minLevel: 24, maxLevel: 26 }, // 火爆獸
      { speciesId: 643, weight: 1, minLevel: 26, maxLevel: 28 }, // 萊希拉姆
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
      { speciesId: 298, weight: 4, minLevel: 24, maxLevel: 27 }, // 露力麗
      { speciesId: 238, weight: 4, minLevel: 25, maxLevel: 28 }, // 迷唇娃
      { speciesId: 611, weight: 3, minLevel: 26, maxLevel: 29 }, // 斧牙龍
      { speciesId: 36, weight: 2, minLevel: 27, maxLevel: 30 }, // 皮可西
      { speciesId: 475, weight: 1, minLevel: 29, maxLevel: 32 }, // 艾路雷朵
      { speciesId: 1006, weight: 1, minLevel: 30, maxLevel: 32 }, // 鐵武者
      { speciesId: 890, weight: 1, minLevel: 32, maxLevel: 34 }, // 無極汰那
    ],
  },
  {
    id: 'sunlit-savanna',
    name: '驕陽草海',
    mode: 'wild',
    terrains: ['sunny'],
    gradient: ['#c98a1f', '#6e4a0a'],
    icon: '☀️',
    blurb: '烈日炙烤的金黃草海，火與一般系在晴空下精神抖擻。',
    encounters: [
      { speciesId: 298, weight: 4, minLevel: 22, maxLevel: 25 }, // 露力麗
      { speciesId: 443, weight: 4, minLevel: 23, maxLevel: 26 }, // 圓陸鯊
      { speciesId: 327, weight: 3, minLevel: 24, maxLevel: 27 }, // 晃晃斑
      { speciesId: 40, weight: 2, minLevel: 25, maxLevel: 28 }, // 胖可丁
      { speciesId: 521, weight: 2, minLevel: 27, maxLevel: 30 }, // 高傲雉雞
      { speciesId: 851, weight: 1, minLevel: 28, maxLevel: 30 }, // 焚焰蚣
      { speciesId: 493, weight: 1, minLevel: 30, maxLevel: 32 }, // 阿爾宙斯
    ],
  },
  {
    id: 'monsoon-coast',
    name: '季風海岸',
    mode: 'wild',
    terrains: ['rain'],
    gradient: ['#1c5a7a', '#0a2433'],
    icon: '🌧️',
    blurb: '暴雨傾盆的灰藍海岸，水系與飛行系乘風破浪。',
    encounters: [
      { speciesId: 746, weight: 4, minLevel: 22, maxLevel: 25 }, // 弱丁魚
      { speciesId: 258, weight: 4, minLevel: 23, maxLevel: 26 }, // 水躍魚
      { speciesId: 822, weight: 3, minLevel: 24, maxLevel: 27 }, // 藍鴉
      { speciesId: 22, weight: 2, minLevel: 25, maxLevel: 28 }, // 大嘴雀
      { speciesId: 834, weight: 2, minLevel: 27, maxLevel: 30 }, // 暴噬龜
      { speciesId: 365, weight: 1, minLevel: 28, maxLevel: 30 }, // 帝牙海獅
      { speciesId: 717, weight: 1, minLevel: 30, maxLevel: 32 }, // 伊裴爾塔爾
    ],
  },
  {
    id: 'psy-sanctum',
    name: '精神聖所',
    mode: 'wild',
    terrains: ['psychic-field'],
    gradient: ['#8a3a8a', '#2e1030'],
    icon: '🔮',
    blurb: '靈力充盈的精神場域，超能力與妖精系在此覺醒。',
    encounters: [
      { speciesId: 298, weight: 4, minLevel: 26, maxLevel: 29 }, // 露力麗
      { speciesId: 436, weight: 4, minLevel: 27, maxLevel: 30 }, // 銅鏡怪
      { speciesId: 575, weight: 3, minLevel: 28, maxLevel: 31 }, // 哥德小童
      { speciesId: 876, weight: 2, minLevel: 29, maxLevel: 32 }, // 愛管侍
      { speciesId: 959, weight: 2, minLevel: 31, maxLevel: 34 }, // 巨鍛匠
      { speciesId: 481, weight: 1, minLevel: 32, maxLevel: 34 }, // 艾姆利多
      { speciesId: 792, weight: 1, minLevel: 34, maxLevel: 36 }, // 露奈雅拉
    ],
  },
  {
    id: 'primal-swamp',
    name: '太古沼澤',
    mode: 'wild',
    terrains: ['swamp'],
    gradient: ['#3a5a2a', '#16240e'],
    icon: '🪻',
    blurb: '瘴氣瀰漫的太古濕沼，毒、地面與水系蟄伏淤泥。',
    encounters: [
      { speciesId: 746, weight: 4, minLevel: 24, maxLevel: 27 }, // 弱丁魚
      { speciesId: 322, weight: 4, minLevel: 25, maxLevel: 28 }, // 呆火駝
      { speciesId: 111, weight: 4, minLevel: 26, maxLevel: 29 }, // 獨角犀牛
      { speciesId: 117, weight: 2, minLevel: 27, maxLevel: 30 }, // 海刺龍
      { speciesId: 945, weight: 2, minLevel: 29, maxLevel: 32 }, // 塗標客
      { speciesId: 134, weight: 1, minLevel: 30, maxLevel: 32 }, // 水伊布
      { speciesId: 890, weight: 1, minLevel: 32, maxLevel: 34 }, // 無極汰那
    ],
  },
  {
    id: 'sacred-grove',
    name: '神聖林苑',
    mode: 'wild',
    terrains: ['holy-ground'],
    gradient: ['#caa42a', '#4a3a0a'],
    icon: '✨',
    blurb: '聖光普照的神域林苑，妖精、超能力與鋼系受其庇佑。',
    encounters: [
      { speciesId: 298, weight: 4, minLevel: 28, maxLevel: 31 }, // 露力麗
      { speciesId: 439, weight: 4, minLevel: 29, maxLevel: 32 }, // 魔尼尼
      { speciesId: 184, weight: 3, minLevel: 30, maxLevel: 33 }, // 瑪力露麗
      { speciesId: 956, weight: 2, minLevel: 31, maxLevel: 34 }, // 超能艷鴕
      { speciesId: 282, weight: 1, minLevel: 33, maxLevel: 36 }, // 沙奈朵
      { speciesId: 990, weight: 1, minLevel: 34, maxLevel: 36 }, // 鐵轍跡
      { speciesId: 792, weight: 1, minLevel: 36, maxLevel: 38 }, // 露奈雅拉
    ],
  },
]

export function getRegion(id: string): Region {
  const r = REGIONS.find((x) => x.id === id)
  if (!r) throw new Error(`Unknown region id: ${id}`)
  return r
}
