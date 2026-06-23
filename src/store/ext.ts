// M6.0 — 組裝注入 reducer 的純能力包（住 store 層：唯一「知道哪些模組開著」的地方）。
// 設計真相：plan/09 §0.2/§0.3。reducer 保持純淨、不認識模組；assembleExt 把「已啟用模組的縫」
// 收斂成扁平 ExtBundle。M6 註冊表為空＝永遠回 EMPTY_EXT＝行為等同 M1.x；M7+ 各系統 push 自己的模組。

import {
  EMPTY_EXT,
  type ExtBundle,
  type ExtensionModule,
  type BuildUnitHook,
  type PreBattleHook,
} from '@/game/ext/seams'
import type { GameSettings } from '@/game/settings'

/**
 * 模組註冊表。各延伸系統把自己的 ExtensionModule 加進來（M7：羈絆 S2 / 持有道具 S1·S3·S4 /
 * 特性 S1·S3；M9+ 再 push 連鎖/進化/塔）。關閉的模組由 assembleExt/assembleBattlePrep
 * 依 settings 過濾掉＝零殘留。
 */
export const MODULE_REGISTRY: ExtensionModule[] = []

/**
 * 戰前縫（S1 buildUnit / S2 preBattleModifiers）的注入包。
 * 與 ExtBundle（戰中 S3/S4/S5，住 reducer）分流——戰前縫由 buildBattlePokemon 後的初始化呼叫點消費。
 */
export interface BattlePrep {
  /** S1：建構 BattleUnit 後的能力值 patch（道具/特性 statMod），逐一 fold */
  buildUnitHooks: BuildUnitHook[]
  /** S2：由出戰隊伍算全隊修飾（羈絆），單次呼叫 */
  preBattleHooks: PreBattleHook[]
}

export const EMPTY_PREP: BattlePrep = { buildUnitHooks: [], preBattleHooks: [] }

/**
 * 依「哪些模組開著」（settings）+ 模組註冊表，組出 reducer 要的 ExtBundle（S3/S4/S5）。
 * S1/S2/S6（戰前/戰後縫）由各自呼叫點消費，不在此包。registry 可注入，方便單測。
 */
export function assembleExt(
  settings: GameSettings,
  registry: ExtensionModule[] = MODULE_REGISTRY,
): ExtBundle {
  const active = registry.filter((m) => settings.modules[m.id])
  if (active.length === 0) return EMPTY_EXT

  const bundle: ExtBundle = { damageHooks: [], turnEndTriggers: [] }
  for (const m of active) {
    if (m.seams.damageHook) bundle.damageHooks.push(m.seams.damageHook)
    if (m.seams.turnEndTrigger) bundle.turnEndTriggers.push(m.seams.turnEndTrigger)
    if (m.seams.chainResolve) bundle.chain = m.seams.chainResolve // 連鎖目前最多一個模組提供
  }
  return bundle
}

/**
 * 組出戰前縫的注入包（S1 buildUnit / S2 preBattleModifiers）給戰鬥初始化呼叫點消費。
 * 同樣依 settings 過濾已啟用模組；全關＝EMPTY_PREP＝buildBattlePokemon 結果原封不動。
 */
export function assembleBattlePrep(
  settings: GameSettings,
  registry: ExtensionModule[] = MODULE_REGISTRY,
): BattlePrep {
  const active = registry.filter((m) => settings.modules[m.id])
  if (active.length === 0) return EMPTY_PREP

  const prep: BattlePrep = { buildUnitHooks: [], preBattleHooks: [] }
  for (const m of active) {
    if (m.seams.buildUnit) prep.buildUnitHooks.push(m.seams.buildUnit)
    if (m.seams.preBattleModifiers) prep.preBattleHooks.push(m.seams.preBattleModifiers)
  }
  return prep
}
