import { findMove } from '@/game/data/moves'
import { resolveAbilityDamageEffect } from '@/game/ext/abilities'
import { resolveItemDamageEffect } from '@/game/ext/items'
import type { BattleMobie } from '@/game/types'

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

/** Active extension sources for one resolved damage cue, using the same pure rules as S3. */
export function damageEffectSourceLabels(
  attacker: BattleMobie,
  defender: BattleMobie,
  effectiveness: number,
): string[] {
  const context = { attacker, defender, effectiveness }
  const item = resolveItemDamageEffect(context).source
  const abilities = resolveAbilityDamageEffect(context)
  return [
    ...(item ? [`${item.icon} ${item.name}強化傷害`] : []),
    ...(abilities.attackerSource
      ? [`${abilities.attackerSource.icon} ${abilities.attackerSource.name}強化傷害`]
      : []),
    ...(abilities.defenderSource
      ? [`${abilities.defenderSource.icon} ${abilities.defenderSource.name}降低傷害`]
      : []),
  ]
}
