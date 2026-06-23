// M9 — 連鎖攻擊（Chain Attack，S5）。設計真相：plan/09 §3、plan/14（M9）。
//
// Mezastar 招牌：連鎖槽集滿 → 最多 3 隻未倒下隊友依序對「當前 active 敵」連續出擊。
// 嚴守地基不變式：
//   ① 純 reducer——連鎖規則如 rng 般注入（ext.chain），reducer 不認識「連鎖槽 UI」，只認識 ChainRules。
//   ② 連鎖槽＝戰鬥內暫態（住 BattleState.chainGauge），不持久化、不回寫 OwnedUnit。
//   ③ 單招街機——每隻連鎖時用自己的單一專屬招，連鎖不引入新招式、倒下隊友不可連鎖。
//   ④ reducer 重新驗證（防幽靈傷害）：提交時重查參與者存活 + 目標仍為同一 active 敵（plan/09 §3.3）。
//
// 本模組「只」註冊 S5（chainResolve = 規則）。資格累積 / 重驗 / 結算邏輯全在 reducer（核心不變式所在）；
// 連續 QTE 演出 / 連段 FX 在 display 層（BattleScreen）。停用＝ext.chain undefined＝不累積、不 emit、回單體攻擊。

import type { ChainRules, ExtensionModule } from '@/game/ext/seams'

/** 連鎖規則（手寫可平衡）：最多 3 隻、約 3 個好回合集滿、命中累積。 */
export const CHAIN_RULES: ChainRules = {
  maxHits: 3,
  gaugeFull: 100,
  gainBase: 30,
}

/**
 * 連鎖攻擊模組：只掛 S5（chainResolve）。
 * 停用＝assembleExt 不收此縫＝ext.chain undefined＝reducer 不累積連鎖槽、不 emit chainOpportunity＝回單體攻擊。
 */
export const CHAIN_MODULE: ExtensionModule = {
  id: 'chain',
  seams: { chainResolve: CHAIN_RULES },
}
