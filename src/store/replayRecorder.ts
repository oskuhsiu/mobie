// M14.c — 單點錄製器（plan/15 §4）：開戰 start → 每回合 record（與 ext 注入同層、同一處）→
// 結束 finish 組出 ReplayLog → encode → 存 IndexedDB。只蒐集 canonical 資料，不做任何演出/UI 判斷。
// 每場一個 instance（BattleScreen 持 ref），避免跨場殘留。

import { hashSeed } from '@/game/rng'
import { encodeReplay } from '@/game/replay/codec'
import { REPLAY_FORMAT_VERSION, type ReplayInput, type ReplayTurn, type DisplayUnitSnapshot, type ReplayLog } from '@/game/replay/types'
import type { BattleEvent } from '@/game/battle/reducer'
import { putReplay } from '@/game/replay/replayDb'

export interface RecorderStart {
  battleSeed: string
  regionId: string
  mode: 'arena' | 'wild'
  snapshot: DisplayUnitSnapshot[]
  /** 開戰時刻（epoch ms），存進 header.createdAt。 */
  createdAt: number
}

export class ReplayRecorder {
  private base: RecorderStart | null = null
  private turns: ReplayTurn[] = []

  /** 是否正在錄（off 模式不呼叫 start ⇒ 恆 false ⇒ record/finish 為 no-op）。 */
  get active(): boolean {
    return this.base !== null
  }

  start(base: RecorderStart): void {
    this.base = base
    this.turns = []
  }

  /** 每次 resolveTurn 後呼叫一次（input = 對應的玩家輸入，events = reducer 吐的事件流）。 */
  record(input: ReplayInput, events: BattleEvent[]): void {
    if (!this.base) return
    this.turns.push({ input, events })
  }

  /** 結束錄製 → 組 ReplayLog（不持久化，純資料）。無 base/無回合 → null。 */
  build(outcome: 'win' | 'lose'): ReplayLog | null {
    if (!this.base || this.turns.length === 0) return null
    const { battleSeed, regionId, mode, snapshot, createdAt } = this.base
    const battleId = hashSeed(`${battleSeed}|${snapshot.map((u) => `${u.instanceId}:${u.speciesId}:${u.level}`).join(',')}`).toString(16)
    return {
      header: { formatVersion: REPLAY_FORMAT_VERSION, battleId, battleSeed, createdAt, regionId, mode, outcome, snapshot },
      turns: this.turns,
    }
  }

  /** 結束 + 持久化（encode → IndexedDB；fire-and-forget，失敗不影響遊戲）。回傳是否有存。 */
  async finish(outcome: 'win' | 'lose'): Promise<boolean> {
    const log = this.build(outcome)
    this.base = null
    this.turns = []
    if (!log) return false
    const players = log.header.snapshot.filter((u) => u.side === 'player').map((u) => u.displayName)
    const foes = log.header.snapshot.filter((u) => u.side === 'foe').map((u) => u.displayName)
    try {
      await putReplay({
        battleId: log.header.battleId,
        createdAt: log.header.createdAt,
        regionId: log.header.regionId,
        mode: log.header.mode,
        outcome,
        players,
        foes,
        json: encodeReplay(log),
      })
      return true
    } catch {
      return false
    }
  }
}
