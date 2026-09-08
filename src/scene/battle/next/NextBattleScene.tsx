import { forwardRef } from 'react'
import BattleStage from '@/scene/r3f/BattleStage'
import type { BattleSceneHandle, NextBattleSceneProps } from '@/scene/battle/contracts'

/** Sole full-scene renderer entry behind the stable scene contract. */
const NextBattleScene = forwardRef<BattleSceneHandle, NextBattleSceneProps>(function NextBattleScene(
  props,
  ref,
) {
  return <BattleStage ref={ref} {...props} />
})

export default NextBattleScene
