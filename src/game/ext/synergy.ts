// M7 — 隊伍羈絆（Team Synergy，S2）。設計真相：plan/09 §2。
//
// 「最乾淨」的延伸系統：純函數、零持久化、拔掉零殘留。由出戰隊伍算出全隊「具名修飾」
// （NamedModifier，必帶 label/source/icon 供 UI 回顯，禁隱形加成），在戰鬥初始化 / 編隊變更時
// **單次**呼叫拍板成扁平靜態加成注入；戰鬥內換 active 不重算（避免撞「HP 跨換人持續」不變式）。

import type { BattlePokemon } from '@/game/types'
import type { ExtensionModule, NamedModifier, PreBattleHook } from '@/game/ext/seams'

/** 把能力值乘上倍率並四捨五入（保底 1）。 */
const scale = (v: number, mult: number) => Math.max(1, Math.round(v * mult))

export interface SynergyRule {
  id: string
  label: string
  icon: string
  /** 是否成立（看整隊） */
  test: (team: BattlePokemon[]) => boolean
  /** 成立時加到每隻身上的具名修飾 */
  modifier: NamedModifier
}

/** 隊伍涵蓋的不同屬性數。 */
function distinctTypeCount(team: BattlePokemon[]): number {
  const set = new Set<string>()
  for (const m of team) for (const t of m.types) set.add(t)
  return set.size
}

/** 是否有「某個屬性被 ≥2 隻共同持有」。 */
function hasSharedType(team: BattlePokemon[]): boolean {
  const count = new Map<string, number>()
  for (const m of team) for (const t of new Set(m.types)) count.set(t, (count.get(t) ?? 0) + 1)
  for (const n of count.values()) if (n >= 2) return true
  return false
}

/** 世代（dex 區段）：1=1–151、2=152–251。 */
const genOf = (speciesId: number) => (speciesId <= 151 ? 1 : 2)

/** 全隊同世代（且至少 2 隻才有意義）。 */
function sameGeneration(team: BattlePokemon[]): boolean {
  if (team.length < 2) return false
  const g = genOf(team[0].speciesId)
  return team.every((m) => genOf(m.speciesId) === g)
}

export const SYNERGY_RULES: SynergyRule[] = [
  {
    id: 'diverse',
    label: '多樣陣容',
    icon: '🌈',
    test: (team) => distinctTypeCount(team) >= 3,
    modifier: {
      label: '多樣陣容 · 速度 +10%',
      source: '羈絆',
      icon: '🌈',
      apply: (u) => ({ ...u, spe: scale(u.spe, 1.1) }),
    },
  },
  {
    id: 'kinship',
    label: '同屬共鳴',
    icon: '🤝',
    test: (team) => team.length >= 2 && hasSharedType(team),
    modifier: {
      label: '同屬共鳴 · 攻擊/特攻 +10%',
      source: '羈絆',
      icon: '🤝',
      apply: (u) => ({ ...u, atk: scale(u.atk, 1.1), spa: scale(u.spa, 1.1) }),
    },
  },
  {
    id: 'generation',
    label: '世代羈絆',
    icon: '🧬',
    test: sameGeneration,
    modifier: {
      label: '世代羈絆 · HP +8%',
      source: '羈絆',
      icon: '🧬',
      apply: (u) => {
        const maxHp = scale(u.maxHp, 1.08)
        // 戰鬥初始化時 currentHp===maxHp（滿血），同比例放大保持滿血；中途不重算故無「回血」副作用。
        const currentHp = u.currentHp >= u.maxHp ? maxHp : Math.min(maxHp, scale(u.currentHp, 1.08))
        return { ...u, maxHp, currentHp }
      },
    },
  },
]

/**
 * 純函數：由出戰隊伍算出生效的羈絆修飾（plan/09 §2.2）。
 * 回傳已成立規則的 modifier 陣列（含 label/source/icon），供注入與 UI 回顯。
 */
export function computeSynergy(team: BattlePokemon[]): NamedModifier[] {
  const out: NamedModifier[] = []
  for (const rule of SYNERGY_RULES) if (rule.test(team)) out.push(rule.modifier)
  return out
}

const preBattle: PreBattleHook = computeSynergy

/** 羈絆模組：只掛 S2（preBattleModifiers）。停用＝computeSynergy 不被收＝無任何加成。 */
export const SYNERGY_MODULE: ExtensionModule = {
  id: 'synergy',
  seams: { preBattleModifiers: preBattle },
}
