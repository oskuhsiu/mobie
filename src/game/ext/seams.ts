// M6.0 — 統一掛載機制（擴充縫 / seams）。設計真相：plan/09 §0。
//
// 「可選式掛載」不是每個系統各自 if/else，而是核心定義固定的擴充縫（S1–S8），
// 模組註冊它要的縫；**停用＝不註冊＝零殘留**。reducer 維持純函數——擴充能力如同
// `rng` 一樣是「注入的純能力包」（ExtBundle），不是 import 進來的依賴。
//
// 本檔只放「定義」（型別 + 空包）。各縫的實際 wiring 隨其模組所屬里程碑落地：
//   S3/S4/S5 由 reducer/engine 消費（resolveTurn 吃 ExtBundle）——M6 已接（預設空＝零行為改變）。
//   S1/S2/S6 由 buildBattleMobie / 戰鬥初始化 / rosterStore.grantBattleExp（applyExp 之後）各自呼叫點消費——M7/M10 接。
//   S7 gameMode 走 XState 流程層、S8 saveSlice 走 persistence 命名空間——M11 接。

import type { BattleMobie, OwnedUnit } from '@/game/types'
// 型別循環（seams ↔ reducer）皆為 import type，編譯期抹除、無 runtime 相依。
import type { BattleState, BattleEvent } from '@/game/battle/reducer'
import type { ComboRules } from '@/game/ext/combo'

/** 八個擴充縫的識別碼（對照 plan/09 §0.1）。 */
export type SeamId =
  | 'buildUnit' // S1：stats.buildBattleMobie 算完能力值後（純 patch）
  | 'preBattleModifiers' // S2：戰鬥初始化 / 編隊變更（單次，純 team→modifiers）
  | 'damageHook' // S3：engine.resolveAttack 傷害結算中段（純倍率）
  | 'turnEndTrigger' // S4：reducer 回合末同步段（純 state→state，timeout 前）
  | 'chainResolve' // S5：reducer SUBMIT_CHAIN_RESULT（純 state→state+events）
  | 'postGrowth' // S6：grantBattleExp 升級後（applyExp 之後，純 unit→unit；進化改 speciesId）
  | 'gameMode' // S7：XState 平行子狀態（流程層）
  | 'saveSlice' // S8：persistence 獨立命名空間（序列化）

/**
 * 延伸系統模組 id。設定持久化逐一開關，預設全關。
 * wave-1（plan/09 §0.3）：heldItems / synergy / chain / evolution。
 * wave-2（plan/10）：abilities（特性）——M7 與道具共用 S1/S3 引擎。
 * M17（plan/19）：partnerSkills（玩家/訓練師技能）——**非戰鬥 seam 模組**（看穿走顯示層、
 * 加油走 fieldState），不在 MODULE_REGISTRY；此 id 僅供設定頁開關 + UI gating。
 * （連勝塔是 RegionSelect 進入的遊戲模式、非可選掛載模組，故不列入此處。）
 */
export type ModuleId = 'heldItems' | 'synergy' | 'abilities' | 'chain' | 'evolution' | 'partnerSkills' | 'combo'

// ── 各縫的純能力簽章 ────────────────────────────────────────────

/** S1：建構 BattleUnit 後的能力值 patch（道具 statMod / 講究頭巾…）。 */
export type BuildUnitHook = (unit: BattleMobie) => BattleMobie

/** 具名修飾（羈絆 / run relic…）：必帶 label/source/icon 供 UI 回顯（禁隱形加成）。 */
export interface NamedModifier {
  label: string
  source: string
  icon: string
  /** 套到 BattleUnit 的純 patch（M7 羈絆/道具填實作） */
  apply?: (unit: BattleMobie) => BattleMobie
}

/** S2：由出戰隊伍算出全隊修飾（戰鬥初始化 / 編隊變更單次呼叫；換 active 不重算）。 */
export type PreBattleHook = (team: BattleMobie[]) => NamedModifier[]

