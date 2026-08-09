import type { ReactNode } from 'react'
import { render } from '@testing-library/react'
import { GameProvider } from '@/app/GameProvider'
import { Stage } from '@/app/App'
import {
  gameMachine,
  INITIAL_GAME_CONTEXT,
  type GameContext,
} from '@/game/machine/gameMachine'

type GameState = 'title' | 'regionSelect' | 'towerSetup' | 'encounter' | 'cardSelect' | 'battle' | 'result'

/**
 * Highest UI test seam for a Mobie journey.
 *
 * It restores the real XState machine at a named top-level screen and renders
 * the real Stage. Individual tests may mock only browser/system boundaries
 * such as audio, canvas/3D, timers, or randomness.
 */
export function renderGameJourney({
  state = 'title',
  context = {},
  children,
}: {
  state?: GameState
  context?: Partial<GameContext>
  children?: ReactNode
} = {}) {
  const snapshot = gameMachine.resolveState({
    value: state,
    context: { ...INITIAL_GAME_CONTEXT, ...context },
  })

  return render(
    <GameProvider snapshot={snapshot}>
      {children ?? <Stage />}
    </GameProvider>,
  )
}
