// M14.a — 戰鬥回放 canonical schema（plan/15 §2）。
// canonical = 結構化 JSON log（事件流 + header 含 seed/輸入）；人類戰報是純投影（report.ts），永不反向 parse。
// 視覺回放 = 把事件流餵回 BattleScreen 既有 event 消費器。引擎內部欄位（ivs/nature/derived stats）一律不進。

import type { BattleEvent } from '@/game/battle/reducer'
import type { QteQuality } from '@/game/battle/engine'

/** 整檔單一版本號；新增 event variant → bump + 寫 migrate（plan/15 §2 版本化規則）。
 *  v2（M12.d）：新增 comboCast event variant。 */
export const REPLAY_FORMAT_VERSION = 2

/** 回放只需「畫面/FX 分派」要的穩定欄位（不含引擎內部 ivs/nature/derived）。 */
export interface DisplayUnitSnapshot {
  instanceId: string // 穩定 id：`${side}:${slot}`，FX/動畫分派用
  side: 'player' | 'foe'
  slot: number // 隊伍索引 0..2
  speciesId: number
  displayName: string // 已解析中文名（戰報/牌面顯示）
  level: number
  maxHp: number
  initialHp: number // 開場 HP（跨場/換人 HP 持續，未必＝maxHp）
  shiny: boolean
  heldItemId?: string
  abilityId?: string
}

/** 玩家本回合輸入（重模擬用；視覺回放不靠它，靠 events）。 */
export type ReplayInput =
  | { type: 'ATTACK'; quality?: QteQuality; mashCount?: number; starStrike?: boolean; slotIndex?: number }
  | { type: 'SWITCH'; index: number; defenseQuality?: QteQuality }
  | { type: 'CHAIN'; hits: { attackerIndex: number; quality: QteQuality }[] }

export interface ReplayTurn {
  input: ReplayInput
  events: BattleEvent[] // 直接存 reducer 吐的 domain events（已是純資料）
  /** 預留：M8+ 地形/場域事件（M14 一律不填，前向相容用）。 */
  fieldEvents?: unknown[]
}

export interface ReplayHeader {
  formatVersion: number // = REPLAY_FORMAT_VERSION
  battleId: string // FNV-1a(seed + snapshot) 去重 key
  battleSeed: string // 開場 seed（mulberry32 推進來源）
  createdAt: number // epoch ms（錄製當下；存進來而非由 codec 產）
  regionId: string
  mode: 'arena' | 'wild'
  outcome: 'win' | 'lose'
  snapshot: DisplayUnitSnapshot[] // 雙方全員
  /** payload（turns）的 crc32 十六進位；擋截斷/手改壞檔（沿用 bundle.ts 精神）。 */
  checksum?: string
  /** 預留：M8 地形初始場域（M14 不填）。 */
  initialFieldState?: unknown
}

export interface ReplayLog {
  header: ReplayHeader
  turns: ReplayTurn[] // 一個 resolveTurn 呼叫 = 一個 turn entry
}