/** S3 的上下文：engine 側、與 side 無關（道具 hook 自行用 attacker 判定是否生效）。 */
export interface DamageHookContext {
  attacker: BattleMobie
  defender: BattleMobie
  /** 屬性相剋總倍率（達人帶「對剋制目標 ×1.2」之類條件用） */
  effectiveness: number
}
/** S3：傷害結算中段的純倍率（命玉 ×1.3、達人帶 ×1.2…）。回傳乘到傷害上的係數。 */
export type DamageHook = (ctx: DamageHookContext) => number

/** S4 的上下文：working 戰鬥態（可就地改 HP，如既有 performAttack）＋ rng。 */
export interface TurnEndContext {
  state: BattleState
  rng: () => number
}
/**
 * S4：回合末同步觸發器（剩飯每回合末回血、氣勢披帶持續型…）。
 * contract D（plan/09 §0.4）：在 MAX_TURNS timeout 判定「前」跑，故其 HP 變動會納入 timeout 的剩餘血量比例。
 * 嚴守 contract E：同步、不可 async / 不可再觸發換人。回報要演出的 events。
 */
export type TurnEndTrigger = (ctx: TurnEndContext) => BattleEvent[]

/** S5：連鎖規則（M9 由 SUBMIT_CHAIN_RESULT 消費；連鎖模組開啟時注入 ext.chain）。 */
export interface ChainRules {
  /** 連鎖最多隻數（暫 3，貼 Mezastar） */
  maxHits: number
  /** 連鎖槽集滿閾值（0..gaugeFull）；達標 reducer emit chainOpportunity */
  gaugeFull: number
  /** 每次「玩家普攻命中」累積的連鎖槽量（依 QTE 表現再加權，不綁隨機）。 */
  gainBase: number
}

/** S6：升級後的 canonical patch（進化改 speciesId、個體欄位全保留）。 */
export type PostGrowthHook = (unit: OwnedUnit) => OwnedUnit

// ── 模組註冊 ────────────────────────────────────────────────────

/**
 * 一個模組填它用到的縫（其餘留空）。
 * 注意：plan/09 §0.3 的 `enabled` 不放這裡——啟用與否是動態設定（settings.modules[id]），
 * 模組 def 本身保持靜態。assembleExt 在組包時才依設定決定收不收。
 */
export interface ModuleSeams {
  buildUnit?: BuildUnitHook // S1
  preBattleModifiers?: PreBattleHook // S2
  damageHook?: DamageHook // S3
  turnEndTrigger?: TurnEndTrigger // S4
  chainResolve?: ChainRules // S5
  combo?: ComboRules // S5b：合體技（M12.d，連鎖升級變體；reducer 在連鎖後段消費 ext.combo）
  postGrowth?: PostGrowthHook // S6
  /** S7：宣告本模組會掛載的平行子狀態名（流程層處理，不走 ExtBundle） */
  gameMode?: string
}

export interface ExtensionModule {
  id: ModuleId
  seams: ModuleSeams
  /** S8：它獨佔的存檔命名空間（如 'mobie.itembag.v1'） */
  ownsSaveSlices?: string[]
}

// ── 注入 reducer / engine 的純能力包 ────────────────────────────

/**
 * resolveTurn 第三參數 `ext` 的型別：只含「戰中」會被消費的縫（S3/S4/S5）。
 * S1/S2/S6（戰前 / 戰後）由各自呼叫點消費，不在此包。
 * 預設 EMPTY_EXT＝行為與 M1.x 完全一致（既有測試不需改）。reducer 不認識「道具/羈絆」字眼，只認識這些 hook。
 */
export interface ExtBundle {
  damageHooks: DamageHook[] // S3
  turnEndTriggers: TurnEndTrigger[] // S4
  chain?: ChainRules // S5（undefined = 連鎖關閉）
  /** M12.d 合體技（連鎖升級變體；undefined = 合體關閉、連鎖不升級）。 */
  combo?: ComboRules
}

/** 空能力包：不傳 ext 或全模組關閉時用。 */
export const EMPTY_EXT: ExtBundle = { damageHooks: [], turnEndTriggers: [] }
