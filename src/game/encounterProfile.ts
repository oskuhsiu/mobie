// M12.e — 對手技能多樣性（Encounter Skill Profile，plan/12 §5）。
// 守「對手 AI 簡單」硬約束：每個敵單位仍只提交 ATTACK，profile 只是**純反射被動標籤**——
// 由 speciesId 決定論指派 0–2 個標籤，於戰鬥初始化時對「對手 BattleMobie」做一次性能力值微調
// （display 層 prep，比照道具 statMod；reducer/engine 完全不動、不認識 profile）。
//
// 可選掛載：encounterSkills 模組關閉＝不指派、不調整、不顯示＝零殘留（非 seam 模組，比照 partnerSkills）。

import type { BattleMobie } from '@/game/types'
import { hashSeed } from '@/game/rng'

export type EncounterTag = 'aggressive' | 'disruptor' | 'sustain' | 'terrain' | 'combo_seed'

export interface EncounterTagMeta {
  label: string
  icon: string
  desc: string
}

export const ENCOUNTER_TAG_META: Record<EncounterTag, EncounterTagMeta> = {
  aggressive: { label: '猛攻', icon: '⚔️', desc: '攻擊較高' },
  disruptor: { label: '擾亂', icon: '💨', desc: '速度較高' },
  sustain: { label: '堅韌', icon: '🛡️', desc: '體力較厚' },
  terrain: { label: '馭場', icon: '🌐', desc: '擅長場域戰' },
  combo_seed: { label: '合擊', icon: '✨', desc: 'boss/雙人組可能合體' },
}

const ALL_TAGS: EncounterTag[] = ['aggressive', 'disruptor', 'sustain', 'terrain', 'combo_seed']

export interface EncounterSkillProfile {
  tags: EncounterTag[] // 0–2
}

/**
 * 由 speciesId 決定論抽 0–2 個標籤（同物種永遠相同；不存任何狀態）。
 * isBoss=true（隊伍末位）較可能帶 combo_seed（宣告合體）。
 */
export function rollEncounterProfile(speciesId: number, isBoss = false): EncounterSkillProfile {
  const h = hashSeed(`encprofile|${speciesId}`)
  const count = h % 3 // 0/1/2
  if (count === 0) return { tags: [] }
  const tags: EncounterTag[] = []
  // 由 hash 不同位元挑互異標籤
  const first = ALL_TAGS[(h >>> 2) % ALL_TAGS.length]
  tags.push(first)
  if (count === 2) {
    const second = ALL_TAGS[(h >>> 8) % ALL_TAGS.length]
    if (second !== first) tags.push(second)
  }
  // boss 傾向掛 combo_seed（宣告合體；非 AI 臨場搜尋）
  if (isBoss && !tags.includes('combo_seed') && (h >>> 16) % 2 === 0) {
    tags.push('combo_seed')
    if (tags.length > 2) tags.pop()
  }
  return { tags: tags.slice(0, 2) }
}

/** 把 profile 的反射被動套到對手 BattleMobie（一次性能力值微調；terrain/combo_seed 純宣告不調值）。 */
export function applyProfileToMon(mon: BattleMobie, profile: EncounterSkillProfile): BattleMobie {
  let { atk, spe, maxHp, currentHp } = mon
  for (const tag of profile.tags) {
    if (tag === 'aggressive') atk = Math.round(atk * 1.15)
    else if (tag === 'disruptor') spe = Math.round(spe * 1.15)
    else if (tag === 'sustain') { maxHp = Math.round(maxHp * 1.12); currentHp = maxHp }
  }
  return { ...mon, atk, spe, maxHp, currentHp, encounterTags: profile.tags }
}
