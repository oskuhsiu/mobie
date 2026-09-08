// @vitest-environment jsdom

import { createRef } from 'react'
import { act, render } from '@testing-library/react'
import { createBattleState } from '@/game/battle/reducer'
import { mon } from '@/game/battle/testFixtures'
import { resolveTerrainWorld } from '@/scene/r3f/terrainVisual'
import type { BattleSceneHandle, BattleSceneSnapshot } from '@/scene/battle/contracts'
import CompatibilityBattleScene from './CompatibilityBattleScene'

const battle = createBattleState([mon()], [mon()])
const snapshot: BattleSceneSnapshot = {
  player: battle.player.members[0]!,
  foe: battle.foe.members[0]!,
  terrainWorld: resolveTerrainWorld([]),
  terrainVisualIntensity: 1,
  outcome: null,
}

describe('CompatibilityBattleScene', () => {
  it('pauses and resumes compatibility motion for hit-stop', () => {
    const ref = createRef<BattleSceneHandle>()
    render(<CompatibilityBattleScene ref={ref} snapshot={snapshot} paused={false} reducedMotion={false} />)
    const root = document.querySelector<HTMLElement>('.battle-renderer--compatibility')
    expect(root).not.toBeNull()

    act(() => ref.current?.setTimeScale(0))
    expect(root?.dataset.rendererTimeScale).toBe('0')
    expect(root?.style.getPropertyValue('--battle-renderer-duration-scale')).toBe('1')

    act(() => ref.current?.setTimeScale(1))
    expect(root?.dataset.rendererTimeScale).toBe('1')
  })
})
