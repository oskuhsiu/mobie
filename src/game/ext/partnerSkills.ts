// M17 — Partner（訓練師）技能：玩家本人的「帳號級」戰術工具。設計真相：plan/19。
//
// 分界線（務必守）：主動施放=招式（M19，掛怪物）／被動常駐=特性（M7，掛怪物）／
// 玩家自有工具=Partner 技能（M17，掛帳號）。玩家技能**不讀也不寫** OwnedUnit 的招式欄，
// 跨怪物共用、靠玩家養成（SP）解鎖（存 mobie.playerskills.v1）。
//
// 兩種模式：
//   active  — 戰中主動鈕（看穿），純顯示層：設 revealedFoes + 揭露演出，每場一次，
//             **不進 reducer、不耗回合、對手不回擊**（守相位契約）。
//   support — 戰鬥中使用一次（玩家自選時機），為全隊一次性灌注增益，寫進 fieldState.teamStatuses
//             （複用 M19.d 機制，reducer 早已消費此欄）＝**零 reducer 改動**，每場一次。
//
// 本檔為「catalog」（手寫非產生檔），純資料 + 純函式，可單測。零直接傷害（護欄見 partnerSkills.test.ts）。

import type { StatusEffect } from '@/game/battle/reducer'
import { createLookup } from '@/game/ext/statPatch'

export type PartnerSkillId = string

/** active＝戰中主動鈕（看穿）；support＝開戰一次性全隊 buff（寫 fieldState）。 */
export type PartnerSkillMode = 'active' | 'support'

/** support 技能灌注的單一能力值增益（複用 M19.d StatusEffect 的子集；turns＝持續回合）。 */
export interface PartnerTeamBuff {
  stat: StatusEffect['stat']
  mult: number
  turns: number
}

export interface PartnerSkillDef {
  id: PartnerSkillId
  name: string
  icon: string
  desc: string
  mode: PartnerSkillMode
  /** SP 解鎖成本（與 M19 招式分池顯示）；0＝起始技能（預設已習得、不需花 SP）。 */
  cost: number
  /** active：揭露對手當前 Mobie 的深度資訊（招式/數值/特性/星級）。 */
  reveal?: boolean
  /** support：開戰一次性灌注全隊的增益清單（寫 fieldState.teamStatuses）。 */
  teamBuff?: PartnerTeamBuff[]
}

/**
 * 起始 catalog（小樣本，plan/19）。
 * - 🔍 看穿＝核心 active（cost 0＝開模組即可用、不需 SP）。
 * - 📣 訓練師加油＝選配 support（花 SP 解鎖），開戰給全隊小幅攻擊/特攻提升。
 * 原「鼓舞/守護/疾風」等怪物 buff 已下放為怪物變化招（M19），不在此。
 */
export const PARTNER_SKILLS: PartnerSkillDef[] = [
  {
    id: 'insight',
    name: '看穿',
    icon: '🔍',
    mode: 'active',
    cost: 0,
    reveal: true,
    desc: '看穿對手當前 Mobie 的招式、能力值、特性與星級（每場一次，不耗回合、對手不會回擊）。',
  },
  {
    id: 'rally',
    name: '訓練師加油',
    icon: '📣',
    mode: 'support',
    cost: 6,
    teamBuff: [
      { stat: 'atk', mult: 1.2, turns: 3 },
      { stat: 'spa', mult: 1.2, turns: 3 },
    ],
    desc: '使出後為全隊灌注士氣，攻擊與特攻短暫提升 3 回合（每場一次）。',
  },
]

/** id → def 的 O(1) 查表（共用 statPatch.createLookup，同 items/abilities/terrains 慣例）。 */
export const getPartnerSkill = createLookup(PARTNER_SKILLS)

/** 某技能是否「已習得」＝起始技能（cost 0）或已花 SP 解鎖（在 learnedIds 內）。 */
export function isPartnerSkillLearned(id: PartnerSkillId, learnedIds: readonly string[]): boolean {
  const def = getPartnerSkill(id)
  if (!def) return false
  return def.cost === 0 || learnedIds.includes(id)
}

/** 已習得的技能清單（起始 ∪ 已解鎖），保持 catalog 順序。供戰鬥行動列 / 卡片顯示。 */
export function learnedPartnerSkills(learnedIds: readonly string[]): PartnerSkillDef[] {
  return PARTNER_SKILLS.filter((s) => isPartnerSkillLearned(s.id, learnedIds))
}

/** support 技能 → 全隊一次性 buff 的 StatusEffect[]（寫 fieldState.teamStatuses；source=-1＝非招式來源、僅供顯示）。 */
export function teamBuffStatuses(def: PartnerSkillDef): StatusEffect[] {
  if (!def.teamBuff) return []
  return def.teamBuff.map((b) => ({ stat: b.stat, mult: b.mult, remaining: b.turns, source: -1, label: def.name }))
}
