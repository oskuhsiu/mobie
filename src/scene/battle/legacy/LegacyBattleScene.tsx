import { forwardRef } from 'react'
import BattleStage from '@/scene/r3f/BattleStage'
import type { BattleSceneHandle, NextBattleSceneProps } from '@/scene/battle/contracts'

/**
 * Release A legacy entry. Keeping the established BattleStage behind its own
 * lazy route gives production a reversible default without making a second
 * scene or changing the battle/presentation transaction.
 */
const LegacyBattleScene = forwardRef<BattleSceneHandle, NextBattleSceneProps>(function LegacyBattleScene(
  props,
  ref,
) {
  return <BattleStage ref={ref} {...props} />
})

export default LegacyBattleScene
