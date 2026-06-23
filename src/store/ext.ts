// M6.0 — 組裝注入 reducer 的純能力包（住 store 層：唯一「知道哪些模組開著」的地方）。
// 設計真相：plan/09 §0.2/§0.3。reducer 保持純淨、不認識模組；assembleExt 把「已啟用模組的縫」
// 收斂成扁平 ExtBundle。M6 註冊表為空＝永遠回 EMPTY_EXT＝行為等同 M1.x；M7+ 各系統 push 自己的模組。

import { EMPTY_EXT, type ExtBundle, type ExtensionModule } from '@/game/ext/seams'
import type { GameSettings } from '@/game/settings'

/**
 * 模組註冊表。M7+ 各系統把自己的 ExtensionModule 加進來（道具/羈絆/連鎖/進化/塔）。
 * M6 留空＝assembleExt 一律回 EMPTY_EXT。
 */
export const MODULE_REGISTRY: ExtensionModule[] = []

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
