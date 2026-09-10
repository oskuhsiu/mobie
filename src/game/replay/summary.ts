import type { ReplayLog } from './types'

export interface ReplaySummary {
  turnCount: number
  eventCount: number
  durationMs: number | null
  participants: number
  players: string[]
  foes: string[]
}

/** Derive list facts from the canonical replay so stale/missing cached meta cannot lie. */
export function summarizeReplay(log: ReplayLog): ReplaySummary {
  const players = log.header.snapshot.filter((unit) => unit.side === 'player').map((unit) => unit.displayName)
  const foes = log.header.snapshot.filter((unit) => unit.side === 'foe').map((unit) => unit.displayName)
  return {
    turnCount: log.turns.length,
    eventCount: log.turns.reduce((count, turn) => count + turn.events.length, 0),
    durationMs: typeof log.header.durationMs === 'number' && Number.isFinite(log.header.durationMs)
      ? Math.max(0, log.header.durationMs)
      : null,
    participants: log.header.snapshot.length,
    players,
    foes,
  }
}

export function formatReplayDuration(durationMs: number | null): string {
  if (durationMs === null) return '時間未記錄'
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
