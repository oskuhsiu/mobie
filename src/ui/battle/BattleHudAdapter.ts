import { findMove } from '@/game/data/moves'

export type BattleHudSource =
  | { kind: 'status'; source: number; label: string }
  | { kind: 'combo'; key: string; label: string }

const nonEmpty = (value: string): string | null => value.trim() || null

/** Pure display adapter; reducer provenance remains unchanged and never leaks as "招式 -1". */
export function displaySourceName(source: BattleHudSource): string {
  if (source.kind === 'combo') {
    return nonEmpty(source.label) ?? nonEmpty(source.key) ?? '未知來源'
  }
  if (source.source > 0) return findMove(source.source)?.nameZh ?? '未知來源'
  if (source.source === -1) return nonEmpty(source.label) ?? '未知來源'
  return '未知來源'
}
