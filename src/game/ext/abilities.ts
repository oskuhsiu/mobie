// M7 — 特性（Abilities，S1/S3）。設計真相：plan/10（wave-2），複用道具 S1/S3 引擎、分語義
// （種族被動 vs 可學主動）。本里程碑以「依主屬性決定論指派」的手寫表給每隻一個特性——
// 不改 generated species.ts、不連網（同 practiceRegion 的手寫慣例），日後可換成 per-species 表。
//
// 閘控設計：abilityId 由本模組的 S1 buildUnit hook 寫到 BattleMobie（只在模組啟用、經 prep
// 套到對戰雙方）；buildBattleMobie 本身不設 abilityId。故關閉模組＝沒有 abilityId＝S3 找不到特性。
// 與道具同類「加法疊加」（靠數值池上限控平衡，不做來源攔截）。
// onSwitchIn（如威嚇，需在換人解析步驟內結算）需動 reducer，本里程碑刻意延後。

import type { BattleMobie, TypeName } from '@/game/types'
import type { BuildUnitHook, DamageHook, ExtensionModule } from '@/game/ext/seams'
import { applyStatMod, createLookup } from '@/game/ext/statPatch'

export type AbilityKind = 'statMod' | 'pinch' | 'guard'

export interface AbilityDef {
  id: string
  name: string
  icon: string
  desc: string
  /**
   * statMod → S1 能力值倍率（鍵為 atk/def/spa/spd/spe）
   * pinch   → S3 攻擊方 HP ≤ params.threshold 時，傷害 ×params.mult（絕境爆發）
   * guard   → S3 防守方被效果絕佳（effectiveness≥2）攻擊時，傷害 ×params.mult（厚實）
   */
  kind: AbilityKind
  params: Record<string, number>
}

export const ABILITIES: AbilityDef[] = [
  { id: 'pinch_boost', name: '絕境爆發', icon: '🔥', kind: 'pinch', params: { threshold: 1 / 3, mult: 1.5 }, desc: 'HP 剩 1/3 以下時，攻擊傷害 +50%' },
  { id: 'power', name: '蠻力', icon: '💢', kind: 'statMod', params: { atk: 1.15 }, desc: '物理攻擊 +15%' },
  { id: 'sturdy', name: '鐵壁', icon: '🛡️', kind: 'statMod', params: { def: 1.2 }, desc: '物理防禦 +20%' },
  { id: 'swift', name: '疾風', icon: '🌀', kind: 'statMod', params: { spe: 1.25 }, desc: '速度 +25%' },
  { id: 'mystic', name: '神秘體', icon: '🔮', kind: 'statMod', params: { spa: 1.15 }, desc: '特殊攻擊 +15%' },
  { id: 'guard', name: '厚實', icon: '🧱', kind: 'guard', params: { mult: 0.8 }, desc: '被效果絕佳的招式攻擊時，受到傷害 -20%' },
]

/** 屬性 → 特性 id（18 型全覆蓋；攻擊系給絕境爆發、其餘依屬性給能力/防禦/速度型）。 */
const TYPE_ABILITY: Record<TypeName, string> = {
  fire: 'pinch_boost', water: 'pinch_boost', grass: 'pinch_boost', bug: 'pinch_boost',
  dragon: 'pinch_boost', ghost: 'pinch_boost', dark: 'pinch_boost',
  fighting: 'power', ground: 'power', rock: 'power',
  steel: 'sturdy', poison: 'sturdy',
  electric: 'swift', flying: 'swift',
  psychic: 'mystic', fairy: 'mystic',
  ice: 'guard', normal: 'guard',
}

/** 查特性定義（未知 / 未給 id → undefined）。 */
export const getAbility = createLookup(ABILITIES)

/** 依主屬性決定論指派特性 id。 */
export function abilityForType(primary: TypeName): string {
  return TYPE_ABILITY[primary]
}

// ── 縫實作 ──────────────────────────────────────────────────────

/** S1：寫入 abilityId（依主屬性）＋套 statMod 型特性的能力值倍率。兩方皆過此 hook。 */
const abilityBuildUnit: BuildUnitHook = (unit: BattleMobie) => {
  const id = abilityForType(unit.types[0])
  const withId: BattleMobie = { ...unit, abilityId: id }
  const def = getAbility(id)
  return def?.kind === 'statMod' ? applyStatMod(withId, def.params) : withId
}

/** S3：攻擊方絕境爆發（pinch）×、防守方厚實（guard）× —— 同一 hook 讀 ctx 雙方自行分流。 */
const abilityDamage: DamageHook = (ctx) => {
  let mult = 1
  const atk = getAbility(ctx.attacker.abilityId)
  if (atk?.kind === 'pinch' && ctx.attacker.currentHp <= ctx.attacker.maxHp * (atk.params.threshold ?? 0)) {
    mult *= atk.params.mult ?? 1
  }
  const def = getAbility(ctx.defender.abilityId)
  if (def?.kind === 'guard' && ctx.effectiveness >= 2) {
    mult *= def.params.mult ?? 1
  }
  return mult
}

/**
 * 特性模組：S1（寫 abilityId + statMod）/ S3（pinch + guard）。複用道具引擎、分語義。
 * 停用＝不收這兩縫、BattleMobie 無 abilityId＝回到無特性的 M1.x 戰鬥。
 */
export const ABILITIES_MODULE: ExtensionModule = {
  id: 'abilities',
  seams: { buildUnit: abilityBuildUnit, damageHook: abilityDamage },
}
