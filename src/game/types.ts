// 共用型別定義 — M1 戰鬥與資料層

export type TypeName =
  | 'normal' | 'fire' | 'water' | 'electric' | 'grass' | 'ice'
  | 'fighting' | 'poison' | 'ground' | 'flying' | 'psychic' | 'bug'
  | 'rock' | 'ghost' | 'dragon' | 'dark' | 'steel' | 'fairy'

export type MoveCategory = 'physical' | 'special'

/** 性格 id（0–24），對應 individual.ts 的 NATURES 表 */
export type NatureId = number

export interface Stats {
  hp: number
  atk: number
  def: number
  spa: number
  spd: number
  spe: number
}

export interface Move {
  id: number
  name: string
  nameZh: string
  type: TypeName
  power: number
  accuracy: number // 0–100
  category: MoveCategory
}

export interface Species {
  id: number // 全國圖鑑編號
  name: string
  nameZh: string
  types: TypeName[] // 1–2 屬性
  baseStats: Stats
  moveId: number // M1：單一專屬招式
  /** PokéAPI 官方 artwork（billboard / 立繪用），runtime 載入 */
  artworkUrl: string
}

/** 實體卡（M2 由 QR 反查），M1 用本地假卡 roster 取代 */
export interface Card {
  cardId: string
  speciesId: number
  level: number
  /** 個體值；未提供則由 cardId 決定論 roll */
  ivs?: Partial<Stats>
  /** 性格 id；未提供則由 cardId 決定論 roll */
  nature?: NatureId
  shiny?: boolean
}

/**
 * 擁有的寶可夢（canonical，唯一持久化的資料；M1.5f）。
 * 派生的戰鬥數值一律由此經 buildBattlePokemon 算出，不存中間態。
 */
export interface OwnedUnit {
  id: string
  speciesId: number
  level: number
  exp: number
  ivs: Stats
  nature: NatureId
  seed: string
  shiny: boolean
}

/** 進入戰鬥的實例：最終數值已由 buildBattlePokemon 算好 */
export interface BattlePokemon {
  speciesId: number
  name: string
  nameZh: string
  types: TypeName[]
  level: number
  maxHp: number
  currentHp: number
  atk: number
  def: number
  spa: number
  spd: number
  spe: number
  move: Move
  artworkUrl: string
  shiny: boolean
  /** 個體值（0–31/項，M1.5e） */
  ivs: Stats
  /** 性格 id（0–24） */
  nature: NatureId
}

export interface Region {
  id: string
  name: string
  /**
   * 玩法 contract（M6 模式分流，plan/11 §2）——不是 UI 分類：
   * - 'arena' 競技場：中性地形、無野外意外、不可捕獲、純得經驗（仍保留支援輪盤手感）。
   * - 'wild'  野外：可捕獲 boss，且未來掛載地形（M8）/ 野外意外（M11）。
   * gating 集中於 encounter/battle/result setup（依 mode 決定 roll 什麼、能不能捕獲）。
   */
  mode: 'arena' | 'wild'
  /** 主題色（漸層起訖），用於畫面背景 */
  gradient: [string, string]
  /** emoji / 圖示 */
  icon: string
  blurb: string
  /** 野生遭遇表：speciesId → 權重，等級區間 */
  encounters: Array<{ speciesId: number; weight: number; minLevel: number; maxLevel: number }>
}
