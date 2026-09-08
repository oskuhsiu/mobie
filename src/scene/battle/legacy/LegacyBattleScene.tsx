import { forwardRef } from 'react'
import BattleStage from '@/scene/r3f/BattleStage'
import type { BattleSceneHandle, NextBattleSceneProps } from '@/scene/battle/contracts'

/**
 * Release B rollback entry. Keeping the established BattleStage behind its own
 * lazy route preserves one release of reversible history without making a
 * second scene or changing the battle/presentation transaction.
 */
const LegacyBattleScene = forwardRef<BattleSceneHandle, NextBattleSceneProps>(function LegacyBattleScene(
  props,
  ref,
) {
  return <BattleStage ref={ref} {...props} />
})

export default LegacyBattleScene
