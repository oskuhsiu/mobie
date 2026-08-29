import { forwardRef } from 'react'
import BattleStage from '@/scene/r3f/BattleStage'
import type { BattleSceneHandle, NextBattleSceneProps } from '@/scene/battle/contracts'

/** Provisional next renderer entry. Ticket 11 may replace the implementation behind this seam. */
const NextBattleScene = forwardRef<BattleSceneHandle, NextBattleSceneProps>(function NextBattleScene(
  props,
  ref,
) {
  return <BattleStage ref={ref} {...props} />
})

export default NextBattleScene
