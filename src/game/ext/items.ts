// M7 — 持有道具（Held Items，S1/S3/S4）。設計真相：plan/09 §1。
//
// 每隻可裝一個被動道具，補「戰鬥前」深度。效果**嚴格限三類**（圓桌 codex 護欄，防效果失控）：
//   statMod  → S1：建構 BattleUnit 後套能力值倍率
//   damageHook → S3：傷害結算中段的純倍率
//   turnEnd  → S4：回合末同步反應（剩飯回血）
// 致命傷攔截型 onceTrigger（氣勢披帶）需在傷害結算中段插手＝改 engine，本里程碑刻意延後
// （守「reducer/engine 不動」硬約束），待日後補 post-damage 縫再加。
//
// 道具表是手寫非產生檔（如 practiceRegion）：不抓 PokéAPI、icon 用 emoji，零侵權。
// 背包庫存（擁有數量）放獨立 save slice mz.itembag.v1（store/bagStore.ts），不塞進 OwnedUnit。

import type { BattlePokemon } from '@/game/types'
import type {
  BuildUnitHook,
  DamageHook,
  ExtensionModule,
  TurnEndTrigger,
} from '@/game/ext/seams'
import type { BattleEvent } from '@/game/battle/reducer'

export type ItemKind = 'statMod' | 'damageHook' | 'turnEnd'

export interface ItemDef {
  id: string
  name: string
  icon: string
  desc: string
  kind: ItemKind
  /**
   * 純參數：
   *  - statMod：能力值倍率，鍵為 atk/def/spa/spd/spe（例 { atk: 1.3 }）
   *  - damageHook：{ mult } 必填、{ superOnly: 1 } 選填（只對效果絕佳目標）
   *  - turnEnd：{ healFraction }（每回合末回 maxHp×此比例）
   */
  params: Record<string, number>
}

/** 套能力值倍率的鍵（statMod 只動這五項；不動 HP，避免 maxHp/currentHp 不同步） */
const STAT_KEYS = ['atk', 'def', 'spa', 'spd', 'spe'] as const
type StatKey = (typeof STAT_KEYS)[number]
const isStatKey = (k: string): k is StatKey => (STAT_KEYS as readonly string[]).includes(k)
const scale = (v: number, mult: number) => Math.max(1, Math.round(v * mult))

export const ITEMS: ItemDef[] = [
  { id: 'headband', name: '力量頭帶', icon: '💪', kind: 'statMod', params: { atk: 1.3 }, desc: '物理攻擊 +30%' },
  { id: 'glasses', name: '博士眼鏡', icon: '👓', kind: 'statMod', params: { spa: 1.3 }, desc: '特殊攻擊 +30%' },
  { id: 'vest', name: '突擊背心', icon: '🦺', kind: 'statMod', params: { spd: 1.5 }, desc: '特殊防禦 +50%' },
  { id: 'scarf', name: '信念圍巾', icon: '🧣', kind: 'statMod', params: { spe: 1.3 }, desc: '速度 +30%' },
  { id: 'lifeorb', name: '生命寶珠', icon: '🔮', kind: 'damageHook', params: { mult: 1.3 }, desc: '所有傷害 +30%' },
  { id: 'expertbelt', name: '達人帶', icon: '🥋', kind: 'damageHook', params: { mult: 1.2, superOnly: 1 }, desc: '對效果絕佳目標傷害 +20%' },
  { id: 'leftovers', name: '吃剩的東西', icon: '🍎', kind: 'turnEnd', params: { healFraction: 1 / 16 }, desc: '每回合末回復最大 HP 的 1/16' },
]

const BY_ID = new Map(ITEMS.map((d) => [d.id, d]))

/** 查道具定義（未知 id → undefined）。 */
export function getItem(id: string | undefined): ItemDef | undefined {
  return id ? BY_ID.get(id) : undefined
}

// ── 縫實作（讀 BattlePokemon 上的暫態 heldItemId 自行分流；無道具＝中性）──────────

/** S1：建構後套 statMod 道具的能力值倍率。 */
const itemBuildUnit: BuildUnitHook = (unit: BattlePokemon) => {
  const def = getItem(unit.heldItemId)
  if (!def || def.kind !== 'statMod') return unit
  const out = { ...unit }
  for (const [k, mult] of Object.entries(def.params)) {
    if (isStatKey(k)) out[k] = scale(unit[k], mult)
  }
  return out
}

/** S3：傷害結算中段，依攻擊方道具回乘上的純倍率（命玉 ×1.3、達人帶對剋制 ×1.2）。 */
const itemDamage: DamageHook = (ctx) => {
  const def = getItem(ctx.attacker.heldItemId)
  if (!def || def.kind !== 'damageHook') return 1
  if (def.params.superOnly && ctx.effectiveness < 2) return 1
  return def.params.mult ?? 1
}

/** S4：回合末同步段——雙方 active 若持剩飯型道具且未滿血，回血並回報 heal event。 */
const itemTurnEnd: TurnEndTrigger = ({ state }) => {
  const events: BattleEvent[] = []
  for (const side of ['player', 'foe'] as const) {
    const s = state[side]
    const u = s.members[s.activeIndex]
    const def = getItem(u?.heldItemId)
    if (!u || u.currentHp <= 0 || !def || def.kind !== 'turnEnd') continue
    const frac = def.params.healFraction ?? 0
    if (frac <= 0 || u.currentHp >= u.maxHp) continue
    const heal = Math.max(1, Math.floor(u.maxHp * frac))
    const hpBefore = u.currentHp
    const hpAfter = Math.min(u.maxHp, hpBefore + heal)
    u.currentHp = hpAfter
    events.push({
      type: 'heal',
      side,
      index: s.activeIndex,
      amount: hpAfter - hpBefore,
      hpBefore,
      hpAfter,
      maxHp: u.maxHp,
      source: def.id,
    })
  }
  return events
}

/**
 * 持有道具模組：S1（statMod）/ S3（damageHook）/ S4（turnEnd 剩飯）。
 * 停用＝不收這三縫、忽略 heldItemId＝回到無道具的 M1.x 戰鬥。
 */
export const HELD_ITEMS_MODULE: ExtensionModule = {
  id: 'heldItems',
  seams: { buildUnit: itemBuildUnit, damageHook: itemDamage, turnEndTrigger: itemTurnEnd },
  ownsSaveSlices: ['mz.itembag.v1'],
}
