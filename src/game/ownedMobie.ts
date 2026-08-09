import { abilityForType } from '@/game/ext/abilities'
import { ownedToCard } from '@/game/growth'
import { buildBattleMobie } from '@/game/stats'
import type { BattleMobie, OwnedUnit } from '@/game/types'

/** 建立 owner 資訊卡用的完整 Mobie；不套用可選戰鬥模組的數值加成。 */
export function buildOwnedMobieForDisplay(unit: OwnedUnit): BattleMobie {
  const mon = buildBattleMobie(ownedToCard(unit))
  return { ...mon, abilityId: abilityForType(mon.types[0]) }
}
