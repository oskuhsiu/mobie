// 共用型別定義 — M1 戰鬥與資料層

export type TypeName =
  | 'normal' | 'fire' | 'water' | 'electric' | 'grass' | 'ice'
  | 'fighting' | 'poison' | 'ground' | 'flying' | 'psychic' | 'bug'
  | 'rock' | 'ghost' | 'dragon' | 'dark' | 'steel' | 'fairy'

export type MoveCategory = 'physical' | 'special'

/**
 * 地形 id（M8 場域系統，plan/11 §1）——型別住此（共用型別家），
 * 地形數值（mods/名稱/圖示）資料住 `data/terrains.ts`（手寫非產生檔），避免型別↔資料循環依賴。
 */
export type TerrainId =
  | 'grassland' | 'volcanic' | 'coastal' | 'stormfield' | 'cavern'
  | 'haunt' | 'mystic' | 'dragons-peak' | 'sandstorm' | 'snowfield'
  | 'flowerfield' | 'neutral'

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
  /**
   * 進化目標 speciesId（M10，產生檔由 PokéAPI evolution-chain 派生）。
   * 無＝最終進化 / 不進化。分歧進化（如伊布）取鏈中第一個子代（決定論）。
   */
  evolvesTo?: number
  /**
   * 進化觸發等級（M10）。本傳的道具/通信/親密度進化在本遊戲一律**簡化為等級觸發**
   * （街機簡化，不引入道具進化）：有 min_level 用之，否則依進化階深合成（第一段 20 / 第二段 38）。
   */
  evolveLevel?: number
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
  /** 持有道具 id（M7，從 OwnedUnit 帶進戰鬥；未裝備則無） */
  heldItemId?: string
}

/**
 * 擁有的Mobie（canonical，唯一持久化的資料；M1.5f）。
 * 派生的戰鬥數值一律由此經 buildBattleMobie 算出，不存中間態。
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
  /** 持有道具 id（M7，canonical；未裝備則無） */
  heldItemId?: string
}

/** 進入戰鬥的實例：最終數值已由 buildBattleMobie 算好 */
export interface BattleMobie {
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
  /** 持有道具 id（M7 戰鬥暫態，由 Card 帶入；hook 自行依此分流，不持久化） */
  heldItemId?: string
  /** 特性 id（M7 戰鬥暫態，由 species 主屬性決定論指派；不持久化） */
  abilityId?: string
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
  /**
   * 場域地形（M8，plan/11 §1）——只影響攻擊 power、不持久化進 OwnedUnit：
   * - 固定地形：列出 1–2 個 TerrainId（混合＝逐屬性相乘後夾 [0.5,1.5]）。
   * - `randomTerrain:true`：此處改當「地形池」，開場由 encounter seed 決定論抽 1 個。
   * 省略＝中性（無倍率，等同 arena）。
   */
  terrains?: TerrainId[]
  /** 隨機地形區：開場從 `terrains`（地形池）決定論抽 1 個（plan/11 §1.3） */
  randomTerrain?: boolean
  /** 主題色（漸層起訖），用於畫面背景 */
  gradient: [string, string]
  /** emoji / 圖示 */
  icon: string
  blurb: string
  /** 野生遭遇表：speciesId → 權重，等級區間 */
  encounters: Array<{ speciesId: number; weight: number; minLevel: number; maxLevel: number }>
}
