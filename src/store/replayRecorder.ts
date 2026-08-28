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

export type ReplayRecordResult =
  | { status: 'recorded' }
  | { status: 'inactive' }
  | { status: 'disabled' }
  | { status: 'failed'; error: unknown }

export type ReplayPrepareResult =
  | { status: 'prepared'; turn: ReplayTurn }
  | Exclude<ReplayRecordResult, { status: 'recorded' }>

export interface ReplayRecorderDependencies {
  hashSeed: typeof hashSeed
  encodeReplay: typeof encodeReplay
  putReplay: typeof putReplay
}

const DEFAULT_DEPENDENCIES: ReplayRecorderDependencies = {
  hashSeed,
  encodeReplay,
  putReplay,
}

export class ReplayRecorder {
  private base: RecorderStart | null = null
  private turns: ReplayTurn[] = []
  private failed = false

  constructor(private readonly dependencies: ReplayRecorderDependencies = DEFAULT_DEPENDENCIES) {}

  /** 是否正在錄（off 模式不呼叫 start ⇒ 恆 false ⇒ record/finish 為 no-op）。 */
  get active(): boolean {
    return this.base !== null && !this.failed
  }

  start(base: RecorderStart): void {
    this.base = base
    this.turns = []
    this.failed = false
  }

  /** Public no-throw boundary used by the turn coordinator. */
  prepareTurn(input: ReplayInput, events: readonly BattleEvent[]): ReplayPrepareResult {
    if (this.failed) return { status: 'disabled' }
    if (!this.base) return { status: 'inactive' }
    try {
      return { status: 'prepared', turn: { input, events: Array.from(events) } }
    } catch (error) {
      this.disable()
      return { status: 'failed', error }
    }
  }

  commitPrepared(turn: ReplayTurn): ReplayRecordResult {
    if (this.failed) return { status: 'disabled' }
    if (!this.base) return { status: 'inactive' }
    try {
      this.turns.push(turn)
      return { status: 'recorded' }
    } catch (error) {
      this.disable()
      return { status: 'failed', error }
    }
  }

  /** Public no-throw convenience for callers without a presentation transaction. */
  tryRecord(input: ReplayInput, events: readonly BattleEvent[]): ReplayRecordResult {
    const prepared = this.prepareTurn(input, events)
    return prepared.status === 'prepared' ? this.commitPrepared(prepared.turn) : prepared
  }

  /** Backwards-compatible no-throw recording entry point. */
  record(input: ReplayInput, events: readonly BattleEvent[]): void {
    this.tryRecord(input, events)
  }

  /** 結束錄製 → 組 ReplayLog（不持久化，純資料）。無 base/無回合 → null。 */
  build(outcome: 'win' | 'lose'): ReplayLog | null {
    if (this.failed || !this.base || this.turns.length === 0) return null
    try {
      const { battleSeed, regionId, mode, snapshot, createdAt } = this.base
      const battleId = this.dependencies.hashSeed(
        `${battleSeed}|${snapshot.map((u) => `${u.instanceId}:${u.speciesId}:${u.level}`).join(',')}`,
      ).toString(16)
      return {
        header: { formatVersion: REPLAY_FORMAT_VERSION, battleId, battleSeed, createdAt, regionId, mode, outcome, snapshot },
        turns: this.turns,
      }
    } catch {
      this.disable()
      return null
    }
  }

  /** 結束 + 持久化（encode → IndexedDB；fire-and-forget，失敗不影響遊戲）。回傳是否有存。 */
  async finish(outcome: 'win' | 'lose'): Promise<boolean> {
    try {
      if (this.failed) return false
      const log = this.build(outcome)
      if (!log) {
        this.abandon()
        return false
      }
      const players = log.header.snapshot.filter((u) => u.side === 'player').map((u) => u.displayName)
      const foes = log.header.snapshot.filter((u) => u.side === 'foe').map((u) => u.displayName)
      const json = this.dependencies.encodeReplay(log)
      await this.dependencies.putReplay({
        battleId: log.header.battleId,
        createdAt: log.header.createdAt,
        regionId: log.header.regionId,
        mode: log.header.mode,
        outcome,
        players,
        foes,
        json,
      })
      this.abandon()
      return true
    } catch {
      this.disable()
      return false
    }
  }

  private abandon(): void {
    this.base = null
    this.turns = []
  }

  private disable(): void {
    this.failed = true
    this.abandon()
  }
}
